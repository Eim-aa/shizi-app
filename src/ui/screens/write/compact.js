// 写字页的紧凑条件、AX 档、版式量测与看答案卡片尺寸（M1-7；V02；P0-D / D36；阶段 1 E9b 按 D49 重做）。
//
// 何时算「紧凑」：:root[data-text-large]（系统字号 --k ≥ policy.compactTextScale 1.3，P131 / D29，由 platform/text-size.js 设）或视口高度 ≤ COMPACT_MAX_HEIGHT
// （CSS 与 JS 同一个条件）。D49 起写字页 / 判断页的版式不再分「标准 / 紧凑」两套：页头、题面、书写格、格下工具行、按钮行是同一个结构，只由
// 可用高度（layout.js）与 AX 档（:root[data-ax]，本文件 useAxLevel）决定尺寸；紧凑条件只剩页头标题可换行（看答案不换卡后，看答案页的卡片按剩余高度取的 useAnswerFit 已删，W1）。
// 书写格边长 g、组顶、判断页两格边长全部是 layout.js 的纯函数，本文件的 useWriteLayout 只负责量出页面高 / 安全区 / 主区高与题面高后调用（g 与字号、阶段、提示无关，D29 / D36 / P195）。
//
// 本模块只放样式、量测 hook 与尺寸计算；写字页 index.js 读 useCompact() / useWriteLayout() 决定结构与尺寸。

import { useEffect, useLayoutEffect, useState } from '../../../../vendor/ui.js';
import { injectStyles, T } from '../../components/styles.js';
import * as policy from '../../../config/policy.js';
import {
  GRID_MIN, GRID_MAX, writeLayout, axWriteLayout, judgePairSize, judgeAxLayout, estimateLayout, nominalMainHeight, PROMPT_H_STD, FOOT_BOTTOM_MIN,
} from './layout.js';

export { GRID_MIN, GRID_MAX };

/** 视口高度不超过此值时用紧凑版（policy.compactMaxHeight，P69，D36；见本文件头）。 */
export const COMPACT_MAX_HEIGHT = policy.compactMaxHeight;
export const COMPACT_QUERY = `(max-height: ${COMPACT_MAX_HEIGHT}px)`;
/** 系统字号够大（--k ≥ policy.compactTextScale）时 platform/text-size.js 给 <html> 加的属性（P131）。 */
export const TEXT_LARGE_ATTR = 'data-text-large';

/** 写字页 Page 根（components/Page 把 testid 放在 .sz-page 上）。 */
const S = '.sz-page[data-testid="write-screen"]';

// 紧凑 / 大字号下只剩两件事：页头标题可换行（看答案 / 描一遍阶段的标题），其余版式一律由 layout.js 与 index.js 的结构规则决定（D49：不再有第二套排布）。
function compactRules(scope) {
  const P = `${scope} ${S}`.trim();
  return `
${P} .sz-page__title{position:relative;left:auto;right:auto;flex:1;min-width:0;padding:6px 8px;white-space:normal;
  overflow:visible;text-overflow:clip;line-height:1.3;text-wrap:balance}
${P} .sz-page__lead,${P} .sz-page__trail{flex:none}
${P} .sz-page__title--hidden{position:absolute;flex:none;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
${P} .sz-answer__note,${P} .sz-write__note,${P} .sz-judge__note{text-wrap:pretty}
`;
}

