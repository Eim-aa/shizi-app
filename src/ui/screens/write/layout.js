// 写字页 / 判断页的竖向位置与格子边长（阶段 1 E9b；D49 减法修稿；实现交接 §13.2、§9.1、§9.4；P118 / P151 / P190；E9d P195）。
// A7（D57，P280）：撤销 / 清空回到格下（离格 4、高 44，图标加文字），说明位在它下面，所以下文的「说明位高 T」现在是格下总高 T = 48 + 40 = 88（AX 档 N 至少 48 + 56 = 104）；
// 提示 / 看答案是主按钮正上方 20 的一行（名义按钮行 = 12 + 48 + 20 + 54 = 134），跳过进页头右上。
//
// 主区 = 页头底 → 按钮行顶 − 12（正文区 .sz-page__body，上下内边距 0）。题面（高 P）、16、书写格（边长 g）、格下说明位（高 T）作为一组放在主区里：
//   g    = clamp(258, min(屏宽 − 40, 400, 名义主区高 − 80 − 16 − 40 − 16), 400)    D29 / D36 / P195：只由视口决定——名义主区高 = 页面高 − 名义页头 − 名义按钮行（标准字号 L 档的尺寸 + 量到的安全区），
//                                                                                   名义题面高 80、名义工具行高 40；与系统字号、题面提示行无关（xS–XXXL）。
// AX 档（D51 ⑦，P225，ADA A2-01）不再「放不下整页滚动」：整页永不滚动，格子按实际可用高度排——axWriteLayout：
//   g = clamp(220, min(屏宽 − 40, 400, 实际主区高 − P − 16 − N − 16), 400)        N = 格下说明位的实际高度（R3-K1 P241：量到的，至少 56；撤销 / 清空已移到页头）
//   实际主区高已经扣掉了底栏的真实高度：「写好了」+ 其下的文字行（R4-F1 / P260：提示 / 看答案 / 跳过，折行就是两行）——所以 g 随文字行折了几行自动变。
//   组高 = P + 16 + g + N，组顶按同一条 40% 规则；格子与说明位完整显示在首屏，下限 220。
//   算出来的格子低于下限（tight）时的让步顺序（P261 / P278，D56）：① 写字页把底栏主按钮字号封顶 34pt（提示 / 看答案 / 跳过任何字号都不收起；「在纸上写」已不在写字页，不再有先收起它这一步）；
//   ② 仍放不下 → g 取下限 220、整组可能超出主区（fits=false），页面正文可滚动、按钮行上沿出现 hairline（与非 AX 档放不下时同口径）。不再有「说明并入菜单」。
//   组高 = P + 16 + g + T                                                           P 取这张卡量到的整个题面高，T = 40（说明位）
//   组顶 = max(12, round((主区高 − 组高) × 0.4))                                    主区高：非 AX 档取名义主区高（P257），AX 档取实际量到的；空余 40% 在上、60% 在下（空余不足 12 时取空余本身，不足 0 时取 0）
//   书写格顶（主区内）= 组顶 + P + 16
// P = 量到的整个题面高（含有内容时才出现的提示行）。
// 书写格顶边在同一张卡的所有阶段固定（R3-C3W，第三轮 V3-02 / T3-03，D53 ②，P257）：非 AX 档的组顶也只按「名义主区高 + 这张卡的题面高 P」排（writeLayout 的 nominalHeight），
// 不再按各阶段实际量到的主区高——后者随页头标题折行 / 说明行 / 步骤点变，旧版同一张卡里量到 230 / 250 / 265pt 三个位置。页头比名义高（大字号下标题折成两行）时，组顶减去多出来的高度
// （headExtra），书写格在页面上的 y 仍不变。AX 档例外（axWriteLayout 仍按实际可用高度排，P225 / P241）。
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
/** 题面到书写格的间距、格下工具行高（标准）、书写格组到按钮行的最小空隙、组顶的上空余占比与下限。 */
export const PROMPT_GAP = policy.writeGrid.promptGap;
/** 格下撤销 / 清空行（离格 4 + 按钮 44，A7，P280）、格下说明位、两者合计（= 格下总高）。 */
export const TOOL_ROW_H = policy.writeGrid.toolRowHeight;
export const NOTE_H = policy.writeGrid.toolsHeight;
export const TOOLS_H = TOOL_ROW_H + NOTE_H;
/** AX 档：书写格边长下限、格下说明位固定高度（P225）。 */
export const AX_GRID_MIN = policy.writeGrid.axMin;
export const AX_NOTE_H = policy.writeGrid.axNoteHeight;
/** AX 档格下总高的最小值：撤销 / 清空行 + 说明位（A7，P280）。 */
export const AX_BELOW_H = TOOL_ROW_H + AX_NOTE_H;
export const BOTTOM_GAP = policy.writeGrid.bottomGap;
/** 放不下时的最后两步（P299）：AX 档题面缩放下限、书写格最后让步的下限。 */
export const PROMPT_FIT_MIN = policy.writeGrid.promptFitMin;
export const FIT_GRID_MIN = policy.writeGrid.fitGridMin;
export const TOP_SHARE = policy.writeGrid.topShare;
export const TOP_MIN = policy.writeGrid.topMin;
/** 判断页上下两格 / 并排两格的间距（并排）、两格边长下限（再小就退到页面可滚动）。 */
export const COMPARE_GAP = 12;
export const JUDGE_MIN = 120;
/** 页边（space.gutter）。 */
export const JUDGE_GUTTER = 20;
/** 名义题面高度（标准字号 402：拼音行 24 + 间距 4 + 题面格 52）：算书写格边长 g 与首帧估算用（policy.writeGrid.nominalPrompt，P195）。 */
export const PROMPT_H_STD = policy.writeGrid.nominalPrompt;
/** 名义页头高 / 名义按钮行高（L 档，不含安全区与下内边距）、按钮行下内边距下限（P195）。 */
export const NOMINAL_HEAD_H = policy.writeGrid.nominalHead;
export const NOMINAL_FOOT_H = policy.writeGrid.nominalFoot;
export const FOOT_BOTTOM_MIN = policy.writeGrid.footBottomMin;
/** 取不到页面尺寸时的缺省边长（旧标准格 345）。 */
const STD_GRID = 345;
/** 估算首帧主区高用的固定部分（页头 44 + 按钮行：上 12 + 主按钮 54 + 间 6 + 文字行 44 + 下 8，P260）。 */
const HEAD_H = NOMINAL_HEAD_H;
const FOOT_H = NOMINAL_FOOT_H + FOOT_BOTTOM_MIN;

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
 * 名义主区高（P195；纯函数）：标准字号（L 档）下主区应有的高度 = 页面高 − 名义页头（44 + 上安全区）− 名义按钮行（116 + max(8, 下安全区)）− 正文区上下内边距。
 * 与当前系统字号无关：AX 档的页头 / 按钮行更高、实际主区更矮，但书写格边长仍按这个值算（D29 / D36），放不下时整页滚动。
 * 冷启动直接处于 AX 档也对——不依赖「先在 L 档量一次」。
 * @param {{pageHeight:number, safeTop?:number, footBottom?:number, bodyPad?:number}} o
 *   safeTop：页头上内边距（= 上安全区）；footBottom：按钮行下内边距（= max(24, 下安全区)，缺省 FOOT_BOTTOM_MIN 24）；bodyPad：正文区上下内边距之和（写字页 0）
 */
