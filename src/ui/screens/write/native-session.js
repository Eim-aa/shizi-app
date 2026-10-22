// 原生写字页的「写字会话 API」与网页宿主条目（B2.0 最小纵切；架构见 docs/engineering/v10/B2-原生写字架构.md）。
//
// 选定架构（方案 A′）：一个运行时、一份 store——规则与 store 仍只在 WKWebView 里，原生写字页是「视图」：
//   - 读：页面把会话快照（当前字、题面、进度、阶段、笔画、文案、颜色）随 open 消息一次推给原生，之后每次提交的回包里带新快照，
//     写字中途（落笔、画、抬笔、撤销、清空）原生不等桥；
//   - 写：一律经 window.shiziNativeWrite(op, args)（原生用 callAsyncJavaScript 调用），调用网页写字页**同一批**提交函数
//     （B2.1 起在无 DOM 的 src/session/：write-api.js 的 createWriteSessionApi → write-ops.js / result-ops.js），store.commit 仍是唯一写入口；
//     本模块只剩界面那一半：开关、导航与颜色的注入、window 全局、宿主条目；
//   - D07：judge 回 {ok:false} 时原生留在判断页走三段式，成功才推进；strokes / phase 按 P52 不阻断。
// 导航：网页路由仍是真相源。写字页条目照常入栈（冷启动恢复、刷新都按 route-memory 走），开关打开时它渲染成「原生宿主」
// （透明、不画内容，下层页保持可见，见 root.js nativeHost），挂载时 postMessage({type:'nativeWrite', op:'open'}) 让原生推入写字页，
// 卸载时 op:'close'；原生返回 / 写完最后一字时调用 exit，由本模块 nav.back() / openResult()。
//
// 开关：iOS 壳启动参数 -shizi-native-write（SHIZI_NATIVE_WRITE=1；B3.1 起 Release 壳也有、默认关，B3.F 去掉）时，原生在文档开始注入 window.__shiziNativeWrite = true；
// 默认关，关着时本模块什么都不装、写字页与正式流程完全相同。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { getRouter, nav } from '../../router.js';
import { nativeBackPlan, nativePlanOf, notifyNativeHostChange, onNativeHostChange, whenNavIdle } from '../../paper-transition.js';
import { M } from '../../../config/motion.js';
import { postNative, isNative } from '../../../platform/bridge.js';
import { handoffSkipUndo, leaveTo, openResult, resultImageAction, takeSkipUndo } from '../result/index.js';
import { resultView } from '../result/native-view.js';
import { commitLeave } from '../../../session/result-ops.js';
import { getStore } from '../../../store/store.js';
import { NONE_SCREEN } from '../session/none.js';
// B2.9a：不 import write/redo.js（它要 import 本模块的 NativeRedoHost，避免循环导入）；字表整理用会话层同一个 redoCharsOf，屏名同 REDO_SCREEN
import { redoCharsOf } from '../../../session/write-ops.js';
import { inviteChangeTime, inviteReminder } from '../../../platform/reminder.js';
import { keySound, warmSounds } from '../../../platform/sound.js';
import { handoffLeaveUndo } from './skip.js';
import { openCharDetail } from '../detail/open.js';
import { pyOf, refCardLabel } from './ref-label.js';
import { loadStrokes } from '../../../data/strokes.js';
import {
  createWriteSessionApi as createSessionApi, writeSnapshot, strokesToWire, strokesFromWire, copyBundle, NATIVE_WRITE_COPY_KEYS, NATIVE_WRITE_OPS,
} from '../../../session/write-api.js';

// B2.1：op 表、快照、笔画格式、文案字典与 API 本体挪到 src/session/write-api.js（无 DOM）；这里原名转出，原导入路径照旧可用。
export { writeSnapshot, strokesToWire, strokesFromWire, copyBundle, NATIVE_WRITE_COPY_KEYS, NATIVE_WRITE_OPS };

/** 原生要的颜色令牌（取页面此刻计算值：浅 / 深色与网页同源，见 tokens.css）。toast-shadow 是 box-shadow 串（原生 NativeInkWire.shadow 解析），其余是颜色。 */
export const NATIVE_WRITE_COLOR_TOKENS = Object.freeze(['paper', 'hand', 'ref', 'frame', 'line', 'ink1', 'ink2', 'ink3', 'ink4', 'field', 'danzhu', 'toast-bg', 'toast-fg', 'toast-act', 'toast-line', 'toast-shadow', 'scrim', 'elev', 'sheet', 'btn-bg', 'btn-fg', 'guide',
  // B2.7 结果页：衬底字、写错朱点、印（朱色白名单只在原生结果页的作品与行里用，同网页 marks.js）
  'under', 'zhu', 'seal', 'on-seal']);

