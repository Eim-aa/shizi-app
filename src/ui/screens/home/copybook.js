// 首页字帖位的零件（阶段 1 P1-E5；设计稿「首练与首页」§三「首页」、D43 首页方案 B、D46 ①）。
//
//   BrandShi        书家写的「拾」放在字帖格里（无记录时的字帖位）。书家稿还没到：先用 ShiziKai 的「拾」占位（与设计稿用霞鹜文楷轮廓
//                   占位同一个字形来源）；书家稿到位后把 .sz-hshi__glyph 换成 assets 里的矢量资产，这个组件的尺寸 / 框 / 读屏名称不动。
//                   TODO(资产)：书家「拾」到位后替换占位（06 P1-D2）。不显示任何「占位」字样给用户。
//   HomeTie         一排（或两行四列）字帖格：今天写的字（本人笔迹，首页不画朱点，D46 ①）/ 进行中这一组的格子
//                   （写过的有墨，没写的空格只画十字参照线、不露字也不画衬底，下一格 1.5pt 墨框）。
//   MiniRow         「昨天写的字」一行：本人笔迹 34pt 无格，只放有墨的字。
//
// 格宽（b = 屏宽 − 40）：「拾」单格 round(0.46b)；1–3 字 ⌊(b−40)/3⌋；4 字 ⌊(b−20)/4⌋；5 字 ⌊b/5⌋；6–8 字两行四列 ⌊(b−40)/4⌋。
// 墨线宽补偿（格越小笔画越粗）暂未做：InkMini 按格宽等比缩放笔画，设计稿的补偿表是按示意笔迹估的，等真笔模型（V01 / T2）出来后按真墨调。
//
// data-testid：home-brand-shi、home-ink-row（今天写的字，data-count；登记了「今天的记录」去处时是 <button>）、home-ink-item
//   （data-char / data-record / data-judgment / data-ink）、home-progress（这一组的格子）、home-cell（data-state = done | passed | next | empty、
//   data-index、data-char 只有 done 才有）、home-last-row（data-day）、home-last-item（data-char）。

import { html, useLayoutEffect, useMemo, useState } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { PracticeGlyph } from '../../components/PracticeGlyph.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { InkMini } from '../write/compare.js';
import { getTodayRecordsAction, recordInkPoints } from './ink-row.js';

/** 字帖格里衬底字的字面占格比例（tokens.json typography.glyph.tieCellFace）。 */
export const TIE_CELL_FACE = 0.76;

/** 字帖格的列数：≤5 字一行，6–8 字两行四列。 */
export function tieCols(n) {
  return n <= 5 ? Math.max(1, n) : 4;
}

/** 字帖格边长（px；b = 屏宽 − 40）。 */
export function tieCellSize(n, b) {
  if (n <= 3) return Math.floor((b - 40) / 3);
  if (n === 4) return Math.floor((b - 20) / 4);
  if (n === 5) return Math.floor(b / 5);
  return Math.floor((b - 40) / 4);
}

/** 首页字帖位里单个「拾」的格宽。 */
export function shiCellSize(b) {
  return Math.round(b * 0.46);
}

/** 首次打开的「拾」：iPhone 17 约 200、SE 3 172、Pro Max 216；按屏宽取、夹在 [172, 216]。 */
export function firstShiSize(width) {
  return Math.max(172, Math.min(216, Math.round(width * 0.5)));
}

/** 字帖位高度（px，不含下面的说明）：用来在区域里垂直居中以外的场合估高；单格 / 一排 / 两排。 */
export function tieHeight(n, size) {
  return size * Math.ceil(n / tieCols(n));
}

injectStyles('home-copybook', `
.sz-hshi{position:relative;display:grid;place-items:center;box-sizing:border-box;width:var(--cell);height:var(--cell);${TEX};
  box-shadow:inset 0 0 0 ${T.frameW} ${T.frame};container-type:inline-size}
.sz-hshi__glyph{font-family:${T.kai};font-size:62cqw;line-height:1;color:${T.hand}}
.sz-htie{position:relative;display:inline-flex;flex-wrap:wrap;width:calc(var(--cell) * var(--cols));box-sizing:border-box;${TEX};
  box-shadow:inset 0 0 0 ${T.frameW} ${T.frame}}
.sz-htie--btn.sz-btn{padding:0;display:inline-flex;text-align:left}
.sz-hcell{position:relative;display:block;width:var(--cell);height:var(--cell);box-sizing:border-box;container-type:inline-size;
  box-shadow:inset calc(-1 * ${T.guideW}) calc(-1 * ${T.guideW}) 0 ${T.guide}}
.sz-hcell[data-lastcol="true"]{box-shadow:inset 0 calc(-1 * ${T.guideW}) 0 ${T.guide}}
.sz-hcell[data-lastrow="true"]{box-shadow:inset calc(-1 * ${T.guideW}) 0 0 ${T.guide}}
.sz-hcell[data-lastcol="true"][data-lastrow="true"]{box-shadow:none}
.sz-hcell[data-state="next"]::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 0 ${T.targetW} ${T.ink1}}
.sz-hcell__ink{position:absolute;inset:12%}
.sz-hcell__ink .sz-compare__card{position:absolute;inset:0;border:0;border-radius:0;background:transparent;aspect-ratio:auto}
.sz-hcell__glyph{position:absolute;left:0;top:0;width:100%;height:100%;color:${T.under}} /* 没有墨迹的格：衬底字是轮廓，字面占格 0.76（tokens.json typography.glyph.tieCellFace） */
.sz-hcell__guides{position:absolute;inset:0;width:100%;height:100%;color:${T.guide};pointer-events:none}
.sz-hmini{display:flex;justify-content:center;gap:6px}
.sz-hmini__item{position:relative;width:34px;height:34px;flex:none}
.sz-hmini__item .sz-compare__card{position:absolute;inset:4%;border:0;border-radius:0;background:transparent;aspect-ratio:auto}
`);

