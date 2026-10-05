// 书写格：三层 canvas + 指针输入（01-架构设计 §6.1、§6.3；reference/C-ink.md；acceptance/M0-7-spike.md）。
//
// 图层（下 → 上）：
//   1. 十字虚线（SVG，var(--guide)，原型 ShiziWriteScreen guides() L471–L482）
//   2. 参考字形 / 提示 / 描红层挂载点（M1-2 / M1-3 / M1-4 提供内容）：prop glyphLayer（vnode 或 ({size, cssSize}) => vnode）
//      与 prop glyphRef（拿到宿主 div 自己画 canvas / SVG）
//   3. 固化层 canvas：已完成的笔画；抬笔时只追加一笔（不全量重画），撤销 / 清空 / 换字 / 尺寸或主题变化时才整层重画
//   4. 当前笔层 canvas：只画正在写的一笔，每帧（rAF）清空重画；它也接收指针事件
//
// 坐标：内部恒为 345×345 单位（GRID），指针位置按 getBoundingClientRect 缩到 345 空间；t = event.timeStamp；
//   正方形防线（R3-K1，ADA A3-01，P240）：格子边长由写字页写死成 size×size px（不靠 aspect-ratio / flex 拉伸——WKWebView 在 AX 档曾把它拉成 286×334）；
//   万一容器仍然宽高不等，以较短边为单位、居中映射（squareMapping），位图与画布也按较短边做成正方形、object-fit:contain 居中显示，
//   存进数据的笔画不因容器变形而失真；每个书写面只 console.warn 一次。
//   p 只在 pointerType==='pen' 时取（WKWebView 手指 pressure 恒 0，M0-7 实测）。
// 输入：pointer events + setPointerCapture + touch-action:none；getCoalescedEvents 仅在存在时使用
//   （iOS 15–18.1 WebKit 没有，退回原始 pointermove）；非 primary 指针（第二根手指 / 手掌）忽略。
// 中断：pointercancel / lostpointercapture / 原生 shizi-native-back-progress {phase:'began'}（M0-7：识别器触发时
//   WebKit 不发 pointercancel）一律丢弃未完成的当前笔：不固化、不计笔数；已固化层不动。
// pointerdown 一律 preventDefault（M0-7：让原生边缘识别器不开始，作为 backGestureEnabled 门控之外的第二道保护）。
// 换字后的落笔门限（01 §6.6 / 走查-V01；R2-X1 / P227：不再丢笔）：acceptFrom 之前（按事件 timeStamp）落下的笔先「持住」——照常记点，但不画、不通知
// 写字页（提示淡出、结果行收起都不因它而动）；到点（acceptFrom）补开始并接着实时画，或者抬笔时先补开始、再整笔固化——这一笔不丢（时刻编排 M3：250ms 前的落笔缓存、补画）。
// 门限本身由写字页给出（换字后 PEN_ARM_MS = 250ms）。换字 / 换阶段把持住的笔取消（cancelCurrent('reset')）。
// 渲染：同一条管线（core/ink-math buildStroke）实时出点、抬笔用 final=true 结果固化；笔锋基元见 brush.js；
//   减少动态效果或 policy.brushDetail 关闭时不画飞白 / 洇墨，只保留管线本身的首尾锥形（01 §6.3）；不再按核数 / 内存关（P0-A3）。
// 原生书写面 spike（P1-S2，native-ink.js）：只有 DEBUG 原生壳以 -shizi-native-ink 启动、且是写字页那一个书写格（nativeInk）时，
//   落笔与墨交给叠在上面的原生层，这里只收抬笔后的原始点（与网页 onUp 同一路径）；其余情况本文件行为不变。

import { html, useEffect, useLayoutEffect, useRef } from '../../../vendor/ui.js';
import { buildStroke, GRID, INK } from '../../core/ink-math.js';
import { brushDetail } from '../../config/policy.js';
import { brushDetailEnabled, createLayerCache, paintBrushStroke } from './brush.js';
import { eventTime } from '../components/Button.js';
import { injectStyles, T, TEX } from '../components/styles.js';
import { NATIVE_PROGRESS_EVENT } from '../router.js';
import { attachNativeInk, nativeInkEnabled } from './native-ink.js';

