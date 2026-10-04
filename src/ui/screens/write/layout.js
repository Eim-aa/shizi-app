// 写字页 / 判断页的竖向位置与格子边长（阶段 1 E9b；D49 减法修稿；实现交接 §13.2、§9.1、§9.4；P118 / P151 / P190）。
//
// 主区 = 页头底 → 按钮行顶 − 12（正文区 .sz-page__body，上下内边距 0）。题面（高 P）、16、书写格（边长 g）、格下工具行（高 T）作为一组放在主区里：
//   g    = clamp(258, min(屏宽 − 40, 400, 主区高 − P' − 16 − T − 16), 400)       D36：不随字号、不随题面提示行变，只随可用高度
//   组高 = P + 16 + g + T
//   组顶 = max(12, round((主区高 − 组高) × 0.4))                                 空余 40% 在上、60% 在下（空余不足 12 时取空余本身，不把整组顶出主区）
//   书写格顶（主区内）= 组顶 + P + 16
// P = 量到的整个题面高（含有内容时才出现的提示行）；P' = 算 g 用的题面高：标准字号（含 xS–XXXL）取题面标称高 80（拼音行 24 + 间 4 + 题面格 52），
// 所以同一视口换系统字号、换到有提示行的字，书写格边长不变（D36）；只有 AX 档按量到的词语行高（不含提示行）算（AX 档整个版式本来就单独排）。
// 判断页（标准字号）：上格与书写格同一顶边、同一中线，两格共用一条 1pt 线：
//   S = min(屏宽 − 40, ⌊(主区高 − 书写格顶 − 16) ÷ 2⌋)                          无旁注，宽度只受页边限制
// （实现交接 §9.1 把公式写成「A − 16 − gy」，A = 主操作区顶 = 主区底 + 12；设计稿数值——402：231、SE：177、Pro Max：261——只有按「主区底 − 16 − gy」才对得上，这里取数值。）
// 判断页（AX 档）：页头问题只留给读屏，两格按「上下排」「并排（间距 12）」各算一次，取格子更大的一种：
//   上下：S_v = min(屏宽 − 40, ⌊(主区高 − 12 − P − 16 − 16) ÷ 2⌋)；并排：S_h = ⌊(屏宽 − 40 − 12) ÷ 2⌋
//   上下排时组顶 12；并排时组顶按写字页同一条 40% 规则（组高 = P + 16 + S_h）。
//
// 全部是纯函数（node:test 直接测）；写字页量出 主区高 与 P 后调用。

import * as policy from '../../../config/policy.js';

/** 书写格边长的下限 / 上限（policy.writeGrid，P118，D36）。 */
export const GRID_MIN = policy.writeGrid.min;
export const GRID_MAX = policy.writeGrid.max;
/** 题面到书写格的间距、格下工具行高（标准 / AX）、书写格组到按钮行的最小空隙、组顶的上空余占比与下限。 */
export const PROMPT_GAP = policy.writeGrid.promptGap;
export const TOOLS_H = policy.writeGrid.toolsHeight;
export const TOOLS_H_AX = policy.writeGrid.toolsHeightAx;
export const BOTTOM_GAP = policy.writeGrid.bottomGap;
export const TOP_SHARE = policy.writeGrid.topShare;
export const TOP_MIN = policy.writeGrid.topMin;
/** 判断页上下两格 / 并排两格的间距（并排）、两格边长下限（再小就退到页面可滚动）。 */
export const COMPARE_GAP = 12;
export const JUDGE_MIN = 120;
/** 页边（space.gutter）。 */
export const JUDGE_GUTTER = 20;
/** 题面高度（标准字号 402：拼音行 24 + 间距 4 + 题面格 52），首帧估算用。 */
export const PROMPT_H_STD = 80;
/** 取不到页面尺寸时的缺省边长（旧标准格 345）。 */
const STD_GRID = 345;
/** 估算首帧主区高用的固定部分（页头 44 + 按钮行：上 12 + 主按钮 54 + 间 6 + 文字行 44 + 下 8）。 */
const HEAD_H = 44;
const FOOT_H = 12 + 54 + 6 + 44 + 8;

const finite = n => Number.isFinite(n);

/** 内容宽（屏宽 − 2 × 页边）。 */
export function contentWidth(width) {
  return finite(width) && width > 0 ? width - 2 * policy.writeGrid.sideMargin : Infinity;
}

/**
 * 书写格边长（D36 / P118；纯函数）。
 * @param {{width:number, mainHeight:number, promptHeight?:number, toolsHeight?:number}} o
 *   width：页面宽；mainHeight：主区高（页头底到按钮行顶 − 12）；promptHeight：题面高 P；toolsHeight：格下工具行高 T
 * @returns {number}
 */
