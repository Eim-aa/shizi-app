// 网页兜底的左缘右滑返回（R4-G1，P271）：浏览器标签页 / 主屏 PWA 里没有原生识别器时，用指针事件做同一个手势。
// 原生壳内不装（ui/root.js 按 isNativeShell 判断）——原生 UIScreenEdgePanGestureRecognizer 是唯一所有者，两套手势不同时存在。
//
// 做法：能返回时（有子页、顶层页面左上是返回 / 关闭键、没有阻断、没有转场），根组件在屏幕最左 12px（页边 20 之内）画一条透明的
// 起手带 .sz-edge（touch-action:none、aria-hidden）。起手带从页头下沿（安全区 + 44）开始，不盖页头的「‹」/「×」（它的点击区从 x≈2 起，
// 盖住会让命中测试落到起手带上）；页头那一行本身就是返回键。只有从这条带上起手才算边缘手势——
//   - 起手带不随页面滚动、不在任何滚动容器里，也不压在书写格或页边线上的按钮上（书写格四周有 20 页边），所以页头以下任意高度起手都一样：
//     旧问题「只在某区域有效、下半屏不行」的网页侧成因（滚动容器先拿走横向拖动、touch-action:auto 让浏览器接管、
//     书写格 canvas 的 setPointerCapture 吃掉指针）在这里都不存在；
//   - 先动 10px 判方向：向右为主 → 开始返回，派发与原生同一形状的 shizi-native-back-progress（began / changed / ended，
//     带 translationX、progress、velocityX），由 router.createBackGestureController 处理（阈值、跟手、遮罩、减少动态效果都与原生一致）；
//     竖向为主 → 把这次拖动转成底下滚动容器的滚动（起手带本身不能滚）；
//   - 没动（轻点）→ 把点击转给起手带下面的元素，不吞点击。
// 书写格的当前笔由 ink-canvas.js 在 began 时丢弃（与原生同一事件）。纯逻辑部分 createEdgeSwipeTracker 单测见 test/ui/edge-swipe.test.mjs。
import { html } from '../../vendor/ui.js';
import { NATIVE_PROGRESS_EVENT } from './router.js';
import { injectStyles, T } from './components/styles.js';
import { M } from '../config/motion.js';

/**
 * 起手带宽（CSS px）：页边 20 之内再留 8——页边线上的文字按钮靠负外边距与 ::after 把点击区向左伸到 x≈13（Button.js --bx），
 * 起手带不能盖住它们（命中测试会落到起手带上，60-matrix / 66-text-size 的「按钮未被遮盖」检查）。原生壳的「页边起手」识别器仍是 20pt（P272）。
 */
export const EDGE_ZONE_PX = M.gesture.edgeZoneWeb;
/** 判方向前要动的距离。 */
export const DIRECTION_SLOP_PX = M.gesture.directionSlop;
/** 估速度用的时间窗（ms）。 */
export const VELOCITY_WINDOW_MS = 100;

injectStyles('edge-swipe', `
.sz-edge{position:absolute;left:0;top:calc(env(safe-area-inset-top, 0px) + ${T.hit});bottom:0;width:${EDGE_ZONE_PX}px;z-index:50;touch-action:none;-webkit-user-select:none;user-select:none;
  -webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;background:transparent}
`);

/** 起手带（根组件在能返回时画）。 */
export function EdgeStrip() {
  return html`<div class="sz-edge" aria-hidden="true" data-testid="edge-swipe"></div>`;
}

/**
 * 纯逻辑：一根手指从起手带按下到抬起的判定。
 * @param {{dispatch:(detail:object)=>void, width:()=>number}} deps
 */