export { GRID };

/** 书写格缺省显示尺寸（01 §6.1）；写字页按屏宽 / 视口高算边长后经 size 传入（D36，P118，258–400），内部坐标恒为 GRID=345。 */
export const STD_SIZE = 345;

injectStyles('inkgrid', `
.sz-inkgrid{position:relative;flex:none;align-self:center;box-sizing:border-box;margin:0 auto;
  border:${T.frameW} solid ${T.frame};border-radius:${T.rWork};${TEX};overflow:hidden;
  touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.sz-inkgrid__layer{position:absolute;inset:0;width:100%;height:100%;display:block}
canvas.sz-inkgrid__layer{object-fit:contain}
.sz-inkgrid__guides{pointer-events:none}
.sz-inkgrid__glyph{pointer-events:none}
.sz-inkgrid__ink{pointer-events:none}
.sz-inkgrid__live{touch-action:none;cursor:default}
.sz-inkgrid[data-drawable="true"] .sz-inkgrid__live{cursor:crosshair}
`);

function clockNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function matchMediaSafe(win, query) {
  try {
    return win && typeof win.matchMedia === 'function' ? win.matchMedia(query) : null;
  } catch (error) {
    return null;
  }
}

/**
 * 书写格的正方形映射（纯函数）：以较短边为单位 side，正方形在较长边上居中（ox / oy 为偏移，CSS px）。
 * square：宽高相差不到 1px（亚像素取整不算变形）。
 * @param {{width:number, height:number}} rect
 * @returns {{side:number, ox:number, oy:number, square:boolean}}
 */
export function squareMapping(rect) {
  const w = rect && rect.width > 0 ? rect.width : 1;
  const h = rect && rect.height > 0 ? rect.height : 1;
  const side = Math.min(w, h);
  return { side, ox: (w - side) / 2, oy: (h - side) / 2, square: Math.abs(w - h) < 1 };
}

