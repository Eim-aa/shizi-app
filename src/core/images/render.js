// 图片渲染（Canvas2D；02 M4-5；01 §10；04 §3.2「图片规格」、R-I01–R-I04、A05）。
//
// 从 #180 handoff/r8-foundation/module/render.mjs（origin/pr-180）抽取改造：
//   - 版式来自 ./layout.js（竖版从顶端排，T06-C）；只画有笔迹的字（P50 / 10.12），不画浅参考、不借别次笔迹；
//   - 格线按冻结原型 imgEl（外框上 / 左 + 每格右 / 下，1pt = 3px，#A6533F47），不画 #180 的格内虚线十字；
//   - 笔迹：345 单位点列（core/ink-math decodeInk → resampleForReplay）按格缩放，用调用方注入的笔锋（ui/canvas/brush.js
//     paintBrushStroke，detail 关闭 = 与小卡 InkMini 同一画法；core 不依赖 ui，默认退回简单圆头折线）；
//   - 落款单行（放不下报错，不偷偷截断）+ −3° 小印（原型 26pt 红印白字「字」，导出 78px）；
//   - 新增 renderSingleGlyph（A05）：不画格子，墨迹外框约占画面宽 60%，字下「拼音 · 日期」，右下「拾字」+ 印。
// 画布一律浅色纸面（原型 imgEl / charEl 永远 TH.light）；不读存储、不写存储。
// 字体（01 §8.4 canvas 绘制前 requireFont；M5-2）：core 不依赖浏览器字体 API，由调用方注入 requireFont(fontStack, text)——
//   ui/images-entry.js 传 src/data/font-loader.js 的 requireCanvasFont（本包字体精确字重加载 + 覆盖检查，系统字体栈直接放行，
//   字体失败只 warn、按字体栈回退绘制）；绘制前对落款 / 角标（fonts.label）与印字（fonts.kai = ShiziKai 400）各 await 一次。
//   未注入时不等待（单测与 node 下用）。
// 渲染结果把审计信息写进 canvas.dataset（e2e 断言 PNG 尺寸与成员 / 落款 / recordId）。

import { cellInkTransform, glyphLayout, inkBounds, sheetLayout } from './layout.js';

export const TOKENS = Object.freeze({
  paper: '#FBF8F2', // 原型 TH.light --c（imgEl / charEl 背景）
  ink: '#3B2F28', // --i1
  muted: '#5D5952', // 落款 / 信息行（原型 #5D5952）
  red: '#A6533F', // 角标、印（原型 #A6533F）
  grid: 'rgba(166,83,63,.28)', // #A6533F47
  sealText: '#FFF9F1',
});

export const FONTS = Object.freeze({
  label: '-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
  kai: '"ShiziKai","LXGW WenKai GB","Kaiti SC","STKaiti","KaiTi",serif',
});

const GRID_UNITS = 345;
const LINE = 3; // 1pt

function defaultCanvasFactory(width, height) {
  if (typeof document === 'undefined') throw new Error('CANVAS_UNAVAILABLE');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** 没有注入笔锋时的兜底：圆头折线（宽 = 点上的绝对宽）。 */
function simpleStroke(ctx, points, { color }) {
  if (!points.length) return false;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const w = Number.isFinite(p.w) && p.w > 0 ? p.w : 11.5;
    if (i === 0) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const a = points[i - 1];
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.restore();
  return true;
}

function makeCanvas(factory, width, height) {
  const canvas = factory(width, height);
  if (!canvas) throw new Error('CANVAS_UNAVAILABLE');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  return { canvas, ctx };
}

/** 画一份笔迹（345 单位点列）到变换 {k, ox, oy}。返回画了几笔。 */
export function drawInk(ctx, points, { k, ox, oy }, { paintStroke = null, color = TOKENS.ink } = {}) {
  const paint = typeof paintStroke === 'function' ? paintStroke : simpleStroke;
  let n = 0;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, ox, oy);
  for (const stroke of points || []) {
    if (!Array.isArray(stroke) || !stroke.length) continue;
    if (paint(ctx, stroke, { color, base: 11.5, detail: false }) !== false) n += 1;
  }
  ctx.restore();
  return n;
}

