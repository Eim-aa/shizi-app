// 作品版式（纯函数，无 DOM；阶段 1 P1-E7；设计交接「实现交接.md」§5.2 / §6；D31 / D39 / D46 ⑩ / D47）。
//
// 结果页上的作品、分享图、月字帖、年报册页共用这一个函数：输入格子（字数）与纸的比例，输出列数、格宽与落款 / 印的位置。
// 坐标一律是「逻辑画布」px：宽 W = 1080；3:4 高 1440，1:1 高 1080。导出时整体 × 4/3 → 1440 × 1920 / 1440 × 1440（render.js）。
//
// 规则（逐条对应 §6.2）：
//   m = round(0.09W) = 97；落款行 fh = 72；cw = W − 2m；ch = H − 2m − fh
//   n = 1 → 单格 c = min(0.62W, 0.62·ch)
//   n ≥ 2 → 对 k = 2…min(n, 10)：r = ⌈n / k⌉；r > k·H/W 的跳过（网格不比纸更瘦高）；
//           c_k = min(cw / k, ch / r, r = 1 ? ∞ : 0.34W)（一行时占满可用宽）；score = c_k × (1 − 0.8 × (r·k − n) / n)；取 score 最大的 k
//   块高 = r·c + 0.035W + max(印, 落款字号 × 1.4)
//   块顶 = (竖纸且 r = 1) ? 0.4 × (H − 块高) : (H − 块高) / 2 − 0.025H
//   左 = (W − cols·c) / 2
// 落款与印（§6.4）：末字在最右列 → 印在末格正下方 0.035W、右沿对齐，落款在印左 22px、垂直居中于印；
//   否则印在末格右侧 0.12c、底边上移 0.06c，落款在网格下方 0.035W、右对齐网格。
//
// 另导出：默认比例（D47）、结果页作品格宽（§5.2）、墨线宽补偿表（§1.1）、朱点尺寸（components.wrongDot）、日期角标尺寸。

/** 逻辑画布宽（px）。 */
export const LOGICAL_W = 1080;
/** 逻辑 → 导出的倍率：1080 × 4/3 = 1440。 */
export const EXPORT_SCALE = 4 / 3;
/** 逻辑 px 与屏幕 pt 的换算：一个逻辑 px = 1/2.69 pt（按 402 宽的屏对 1080 的画布，§6.3）。 */
export const PT_PER_LOGICAL = 1 / 2.69;
export const LOGICAL_PER_PT = 2.69;

export const RATIOS = Object.freeze(['3:4', '1:1']);
export const HEIGHT_OF = Object.freeze({ '3:4': 1440, '1:1': 1080 });

/** D47：1–3 字默认 1:1，4 字以上默认 3:4（交接 §12 / §6.6 的 DEFAULT_RATIO_FEW 常量）。 */
export const DEFAULT_RATIO_FEW = '1:1';
export const DEFAULT_RATIO_MANY = '3:4';
export const FEW_MAX_CHARS = 3;

/** 一张图最多放几个字（D39；与 policy.imageMaxChars 同值，调用方可传 policy 值覆盖）。 */
export const MAX_CHARS_PER_PAGE = 80;

export const MARGIN_RATIO = 0.09;
export const FOOTER_H = 72;
export const MAX_COLS = 10;
export const ROW_CELL_CAP = 0.34; // 两行以上格宽上限 = 0.34W
export const SINGLE_CELL_RATIO = 0.62;
export const GAP_RATIO = 0.035; // 块与落款之间 = 0.035W
// 印只有一种（R2-R1 / D51 ③）：作品里一个尺寸、不倾斜，与字数无关（旧：单字 108 / 其余 64、倾 −2°，V2-05 / T2-22 已废）；落款字号同理一个
export const SEAL_SIZE = 64; // ≈ 24pt
export const KUAN_SIZE = 36;
export const KUAN_GAP_FROM_SEAL = 22;
export const SEAL_ROTATION = 0;
export const INK_PAD = 0.12; // 墨在格内 12% 内边
export const FRAME_W = 2; // 外框 2px
export const GUIDE_W = 1.5; // 格间 1.5px
// 日期角标 ≈ 11pt，画在格内左上角（距格左 12px、距格上 8px），没有底色块、不压格线（V2-09：骑线角标把格线切断，已废）
export const TAG_SIZE = 30;
export const TAG_LEFT = 12;
export const TAG_TOP = 8;

export function defaultRatio(n) {
  return n >= 1 && n <= FEW_MAX_CHARS ? DEFAULT_RATIO_FEW : DEFAULT_RATIO_MANY;
}

function assertRatio(ratio) {
  if (!Object.prototype.hasOwnProperty.call(HEIGHT_OF, ratio)) throw new Error('INVALID_RATIO');
}