export function createEdgeSwipeTracker({ dispatch, width }) {
  let s = null; // {x0, y0, mode:'pending'|'swipe'|'scroll', samples:[{x, t}]}

  function detail(phase, x, t) {
    const w = Math.max(1, Number(width()) || 1);
    const tx = Math.max(0, x - s.x0);
    return { phase, translationX: tx, progress: Math.min(1, tx / w), velocityX: velocity(t) };
  }

  function velocity(t) {
    const list = s.samples.filter(p => t - p.t <= VELOCITY_WINDOW_MS);
    if (list.length < 2) return 0;
    const a = list[0];
    const b = list[list.length - 1];
    const dt = b.t - a.t;
    return dt > 0 ? Math.round(((b.x - a.x) / dt) * 1000 * 100) / 100 : 0;
  }

  return {
    /** 按下：只认起手带里的点（x ≤ EDGE_ZONE_PX）。返回是否开始跟踪。 */
    down(x, y, t) {
      if (!(x <= EDGE_ZONE_PX)) {
        s = null;
        return false;
      }
      s = { x0: x, y0: y, mode: 'pending', samples: [{ x, t }] };
      return true;
    },
    /** 移动：返回 'pending'（还没判方向）| 'swipe' | 'scroll' | null（没在跟踪）。 */
    move(x, y, t) {
      if (!s) return null;
      if (s.mode === 'pending') {
        const dx = x - s.x0;
        const dy = y - s.y0;
        if (Math.hypot(dx, dy) < DIRECTION_SLOP_PX) return 'pending';
        if (dx > 0 && dx >= Math.abs(dy)) {
          s.mode = 'swipe';
          dispatch({ phase: 'began', translationX: 0, progress: 0, velocityX: 0 });
        } else {
          s.mode = 'scroll';
        }
      }
      if (s.mode === 'swipe') {
        s.samples.push({ x, t });
        if (s.samples.length > 32) s.samples.shift();
        dispatch(detail('changed', x, t));
      }
      return s.mode;
    },
    /** 抬起：返回 'tap' | 'swipe' | 'scroll' | null。 */
    up(x, y, t) {
      if (!s) return null;
      const mode = s.mode;
      if (mode === 'swipe') {
        s.samples.push({ x, t });
        dispatch(detail('ended', x, t));
      }
      s = null;
      return mode === 'pending' ? 'tap' : mode;
    },
    /** 系统取消（pointercancel）：跟手中则回弹。 */
    cancel() {
      if (s && s.mode === 'swipe') dispatch({ phase: 'cancelled', translationX: 0, progress: 0, velocityX: 0 });
      s = null;
    },
    active: () => !!s,
  };
}

function scrollParent(el, win) {
  for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
    const cs = win.getComputedStyle(a);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && a.scrollHeight > a.clientHeight) return a;
  }
  return null;
}

/**
 * 接到 window 上（事件委托：只处理从 .sz-edge 起手的指针）。返回解绑函数。
 * @param {{win: Window, canStart: () => boolean}} opts
 */
export function attachEdgeSwipe({ win, canStart = () => true }) {
  const doc = win.document;
  const dispatch = d => win.dispatchEvent(new win.CustomEvent(NATIVE_PROGRESS_EVENT, { detail: d }));
  const tracker = createEdgeSwipeTracker({ dispatch, width: () => win.innerWidth || 1 });
  let pointerId = null;
  let strip = null;
  let lastY = 0;
  let scroller = null;

  const below = (x, y) => {
    if (!strip) return null;
    const prev = strip.style.pointerEvents;
    strip.style.pointerEvents = 'none';
    const el = doc.elementFromPoint(x, y);
    strip.style.pointerEvents = prev;
    return el;
  };

  const onDown = e => {
    const target = e.target && e.target.closest ? e.target.closest('.sz-edge') : null;
    if (!target || pointerId !== null) return;
    if (e.isPrimary === false || (e.button !== undefined && e.button > 0)) return;
    strip = target;
    if (!canStart() || !tracker.down(e.clientX, e.clientY, e.timeStamp)) {
      // 不能返回（门控刚变）：当作点在下面的元素上
      const el = below(e.clientX, e.clientY);
      strip = null;
      if (el && typeof el.click === 'function') el.click();
      return;
    }
    e.preventDefault();
    pointerId = e.pointerId;
    lastY = e.clientY;
    scroller = null;
    try {
      target.setPointerCapture(e.pointerId);
    } catch (error) {
      // 合成事件：照常靠 window 上的 move / up
    }
  };
  const onMove = e => {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    const mode = tracker.move(e.clientX, e.clientY, e.timeStamp);
    if (mode === 'scroll') {
      if (!scroller) scroller = scrollParent(below(e.clientX, e.clientY), win);
      if (scroller) scroller.scrollTop += lastY - e.clientY;
    }
    lastY = e.clientY;
  };
  const finish = () => {
    pointerId = null;
    scroller = null;
    strip = null;
  };
  const onUp = e => {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    const mode = tracker.up(e.clientX, e.clientY, e.timeStamp);
    if (mode === 'tap') {
      const el = below(e.clientX, e.clientY);
      if (el && typeof el.click === 'function') el.click();
    }
    finish();
  };
  const onCancel = e => {
    if (e.pointerId !== pointerId) return;
    tracker.cancel();
    finish();
  };

  win.addEventListener('pointerdown', onDown, true);
  win.addEventListener('pointermove', onMove, true);
  win.addEventListener('pointerup', onUp, true);
  win.addEventListener('pointercancel', onCancel, true);
  return () => {
    tracker.cancel();
    win.removeEventListener('pointerdown', onDown, true);
    win.removeEventListener('pointermove', onMove, true);
    win.removeEventListener('pointerup', onUp, true);
    win.removeEventListener('pointercancel', onCancel, true);
  };
}
