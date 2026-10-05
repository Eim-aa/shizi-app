// 首页字帖位的零件（阶段 1 P1-E5；设计稿「首练与首页」§三「首页」、D43 首页方案 B、D46 ①；阶段 1 E9a 按减法修稿 D49 改）。
//
//   ShiHandoff      「拾」的交接格（H1 / D51 ④；C3-H / D53 ④ 重做）：品牌「拾」先停 600ms，再 500ms「退灰 → 本人墨逐笔写出 → 灰字退场」（handoff.js 时间表、handoff-ink.js 回放），格下一句「你写下的第一个「拾」。」；首练写下「拾」后第一次回首页出现一次。
//   BrandShi        品牌「拾」放在字帖格里（首次打开与没有可显示的本人墨时的字帖位）。字形是 ui/brand/shi.js 的矢量「拾」（拾字自绘 A1 骨架精修，不取自任何字体；
//                   整字一色墨，--hand，D33），内联 SVG、currentColor；尺寸 --cell / 框 / 读屏名称（role=img + aria-label）不变。
//                   TODO(资产)：书家实写的「拾」到位后只换 ui/brand/shi.js 的路径数据（06 P1-D2）。
//   HomeTie         一排（或两行四列）字帖格：今天写的字（本人笔迹，首页不画朱点，D46 ①）/ 进行中这一组的格子（写过的有墨，没写的是空笺面）/
//                   本人最近写的几个字（kind 'recent'，今天还没写 / 离开一周回来时的字帖位，H1 / D51 ④；不是按钮）。
//                   D49：字帖格只用两种线——外框 frameW frame + 格间 guideW guide（实线）；空格就是笺面，不画十字参照线，
//                   也不画下一格的 targetFrame（与结果页作品格同一画法）。
//
// 格宽（b = 屏宽 − 40 = 版心宽，T3-01 / D53 ③）：min(⌊b / 列数⌋, 160)——1–5 字一行（列数 = 字数）、6–8 字两行四列；单个「拾」同一规则（= 一格）。一行字帖撑满版心，1–2 字封顶 160。
// AX 档（axTieCellSize）：格宽按剩余高度重算，下限 44（整页可滚，实现交接 §1.4）。
// 墨线宽补偿（格越小笔画越粗）暂未做：InkMini 按格宽等比缩放笔画，设计稿的补偿表是按示意笔迹估的，等真笔模型（V01 / T2）出来后按真墨调。
//
// data-testid：home-brand-shi、home-shi-handoff（data-char / data-record；内层 home-shi-handoff-mine）、home-recent-row / home-recent-item（最近写的字，同 home-ink-item 的 data-*）、home-ink-row（今天写的字，data-count；登记了「今天的记录」去处时是 <button>）、home-ink-item
//   （data-char / data-record / data-judgment / data-ink）、home-progress（这一组的格子）、home-cell（data-state = done | passed | next | empty、
//   data-index、data-char 只有 done 才有；next / empty 只是数据标记，画出来都是空笺面）。

import { html, useEffect, useLayoutEffect, useMemo, useState } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { PracticeGlyph } from '../../components/PracticeGlyph.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { ShiMark } from '../../brand/shi.js';
import { InkMini } from '../write/compare.js';
import { getTodayRecordsAction, recordInkPoints } from './ink-row.js';
import { HANDOFF_FADE_MS, HANDOFF_GRAY_MS, HANDOFF_STEPS } from './handoff.js';
import { HandoffInk, inkTimeSpan } from './handoff-ink.js';

/** 字帖格里衬底字的字面占格比例（tokens.json typography.glyph.tieCellFace）。 */
export const TIE_CELL_FACE = 0.76;

/** 字帖格的列数：≤5 字一行，6–8 字两行四列。 */
export function tieCols(n) {
  return n <= 5 ? Math.max(1, n) : 4;
}

/** 字帖格边长上限（pt，T3-01 / D53 ③）：一格最大 160，字数少时不再放大。 */
export const TIE_CELL_MAX = 160;

/**
 * 字帖格边长（px；b = 版心宽 = 屏宽 − 40，T3-01 / D53 ③）：min(b / n, 160)——一行字帖永远撑满 20pt 页边之间的版心（取整后最多差 n px），
 * 字数少到 160 封顶（1–2 字）；6–8 字两行四列，同样按 b / 4 算。
 */
export function tieCellSize(n, b) {
  const per = Math.floor(b / tieCols(n));
  return Math.max(1, Math.min(TIE_CELL_MAX, per));
}