/**
 * 本人墨的线宽只有一条规则（R2-R1 / V2-03：各尺寸同一视觉粗细）：笔迹在 345 单位坐标里保持原宽（= 随显示尺寸等比缩放），
 * 小格只设一个最小物理线宽 MIN_INK_PT（约 1.2pt），不再按档位加粗（旧补偿表 ×1.15 / 1.35 / 1.5 与判断页小卡的 ×1.41 已废）。
 * @param {number} boxPt  放墨的方框边长（pt / CSS px）
 * @param {number} [innerRatio]  墨占方框的比例（作品格 0.76 = 12% 内边；判断卡等没有内边的方框 1）
 * @returns {number} 线宽倍数 ≥ 1
 */
export const MIN_INK_PT = 1.2;
export const INK_BASE_WIDTH = 11.5; // 345 单位里默认笔宽（core/ink-math INK.base）
export function minInkScale(boxPt, innerRatio = 1) {
  if (!(boxPt > 0)) return 1;
  const physical = (INK_BASE_WIDTH * boxPt * innerRatio) / INK_GRID;
  return physical >= MIN_INK_PT ? 1 : MIN_INK_PT / physical;
}

/** 作品格里墨线宽的倍数（格的屏幕当量 pt，墨占 76%）：≥ 约 47pt 的格原宽，更小的格抬到最小物理线宽。 */
export function inkWidthScale(cellPt) {
  return minInkScale(cellPt, 1 - 2 * INK_PAD);
}

/** 朱点直径（pt）= clamp(5, 格宽 × 0.07, 8)（components.wrongDot）；格宽也用 pt。 */
export function dotDiameterPt(cellPt) {
  return Math.min(8, Math.max(5, cellPt * 0.07));
}

/** 选列数：返回 {k, r, c}（c 未取整）。n ≥ 2。 */
export function pickColumns(n, W, H) {
  const m = Math.round(MARGIN_RATIO * W);
  const cw = W - 2 * m;
  const ch = H - 2 * m - FOOTER_H;
  let best = null;
  for (let k = 2; k <= Math.min(n, MAX_COLS); k += 1) {
    const r = Math.ceil(n / k);
    if (r > (k * H) / W + 0.01) continue; // 网格不比纸更瘦高
    const c = Math.min(cw / k, ch / r, r === 1 ? Infinity : ROW_CELL_CAP * W);
    const score = c * (1 - (0.8 * (r * k - n)) / n);
    if (!best || score > best.score) best = { k, r, c, score };
  }
  if (!best) throw new Error('LAYOUT_DOES_NOT_FIT');
  return { k: best.k, r: best.r, c: best.c };
}

/** 列 × 行与（逻辑）格宽；n = 0 时全是 0。 */
export function gridOf(n, ratio = '3:4') {
  assertRatio(ratio);
  const W = LOGICAL_W;
  const H = HEIGHT_OF[ratio];
  if (!(n >= 1)) return { cols: 0, rows: 0, c: 0 };
  if (n === 1) {
    const m = Math.round(MARGIN_RATIO * W);
    const ch = H - 2 * m - FOOTER_H;
    return { cols: 1, rows: 1, c: Math.round(Math.min(SINGLE_CELL_RATIO * W, SINGLE_CELL_RATIO * ch)) };
  }
  const { k, r, c } = pickColumns(n, W, H);
  return { cols: k, rows: r, c: Math.floor(c) };
}

/**
 * 作品版式。
 * @param {Array<object>|number} cells  格子（只用个数；也可直接传数字）
 * @param {'3:4'|'1:1'} [ratio]
 * @returns {{W, H, n, cols, rows, c, left, top, cells:Array<{x:number,y:number}>, frame:Array<{x,y,w,h}>,
 *   seal:{x,y,size,rotate}, kuan:{right:number, top:number, size:number, lineHeight:number}, below:boolean}}
 *   n = 0 时 cells / frame 为空。
 */
export function layout(cells, ratio = '3:4') {
  assertRatio(ratio);
  const n = typeof cells === 'number' ? cells : Array.isArray(cells) ? cells.length : 0;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('INVALID_COUNT');
  const W = LOGICAL_W;
  const H = HEIGHT_OF[ratio];
  if (n === 0) return { W, H, n, cols: 0, rows: 0, c: 0, left: 0, top: 0, cells: [], frame: [], seal: null, kuan: null, below: false };
  const { cols, rows, c } = gridOf(n, ratio);
  const gw = cols * c;
  const gh = rows * c;
  const seal = SEAL_SIZE;
  const kfs = KUAN_SIZE;
  const gap = Math.round(GAP_RATIO * W);
  const lastCol = (n - 1) % cols;
  const lastRow = rows - 1;
  const below = lastCol === cols - 1;
  const blockH = gh + gap + Math.max(seal, kfs * 1.4);
  const top = rows === 1 && H > W ? Math.round((H - blockH) * 0.4) : Math.round((H - blockH) / 2 - H * 0.025);
  const left = Math.round((W - gw) / 2);
  const boxes = Array.from({ length: n }, (_, i) => ({ x: left + (i % cols) * c, y: top + Math.floor(i / cols) * c }));
  const frame = rows > 1 && !below
    ? [{ x: left, y: top, w: gw, h: (rows - 1) * c + 2 }, { x: left, y: top + (rows - 1) * c, w: (lastCol + 1) * c, h: c }]
    : [{ x: left, y: top, w: gw, h: gh }];
  let sealBox;
  let kuan;
  if (below) {
    const sx = left + (lastCol + 1) * c - seal;
    const sy = top + gh + gap;
    sealBox = { x: sx, y: sy, size: seal, rotate: SEAL_ROTATION };
    kuan = { right: sx - KUAN_GAP_FROM_SEAL, top: sy + seal / 2 - kfs * 0.7, size: kfs, lineHeight: kfs * 1.4 };
  } else {
    const sx = left + (lastCol + 1) * c + Math.round(c * 0.12);
    const sy = top + (lastRow + 1) * c - seal - Math.round(c * 0.06);
    sealBox = { x: sx, y: sy, size: seal, rotate: SEAL_ROTATION };
    kuan = { right: left + gw, top: top + gh + gap, size: kfs, lineHeight: kfs * 1.4 };
  }
  return { W, H, n, cols, rows, c, left, top, cells: boxes, frame, seal: sealBox, kuan, below };
}

