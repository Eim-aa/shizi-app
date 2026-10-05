// 作品组件（阶段 1 P1-E7；交接 §5.2 / §7.1；E9c 起结果页作品没有底板，D49）：结果页上的作品、月字帖字帖、年报月段共用的格子与纸。
//
//   CellCanvas        一格里的内容：有本人墨画笔迹（线宽按格宽查补偿表），没墨画 under 衬底参考轮廓——画法就是导出图的画法
//                     （core/images/render.js paintCellContent），所以结果页上看到的作品与图片内容、样子一致（所见即所得）。
//   WorkPaper         结果页作品：作品格（格宽 c，列 × 行与 3:4 分享图相同；格自己是笺面，直接放在页面纸上，没有作品底板，D49）+ 落款与印
//                     （位置规则同 layout.js；落款与印是图形，固定尺寸，不随系统字号放大；印是 marks.js 的 <Seal/>，只有一种）。
//   MonthPaper        月字帖：笺面纸 + 6 列（Pro Max 7、AX 4）字帖格 + 格内左上角的日期角标（不压格线）+ 落款与印。
//   useScreenWidth    屏宽（CSS px）；作品格宽 / 月字帖格宽按它算。
//   frameRects        外框的矩形（满行矩形 + 末行矩形，同 layout.js 的 frame）。
//
// 本文件不含颜色字面量：笔迹 / 衬底的颜色在画的时候读 --hand / --under（深浅色变化后重画）。朱点与印章的颜色在 marks.js（朱色白名单）。
// data-testid（前缀 work-）：work（data-n / data-cols / data-rows / data-cell / data-ratio…）、work-cell（data-index / data-char / data-mode / data-dot）、
//   work-canvas、work-dot、work-seal、work-kuan、work-caps / work-cap、month-paper / month-cell / month-tag。
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../../vendor/ui.js';
import { pressFeedbackHandlers } from './Button.js';
import { injectStyles, T, TEX } from './styles.js';
import { SEAL_PT, Seal } from './marks.js';
import { t } from '../../config/copy/index.js';
import { paintCellContent } from '../../core/images/render.js';
import { inkBounds } from '../../core/images/glyph-layout.js';
import { INK_PAD, dotLayout } from '../../core/images/layout.js';
import { paintBrushStroke } from '../canvas/brush.js';
import { builtFromRaw, useNearViewport, useThemeVersion } from '../screens/write/compare.js';
import { isPracticable } from '../../data/deck.js';
import { useStrokeData } from '../screens/write/hint-layer.js';

/** 月字帖格的日期角标：格内左上角的页边批注，没有底色块、不压格线（V2-09）。 */
export const MONTH_PAPER_TAG_CSS = `.sz-mcell__tag{position:absolute;left:4px;top:3px;z-index:1;font-family:${T.hei};font-size:${T.fs11};line-height:${T.lh11};
  font-weight:500;color:${T.ink3};font-variant-numeric:tabular-nums;pointer-events:none}`;