injectStyles('write-compact', `
@media ${COMPACT_QUERY}{${compactRules('')}}
${compactRules(':root[data-text-large]')}
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

function px(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** 系统「更大字体」辅助功能档（platform/text-size.js 给 <html> 加 data-ax="1".."5"）；0 = 不是 AX 档。 */
export function axLevelOf(win) {
  const w = winOf(win);
  const root = w && w.document && w.document.documentElement;
  const n = root && root.getAttribute ? parseInt(root.getAttribute('data-ax'), 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 订阅 AX 档（:root[data-ax] 变化）。 */
export function useAxLevel(win) {
  const [level, setLevel] = useState(() => axLevelOf(win));
  useEffect(() => {
    const w = winOf(win);
    const root = w && w.document && w.document.documentElement;
    if (!w || !root || typeof w.MutationObserver !== 'function') return undefined;
    const sync = () => setLevel(axLevelOf(w));
    sync();
    const mo = new w.MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ['data-ax'] });
    return () => mo.disconnect();
  }, [win]);
  return level;
}

/** 这些阶段的页面骨架（页头 + 标准按钮行）就是书写格那一套，量到的主区高有效；其余阶段（看答案 / 描一遍…）沿用最近一次量到的，书写格大小不变（D36）。
 *  AX 档（D51 ⑦，P225）每个阶段的页头 / 底栏都是 AX 专属的一行版式，各阶段都量（见 useWriteLayout）。 */
const MEASURED_PHASES = Object.freeze(['recall', 'compare']);

/**
 * 写字页 / 判断页的版式：量出页面高、安全区、实际主区高（.sz-page__body 的内高）与题面高 P，交给 layout.js 的纯函数（D49，实现交接 §13.2 / §9.1 / §9.4）。
 * 书写格边长 g 只用「名义主区高」（标准字号下的版式 + 量到的安全区，layout.js nominalMainHeight；P195）——不随系统字号（含 AX 档）、阶段、提示变化（D29 / D36）；
 * 组的位置（top）与判断页两格按实际量到的主区高排。随页面尺寸（ResizeObserver）重算；非回忆 / 判断阶段沿用最近一次量到的值。
 * @param {{current: HTMLElement|null}} writeRef  .sz-write 元素
 * @param {{phase:string, ax:number}} o
 * @returns {{g:number, top:number, gridTop:number, toolsHeight:number, mainHeight:number, nominalHeight:number, promptHeight:number,
 *            pair:{s:number, layout:'stack'|'side', top:number}}}
 */
export function useWriteLayout(writeRef, { phase = 'recall', ax = 0 } = {}, win) {
  const [measured, setMeasured] = useState(() => ({ ...estimateLayout(win), width: NaN, mainHeight: NaN, nominalHeight: NaN, promptHeight: PROMPT_H_STD }));
  useLayoutEffect(() => {
    const w = winOf(win);
    const el = writeRef.current;
    const page = el && el.closest ? el.closest('.sz-page') : null;
    const body = page ? page.querySelector('.sz-page__body') : null;
    if (!w || !page || !body || typeof w.getComputedStyle !== 'function') return undefined;
    const measure = () => {
      const width = page.clientWidth;
      const cs = w.getComputedStyle(body);
      const bodyPad = px(cs.paddingTop) + px(cs.paddingBottom);
      const mainHeight = body.clientHeight - bodyPad;
      if (!(width > 0) || !(mainHeight > 0)) return; // 被藏在别的页下面或还没排版
      // 名义主区高：页面高、上安全区（页头上内边距）、按钮行下内边距（= max(8, 下安全区)）都与系统字号无关，页头 / 按钮行的内容高取 L 档名义值。
      const head = page.querySelector('.sz-page__head');
      const foot = page.querySelector('.sz-page__foot');
      const nominalHeight = nominalMainHeight({
        pageHeight: page.clientHeight,
        safeTop: head ? px(w.getComputedStyle(head).paddingTop) : 0,
        footBottom: foot ? px(w.getComputedStyle(foot).paddingBottom) : FOOT_BOTTOM_MIN,
        bodyPad,
      });
      const prompt = el.querySelector('.sz-write__prompt');
      const promptHeight = prompt ? prompt.offsetHeight : PROMPT_H_STD;
      setMeasured(prev => {
        const keep = ax <= 0 && !MEASURED_PHASES.includes(phase) && Number.isFinite(prev.mainHeight);
        const mh = keep ? prev.mainHeight : mainHeight;
        const nh = keep ? prev.nominalHeight : nominalHeight;
        const ph = keep ? prev.promptHeight : promptHeight;
        if (prev.width === width && prev.mainHeight === mh && prev.nominalHeight === nh && prev.promptHeight === ph) return prev;
        return { width, mainHeight: mh, nominalHeight: nh, promptHeight: ph };
      });
    };
    measure();
    let ro = null;
    if (typeof w.ResizeObserver === 'function') {
      ro = new w.ResizeObserver(measure);
      ro.observe(page);
      ro.observe(body);
    } else {
      w.addEventListener('resize', measure);
    }
    return () => {
      if (ro) ro.disconnect();
      else w.removeEventListener('resize', measure);
    };
  }, [phase, win, ax > 0]);
  const { width, mainHeight, nominalHeight, promptHeight } = measured;
  // AX 档：按实际可用高度排（永不滚动，axWriteLayout）；其余档仍按名义版式（D29 / D36 / P195）。
  const base = Number.isFinite(mainHeight)
    ? (ax > 0 ? axWriteLayout({ width, mainHeight, promptHeight }) : writeLayout({ width, mainHeight, nominalHeight, promptHeight }))
    : { g: measured.g, top: measured.top, gridTop: measured.gridTop, toolsHeight: measured.toolsHeight };
  let pair = { s: 0, layout: 'stack', top: base.top };
  if (phase === 'compare' && Number.isFinite(mainHeight)) {
    if (ax > 0) {
      const a = judgeAxLayout({ width, mainHeight, promptHeight });
      pair = { s: a.s, layout: a.layout, top: a.top };
    } else {
      pair = { s: judgePairSize({ width, mainHeight, gridTop: base.gridTop }), layout: 'stack', top: base.top };
    }
  }
  return { ...base, mainHeight, nominalHeight, promptHeight, pair };
}

/**
 * 内容比可视高度长、且还有内容被按钮行挡在下面时，按钮行上沿出现 hairline（实现交接 §0.5：内容可滚、且滚到按钮行下面时；qa-simC D2）。
 * 直接写按钮行元素的 data-under（不走 state，不触发重画）；CSS 见 write/index.js。
 * @param {{current: HTMLElement|null}} writeRef  .sz-write 元素
 * @param {any[]} deps  内容变化时重算
 */
export function useFootHairline(writeRef, deps = []) {
  useLayoutEffect(() => {
    const w = winOf();
    const el = writeRef.current;
    const page = el && el.closest ? el.closest('.sz-page') : null;
    const body = page ? page.querySelector('.sz-page__body') : null;
    if (!w || !page || !body) return undefined;
    const update = () => {
      const foot = page.querySelector('.sz-page__foot');
      if (!foot) return;
      const more = body.scrollHeight > body.clientHeight + 1 && body.scrollTop + body.clientHeight < body.scrollHeight - 1;
      if (more) foot.setAttribute('data-under', 'true');
      else foot.removeAttribute('data-under');
    };
    update();
    body.addEventListener('scroll', update, { passive: true });
    let ro = null;
    if (typeof w.ResizeObserver === 'function') {
      ro = new w.ResizeObserver(update);
      ro.observe(body);
      ro.observe(el);
    } else {
      w.addEventListener('resize', update);
    }
    return () => {
      body.removeEventListener('scroll', update);
      if (ro) ro.disconnect();
      else w.removeEventListener('resize', update);
      const foot = page.querySelector('.sz-page__foot');
      if (foot) foot.removeAttribute('data-under');
    };
  }, deps);
}
