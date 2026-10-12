// 原生书写面 spike 的网页侧接线（P1-S2；I3-13 / I2-12）。只在 DEBUG 原生壳以 -shizi-native-ink 启动时生效：
// Swift 在文档开始时注入 window.__shiziNativeInk = true（ios/ShiziApp/ShiziApp/NativeInkSpike.swift）。没有这个标记时本模块什么都不做，
// ink-canvas.js 的网页书写完全照旧。
//
// 开关开启时（只接写字页那一个可写的书写格，InkGrid testid=write-grid）：
//   - 网页的固化层与当前笔层画布隐藏（仍在 DOM 里、仍照常 paintFinal，便于关掉开关后无差别），网页指针输入不再落笔；
//   - 每一帧（rAF）量当前笔层的 getBoundingClientRect，连同显隐、能否落笔、墨色、固化层不透明度，变化时发给原生
//     postMessage({type:'nativeInk', op:'rect', …})——原生把书写层叠到同一位置（滚动、转场、弹层遮挡都靠这一路同步或隐藏）；
//   - 页面 strokes 变化时 op:'strokes' 发全量原始笔（345 单位、t、p），原生按它重画已完成的笔（撤销 / 清空 / 换字 / 刷新恢复）；
//   - 换字 / 换阶段丢弃正在写的一笔：op:'cancel'。
// 原生 → 页面：window.shiziNativeInk({kind, …})
//   kind:'start'  落笔（页面照 acceptFrom 门限持住或立即 onStrokeStart，与网页 onDown / release 同语义）；
//   kind:'end'    抬笔，raw = [[x, y, t, p?], …]（t 是原生 UITouch.timestamp ms，按 nowNative 换算到页面 performance.now 时基）——
//                 页面照网页 onUp 的路径：painted 追加、paintFinal、onStrokeEnd(raw) → 写字页照常 store.commit；
//   kind:'cancel' 原生丢弃了正在写的一笔（触摸被系统取消、被隐藏等）→ onStrokeCancel。
// 判断落定原型（时刻编排 ② M23）：点「写对了 / 写错了」时把本人笔迹的格子与页头计数的位置发给原生 op:'settle'，由原生画「收起」并同帧发触觉。

import { M } from '../../config/motion.js';
const MSG = 'nativeInk';

function channel(win) {
  try {
    const h = win && win.webkit && win.webkit.messageHandlers;
    return h && h.shiziNative && typeof h.shiziNative.postMessage === 'function' ? h.shiziNative : null;
  } catch (error) {
    return null;
  }
}

/** 是否走原生书写面（DEBUG 原生壳 + 启动参数）。 */
export function nativeInkEnabled(win) {
  return !!(win && win.__shiziNativeInk === true && channel(win));
}

function post(win, payload) {
  const ch = channel(win);
  if (!ch) return false;
  try {
    ch.postMessage(Object.assign({ type: MSG }, payload));
    return true;
  } catch (error) {
    return false;
  }
}

function clockNow(win) {
  const perf = win && win.performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

/** 原生原始点（时基 nowNative）→ 页面原始点 {x, y, t, p?}（时基 performance.now）。纯函数，单测用。 */
export function fromNativeRaw(rows, nowNative, nowPage) {
  const shift = Number.isFinite(nowNative) && Number.isFinite(nowPage) ? nowPage - nowNative : 0;
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(r) || r.length < 3) continue;
    const [x, y, t, p] = r;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) continue;
    const q = { x, y, t: t + shift };
    if (Number.isFinite(p) && p > 0) q.p = Math.min(1, p);
    out.push(q);
  }
  return out;
}

/** 页面原始笔 → 发给原生的紧凑数组 [[x, y, t, p?], …]。 */
export function toNativeRaw(strokes) {
  return (Array.isArray(strokes) ? strokes : []).map(raw => (Array.isArray(raw) ? raw : []).map(q => (Number.isFinite(q.p) && q.p > 0 ? [q.x, q.y, q.t, q.p] : [q.x, q.y, q.t])));
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** 书写格是否真的在最上层可见：中心与四角（内缩 3px）命中的元素都在格子里（弹层、提示条盖住时隐藏原生层）。 */
function unobstructed(win, box, r) {
  const doc = win.document;
  if (!doc || typeof doc.elementFromPoint !== 'function') return true;
  const pts = [[r.x + r.w / 2, r.y + r.h / 2], [r.x + 3, r.y + 3], [r.x + r.w - 3, r.y + 3], [r.x + 3, r.y + r.h - 3], [r.x + r.w - 3, r.y + r.h - 3]];
  for (const [x, y] of pts) {
    const hit = doc.elementFromPoint(x, y);
    if (!hit || !box.contains(hit)) return false;
  }
  return true;
}

let active = null; // 当前接管的书写格（同一时刻只有一个）
let lastStrokes = []; // 最近一次同步给原生的笔（判断落定原型用）
let settleInstalled = false;

function installSettle(win) {
  if (settleInstalled || !win.document) return;
  settleInstalled = true;
  win.document.addEventListener('click', e => {
    if (!nativeInkEnabled(win)) return;
    const btn = e.target && e.target.closest ? e.target.closest('[data-testid="write-judge-correct"], [data-testid="write-judge-wrong"]') : null;
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
    const mine = win.document.querySelector('[data-testid="write-compare-mine"] canvas') || win.document.querySelector('[data-testid="write-compare-mine"]');
    const counter = win.document.querySelector('[data-testid="write-progress"]');
    if (!mine || !lastStrokes.length) return;
    const from = rectOf(mine);
    const to = counter ? rectOf(counter) : null;
    post(win, {
      op: 'settle',
      judgment: btn.getAttribute('data-testid') === 'write-judge-wrong' ? 'wrong' : 'correct',
      from,
      to,
      strokes: toNativeRaw(lastStrokes),
      reduceMotion: !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches),
    });
    // 墨在第 0 帧离开纸面：网页小卡上的同一笔迹立即隐去，由原生层接着画（时刻编排 ② ink.o 0→0 @ t=0）
    const card = win.document.querySelector('[data-testid="write-compare-mine"]');
    if (card) card.style.visibility = 'hidden';
  }, true);
}