injectStyles('work', `
.sz-work{display:flex;flex-direction:column;align-items:stretch}
.sz-work__paper{position:relative;box-sizing:border-box;display:flex;flex-direction:column;align-items:center}
.sz-work__stage{position:relative}
.sz-work__grid{position:relative;display:grid}
.sz-work__sheet{position:absolute;box-sizing:border-box;pointer-events:none;${TEX}}
.sz-work__frame{position:absolute;box-sizing:border-box;border:${T.frameW} solid ${T.frame};pointer-events:none}
.sz-wcell{position:relative;display:block;box-sizing:border-box;margin:0;padding:0;border:0;border-radius:${T.rWork};background:transparent;
  color:inherit;font:inherit;cursor:pointer;overflow:visible;-webkit-tap-highlight-color:transparent}
.sz-wcell::after{content:"";position:absolute;right:0;bottom:0;width:${T.guideW};height:100%;background:${T.guide};pointer-events:none}
.sz-wcell::before{content:"";position:absolute;left:0;bottom:0;width:100%;height:${T.guideW};background:${T.guide};pointer-events:none}
.sz-wcell[data-last-col="true"]::after{display:none}
.sz-wcell[data-last-row="true"]::before{display:none}
.sz-wcell:focus-visible{outline:2px solid ${T.ink1};outline-offset:-2px}
.sz-wcell[data-pressed]{background:${T.field}}
.sz-wcell canvas{display:block;position:absolute;left:0;top:0}
.sz-work__dot{position:absolute;border-radius:50%;pointer-events:none}
.sz-work__sign{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px}
.sz-work__kuan{font-family:${T.song};font-size:calc(13px * 1);line-height:20px;font-weight:400;color:${T.ink2};white-space:nowrap} /* 落款是图形：宋 13 / 20 固定，不读 --k（D49，作品内文字不随字号放大） */
.sz-work__cap{position:absolute;left:0;right:0;bottom:4px;z-index:1;text-align:center;white-space:nowrap;pointer-events:none;font-family:${T.hei};
  font-size:calc(11px * 1);line-height:16px;font-weight:500;color:${T.ink3}} /* 格内底边的小注（「看后写的」，T2-08 / V3-05）：与角标同字阶 11，是作品内的图形文字，不随字号放大 */
.sz-work__plain{display:flex;flex-wrap:wrap;gap:0 0;justify-content:center}
.sz-work__plainitem{display:flex;flex-direction:column;align-items:center}
.sz-work__plaincell{box-sizing:border-box;padding:1px;${TEX};box-shadow:inset 0 0 0 ${T.frameW} ${T.frame}}
.sz-work__status{margin-top:6px;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-align:center}
.sz-work__status[data-wrong="true"]::before{content:"";display:inline-block;width:6px;height:6px;margin-right:4px;border-radius:50%;vertical-align:middle}
.sz-month{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;align-self:center;padding:0} /* 笺底只铺在格框里面（.sz-work__sheet，同作品）；落款在框外页面纸上（V3-05 / V3-08：不再两侧多出 5pt、下方多出 18px 笺底） */
.sz-month__grid{position:relative;display:grid}
.sz-mcell{position:relative;display:block;box-sizing:border-box;margin:0;padding:0;border:0;border-radius:${T.rWork};background:transparent;color:inherit;
  font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.sz-mcell::after{content:"";position:absolute;right:0;top:0;width:${T.guideW};height:100%;background:${T.guide};pointer-events:none}
.sz-mcell::before{content:"";position:absolute;left:0;bottom:0;width:100%;height:${T.guideW};background:${T.guide};pointer-events:none}
.sz-mcell[data-last-col="true"]::after{display:none}
.sz-mcell[data-last-row="true"]::before{display:none}
.sz-mcell:focus-visible{outline:2px solid ${T.ink1};outline-offset:-2px;z-index:2}
.sz-mcell[data-pressed]{background:${T.field}}
.sz-mcell canvas{display:block;position:absolute;left:0;top:0}
${MONTH_PAPER_TAG_CSS}
:root[data-ax] .sz-mcell__tag{display:none} /* AX 档不画格内日期角标（AX5 下 40px 的数字压在笔迹上，A2-03）；日期在格的读屏名称里（monthModel cellLabel） */
.sz-month__sign{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px}
`);

// ---------------------------------------------------------------- hooks