/** 字距 .16em 的单行文字；返回总宽。align='left' 从 x 起，'right' 到 x 止。 */
export function drawTracked(ctx, text, x, baseline, { font, size, tracking = 0.16, color, align = 'left' }) {
  ctx.save();
  ctx.font = `400 ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const chars = Array.from(text);
  const spacing = size * tracking;
  const widths = chars.map(ch => ctx.measureText(ch).width);
  const total = widths.reduce((s, w) => s + w, 0) + Math.max(0, chars.length - 1) * spacing;
  let tx = align === 'right' ? x - total : x;
  chars.forEach((ch, i) => {
    ctx.fillText(ch, tx, baseline);
    tx += widths[i] + spacing;
  });
  ctx.restore();
  return total;
}

/** 小印：26pt 红底圆角 3pt、白字楷体 16pt、旋 −3°（原型 imgEl / charEl）。 */
export function drawSeal(ctx, { x, y, size, rotate = -3 }, { text, font = FONTS.kai } = {}) {
  const r = size * (3 / 26);
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.fillStyle = TOKENS.red;
  ctx.beginPath();
  const h = size / 2;
  ctx.moveTo(-h + r, -h);
  ctx.lineTo(h - r, -h);
  ctx.quadraticCurveTo(h, -h, h, -h + r);
  ctx.lineTo(h, h - r);
  ctx.quadraticCurveTo(h, h, h - r, h);
  ctx.lineTo(-h + r, h);
  ctx.quadraticCurveTo(-h, h, -h, h - r);
  ctx.lineTo(-h, -h + r);
  ctx.quadraticCurveTo(-h, -h, -h + r, -h);
  ctx.closePath();
  ctx.fill();
  if (text) {
    ctx.fillStyle = TOKENS.sealText;
    ctx.font = `400 ${Math.round(size * (16 / 26))}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
  }
  ctx.restore();
}

function setDataset(canvas, meta) {
  if (!canvas || !canvas.dataset) return;
  for (const [k, v] of Object.entries(meta)) canvas.dataset[k] = v == null ? '' : String(v);
}

/**
 * 字帖 / 这次的图片。
 * @param {object} o
 * @param {Array<{char:string, points:Array, tag?:string, record?:{id:string}}>} o.items  图上的格子（已去掉缺墨，P50）
 * @param {'portrait'|'square'} [o.ratio]
 * @param {string} o.signature  单行落款（汉字数字，R-I01 / R-P03）
 * @param {string} o.sealText   印上的字
 * @param {number} [o.maxChars]  policy.imageMaxChars（P25）
 * @param {Function} [o.canvasFactory]  (w, h) => canvas
 * @param {Function} [o.paintStroke]    ui/canvas/brush.js paintBrushStroke
 * @param {Function} [o.requireFont]    async (fontStack, text) => any；页面传 data/font-loader.js requireCanvasFont（M5-2）
 * @param {object} [o.meta]  额外写进 canvas.dataset 的审计字段
 * @returns {Promise<{status:'ready'|'empty'|'pending', canvas:HTMLCanvasElement|null, layout, cells}>}
 */
