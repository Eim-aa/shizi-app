// 图片渲染（Canvas2D；阶段 1 P1-E7；交接 §6.3–§6.5；04 §3.2「图片规格」、A05）。
//
// 作品页 renderWorkPage：版式来自 ./layout.js（逻辑画布 1080 宽），整体 × 4/3 → 1440 × 1920（3:4）/ 1440 × 1440（1:1）；
//   一律浅纸（调色板 palette.js，来自浅色令牌，不随系统主题）+ 纸纹（令牌里的两层 SVG 纹理，按导出尺寸放大）；
//   格：外框 2px frame、格间 1.5px guide、直角，墨在格内 12% 内边，线宽按「格的屏幕当量（c ÷ 2.69 pt）」查补偿表；
//   没有本人墨的字（mode 'under'）画参考轮廓、填 under（月字帖 / 年报里该时段没留下笔迹的字）；
//   写错且手动放进来的字带朱点；月图日期角标画在格内左上角（不压格线、没有底色块，V2-09）；
//   落款 song 400 ink2、印白文直角 seal、正放（与屏上 <Seal/> 同一种，不倾斜）；字体在绘制前经注入的 requireFont 确认已加载（§6.5）。
//   导出格式 JPEG 0.92、sRGB（exportCanvas）；纸纹在 PNG 里体积过大。
// 单字手写图片 renderSingleGlyph（A05，详情页「把这个字做成图片」）沿用 glyph-layout.js 的版式，色值同样来自调色板。
// 笔迹：345 单位点列（core/ink-math decodeInk → resampleForReplay）用调用方注入的笔锋（ui/canvas/brush.js paintBrushStroke；
//   core 不依赖 ui，默认退回圆头折线）；参考轮廓取 data/strokes.js 的笔顺数据（调用方注入 loadGlyph）。
// 渲染结果把审计信息写进 canvas.dataset（e2e 断言尺寸 / 成员 / 落款 / recordId）。不读存储、不写存储。

import {
  EXPORT_SCALE, FRAME_W, GUIDE_W, INK_GRID, INK_PAD, LOGICAL_PER_PT, TAG_LEFT, TAG_SIZE, TAG_TOP,
  cellInkBox, dotLayout, inkWidthScale, layout,
} from './layout.js';
import { glyphLayout, inkBounds } from './glyph-layout.js';
import { readLightPalette } from './palette.js';

export const FONTS = Object.freeze({
  label: '-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
  kai: '"ShiziKai","LXGW WenKai GB","Kaiti SC","STKaiti","KaiTi",serif',
  song: '"ShiziSerifSC","Noto Serif SC","Songti SC","STSong",serif',
});

/** JPEG 质量（§6.5）。 */
export const JPEG_QUALITY = 0.92;

const GLYPH_UNITS = 1024;
const GLYPH_BASELINE = 900;
const GLYPH_PAD = 0.06;

