// 写字页的进出动效（W2，D57，P282–P284；设计稿「写字页与我的.html」B 节）：B1「按钮长成这张纸」、B3「安静淡入」、减少动态效果的 150ms 淡化。
//
// 进出共用同一个进度 s（1 = 写字页整屏，0 = 来源按钮 / 首页）：
//   · 点按：s 按曲线走（进入 420ms、退出 360ms），纯 requestAnimationFrame 逐帧调用 frame(s)——和手势是同一个函数，没有两套动画；
//   · 左缘右滑（R4-G1 的进度接口 router.beginBack / setBackProgress / endBack / finishBack / cancelBack，由 root.js 的 BACK_TRANSITION 转给这里）：
//     s = 1 − 手指进度 p，逐帧跟手；松手完成 = 从当前 s 继续收进来源（300ms × s，至少 120ms），取消 = 220ms 长回整屏。
//
// D62（覆盖 R6-J1）：只有首页上的入口（下层是 tab 根 home、被点元素不在弹层里）才走下面的 B1；其他入口记成 PUSHED，写字页普通推入、返回普通右滑出（planPaper 返回 null / 'S'）。
// 来源（共享元素，交互与动效规范 T0-6）：root.js 在 document 上挂一个捕获阶段的 click 监听（noteTap），
// 每次点按都记下「被点的那个可点元素」（button / [role=button] / a，或带 data-paper-source 的元素）的矩形、字、圆角、底色；
// 下一次推入写字页（或结果页「再写一组」/ 撤销跳过换成写字页）时取走，记在「下层页面」名下。所以首页主按钮、「接着写」、自己选字的「练这 N 个字」、
// 字库 / 详情的「练这个字」、自选字、结果页「再写一组」……都是同一条 B1：从被点元素的矩形长成纸，返回沿原路缩回它。
// 返回时被点元素还在（同一个节点或同 data-testid 的元素）就重新量一次它的位置（版面可能变了），不在了（弹层已关、结果页已换掉）就缩回记下的位置并淡出，
// 记下的位置也不在屏上就缩回页面中心并淡出。屏上本来就没有来源元素的入口（通知、冷启动恢复）才走 B3：
// 220ms 首页先淡出、写字页再淡入并从 0.96 放大到 1；退出 180ms 反向。来源记录 2s 内有效（timing.sourceFresh），推入别的页面 / 返回 / 切 Tab 即作废。
// 实心来源（主按钮、工具按钮：底色不透明）纸在按钮大小时就是那个按钮（同底色 + 同字）；透明来源（文字按钮、列表行、字帖格）纸在元素大小时透明、随展开淡入，
// 缩回时同样淡出——不在屏上画出一个原本不存在的「按钮」。
// 进出对称（R5-I2，审计 P1-02）：B3 进来的写字页也记一条「安静」来源（{quiet:true}），写完换成结果页后，结果页的「×」与左缘右滑同样按 B3 倒放离开，
// 不再变成横推。冷启动 / 刷新恢复出来的结果页没有来源记录（只在内存里），照旧横推。
// 减少动态效果：一律 150ms 交叉淡化（写字页透明度 s，首页留在下面不动），不缩放、不位移；左缘右滑不跟手，松手按阈值完成后淡化（router 控制器 follow=false）。
// 上面的毫秒数与曲线都是 motion 令牌（policy.paperTransition 取自 config/motion.js，D58；改值改 tokens.json）。
// 可被打断（规范 T0-3，R5M）：B1 / B3 推入还没放完时点「‹」或从左缘起手，推入立即收尾到终态（root.js 的 cancel），再按返回走——不吞返回。
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

// ---------------------------------------------------------------- 来源（被点元素）