export async function renderSheet({
  items, ratio = 'portrait', signature, sealText, maxChars, canvasFactory = defaultCanvasFactory,
  paintStroke = null, requireFont = null, fonts = FONTS, meta = {},
}) {
  const layout = sheetLayout(items.length, ratio, maxChars == null ? {} : { maxChars });
  if (layout.status !== 'ready') return { status: layout.status, canvas: null, layout, cells: [] };
  if (typeof signature !== 'string' || !signature || /\n/.test(signature)) throw new Error('SINGLE_LINE_SIGNATURE_REQUIRED');
  if (typeof requireFont === 'function') {
    await requireFont(fonts.label, signature + items.map(i => i.tag || '').join(''));
    if (sealText) await requireFont(fonts.kai, sealText);
  }
  const { canvas, ctx } = makeCanvas(canvasFactory, layout.width, layout.height);
  ctx.fillStyle = TOKENS.paper;
  ctx.fillRect(0, 0, layout.width, layout.height);
  const { cell, top, columns, rows, margin } = layout;
  // 格线：外框上 / 左 + 每格右 / 下（原型 imgEl），末行空格也画完整。
  ctx.save();
  ctx.strokeStyle = TOKENS.grid;
  ctx.lineWidth = LINE;
  ctx.beginPath();
  for (let c = 0; c <= columns; c += 1) {
    const x = margin + c * cell;
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + rows * cell);
  }
  for (let r = 0; r <= rows; r += 1) {
    const y = top + r * cell;
    ctx.moveTo(margin, y);
    ctx.lineTo(margin + columns * cell, y);
  }
  ctx.stroke();
  ctx.restore();
  const cells = [];
  for (let i = 0; i < items.length; i += 1) {
    const box = layout.cells[i];
    const item = items[i];
    const tagged = !!item.tag;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x + LINE / 2, box.y + LINE / 2, cell - LINE, cell - LINE);
    ctx.clip();
    const strokes = drawInk(ctx, item.points, cellInkTransform(layout, box, tagged, GRID_UNITS), { paintStroke });
    ctx.restore();
    if (tagged) {
      ctx.save();
      ctx.fillStyle = TOKENS.red;
      ctx.font = `400 ${layout.dateFont}px ${fonts.label}`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(item.tag, box.x + layout.dateLeft, box.y + layout.dateTop + (layout.dateLine - layout.dateFont) / 2);
      ctx.restore();
    }
    cells.push({ index: i, char: item.char, tag: item.tag || '', recordId: item.record ? item.record.id : null, strokes, x: box.x, y: box.y });
  }
  // 落款 + 印（T06-C：紧跟最后一行下方 40px）
  ctx.save();
  ctx.font = `400 ${layout.signature.font}px ${fonts.label}`;
  const width = drawTracked(ctx, signature, layout.signature.x, layout.signature.baseline, {
    font: fonts.label, size: layout.signature.font, tracking: layout.signature.tracking, color: TOKENS.muted,
  });
  ctx.restore();
  if (width > layout.signature.maxWidth) throw new Error('SIGNATURE_TOO_LONG');
  drawSeal(ctx, layout.seal, { text: sealText, font: fonts.kai });
  setDataset(canvas, {
    ratio,
    width: layout.width,
    height: layout.height,
    columns,
    rows,
    n: items.length,
    members: items.map(i => i.char).join(''),
    recordIds: cells.map(c => c.recordId || '').join(','),
    tags: items.map(i => i.tag || '').join('|'),
    signature,
    top: layout.top,
    footerTop: layout.footerTop,
    ...meta,
  });
  return { status: 'ready', canvas, layout, cells, signatureWidth: width };
}

/**
 * 单字手写图片（A05）：最近一次没有笔迹 → status 'noInk'，不生成。
 * @param {{points:Array, caption:string, signatureText:string, sealText:string, ratio?, canvasFactory?, paintStroke?, requireFont?, meta?}} o
 */
export async function renderSingleGlyph({
  points, caption, signatureText, sealText, ratio = 'portrait', canvasFactory = defaultCanvasFactory,
  paintStroke = null, requireFont = null, fonts = FONTS, meta = {},
}) {
  const layout = glyphLayout(inkBounds(points), ratio);
  if (layout.status !== 'ready') return { status: layout.status, canvas: null, layout };
  if (typeof requireFont === 'function') {
    await requireFont(fonts.label, `${caption || ''}${signatureText || ''}`);
    if (sealText) await requireFont(fonts.kai, sealText);
  }
  const { canvas, ctx } = makeCanvas(canvasFactory, layout.width, layout.height);
  ctx.fillStyle = TOKENS.paper;
  ctx.fillRect(0, 0, layout.width, layout.height);
  const strokes = drawInk(ctx, points, layout, { paintStroke });
  if (caption) {
    ctx.save();
    ctx.fillStyle = TOKENS.muted;
    ctx.font = `400 ${layout.info.font}px ${fonts.label}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, layout.info.centerX, layout.info.top + layout.info.line / 2);
    ctx.restore();
  }
  if (signatureText) {
    drawTracked(ctx, signatureText, layout.signature.right, layout.signature.baseline, {
      font: fonts.label, size: layout.signature.font, tracking: layout.signature.tracking, color: TOKENS.muted, align: 'right',
    });
  }
  drawSeal(ctx, layout.seal, { text: sealText, font: fonts.kai });
  setDataset(canvas, {
    ratio,
    width: layout.width,
    height: layout.height,
    n: 1,
    strokes,
    caption: caption || '',
    signature: signatureText || '',
    glyphWidth: Math.round(layout.glyph.width),
    glyphHeight: Math.round(layout.glyph.height),
    ...meta,
  });
  return { status: 'ready', canvas, layout, strokes };
}
