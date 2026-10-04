// 紧凑版写字页（M1-7；02 §3 M1-7；R-W18 / R-W26 / R-G09；走查-W15 / 核对-V02；reference/I-proto-write.md §3.7）。
//
// 何时用紧凑版：:root[data-text-large]（系统字号 --k ≥ policy.compactTextScale 1.3，P131 / D29，由 platform/text-size.js 设；
// 原型 size==='compact' ⇔ --k 1.3），或视口高度 ≤ COMPACT_MAX_HEIGHT
// （标准版 393×852 的整页需要约 790px 才能让书写格与底栏同屏；360×640 这类短屏在标准字号下也走紧凑版）。
// 高度阈值是工程取值（原型只按字号切换）；CSS 与 JS 用同一个条件（COMPACT_QUERY + data-text-large）。
//
// D36（覆盖 X08 / P69 的缩格）：紧凑版**只改控件排布**（间距、题面高度、底栏两行），不再改书写格大小，字号也不触发缩格。
// 书写格边长由 writeGridSize 按「屏宽 − 32」与「视口高 − 预算」取小、夹在 [258, 400]（policy.writeGrid，P118），与字号无关；
// recall / trace / retrace 各阶段、点提示前后都是同一个边长。内部坐标仍是 345 单位（ink-canvas.js），这里只决定显示尺寸。
//
// 紧凑版布局（原型 ShiziWriteScreen L158–L224）：
// - 看答案页卡片按屏高取（fitC，原型 L382–L384；不超过书写格边长，也不超过正文内容宽，下限 200）。
// - 页头标题可换行（R-W18「判断页标题可换行」）；正文左右 20、上下收紧；固定 36px 的一行放结果行
//   （撤销 / 清空不再挪到格子上方：G32 / D36，标准版与紧凑版都在格下一行的右端，触控 ≥44pt）；格下一行（说明 + 撤销 / 清空）
//   与格子留出间距（R-W26：别贴着格子和按钮）。紧凑版靠收紧页边 / 题面 / 底栏的间距腾地方。
// - 底栏两行：「提示 · 写好了」一行（提示按钮不折行，列宽 auto / minmax(0,1fr)），「看答案 · 跳过 · 结束这组」一行
//   （三栏 minmax(0,1fr) auto minmax(0,1fr)；结束这组的槽位留给 M2）；按钮最小高 56。
// - 所有可点控件仍是 components/Button（<button>，R-G09）——原型紧凑版的 span/div 不照搬。
//
// 本模块只放样式与尺寸计算；写字页 index.js 读 useCompact() 决定结构（撤销 / 清空的位置、底栏两行）与尺寸。

import { useEffect, useLayoutEffect, useState } from '../../../../vendor/ui.js';
import { injectStyles, T } from '../../components/styles.js';
import * as policy from '../../../config/policy.js';

/** 书写格边长的下限 / 上限（policy.writeGrid，P118，D36）。 */
export const GRID_MIN = policy.writeGrid.min;
export const GRID_MAX = policy.writeGrid.max;
/** 看答案页卡片边长下限 / 缺省上限（V02：200–345；写字页实际上限取书写格边长）。 */
export const ANSWER_MIN = 200;
export const ANSWER_MAX = 345;
/** 视口高度不超过此值时用紧凑版（policy.compactMaxHeight，P69，D36；见本文件头）。 */
export const COMPACT_MAX_HEIGHT = policy.compactMaxHeight;
export const COMPACT_QUERY = `(max-height: ${COMPACT_MAX_HEIGHT}px)`;
/** 系统字号够大（--k ≥ policy.compactTextScale）时 platform/text-size.js 给 <html> 加的属性（P131）。 */
export const TEXT_LARGE_ATTR = 'data-text-large';

/** 写字页 Page 根（components/Page 把 testid 放在 .sz-page 上）。 */
const S = '.sz-page[data-testid="write-screen"]';

function compactRules(scope) {
  const P = `${scope} ${S}`.trim();
  return `
${P} .sz-write{--bleed:0px}
${P} .sz-write__gridwrap{margin-top:12px}
${P} .sz-page__head{padding-left:4px;padding-right:4px}
${P} .sz-page__title{position:relative;left:auto;right:auto;flex:1;min-width:0;padding:6px 8px;white-space:normal;
  overflow:visible;text-overflow:clip;line-height:1.3;text-wrap:balance}
${P} .sz-page__lead,${P} .sz-page__trail{flex:none}
${P} .sz-page__body{padding:2px 20px 2px;gap:12px}
${P} .sz-page__foot{padding:1px 20px max(6px, env(safe-area-inset-bottom, 0px));gap:6px}
${P} .sz-write__steps{margin:-4px 0 1px}
${P} .sz-write__prompt{min-height:0;gap:2px;padding:0 0 2px}
${P} .sz-write__note{line-height:1.4}
${P} .sz-write__foot .sz-btn--primary,${P} .sz-write__foot .sz-btn--secondary{min-height:56px;padding:0 12px;white-space:nowrap}
${P} .sz-write__main{grid-template-columns:auto minmax(0,1fr);gap:10px}
${P} .sz-write__hint{min-height:56px}
${P} .sz-write__hint .sz-hintbtn{padding:0 12px}
${P} .sz-answer__note,${P} .sz-write__note,${P} .sz-judge__note{text-wrap:pretty}
`;
}

