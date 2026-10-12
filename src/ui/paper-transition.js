// 写字页的进出动效（W2，D57，P282–P284；设计稿「写字页与我的.html」B 节）：B1「按钮长成这张纸」、B3「安静淡入」、减少动态效果的 150ms 淡化。
//
// 进出共用同一个进度 s（1 = 写字页整屏，0 = 来源按钮 / 首页）：
//   · 点按：s 按曲线走（进入 420ms、退出 360ms），纯 requestAnimationFrame 逐帧调用 frame(s)——和手势是同一个函数，没有两套动画；
//   · 左缘右滑（R4-G1 的进度接口 router.beginBack / setBackProgress / endBack / finishBack / cancelBack，由 root.js 的 BACK_TRANSITION 转给这里）：
//     s = 1 − 手指进度 p，逐帧跟手；松手完成 = 从当前 s 继续收进来源（300ms × s，至少 120ms），取消 = 220ms 长回整屏。
//
// 来源（共享元素）：首页「开始写字 / 继续写字 / 再写一组」按钮点下时 markPaperSource(按钮, 'home-start') 记下它的矩形、字和圆角；
// 页面真正推入时（root.js 渲染期 planPaper）取走，记在「下层页面」名下，返回时按钮若还在就重新量一次它的位置（版面可能变了），不在就用记下的。
// 没有来源按钮的入口（通知、字库「练这个字」、自选字……）走 B3：220ms 首页先淡出、写字页再淡入并从 0.96 放大到 1；退出 180ms 反向。
// 减少动态效果：一律 150ms 交叉淡化（写字页透明度 s，首页留在下面不动），不缩放、不位移；左缘右滑不跟手，松手按阈值完成后淡化（router 控制器 follow=false）。
//
// 图层结构不变：写字页仍是 root.js 的一个 .sz-layer；B1 期间改它的 left / top / width / height / border-radius（把层变成一张「纸」），层里的 .sz-layer__screen 固定成整屏大小再 scale——
// 页面本身的版面一帧都不重排（写字页的 ResizeObserver 量到的尺寸始终是整屏）。动画结束后清掉全部内联样式，回到普通图层。
// 每帧写 layer 的 data-paper-s（进度，测试用）。纯逻辑（曲线、每帧样式）不依赖 DOM 以外的东西，e2e 用 rAF 采样断言。

import * as policy from '../config/policy.js';
import { T } from './components/styles.js';

const P = policy.paperTransition;

// ---------------------------------------------------------------- 曲线

/** cubic-bezier(x1, y1, x2, y2) 的求值函数 t → y（与 CSS 同一条曲线；二分求参数）。 */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const X = u => ((ax * u + bx) * u + cx) * u;
  const Y = u => ((ay * u + by) * u + cy) * u;
  return t => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let u = t;
    for (let i = 0; i < 28; i += 1) {
      u = (lo + hi) / 2;
      if (X(u) < t) lo = u;
      else hi = u;
    }
    return Y(u);
  };
}

export const OPEN_EASE = cubicBezier(...P.openEase);
export const CLOSE_EASE = cubicBezier(...P.closeEase);
const LINEAR = t => Math.min(1, Math.max(0, t));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/** 一帧最多让进度前进这么久（ms）：主线程卡顿时动画顺着走，不跳帧。 */
export const MAX_FRAME_MS = 50;

// ---------------------------------------------------------------- 来源按钮

let pending = null; // {rect, label, radius, key, at}
const sources = new Map(); // 下层页面 entry id → {rect, label, radius, key}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function radiusOf(el) {
  try {
    const v = parseFloat(getComputedStyle(el).borderTopLeftRadius);
    return Number.isFinite(v) ? v : 12;
  } catch (error) {
    return 12;
  }
}

/**
 * 记下「这次是从哪个按钮进写字页的」（点击时调用，下一次推入写字页时取走；超过 policy.paperTransition.sourceFreshMs 作废）。
 * 按钮要带 data-paper-source=key，返回时靠它在首页里重新找到按钮。
 */
export function markPaperSource(el, key) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return;
  const rect = rectOf(el);
  if (!(rect.w > 0 && rect.h > 0)) return;
  pending = { rect, label: (el.textContent || '').trim(), radius: radiusOf(el), key, at: nowMs() };
}

