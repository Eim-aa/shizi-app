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
import { handoffSkipUndo, openResult } from '../result/index.js';
import { handoffLeaveUndo } from './skip.js';
import { openCharDetail } from '../detail/open.js';
import {
  createWriteSessionApi as createSessionApi, writeSnapshot, strokesToWire, strokesFromWire, copyBundle, NATIVE_WRITE_COPY_KEYS, NATIVE_WRITE_OPS,
} from '../../../session/write-api.js';

// B2.1：op 表、快照、笔画格式、文案字典与 API 本体挪到 src/session/write-api.js（无 DOM）；这里原名转出，原导入路径照旧可用。
export { writeSnapshot, strokesToWire, strokesFromWire, copyBundle, NATIVE_WRITE_COPY_KEYS, NATIVE_WRITE_OPS };

/** 原生要的颜色令牌（取页面此刻计算值：浅 / 深色与网页同源，见 tokens.css）。 */
export const NATIVE_WRITE_COLOR_TOKENS = Object.freeze(['paper', 'hand', 'ref', 'frame', 'line', 'ink1', 'ink2', 'ink3', 'ink4', 'field', 'danzhu', 'toast-bg', 'toast-fg', 'scrim', 'elev', 'sheet', 'btn-bg', 'btn-fg', 'guide']);

/** R9-B：原生要的字阶令牌（--fs13 / --lh13 …，取页面此刻计算值，pt；系统字号连续倍率 --k 与 AX 档取值表都在 tokens.css，原生不抄表）。 */
export const NATIVE_WRITE_TYPE_TOKENS = Object.freeze(['fs13', 'lh13', 'fs15', 'lh15', 'fs17', 'lh17', 'lh17s', 'fs22', 'lh22', 'fs28', 'btn-h']);

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
    },
    colors: deps.colors || (() => colorBundle()),
    type: deps.type || (() => typeBundle()),
  });
}

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

installNativeWrite();