export function nominalMainHeight({ pageHeight, safeTop = 0, footBottom = FOOT_BOTTOM_MIN, bodyPad = 0 } = {}) {
  if (!finite(pageHeight)) return NaN;
  return pageHeight - (NOMINAL_HEAD_H + (finite(safeTop) ? safeTop : 0)) - (NOMINAL_FOOT_H + (finite(footBottom) ? footBottom : FOOT_BOTTOM_MIN)) - (finite(bodyPad) ? bodyPad : 0);
}

/**
 * 写字页的整组位置：{g, top, gridTop}（gridTop = 书写格顶，主区内的偏移）。
 * g 与组顶都只按名义版式算（P257，D53 ②：书写格顶边在同一张卡的所有阶段固定）：边长见文件头；组顶 = 名义主区高里，按这张卡量到的题面高 P、g、说明位高排的 40% 规则
 * （不随阶段的实际主区高变）。
 * @param {{width:number, mainHeight?:number, nominalHeight?:number, promptHeight?:number, headExtra?:number}} o
 *   nominalHeight：名义主区高（缺省 = mainHeight，即标准字号下两者相等）；promptHeight：量到的整个题面高 P；mainHeight 只在没给 nominalHeight 时当它用；
 *   headExtra：页头比名义页头高出多少（大字号下标题折行，≥ 0）——正文区被它往下推，组顶减去它，书写格在页面上的 y 不变。AX 档用 axWriteLayout。
 */
export function writeLayout({ width, mainHeight, nominalHeight = mainHeight, promptHeight = PROMPT_H_STD, headExtra = 0 } = {}) {
  const toolsHeight = TOOLS_H;
  let g = writeGridSize({ width, mainHeight: nominalHeight, promptHeight: PROMPT_H_STD, toolsHeight: TOOLS_H });
  // P299：名义版式里书写格到下限 258 仍放不下（SE 一类没有下安全区的屏，主按钮底线 24 之后）→ 书写格取名义主区剩下的高度，最小 FIT_GRID_MIN；
  // 仍只由视口决定（名义主区高、名义题面高），与字号和这张卡无关（D29 / D36 / P195）
  if (finite(nominalHeight) && nominalHeight > 0) {
    const fit = fitGroup({ width, mainHeight: nominalHeight, promptHeight: PROMPT_H_STD, below: toolsHeight, gFloor: g, scaleMin: 1 });
    g = Math.min(g, fit.g);
  }
  const extra = finite(headExtra) && headExtra > 0 ? headExtra : 0;
  const top = Math.max(0, groupTop({ mainHeight: nominalHeight, groupHeight: promptHeight + PROMPT_GAP + g + toolsHeight }) - extra);
  return { g, top, gridTop: top + promptHeight + PROMPT_GAP, toolsHeight, promptScale: 1 };
}