/** R9-B：原生要的字阶令牌（--fs13 / --lh13 …；R10-B 加圆角容器档 r-box 给 L4 浮条，取页面此刻计算值，pt；系统字号连续倍率 --k 与 AX 档取值表都在 tokens.css，原生不抄表）。 */
export const NATIVE_WRITE_TYPE_TOKENS = Object.freeze(['fs13', 'lh13', 'fs15', 'lh15', 'fs17', 'lh17', 'lh17s', 'fs22', 'lh22', 'fs28', 'btn-h', 'r-box']);

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/** 开关：iOS 壳注入了 __shiziNativeWrite 且在原生壳内。 */
export function nativeWriteEnabled(win = globalWin()) {
  return !!(win && win.__shiziNativeWrite === true && (win.__shiziNativeWriteForce === true || isNative()));
}

export function colorBundle(win = globalWin()) {
  const out = {};
  try {
    const cs = win.getComputedStyle(win.document.documentElement);
    for (const name of NATIVE_WRITE_COLOR_TOKENS) out[name] = cs.getPropertyValue(`--${name}`).trim();
  } catch (error) {
    // node:test / 无 DOM
  }
  return out;
}

/** B3.1：页面此刻的主题（:root 的 color-scheme 计算值，tokens.css 浅 / 深块各自声明；含「我的 › 外观」的强制浅 / 深）→ 'light' | 'dark'；无 DOM → undefined。 */
export function themeOf(win = globalWin()) {
  try {
    const scheme = win.getComputedStyle(win.document.documentElement).colorScheme || '';
    if (!scheme) return undefined; // 读不到（没有 color-scheme 计算值）：不给，原生跟系统
    return /dark/.test(scheme) ? 'dark' : 'light';
  } catch (error) {
    return undefined;
  }
}

export function typeBundle(win = globalWin()) {
  const out = {};
  try {
    const cs = win.getComputedStyle(win.document.documentElement);
    // 字阶是 calc(13px * var(--k)) / max(…) 这样的表达式：挂一个探针元素让浏览器算出 px
    const probe = win.document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0';
    win.document.documentElement.appendChild(probe);
    for (const name of NATIVE_WRITE_TYPE_TOKENS) {
      probe.style.width = `var(--${name})`;
      const px = parseFloat(win.getComputedStyle(probe).width);
      if (Number.isFinite(px) && px > 0) out[name] = px;
      else {
        const raw = parseFloat(cs.getPropertyValue(`--${name}`));
        if (Number.isFinite(raw) && raw > 0) out[name] = raw;
      }
    }
    probe.remove();
  } catch (error) {
    // node:test / 无 DOM
  }
  const ax = axRoleBundle(win);
  if (ax) {
    out.ax = ax.level;
    out.roles = ax.roles;
  }
  return out;
}

/**
 * B2.9b：AX1–AX5 版式的逐元素字阶 / 尺寸（单一来源 = 网页写字页 / 判断页 / 结果页 / 弹层的同一组 CSS）。
 * AX 档里网页按元素分层封顶（write/index.js、prompt.js、foot.js、compare.js、components/ax.js 的 :root[data-ax] 规则），不是直接取 --fsN：
 * 这里把每种元素按网页的类名结构挂一份看不见的探针，读浏览器算出的字号 / 行高 / 最小高 / 内边距 / 宽（pt），原生照此排，不抄取值表。
 * 每条：[角色, 探针 HTML（data-r 标记要量的元素，data-r2… 是同一角色的附属元素）, 量哪些]。
 */