let pending = null; // {el, rect, label, radius, bg, fg, solid, key, at}
const QUIET = Object.freeze({ quiet: true }); // B3 进来的写字页的「来源」：没有按钮，只记得是安静淡入
const PUSHED = Object.freeze({ pushed: true }); // 普通推入进来的写字页（D62：不是从首页进的）：返回也是普通右滑出，不画纸
/** 只有从首页（tab 根 'home'）页面上的元素进入写字页才用 B1（弹层里的入口不算）：返回会回到首页那个入口（D62 覆盖 D57 / T0-6「任何入口都 B1」）。 */
const HOME_TAB = 'home';
const sources = new Map(); // 下层页面 entry id → 来源（B1）| {quiet:true}（B3）

/** 能当来源的元素（被点元素向上找到的第一个）。 */
export const SOURCE_SELECTOR = '[data-paper-source], button, [role="button"], a[href]';

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function styleOf(el) {
  try {
    return typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  } catch (error) {
    return null;
  }
}

function radiusOf(el) {
  const cs = styleOf(el);
  const v = cs ? parseFloat(cs.borderTopLeftRadius) : NaN;
  return Number.isFinite(v) ? v : 12;
}

/** rgba / rgb 字符串的不透明度（解析不了按不透明算）。 */
export function alphaOf(color) {
  if (!color || color === 'transparent') return 0;
  const m = /rgba?\(([^)]*)\)/.exec(color);
  if (!m) return 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 4) return 1;
  const a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  return Number.isFinite(a) ? a : 1;
}

function keyOf(el, key) {
  if (key) return key;
  if (!el || typeof el.getAttribute !== 'function') return null;
  return el.getAttribute('data-paper-source') || el.getAttribute('data-testid') || null;
}

/**
 * 记下「这次是从哪个元素进写字页的」（点击时调用，下一次推入写字页时取走；超过 policy.paperTransition.sourceFreshMs 作废）。
 * key：返回时在下层页面里重新找到它（data-paper-source / data-testid）；缺省取元素自己的这两个属性。
 */
export function markPaperSource(el, key) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return;
  const rect = rectOf(el);
  if (!(rect.w > 0 && rect.h > 0)) return;
  const cs = styleOf(el);
  const bg = cs ? cs.backgroundColor : '';
  const solid = cs ? alphaOf(bg) >= 0.5 : true;
  pending = {
    el, rect, label: solid ? (el.textContent || '').trim() : '', radius: radiusOf(el), bg: solid ? bg : '', fg: cs ? cs.color : '',
    solid, key: keyOf(el, key), at: nowMs(),
    overlay: !!(el.closest && el.closest('[role="dialog"],[role="alertdialog"]')), // 弹层里的入口（查字「练这个字」）：返回回到的不是那个入口，不算首页入口（D62）
  };
}

// B3.5a（D62）：原生页上的入口（原生首页主按钮）——网页收不到 click，来源矩形由原生量了随写入 op 交过来；返回时被点元素的「此刻」也由原生报
// （nativeLive：key → {rect, label}，liveSource 在网页里找不到同 key 的元素时用它）。
const nativeLive = new Map();

/** 原生入口记成来源（同 markPaperSource，矩形 / 字 / 圆角 / 是否实心由原生给）。 */
export function markNativePaperSource({ rect, label = '', radius = 12, solid = true, key = null } = {}) {
  if (!rect || !(rect.w > 0 && rect.h > 0)) return;
  pending = {
    el: null, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, label: solid ? String(label || '') : '', radius, bg: '', fg: '',
    solid: !!solid, key, at: nowMs(), overlay: false,
  };
  if (key) nativeLive.set(key, { rect: pending.rect, label: pending.label });
}

/**
 * R16：原生弹层（查字「练这个字 / 练这 N 个字」、S02 三键）上的点按——网页收不到 click（网页弹层里同一个点按由 noteTap 记成 overlay 来源），
 * 照网页记成「弹层里的入口」：返回回到的不是那个入口，按 D62 普通推入（不是没有点按的 B3 淡入）。不画纸，所以不要矩形。
 */
export function markNativeOverlayTap() {
  pending = { el: null, rect: { x: 0, y: 0, w: 0, h: 0 }, label: '', radius: 0, bg: '', fg: '', solid: false, key: null, at: nowMs(), overlay: true };
}

