// 年报的图（Canvas2D；阶段 1 P1-E7；交接 §8；D27 / D39 / D46 ⑦ ⑧；设计稿「作品出口」§四）。
//
//   renderAnnualCover   册页卷首（3:4）：「二〇二六」、「这一年，你写过二百九十个字。」、今年第一个字（单格 + 「今年第一个字 / 四月二十六日的笔迹」）、品牌印 + 「拾字　年报」
//   renderAnnualTail    册页卷尾（3:4）：「同一个字，两次」、第一次与最近一次两格并排（D27）、各自日期、印 + 「二〇二六年十月」
//   renderAnnualLong    「存成一张长图」（可选例外，D46 ⑦）：宽 1440、高按内容，不受 80 字上限；总高超过 maxExportHeight 时按月切成几张（月内再多也按行切，不截字）
//   册页里的每月一页就是月字帖（render.js renderWorkPage，每月超过 80 字按 D39 分张），不在本文件。
// 版式数字（逻辑 1080 宽，导出 × 4/3）来自设计稿 作品出口.html 的 cover / tail；颜色一律来自浅色令牌（palette.js）；字体 song 在绘制前确认加载。
// 不读存储、不写存储；canvas 的审计信息写进 dataset（page / kind / members）。

import { EXPORT_SCALE, FRAME_W, LOGICAL_PER_PT, LOGICAL_W, MARGIN_RATIO, SEAL_SIZE } from './layout.js';
import { FONTS, defaultCanvasFactory, drawSeal, loadTextures, makeCanvas, paintCellContent, paintPaper, setDataset } from './render.js';
import { readLightPalette } from './palette.js';

/** iOS Safari 的 canvas 面积上限 16 777 216 px：宽 1440 时单张最高 11650。长图单张导出高度上限取 min(16384, 这个)。 */
export const MAX_CANVAS_AREA = 16777216;
export const MAX_LONG_EXPORT_HEIGHT = Math.min(16384, Math.floor(MAX_CANVAS_AREA / Math.round(LOGICAL_W * EXPORT_SCALE)));
/** 年报长图月段的格宽（内容宽 ÷ 8 列，§8.1 同 8 列）与墨内边 9%。 */
export const ANNUAL_COLS = 8;
export const ANNUAL_PAD = 0.09;

function frameBox(ctx, x, y, c, palette) {
  ctx.save();
  ctx.strokeStyle = palette.frame;
  ctx.lineWidth = FRAME_W;
  ctx.strokeRect(x + FRAME_W / 2, y + FRAME_W / 2, c - FRAME_W, c - FRAME_W);
  ctx.restore();
}

function text(ctx, str, x, midY, { font, size, color, align = 'left', weight = 400 }) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, midY);
  ctx.restore();
}

/** 公共准备：调色板、字体确认、参考字形、纸纹。 */
async function prepare({ palette, texts, sealText, cells, requireFont, loadGlyph, imageFactory, fonts }) {
  const pal = palette || readLightPalette();
  if (typeof requireFont === 'function') {
    await requireFont(fonts.song, texts.join(''));
    if (sealText) await requireFont(fonts.kai, sealText);
    await requireFont(fonts.label, texts.join(''));
  }
  const glyphs = new Map();
  if (typeof loadGlyph === 'function') {
    for (const cell of cells) {
      if (cell && cell.mode === 'under' && !glyphs.has(cell.ch)) {
        try {
          glyphs.set(cell.ch, await loadGlyph(cell.ch));
        } catch (error) {
          glyphs.set(cell.ch, null);
        }
      }
    }
  }
  const textures = await loadTextures(pal, { imageFactory });
  return { pal, glyphs, textures };
}

function drawCell(ctx, cell, x, y, c, env, { frame = true, pad } = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, c, c);
  ctx.clip();
  paintCellContent(ctx, cell, { x, y, c }, { palette: env.pal, unit: LOGICAL_PER_PT, paintStroke: env.paintStroke, glyphs: env.glyphs, ...(pad == null ? {} : { pad }) });
  ctx.restore();
  if (frame) frameBox(ctx, x, y, c, env.pal);
}

