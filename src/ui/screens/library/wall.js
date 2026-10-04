// 字库首页的墨墙、图例与卡片预览格（02 M3-1；R-L02 / R-L03 / R-L08；原型 字库墨墙屏-第十稿交接版.dc.html
// L61–L69 图例与墙、L283–L313 ink / hollow / wrongStd、L222–L223 墨色四档）。数据来自 model.js（纯函数）。
//
// 一格一字（GlyphCell）：
//   - hollow（自选了还没写）：标准楷体的空心轮廓（原型 hollow()：描边 --i3、纸色填充，缩 .84）。这里用楷体 DOM 文本 +
//     -webkit-text-stroke 画外轮廓，不取笔顺数据（300 字下不为墙发几十个请求，R-L09）。
//   - wrong（最近一次判断为写错，K28 / R-L08）：标准楷体 + 右上朱点，不画那一次写错的笔迹；字色按墨色档位取，写错不改字色与大小（设计系统 v1 设计说明 16）。
//   - ink：逐判断笔迹打开（P31 policy.features.perRecordInk）且这条记录有墨迹 → 画最近一次的笔迹（write/compare.js InkMini）；
//     否则按 10.12「有记录无笔迹」不拿别次笔迹补位，用标准楷体占位（任务卡 M3-1）。两者都按墨色档位取色。
// 墨色四档（设计系统 v1，P1-E1b）：四个独立色值 --wall1…--wall4（一周内 / 一月内 / 三月内 / 更久，tokens.json color.*.wall1–4），
// 取代原来的透明度四档（1 / .78 / .58 / .55）与深色「最淡一档提亮」。档位 → 颜色：字面文字直接取 color；本人笔迹 canvas 读 --hand，
// 所以档位类在格子内把 --hand 改成同一档颜色；图例的一笔短横用 fill。
// 图例说明句按主题二选一（浅色 R-L03.legend；深色「颜色越暗，越久没写。…」），两句都在 DOM 里、用与 tokens.css 同一套
// 主题选择器切换 display，跟随系统与 data-theme 强制两种都对。
//
// data-testid：library-legend、library-legend-tone（data-tone）、library-legend-wrong、library-legend-hollow、library-wall
//   （data-cols / data-shown / data-members / data-more）、library-wall-cell（data-char / data-kind / data-tone / data-ink）、
//   library-legend-note（两句各带 data-theme-variant=light|dark）、library-card-mini-cell（同 cell 的 data-*）。

import { html, useEffect, useMemo, useState } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { T } from '../../components/styles.js';
import * as defaultPolicy from '../../../config/policy.js';
import { t, tInk } from '../../../config/copy/index.js';
import { InkMini } from '../write/compare.js';
import { recordInkPoints } from '../home/ink-row.js';
import { WALL_COLS } from './model.js';

/** 墙的版式输入：large = 系统大字号（:root[data-text-large]，P131）、wide = Pro Max 级屏宽（≥ WALL_COLS.proMaxFrom）；随两者变化更新。 */
export function useWallLayout() {
  const read = () => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return { large: false, wide: false };
    let wide = false;
    try {
      wide = !!(window.matchMedia && window.matchMedia(`(min-width: ${WALL_COLS.proMaxFrom}px)`).matches);
    } catch (error) {
      wide = false;
    }
    return { large: document.documentElement.hasAttribute('data-text-large'), wide };
  };
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const sync = () => setLayout(prev => {
      const next = read();
      return prev.large === next.large && prev.wide === next.wide ? prev : next;
    });
    sync();
    let mql = null;
    try {
      mql = window.matchMedia ? window.matchMedia(`(min-width: ${WALL_COLS.proMaxFrom}px)`) : null;
    } catch (error) {
      mql = null;
    }
    if (mql && mql.addEventListener) mql.addEventListener('change', sync);
    let mo = null;
    if (typeof MutationObserver === 'function') {
      mo = new MutationObserver(sync);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-text-large'] });
    }
    return () => {
      if (mql && mql.removeEventListener) mql.removeEventListener('change', sync);
      if (mo) mo.disconnect();
    };
  }, []);
  return layout;
}