function inkColorOf(el) {
  try {
    const v = getComputedStyle(el).getPropertyValue('--hand').trim();
    return v || '#221D19';
  } catch (error) {
    return '#221D19';
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
export function createInkSurface({ box, inkCanvas, liveCanvas, win = window, getProps, nativeInk = false }) {
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
  let current = null; // {pointerId, raw:[…], pen, held, timer}
  let native = null; // 原生书写面 spike 接管时的接口（native-ink.js attachNativeInk）
  let raf = 0;
  let color = inkColorOf(box);
  let scale = 1;
  let reported = false; // 宽高不等只上报一次
  const reportShape = rect => {
    if (reported) return;
    reported = true;
    try {
      console.warn('[shizi] ink grid is not square; mapping strokes by the shorter side', Math.round(rect.width), Math.round(rect.height));
    } catch (error) {
      // 没有 console
    }
  };
  const reduceMq = matchMediaSafe(win, '(prefers-reduced-motion: reduce)');
  const darkMq = matchMediaSafe(win, '(prefers-color-scheme: dark)');
  let detail = computeDetail();

  function computeDetail() {
    return brushDetailEnabled({
      reducedMotion: !!(reduceMq && reduceMq.matches),
      enabled: brushDetail,
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
    const map = squareMapping({ width: rect.width || STD_SIZE, height: rect.height || rect.width || STD_SIZE });
    if (!map.square) reportShape(rect);
    const css = Math.max(1, Math.round(map.side));
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
    if (native) native.strokes(next);
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
    const map = squareMapping(rect); // 以较短边为单位、居中（A3-01）：容器变形时笔迹也不变形
    if (!map.square) reportShape(rect);
    const q = {
      x: ((e.clientX - rect.left - map.ox) * GRID) / map.side,
      y: ((e.clientY - rect.top - map.oy) * GRID) / map.side,
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
    if (native) return native.cancel(reason);
    if (!current) return false;
    const pointerId = current.pointerId;
    if (current.timer) win.clearTimeout(current.timer);
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
    if (native) return; // 原生书写层接管落笔
    if (e.isPrimary === false) return; // 第二根手指 / 手掌
    if (e.button !== undefined && e.button > 0) return; // 鼠标右键 / 中键
    if (current) return;
    const p = getProps();
    if (!p.drawable) return;
    const ts = eventTime(e);
    const early = Number.isFinite(p.acceptFrom) && ts < p.acceptFrom; // 换字后 250ms 内：先持住，到点补开始（P227，不丢笔）
    const rect = liveCanvas.getBoundingClientRect();
    current = { pointerId: e.pointerId, raw: [sample(e, rect)], held: early, timer: 0 };
    try {
      liveCanvas.setPointerCapture(e.pointerId);
    } catch (error) {
      // 合成事件或指针已失效：照常写，靠 pointerup / cancel 收尾
    }
    if (early) {
      const stroke = current;
      const wait = Math.max(0, p.acceptFrom - clockNow());
      stroke.timer = win.setTimeout(() => {
        stroke.timer = 0;
        if (current === stroke) release();
      }, wait);
      return;
    }
    if (typeof p.onStrokeStart === 'function') p.onStrokeStart();
    scheduleLive();
  }

  /** 持住的笔到点了（或抬笔时提前）：补开始、补画已记下的点。 */
  function release() {
    if (!current || !current.held) return;
    current.held = false;
    if (current.timer) {
      win.clearTimeout(current.timer);
      current.timer = 0;
    }
    const p = getProps();
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
    if (!current.held) scheduleLive();
  }

  function onUp(e) {
    if (!current || e.pointerId !== current.pointerId) return;
    e.preventDefault();
    release(); // 抬笔时笔还被持住（早于门限抬起）：先补开始，再整笔固化
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

  // 原生书写面 spike：抬笔走与 onUp 相同的固化路径（painted 追加、paintFinal、onStrokeEnd）
  native = nativeInk && nativeInkEnabled(win)
    ? attachNativeInk({
      box,
      inkCanvas,
      liveCanvas,
      win,
      getProps,
      inkColor: () => inkColorOf(box),
      onEnd(raw) {
        painted = painted.concat([raw]);
        paintFinal(raw);
        const p = getProps();
        if (typeof p.onStrokeEnd === 'function') p.onStrokeEnd(raw);
      },
    })
    : null;

  return {
    sync,
    cancelCurrent,
    redraw: () => {
      redrawAll();
      drawLive();
    },
    isDrawing: () => !!current || !!(native && native.isWriting()),
    paintedCount: () => painted.length,
    destroy() {
      cancelRaf();
      current = null;
      if (native) native.destroy();
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
  <line x1=${GRID / 2} y1="0" x2=${GRID / 2} y2=${GRID} stroke="var(--guide)" stroke-width="0.75" stroke-dasharray="4 4"></line>
  <line x1="0" y1=${GRID / 2} x2=${GRID} y2=${GRID / 2} stroke="var(--guide)" stroke-width="0.75" stroke-dasharray="4 4"></line>
</svg>`;

/**
 * 书写格组件（受控）。
 * @param {object} props
 * @param {Array<Array<{x,y,t,p?}>>} props.strokes  已完成的原始笔（按引用比较；尾部追加只画新笔）
 * @param {(raw) => void} [props.onStrokeEnd]  抬笔：一笔原始采样（组件已把它画进固化层；父组件应把它追加进 strokes）
 * @param {() => void} [props.onStrokeStart]  接受了一次落笔（提示淡出 / 结果行收起用，M1-3 / M1-5）
 * @param {(reason:string) => void} [props.onStrokeCancel]  当前笔被中断丢弃
 * @param {boolean} [props.drawable=true]
 * @param {number} [props.acceptFrom]  performance.now() 时钟；早于它（按事件 timeStamp）的落笔先持住、到点补开始 / 补画（不丢笔，P227）
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
      nativeInk: testid === 'write-grid', // 原生书写面 spike 只接写字页的书写格（native-ink.js）
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
    style=${{ width: `${size}px`, height: `${size}px` }}
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