function takePending() {
  const p = pending;
  pending = null;
  return p && nowMs() - p.at <= P.sourceFreshMs ? p : null;
}

/** 测试用：清掉记下的来源。 */
export function resetPaperSources() {
  pending = null;
  sources.clear();
}

export function hasPaperSource(entryId) {
  return sources.has(entryId);
}

// ---------------------------------------------------------------- 计划（哪种动效、从哪到哪）

/**
 * 根据一次转场决定动效。返回 null（沿用默认横推）或 {mode, dir, source, …}：
 *   mode 'B1' | 'B3' | 'R'（减少动态效果）；dir 'open' | 'close'；source = {rect, label, radius, key}（B1）。
 * 只管「进写字页」与「写字页 / 结果页回到记着来源的页面」；其它页面的 push / pop 不在范围内（保持横推）。
 * @param {{kind:string, from:object, to:object}} t  router 的 transition
 * @param {{reduced:boolean, root:Element|null}} o
 */
export function planPaper(t, { reduced, root }) {
  if (!t || !t.from || !t.to) return null;
  if (t.kind === 'push') {
    if (t.to.n !== 'write') {
      sources.delete(t.from.id);
      return null;
    }
    const src = takePending();
    if (src) sources.set(t.from.id, src);
    else sources.delete(t.from.id);
    if (reduced) return { mode: 'R', dir: 'open' };
    return src ? { mode: 'B1', dir: 'open', source: src } : { mode: 'B3', dir: 'open' };
  }
  if (t.kind === 'pop') {
    if (t.from.n !== 'write' && t.from.n !== 'result') return null;
    const had = sources.get(t.to.id);
    if (t.from.n === 'result' && !had) return null; // 不是从写字页过来的结果页（练习记录里打开的）：保持横推
    sources.delete(t.to.id);
    if (reduced) return { mode: 'R', dir: 'close' };
    if (!had) return t.from.n === 'write' ? { mode: 'B3', dir: 'close' } : null;
    return { mode: 'B1', dir: 'close', source: liveSource(had, t.to.id, root) };
  }
  return null;
}

/** 返回时按钮若还在首页里，重新量一次它的位置和字（首页版面 / 按钮文字可能变了：「开始写字」→「继续写字」）。 */
function liveSource(src, underId, root) {
  const under = root ? root.querySelector(`.sz-layer[data-entry="${underId}"]`) : null;
  const btn = under ? under.querySelector(`[data-paper-source="${src.key}"]`) : null;
  if (!btn) return src;
  const rect = rectOf(btn);
  if (!(rect.w > 0 && rect.h > 0)) return src;
  return { ...src, rect, label: (btn.textContent || '').trim() || src.label, radius: radiusOf(btn) };
}

/** 左缘右滑开始时的计划：顶层是写字页 / 记着来源的结果页，下层是它的来源页。没有来源的写字页走 B3，其它返回 null（横推）。 */
export function planPaperDrag(topEntry, underEntry, root) {
  if (!topEntry || !underEntry) return null;
  const had = sources.get(underEntry.id);
  if (topEntry.n === 'write') return had ? { mode: 'B1', dir: 'close', drag: true, source: liveSource(had, underEntry.id, root) } : { mode: 'B3', dir: 'close', drag: true };
  if (topEntry.n === 'result' && had) return { mode: 'B1', dir: 'close', drag: true, source: liveSource(had, underEntry.id, root) };
  return null;
}

// ---------------------------------------------------------------- 每帧样式

const restores = new WeakMap(); // 元素 → 清理函数

function remember(el, fn) {
  if (!restores.has(el)) restores.set(el, []);
  restores.get(el).push(fn);
}

/** 清掉某个元素上动效写下的全部内联样式 / 附加节点（动画结束、手势取消、转场被打断都走这里）。 */
export function clearPaper(el) {
  if (!el) return;
  const list = restores.get(el);
  if (list) {
    restores.delete(el);
    for (const fn of list) fn();
  }
}

function setStyles(el, styles) {
  const prev = {};
  for (const [k, v] of Object.entries(styles)) {
    if (!(k in prev)) prev[k] = el.style[k];
    el.style[k] = v;
  }
  return prev;
}

