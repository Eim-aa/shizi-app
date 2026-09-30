// 图片版式（纯函数，无 DOM；02 M4-5；01 §10；04 §3.2「图片规格」、R-I02 / R-I03；03 P25）。
//
// 从 #180 handoff/r8-foundation/module/layout.mjs（origin/pr-180）抽取改造：
//   - 两种比例：3:4 = 1080×1440（portrait）、1:1 = 1080×1080（square）；四周留白 72px，内区宽 936px。
//   - 列数（备注 L136）：c ∈ [5, 10]，取满足 ceil(n/c) × (936/c) + 118 ≤ 内区高度 的最小 c（118 = 40px 间距 + 78px 小印）。
//   - 竖版 3:4（T06-C，备注 L147）：字帖从内区顶端排（top = 72），落款紧跟最后一行下方 40px；
//     1:1 不变（上下居中，与 #180 r1 夹具一致）。#180 两种比例都垂直居中——这是本卡的改造点。
//   - 格宽 < 126px 时日期角标缩到 24px（否则 33px）；有角标的格子笔迹缩到 ≤ .78 倍并向右下让位
//     （原型 ShiziScreen imgEl L338 的 6.1 规则；单位 pt × 3 = 导出 px）。
//   - > 80 字（policy.imageMaxChars，P25 / D12）：返回 status 'pending'，不截字；0 字 'empty'。
//   原型 imgEl 不画每格里的虚线十字（#180 render.mjs 画了），这里按冻结原型：只有格线。
// 新增单字手写图片版式 glyphLayout（A05，备注 L146；原型 ShiziScreen charEl L352–L362）：
//   不画格子；墨迹外框缩放到宽约画面 60%（放不下按高），居中；字下一行「拼音 · 日期」33/39px；右下「拾字」26px + 78px 小印。

export const SIZES = Object.freeze({
  portrait: Object.freeze({ width: 1080, height: 1440 }),
  square: Object.freeze({ width: 1080, height: 1080 }),
});
export const RATIOS = Object.freeze(['portrait', 'square']);
/** 界面上的比例标签（3:4 / 1:1）对应的版式名。 */
export const RATIO_OF_LABEL = Object.freeze({ '3:4': 'portrait', '1:1': 'square' });

export const MARGIN = 72; // 24pt × 3
export const INNER_WIDTH = 936; // 312pt × 3
export const FOOTER_GAP = 40; // 最后一行到落款（T06-C）
export const SEAL = 78; // 26pt × 3
export const FOOTER = FOOTER_GAP + SEAL; // 118
export const MIN_COLUMNS = 5;
export const MAX_COLUMNS = 10;
export const DEFAULT_MAX_CHARS = 80; // policy.imageMaxChars（P25）的过渡值；调用方传 policy 值

// 字帖格内常量（原型 imgEl：角标 11/13pt，格宽 < 42pt 时 8/9pt；top 3/2pt、left 4/3pt；HALF .42；×3 = px）
const SMALL_CELL = 126;
const HALF = 0.42;

// 单字图（原型 charEl：GAP 16pt、INFO 13pt、信息行字号 11pt、字宽 ≤ 60% 画面宽）
export const GLYPH_GAP = 48;
export const GLYPH_INFO_LINE = 39;
export const GLYPH_INFO_FONT = 33;
export const GLYPH_WIDTH_RATIO = 0.6;
export const SIGNATURE_FONT = 26; // 26/3 pt × 3
export const SIGNATURE_TRACKING = 0.16; // letter-spacing .16em
export const SIGNATURE_SEAL_GAP = 36; // 12pt × 3（charEl 落款与印之间的 gap）

function assertRatio(ratio) {
  if (typeof ratio !== 'string' || !Object.prototype.hasOwnProperty.call(SIZES, ratio)) throw new Error('INVALID_RATIO');
}

/** 满足 ceil(n/c) × (936/c) + 118 ≤ innerHeight 的最小 c ∈ [5, 10]（放不下返回 11）。 */
export function columnsFor(n, innerHeight) {
  let c = MIN_COLUMNS;
  while (c <= MAX_COLUMNS && Math.ceil(n / c) * (INNER_WIDTH / c) + FOOTER > innerHeight) c += 1;
  return c;
}

/**
 * 字帖 / 这次的图片的网格版式。
 * @param {number} n  图上的字数（已按 P50 去掉缺墨的字）
 * @param {'portrait'|'square'} [ratio]
 * @param {{maxChars?:number}} [o]  maxChars = policy.imageMaxChars（P25）
 * @returns {{status:'ready'|'empty'|'pending', …}}
 */