/** 墨色四档的令牌名（--wall1…--wall4）；档位 0 = 一周内 … 3 = 更久。 */
export const TONE_COLOR_VARS = Object.freeze(['--wall1', '--wall2', '--wall3', '--wall4']);
/** 档位 → CSS 颜色引用（var(--wallN)）。 */
export const toneColor = tone => `var(${TONE_COLOR_VARS[tone == null ? 3 : tone]})`;

/** 档位 → 图例 / 读屏文案键（第四档为 R-L03.toneOldest）。 */
export const TONE_KEYS = Object.freeze(['X-LIBHOME.tone0', 'X-LIBHOME.tone1', 'X-LIBHOME.tone2', 'R-L03.toneOldest']);

export const WALL_CSS = `
.sz-lib__note-dark{display:none}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]) .sz-lib__note-light{display:none}
  :root:not([data-theme="light"]) .sz-lib__note-dark{display:inline}
}
:root[data-theme="dark"] .sz-lib__note-light{display:none}
:root[data-theme="dark"] .sz-lib__note-dark{display:inline}
.sz-lib__legend{display:flex;flex-wrap:wrap;align-items:center;gap:${T.s2} ${T.s4};margin:0;padding:0;list-style:none;
  font-size:${T.fs11};line-height:${T.lh11};color:${T.ink2}}
.sz-lib__legend>li{display:inline-flex;align-items:center;gap:${T.s2};white-space:nowrap}
.sz-lib__swatch{flex:none;display:block;width:20px;height:7px;overflow:visible}
.sz-lib__swatch path{fill:${T.wall1}}
.sz-lib__box{flex:none;width:9px;height:9px;box-sizing:border-box;border-radius:${T.rWork};border:1px solid ${T.danzhu}}
.sz-lib__wall{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));container-type:inline-size}
.sz-lib__cell.sz-btn{position:relative;aspect-ratio:1/1;width:100%;min-height:0;padding:0;border-radius:${T.rWork};display:grid;
  place-items:center;overflow:hidden;background:transparent}
.sz-lib__cell.sz-btn:focus-visible{outline:2px solid ${T.ink1};outline-offset:-2px}
.sz-lib__g{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.sz-lib__char{font-family:${T.kai};line-height:1;font-size:calc(280px / var(--cols));font-size:calc(80cqw / var(--cols));
  color:${T.wall1}}
.sz-lib__g--t0{--hand:${T.wall1}}
.sz-lib__g--t1{--hand:${T.wall2}}
.sz-lib__g--t2{--hand:${T.wall3}}
.sz-lib__g--t3{--hand:${T.wall4}}
.sz-lib__g--t0 .sz-lib__char{color:${T.wall1}}
.sz-lib__g--t1 .sz-lib__char{color:${T.wall2}}
.sz-lib__g--t2 .sz-lib__char{color:${T.wall3}}
.sz-lib__g--t3 .sz-lib__char{color:${T.wall4}}
/* 自选了还没写：淡朱空心字（轮廓版双钩随 P1-E2 的字形单一来源换成由笔画轮廓生成的双钩，这里先用 text-stroke） */
.sz-lib__g--hollow .sz-lib__char{color:transparent;-webkit-text-stroke:1px ${T.danzhu};paint-order:stroke fill}
.sz-lib__mark{position:absolute;right:9%;top:9%}
.sz-lib__g .sz-compare__card{position:absolute;inset:4%;width:auto;height:auto;border:0;border-radius:0;background:transparent;padding:0}
.sz-lib__mini{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));margin:auto 0 0;padding-top:${T.s1};
  container-type:inline-size}
.sz-lib__minicell{position:relative;aspect-ratio:1/1;display:block}
`;

/** 一格的读屏说明（「{字}，{状态}」）。 */
export function cellLabel(cell) {
  let status;
  if (cell.kind === 'hollow') status = t('R-A02.filterCustomUnwritten');
  else if (cell.kind === 'wrong') status = t('R-E04.titleWrong');
  else status = t(TONE_KEYS[cell.tone == null ? 3 : cell.tone]);
  return t('X-LIBHOME.cellAria', { char: cell.char, status });
}