/**
 * 动效上下文：量一次整屏大小，准备好层里的 screen / 墨色盖片（B1）。返回 {frame(s, drag), clear()}。
 * layer = 写字页（或结果页）那一层；under = 来源页那一层（可为 null）。
 */
export function createPaper(plan, layer, under) {
  const app = layer.parentElement;
  const ar = app ? app.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const W = ar.width || window.innerWidth;
  const H = ar.height || window.innerHeight;
  const screen = layer.querySelector(':scope > .sz-layer__screen');
  const panel = under ? under.querySelector('.sz-tabroot__panel') : null;
  clearPaper(layer);
  if (under) clearPaper(under);

  const cleanups = [];
  const guard = fn => cleanups.push(fn);
  const layerKeys = ['left', 'top', 'width', 'height', 'borderRadius', 'boxShadow', 'opacity', 'transform', 'transformOrigin'];
  const layerPrev = Object.fromEntries(layerKeys.map(k => [k, layer.style[k]]));
  layer.setAttribute('data-paper', plan.mode);
  guard(() => {
    for (const k of layerKeys) layer.style[k] = layerPrev[k];
    layer.removeAttribute('data-paper');
    layer.removeAttribute('data-paper-s');
  });

  let apply;
  if (plan.mode === 'B1') {
    const B = { x: plan.source.rect.x - ar.left, y: plan.source.rect.y - ar.top, w: plan.source.rect.w, h: plan.source.rect.h };
    const r0 = plan.source.radius;
    const screenPrev = screen ? setStyles(screen, { position: 'absolute', left: '0px', top: '0px', width: `${W}px`, height: `${H}px`, flex: 'none', transformOrigin: '0 0' }) : null;
    if (screen) guard(() => { for (const [k, v] of Object.entries(screenPrev)) screen.style[k] = v; screen.style.transform = ''; screen.style.opacity = ''; });
    // 墨色盖片：纸还是按钮大小时就是那个按钮（墨色底 + 字），长大时褪成纸色
    const ink = document.createElement('div');
    ink.className = 'sz-paper-ink';
    ink.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = plan.source.label;
    ink.appendChild(label);
    layer.appendChild(ink);
    guard(() => ink.remove());
    // 来源按钮藏起来（它的位置上长出来的是这张纸），首页其余内容淡出、不位移
    const btn = under ? under.querySelector(`[data-paper-source="${plan.source.key}"]`) : null;
    if (btn) {
      const prev = btn.style.visibility;
      btn.style.visibility = 'hidden';
      guard(() => { btn.style.visibility = prev; });
    }
    if (panel) {
      const prev = panel.style.opacity;
      guard(() => { panel.style.opacity = prev; });
    }
    apply = (s, drag) => {
      const e = 1 - s;
      const lean = drag ? Math.sin(Math.PI * e) * P.dragLeanPt : 0;
      const x = B.x * e + lean;
      const y = B.y * e;
      const w = W + (B.w - W) * e;
      const h = H + (B.h - H) * e;
      const r = e < 0.0005 ? 0 : drag ? P.dragRadiusPt + (r0 - P.dragRadiusPt) * e : r0 * e + P.dragRadiusPt * Math.sin(Math.PI * e) * 0.5;
      const st = layer.style;
      st.left = `${x}px`;
      st.top = `${y}px`;
      st.width = `${w}px`;
      st.height = `${h}px`;
      st.borderRadius = `${r}px`;
      const lift = clamp(e / 0.12) * (1 - clamp((e - 0.8) / 0.2));
      st.boxShadow = e < 0.0005 ? '' : `0 0 0 1px var(--line)${lift > 0.02 ? ', var(--elev-shadow)' : ''}`;
      if (screen) {
        screen.style.transform = `scale(${w / W})`;
        screen.style.opacity = String(clamp((s - P.contentFadeFrom) / (1 - P.contentFadeFrom)));
      }
      ink.style.opacity = String(clamp((e - 0.8) / 0.2));
      label.style.opacity = String(clamp((e - 0.9) / 0.1));
      if (panel) panel.style.opacity = String(1 - clamp((s - 0.2) / 0.5));
    };
  } else if (plan.mode === 'B3') {
    if (under) {
      const prev = under.style.opacity;
      guard(() => { under.style.opacity = prev; });
    }
    apply = (s, drag) => {
      const u = clamp((s - 0.4) / 0.6);
      layer.style.opacity = String(u);
      layer.style.transform = `translateX(${drag ? (1 - s) * P.quietDragPt : 0}px) scale(${P.quietScaleFrom + (1 - P.quietScaleFrom) * CLOSE_EASE(u)})`;
      if (under) under.style.opacity = String(1 - clamp(s / 0.4));
    };
  } else {
    apply = s => {
      layer.style.opacity = String(clamp(s));
    };
  }

  const frame = (s, drag = false) => {
    const v = clamp(s);
    layer.setAttribute('data-paper-s', v.toFixed(4));
    apply(v, drag);
  };
  const clear = () => {
    while (cleanups.length) cleanups.pop()();
  };
  remember(layer, clear);
  return { frame, clear, W, H };
}