export function sheetLayout(n, ratio = 'portrait', { maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('INVALID_COUNT');
  assertRatio(ratio);
  const { width, height } = SIZES[ratio];
  const innerHeight = height - 2 * MARGIN;
  const base = { n, ratio, width, height, margin: MARGIN, innerWidth: INNER_WIDTH, innerHeight };
  if (n > maxChars) return { status: 'pending', reason: 'OVER_LIMIT_POLICY_PENDING', maxChars, ...base, columns: 0, rows: 0, cells: [] };
  if (n === 0) return { status: 'empty', ...base, columns: 0, rows: 0, cells: [] };
  const columns = columnsFor(n, innerHeight);
  if (columns > MAX_COLUMNS) throw new Error('LAYOUT_DOES_NOT_FIT');
  const cell = INNER_WIDTH / columns;
  const rows = Math.ceil(n / columns);
  const gridHeight = rows * cell;
  // T06-C：竖版从内区顶端排；1:1 上下居中。
  const top = ratio === 'portrait' ? MARGIN : MARGIN + Math.max(0, (innerHeight - gridHeight - FOOTER) / 2);
  const footerTop = top + gridHeight + FOOTER_GAP;
  const small = cell < SMALL_CELL;
  const dateFont = small ? 24 : 33;
  const dateLine = small ? 27 : 39;
  const dateTop = small ? 6 : 9;
  const dateLeft = small ? 9 : 12;
  // 有角标的格子：字形上缘（半宽按 .42 格估）落在角标底边 1pt（3px）以下，下缘不出格。
  const inkScale = Math.min(0.78, (cell - dateTop - dateLine - 3) / (2 * HALF * cell));
  const inkDy = Math.max(0, dateTop + dateLine + 3 - cell * (0.5 - HALF * inkScale));
  const inkDx = Math.min(9, cell * 0.05);
  return {
    status: 'ready',
    ...base,
    columns,
    rows,
    cell,
    gridHeight,
    top,
    footerTop,
    footerHeight: SEAL,
    seal: { x: width - MARGIN - SEAL, y: footerTop, size: SEAL, rotate: -3 },
    signature: { x: MARGIN, baseline: footerTop + SEAL - 6, font: SIGNATURE_FONT, tracking: SIGNATURE_TRACKING, maxWidth: INNER_WIDTH - SEAL - 36 },
    dateFont,
    dateLine,
    dateTop,
    dateLeft,
    inkScale,
    inkDx,
    inkDy,
    cells: Array.from({ length: rows * columns }, (_, i) => ({
      index: i,
      x: MARGIN + (i % columns) * cell,
      y: top + Math.floor(i / columns) * cell,
      empty: i >= n,
    })),
  };
}

/**
 * 一格里笔迹的变换（345 单位 → 导出 px）：x_px = ox + x·k，y_px = oy + y·k。
 * 无角标：整格 = 345 单位；有角标：绕格心缩 inkScale 倍并向右下偏 (inkDx, inkDy)（原型 live(strokes, sh)）。
 */
export function cellInkTransform(layout, box, tagged, grid = 345) {
  const unit = layout.cell / grid;
  const k = tagged ? unit * layout.inkScale : unit;
  const cx = box.x + layout.cell / 2 + (tagged ? layout.inkDx : 0);
  const cy = box.y + layout.cell / 2 + (tagged ? layout.inkDy : 0);
  return { k, ox: cx - (grid / 2) * k, oy: cy - (grid / 2) * k };
}

/** 月字帖日期角标「9·24」（原型 fmt）。 */
export function dateTag(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  return `${Number(day.slice(5, 7))}·${Number(day.slice(8, 10))}`;
}

/**
 * 笔迹外框（345 单位；每点按半宽外扩）。没有点返回 null。
 * @param {Array<Array<{x:number,y:number,w?:number}>>} points
 */
export function inkBounds(points) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of points || []) {
    for (const p of stroke || []) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const r = Number.isFinite(p.w) && p.w > 0 ? p.w / 2 : 0;
      x0 = Math.min(x0, p.x - r);
      y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r);
      y1 = Math.max(y1, p.y + r);
    }
  }
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * 单字手写图片版式（A05）。bounds = inkBounds(points)；没有笔迹（bounds 为 null）→ status 'noInk'（最近一次没有笔迹就不生成）。
 * 返回导出 px 下：墨迹变换 {k, ox, oy}（x_px = ox + x·k）、信息行、落款与印的位置。
 */
export function glyphLayout(bounds, ratio = 'portrait') {
  assertRatio(ratio);
  const { width, height } = SIZES[ratio];
  const base = { ratio, width, height, margin: MARGIN };
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return { status: 'noInk', ...base };
  const top0 = MARGIN;
  const bot0 = height - MARGIN - SEAL - GLYPH_GAP;
  const maxH = bot0 - top0 - GLYPH_GAP - GLYPH_INFO_LINE;
  const k = Math.min((width * GLYPH_WIDTH_RATIO) / bounds.width, maxH / bounds.height);
  const glyphWidth = bounds.width * k;
  const glyphHeight = bounds.height * k;
  const glyphTop = top0 + (bot0 - top0 - (glyphHeight + GLYPH_GAP + GLYPH_INFO_LINE)) / 2;
  const glyphLeft = (width - glyphWidth) / 2;
  const sealX = width - MARGIN - SEAL;
  const sealY = height - MARGIN - SEAL;
  return {
    status: 'ready',
    ...base,
    k,
    ox: glyphLeft - bounds.x * k,
    oy: glyphTop - bounds.y * k,
    glyph: { x: glyphLeft, y: glyphTop, width: glyphWidth, height: glyphHeight },
    info: { top: glyphTop + glyphHeight + GLYPH_GAP, line: GLYPH_INFO_LINE, font: GLYPH_INFO_FONT, centerX: width / 2 },
    seal: { x: sealX, y: sealY, size: SEAL, rotate: -3 },
    signature: { right: sealX - SIGNATURE_SEAL_GAP, baseline: sealY + SEAL - 6, font: SIGNATURE_FONT, tracking: SIGNATURE_TRACKING },
  };
}