/** 原生弹层的动作回调：先把这次点按记成弹层里的入口（markNativeOverlayTap），再照常调用。 */
export function overlayTapped(fn) {
  return typeof fn === 'function' ? (...args) => { markNativeOverlayTap(); return fn(...args); } : fn;
}

/** 原生入口此刻的位置与字（原生页排版 / 字变了时报；null 清掉）。 */
export function setNativeLiveSource(key, live) {
  if (!key) return;
  if (live && live.rect && live.rect.w > 0 && live.rect.h > 0) nativeLive.set(key, { rect: { ...live.rect }, label: String(live.label || '') });
  else nativeLive.delete(key);
}

/** 捕获阶段的 click（root.js）：从被点的节点往上找到可点元素记成来源。退场余影、禁用的控件不算。 */
export function noteTap(target) {
  const el = target && typeof target.closest === 'function' ? target.closest(SOURCE_SELECTOR) : null;
  if (!el || el.disabled || (el.closest && el.closest('.sz-exit'))) return;
  markPaperSource(el);
}

function takePending() {
  const p = pending;
  pending = null;
  return p && nowMs() - p.at <= P.sourceFreshMs ? p : null;
}

/** 这次点按没有推入写字页（切 Tab、推入 / 换成别的页面、返回）：作废，免得之后一次没有点按的推入（通知深链）借用它（root.js 每次页面转场调用）。 */
export function forgetTap() {
  pending = null;
}

/** 测试用：清掉记下的来源。 */
export function resetPaperSources() {
  pending = null;
  sources.clear();
  nativeLive.clear();
  nativePlans.clear(); // B4.9a：core-diff 每个场景从干净的计划表开始
}

export function hasPaperSource(entryId) {
  return sources.has(entryId);
}

/** 测试 / e2e 用：某个下层页面名下记着的来源（矩形与是否实心），没有时 null。 */
export function paperSourceOf(entryId) {
  const s = sources.get(entryId);
  if (!s) return null;
  if (s.quiet) return { quiet: true };
  if (s.pushed) return { pushed: true };
  return { rect: { ...s.rect }, solid: s.solid, key: s.key };
}

// ---------------------------------------------------------------- 计划（哪种动效、从哪到哪）

/**
 * 根据一次转场决定动效。返回 null（沿用默认横推）或 {mode, dir, source, …}：
 *   mode 'B1' | 'B3' | 'R'（减少动态效果）| 'S'（结果页换成写字页的普通推入，D62）；dir 'open' | 'close'；source = {rect, label, radius, key}（B1）。
 * 只管「进写字页」与「写字页 / 结果页回到记着来源的页面」；其它页面的 push / pop 不在范围内（保持横推）。
 * @param {{kind:string, from:object, to:object}} t  router 的 transition
 * @param {{reduced:boolean, root:Element|null}} o
 */