/** 一格的字形（墙、卡片预览共用）。 */
export function Glyph({ cell, getInk, policy = defaultPolicy }) {
  const points = useMemo(
    () => (cell.kind === 'ink' ? recordInkPoints(cell.record, getInk, policy) : null),
    [cell.kind, cell.record, getInk, policy],
  );
  const hasInk = !!(points && points.length);
  const tone = cell.kind === 'ink' || cell.kind === 'wrong' ? ` sz-lib__g--t${cell.tone == null ? 3 : cell.tone}` : '';
  return html`<span class=${`sz-lib__g sz-lib__g--${cell.kind}${tone}`} aria-hidden="true" data-ink=${hasInk ? 'ink' : 'none'}>
    ${hasInk
      ? html`<${InkMini} points=${points} testid="library-cell-ink" emptyText="" />`
      : html`<span class="sz-lib__char">${cell.char}</span>`}
    ${cell.kind === 'wrong' ? html`<span class="sz-lib__mark"></span>` : null}
  </span>`;
}

/** 图例里的一笔短横（原型 L316 swatch：一笔横，四档透明度）。 */
function Swatch({ tone }) {
  return html`<svg class="sz-lib__swatch" viewBox="0 0 40 14" aria-hidden="true" focusable="false">
    <path d="M1.5 7.6C6 5.2 13 4.6 22 4.9c6 .2 11 .5 16.2 1.3.6.1.6 1.4 0 1.6C32 9.6 22 9.3 13 9.5 8 9.6 4.4 10.2 2.2 10.4.6 10.5.3 8.3 1.5 7.6Z"
      style=${{ fill: toneColor(tone) }}></path>
  </svg>`;
}

/** 图例：四档墨色 + 写错过 + 自选了还没写（原型 L62–L66）。 */
export function Legend() {
  return html`<ul class="sz-lib__legend" data-testid="library-legend">
    ${TONE_KEYS.map((key, i) => html`<li key=${key} data-testid="library-legend-tone" data-tone=${i}><${Swatch} tone=${i} />${t(key)}</li>`)}
    <li data-testid="library-legend-wrong"><span class="sz-lib__dot" aria-hidden="true"></span>${t('R-E04.titleWrong')}</li>
    <li data-testid="library-legend-hollow"><span class="sz-lib__box" aria-hidden="true"></span>${t('R-A02.filterCustomUnwritten')}</li>
  </ul>`;
}

/** 墙下说明（R-L03；深色反向说法，边改 L14）。 */
export function LegendNote() {
  return html`<span data-testid="library-legend-note">
    <span class="sz-lib__note-light" data-theme-variant="light">${tInk('R-L03.legend')}</span>
    <span class="sz-lib__note-dark" data-theme-variant="dark">${tInk('X-LIBHOME.legendDarkNote')}</span>
  </span>`;
}

/**
 * 墙（≤ 8 行）。
 * @param {{wall:object, getInk?:Function, onOpen:(char:string)=>void}} props
 */
export function Wall({ wall, getInk, onOpen }) {
  return html`<div class="sz-lib__wall" data-testid="library-wall" role="group" aria-label=${t('X-LIBHOME.recordedLabel')}
    data-cols=${wall.cols} data-shown=${wall.cells.length} data-members=${wall.members} data-more=${wall.more}
    style=${{ '--cols': wall.cols }}>
    ${wall.cells.map(cell => html`<${Button} key=${cell.char} variant="plain" class="sz-lib__cell" data-testid="library-wall-cell"
      data-char=${cell.char} data-kind=${cell.kind} data-tone=${cell.tone == null ? '' : cell.tone} aria-label=${cellLabel(cell)}
      onClick=${() => onOpen(cell.char)}><${Glyph} cell=${cell} getInk=${getInk} /></${Button}>`)}
  </div>`;
}

/** 卡片预览：一行 4 格（原型 L67 mini；不足 4 个留空位）。 */
export function MiniRow({ cells, getInk, cols = 4 }) {
  const slots = cells.slice(0, cols);
  while (slots.length < cols) slots.push(null);
  return html`<span class="sz-lib__mini" aria-hidden="true" style=${{ '--cols': cols }}>
    ${slots.map((cell, i) => html`<span key=${i} class="sz-lib__minicell" data-testid=${cell ? 'library-card-mini-cell' : null}
      data-char=${cell ? cell.char : null} data-kind=${cell ? cell.kind : null}
      data-tone=${cell && cell.tone != null ? cell.tone : null}>${cell ? html`<${Glyph} cell=${cell} getInk=${getInk} />` : null}</span>`)}
  </span>`;
}
