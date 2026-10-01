// 书写格：三层 canvas + 指针输入（01-架构设计 §6.1、§6.3；reference/C-ink.md；acceptance/M0-7-spike.md）。
//
// 图层（下 → 上）：
//   1. 十字虚线（SVG，var(--g)，原型 ShiziWriteScreen guides() L471–L482）
//   2. 参考字形 / 提示 / 描红层挂载点（M1-2 / M1-3 / M1-4 提供内容）：prop glyphLayer（vnode 或 ({size, cssSize}) => vnode）
//      与 prop glyphRef（拿到宿主 div 自己画 canvas / SVG）
//   3. 固化层 canvas：已完成的笔画；抬笔时只追加一笔（不全量重画），撤销 / 清空 / 换字 / 尺寸或主题变化时才整层重画
//   4. 当前笔层 canvas：只画正在写的一笔，每帧（rAF）清空重画；它也接收指针事件
//
// 坐标：内部恒为 345×345 单位（GRID），指针位置按 getBoundingClientRect 缩到 345 空间；t = event.timeStamp；
//   p 只在 pointerType==='pen' 时取（WKWebView 手指 pressure 恒 0，M0-7 实测）。
// 输入：pointer events + setPointerCapture + touch-action:none；getCoalescedEvents 仅在存在时使用
//   （iOS 15–18.1 WebKit 没有，退回原始 pointermove）；非 primary 指针（第二根手指 / 手掌）忽略。
// 中断：pointercancel / lostpointercapture / 原生 shizi-native-back-progress {phase:'began'}（M0-7：识别器触发时
//   WebKit 不发 pointercancel）一律丢弃未完成的当前笔：不固化、不计笔数；已固化层不动。
// pointerdown 一律 preventDefault（M0-7：让原生边缘识别器不开始，作为 backGestureEnabled 门控之外的第二道保护）。
// 防连点（01 §6.6 / 走查-V01）：acceptFrom 之前（按事件 timeStamp）落下的笔不接受——换字后 0.3s 由写字页给出。
// 渲染：同一条管线（core/ink-math buildStroke）实时出点、抬笔用 final=true 结果固化；笔锋基元见 brush.js；
//   减少动态效果或低端设备关闭飞白 / 洇墨，只保留管线本身的首尾锥形（01 §6.3）。

import { html, useEffect, useLayoutEffect, useRef } from '../../../vendor/ui.js';
import { buildStroke, GRID, INK } from '../../core/ink-math.js';
import { brushDetailEnabled, createLayerCache, paintBrushStroke } from './brush.js';
import { eventTime } from '../components/Button.js';
import { injectStyles, T } from '../components/styles.js';
import { NATIVE_PROGRESS_EVENT } from '../router.js';

export { GRID };

/** 标准书写格显示尺寸（01 §6.1；紧凑版 258 由 M1-7 传 size）。 */
export const STD_SIZE = 345;

injectStyles('inkgrid', `
.sz-inkgrid{position:relative;flex:none;box-sizing:border-box;aspect-ratio:1/1;max-width:100%;margin:0 auto;
  border:.5px solid ${T.i5};border-radius:16px;background:${T.c};overflow:hidden;
  touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.sz-inkgrid__layer{position:absolute;inset:0;width:100%;height:100%;display:block}
.sz-inkgrid__guides{pointer-events:none}
.sz-inkgrid__glyph{pointer-events:none}
.sz-inkgrid__ink{pointer-events:none}
.sz-inkgrid__live{touch-action:none;cursor:default}
.sz-inkgrid[data-drawable="true"] .sz-inkgrid__live{cursor:crosshair}
`);

function matchMediaSafe(win, query) {
  try {
    return win && typeof win.matchMedia === 'function' ? win.matchMedia(query) : null;
  } catch (error) {
    return null;
  }
}

function inkColorOf(el) {
  try {
    const v = getComputedStyle(el).getPropertyValue('--i1').trim();
    return v || '#3B2F28';
  } catch (error) {
    return '#3B2F28';
  }
}

/**
 * 命令式书写面（组件内部使用；也导出给后续卡 / 走查工具直接用）。
 * @param {object} o
 * @param {HTMLElement} o.box  书写格容器（量尺寸、取 --i1）
 * @param {HTMLCanvasElement} o.inkCanvas  固化层
 * @param {HTMLCanvasElement} o.liveCanvas  当前笔层（接收指针事件）
 * @param {Window} [o.win]
 * @param {() => object} o.getProps  读最新 props：{drawable, acceptFrom, onStrokeStart, onStrokeEnd, onStrokeCancel, base}
 */