const W_PAGE = inner => `<div class="sz-page" data-testid="write-screen">${inner}</div>`;
const R_PAGE = inner => `<div class="sz-page" data-testid="result-screen">${inner}</div>`;
export const NATIVE_AX_ROLES = Object.freeze([
  // 写字页页头：跳过 / 结束这组（headact 文字按钮）、进度、阶段标题
  ['headAct', W_PAGE('<header class="sz-page__head"><span class="sz-page__trail"><span class="sz-write__headtools"><span class="sz-write__headact"><button class="sz-btn sz-btn--text" data-r>x</button></span></span></span></header>')],
  ['progress', W_PAGE('<header class="sz-page__head"><span class="sz-page__center"><span class="sz-write__progress" data-r>1</span></span></header>')],
  ['title', W_PAGE('<header class="sz-page__head"><span class="sz-page__lead"></span><h1 class="sz-page__title" data-r>x</h1><span class="sz-page__trail"></span></header>')],
  // 格下：撤销 / 清空（图标 data-r2）、说明位（说明 data-r 的最小高与上内边距，字 data-r2，格下整体 data-r3 的最小高）
  ['tool', W_PAGE('<div class="sz-write"><div class="sz-write__below"><div class="sz-write__tools"><button class="sz-write__tool" data-r><svg data-r2></svg>x</button></div></div></div>')],
  ['note', W_PAGE('<div class="sz-write"><div class="sz-write__below" data-r3><div class="sz-write__note" data-r><span data-r2>x</span></div></div></div>')],
  ['noteTight', W_PAGE('<div class="sz-write" data-tight="true"><div class="sz-write__below" data-r3><div class="sz-write__note" data-r><span data-r2>x</span></div></div></div>')],
  // 底栏：求助行（按钮 data-r、图标 data-r2、底栏 data-r3 的行距、求助行 data-r4）与主按钮（data-r5）；Tight = 书写格放不下 220 时（P278 data-compact）
  ['help', W_PAGE('<div class="sz-write__foot" data-r3><div class="sz-write__links" data-r4><div class="sz-write__slot"><button class="sz-btn sz-btn--text" data-r><span class="sz-write__ic" data-r2></span>x</button></div></div><button class="sz-btn sz-btn--primary" data-r5>x</button></div>')],
  ['helpTight', W_PAGE('<div class="sz-write__foot" data-compact="true" data-r3><div class="sz-write__links" data-r4><div class="sz-write__slot"><button class="sz-btn sz-btn--text" data-r><span class="sz-write__ic" data-r2></span>x</button></div></div><button class="sz-btn sz-btn--primary" data-r5>x</button></div>')],
  // 判断两键（data-r）与两键的排法（data-r2：一列 = 上下排）
  ['judge', W_PAGE('<div class="sz-judge__btns" data-r2><button class="sz-judge__btn" data-r>x</button><button class="sz-judge__btn">x</button></div>')],
  // 题面：拼音上方留白（wordwrap 上内边距 data-r）、题面格边长（data-r2）、拼音（data-r3）、提示行（data-r5）
  ['prompt', W_PAGE('<div class="sz-prompt"><div class="sz-prompt__wordwrap" data-r><div class="sz-prompt__word"><span class="sz-prompt__cell" data-kind="blank" data-r2><span class="sz-prompt__py" data-r3>x</span></span></div></div><p class="sz-prompt__hint" data-r5>x</p></div>')],
  // 结果页：底栏文字按钮行（按钮 data-r、行 data-r2、主按钮 data-r3、底栏 data-r4）；没放进图里的一行（「放进图里」data-r、行主体 data-r2、状态字 data-r3、「修改 ›」data-r4、行 data-r5）
  ['resultFoot', R_PAGE('<div class="sz-page__foot" data-r4><div class="sz-result__textrow" data-r2><button class="sz-btn sz-btn--text sz-result__textbtn" data-r>x</button></div><button class="sz-btn sz-btn--primary" data-r3>x</button></div>')],
  ['exrow', R_PAGE('<div class="sz-exrows"><div class="sz-exrow" data-r5><button class="sz-exrow__open" data-r2><span class="sz-exrow__cell sz-exrow__cell--ax"></span><span class="sz-exrow__t" data-r3>x</span></button><button class="sz-btn sz-btn--text sz-line__change" data-r4>x</button><button class="sz-btn sz-btn--text" data-r>x</button></div></div>')],
  // 改判 / 对照弹层：「取消」（data-r）、「看这个字 ›」（data-r2）、主按钮（data-r3）
  ['change', '<div class="sz-sheet"><div class="sz-change"><button class="sz-btn sz-btn--text sz-change__cancel" data-r>x</button><button class="sz-btn sz-btn--text sz-change__view" data-r2>x</button><button class="sz-btn sz-btn--primary" data-r3>x</button></div></div>'],
  // 居中确认框（结束这组）：两键（次 data-r、主 data-r2）
  ['confirm', '<div class="sz-confirm"><div class="sz-confirm__actions"><button class="sz-btn sz-btn--secondary" data-r>x</button><button class="sz-btn sz-btn--primary" data-r2>x</button></div></div>'],
  // 跳过撤销条：「撤销」（data-r）、条（data-r2：内边距、行距、列距）
  ['undoBar', W_PAGE('<div class="sz-undobar sz-skipbar" data-r2><span class="sz-undobar__text"><span>x</span></span><button class="sz-btn sz-btn--text" data-r>x</button></div>')],
]);