export function planPaper(t, { reduced, root, underId = null, nativeTap = false }) {
  if (!t || !t.from || !t.to) return null;
  if (t.kind === 'push' || t.kind === 'replace') {
    if (t.to.n !== 'write' || (t.kind === 'replace' && t.from.n === 'write')) {
      if (t.kind === 'push') {
        sources.delete(t.from.id);
        pending = null; // 推入了别的页面：这次点按不是写字页的来源
      }
      return null;
    }
    const src = takePending();
    if (t.kind === 'replace') {
      // 结果页「再写一组」/ 撤销跳过回到那个字：D62 起不是首页入口，有被点元素时就是普通推入（新写字页从右推入盖在被换掉的结果页上），
      // 来源记在结果页下面那一页名下，返回同样是普通右滑出。没有被点元素（程序换页）时保持同一层换内容的 T-phase 淡化（返回 null，root.js 照旧）。
      // nativeTap（B2.8）：原生结果页上的点按（网页收不到 click）——同样算被点元素，普通推入。
      if (!src && !nativeTap) return null;
      if (underId) sources.set(underId, PUSHED);
      return reduced ? null : { mode: 'S', dir: 'open' };
    }
    if (src && (t.from.n !== HOME_TAB || src.overlay)) {
      sources.set(t.from.id, PUSHED); // 点按进来、但不是从首页：和进其他 L1 页完全同一套推入
      return null;
    }
    sources.set(t.from.id, src || QUIET);
    if (reduced) return { mode: 'R', dir: 'open' };
    return src ? { mode: 'B1', dir: 'open', source: src } : { mode: 'B3', dir: 'open' };
  }
  if (t.kind === 'pop') {
    pending = null;
    if (t.from.n !== 'write' && t.from.n !== 'result') return null;
    const had = sources.get(t.to.id);
    if (t.from.n === 'result' && !had) return null; // 没有来源记录的结果页（冷启动 / 刷新恢复出来的栈：来源只记在内存里）：保持横推（审计 P2-25：已没有推入结果页的路径）
    sources.delete(t.to.id);
    if (had && had.pushed) return null; // 普通推入进来的：普通右滑出（减少动态效果下也是通用的 150ms 淡化）
    if (reduced) return { mode: 'R', dir: 'close' };
    if (!had || had.quiet) return { mode: 'B3', dir: 'close' }; // B3 进来的（含写完换成的结果页）按 B3 倒放离开
    return { mode: 'B1', dir: 'close', source: liveSource(had, t.to.id, root) };
  }
  if (t.kind === 'tab') pending = null;
  return null;
}

function visibleBox(el) {
  if (!el || el.isConnected === false || typeof el.getBoundingClientRect !== 'function') return null;
  const rect = rectOf(el);
  return rect.w > 0 && rect.h > 0 ? rect : null;
}

/**
 * 返回时的来源：被点元素还在下层页面里（同一个节点，或同 key 的元素）就重新量一次它的位置和字（版面 / 按钮文字可能变了：「开始写字」→「继续写字」）；
 * 不在了：缩回记下的位置并淡出（gone）；记下的位置已不在屏上：缩回页面中心并淡出。
 */