export function createInkSurface({ box, inkCanvas, liveCanvas, win = window, getProps }) {
  const inkCtx = inkCanvas.getContext('2d');
  const liveCtx = liveCanvas.getContext('2d');
  const layers = createLayerCache((w, h) => {
    const c = win.document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  });
  const built = new WeakMap(); // 原始笔 → final 点列（缓存，整层重画时不重跑管线）
  let painted = []; // 固化层上当前画着的原始笔（按引用）
  let current = null; // {pointerId, raw:[…], pen}
  let raf = 0;
  let color = inkColorOf(box);
  let scale = 1;
  const reduceMq = matchMediaSafe(win, '(prefers-reduced-motion: reduce)');
  const darkMq = matchMediaSafe(win, '(prefers-color-scheme: dark)');
  let detail = computeDetail();

  function computeDetail() {
    const nav = win.navigator || {};
    return brushDetailEnabled({
      reducedMotion: !!(reduceMq && reduceMq.matches),
      hardwareConcurrency: nav.hardwareConcurrency,
      deviceMemory: nav.deviceMemory,
    });
  }

  function base() {
    const p = getProps();
    return Number.isFinite(p.base) && p.base > 0 ? p.base : INK.base;
  }

  function finalPoints(raw) {
    let pts = built.get(raw);
    if (!pts) {
      pts = buildStroke(raw, { final: true, base: base() });
      built.set(raw, pts);
    }
    return pts;
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    const css = Math.max(1, Math.round(rect.width || STD_SIZE));
    const dpr = Math.max(1, Math.min(4, win.devicePixelRatio || 1));
    const px = Math.max(1, Math.round(css * dpr));
    scale = px / GRID;
    for (const [c, ctx] of [[inkCanvas, inkCtx], [liveCanvas, liveCtx]]) {
      if (c.width !== px || c.height !== px) {
        c.width = px;
        c.height = px;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }
    redrawAll();
    drawLive();
  }

  function clearCtx(ctx, canvas) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function paintFinal(raw) {
    paintBrushStroke(inkCtx, finalPoints(raw), { color, base: base(), detail, layers: detail ? layers : null });
  }

  function redrawAll() {
    color = inkColorOf(box);
    clearCtx(inkCtx, inkCanvas);
    for (const raw of painted) paintFinal(raw);
  }

  /** 让固化层与 strokes（原始笔数组，按引用比较）一致：尾部追加只画新笔，其余情况整层重画。 */
  function sync(strokes) {
    const next = Array.isArray(strokes) ? strokes.filter(s => Array.isArray(s) && s.length) : [];
    const prefix = painted.length <= next.length && painted.every((s, i) => s === next[i]);
    if (prefix) {
      const extra = next.slice(painted.length);
      painted = next.slice();
      for (const raw of extra) paintFinal(raw);
      return;
    }
    painted = next.slice();
    redrawAll();
  }

  function drawLive() {
    raf = 0;
    clearCtx(liveCtx, liveCanvas);
    if (!current || !current.raw.length) return;
    const pts = buildStroke(current.raw, { final: false, base: base() });
    paintBrushStroke(liveCtx, pts, { color, base: base(), detail });
  }

  function scheduleLive() {
    if (raf) return;
    raf = typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(drawLive) : win.setTimeout(drawLive, 16);
  }

  function cancelRaf() {
    if (!raf) return;
    if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(raf);
    else win.clearTimeout(raf);
    raf = 0;
  }

  function sample(e, rect) {
    const w = rect.width || 1;
    const h = rect.height || 1;
    const q = {
      x: ((e.clientX - rect.left) * GRID) / w,
      y: ((e.clientY - rect.top) * GRID) / h,
      t: eventTime(e),
    };
    if (e.pointerType === 'pen') {
      const p = Number(e.pressure);
      if (Number.isFinite(p) && p > 0) q.p = Math.min(1, p);
    }
    return q;
  }

  /** 丢弃未完成的当前笔（不固化、不计笔数）。reason：'cancel' | 'lostcapture' | 'native-back' | 'reset'。 */
  function cancelCurrent(reason = 'cancel') {
    if (!current) return false;
    const pointerId = current.pointerId;
    current = null;
    cancelRaf();
    clearCtx(liveCtx, liveCanvas);
    try {
      if (liveCanvas.hasPointerCapture && liveCanvas.hasPointerCapture(pointerId)) liveCanvas.releasePointerCapture(pointerId);
    } catch (error) {
      // 已释放
    }
    const p = getProps();
    if (typeof p.onStrokeCancel === 'function') p.onStrokeCancel(reason);
    return true;
  }

  function onDown(e) {
    e.preventDefault(); // M0-7：第二道保护，让原生边缘识别器不开始
    if (e.isPrimary === false) return; // 第二根手指 / 手掌
    if (e.button !== undefined && e.button > 0) return; // 鼠标右键 / 中键
    if (current) return;
    const p = getProps();
    if (!p.drawable) return;
    const ts = eventTime(e);
    if (Number.isFinite(p.acceptFrom) && ts < p.acceptFrom) return; // 换字后 0.3s 不接受落笔（V01）
    const rect = liveCanvas.getBoundingClientRect();
    current = { pointerId: e.pointerId, raw: [sample(e, rect)] };
    try {
      liveCanvas.setPointerCapture(e.pointerId);
    } catch (error) {
      // 合成事件或指针已失效：照常写，靠 pointerup / cancel 收尾
    }
    if (typeof p.onStrokeStart === 'function') p.onStrokeStart();
    scheduleLive();
  }

  function onMove(e) {
    if (!current || e.pointerId !== current.pointerId) return;
    e.preventDefault();
    const rect = liveCanvas.getBoundingClientRect();
    let list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    if (!list || !list.length) list = [e];
    for (const s of list) current.raw.push(sample(s, rect));
    scheduleLive();
  }

  function onUp(e) {
    if (!current || e.pointerId !== current.pointerId) return;
    e.preventDefault();
    const raw = current.raw;
    const last = raw[raw.length - 1];
    const rect = liveCanvas.getBoundingClientRect();
    const endPoint = sample(e, rect);
    if (!last || endPoint.x !== last.x || endPoint.y !== last.y) raw.push(endPoint);
    current = null;
    cancelRaf();
    clearCtx(liveCtx, liveCanvas);
    painted = painted.concat([raw]);
    paintFinal(raw);
    const p = getProps();
    if (typeof p.onStrokeEnd === 'function') p.onStrokeEnd(raw);
  }

  function onCancel(e) {
    if (!current || e.pointerId !== current.pointerId) return;
    cancelCurrent(e.type === 'lostpointercapture' ? 'lostcapture' : 'cancel');
  }

  function onNativeProgress(event) {
    const detailObj = (event && event.detail) || {};
    if (detailObj.phase === 'began') cancelCurrent('native-back');
  }

  const stopTouch = e => {
    if (e.cancelable) e.preventDefault();
  };

  const onThemeChange = () => {
    redrawAll();
    drawLive();
  };
  const onReduceChange = () => {
    detail = computeDetail();
    redrawAll();
  };

  liveCanvas.addEventListener('pointerdown', onDown);
  liveCanvas.addEventListener('pointermove', onMove);
  liveCanvas.addEventListener('pointerup', onUp);
  liveCanvas.addEventListener('pointercancel', onCancel);
  liveCanvas.addEventListener('lostpointercapture', onCancel);
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    liveCanvas.addEventListener(type, stopTouch, { passive: false });
  }
  win.addEventListener(NATIVE_PROGRESS_EVENT, onNativeProgress);
  const listen = (mq, fn) => {
    if (!mq) return () => {};
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    }
    if (typeof mq.addListener === 'function') {
      mq.addListener(fn);
      return () => mq.removeListener(fn);
    }
    return () => {};
  };
  const offDark = listen(darkMq, onThemeChange);
  const offReduce = listen(reduceMq, onReduceChange);
  let themeObserver = null;
  if (typeof win.MutationObserver === 'function' && win.document && win.document.documentElement) {
    themeObserver = new win.MutationObserver(onThemeChange);
    themeObserver.observe(win.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  let resizeObserver = null;
  const onWinResize = () => resize();
  if (typeof win.ResizeObserver === 'function') {
    resizeObserver = new win.ResizeObserver(() => resize());
    resizeObserver.observe(box);
  } else {
    win.addEventListener('resize', onWinResize);
  }

  resize();

  return {
    sync,
    cancelCurrent,
    redraw: () => {
      redrawAll();
      drawLive();
    },
    isDrawing: () => !!current,
    paintedCount: () => painted.length,
    destroy() {
      cancelRaf();
      current = null;
      liveCanvas.removeEventListener('pointerdown', onDown);
      liveCanvas.removeEventListener('pointermove', onMove);
      liveCanvas.removeEventListener('pointerup', onUp);
      liveCanvas.removeEventListener('pointercancel', onCancel);
      liveCanvas.removeEventListener('lostpointercapture', onCancel);
      for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        liveCanvas.removeEventListener(type, stopTouch, { passive: false });
      }
      win.removeEventListener(NATIVE_PROGRESS_EVENT, onNativeProgress);
      offDark();
      offReduce();
      if (themeObserver) themeObserver.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      else win.removeEventListener('resize', onWinResize);
    },
  };
}

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const GUIDES = () => html`<svg class="sz-inkgrid__layer sz-inkgrid__guides" viewBox="0 0 ${GRID} ${GRID}" aria-hidden="true" focusable="false">
  <line x1=${GRID / 2} y1="0" x2=${GRID / 2} y2=${GRID} stroke="var(--g)" stroke-width="1" stroke-dasharray="4 5"></line>
  <line x1="0" y1=${GRID / 2} x2=${GRID} y2=${GRID / 2} stroke="var(--g)" stroke-width="1" stroke-dasharray="4 5"></line>
</svg>`;