// ---------------------------------------------------------------- 逐帧运行

/**
 * 从 s0 到 s1 逐帧走：s(u) = s0 + (s1 − s0) × ease(u)。返回 {cancel()}；onDone 在最后一帧（s = s1）之后调用。
 * raf / now 可注入（单测）。
 */
export function runProgress({ from, to, ms, ease, apply, onDone, raf, now }) {
  const request = raf || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(window) : fn => setTimeout(() => fn(nowMs()), 16));
  const cancelRaf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame.bind(window) : clearTimeout;
  const clock = now || nowMs;
  let last = null; // 第一帧才开表；之后每帧最多前进 MAX_FRAME_MS：写字页首次渲染很重（主线程被占 100–200ms），按墙钟算会在一帧里从 0 跳到 0.6，看起来是「卡一下再蹦出来」
  let elapsed = 0;
  let id = 0;
  let stopped = false;
  const step = t => {
    if (stopped) return;
    const tt = typeof t === 'number' ? t : clock();
    if (last !== null) elapsed += clamp(tt - last, 0, MAX_FRAME_MS);
    last = tt;
    const u = ms <= 0 ? 1 : clamp(elapsed / ms);
    apply(from + (to - from) * ease(u));
    if (u < 1) id = request(step);
    else if (onDone) onDone();
  };
  apply(from);
  id = request(step);
  return {
    cancel() {
      stopped = true;
      cancelRaf(id);
    },
  };
}

/** 一次点按转场的时长与曲线（B1：进 420 / 退 360；B3：220 / 180；减少动态效果：150，线性）。 */
export function specFor(plan, { fromS = null } = {}) {
  const open = plan.dir === 'open';
  if (plan.mode === 'R') return { ms: P.reducedMs, ease: LINEAR, from: open ? 0 : fromS === null ? 1 : fromS, to: open ? 1 : 0 };
  if (plan.mode === 'B3') return { ms: open ? P.quietOpenMs : P.quietCloseMs, ease: LINEAR, from: open ? 0 : fromS === null ? 1 : fromS, to: open ? 1 : 0 };
  if (open) return { ms: P.openMs, ease: OPEN_EASE, from: 0, to: 1 };
  if (fromS !== null) return { ms: Math.max(P.minFinishMs, Math.round(P.fullMs * fromS)), ease: CLOSE_EASE, from: fromS, to: 0 }; // 左缘右滑松手完成：从当前位置接着收
  return { ms: P.closeMs, ease: CLOSE_EASE, from: 1, to: 0 };
}

/** 左缘右滑松手取消：长回整屏（B1 / B3：220ms，同一条退出曲线）。 */
export function cancelSpec(plan, s0) {
  return { ms: P.cancelMs, ease: CLOSE_EASE, from: s0, to: 1 };
}

/** B1 的墨色盖片（长大前就是那个按钮：墨色底 + 字）；样式由 root.js 经 injectStyles 注入。 */
export const PAPER_CSS = `
.sz-paper-ink{position:absolute;inset:0;z-index:5;pointer-events:none;display:grid;place-items:center;background:${T.btnBg};color:${T.btnFg};
  font-family:${T.hei};font-size:${T.fs17};line-height:${T.lh17s};font-weight:500;opacity:0}
.sz-paper-ink>span{opacity:0;white-space:nowrap}
`;