/** 十字参照线（虚线，随格缩放；颜色取 currentColor = --guide）。 */
function Guides() {
  return html`<svg class="sz-hcell__guides" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M50 0V100M0 50H100" fill="none" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"></path>
  </svg>`;
}

/** 无记录时的字帖位：书家「拾」。 */
export function BrandShi({ size }) {
  return html`<div class="sz-hshi" style=${{ '--cell': `${size}px` }} role="img" aria-label=${t('X-HOME.shiLabel')} data-testid="home-brand-shi">
    <span class="sz-hshi__glyph" aria-hidden="true">${t('X-HOME.shiLabel')}</span>
  </div>`;
}

function CellInk({ record, getInk }) {
  const points = useMemo(() => recordInkPoints(record, getInk), [record, getInk]);
  const has = !!(points && points.length);
  if (has) return html`<span class="sz-hcell__ink"><${InkMini} points=${points} testid="home-ink-mine" emptyText="" /></span>`;
  return html`<${PracticeGlyph} class="sz-hcell__glyph" hidden=${true} char=${record.char} face=${TIE_CELL_FACE} />`;
}

/**
 * 字帖格。cells：[{index, state: 'ink' | 'done' | 'passed' | 'next' | 'empty', record?, char?}]
 *   'ink' / 'done' 有记录（画本人笔迹，没有墨迹时画楷体字、次文字色）；其余是空格（十字线，不露字）。
 * @param {{cells:Array, size:number, kind:'today'|'progress', count?:number, label?:string, getInk?:Function}} props
 */
export function HomeTie({ cells, size, kind, count = 0, label = '', getInk }) {
  const n = cells.length;
  if (!n) return null;
  const cols = tieCols(n);
  const rows = Math.ceil(n / cols);
  const action = kind === 'today' ? getTodayRecordsAction() : null;
  const items = cells.map((cell, i) => {
    const filled = cell.state === 'ink' || cell.state === 'done';
    const rec = cell.record || null;
    const lastCol = (i + 1) % cols === 0 || i === n - 1;
    const lastRow = Math.floor(i / cols) === rows - 1;
    const common = { 'data-lastcol': lastCol ? 'true' : 'false', 'data-lastrow': lastRow ? 'true' : 'false', 'data-state': cell.state };
    if (kind === 'today') {
      const points = rec ? recordInkPoints(rec, getInk) : null;
      return html`<span key=${rec ? rec.id : i} class="sz-hcell" ...${common} data-testid="home-ink-item" data-char=${rec.char} data-record=${rec.id}
        data-judgment=${rec.judgment} data-ink=${points && points.length ? 'ink' : 'none'}>
        <${CellInk} record=${rec} getInk=${getInk} />
      </span>`;
    }
    return html`<span key=${i} class="sz-hcell" ...${common} data-testid="home-cell" data-index=${cell.index}
      data-char=${filled && rec ? rec.char : ''} aria-hidden="true">
      ${filled && rec ? html`<${CellInk} record=${rec} getInk=${getInk} />` : html`<${Guides} />`}
    </span>`;
  });
  const style = { '--cell': `${size}px`, '--cols': String(cols) };
  if (kind === 'today' && action) {
    return html`<${Button} variant="plain" class="sz-htie sz-htie--btn" style=${style} data-testid="home-ink-row" data-count=${count}
      aria-label=${label} onClick=${() => action()}>${items}</${Button}>`;
  }
  return html`<div class="sz-htie" style=${style} role="img" aria-label=${label} data-testid=${kind === 'today' ? 'home-ink-row' : 'home-progress'}
    data-count=${count}>${items}</div>`;
}

/** 「昨天写的字」一行：本人笔迹 34pt，无格。items = [{char, record}]。 */
export function MiniRow({ items, day, label, getInk }) {
  if (!items || !items.length) return null;
  return html`<div class="sz-hmini" role="img" aria-label=${label} data-testid="home-last-row" data-day=${day}>
    ${items.map(it => html`<span key=${it.record.id} class="sz-hmini__item" data-testid="home-last-item" data-char=${it.char}
      data-record=${it.record.id}><${MiniInk} record=${it.record} getInk=${getInk} /></span>`)}
  </div>`;
}

function MiniInk({ record, getInk }) {
  const points = useMemo(() => recordInkPoints(record, getInk), [record, getInk]);
  if (!points || !points.length) return null;
  return html`<${InkMini} points=${points} testid="home-last-ink" emptyText="" />`;
}

/** 元素的内容宽（clientWidth，px），随 resize 更新；挂载前给 fallback。首页字帖位的格宽按它算（b = 内容宽 − 40）。 */
export function useElementWidth(ref, fallback = 393) {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => {
      const next = el.clientWidth;
      if (next > 0) setW(prev => (Math.abs(prev - next) > 0.5 ? next : prev));
    };
    read();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return w;
}