export function defaultCanvasFactory(width, height) {
  if (typeof document === 'undefined') throw new Error('CANVAS_UNAVAILABLE');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function makeCanvas(factory, width, height) {
  const canvas = factory(width, height);
  if (!canvas) throw new Error('CANVAS_UNAVAILABLE');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' }) || canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  return { canvas, ctx };
}

function hasPoints(points) {
  return Array.isArray(points) && points.some(s => Array.isArray(s) && s.length);
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

/**
 * 在 (x, y) 起边长 size 的方框里画一份本人笔迹（345 单位点列）。线宽乘 widthScale（补偿表）。
 * 用相对变换（save / translate / scale），可以叠在已有缩放（导出 × 4/3、屏幕 DPR）上。返回画了几笔。
 */
export function paintHand(ctx, points, { x, y, size, color, widthScale = 1, paintStroke = null }) {
  const paint = typeof paintStroke === 'function' ? paintStroke : simpleStroke;
  const k = size / INK_GRID;
  let n = 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  for (const stroke of points || []) {
    if (!Array.isArray(stroke) || !stroke.length) continue;
    const scaled = widthScale === 1 ? stroke : stroke.map(p => ({ ...p, w: (Number.isFinite(p.w) && p.w > 0 ? p.w : 11.5) * widthScale }));
    if (paint(ctx, scaled, { color, base: 11.5 * widthScale, detail: false }) !== false) n += 1;
  }
  ctx.restore();
  return n;
}

/** 参考字形轮廓（hanzi-writer 数据：1024 单位、y 向上、基线 900）画进 (x, y) 起边长 size 的方框，填 color。返回是否画了。 */
export function paintOutline(ctx, data, { x, y, size, color }) {
  if (!data || !Array.isArray(data.strokes) || typeof Path2D !== 'function') return false;
  const pad = size * GLYPH_PAD;
  const k = (size - 2 * pad) / GLYPH_UNITS;
  ctx.save();
  ctx.translate(x + pad, y + pad + GLYPH_BASELINE * k);
  ctx.scale(k, -k);
  ctx.fillStyle = color;
  for (const d of data.strokes) ctx.fill(new Path2D(d));
  ctx.restore();
  return true;
}

/** 没有笔顺数据时的衬底字：楷体整字，字面占方框 80%，居中。 */
export function paintFallbackGlyph(ctx, ch, { x, y, size, color }) {
  if (!ch || typeof ctx.fillText !== 'function') return false;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `400 ${Math.round(size * 0.8)}px ${FONTS.kai}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, x + size / 2, y + size * 0.54);
  ctx.restore();
  return true;
}

/**
 * 画一格的内容（不含格线）：有墨画本人笔迹，没墨画 under 衬底。返回 {strokes, bounds}（bounds = 墨迹外框，345 单位，朱点定位用）。
 * @param {object} cell  {ch, ink: 点列|null, mode: 'hand'|'under'}
 * @param {{x:number,y:number,c:number}} box  格的左上与边长（当前 ctx 的单位）
 * @param {{palette, unit:number, paintStroke?, glyphs?:Map<string,object>, pad?:number}} o  unit = 每 pt 几个单位（屏幕 1；逻辑画布 2.69）；pad = 内边比例（缺省 12%）
 */
export function paintCellContent(ctx, cell, box, { palette, unit, paintStroke = null, glyphs = null, pad = INK_PAD }) {
  const inner = cellInkBox(box.c, pad);
  const at = { x: box.x + inner.ox, y: box.y + inner.oy, size: inner.size };
  if (cell.mode !== 'under' && hasPoints(cell.ink)) {
    const widthScale = inkWidthScale(box.c / unit);
    const strokes = paintHand(ctx, cell.ink, { ...at, color: palette.hand, widthScale, paintStroke });
    return { strokes, bounds: inkBounds(cell.ink) };
  }
  const data = glyphs ? glyphs.get(cell.ch) : null;
  // 练习字统一用轮廓（P1-E2，D33）；取不到笔顺数据（10.13）才退回楷体整字，同样填 under（与写字页参考卡的回退同一取舍）
  if (paintOutline(ctx, data, { ...at, color: palette.under })) return { strokes: 0, bounds: null, glyph: 'outline' };
  paintFallbackGlyph(ctx, cell.ch, { ...at, color: palette.under });
  return { strokes: 0, bounds: null, glyph: 'fallback' };
}

function paintDot(ctx, box, cell, bounds, { palette, unit }) {
  const { cx, cy, d } = dotLayout(box.c, unit, bounds);
  ctx.save();
  ctx.fillStyle = palette.zhu;
  ctx.beginPath();
  ctx.arc(box.x + cx, box.y + cy, d / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 字距 .16em 的单行文字；返回总宽。align='left' 从 x 起，'right' 到 x 止。 */
export function drawTracked(ctx, text, x, baseline, { font, size, tracking = 0.16, color, align = 'left', weight = 400 }) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
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

/** 印：白文、直角、seal 底、正放；内缩 7% 一圈 onSeal 细线（与 marks.js 的屏上印 <Seal/> 同款；R2-R1：印只有一种，不倾斜）。 */
export function drawSeal(ctx, { x, y, size, rotate = 0 }, { text, palette, font = FONTS.kai }) {
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.fillStyle = palette.seal;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  const inset = size * 0.07;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = palette.onSeal;
  ctx.lineWidth = Math.max(1, size / 40);
  ctx.strokeRect(-size / 2 + inset, -size / 2 + inset, size - 2 * inset, size - 2 * inset);
  ctx.restore();
  if (text) {
    ctx.fillStyle = palette.onSeal;
    ctx.font = `400 ${Math.round(size * 0.66)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, size * 0.03);
  }
  ctx.restore();
}

/** 落款：song 400、ink2，右对齐到 right，垂直居中于 [top, top + lineHeight]。返回文字宽。 */
export function drawKuan(ctx, text, { right, top, size, lineHeight }, { palette, fonts = FONTS, align = 'right' }) {
  ctx.save();
  ctx.font = `400 ${size}px ${fonts.song}`;
  ctx.fillStyle = palette.ink2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.fillText(text, right, top + lineHeight / 2);
  const width = ctx.measureText(text).width;
  ctx.restore();
  return width;
}

// ---------------------------------------------------------------- 纸

/** 加载纸纹图片（令牌里的 SVG data URL；导出图的调色板不带纹理，D51 ⑥）。无 Image / 解码失败的那一层跳过。 */
export async function loadTextures(palette, { imageFactory = null } = {}) {
  const make = imageFactory || (typeof Image === 'function' ? () => new Image() : null);
  if (!make || !palette.textures || !palette.textures.length) return [];
  const out = [];
  for (const url of palette.textures) {
    try {
      const img = make();
      img.src = url;
      if (typeof img.decode === 'function') await img.decode();
      out.push(img);
    } catch (error) {
      out.push(null);
    }
  }
  return out;
}

/** 画纸：sheet 底 + 纹理（瓦片 = 令牌尺寸 × 2.69，逻辑 1080 上颗粒 645）；导出图的调色板 textures 为空时就是平涂笺色（D51 ⑥）。 */
export function paintPaper(ctx, W, H, palette, textures = []) {
  ctx.save();
  ctx.fillStyle = palette.sheet;
  ctx.fillRect(0, 0, W, H);
  textures.forEach((img, i) => {
    if (!img) return;
    const tile = (palette.tiles && palette.tiles[i] ? palette.tiles[i] : 240) * LOGICAL_PER_PT;
    for (let y = 0; y < H; y += tile) for (let x = 0; x < W; x += tile) ctx.drawImage(img, x, y, tile, tile);
  });
  ctx.restore();
}

export function setDataset(canvas, meta) {
  if (!canvas || !canvas.dataset) return;
  for (const [k, v] of Object.entries(meta)) canvas.dataset[k] = v == null ? '' : String(v);
}

// ---------------------------------------------------------------- 作品页

/**
 * 渲染一页作品（结果页分享图 / 月字帖 / 年报月页）。
 * @param {object} o
 * @param {Array<{ch:string, ink?:Array|null, mode?:'hand'|'under', dot?:boolean, tag?:string, record?:{id:string}}>} o.cells
 * @param {'3:4'|'1:1'} [o.ratio]
 * @param {string} o.kuan        单行落款（汉字日期 + 全角空格 + 汉字字数 [+ 全角空格 + 其一 / 其二]）
 * @param {string} o.sealText    印上的字
 * @param {object} [o.palette]   缺省读浅色令牌（palette.js）
 * @param {number} [o.scale]     逻辑 → 导出倍率，缺省 4/3
 * @param {Function} [o.canvasFactory]  (w, h) => canvas
 * @param {Function} [o.paintStroke]    ui/canvas/brush.js paintBrushStroke
 * @param {Function} [o.requireFont]    async (fontStack, text) => any（data/font-loader.js requireCanvasFont）
 * @param {Function} [o.loadGlyph]      async (ch) => 笔顺数据 | null（data/strokes.js loadStrokes）；under 格要用
 * @param {object} [o.meta]
 * @returns {Promise<{status:'ready'|'empty', canvas, layout, cells}>}
 */
export async function renderWorkPage({
  cells, ratio = '3:4', kuan, sealText, palette = null, scale = EXPORT_SCALE, canvasFactory = defaultCanvasFactory,
  paintStroke = null, requireFont = null, loadGlyph = null, imageFactory = null, fonts = FONTS, meta = {},
}) {
  const L = layout(cells, ratio);
  if (L.n === 0) return { status: 'empty', canvas: null, layout: L, cells: [] };
  if (typeof kuan !== 'string' || !kuan || /\n/.test(kuan)) throw new Error('SINGLE_LINE_SIGNATURE_REQUIRED');
  const pal = palette || readLightPalette();
  const tags = cells.map(c => c.tag || '').join('');
  if (typeof requireFont === 'function') {
    await requireFont(fonts.song, kuan);
    if (sealText) await requireFont(fonts.kai, sealText);
    if (tags) await requireFont(fonts.label, tags, { weight: 500 });
  }
  const glyphs = new Map();
  if (typeof loadGlyph === 'function') {
    for (const cell of cells) {
      if (cell.mode === 'under' && !glyphs.has(cell.ch)) {
        try {
          glyphs.set(cell.ch, await loadGlyph(cell.ch));
        } catch (error) {
          glyphs.set(cell.ch, null);
        }
      }
    }
  }
  const textures = await loadTextures(pal, { imageFactory });
  const { canvas, ctx } = makeCanvas(canvasFactory, Math.round(L.W * scale), Math.round(L.H * scale));
  ctx.scale(scale, scale);
  paintPaper(ctx, L.W, L.H, pal, textures);

  // 格内容与朱点
  const drawn = [];
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    const box = { x: L.cells[i].x, y: L.cells[i].y, c: L.c };
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.c, box.c);
    ctx.clip();
    const res = paintCellContent(ctx, cell, box, { palette: pal, unit: LOGICAL_PER_PT, paintStroke, glyphs });
    ctx.restore();
    if (cell.dot) paintDot(ctx, box, cell, res.bounds, { palette: pal, unit: LOGICAL_PER_PT });
    drawn.push({ index: i, ch: cell.ch, mode: cell.mode || 'hand', strokes: res.strokes, dot: !!cell.dot, tag: cell.tag || '',
      recordId: cell.record ? cell.record.id : null, x: box.x, y: box.y });
  }

  // 格间线：只画存在的格子之间的边（末行不满不画空格）
  ctx.save();
  ctx.strokeStyle = pal.guide;
  ctx.lineWidth = GUIDE_W;
  ctx.beginPath();
  for (let i = 0; i < L.n; i += 1) {
    const { x, y } = L.cells[i];
    if ((i + 1) % L.cols !== 0 && i + 1 < L.n) {
      ctx.moveTo(x + L.c, y);
      ctx.lineTo(x + L.c, y + L.c);
    }
    if (i + L.cols < L.n) {
      ctx.moveTo(x, y + L.c);
      ctx.lineTo(x + L.c, y + L.c);
    }
  }
  ctx.stroke();
  ctx.restore();
  // 外框
  ctx.save();
  ctx.strokeStyle = pal.frame;
  ctx.lineWidth = FRAME_W;
  for (const r of L.frame) ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.restore();

  // 日期角标：每天第一个字的格内左上角，ink3、不画底色块、不碰格线（V2-09 / T2-05：角标与排序同一个日子，数字只增不减）
  if (tags) {
    ctx.save();
    ctx.font = `500 ${TAG_SIZE}px ${fonts.label}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.ink3;
    for (let i = 0; i < cells.length; i += 1) {
      const tag = cells[i].tag;
      if (!tag) continue;
      const { x, y } = L.cells[i];
      ctx.fillText(tag, x + TAG_LEFT, y + TAG_TOP + TAG_SIZE / 2);
    }
    ctx.restore();
  }

  const kuanWidth = drawKuan(ctx, kuan, L.kuan, { palette: pal, fonts });
  drawSeal(ctx, L.seal, { text: sealText, palette: pal, font: fonts.kai });
  setDataset(canvas, {
    ratio,
    width: canvas.width,
    height: canvas.height,
    logicalWidth: L.W,
    logicalHeight: L.H,
    columns: L.cols,
    rows: L.rows,
    cell: L.c,
    n: L.n,
    members: cells.map(c => c.ch).join(''),
    modes: cells.map(c => (c.mode === 'under' ? 'u' : 'h')).join(''),
    dots: cells.map(c => (c.dot ? '1' : '0')).join(''),
    recordIds: drawn.map(c => c.recordId || '').join(','),
    tags: cells.map(c => c.tag || '').join('|'),
    signature: kuan,
    top: L.top,
    ...meta,
  });
  return { status: 'ready', canvas, layout: L, cells: drawn, signatureWidth: kuanWidth };
}

/** 导出：canvas → JPEG dataURL（质量 0.92，sRGB，§6.5）。 */
export function exportDataURL(canvas, { quality = JPEG_QUALITY, type = 'image/jpeg' } = {}) {
  return canvas.toDataURL(type, quality);
}

// ---------------------------------------------------------------- 单字手写图片（A05）

/**
 * 单字手写图片（A05）：最近一次没有笔迹 → status 'noInk'，不生成。
 * @param {{points:Array, caption:string, signatureText:string, sealText:string, ratio?, palette?, canvasFactory?, paintStroke?, requireFont?, meta?}} o
 */
export async function renderSingleGlyph({
  points, caption, signatureText, sealText, ratio = 'portrait', palette = null, canvasFactory = defaultCanvasFactory,
  paintStroke = null, requireFont = null, imageFactory = null, fonts = FONTS, meta = {},
}) {
  const layoutBox = glyphLayout(inkBounds(points), ratio);
  if (layoutBox.status !== 'ready') return { status: layoutBox.status, canvas: null, layout: layoutBox };
  if (typeof requireFont === 'function') {
    await requireFont(fonts.label, `${caption || ''}${signatureText || ''}`);
    if (sealText) await requireFont(fonts.kai, sealText);
  }
  const pal = palette || readLightPalette();
  const textures = await loadTextures(pal, { imageFactory });
  const { canvas, ctx } = makeCanvas(canvasFactory, layoutBox.width, layoutBox.height);
  paintPaper(ctx, layoutBox.width, layoutBox.height, pal, textures);
  ctx.save();
  ctx.translate(layoutBox.ox, layoutBox.oy);
  ctx.scale(layoutBox.k, layoutBox.k);
  let strokes = 0;
  const paint = typeof paintStroke === 'function' ? paintStroke : simpleStroke;
  for (const stroke of points || []) {
    if (!Array.isArray(stroke) || !stroke.length) continue;
    if (paint(ctx, stroke, { color: pal.hand, base: 11.5, detail: false }) !== false) strokes += 1;
  }
  ctx.restore();
  if (caption) {
    ctx.save();
    ctx.fillStyle = pal.ink2;
    ctx.font = `400 ${layoutBox.info.font}px ${fonts.label}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, layoutBox.info.centerX, layoutBox.info.top + layoutBox.info.line / 2);
    ctx.restore();
  }
  if (signatureText) {
    drawTracked(ctx, signatureText, layoutBox.signature.right, layoutBox.signature.baseline, {
      font: fonts.label, size: layoutBox.signature.font, tracking: layoutBox.signature.tracking, color: pal.ink2, align: 'right',
    });
  }
  drawSeal(ctx, layoutBox.seal, { text: sealText, palette: pal, font: fonts.kai });
  setDataset(canvas, {
    ratio,
    width: layoutBox.width,
    height: layoutBox.height,
    n: 1,
    strokes,
    caption: caption || '',
    signature: signatureText || '',
    glyphWidth: Math.round(layoutBox.glyph.width),
    glyphHeight: Math.round(layoutBox.glyph.height),
    ...meta,
  });
  return { status: 'ready', canvas, layout: layoutBox, strokes };
}