/**
 * 书写格组件（受控）。
 * @param {object} props
 * @param {Array<Array<{x,y,t,p?}>>} props.strokes  已完成的原始笔（按引用比较；尾部追加只画新笔）
 * @param {(raw) => void} [props.onStrokeEnd]  抬笔：一笔原始采样（组件已把它画进固化层；父组件应把它追加进 strokes）
 * @param {() => void} [props.onStrokeStart]  接受了一次落笔（提示淡出 / 结果行收起用，M1-3 / M1-5）
 * @param {(reason:string) => void} [props.onStrokeCancel]  当前笔被中断丢弃
 * @param {boolean} [props.drawable=true]
 * @param {number} [props.acceptFrom]  performance.now() 时钟；早于它（按事件 timeStamp）的落笔不接受
 * @param {*} [props.resetKey]  变化时丢弃正在写的一笔（换字 / 换阶段）
 * @param {number} [props.size=345]  显示边长（CSS px；不超过容器宽）
 * @param {*} [props.glyphLayer]  参考字形层内容：vnode，或 ({size:345, cssSize}) => vnode
 * @param {{current:any}} [props.glyphRef]  参考字形层宿主 div 的 ref
 * @param {number} [props.inkOpacity=1]  固化层不透明度（提示时 .35，M1-3）
 * @param {string} [props.inkTransition]  固化层 opacity 过渡（M1-3 控制；缺省无过渡）
 * @param {number} [props.base]  本体宽（缺省 INK.base）
 * @param {string} [props.label]  读屏名称（role=img 的 aria-label）
 * @param {{current:any}} [props.apiRef]  拿到 createInkSurface 返回的命令式接口
 * @param {string} [props.testid='write-grid']
 */
