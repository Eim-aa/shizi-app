// 作品组件（阶段 1 P1-E7；交接 §5.2 / §7.1）：结果页上的作品、月字帖字帖、年报月段共用的格子与纸。
//
//   CellCanvas        一格里的内容：有本人墨画笔迹（线宽按格宽查补偿表），没墨画 under 衬底参考轮廓——画法就是导出图的画法
//                     （core/images/render.js paintCellContent），所以结果页上看到的作品与图片内容、样子一致（所见即所得）。
//   WorkPaper         结果页作品：笺面纸 + 作品格（格宽 c，列 × 行与 3:4 分享图相同）+ 落款与品牌印（位置规则同 layout.js）。
//   MonthPaper        月字帖：笺面纸 + 6 列（Pro Max 7、AX 4）字帖格 + 骑线日期角标 + 落款与印。
//   useScreenWidth    屏宽（CSS px）；作品格宽 / 月字帖格宽按它算。
//   frameRects        外框的矩形（满行矩形 + 末行矩形，同 layout.js 的 frame）。
//
// 本文件不含颜色字面量：笔迹 / 衬底的颜色在画的时候读 --hand / --under（深浅色变化后重画）。朱点与印章的颜色在 marks.js（朱色白名单）。
// data-testid（前缀 work-）：work（data-n / data-cols / data-rows / data-cell / data-ratio…）、work-cell（data-index / data-char / data-mode / data-dot）、
//   work-canvas、work-dot、work-seal、work-kuan、work-caps / work-cap、month-paper / month-cell / month-tag。
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../../vendor/ui.js';
import { pressFeedbackHandlers } from './Button.js';
import { injectStyles, T, TEX } from './styles.js';
import { t } from '../../config/copy/index.js';
import { paintCellContent } from '../../core/images/render.js';
import { inkBounds } from '../../core/images/glyph-layout.js';
import { INK_PAD, dotLayout } from '../../core/images/layout.js';
import { paintBrushStroke } from '../canvas/brush.js';
import { builtFromRaw, useNearViewport, useThemeVersion } from '../screens/write/compare.js';
import { isPracticable } from '../../data/deck.js';
import { useStrokeData } from '../screens/write/hint-layer.js';