/** 首页字帖位里单个「拾」（品牌 / 交接）的格宽：与一格字帖同一条规则。 */
export function shiCellSize(b) {
  return tieCellSize(1, b);
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
/* 「拾」的交接（C3-H / D53 ④）：品牌字先退成浅灰（一层不透明、只换色），本人墨按笔顺逐笔写出，最后灰字退场；任何一帧不出现两层同时半透明。阶段由 data-phase 给：hold / gray / write / fade / done */
.sz-hshi__mine{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
.sz-hshi__ink{position:absolute;inset:12%;display:block}
.sz-hshi__ink canvas{display:block}
.sz-hshi--handoff .sz-hshi__brand{transition:color ${HANDOFF_GRAY_MS}ms linear,opacity ${HANDOFF_FADE_MS}ms linear}
.sz-hshi--handoff[data-phase="gray"] .sz-hshi__brand,.sz-hshi--handoff[data-phase="write"] .sz-hshi__brand{color:${T.under}}
.sz-hshi--handoff[data-phase="fade"] .sz-hshi__brand,.sz-hshi--handoff[data-phase="done"] .sz-hshi__brand{color:${T.under};opacity:0}
.sz-hshi--handoff[data-phase="hold"] .sz-hshi__mine,.sz-hshi--handoff[data-phase="gray"] .sz-hshi__mine{visibility:hidden}
.sz-hshi--handoff[data-phase="write"] .sz-hshi__mine--fade{animation:szHandoffIn 300ms linear both}
@keyframes szHandoffIn{from{opacity:0}to{opacity:1}}
.sz-hshi--handoff[data-phase="done"] .sz-hshi__brand{visibility:hidden}
.sz-hshi__line{margin:12px 0 0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};opacity:0;transition:opacity 200ms ease-out} /* 格下只这一次的一句：占位始终保留，免得出现时挪动版面 */
.sz-hshi__line[data-on="true"]{opacity:1}
@media (prefers-reduced-motion: reduce){
  .sz-hshi--handoff .sz-hshi__brand{display:none}
  .sz-hshi__line{transition:none}
}
.sz-htie{position:relative;display:inline-flex;flex-wrap:wrap;width:calc(var(--cell) * var(--cols));box-sizing:border-box;${TEX};
  box-shadow:inset 0 0 0 ${T.frameW} ${T.frame}}
.sz-htie--btn.sz-btn{padding:0;display:inline-flex;text-align:left}
.sz-htie--recent{--hand:${T.ink2}} /* 最近写的字（今天还没写）用 ink2 画，与今天写的区分（N3-02 / D53）：墨取 --hand，这里只在这一排改它 */
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

function prefersReduced() {
  try {
    return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (error) {
    return false;
  }
}

/** 页面转场（.sz-app[data-nav-anim]）结束后再开始计时：品牌「拾」要在静止的首页上完整停 600ms。取不到 .sz-app 或 1.5s 还没结束也开始。返回取消函数。 */
function whenNavIdle(start) {
  const app = typeof document !== 'undefined' ? document.querySelector('.sz-app') : null;
  if (!app || app.dataset.navAnim === 'idle') {
    start();
    return () => {};
  }
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    clearTimeout(guard);
    start();
  };
  const observer = new MutationObserver(() => { if (app.dataset.navAnim === 'idle') go(); });
  observer.observe(app, { attributes: true, attributeFilter: ['data-nav-anim'] });
  const guard = setTimeout(go, 1500);
  return () => {
    done = true;
    observer.disconnect();
    clearTimeout(guard);
  };
}

/**
 * 「拾」的交接格（H1 / D51 ④、N2-02；03 P221；C3-H 重做：N3-01、I3-06、T3-07；D53 ④，03 P245）：首页出现后，品牌「拾」先在静止的首页上停 600ms；
 * 再 500ms「退灰 → 写墨」——品牌字退成浅灰（只换色）→ 本人的「拾」按笔顺逐笔写出（有笔画时间数据就按时间回放，没有就整字淡入）→ 灰字退场；
 * 任何一帧都不出现两层同时半透明（时间表见 handoff.js HANDOFF_STEPS）。格下只这一次出现「你写下的第一个「拾」。」（墨写完时淡入，保留到离开首页）。
 * 「减少动态效果」：直接是本人的字（品牌层不显示、不动画），那句话立即出现。读屏名称 X-HOME.shiHandoffLabel（整个 App 唯一一处「拾回」）。
 * data-phase = hold / gray / write / fade / done。
 */
export function ShiHandoff({ size, record, getInk }) {
  const reduced = prefersReduced();
  const [phase, setPhase] = useState(reduced ? 'done' : 'hold');
  const points = useMemo(() => recordInkPoints(record, getInk), [record, getInk]);
  const has = !!(points && points.length);
  useEffect(() => {
    if (reduced) return undefined;
    const timers = [];
    const cancel = whenNavIdle(() => {
      for (const [name, at] of HANDOFF_STEPS) timers.push(setTimeout(() => setPhase(name), at));
    });
    return () => {
      cancel();
      timers.forEach(clearTimeout);
    };
  }, []);
  const lineOn = phase === 'fade' || phase === 'done';
  return html`<div class="sz-hshi sz-hshi--handoff" style=${{ '--cell': `${size}px` }} role="img" aria-label=${t('X-HOME.shiHandoffLabel')}
    data-testid="home-shi-handoff" data-phase=${phase} data-char=${record.char} data-record=${record.id}>
    <${ShiMark} class="sz-hshi__glyph sz-hshi__brand" />
    <span class=${has && inkTimeSpan(points) ? 'sz-hshi__mine' : 'sz-hshi__mine sz-hshi__mine--fade'} data-testid="home-shi-handoff-mine">
      ${has
        ? html`<${HandoffInk} points=${points} phase=${phase} />`
        : html`<${PracticeGlyph} class="sz-hcell__glyph" hidden=${true} char=${record.char} face=${TIE_CELL_FACE} />`}
    </span>
  </div>
  <p class="sz-hshi__line" data-testid="home-shi-first-line" data-on=${lineOn ? 'true' : 'false'}>${t('X-HOME.shiFirstLine')}</p>`;
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
  const htieClass = kind === 'recent' ? 'sz-htie sz-htie--recent' : 'sz-htie';
  if (kind === 'today' && action) {
    return html`<${Button} variant="plain" class="sz-htie sz-htie--btn" style=${style} data-testid="home-ink-row" data-count=${count}
      aria-label=${label} onClick=${() => action()}>${items}</${Button}>`;
  }
  const testid = kind === 'today' ? 'home-ink-row' : kind === 'recent' ? 'home-recent-row' : 'home-progress';
  return html`<div class=${htieClass} style=${style} role="img" aria-label=${label} data-testid=${testid}
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