export function InkGrid(props) {
  const {
    strokes = [],
    drawable = true,
    resetKey,
    size = STD_SIZE,
    glyphLayer = null,
    glyphRef,
    inkOpacity = 1,
    inkTransition,
    label,
    apiRef,
    testid = 'write-grid',
  } = props;
  const boxRef = useRef(null);
  const inkRef = useRef(null);
  const liveRef = useRef(null);
  const surfaceRef = useRef(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useLayoutEffect(() => {
    const surface = createInkSurface({
      box: boxRef.current,
      inkCanvas: inkRef.current,
      liveCanvas: liveRef.current,
      win: window,
      getProps: () => propsRef.current,
    });
    surfaceRef.current = surface;
    if (apiRef) apiRef.current = surface;
    surface.sync(propsRef.current.strokes);
    return () => {
      surface.destroy();
      surfaceRef.current = null;
      if (apiRef && apiRef.current === surface) apiRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (surfaceRef.current) surfaceRef.current.cancelCurrent('reset');
  }, [resetKey]);

  useLayoutEffect(() => {
    if (surfaceRef.current) surfaceRef.current.sync(strokes);
  }, [strokes]);

  useEffect(() => {
    if (!drawable && surfaceRef.current) surfaceRef.current.cancelCurrent('reset');
  }, [drawable]);

  const glyph = typeof glyphLayer === 'function' ? glyphLayer({ size: GRID, cssSize: size }) : glyphLayer;
  const inkStyle = { opacity: inkOpacity };
  if (inkTransition) inkStyle.transition = inkTransition;
  const count = Array.isArray(strokes) ? strokes.length : 0;
  return html`<div
    class="sz-inkgrid"
    ref=${boxRef}
    style=${{ width: `${size}px` }}
    role="img"
    aria-label=${label}
    data-testid=${testid}
    data-drawable=${drawable ? 'true' : 'false'}
    data-stroke-count=${count}
  >
    ${GUIDES()}
    <div class="sz-inkgrid__layer sz-inkgrid__glyph" ref=${glyphRef} data-testid="write-glyph-layer" aria-hidden="true">${glyph}</div>
    <canvas class="sz-inkgrid__layer sz-inkgrid__ink" ref=${inkRef} style=${inkStyle} data-testid="write-grid-ink" aria-hidden="true"></canvas>
    <canvas class="sz-inkgrid__layer sz-inkgrid__live" ref=${liveRef} data-testid="write-grid-live" aria-hidden="true"></canvas>
  </div>`;
}
