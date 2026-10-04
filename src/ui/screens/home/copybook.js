// 首页字帖位的零件（阶段 1 P1-E5；设计稿「首练与首页」§三「首页」、D43 首页方案 B、D46 ①；阶段 1 E9a 按减法修稿 D49 改）。
//
//   BrandShi        品牌「拾」放在字帖格里（无记录时的字帖位）。字形是 ui/brand/shi.js 的矢量「拾」（拾字自绘 A1 骨架精修，不取自任何字体；
//                   整字一色墨，--hand，D33），内联 SVG、currentColor；尺寸 --cell / 框 / 读屏名称（role=img + aria-label）不变。
//                   TODO(资产)：书家实写的「拾」到位后只换 ui/brand/shi.js 的路径数据（06 P1-D2）。
//   HomeTie         一排（或两行四列）字帖格：今天写的字（本人笔迹，首页不画朱点，D46 ①）/ 进行中这一组的格子（写过的有墨，没写的是空笺面）/
//                   本人最近写的几个字（kind 'recent'，今天还没写 / 离开一周回来时的字帖位，H1 / D51 ④；不是按钮）。
//                   D49：字帖格只用两种线——外框 frameW frame + 格间 guideW guide（实线）；空格就是笺面，不画十字参照线，
//                   也不画下一格的 targetFrame（与结果页作品格同一画法）。
//
// 格宽（b = 屏宽 − 40）：「拾」单格 round(0.46b)；1–3 字 ⌊(b−40)/3⌋；4 字 ⌊(b−20)/4⌋；5 字 ⌊b/5⌋；6–8 字两行四列 ⌊(b−40)/4⌋。
// AX 档（axTieCellSize）：格宽按剩余高度重算，下限 44（整页可滚，实现交接 §1.4）。
// 墨线宽补偿（格越小笔画越粗）暂未做：InkMini 按格宽等比缩放笔画，设计稿的补偿表是按示意笔迹估的，等真笔模型（V01 / T2）出来后按真墨调。
//
// data-testid：home-brand-shi、home-recent-row / home-recent-item（最近写的字，同 home-ink-item 的 data-*）、home-ink-row（今天写的字，data-count；登记了「今天的记录」去处时是 <button>）、home-ink-item
//   （data-char / data-record / data-judgment / data-ink）、home-progress（这一组的格子）、home-cell（data-state = done | passed | next | empty、
//   data-index、data-char 只有 done 才有；next / empty 只是数据标记，画出来都是空笺面）。

import { html, useLayoutEffect, useMemo, useState } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { PracticeGlyph } from '../../components/PracticeGlyph.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { ShiMark } from '../../brand/shi.js';
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

/** AX 档字帖格宽下限（pt，实现交接 §1.4）。 */
export const AX_TIE_MIN = 44;

/**
 * AX 档字帖格宽（实现交接 §1.4「字帖位格宽按剩余高度重算（下限 44）」）：普通格宽 normal 是上限；剩余高度 avail 放不下 rows 行
 * 时按 ⌊avail / rows⌋ 缩小，但不小于 AX_TIE_MIN（再矮就让整页滚，主按钮不固定）。avail 未知（≤ 0 / 非数）→ 不缩。
 */
export function axTieCellSize(normal, rows, avail) {
  if (!(avail > 0) || !(rows >= 1)) return normal;
  return Math.max(AX_TIE_MIN, Math.min(normal, Math.floor(avail / rows)));
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
.sz-hshi__glyph{position:absolute;left:0;top:0;width:100%;height:100%;color:${T.hand}} /* 品牌「拾」是矢量图：墨框长边占格 62%，光学居中（ui/brand/shi.js） */
.sz-htie{position:relative;display:inline-flex;flex-wrap:wrap;width:calc(var(--cell) * var(--cols));box-sizing:border-box;${TEX};
  box-shadow:inset 0 0 0 ${T.frameW} ${T.frame}}
.sz-htie--btn.sz-btn{padding:0;display:inline-flex;text-align:left}
.sz-hcell{position:relative;display:block;width:var(--cell);height:var(--cell);box-sizing:border-box;container-type:inline-size;
  box-shadow:inset calc(-1 * ${T.guideW}) calc(-1 * ${T.guideW}) 0 ${T.guide}}
.sz-hcell[data-lastcol="true"]{box-shadow:inset 0 calc(-1 * ${T.guideW}) 0 ${T.guide}}
.sz-hcell[data-lastrow="true"]{box-shadow:inset calc(-1 * ${T.guideW}) 0 0 ${T.guide}}
.sz-hcell[data-lastcol="true"][data-lastrow="true"]{box-shadow:none}
.sz-hcell__ink{position:absolute;inset:12%}
.sz-hcell__ink .sz-compare__card{position:absolute;inset:0;border:0;border-radius:0;background:transparent;aspect-ratio:auto}
.sz-hcell__glyph{position:absolute;left:0;top:0;width:100%;height:100%;color:${T.under}} /* 没有墨迹的格：衬底字是轮廓，字面占格 0.76（tokens.json typography.glyph.tieCellFace） */
`);

/** 无记录时的字帖位：品牌「拾」。 */
export function BrandShi({ size }) {
  return html`<div class="sz-hshi" style=${{ '--cell': `${size}px` }} role="img" aria-label=${t('X-HOME.shiLabel')} data-testid="home-brand-shi">
    <${ShiMark} class="sz-hshi__glyph" />
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
 * @param {{cells:Array, size:number, kind:'today'|'progress', count?:number, label?:string, getInk?:Function, attrs?:object}} props
 * attrs：额外挂在容器上的 data-* 属性（进行中的组带 data-slot / data-kind / data-remaining，读屏名称里的剩余字数同源）
 */
export function HomeTie({ cells, size, kind, count = 0, label = '', getInk, attrs = null }) {
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
    if (kind === 'today' || kind === 'recent') {
      const points = rec ? recordInkPoints(rec, getInk) : null;
      return html`<span key=${rec ? rec.id : i} class="sz-hcell" ...${common} data-testid=${kind === 'recent' ? 'home-recent-item' : 'home-ink-item'}
        data-char=${rec.char} data-record=${rec.id} data-judgment=${rec.judgment} data-ink=${points && points.length ? 'ink' : 'none'}>
        <${CellInk} record=${rec} getInk=${getInk} />
      </span>`;
    }
    return html`<span key=${i} class="sz-hcell" ...${common} data-testid="home-cell" data-index=${cell.index}
      data-char=${filled && rec ? rec.char : ''} aria-hidden="true">
      ${filled && rec ? html`<${CellInk} record=${rec} getInk=${getInk} />` : null}
    </span>`;
  });
  const style = { '--cell': `${size}px`, '--cols': String(cols) };
  if (kind === 'today' && action) {
    return html`<${Button} variant="plain" class="sz-htie sz-htie--btn" style=${style} data-testid="home-ink-row" data-count=${count}
      aria-label=${label} onClick=${() => action()}>${items}</${Button}>`;
  }
  const testid = kind === 'today' ? 'home-ink-row' : kind === 'recent' ? 'home-recent-row' : 'home-progress';
  return html`<div class="sz-htie" style=${style} role="img" aria-label=${label} data-testid=${testid}
    data-count=${count} ...${attrs || {}}>${items}</div>`;
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