injectStyles('work', `
.sz-work{display:flex;flex-direction:column;align-items:stretch;margin:0 -4px}
.sz-work__paper{position:relative;box-sizing:border-box;${TEX};padding:24px 0 20px;display:flex;flex-direction:column;align-items:center}
.sz-work__stage{position:relative}
.sz-work__grid{position:relative;display:grid}
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
.sz-work__kuan{font-family:${T.song};font-size:${T.fs13};line-height:${T.lh13};font-weight:400;color:${T.ink2};white-space:nowrap}
.sz-wseal{width:24px;height:24px;flex:none;border-radius:${T.rWork};display:grid;place-items:center;font-family:${T.kai};font-size:calc(17px * 1);line-height:1;
  transform:rotate(-2deg)} /* 印是图形：固定 seal24 / 40，字形 17 / 28px，不随 --k（Q2-10） */
.sz-wseal--big{width:40px;height:40px;font-size:calc(28px * 1)}
.sz-work__caps{display:grid;margin:6px auto 0;justify-items:center;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
.sz-work__cap{text-align:center}
.sz-work__plain{display:flex;flex-wrap:wrap;gap:0 0;justify-content:center}
.sz-work__plainitem{display:flex;flex-direction:column;align-items:center}
.sz-work__status{margin-top:6px;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};text-align:center}
.sz-work__status[data-wrong="true"]::before{content:"";display:inline-block;width:6px;height:6px;margin-right:4px;border-radius:50%;vertical-align:middle}
.sz-month{box-sizing:border-box;${TEX};display:flex;flex-direction:column;align-items:center;padding:0 0 18px}
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
.sz-mcell__tag{position:absolute;left:4px;top:-6px;z-index:1;padding:0 2px;background:${T.sheet};font-family:${T.hei};font-size:${T.fs11};line-height:${T.lh11};
  font-weight:500;color:${T.ink3};font-variant-numeric:tabular-nums;pointer-events:none}
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
export function WrongDot({ size, ink, testid = 'work-dot' }) {
  const points = useMemo(() => builtInk(ink), [ink]);
  const { cx, cy, d } = dotLayout(size, 1, points ? inkBounds(points) : null);
  return html`<span class="sz-work__dot sz-work__dot--wrong" aria-hidden="true" data-testid=${testid}
    style=${{ left: `${cx - d / 2}px`, top: `${cy - d / 2}px`, width: `${d}px`, height: `${d}px` }}></span>`;
}

/** 品牌印「字」：白文直角，24（单字 40），颜色在 marks.js。 */
export function WorkSeal({ big = false, testid = 'work-seal', style = null }) {
  return html`<span class=${big ? 'sz-wseal sz-wseal--big' : 'sz-wseal'} aria-hidden="true" data-testid=${testid} style=${style}>${t('X-IMAGES.seal')}</span>`;
}

const CELL_PRESS = pressFeedbackHandlers(() => false);

// ---------------------------------------------------------------- 结果页作品

/**
 * 作品。
 * @param {object} props
 * @param {Array<{key:string, ch:string, ink?:object|null, mode?:'hand'|'under', dot?:boolean, label:string, index?:number, record?:string, state?:string}>} props.cells
 * @param {{cols:number, rows:number, c:number}} props.grid  resultGrid() 的结果
 * @param {string} props.kuan  落款
 * @param {string[]} [props.caps]  与 cells 同长的格下标注（空串 = 无）
 * @param {(cell)=>void} [props.onOpen]
 * @param {string} [props.label]  整体的读屏名称
 * @param {boolean} [props.withSign]  画落款与印（缺省 true）
 */
export function WorkPaper({ cells, grid, kuan, caps = [], onOpen, label, withSign = true }) {
  const { cols, rows, c } = grid;
  const n = cells.length;
  const lastCol = (n - 1) % cols;
  const below = lastCol === cols - 1;
  const gw = cols * c;
  const sealBig = n === 1;
  const sealSize = sealBig ? 40 : 24;
  const frames = frameRects(n, cols, c);
  const capSlots = Array.from({ length: cols }, (_, j) => {
    for (let i = 0; i < n; i += 1) if (i % cols === j && caps[i]) return caps[i];
    return '';
  });
  const anyCap = capSlots.some(Boolean);
  const sealStyle = below ? null : {
    left: `${(lastCol + 1) * c + Math.round(c * 0.12)}px`,
    top: `${rows * c - sealSize - Math.round(c * 0.06)}px`,
  };
  return html`<section class="sz-work" data-testid="work" data-n=${n} data-cols=${cols} data-rows=${rows} data-cell=${c} role="group" aria-label=${label}>
    <div class="sz-work__paper">
      <div class="sz-work__stage" style=${{ width: `${gw}px` }}>
        <div class="sz-work__grid" data-testid="work-grid" style=${{ gridTemplateColumns: `repeat(${cols}, ${c}px)`, width: `${gw}px` }}>
          ${cells.map((cell, i) => html`<button type="button" key=${cell.key} class="sz-wcell" ...${CELL_PRESS} style=${{ width: `${c}px`, height: `${c}px` }}
            data-testid="work-cell" data-index=${cell.index == null ? i : cell.index} data-char=${cell.ch} data-mode=${cell.mode || 'hand'}
            data-dot=${cell.dot ? 'true' : 'false'} data-record=${cell.record || ''} data-state=${cell.state || ''}
            data-last-col=${(i + 1) % cols === 0 || i === n - 1 ? 'true' : 'false'} data-last-row=${i + cols >= n ? 'true' : 'false'}
            aria-label=${cell.label} onClick=${() => onOpen && onOpen(cell)}>
            <${CellCanvas} ch=${cell.ch} ink=${cell.ink} mode=${cell.mode || 'hand'} size=${c} />
            ${cell.dot ? html`<${WrongDot} size=${c} ink=${cell.ink} />` : null}
          </button>`)}
          ${frames.map((r, i) => html`<span key=${`f${i}`} class="sz-work__frame" aria-hidden="true"
            style=${{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }}></span>`)}
          ${withSign && !below ? html`<${WorkSeal} big=${sealBig} style=${{ ...sealStyle, position: 'absolute' }} />` : null}
        </div>
        ${withSign
          ? html`<div class="sz-work__sign" data-testid="work-sign" data-below=${below ? 'true' : 'false'}>
              <span class="sz-work__kuan" data-testid="work-kuan">${kuan}</span>
              ${below ? html`<${WorkSeal} big=${sealBig} style=${{ position: 'relative' }} />` : null}
            </div>`
          : null}
      </div>
    </div>
    ${anyCap
      ? html`<div class="sz-work__caps" data-testid="work-caps" style=${{ gridTemplateColumns: `repeat(${cols}, ${c}px)`, width: `${gw}px` }}>
          ${capSlots.map((text, j) => html`<span key=${j} class="sz-work__cap" data-testid=${text ? 'work-cap' : null}>${text}</span>`)}
        </div>`
      : null}
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
          <button type="button" class="sz-wcell" ...${CELL_PRESS} style=${{ width: `${c}px`, height: `${c}px`, border: `${T.frameW} solid ${T.frame}` }}
            data-testid="work-cell" data-index=${cell.index} data-char=${cell.ch} data-mode="under" data-last-col="true" data-last-row="true"
            aria-label=${cell.label} onClick=${() => onOpen && onOpen(cell)}>
            <${CellCanvas} ch=${cell.ch} mode="under" size=${c - 2} />
          </button>
          <span class="sz-work__status" data-testid="work-status" data-wrong=${cell.wrong ? 'true' : 'false'}>${cell.status}</span>
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
      <${WorkSeal} testid="month-seal" style=${{ position: 'relative' }} />
    </div>
  </section>`;
}