/**
 * 结果页上作品的格宽（§5.2，D49 减法修稿）：列 × 行 = 默认 3:4 分享图的排法；
 * c = min(⌊b / 列⌋, ⌊0.5b⌋, 行 ≥ 2 ? ⌊0.4b⌋ : ∞)，b = W − 40（作品不再有底板，格直接贴页边；原 cw = b − 32 是给底板留的内边）。
 * @param {number} n  字数
 * @param {number} screenWidth  屏宽（pt / CSS px）
 * @returns {{cols:number, rows:number, c:number}}
 */
export function resultGrid(n, screenWidth) {
  const { cols, rows } = gridOf(n, '3:4');
  if (!cols) return { cols: 0, rows: 0, c: 0 };
  const b = screenWidth - 40;
  const c = Math.min(Math.floor(b / cols), Math.floor(0.5 * b), rows >= 2 ? Math.floor(0.4 * b) : Infinity);
  return { cols, rows, c };
}

/** 月字帖 / 年报月段的列数：6（Pro Max 7）；AX 档 4（§7.1 / §7.3）。屏宽 ≥ 430 当作 Pro Max。 */
export function monthColumns(screenWidth, { ax = false } = {}) {
  if (ax) return 4;
  return screenWidth >= 430 ? 7 : 6;
}

/** 月字帖的格宽 = ⌊(W − 40) / 列⌋（§7.1）。 */
export function monthCell(screenWidth, cols) {
  return Math.floor((screenWidth - 40) / cols);
}

/** 日期角标文字：每天第一个字标「日」（月字帖里只有日，不带月；§7.1）。day = 'YYYY-MM-DD'。 */
export function dayTag(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  return String(Number(day.slice(8, 10)));
}

/** 给按日分组的格子标角标：每天的第一个字带 tag，其余空串。cells 里要有 day。 */
export function withDayTags(cells) {
  let prev = null;
  return cells.map(cell => {
    const day = cell && cell.day ? cell.day : null;
    const tag = day && day !== prev ? dayTag(day) : '';
    if (day) prev = day;
    return { ...cell, tag };
  });
}

/** 本人墨迹的书写格内部单位（01 §6.1）。 */
export const INK_GRID = 345;

/**
 * 格内墨迹的变换：书写格 345 单位 → 格内 76%（12% 内边）。返回相对格左上的 {ox, oy, k}（x = ox + x·k）。
 * @param {number} cellSize  格边长（任意单位）
 * @param {number} [pad]  内边比例，缺省 12%（年报月段是 9%，§8.1）
 */
export function cellInkBox(cellSize, pad = INK_PAD) {
  const size = cellSize * (1 - 2 * pad);
  return { ox: cellSize * pad, oy: cellSize * pad, size, k: size / INK_GRID };
}

/**
 * 朱点（写错且手动放进来的字，D46 ⑥）：直径 clamp(5, 格宽 × 0.07, 8) pt，在墨迹外框右上外 2pt。
 * 返回相对格左上的圆心 {cx, cy} 与直径 d，单位同 cellSize；圆点不出格（贴边 1pt）。
 * @param {number} cellSize
 * @param {number} unit  每 pt 几个单位：屏幕上 1；逻辑画布 2.69
 * @param {{x:number,y:number,width:number,height:number}|null} bounds  inkBounds（345 单位）；没有时落在格右上角
 */
export function dotLayout(cellSize, unit, bounds, pad = INK_PAD) {
  const d = dotDiameterPt(cellSize / unit) * unit;
  const { ox, oy, k } = cellInkBox(cellSize, pad);
  let cx = cellSize - d;
  let cy = d;
  if (bounds) {
    cx = ox + (bounds.x + bounds.width) * k + 2 * unit + d / 2;
    cy = oy + bounds.y * k - 2 * unit - d / 2;
  }
  cx = Math.min(Math.max(cx, d / 2 + unit), cellSize - d / 2 - unit);
  cy = Math.min(Math.max(cy, d / 2 + unit), cellSize - d / 2 - unit);
  return { cx, cy, d };
}