export function writeGridSize({ width, mainHeight, promptHeight = PROMPT_H_STD, toolsHeight = TOOLS_H } = {}) {
  const hasW = finite(width) && width > 0;
  const hasH = finite(mainHeight) && mainHeight > 0;
  if (!hasW && !hasH) return STD_GRID;
  const w = contentWidth(width);
  const h = hasH ? mainHeight - promptHeight - PROMPT_GAP - toolsHeight - BOTTOM_GAP : Infinity;
  return Math.max(GRID_MIN, Math.min(GRID_MAX, Math.floor(Math.min(w, GRID_MAX, h))));
}

/**
 * 组顶：空余 40% 在上、60% 在下，至少 12（纯函数；§13.2）。空余不足 12 时只给空余本身（≥ 0）——上空白不会把整组顶出主区
 * （例：最矮的屏上系统字号 XXXL 的拼音行比标称高 6）。
 */
export function groupTop({ mainHeight, groupHeight }) {
  if (!finite(mainHeight) || !finite(groupHeight)) return TOP_MIN;
  const spare = mainHeight - groupHeight;
  const ideal = Math.round(spare * TOP_SHARE);
  if (ideal >= TOP_MIN) return ideal;
  return Math.max(0, Math.min(TOP_MIN, Math.floor(spare)));
}

/**
 * 写字页的整组位置：{g, top, gridTop}（gridTop = 书写格顶，主区内的偏移）。
 * @param {{width:number, mainHeight:number, promptHeight?:number, sizingHeight?:number, ax?:boolean}} o
 *   promptHeight：量到的整个题面高 P；sizingHeight：算 g 用的题面高 P'（缺省 = P；写字页标准字号传 80，AX 档传词语行高）
 */
export function writeLayout({ width, mainHeight, promptHeight = PROMPT_H_STD, sizingHeight = promptHeight, ax = false } = {}) {
  const toolsHeight = ax ? TOOLS_H_AX : TOOLS_H;
  const g = writeGridSize({ width, mainHeight, promptHeight: sizingHeight, toolsHeight });
  const top = groupTop({ mainHeight, groupHeight: promptHeight + PROMPT_GAP + g + toolsHeight });
  return { g, top, gridTop: top + promptHeight + PROMPT_GAP, toolsHeight };
}

/**
 * 判断页上下两格的边长（标准字号，纯函数）：S = min(屏宽 − 40, ⌊(主区高 − 书写格顶 − 16) ÷ 2⌋)，下限 120。
 * 两格共用一条格线（第二格上移 1pt），所以占高 2S − 1，不足一格的零头由 16 的底空隙吸收。
 * @param {{width:number, mainHeight:number, gridTop:number}} o  gridTop：书写格顶（主区内偏移，写字页同一条公式的结果）
 */
export function judgePairSize({ width, mainHeight, gridTop } = {}) {
  const w = contentWidth(width);
  const h = finite(mainHeight) && finite(gridTop) && mainHeight > 0 ? Math.floor((mainHeight - gridTop - BOTTOM_GAP) / 2) : Infinity;
  const s = Math.floor(Math.min(w, h));
  return finite(s) ? Math.max(JUDGE_MIN, s) : 234;
}

/**
 * 判断页 AX 档：上下排与并排各算一次，取较大的一种（D49 ⑧；纯函数）。并排平手时取上下排。
 * @param {{width:number, mainHeight:number, promptHeight:number}} o
 * @returns {{layout:'stack'|'side', s:number, top:number, stack:number, side:number}}  stack / side：两种排法各自的边长（stack 不夹下限，用来比较）
 */
export function judgeAxLayout({ width, mainHeight, promptHeight = PROMPT_H_STD } = {}) {
  const w = contentWidth(width);
  const stack = Math.floor(Math.min(w, Math.floor((mainHeight - TOP_MIN - promptHeight - PROMPT_GAP - BOTTOM_GAP) / 2)));
  const side = finite(w) ? Math.floor((w - COMPARE_GAP) / 2) : 0;
  if (side > stack) {
    const top = groupTop({ mainHeight, groupHeight: promptHeight + PROMPT_GAP + side });
    return { layout: 'side', s: side, top, stack, side };
  }
  return { layout: 'stack', s: Math.max(JUDGE_MIN, stack), top: TOP_MIN, stack, side };
}

/**
 * 首帧估算（页面还没量出来之前；量出来后同一帧内替换，不会画出估算值）：按窗口宽高、无安全区、标准题面高度。
 * @returns {{g:number, top:number, gridTop:number, toolsHeight:number}}
 */
export function estimateLayout(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return { g: STD_GRID, top: TOP_MIN, gridTop: TOP_MIN + PROMPT_H_STD + PROMPT_GAP, toolsHeight: TOOLS_H };
  const root = w.document && w.document.documentElement;
  const width = w.innerWidth || (root && root.clientWidth);
  const height = w.innerHeight || (root && root.clientHeight);
  return writeLayout({ width, mainHeight: finite(height) && height > 0 ? height - HEAD_H - FOOT_H : NaN, promptHeight: PROMPT_H_STD });
}
