// 紧凑版写字页（M1-7；02 §3 M1-7；R-W18 / R-W26 / R-G09；走查-W15 / 核对-V02 / X08；reference/I-proto-write.md §3.7）。
//
// 何时用紧凑版：:root[data-large]（原型 size==='compact' ⇔ 更大字体，--k 1.3），或视口高度 ≤ COMPACT_MAX_HEIGHT
// （标准版 393×852 的整页需要约 790px 才能让书写格与底栏同屏；360×640 这类短屏在标准字号下也走紧凑版）。
// 高度阈值是工程取值（原型只按 large 切换），已登记待产品确认；CSS 与 JS 用同一个条件（COMPACT_QUERY + data-large）。
//
// 紧凑版布局（原型 ShiziWriteScreen L158–L224）：
// - 书写格 recall / trace / retrace 固定 258（X08：点提示前后不变）；看答案页卡片按屏高在 200–345 之间取（fitC，
//   原型 L382–L384；另不超过正文内容宽）。
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

/** 紧凑版书写格边长（X08：recall / trace / retrace 固定 258pt）。 */
export const COMPACT_GRID = 258;
/** 看答案页卡片边长下限 / 上限（V02：200–345）。 */
export const ANSWER_MIN = 200;
export const ANSWER_MAX = 345;
/** 视口高度不超过此值时用紧凑版（policy.compactMaxHeight，P69，待设计确认；见本文件头）。 */
export const COMPACT_MAX_HEIGHT = policy.compactMaxHeight;
export const COMPACT_QUERY = `(max-height: ${COMPACT_MAX_HEIGHT}px)`;

/** 写字页 Page 根（components/Page 把 testid 放在 .sz-page 上）。 */
const S = '.sz-page[data-testid="write-screen"]';

function compactRules(scope) {
  const P = `${scope} ${S}`.trim();
  return `
${P} .sz-page__head{padding-left:4px;padding-right:4px}
${P} .sz-page__title{position:relative;left:auto;right:auto;flex:1;min-width:0;padding:6px 8px;white-space:normal;
  overflow:visible;text-overflow:clip;line-height:1.3;text-wrap:balance}
${P} .sz-page__lead,${P} .sz-page__trail{flex:none}
${P} .sz-page__body{padding:2px 20px 2px;gap:12px}
${P} .sz-page__foot{padding:1px 20px max(6px, env(safe-area-inset-bottom, 0px));gap:6px}
${P} .sz-write__steps{margin:-4px 0 1px}
${P} .sz-write__line{min-height:36px;justify-content:center}
${P} .sz-write__line .sz-line{min-height:36px}
${P} .sz-write__line .sz-line__change{min-height:44px;margin:-4px 0}
${P} .sz-write__prompt{min-height:0;gap:2px;padding:0 0 2px}
${P} .sz-write__below{min-height:44px;margin-top:6px}
${P} .sz-write__note{line-height:1.4}
${P} .sz-write__foot .sz-btn--primary,${P} .sz-write__foot .sz-btn--secondary{min-height:56px;padding:0 12px;
  letter-spacing:.02em;white-space:nowrap}
${P} .sz-write__main{grid-template-columns:auto minmax(0,1fr);gap:10px}
${P} .sz-write__hint{min-height:56px}
${P} .sz-write__hint .sz-hintbtn{padding:0 12px}
${P} .sz-write__foot .sz-write__linkrow{min-height:28px}
${P} .sz-write__foot .sz-write__skiprow{min-height:40px}
${P} .sz-write__links{min-height:40px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center}
${P} .sz-write__links>.sz-write__linkrow{justify-self:start;min-height:40px}
${P} .sz-write__links>.sz-write__skiprow{justify-self:center;min-height:40px}
${P} .sz-write__links>.sz-write__endslot{justify-self:end;display:flex;align-items:center}
${P} .sz-judge__btn{min-height:calc(72px * ${T.k})}
${P} .sz-answer__note,${P} .sz-write__note,${P} .sz-judge__note{text-wrap:pretty}
`;
}

injectStyles('write-compact', `
@media ${COMPACT_QUERY}{${compactRules('')}}
${compactRules(':root[data-large]')}
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
  if (root && root.hasAttribute && root.hasAttribute('data-large')) return true;
  try {
    return !!(w.matchMedia && w.matchMedia(COMPACT_QUERY).matches);
  } catch (error) {
    return false;
  }
}

/** 订阅紧凑版条件：视口高度变化（matchMedia change）与 :root[data-large] 切换。 */
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
      mo.observe(root, { attributes: true, attributeFilter: ['data-large'] });
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
 * @param {{enabled:boolean, key?:string}} o      enabled：紧凑版且在 answer 阶段；key 变化（换字）时重量
 * @returns {number}
 */
export function useAnswerFit(writeRef, { enabled, key = '' }) {
  const [size, setSize] = useState(ANSWER_MAX);
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
      const innerW = body.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
      const other = el.offsetHeight - card.offsetHeight + px(cs.paddingTop) + px(cs.paddingBottom);
      const next = fitAnswerSize({ available: body.clientHeight - other, width: innerW });
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
  }, [enabled, key]);
  return size;
}