function measureRole(doc, win, host, html) {
  host.innerHTML = html;
  const out = {};
  const px = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
  };
  const put = (k, v) => { if (v !== undefined) out[k] = v; };
  const main = host.querySelector('[data-r]');
  if (main) {
    const cs = win.getComputedStyle(main);
    put('fs', px(cs.fontSize));
    put('lh', px(cs.lineHeight));
    put('minH', px(cs.minHeight));
    put('padTop', px(cs.paddingTop));
    put('marginTop', px(cs.marginTop));
    put('marginLeft', px(cs.marginLeft));
    put('marginBottom', px(cs.marginBottom));
    const fw = Number(cs.fontWeight);
    if (Number.isFinite(fw)) out.weight = fw;
    put('h', px(main.getBoundingClientRect().height));
  }
  for (const n of [2, 3, 4, 5]) {
    const el = host.querySelector(`[data-r${n}]`);
    if (!el) continue;
    const cs = win.getComputedStyle(el);
    const rc = el.getBoundingClientRect();
    const sub = {};
    const sput = (k, v) => { if (v !== undefined) sub[k] = v; };
    sput('fs', px(cs.fontSize));
    sput('lh', px(cs.lineHeight));
    sput('minH', px(cs.minHeight));
    sput('padTop', px(cs.paddingTop));
    sput('marginTop', px(cs.marginTop));
    sput('w', px(rc.width));
    sput('h', px(rc.height));
    sput('gap', px(cs.rowGap));
    sput('colGap', px(cs.columnGap));
    sput('marginLeft', px(cs.marginLeft));
    sput('marginBottom', px(cs.marginBottom));
    const cols = String(cs.gridTemplateColumns || '').trim();
    if (cols && cols !== 'none') sub.cols = cols.split(/\s+/).length;
    out[`r${n}`] = sub;
  }
  return out;
}