function liveSource(src, underId, root) {
  const under = root ? root.querySelector(`.sz-layer[data-entry="${underId}"]`) : null;
  let el = src.el && (!under || under.contains(src.el)) ? src.el : null;
  let rect = visibleBox(el);
  if (!rect && under && src.key) {
    const esc = String(src.key).replace(/["\\]/g, '\\$&');
    el = under.querySelector(`[data-paper-source="${esc}"]`) || under.querySelector(`[data-testid="${esc}"]`);
    rect = visibleBox(el);
  }
  if (rect) {
    const label = src.solid ? ((el.textContent || '').trim() || src.label) : '';
    return { ...src, el, rect, label, radius: radiusOf(el), gone: false };
  }
  const live = !src.el && src.key ? nativeLive.get(src.key) : null; // 原生入口（B3.5a）：原生报的此刻位置与字
  if (live) return { ...src, el: null, rect: { ...live.rect }, label: src.solid ? live.label || src.label : '', gone: false };
  if (!under) return { ...src, gone: false }; // 单测（没有 DOM）：沿用记下的
  const W = typeof window !== 'undefined' ? window.innerWidth : 0;
  const H = typeof window !== 'undefined' ? window.innerHeight : 0;
  const r = src.rect;
  const onScreen = !W || !H || (r.x < W && r.y < H && r.x + r.w > 0 && r.y + r.h > 0);
  const at = onScreen ? r : { x: (W - r.w) / 2, y: (H - r.h) / 2, w: r.w, h: r.h };
  return { ...src, el: null, rect: at, gone: true };
}

/** 左缘右滑开始时的计划：顶层是写字页 / 记着来源的结果页，下层是它的来源页。B3 进来的（或没有来源记录的写字页）走 B3，其它返回 null（横推）。 */
export function planPaperDrag(topEntry, underEntry, root) {
  if (!topEntry || !underEntry) return null;
  const had = sources.get(underEntry.id);
  if (had && had.pushed) return null; // 普通推入进来的写字页 / 结果页：普通横推返回
  const b1 = had && !had.quiet ? { mode: 'B1', dir: 'close', drag: true, source: liveSource(had, underEntry.id, root) } : null;
  if (topEntry.n === 'write') return b1 || { mode: 'B3', dir: 'close', drag: true };
  if (topEntry.n === 'result' && had) return b1 || { mode: 'B3', dir: 'close', drag: true };
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
    // 实心来源：盖片在纸还是元素大小时就是那个元素（同底色 + 同字），长大时褪成纸色。
    // 透明来源（文字按钮、列表行、字帖格）或已不在屏上的来源：没有盖片，纸在元素大小时透明、随展开淡入（缩回时淡出），见 apply 里的 veil。
    const solid = plan.source.solid !== false && !plan.source.gone;
    const veil = !solid;
    const ink = solid ? document.createElement('div') : null;
    const label = solid ? document.createElement('span') : null;
    if (ink) {
      ink.className = 'sz-paper-ink';
      ink.setAttribute('aria-hidden', 'true');
      if (plan.source.bg) ink.style.background = plan.source.bg;
      if (plan.source.fg) ink.style.color = plan.source.fg;
      label.textContent = plan.source.label;
      ink.appendChild(label);
      layer.appendChild(ink);
      guard(() => ink.remove());
    }
    // 来源元素藏起来（它的位置上长出来的是这张纸），下层其余内容淡出、不位移
    const srcEl = plan.source.el;
    const key = plan.source.key ? String(plan.source.key).replace(/["\\]/g, '\\$&') : null;
    const btn = !under || plan.source.gone ? null
      : srcEl && srcEl.isConnected && under.contains(srcEl) ? srcEl
        : key ? under.querySelector(`[data-paper-source="${key}"]`) || under.querySelector(`[data-testid="${key}"]`) : null;
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
      st.boxShadow = e < 0.0005 || (veil && e > 0.8) ? '' : `0 0 0 1px var(--line)${lift > 0.02 ? ', var(--elev-shadow)' : ''}`;
      if (veil) st.opacity = String(clamp(s / P.veilTo)); // 透明 / 已不在的来源：纸在元素大小时看不见，展开到 veilTo 时完全显出
      if (screen) {
        screen.style.transform = `scale(${w / W})`;
        screen.style.opacity = String(clamp((s - P.contentFadeFrom) / (1 - P.contentFadeFrom)));
      }
      if (ink) {
        ink.style.opacity = String(clamp((e - 0.8) / 0.2));
        label.style.opacity = String(clamp((e - 0.9) / 0.1));
      }
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
    if (frameWatchers.size) for (const fn of frameWatchers) fn({ layer, s: v, mode: plan.mode, dir: plan.dir });
  };
  const clear = () => {
    while (cleanups.length) cleanups.pop()();
  };
  remember(layer, clear);
  return { frame, clear, W, H };
}

/** 逐帧观察（e2e IC-23 用：每画一帧、在同一个任务里同步回调 {layer, s, mode, dir}；返回取消函数）。没有观察者时零开销。 */
const frameWatchers = new Set();
export function watchPaperFrames(fn) {
  frameWatchers.add(fn);
  return () => frameWatchers.delete(fn);
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

// ---------------------------------------------------------------- B2.8 原生宿主：转场交给原生，网页只记账

// 原生写字页 / 结果页（B2，宿主条目透明）进出时，转场由原生 NativeWriteTransitions 一个对象画（T-paper / T-push / T-quiet / 减少动态效果淡化）；
// 网页对宿主条目不再播自己的纸展开 / 推入（root.js 跳过动画），但来源记账照旧走 planPaper——「这一页是怎么进来的、返回怎么回去」仍只有网页这一份真相，
// 原生经 shiziNativeNav 读：进来时随 open 消息带 nativePlanOf，返回前问 nativeBackPlan（被点元素此刻的位置与字）。

const nativePlans = new Map(); // 宿主条目 id → 进来时的计划（可序列化）

function plainRect(r) {
  return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
}

function panelRectOf(underId, root) {
  const under = root && underId ? root.querySelector(`.sz-layer[data-entry="${underId}"]`) : null;
  const panel = under ? under.querySelector('.sz-tabroot__panel') : null;
  return panel ? plainRect(rectOf(panel)) : null;
}

/**
 * 计划 → 原生能读的形状：{mode:'paper', source:{rect, radius, label, bg, fg, solid, gone, key}, panel} | {mode:'quiet'} | {mode:'push'}。
 * B1 → paper（panel = 下层 tab 根内容区的矩形：纸展开时它淡出，标签栏不动）；B3 → quiet；其余（null / 'S' 普通推入）→ push。
 */
export function nativePlanShape(plan, underId = null, root = null) {
  if (plan && plan.mode === 'B1' && plan.source) {
    const s = plan.source;
    return {
      mode: 'paper',
      source: { rect: plainRect(s.rect), radius: s.radius, label: s.label || '', bg: s.bg || '', fg: s.fg || '', solid: s.solid !== false, gone: !!s.gone, key: s.key || null },
      panel: panelRectOf(underId, root),
    };
  }
  if (plan && plan.mode === 'B3') return { mode: 'quiet' };
  return { mode: 'push' };
}

/** root.js：网页把一次进宿主条目的转场让给原生时，记下计划（宿主挂载时随 open 带给原生）。 */
export function noteNativePlan(entryId, plan, underId = null, root = null) {
  if (!entryId) return;
  nativePlans.set(entryId, nativePlanShape(plan, underId, root));
  if (nativePlans.size > 16) nativePlans.delete(nativePlans.keys().next().value);
}

/** 宿主条目进来时的计划；没有记录（冷启动恢复等没有转场的进入）时 null。 */
export function nativePlanOf(entryId) {
  return nativePlans.get(entryId) || null;
}

/**
 * 原生页返回前问：顶层宿主条目（写字页 / 结果页）回到下层页面时该怎么走——与网页左缘右滑同一个判定（planPaperDrag），被点元素还在就量它此刻的位置与字。
 * 不消耗来源记录（真正出栈时 planPaper pop 才删）。
 */
export function nativeBackPlan(topEntry, underEntry, root = null) {
  if (!topEntry || !underEntry) return { mode: 'push' };
  return nativePlanShape(planPaperDrag(topEntry, underEntry, root), underEntry.id, root);
}

// 网页转场是否空闲（root.js 每次渲染后报）：原生宿主「回来」时等网页自己的返回转场放完再请原生盖上（B2.8：同一时刻只有一个转场在跑）。
let navBusy = false;
const idleWaiters = new Set();

export function setNavBusy(busy) {
  navBusy = !!busy;
  if (navBusy || !idleWaiters.size) return;
  const list = [...idleWaiters];
  idleWaiters.clear();
  for (const fn of list) fn();
}

export function navIsIdle() {
  return !navBusy;
}

/** 网页转场空闲时调用 fn（已空闲：立即）。返回取消函数。 */
export function whenNavIdle(fn) {
  if (!navBusy) {
    fn();
    return () => {};
  }
  idleWaiters.add(fn);
  return () => idleWaiters.delete(fn);
}

// 宿主显示状态变了（结果页从网页版换回原生宿主）：root.js 重画一次，让宿主层透明、下层可见。
const hostListeners = new Set();
export function onNativeHostChange(fn) {
  hostListeners.add(fn);
  return () => hostListeners.delete(fn);
}
export function notifyNativeHostChange() {
  for (const fn of [...hostListeners]) fn();
}

/** 网页转场记录（QA 探针读最近 12 条：'push:paper' / 'pop:slide' / 'push:native'（让给原生）……；B2.8 核对「同一时刻只有一个转场」）。 */
export const navTrace = [];
export function traceNav(s) {
  navTrace.push(s);
  if (navTrace.length > 12) navTrace.splice(0, navTrace.length - 12);
}