/**
 * 放不下时的最后两步（P299，规范「写字页永不滚动」D51 ⑦；纯函数）。room = 主区高 − 16 − 格下高 − 16，是题面与书写格共用的高度。
 * 题面原样 + 格子 ≥ gFloor 放得下 → 不动；否则 ① 格子先让步：取剩下的 room − P（不低于 FIT_GRID_MIN 180）——常见的题面在最矮的屏上只差几 pt，缩格子比缩字好；
 * ② 格子到 180 仍放不下（最长的提示行）→ 题面缩到 s = clamp((room − 180) ÷ P, scaleMin, 1)，格子取剩下的、仍不低于 180。
 * @param {{width:number, mainHeight:number, promptHeight:number, below:number, gFloor:number, scaleMin?:number}} o
 * @returns {{g:number, scale:number}}
 */
export function fitGroup({ width, mainHeight, promptHeight, below, gFloor, scaleMin = PROMPT_FIT_MIN }) {
  const w = contentWidth(width);
  const room = mainHeight - PROMPT_GAP - below - BOTTOM_GAP;
  const free = room - promptHeight;
  if (free >= gFloor || free >= FIT_GRID_MIN) return { g: Math.floor(Math.min(w, GRID_MAX, free)), scale: 1 };
  const scale = promptHeight > 0 ? Math.max(scaleMin, Math.min(1, Math.floor(((room - FIT_GRID_MIN) / promptHeight) * 1000) / 1000)) : 1;
  const g = Math.max(FIT_GRID_MIN, Math.floor(Math.min(w, GRID_MAX, room - promptHeight * scale)));
  return { g, scale };
}

/**
 * AX 档书写格边长（D51 ⑦，P225；R3-K1 P241 说明位按实际高度；R4-F1 P261 底栏带文字行；R4-P1 P278 让步只剩封顶主按钮；纯函数）：按实际可用高度，格子与格下说明位都完整显示在首屏、永不滚动。
 * N = max(AX_BELOW_H, noteHeight)：格下的实际高度 = 撤销 / 清空行 48 + 说明位（写字页量到的，说明折成三行就是三行的高度；A7 起撤销 / 清空回到格下，P280）。
 * g = clamp(AX_GRID_MIN, min(屏宽 − 40, 400, 实际主区高 − P − 16 − N − 16), 400)；实际主区高是量到的（底栏有几行，它就小多少）。
 * tight：格子（不夹下限）低于 AX_GRID_MIN——写字页据此把底栏主按钮字号封顶 34pt（P261 / P278），主区变高后 tight 自然消失；仍 tight 时 g 取下限，fits=false（整组超出主区）。
 * @param {{width:number, mainHeight:number, promptHeight?:number, noteHeight?:number}} o
 * @returns {{g:number, top:number, gridTop:number, toolsHeight:number, fits:boolean, tight:boolean}}
 */
export function axWriteLayout({ width, mainHeight, promptHeight = PROMPT_H_STD, noteHeight = AX_BELOW_H } = {}) {
  const hasW = finite(width) && width > 0;
  const hasH = finite(mainHeight) && mainHeight > 0;
  const w = contentWidth(width);
  const note = Math.max(AX_BELOW_H, finite(noteHeight) ? Math.ceil(noteHeight) : AX_BELOW_H);
  const room = hasH ? mainHeight - promptHeight - PROMPT_GAP - note - BOTTOM_GAP : Infinity;
  const raw = Math.floor(Math.min(w, GRID_MAX, room));
  const tight = hasH && raw < AX_GRID_MIN;
  let g = !hasW && !hasH ? STD_GRID : Math.max(AX_GRID_MIN, Math.min(GRID_MAX, raw));
  // P299：格子到下限 220 仍放不下 → 格子先让步（最小 180），再不行（最长的题面在 SE + AX5）题面按可用高度缩小；正文不滚动
  let promptScale = 1;
  if (tight) {
    const fit = fitGroup({ width, mainHeight, promptHeight, below: note, gFloor: AX_GRID_MIN });
    g = fit.g;
    promptScale = fit.scale;
  }
  const shownPrompt = promptHeight * promptScale;
  const groupHeight = shownPrompt + PROMPT_GAP + g + note;
  const top = groupTop({ mainHeight, groupHeight });
  const fits = !finite(mainHeight) || top + groupHeight <= mainHeight + 0.5;
  return { g, top, gridTop: top + shownPrompt + PROMPT_GAP, toolsHeight: note, fits, tight, promptScale };
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