const BRAND_SEAL = SEAL_SIZE;

/** 册页的印与落款：印在 (896, 1240)，落款右沿在印左 36px（设计稿 cover / tail）。 */
function drawFoot(ctx, kuan, env, fonts, sealText) {
  const sx = 896;
  const sy = 1240;
  drawSeal(ctx, { x: sx, y: sy, size: BRAND_SEAL }, { text: sealText, palette: env.pal, font: fonts.kai });
  text(ctx, kuan, sx - 36, sy + BRAND_SEAL / 2, { font: fonts.song, size: 36, color: env.pal.ink2, align: 'right' });
}

/**
 * 册页卷首。
 * @param {{yearText:string, line:string, first:{ch,ink,mode}, firstLabel:string, firstDate:string, kuan:string, sealText:string}} o
 */
export async function renderAnnualCover({
  yearText, line, first, firstLabel, firstDate, kuan, sealText, palette = null, scale = EXPORT_SCALE, canvasFactory = defaultCanvasFactory,
  paintStroke = null, requireFont = null, loadGlyph = null, imageFactory = null, fonts = FONTS, meta = {},
}) {
  const W = LOGICAL_W;
  const H = 1440;
  const env = await prepare({ palette, texts: [yearText, line, firstLabel, firstDate, kuan], sealText, cells: [first], requireFont, loadGlyph, imageFactory, fonts });
  env.paintStroke = paintStroke;
  const { canvas, ctx } = makeCanvas(canvasFactory, Math.round(W * scale), Math.round(H * scale));
  ctx.scale(scale, scale);
  paintPaper(ctx, W, H, env.pal, env.textures);
  text(ctx, yearText, 120, 200 + 60, { font: fonts.song, size: 96, color: env.pal.ink1 });
  text(ctx, line, 124, 340 + 30, { font: fonts.song, size: 44, color: env.pal.ink2 });
  drawCell(ctx, first, 120, 560, 420, env);
  text(ctx, firstLabel, 580, 900 + 25, { font: fonts.song, size: 36, color: env.pal.ink2 });
  text(ctx, firstDate, 580, 900 + 75, { font: fonts.song, size: 36, color: env.pal.ink2 });
  drawFoot(ctx, kuan, env, fonts, sealText);
  setDataset(canvas, { kind: 'annual-cover', ratio: '3:4', width: canvas.width, height: canvas.height, members: first.ch, signature: kuan, ...meta });
  return { status: 'ready', canvas };
}

/**
 * 册页卷尾「同一个字，两次」。
 * @param {{title:string, first:{ch,ink,mode}, last:{ch,ink,mode}, firstDate:string, lastDate:string, kuan:string, sealText:string}} o
 */
export async function renderAnnualTail({
  title, first, last, firstDate, lastDate, kuan, sealText, palette = null, scale = EXPORT_SCALE, canvasFactory = defaultCanvasFactory,
  paintStroke = null, requireFont = null, loadGlyph = null, imageFactory = null, fonts = FONTS, meta = {},
}) {
  const W = LOGICAL_W;
  const H = 1440;
  const env = await prepare({ palette, texts: [title, firstDate, lastDate, kuan], sealText, cells: [first, last], requireFont, loadGlyph, imageFactory, fonts });
  env.paintStroke = paintStroke;
  const { canvas, ctx } = makeCanvas(canvasFactory, Math.round(W * scale), Math.round(H * scale));
  ctx.scale(scale, scale);
  paintPaper(ctx, W, H, env.pal, env.textures);
  text(ctx, title, 120, 200 + 36, { font: fonts.song, size: 56, color: env.pal.ink1 });
  drawCell(ctx, first, 120, 420, 400, env);
  drawCell(ctx, last, 560, 420, 400, env);
  text(ctx, firstDate, 120, 850 + 25, { font: fonts.song, size: 36, color: env.pal.ink2 });
  text(ctx, lastDate, 560, 850 + 25, { font: fonts.song, size: 36, color: env.pal.ink2 });
  drawFoot(ctx, kuan, env, fonts, sealText);
  setDataset(canvas, { kind: 'annual-tail', ratio: '3:4', width: canvas.width, height: canvas.height, members: first.ch, signature: kuan, ...meta });
  return { status: 'ready', canvas };
}

