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
// 开关：只在 iOS DEBUG 壳、启动参数 -shizi-native-write（SHIZI_NATIVE_WRITE=1）时，原生在文档开始注入 window.__shiziNativeWrite = true；
// 默认关，关着时本模块什么都不装、写字页与正式流程完全相同。

import { html, useEffect, useRef } from '../../../../vendor/ui.js';
import { getRouter, nav } from '../../router.js';
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

/** 开关：iOS DEBUG 壳注入了 __shiziNativeWrite 且在原生壳内。 */
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
  return out;
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


/** 装 window.shiziNativeWrite(op, args) → Promise<结果>（只在开关打开时；幂等）。 */
export function installNativeWrite(win = globalWin(), deps) {
  if (!win || !nativeWriteEnabled(win)) return null;
  if (installed && win.shiziNativeWrite) return installed;
  installed = createWriteSessionApi(deps);
  win.shiziNativeWrite = (op, args) => Promise.resolve(installed.call(op, args));
  return installed;
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
  useEffect(() => {
    installNativeWrite();
    const router = getRouter();
    const snap = router ? router.getState() : null;
    const tr = snap ? snap.transition : null;
    const animate = !!(tr && tr.to && entry && tr.to.id === entry.id && tr.animate && !tr.cold);
    // D62：从首页进来（纸展开 / 缩回）与其他入口（推入 / 滑出）的转场不同；冷启动恢复没有转场。
    const via = !animate ? 'restore' : tr.from && tr.from.n === 'home' ? 'home' : 'push';
    let api = null;
    try {
      api = createWriteSessionApi();
    } catch (error) {
      api = null;
    }
    const opened = api ? api.call('open', { slot }) : { ok: false };
    sentRef.current = postNative('nativeWrite', { op: 'open', slot, entryId: entry ? entry.id : null, animate, via, sentAt: Date.now(), payload: opened });
    // R9-B：从字详情返回（写字条目重新成为顶层）→ 再请原生盖上（via 'return'：原生淡入，笔画 / 结果行从快照恢复）
    const off = router && typeof router.subscribe === 'function' ? router.subscribe(() => {
      const top = router.getState().top;
      if (!entry || awayEntry !== entry.id || !top || top.id !== entry.id) return;
      awayEntry = null;
      const again = api ? api.call('open', { slot }) : { ok: false };
      sentRef.current = postNative('nativeWrite', { op: 'open', slot, entryId: entry.id, animate: true, via: 'return', sentAt: Date.now(), payload: again }) || sentRef.current;
    }) : null;
    return () => {
      if (off) off();
      if (sentRef.current) postNative('nativeWrite', { op: 'close', slot, entryId: entry ? entry.id : null });
    };
  }, [entry && entry.id]);
  return html`<div data-testid="write-native-host" data-slot=${slot}></div>`;
}

/**
 * B2.9a：重写错字页在开关打开时渲染的宿主（与写字页宿主同一种做法）：不画内容；挂载时请原生推入原生重写错字页
 * （随消息带整理后的字表、第一个字的快照与外观，原生首帧不等桥），卸载时请原生关掉（深链 / store 整体替换等把条目卸掉时原生跟着离开）。
 * 原生离开（‹ / 左缘右滑 / 完成）发 redoExit → nav.back 回结果页。没有能练的字时与网页页面同样退回去。
 */
export function NativeRedoHost({ params, entry }) {
  useEffect(() => {
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

/** 结果条目此刻该不该由原生显示：它是顶层页且上面没有网页弹层（分享等网页弹层开着时显示网页结果页，让弹层盖在它上面）。 */
export function nativeResultShown(entry, snap) {
  if (!nativeWriteEnabled() || !entry) return false;
  const st = snap || (getRouter() ? getRouter().getState() : null);
  if (!st) return false;
  return !!(st.top && st.top.id === entry.id && !st.topIsOverlay);
}

/**
 * 结果页在开关打开时渲染的宿主（B2.7）：不画内容；成为顶层时请原生盖上原生结果页（随消息带视图与外观，原生首帧不等桥），
 * 卸载时请原生关掉。写字页交接来的跳过撤销机会在这里取走（取一次即清），随视图交给原生。
 */
export function NativeResultHost({ params, entry }) {
  const slot = params && params.slot === 'B' ? 'B' : 'A';
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : '';
  useEffect(() => {
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