// 系统字号 XXXL（--k 1.35，P130）比原型紧凑版的 1.3 大一点：最矮的 360×640 上格子已在下限 258，题面与格下说明多出约 7px，
// 说明会被底栏压住。只在大字号下收紧：格下说明行高 1.4 → 1.3（字号不变）、题面区去掉 2px 间距与 2px 下边距（提示行自带 10px 上边距），
// 说明与底栏仍留 ≥6px（R-W26），格子不缩（D36）。
const TEXT_LARGE_TIGHTEN = `
:root[data-text-large] ${S} .sz-write__note{line-height:1.3}
:root[data-text-large] ${S} .sz-write__prompt{gap:0;padding-bottom:0}
`;

injectStyles('write-compact', `
@media ${COMPACT_QUERY}{${compactRules('')}}
${compactRules(':root[data-text-large]')}
${TEXT_LARGE_TIGHTEN}
`);

function winOf(win) {
  if (win) return win;
  return typeof window !== 'undefined' ? window : null;
}

/** 当前是否用紧凑版（与 CSS 同一条件）。无 window（node:test）时为 false。 */
export function isCompact(win) {
  const w = winOf(win);
  if (!w) return false;
  const root = w.document && w.document.documentElement;
  if (root && root.hasAttribute && root.hasAttribute(TEXT_LARGE_ATTR)) return true;
  try {
    return !!(w.matchMedia && w.matchMedia(COMPACT_QUERY).matches);
  } catch (error) {
    return false;
  }
}

/** 订阅紧凑版条件：视口高度变化（matchMedia change）与 :root[data-text-large] 切换（系统字号变化）。 */
export function useCompact(win) {
  const [compact, setCompact] = useState(() => isCompact(win));
  useEffect(() => {
    const w = winOf(win);
    if (!w) return undefined;
    const sync = () => setCompact(isCompact(w));
    sync();
    let mql = null;
    try {
      mql = w.matchMedia ? w.matchMedia(COMPACT_QUERY) : null;
    } catch (error) {
      mql = null;
    }
    if (mql) {
      if (mql.addEventListener) mql.addEventListener('change', sync);
      else if (mql.addListener) mql.addListener(sync);
    }
    let mo = null;
    const root = w.document && w.document.documentElement;
    if (root && typeof w.MutationObserver === 'function') {
      mo = new w.MutationObserver(sync);
      mo.observe(root, { attributes: true, attributeFilter: [TEXT_LARGE_ATTR] });
    }
    return () => {
      if (mql) {
        if (mql.removeEventListener) mql.removeEventListener('change', sync);
        else if (mql.removeListener) mql.removeListener(sync);
      }
      if (mo) mo.disconnect();
    };
  }, [win]);
  return compact;
}

/**
 * 书写格显示边长（D36，P118；纯函数）。
 * 边长 = min(屏宽 − 2·sideMargin, 视口高 − 预算)，夹在 [min, max] 并取整；预算是页头 / 页边 / 行 / 题面 / 格下一行 / 底栏的高度
 * （policy.writeGrid.reserveStd / reserveCompact，视口高 ≤ compactMaxHeight 时用紧凑排布那份），再加安全区（顶部全算，底部只算
 * 超出底栏基线内边距的部分）。**与字号（--k、:root[data-text-large]）无关**：同一视口换系统字号前后边长不变，只有控件排布变。
 * @param {{width:number, height:number, safeTop?:number, safeBottom?:number}} o  width / height：页面（视口）的宽高，pt
 * @returns {number}
 */
export function writeGridSize({ width, height, safeTop = 0, safeBottom = 0 } = {}) {
  const g = policy.writeGrid;
  const w = Number.isFinite(width) && width > 0 ? width : null;
  const h = Number.isFinite(height) && height > 0 ? height : null;
  if (w === null && h === null) return STD_GRID;
  const short = h !== null && h <= COMPACT_MAX_HEIGHT;
  const reserve = short ? g.reserveCompact : g.reserveStd;
  const basePad = short ? SHORT_FOOT_PAD : STD_FOOT_PAD; // 底栏下内边距的基线（超出的安全区才多占高度）
  const top = Number.isFinite(safeTop) && safeTop > 0 ? safeTop : 0;
  const bottom = Number.isFinite(safeBottom) && safeBottom > basePad ? safeBottom - basePad : 0;
  const byWidth = w === null ? Infinity : w - 2 * g.sideMargin;
  const byHeight = h === null ? Infinity : h - reserve - top - bottom;
  return Math.max(g.min, Math.min(g.max, Math.floor(Math.min(byWidth, byHeight))));
}