/** 屏宽（CSS px）；窗口尺寸变化时更新。 */
export function useScreenWidth() {
  const read = () => (typeof document !== 'undefined' && document.documentElement ? document.documentElement.clientWidth : 402);
  const [w, setW] = useState(read);
  useEffect(() => {
    const onResize = () => setW(read());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

/** 系统字号是 AX 档（<html data-ax>，platform/text-size.js）。 */
export function useAxSize() {
  const read = () => typeof document !== 'undefined' && !!document.documentElement && document.documentElement.hasAttribute('data-ax');
  const [ax, setAx] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver !== 'function') return undefined;
    const observer = new MutationObserver(() => setAx(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ax'] });
    setAx(read());
    return () => observer.disconnect();
  }, []);
  return ax;
}

// ---------------------------------------------------------------- 纯函数

/** 外框矩形（单位同 c；相对网格左上）：满行矩形 + 末行矩形（末行不满、且末字不在最右列时是两段）。 */
export function frameRects(n, cols, c) {
  if (!(n >= 1) || !(cols >= 1)) return [];
  const rows = Math.ceil(n / cols);
  const lastCols = n % cols === 0 ? cols : n % cols;
  if (rows === 1) return [{ x: 0, y: 0, w: n * c, h: c }];
  if (lastCols === cols) return [{ x: 0, y: 0, w: cols * c, h: rows * c }];
  return [{ x: 0, y: 0, w: cols * c, h: (rows - 1) * c }, { x: 0, y: (rows - 1) * c, w: lastCols * c, h: c }];
}

/** 本人墨：{points, strokes}（detail/records.js inkOf 的形状）→ 管线点列 | null。 */
export function builtInk(ink) {
  if (!ink) return null;
  const built = Array.isArray(ink.points) && ink.points.length ? ink.points : Array.isArray(ink.strokes) && ink.strokes.length ? builtFromRaw(ink.strokes) : null;
  return built && built.some(s => Array.isArray(s) && s.length) ? built : null;
}

// ---------------------------------------------------------------- 一格

function cssVar(el, name) {
  try {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || 'currentColor';
  } catch (error) {
    return 'currentColor';
  }
}

/**
 * 一格里的内容（canvas，边长 size px）。mode 'hand' 画 ink，'under'（或 hand 但没墨）画参考轮廓。
 * @param {{ch:string, ink?:{points?:Array, strokes?:Array}|null, mode?:'hand'|'under', size:number, testid?:string}} props
 */
export function CellCanvas({ ch, ink = null, mode = 'hand', size, pad = INK_PAD, testid = 'work-canvas' }) {
  const ref = useRef(null);
  const theme = useThemeVersion();
  // M6-3（61-perf）：一屏几十到三百格的字帖只画视口附近的格子（同 InkMini）
  const near = useNearViewport(ref);
  const points = useMemo(() => builtInk(ink), [ink]);
  const under = mode === 'under' || !points;
  // 题库外的字（迁移来的旧记录等）没有笔顺数据文件：不去取（免得 404），直接退回楷体整字（render.js paintFallbackGlyph）
  const strokeData = useStrokeData(near && under && isPracticable(`base:${ch}`) ? ch : '');
  const data = strokeData && strokeData.status === 'ready' ? strokeData.data : null;
  // 练习字统一用轮廓（P1-E2）：数据还在路上时衬底格留空，不先画一遍楷体再换（不闪 ShiziKai）
  const waiting = near && under && !data && !!strokeData && strokeData.status === 'loading';
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !(size > 0) || !near) return;
    const dpr = Math.max(1, Math.min(4, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    const px = Math.max(1, Math.round(size * dpr));
    if (canvas.width !== px) canvas.width = px;
    if (canvas.height !== px) canvas.height = px;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (waiting) {
      canvas.dataset.glyph = 'loading';
      return;
    }
    const palette = { hand: cssVar(canvas, '--hand'), under: cssVar(canvas, '--under') };
    const res = paintCellContent(ctx, { ch, ink: under ? null : points, mode: under ? 'under' : 'hand' }, { x: 0, y: 0, c: size },
      { palette, unit: 1, paintStroke: paintBrushStroke, glyphs: new Map([[ch, data]]), pad });
    canvas.dataset.painted = 'true';
    canvas.dataset.strokes = String(res.strokes);
    canvas.dataset.glyph = res.glyph || 'ink'; // outline = 轮廓衬底；fallback = 楷体回退；ink = 本人笔迹
  }, [size, theme, points, under, data, ch, pad, near, waiting]);
  return html`<canvas ref=${ref} aria-hidden="true" data-testid=${testid} data-mode=${under ? 'under' : 'hand'}
    style=${{ width: `${size}px`, height: `${size}px` }}></canvas>`;
}

/** 朱点：写错且手动放进来的字，墨迹外框右上外 2pt（直径 clamp(5, 格宽 × 0.07, 8)）。 */
export function WrongDot({ size, ink, testid = 'work-dot', pad = INK_PAD }) {
  const points = useMemo(() => builtInk(ink), [ink]);
  const { cx, cy, d } = dotLayout(size, 1, points ? inkBounds(points) : null, pad);
  return html`<span class="sz-work__dot sz-work__dot--wrong" aria-hidden="true" data-testid=${testid}
    style=${{ left: `${cx - d / 2}px`, top: `${cy - d / 2}px`, width: `${d}px`, height: `${d}px` }}></span>`;
}

const CELL_PRESS = pressFeedbackHandlers(() => false);

// ---------------------------------------------------------------- 结果页作品

/**
 * 作品。
 * @param {object} props
 * @param {Array<{key:string, ch:string, ink?:object|null, mode?:'hand'|'under', dot?:boolean, label:string, index?:number, record?:string, state?:string}>} props.cells
 * @param {{cols:number, rows:number, c:number}} props.grid  resultGrid() 的结果
 * @param {string} props.kuan  落款
 * @param {string[]} [props.caps]  与 cells 同长的格内底边小注（空串 = 无）；落款永远是作品的最后一行，下面不再放任何东西
 * @param {(cell)=>void} [props.onOpen]
 * @param {string} [props.label]  整体的读屏名称
 * @param {boolean} [props.withSign]  画落款与印（缺省 true）
 * @param {{plan:{stagger:number, kuanDelay:number, sealDelay:number}, onLand:()=>void, onStart?:(event)=>void}|null} [props.reveal]
 *   作品显现与落印（D51 ②，result/work.js revealPlan）：格依次淡入、落款淡入、印落下；null = 直接是终态。动画样式在 result/work.js。
 */
export function WorkPaper({ cells, grid, kuan, caps = [], onOpen, label, withSign = true, reveal = null }) {
  const { cols, rows, c } = grid;
  const n = cells.length;
  const lastCol = (n - 1) % cols;
  const below = lastCol === cols - 1;
  const gw = cols * c;
  const sealSize = SEAL_PT; // 印只有一种：24pt，与字数无关（V2-05 / T2-22）
  const frames = frameRects(n, cols, c);
  const sealStyle = below ? null : {
    left: `${(lastCol + 1) * c + Math.round(c * 0.12)}px`,
    top: `${rows * c - sealSize - Math.round(c * 0.06)}px`,
  };
  const plan = reveal ? reveal.plan : null;
  const sealProps = plan ? { cls: 'sz-seal--land', onLand: reveal.onLand, onStart: reveal.onStart } : {};
  const sealDelay = plan ? { animationDelay: `${plan.sealDelay}ms` } : null;
  return html`<section class="sz-work" data-testid="work" data-n=${n} data-cols=${cols} data-rows=${rows} data-cell=${c} role="group" aria-label=${label}>
    <div class="sz-work__paper">
      <div class="sz-work__stage" style=${{ width: `${gw}px` }}>
        <div class="sz-work__grid" data-testid="work-grid" style=${{ gridTemplateColumns: `repeat(${cols}, ${c}px)`, width: `${gw}px` }}>
          ${frames.map((r, i) => html`<span key=${`s${i}`} class="sz-work__sheet" aria-hidden="true" data-testid="work-sheet"
            style=${{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }}></span>`)}
          ${cells.map((cell, i) => html`<button type="button" key=${cell.key} class=${plan ? 'sz-wcell sz-wcell--in' : 'sz-wcell'} ...${CELL_PRESS}
            style=${plan ? { width: `${c}px`, height: `${c}px`, animationDelay: `${i * plan.stagger}ms` } : { width: `${c}px`, height: `${c}px` }}
            data-testid="work-cell" data-index=${cell.index == null ? i : cell.index} data-char=${cell.ch} data-mode=${cell.mode || 'hand'}
            data-dot=${cell.dot ? 'true' : 'false'} data-record=${cell.record || ''} data-state=${cell.state || ''}
            data-last-col=${(i + 1) % cols === 0 || i === n - 1 ? 'true' : 'false'} data-last-row=${i + cols >= n ? 'true' : 'false'}
            aria-label=${cell.label} onClick=${() => onOpen && onOpen(cell)}>
            <${CellCanvas} ch=${cell.ch} ink=${cell.ink} mode=${cell.mode || 'hand'} size=${c} />
            ${cell.dot ? html`<${WrongDot} size=${c} ink=${cell.ink} />` : null}
            ${caps[i] ? html`<span class="sz-work__cap" aria-hidden="true" data-testid="work-cap">${caps[i]}</span>` : null}
          </button>`)}
          ${frames.map((r, i) => html`<span key=${`f${i}`} class="sz-work__frame" aria-hidden="true"
            style=${{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }}></span>`)}
          ${withSign && !below ? html`<${Seal} style=${{ ...sealStyle, ...sealDelay, position: 'absolute' }} ...${sealProps} />` : null}
        </div>
        ${withSign
          ? html`<div class="sz-work__sign" data-testid="work-sign" data-below=${below ? 'true' : 'false'}>
              <span class=${plan ? 'sz-work__kuan sz-work__kuan--in' : 'sz-work__kuan'} data-testid="work-kuan"
                style=${plan ? { animationDelay: `${plan.kuanDelay}ms` } : null}>${kuan}</span>
              ${below ? html`<${Seal} style=${{ position: 'relative', ...sealDelay }} ...${sealProps} />` : null}
            </div>`
          : null}
      </div>
    </div>
  </section>`;
}

/**
 * 没有任何墨的变体（§4.2）：衬底参考字排一行（格宽同作品），格下状态字。
 * @param {{cells:Array<{key,ch,label,status,wrong?:boolean}>, grid:{c:number}, onOpen?:Function, label?:string}} props
 */
export function PlainRow({ cells, grid, onOpen, label }) {
  const { c } = grid;
  return html`<section class="sz-work" data-testid="work" data-n=${cells.length} data-variant="plain" data-cell=${c} role="group" aria-label=${label}>
    <div class="sz-work__paper">
      <div class="sz-work__plain">
        ${cells.map(cell => html`<div key=${cell.key} class="sz-work__plainitem">
          <div class="sz-work__plaincell" style=${{ width: `${c}px`, height: `${c}px` }}>
            <button type="button" class="sz-wcell" ...${CELL_PRESS} style=${{ width: `${c - 2}px`, height: `${c - 2}px` }}
              data-testid="work-cell" data-index=${cell.index} data-char=${cell.ch} data-mode="under" data-last-col="true" data-last-row="true"
              aria-label=${cell.label} onClick=${() => onOpen && onOpen(cell)}>
              <${CellCanvas} ch=${cell.ch} mode="under" size=${c - 2} />
            </button>
          </div>
          ${cell.status ? html`<span class="sz-work__status" data-testid="work-status" data-wrong=${cell.wrong ? 'true' : 'false'}>${cell.status}</span>` : null}
        </div>`)}
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- 月字帖

/**
 * 月字帖的纸与格。
 * @param {object} props
 * @param {Array<{key:string, ch:string, ink?:object|null, mode?:'hand'|'under', tag?:string, label:string, day?:string, record?:string}>} props.cells
 * @param {number} props.cols
 * @param {number} props.c  格宽（px）
 * @param {string} props.kuan
 * @param {(cell)=>void} [props.onOpen]
 * @param {string} [props.testid]
 */
export function MonthPaper({ cells, cols, c, kuan, onOpen, label, testid = 'month-paper', cellTestid = 'month-cell' }) {
  const n = cells.length;
  const gw = cols * c;
  const frames = frameRects(n, cols, c);
  return html`<section class="sz-month" data-testid=${testid} data-n=${n} data-cols=${cols} data-cell=${c} role="group" aria-label=${label}>
    <div class="sz-month__grid" style=${{ gridTemplateColumns: `repeat(${cols}, ${c}px)`, width: `${gw}px` }}>
      ${frames.map((r, i) => html`<span key=${`s${i}`} class="sz-work__sheet" aria-hidden="true" data-testid="month-sheet"
        style=${{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }}></span>`)}
      ${cells.map((cell, i) => html`<button type="button" key=${cell.key} class="sz-mcell" ...${CELL_PRESS} style=${{ width: `${c}px`, height: `${c}px` }}
        data-testid=${cellTestid} data-char=${cell.ch} data-mode=${cell.mode || 'hand'} data-day=${cell.day || ''} data-tag=${cell.tag || ''}
        data-record=${cell.record || ''} data-ink=${cell.mode === 'under' ? 'false' : 'true'}
        data-last-col=${(i + 1) % cols === 0 || i === n - 1 ? 'true' : 'false'} data-last-row=${i + cols >= n ? 'true' : 'false'}
        aria-label=${cell.label} onClick=${() => onOpen && onOpen(cell)}>
        <${CellCanvas} ch=${cell.ch} ink=${cell.ink} mode=${cell.mode || 'hand'} size=${c} testid=${`${cellTestid}-canvas`} />
        ${cell.tag ? html`<span class="sz-mcell__tag" aria-hidden="true" data-testid="month-tag">${cell.tag}</span>` : null}
      </button>`)}
      ${frames.map((r, i) => html`<span key=${`f${i}`} class="sz-work__frame" aria-hidden="true"
        style=${{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }}></span>`)}
    </div>
    <div class="sz-month__sign" style=${{ width: `${gw}px` }}>
      <span class="sz-work__kuan" data-testid="month-kuan">${kuan}</span>
      <${Seal} testid="month-seal" style=${{ position: 'relative' }} />
    </div>
  </section>`;
}