/** 量网页 AX 档的逐元素取值；不在 AX 档 → {level: 0, roles: {}}；无 DOM → null。 */
export function axRoleBundle(win = globalWin()) {
  try {
    const doc = win.document;
    const root = doc.documentElement;
    const level = parseInt(root.getAttribute('data-ax'), 10) || 0;
    if (!level) return { level: 0, roles: {} };
    const host = doc.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;width:${win.innerWidth || 390}px`;
    (doc.querySelector('.sz-app') || doc.body).appendChild(host);
    const roles = {};
    for (const [name, html] of NATIVE_AX_ROLES) roles[name] = measureRole(doc, win, host, html);
    host.remove();
    return { level, roles };
  } catch (error) {
    return null;
  }
}

/**
 * 写字会话 API（页面侧）：src/session/write-api.js 的同一个实现，缺省注入网页路由（nav.back / openResult）与令牌颜色。
 * deps 可注入（node:test 用假 store / 假导航）。
 * @param {{getStore?: () => object, navigate?: {back: Function, toResult: Function}, colors?: () => object}} deps
 * @returns {{call(op:string, args?:object): object}}
 */
export function createWriteSessionApi(deps = {}) {
  return createSessionApi({
    ...deps,
    navigate: deps.navigate || {
      // 跳过的 5 秒撤销条还在时离开：剩余的撤销机会交给来源页 / 结果页（S4；网页写字页 leave / 写完最后一字同一组函数）
      back: (slot, undo) => {
        handoffLeaveUndo(undo ? { ...undo, slot, until: clockNow() + undo.remainingMs } : null);
        nav.back({ cause: 'native' });
      },
      toResult: (slot, sessionId, undo) => {
        handoffSkipUndo(undo ? { ...undo, slot, until: clockNow() + undo.remainingMs } : null);
        openResult(slot, sessionId);
      },
      // R9-B：改判弹层「看这个字 ›」（D66 ⑮）——写字条目留在栈里，字详情推入在它上面（网页 ViewCharLink 同一个 openCharDetail）；
      // 详情返回、写字条目重新成为顶层时，宿主再请原生盖上（NativeWriteHost 的路由订阅）。
      toDetail: (slot, char) => {
        const router = getRouter();
        const top = router ? router.getState().top : null;
        awayEntry = top && top.n === 'write' ? top.id : null;
        const ok = openCharDetail(char);
        if (!ok) awayEntry = null;
        return ok;
      },
      // B2.9a：原生重写错字页离开（‹ / 左缘右滑 / 最后一个字「完成」）——网页 RedoScreen 同为一次 nav.back，回到结果页（结果宿主再请原生淡入）
      redoBack: () => nav.back({ cause: 'native' }),
    },
    colors: deps.colors || (() => colorBundle()),
    type: deps.type || (() => typeBundle()),
    theme: deps.theme || (() => themeOf()),
    // B2.9b：参考字形的读屏名称（判断页参考卡 / 描一遍的答案字），网页 compare.js / answer.js 同一个 refCardLabel；笔顺数据先取到（判断页与描一遍网页也是数据就绪后读）
    refLabel: deps.refLabel || (async ({ char, cardKey }) => {
      let data = null;
      try { data = await loadStrokes(char); } catch (error) { data = null; }
      return refCardLabel({ char, py: pyOf(cardKey), strokeData: { status: data ? 'ready' : 'missing', data } });
    }),
    result: deps.result || RESULT_DEPS,
  });
}

/**
 * B2.7：原生结果页要页面给的东西（视图、导航、提醒权限、盖章声）。都是网页结果页同一批函数：
 *   view = native-view.js resultView；leave = leaveTo（R5-I2：来源是 tab 根且就在下面时 nav.back，否则跳回 tab 根）；
 *   again = 网页 again 的导航那一半（开组成功 → 就地换成写字页，D70：之后返回回首页；没有字 → 无字可写页）；
 *   toWrite = 撤销跳过成功后就地换回写字页；redo / detail = 推入重写错字 / 字详情（结果条目留在栈里，返回时宿主再请原生盖上）；
 *   share = 右上「分享」（网页这次的图片，B3 再换原生）；reminder = platform/reminder.js；seal = 盖章声 s1（同组只响一次）。
 */
const RESULT_DEPS = Object.freeze({
  view: (store, args) => resultView(store, args),
  leave: leave => leaveTo(leave),
  again: r => {
    if (r.started || r.occupied) nav.replace('write', { slot: 'A' }, { animate: true });
    else if (r.empty) nav.replace(NONE_SCREEN, { exhausted: !!r.libraryExhausted }, { animate: true });
    else nav.back();
  },
  toWrite: slot => nav.replace('write', { slot }, { animate: true }),
  redo: chars => {
    const list = redoCharsOf({ chars });
    if (!list.length) return false;
    nav.push('redo', { chars: list }); // = write/redo.js openRedo（普通推入）
    return true;
  },
  detail: char => openCharDetail(char),
  share: args => {
    const fn = resultImageAction();
    if (typeof fn !== 'function') return false;
    fn(args);
    return true;
  },
  reminder: { invite: inviteReminder, changeTime: inviteChangeTime },
  seal: key => {
    const play = () => keySound('seal', { key });
    if (!play()) warmSounds({ events: ['seal'] }).then(play, play);
  },
});

function clockNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

let installed = null;
/** R9-B：原生写字页为进字详情暂时让开时，写字条目的 id（返回到它时宿主重新请原生盖上）。 */
let awayEntry = null;


/** 装 window.shiziNativeWrite(op, args) → Promise<结果>（只在开关打开时；幂等）。B2.8 同时装导航助手 window.shiziNativeNav。 */
export function installNativeWrite(win = globalWin(), deps) {
  if (!win || !nativeWriteEnabled(win)) return null;
  if (!win.shiziNativeNav) win.shiziNativeNav = (op, args) => Promise.resolve(nativeNavCall(op, args, win));
  if (installed && win.shiziNativeWrite) return installed;
  installed = createWriteSessionApi(deps);
  win.shiziNativeWrite = (op, args) => Promise.resolve(installed.call(op, args));
  return installed;
}

// ---------------------------------------------------------------- B2.8 导航助手（只读 / 只管界面，不写 store）

/** 原生页让开（改判弹层「看这个字 ›」进字详情）时留在宿主层上的「样子」：slot → 原生页截图（data URL）。字详情推入 / 左缘滑回时露出的就是它。 */
const writeCovers = new Map();
const coverListeners = new Set();

function setWriteCover(slot, url) {
  if (url) writeCovers.set(slot, url);
  else writeCovers.delete(slot);
  for (const fn of [...coverListeners]) fn(slot);
}

function appRoot(win = globalWin()) {
  try {
    return win.document.querySelector('.sz-app');
  } catch (error) {
    return null;
  }
}

/**
 * window.shiziNativeNav(op, args)（B2.8，原生 NativeWriteTransitions 用；不写 store，所以不在写字会话 API 的 op 表里）：
 *   back  → {ok, plan, top}：顶层宿主条目回到下层页时该怎么走（网页左缘右滑同一个判定 planPaperDrag；plan = {mode:'paper', source, panel} | {mode:'quiet'} | {mode:'push'}，
 *           paper 的 source.rect 是被点元素此刻的位置（不在了：记下的位置、gone = true））；
 *   cover → {ok}：宿主层上放 / 收原生页的截图（args.url，空 = 收）；
 *   fence → {ok}：等页面画完下一帧（两次 requestAnimationFrame）——原生让开前确认网页已换好页，不露出中间状态。
 */
export function nativeNavCall(op, args = {}, win = globalWin()) {
  const a = args || {};
  if (op === 'back') {
    const router = getRouter();
    const st = router ? router.getState() : null;
    const pages = st ? st.stack.filter(e => e.k === 's') : [];
    const top = pages[pages.length - 1] || null;
    const under = pages[pages.length - 2] || null;
    return { ok: !!top, plan: nativeBackPlan(top, under, appRoot(win)), top: top ? top.n : null };
  }
  if (op === 'cover') {
    const slot = a.slot === 'B' ? 'B' : 'A';
    const url = typeof a.url === 'string' && a.url ? a.url : null;
    if (!url || !win || typeof win.Image !== 'function') {
      setWriteCover(slot, url);
      return { ok: true };
    }
    // 先解码好再放上去（回包之后原生才请页面推入字详情：推入第一帧下面就有图），解码慢也不多等一个 T-phase
    const img = new win.Image();
    img.src = url;
    const decoded = typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
    const late = new Promise(resolve => setTimeout(resolve, M.dur.fade));
    return Promise.race([decoded, late]).then(() => {
      setWriteCover(slot, url);
      return { ok: true };
    });
  }
  if (op === 'fence') {
    const raf = win && typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : fn => Promise.resolve().then(fn); // 没有画面（node）：不等
    return new Promise(resolve => raf(() => raf(() => resolve({ ok: true }))));
  }
  return { ok: false, error: { kind: 'invalid' } };
}

// ---------------------------------------------------------------- 宿主条目

/** 顶层写字条目是不是以原生页显示（root.js 用它让下层页保持可见、宿主层透明）。 */
export function isNativeHostEntry() {
  return nativeWriteEnabled();
}

/**
 * 写字页在开关打开时渲染的宿主：不画内容；成为顶层时请原生推入写字页（随消息带快照，原生首帧不等桥），卸载时请原生关掉。
 * animate：本条目是刚 push 进来的（有转场）——冷启动恢复 / 刷新时为 false，原生直接盖上、不做推入动画。
 */
export function NativeWriteHost({ params, entry }) {
  const slot = params && params.slot === 'B' ? 'B' : 'A';
  const sentRef = useRef(false);
  const [cover, setCover] = useState(() => writeCovers.get(slot) || null);
  useEffect(() => {
    const on = s => { if (s === slot) setCover(writeCovers.get(slot) || null); };
    coverListeners.add(on);
    on(slot);
    return () => coverListeners.delete(on);
  }, [slot]);
  // 布局阶段就发 open（B2.8）：消息先于这一帧网页的画面到原生，原生页盖上之前不露出透明宿主层下面的页面。
  useLayoutEffect(() => {
    installNativeWrite();
    const router = getRouter();
    const snap = router ? router.getState() : null;
    const tr = snap ? snap.transition : null;
    const animate = !!(tr && tr.to && entry && tr.to.id === entry.id && tr.animate && !tr.cold);
    // D62（B2.8）：转场按网页记账的计划定——首页入口 = 纸展开（home，带被点元素的矩形）、屏上没有来源元素的入口 = 安静淡入（quiet）、
    // 其他点按入口 = 推入（push）；结果页「再写一组」/ 撤销跳过换成写字页 = again（推入，结果页的样子留在下面）；冷启动恢复没有转场（restore）。
    const plan = entry ? nativePlanOf(entry.id) : null;
    const replaced = !!(tr && tr.kind === 'replace' && tr.from && tr.from.n === 'result');
    const via = !animate ? 'restore' : replaced ? 'again' : plan && plan.mode === 'paper' ? 'home' : plan && plan.mode === 'quiet' ? 'quiet' : 'push';
    let api = null;
    try {
      api = createWriteSessionApi();
    } catch (error) {
      api = null;
    }
    const opened = api ? api.call('open', { slot }) : { ok: false };
    sentRef.current = postNative('nativeWrite', { op: 'open', slot, entryId: entry ? entry.id : null, animate, via, plan, sentAt: Date.now(), payload: opened });
    // R9-B：从字详情返回（写字条目重新成为顶层）→ 再请原生盖上（via 'return'）。B2.8：等网页自己的返回转场放完（字详情滑出时露出的是宿主层上的原生页截图），
    // 原生不带转场直接盖上，随后收掉截图。
    let waiting = false;
    let cancelWait = null;
    let coverTimer = null;
    const off = router && typeof router.subscribe === 'function' ? router.subscribe(() => {
      const top = router.getState().top;
      if (!entry || awayEntry !== entry.id || !top || top.id !== entry.id || waiting) return;
      waiting = true;
      cancelWait = whenNavIdle(() => {
        cancelWait = null;
        waiting = false;
        const now = router.getState().top;
        if (awayEntry !== entry.id || !now || now.id !== entry.id) return;
        awayEntry = null;
        const again = api ? api.call('open', { slot }) : { ok: false };
        sentRef.current = postNative('nativeWrite', { op: 'open', slot, entryId: entry.id, animate: false, via: 'return', sentAt: Date.now(), payload: again }) || sentRef.current;
        clearTimeout(coverTimer);
        coverTimer = setTimeout(() => setWriteCover(slot, null), RETURN_COVER_MS);
      });
    }) : null;
    return () => {
      if (off) off();
      if (cancelWait) cancelWait();
      clearTimeout(coverTimer);
      setWriteCover(slot, null);
      if (sentRef.current) postNative('nativeWrite', { op: 'close', slot, entryId: entry ? entry.id : null });
    };
  }, [entry && entry.id]);
  return html`<div data-testid="write-native-host" data-slot=${slot} style=${HOST_STYLE}>
    ${cover ? html`<img src=${cover} alt="" aria-hidden="true" style=${COVER_STYLE} />` : null}
  </div>`;
}

/** 原生页回来盖上之后多久收掉宿主层上的截图（它在原生页下面，看不见；留一会儿防原生页还没盖上时露出下层）。 */
const RETURN_COVER_MS = M.role.pushIn + M.dur.fade;
const HOST_STYLE = 'position:absolute;inset:0;pointer-events:none';
const COVER_STYLE = 'position:absolute;inset:0;width:100%;height:100%;display:block';

/**
 * B2.9a：重写错字页在开关打开时渲染的宿主（与写字页宿主同一种做法）：不画内容；挂载时请原生推入原生重写错字页
 * （随消息带整理后的字表、第一个字的快照与外观，原生首帧不等桥），卸载时请原生关掉（深链 / store 整体替换等把条目卸掉时原生跟着离开）。
 * 原生离开（‹ / 左缘右滑 / 完成）发 redoExit → nav.back 回结果页。没有能练的字时与网页页面同样退回去。
 */
export function NativeRedoHost({ params, entry }) {
  // 布局阶段就发 redo-open（B2.8）：与结果宿主的 result-close 同一帧到原生，结果页的样子直接当推入的下层
  useLayoutEffect(() => {
    installNativeWrite();
    const router = getRouter();
    const tr = router ? router.getState().transition : null;
    const animate = !!(tr && tr.to && entry && tr.to.id === entry.id && tr.animate && !tr.cold);
    let api = null;
    try {
      api = createWriteSessionApi();
    } catch (error) {
      api = null;
    }
    const opened = api ? api.call('redoOpen', { chars: params && params.chars }) : { ok: false };
    if (!opened || !opened.ok) {
      nav.back();
      return undefined;
    }
    const entryId = entry ? entry.id : null;
    const sent = postNative('nativeWrite', { op: 'redo-open', entryId, animate, via: animate ? 'push' : 'restore', sentAt: Date.now(), payload: opened });
    return () => {
      if (sent) postNative('nativeWrite', { op: 'redo-close', entryId });
    };
  }, [entry && entry.id]);
  return html`<div data-testid="redo-native-host"></div>`;
}

// ---------------------------------------------------------------- B2.7 结果页宿主

function clientWidth(win = globalWin()) {
  try {
    return win.document.documentElement.clientWidth || 0;
  } catch (error) {
    return 0;
  }
}

function axNow(win = globalWin()) {
  try {
    return win.document.documentElement.hasAttribute('data-ax');
  } catch (error) {
    return false;
  }
}

function inStack(entryId) {
  const router = getRouter();
  return !!(router && entryId && router.getState().stack.some(e => e.id === entryId));
}

/** 结果条目为进重写错字 / 字详情 / 分享暂时让开（还在栈里）：再成为顶层时宿主带 via 'return' 请原生淡入。 */
let awayResult = null;

/**
 * B2.8：让开过（推入重写错字 / 字详情、开网页分享弹层）的结果条目。回到顶层后先保持网页结果页，等网页自己的返回转场 / 弹层退场放完，
 * 才换回原生（宿主发 result-open via 'return'，原生不带转场直接盖上）——返回转场里露出的是网页结果页本身，不是透明宿主层下面的首页。
 */
const deferredResults = new Set();

/** 结果条目此刻该不该由原生显示：它是顶层页且上面没有网页弹层（分享等网页弹层开着时显示网页结果页，让弹层盖在它上面），且不在「让开后等回来」。 */
export function nativeResultShown(entry, snap) {
  if (!nativeWriteEnabled() || !entry) return false;
  const st = snap || (getRouter() ? getRouter().getState() : null);
  if (!st) return false;
  return !!(st.top && st.top.id === entry.id && !st.topIsOverlay && !deferredResults.has(entry.id));
}

/** 离开页面栈时这一层是不是原生结果页（原生已自己滑走 / 缩回：网页不再播；还在网页版时照常播）。 */
export function nativeResultLeaving(entry) {
  return nativeWriteEnabled() && !(entry && deferredResults.has(entry.id));
}

/**
 * 结果条目由原生还是网页显示（ResultEntry 用）：顶层且没有网页弹层 → 原生宿主；让开时 → 网页结果页（推入 / 弹层盖在它上面）；
 * 回到顶层 → 等网页转场空闲（弹层关掉时再等它的退场 sheetOut）后换回原生；已离开页面栈（返回转场里的旧层）→ 透明宿主。
 */
export function useNativeResultHosted(entry) {
  const enabled = nativeWriteEnabled();
  const decide = () => !!entry && (nativeResultShown(entry) || !inStack(entry.id));
  const [hosted, setHosted] = useState(() => enabled && decide());
  useEffect(() => {
    if (!enabled || !entry) return undefined;
    const router = getRouter();
    if (!router) return undefined;
    const id = entry.id;
    let overlayWas = false;
    let scheduled = false;
    let cancel = null;
    let timer = null;
    const update = () => {
      const st = router.getState();
      const inS = st.stack.some(e => e.id === id);
      const top = !!(st.top && st.top.id === id);
      const clear = top && !st.topIsOverlay;
      if (top && st.topIsOverlay) overlayWas = true;
      if (inS && !clear && !deferredResults.has(id)) deferredResults.add(id);
      if (inS && clear && deferredResults.has(id) && !scheduled) {
        scheduled = true;
        const wait = overlayWas ? M.role.sheetOut : 0;
        overlayWas = false;
        cancel = whenNavIdle(() => {
          cancel = null;
          timer = setTimeout(() => {
            timer = null;
            scheduled = false;
            const s2 = router.getState();
            if (!(s2.top && s2.top.id === id && !s2.topIsOverlay)) return;
            deferredResults.delete(id);
            notifyNativeHostChange();
          }, wait);
        });
      }
      setHosted(decide());
    };
    update();
    const offRouter = router.subscribe(update);
    const offHost = onNativeHostChange(update);
    return () => {
      offRouter();
      offHost();
      if (cancel) cancel();
      clearTimeout(timer);
      if (!inStack(id)) deferredResults.delete(id);
    };
  }, [enabled, entry && entry.id]);
  return enabled && hosted;
}

/**
 * 结果页在开关打开时渲染的宿主（B2.7）：不画内容；成为顶层时请原生盖上原生结果页（随消息带视图与外观，原生首帧不等桥），
 * 卸载时请原生关掉。写字页交接来的跳过撤销机会在这里取走（取一次即清），随视图交给原生。
 */
export function NativeResultHost({ params, entry }) {
  const slot = params && params.slot === 'B' ? 'B' : 'A';
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : '';
  // 布局阶段就发 result-open（B2.8）：原生页先于网页这一帧的画面盖上。
  useLayoutEffect(() => {
    // 已离开页面栈的条目（返回转场里留着的旧层）：只保持透明，不再请原生
    if (!entry || !inStack(entry.id)) return undefined;
    installNativeWrite();
    const router = getRouter();
    const tr = router ? router.getState().transition : null;
    const returning = awayResult === entry.id;
    awayResult = null;
    const restore = !returning && !!(tr && (tr.cold || tr.cause === 'restore' || tr.cause === 'start' || !tr.animate) && !(tr.from && tr.from.n === 'write'));
    const via = returning ? 'return' : restore ? 'restore' : tr && tr.from && tr.from.n === 'write' ? 'write' : 'push';
    let api = null;
    try {
      api = createWriteSessionApi();
    } catch (error) {
      api = null;
    }
    const undo = takeSkipUndo(slot, sessionId);
    const look = api ? api.call('resultLook', {}) : { ok: false };
    const opened = api ? api.call('result', { slot, sessionId, width: clientWidth(), ax: axNow(), undo }) : { ok: false };
    const sent = postNative('nativeWrite', { op: 'result-open', slot, sessionId, entryId: entry.id, animate: !restore, via, sentAt: Date.now(), look, payload: opened });
    return () => {
      if (sent) postNative('nativeWrite', { op: 'result-close', slot, sessionId, entryId: entry.id, away: inStack(entry.id) });
      if (inStack(entry.id)) {
        awayResult = entry.id;
        return;
      }
      // 被移出页面栈（离开 / 再写一组 / 撤销跳过）→ 清 lastEnded[slot]（01 §3.3，与网页结果页卸载时同一个 commitLeave）
      try {
        commitLeave(getStore(), { slot, sessionId });
      } catch (error) {
        // 清不掉不影响（下次开同槽时一并清）
      }
    };
  }, [entry && entry.id]);
  return html`<div data-testid="result-native-host" data-slot=${slot}></div>`;
}

installNativeWrite();
