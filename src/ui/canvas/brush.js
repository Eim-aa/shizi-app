// 笔锋渲染基元（01-架构设计 §6.3）：从旧版 index.html:2196–2222（main 639f592）抽取为纯函数。
//
// 保留（决定-D10「沿现有处理」）：两点间色带 + 末端圆（paintBrushRibbon）、洇墨径向渐变（paintInkBloom）、
//   快笔飞白（destination-out 虚线擦）、停顿洇墨、每笔先画到独立层再合成（飞白不擦到已有墨）、
//   细节开关（减少动态效果或 policy.brushDetail 关闭时只保留首尾锥形；不再按核数 / 内存关，P0-A3 / G15，见 brushDetailEnabled）。
// 改动：
//   - 宽度不再在这里算：旧 brushWidthFor / brushStrokeGeometry 的速度→宽度、EMA、首尾锥形被新管线
//     core/ink-math.js buildStroke 取代（决定-D09，交接备注八.1）；本模块直接用点上的绝对宽 w。
//   - 不读全局：颜色、细节开关、离屏层工厂一律由参数给；无副作用写回点对象（旧 brushWidthFor 会改 point.w/v）。
//   - 坏点（非有限坐标）返回 false 不抛（旧版 paintBrushStroke 的输入校验）。
// 坐标 / 宽度单位与调用方 ctx 的当前变换一致（写字页用 345 单位空间 + DPR 缩放变换）。

/**
 * 细节（飞白 / 洇墨）是否开启：只看「减少动态效果」与显式开关 enabled（policy.brushDetail，P111）。
 * 旧版还看 navigator.hardwareConcurrency 与 deviceMemory（核数 ≤ 2 或内存 ≤ 2GB 就关）——iOS WebKit 为防指纹会钳低这两个值，
 * 真机可能把细节全部关掉（ADA G15），所以不再读它们；传进来也忽略。
 * 性能保护：现不做；若 T1 真机测量发现低端机掉帧，改为运行时测帧时间自适应（连续 N 帧 > 24ms 就关），不再猜硬件。
 */
export function brushDetailEnabled({ reducedMotion = false, enabled = true } = {}) {
  return enabled !== false && !reducedMotion;
}

function finitePoint(p) {
  return !!p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function widthOf(p, base) {
  return Number.isFinite(p.w) && p.w > 0 ? p.w : base;
}

/** 两点间四边形色带 + 末端圆（ra / rb 为半宽）。 */
export function paintBrushRibbon(ctx, a, b, ra, rb) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const nx = -dy / length;
  const ny = dx / length;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
  ctx.lineTo(b.x + nx * rb, b.y + ny * rb);
  ctx.lineTo(b.x - nx * rb, b.y - ny * rb);
  ctx.lineTo(a.x - nx * ra, a.y - ny * ra);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(b.x, b.y, rb, 0, Math.PI * 2);
  ctx.fill();
}

/** 洇墨：半径外扩 0.8–2 单位的径向渐变，α .11。 */
export function paintInkBloom(ctx, point, radius, color) {
  const spread = Math.min(2, Math.max(0.8, radius * 0.14));
  const gradient = ctx.createRadialGradient(point.x, point.y, Math.max(0, radius - spread), point.x, point.y, radius + spread);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.72, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = 0.11;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius + spread, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 离屏层缓存（旧 brushStrokeLayer / compositeBrushLayer）：每个目标 canvas 一张同尺寸透明层。
 * createCanvas(width, height) 由调用方给（浏览器里 document.createElement('canvas')）。
 */
export function createLayerCache(createCanvas) {
  const cache = new WeakMap();
  return {
    /** 取与 ctx.canvas 同尺寸、已清空、变换同步的离屏层；拿不到返回 null（直接画在 ctx 上）。 */
    take(ctx) {
      const target = ctx && ctx.canvas;
      if (!target || !target.width || !target.height || typeof ctx.getTransform !== 'function' || typeof createCanvas !== 'function') return null;
      let layer = cache.get(target);
      if (!layer || layer.canvas.width !== target.width || layer.canvas.height !== target.height) {
        const canvas = createCanvas(target.width, target.height);
        const lctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
        if (!lctx) return null;
        layer = { canvas, ctx: lctx };
        cache.set(target, layer);
      }
      const l = layer.ctx;
      l.setTransform(1, 0, 0, 1, 0, 0);
      l.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      l.globalAlpha = 1;
      l.globalCompositeOperation = 'source-over';
      if (typeof l.setLineDash === 'function') l.setLineDash([]);
      l.setTransform(ctx.getTransform());
      return layer;
    },
    composite(ctx, layer) {
      if (!layer) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    },
  };
}

/**
 * 画一整笔（旧 paintBrushStroke 的新签名）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x,y,w,t?}>} points  管线输出（绝对宽 w）
 * @param {object} options
 * @param {string} options.color
 * @param {number} [options.base=11.5]  本体宽（飞白阈值、缺 w 时的兜底宽）
 * @param {boolean} [options.detail=false]  飞白 / 洇墨（调用方用 brushDetailEnabled 算）
 * @param {{take:Function, composite:Function}} [options.layers]  离屏层；给了就每笔先画到独立层再合成
 * @returns {boolean} 画了返回 true；坏输入返回 false
 */
export function paintBrushStroke(ctx, points, options = {}) {
  if (!ctx || !Array.isArray(points) || !points.length || !points.every(finitePoint)) return false;
  const base = Number.isFinite(options.base) && options.base > 0 ? options.base : 11.5;
  const color = options.color || '#3B2F28';
  const detail = options.detail === true;
  const layers = options.layers || null;
  const layer = layers ? layers.take(ctx) : null;
  const bctx = layer ? layer.ctx : ctx;
  const r0 = Math.max(0.5, widthOf(points[0], base) / 2);
  bctx.save();
  bctx.fillStyle = color;
  if (detail) paintInkBloom(bctx, points[0], r0, color);
  bctx.beginPath();
  bctx.arc(points[0].x, points[0].y, r0, 0, Math.PI * 2);
  bctx.fill();
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const ra = Math.max(0.5, widthOf(a, base) / 2);
    const rb = Math.max(0.5, widthOf(b, base) / 2);
    paintBrushRibbon(bctx, a, b, ra, rb);
    if (!detail) continue;
    const dt = (Number(b.t) || 0) - (Number(a.t) || 0);
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (dt > 52) paintInkBloom(bctx, b, rb, color); // 停顿洇墨
    const velocity = dt > 0 ? seg / dt : 0;
    if (velocity > 1.05 && seg > base * 0.35) {
      // 快笔飞白：在本笔自己的层上用 destination-out 擦出虚线（不擦到别的笔）
      bctx.save();
      bctx.globalCompositeOperation = 'destination-out';
      bctx.globalAlpha = Math.min(0.2, 0.07 + (velocity - 1.05) * 0.05);
      bctx.strokeStyle = '#000';
      bctx.lineWidth = Math.max(0.65, (ra + rb) * 0.12);
      bctx.lineCap = 'round';
      bctx.setLineDash([Math.max(1, base * 0.42), Math.max(2, base * 0.72)]);
      bctx.lineDashOffset = -(i % 3) * base * 0.23;
      bctx.beginPath();
      bctx.moveTo(a.x, a.y);
      bctx.lineTo(b.x, b.y);
      bctx.stroke();
      bctx.restore();
    }
  }
  bctx.restore();
  if (layer) layers.composite(ctx, layer);
  return true;
}