/**
 * 年报长图：一卷从头到尾，宽 1440；总高超过 maxExportHeight 时按月切成几张（不截字）。
 * @param {object} o
 * @param {string} o.yearText  @param {string} o.line  @param {{ch,ink,mode}} o.first  @param {string} o.firstLabel  @param {string} o.firstDate
 * @param {Array<{name:string, count:string, cells:Array<{ch,ink,mode}>}>} o.months
 * @param {{title:string, first, last, firstDate:string, lastDate:string}|null} o.tail
 * @param {string} o.kuan  末尾落款（「拾字　年报」）  @param {string} o.sealText
 * @param {number} [o.maxExportHeight]  单张长图的导出高度上限
 * @returns {Promise<{status:'ready', canvases:HTMLCanvasElement[], heights:number[]}>}
 */
export async function renderAnnualLong({
  yearText, line, first, firstLabel, firstDate, months, tail = null, kuan, sealText, maxExportHeight = MAX_LONG_EXPORT_HEIGHT,
  palette = null, scale = EXPORT_SCALE, canvasFactory = defaultCanvasFactory, paintStroke = null, requireFont = null, loadGlyph = null,
  imageFactory = null, fonts = FONTS, meta = {},
}) {
  const W = LOGICAL_W;
  const M = Math.round(MARGIN_RATIO * W);
  const CW = W - 2 * M;
  const c = Math.floor(CW / ANNUAL_COLS);
  const allCells = [first, ...months.flatMap(m => m.cells), ...(tail ? [tail.first, tail.last] : [])];
  const texts = [yearText, line, firstLabel, firstDate, kuan, ...months.flatMap(m => [m.name, m.count]), ...(tail ? [tail.title, tail.firstDate, tail.lastDate] : [])];
  const env = await prepare({ palette, texts, sealText, cells: allCells, requireFont, loadGlyph, imageFactory, fonts });
  env.paintStroke = paintStroke;
  const pal = env.pal;

  // 块：{h, keepNext?, draw(ctx, y)}。每一行字是一个块，所以再长的月也能按行切开。
  const blocks = [];
  const cell300 = 300;
  blocks.push({
    h: 110 + 120 + 16 + 60 + 48 + cell300 + 64,
    keepNext: false,
    draw(ctx, y) {
      text(ctx, yearText, M, y + 110 + 60, { font: fonts.song, size: 96, color: pal.ink1 });
      text(ctx, line, M, y + 110 + 120 + 16 + 30, { font: fonts.song, size: 44, color: pal.ink2 });
      const cy = y + 110 + 120 + 16 + 60 + 48;
      drawCell(ctx, first, M, cy, cell300, env);
      text(ctx, firstLabel, M + cell300 + 40, cy + cell300 - 75, { font: fonts.song, size: 36, color: pal.ink3 });
      text(ctx, firstDate, M + cell300 + 40, cy + cell300 - 25, { font: fonts.song, size: 36, color: pal.ink1 });
    },
  });
  for (const m of months) {
    blocks.push({
      h: 14 + 28 + 70 + 24,
      keepNext: true,
      draw(ctx, y) {
        ctx.save();
        ctx.fillStyle = pal.line;
        ctx.fillRect(M, y + 14, CW, 2);
        ctx.restore();
        text(ctx, m.name, M, y + 14 + 28 + 35, { font: fonts.song, size: 56, color: pal.ink1, weight: 500 });
        text(ctx, m.count, M + CW, y + 14 + 28 + 35, { font: fonts.label, size: 32, color: pal.ink3, align: 'right' });
      },
    });
    for (let r = 0; r * ANNUAL_COLS < m.cells.length; r += 1) {
      const row = m.cells.slice(r * ANNUAL_COLS, (r + 1) * ANNUAL_COLS);
      blocks.push({
        h: c + (r * ANNUAL_COLS + ANNUAL_COLS >= m.cells.length ? 56 : 0),
        n: row.length,
        draw(ctx, y) {
          row.forEach((cell, i) => drawCell(ctx, cell, M + i * c, y, c, env, { frame: false, pad: ANNUAL_PAD }));
        },
      });
    }
  }
  if (tail) {
    const tc = Math.floor((CW - 46) / 2);
    blocks.push({
      h: 14 + 28 + 72 + 28 + tc + 24 + 50 + 40,
      draw(ctx, y) {
        ctx.save();
        ctx.fillStyle = pal.line;
        ctx.fillRect(M, y + 14, CW, 2);
        ctx.restore();
        text(ctx, tail.title, M, y + 14 + 28 + 36, { font: fonts.song, size: 56, color: pal.ink1 });
        const cy = y + 14 + 28 + 72 + 28;
        drawCell(ctx, tail.first, M, cy, tc, env);
        drawCell(ctx, tail.last, M + tc + 46, cy, tc, env);
        text(ctx, tail.firstDate, M, cy + tc + 24 + 25, { font: fonts.song, size: 36, color: pal.ink2 });
        text(ctx, tail.lastDate, M + tc + 46, cy + tc + 24 + 25, { font: fonts.song, size: 36, color: pal.ink2 });
      },
    });
  }
  const footH = 40 + BRAND_SEAL + 60;
  const foot = {
    h: footH,
    draw(ctx, y) {
      const sy = y + 40;
      drawSeal(ctx, { x: M + CW - BRAND_SEAL, y: sy, size: BRAND_SEAL }, { text: sealText, palette: pal, font: fonts.kai });
      text(ctx, kuan, M + CW - BRAND_SEAL - 36, sy + BRAND_SEAL / 2, { font: fonts.song, size: 36, color: pal.ink2, align: 'right' });
    },
  };

  // 按导出高度上限装块：keepNext 的块（月名）不落在一张的末尾
  const maxLogical = Math.floor(maxExportHeight / scale);
  const chunks = [];
  let cur = { blocks: [], h: 0, n: 0 };
  const all = [...blocks, foot];
  for (let i = 0; i < all.length; i += 1) {
    const b = all[i];
    const need = b.h + (b.keepNext && all[i + 1] ? all[i + 1].h : 0);
    if (cur.blocks.length && cur.h + need > maxLogical) {
      chunks.push(cur);
      cur = { blocks: [], h: 0, n: 0 };
    }
    cur.blocks.push(b);
    cur.h += b.h;
    cur.n += b.n || 0;
  }
  if (cur.blocks.length) chunks.push(cur);

  const canvases = [];
  const heights = [];
  chunks.forEach((chunk, index) => {
    const H = chunk.h;
    const { canvas, ctx } = makeCanvas(canvasFactory, Math.round(W * scale), Math.round(H * scale));
    ctx.scale(scale, scale);
    paintPaper(ctx, W, H, pal, env.textures);
    let y = 0;
    for (const b of chunk.blocks) {
      b.draw(ctx, y);
      y += b.h;
    }
    setDataset(canvas, {
      kind: 'annual-long', width: canvas.width, height: canvas.height, part: index + 1, parts: chunks.length, months: months.length,
      n: chunk.n, ...meta,
    });
    canvases.push(canvas);
    heights.push(canvas.height);
  });
  return { status: 'ready', canvases, heights };
}