/**
 * 接管一个书写格（ink-canvas.js createInkSurface 在开关开启时调用）。
 * @param {object} o
 * @param {HTMLElement} o.box
 * @param {HTMLCanvasElement} o.inkCanvas
 * @param {HTMLCanvasElement} o.liveCanvas
 * @param {Window} o.win
 * @param {() => object} o.getProps  {drawable, acceptFrom, onStrokeStart, onStrokeCancel}
 * @param {(raw:Array) => void} o.onEnd  抬笔：页面照网页 onUp 收尾（painted、paintFinal、onStrokeEnd）
 * @param {() => string} o.inkColor
 */
export function attachNativeInk({ box, inkCanvas, liveCanvas, win, getProps, onEnd, inkColor }) {
  installSettle(win);
  const prevInk = inkCanvas.style.visibility;
  const prevLive = liveCanvas.style.opacity;
  inkCanvas.style.visibility = 'hidden';
  liveCanvas.style.opacity = '0';
  let writing = false; // 原生正在写一笔（页面视角）
  let held = null; // {timer}：acceptFrom 之前落下的笔，到点补 onStrokeStart
  let raf = 0;
  let sent = '';
  let destroyed = false;

  function startNow() {
    if (held) {
      win.clearTimeout(held.timer);
      held = null;
    }
    const p = getProps();
    if (typeof p.onStrokeStart === 'function') p.onStrokeStart();
  }

  function onNative(msg) {
    if (destroyed || !msg || typeof msg !== 'object') return false;
    const p = getProps();
    if (msg.kind === 'start') {
      if (!p.drawable) return false;
      writing = true;
      const now = clockNow(win);
      if (Number.isFinite(p.acceptFrom) && now < p.acceptFrom) {
        const timer = win.setTimeout(() => {
          if (held && held.timer === timer) startNow();
        }, Math.max(0, p.acceptFrom - now));
        held = { timer };
      } else startNow();
      return true;
    }
    if (msg.kind === 'end') {
      if (!writing) return false; // 页面已丢弃这一笔（换字 / 换阶段），与网页 cancelCurrent 后的抬笔同样不固化
      writing = false;
      if (held) startNow(); // 早于门限抬起：先补开始，再整笔固化（P227）
      const raw = fromNativeRaw(msg.raw, msg.nowNative, clockNow(win));
      if (!raw.length) return false;
      onEnd(raw);
      return true;
    }
    if (msg.kind === 'cancel') {
      if (!writing) return false;
      writing = false;
      if (held) {
        win.clearTimeout(held.timer);
        held = null;
      }
      if (typeof p.onStrokeCancel === 'function') p.onStrokeCancel(msg.reason || 'cancel');
      return true;
    }
    return false;
  }

  function measure() {
    raf = 0;
    if (destroyed) return;
    const p = getProps();
    const r = rectOf(liveCanvas);
    const doc = win.document;
    const shown = !!(box.isConnected && r.w > 0 && r.h > 0 && !(doc && doc.visibilityState === 'hidden') && unobstructed(win, box, r));
    let opacity = 1;
    try {
      opacity = Number(win.getComputedStyle(inkCanvas).opacity);
    } catch (error) {
      opacity = 1;
    }
    const state = { op: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, visible: shown, drawable: !!p.drawable, color: inkColor(), opacity: Number.isFinite(opacity) ? opacity : 1 };
    const key = JSON.stringify(state);
    if (key !== sent) {
      sent = key;
      post(win, state);
    }
    raf = win.requestAnimationFrame(measure);
  }

  win.shiziNativeInk = onNative;
  active = { onNative };
  if (typeof win.requestAnimationFrame === 'function') raf = win.requestAnimationFrame(measure);

  return {
    /** 页面 strokes（全量）→ 原生。 */
    strokes(list) {
      lastStrokes = Array.isArray(list) ? list.slice() : [];
      post(win, { op: 'strokes', strokes: toNativeRaw(lastStrokes) });
    },
    /** 页面丢弃正在写的一笔：原生丢弃，页面照常 onStrokeCancel。返回是否有笔被丢弃。 */
    cancel(reason) {
      if (!writing) return false;
      writing = false;
      if (held) {
        win.clearTimeout(held.timer);
        held = null;
      }
      post(win, { op: 'cancel', reason });
      const p = getProps();
      if (typeof p.onStrokeCancel === 'function') p.onStrokeCancel(reason);
      return true;
    },
    isWriting: () => writing,
    destroy() {
      destroyed = true;
      if (raf && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(raf);
      raf = 0;
      if (held) win.clearTimeout(held.timer);
      held = null;
      inkCanvas.style.visibility = prevInk;
      liveCanvas.style.opacity = prevLive;
      // 书写格卸载（写好了 → 对照、换页）：页面阶段交叉淡化 150ms（phase-fade.js FADE_MS）的快照里网页墨是隐藏的，
      // 所以由原生层把自己的墨在同样 150ms 里淡出，而不是第 0 帧消失
      post(win, { op: 'rect', visible: false, fadeMs: M.role.fadeOut }); // 减少动态效果下同样是 150ms（motion.duration.reduce = fade）
      if (active && active.onNative === onNative) {
        active = null;
        if (win.shiziNativeInk === onNative) win.shiziNativeInk = undefined;
      }
    },
  };
}