/** 取不到视口时的缺省边长（旧标准格 345）。 */
const STD_GRID = 345;
/** 底栏下内边距基线：标准 max(20, 安全区) / 紧凑 max(6, 安全区)（见 Page.js、compactRules）。 */
const STD_FOOT_PAD = 20;
const SHORT_FOOT_PAD = 6;

/** 按窗口尺寸算书写格边长（首帧用；不读字号，D36）。无 window（node:test）时为缺省 345。 */
export function gridSizeOfWindow(win) {
  const w = winOf(win);
  if (!w) return STD_GRID;
  const root = w.document && w.document.documentElement;
  return writeGridSize({
    width: w.innerWidth || (root && root.clientWidth),
    height: w.innerHeight || (root && root.clientHeight),
  });
}

function px(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 写字页书写格边长：随页面尺寸（ResizeObserver）重算，不随字号、阶段、提示变化。
 * @param {{current: HTMLElement|null}} writeRef  .sz-write 元素（里面有 .sz-write__safe 安全区探针）
 * @returns {number}
 */
export function useWriteGridSize(writeRef, win) {
  const [size, setSize] = useState(() => gridSizeOfWindow(win));
  useLayoutEffect(() => {
    const w = winOf(win);
    const el = writeRef.current;
    const page = el && el.closest ? el.closest('.sz-page') : null;
    if (!w || !page || typeof w.getComputedStyle !== 'function') return undefined;
    const measure = () => {
      const width = page.clientWidth;
      const height = page.clientHeight;
      if (!(width > 0) || !(height > 0)) return; // 页面被藏在别的页下面或还没排版
      const probe = el.querySelector('.sz-write__safe');
      const cs = probe ? w.getComputedStyle(probe) : null;
      const next = writeGridSize({ width, height, safeTop: cs ? px(cs.paddingTop) : 0, safeBottom: cs ? px(cs.paddingBottom) : 0 });
      setSize(prev => (prev === next ? prev : next));
    };
    measure();
    let ro = null;
    if (typeof w.ResizeObserver === 'function') {
      ro = new w.ResizeObserver(measure);
      ro.observe(page);
    } else {
      w.addEventListener('resize', measure);
    }
    return () => {
      if (ro) ro.disconnect();
      else w.removeEventListener('resize', measure);
    };
  }, [win]);
  return size;
}

/**
 * 看答案页卡片边长（纯函数；原型 fitC L382–L384）：可用高度夹在 200–345 之间，且不超过内容宽。
 * @param {{available:number, width?:number, min?:number, max?:number}} o
 */
export function fitAnswerSize({ available, width = Infinity, min = ANSWER_MIN, max = ANSWER_MAX }) {
  const avail = Number.isFinite(available) ? Math.floor(available) : max;
  const byHeight = Math.max(min, Math.min(max, avail));
  const w = Number.isFinite(width) && width > 0 ? Math.floor(width) : Infinity;
  return Math.min(byHeight, w);
}

/**
 * 紧凑版看答案页：量出正文里除卡片外的高度，卡片取剩下的高度（200–345）。
 * @param {{current: HTMLElement|null}} writeRef  .sz-write 元素
 * @param {{enabled:boolean, key?:string, max?:number}} o  enabled：紧凑版且在 answer 阶段；key 变化（换字）时重量；max：卡片上限（写字页传书写格边长）
 * @returns {number}
 */
export function useAnswerFit(writeRef, { enabled, key = '', max = ANSWER_MAX }) {
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const el = writeRef.current;
    const body = el && el.closest ? el.closest('.sz-page__body') : null;
    if (!el || !body || typeof getComputedStyle !== 'function') return undefined;
    const measure = () => {
      const card = el.querySelector('[data-testid="write-answer-card"]');
      if (!card) return;
      const cs = getComputedStyle(body);
      const px = v => parseFloat(v) || 0;
      const wrap = card.closest('.sz-write__gridwrap');
      const innerW = wrap ? wrap.clientWidth : body.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
      const other = el.offsetHeight - card.offsetHeight + px(cs.paddingTop) + px(cs.paddingBottom);
      const next = fitAnswerSize({ available: body.clientHeight - other, width: innerW, max });
      setSize(prev => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(measure);
      ro.observe(body);
      ro.observe(el);
    } else {
      window.addEventListener('resize', measure);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, [enabled, key, max]);
  return size;
}
