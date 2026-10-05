// 「拾」交接里本人墨的那一层（C3-H / N3-01、I3-06、T3-07；D53 ④）：本人写的「拾」按笔顺逐笔写出。
//
//   inkTimeSpan(strokes)         管线点列（每笔 [{x, y, w, t}]）里最早 / 最晚的 t；缺 t 或没有跨度返回 null（没有时间数据，调用方整字淡入）。
//   strokesUpTo(strokes, cutoff) 到时刻 cutoff 为止每笔已写出的前缀（至少两个点才画）；cutoff 之后的点不画。
//   HandoffInk                   一块 canvas：phase = hold / gray 时是空的；write 时按 ink 的时间回放（WRITE_MS 内，rAF 逐帧重画前缀）；fade / done 时是整字。
//                                没有时间数据时 write 阶段直接画整字，外层（.sz-hshi__mine--fade）做整字淡入。
//
// 只画墨，不碰品牌层：品牌层的退灰 / 退场由 copybook.js 的 ShiHandoff 用 CSS 过渡完成。任何时刻屏上只有「一层灰、一层墨」，不会有两层同时半透明。

import { html, useLayoutEffect, useMemo, useRef, useState } from '../../../../vendor/ui.js';
import { GRID } from '../../../core/ink-math.js';
import { glyphColor } from '../../canvas/glyph.js';
import { minInkScale } from '../../../core/images/layout.js';
import { paintMini, useThemeVersion } from '../write/compare.js';
import { HANDOFF_WRITE_MS } from './handoff.js';

/** 点列里最早 / 最晚的时间（ms）；任一点缺 t 或没有跨度（≤ 0）返回 null。 */
export function inkTimeSpan(strokes) {
  let from = Infinity;
  let to = -Infinity;
  let any = false;
  for (const stroke of strokes || []) {
    if (!Array.isArray(stroke)) continue;
    for (const p of stroke) {
      if (!p || !Number.isFinite(p.t)) return null;
      any = true;
      if (p.t < from) from = p.t;
      if (p.t > to) to = p.t;
    }
  }
  return any && to > from ? { from, to } : null;
}

/** 到 cutoff（含）为止每笔已写出的点；不足两个点的笔不画；后面的笔一个点都没有就不出现。 */
export function strokesUpTo(strokes, cutoff) {
  const out = [];
  for (const stroke of strokes || []) {
    if (!Array.isArray(stroke) || !stroke.length) continue;
    const part = stroke.filter(p => p.t <= cutoff);
    if (part.length >= 2) out.push(part);
  }
  return out;
}

function useBoxSize(ref) {
  const [size, setSize] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => {
      const w = el.clientWidth;
      if (w > 0) setSize(prev => (Math.abs(prev - w) > 0.5 ? w : prev));
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
  return size;
}

function prepare(canvas, cssSize) {
  const dpr = Math.max(1, Math.min(4, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const px = Math.max(1, Math.round(cssSize * dpr));
  if (canvas.width !== px) canvas.width = px;
  if (canvas.height !== px) canvas.height = px;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = px / GRID;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  return ctx;
}

/**
 * @param {{points:Array, phase:'hold'|'gray'|'write'|'fade'|'done', testid?:string}} props
 *   points：管线点列（recordInkPoints 的结果，带 t）
 */
export function HandoffInk({ points, phase, testid = 'home-ink-mine' }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const size = useBoxSize(boxRef);
  const theme = useThemeVersion();
  const span = useMemo(() => inkTimeSpan(points), [points]);
  const replaying = phase === 'write' && !!span;
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !(size > 0)) return undefined;
    const widthScale = minInkScale(size);
    const color = glyphColor('--hand', undefined, boxRef.current);
    const draw = strokes => {
      const ctx = prepare(canvas, size);
      paintMini(ctx, strokes, { color, widthScale });
    };
    if (phase === 'hold' || phase === 'gray') {
      draw([]);
      canvas.dataset.progress = '0';
      return undefined;
    }
    if (!replaying) {
      draw(points);
      canvas.dataset.progress = '1';
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const frame = () => {
      const f = Math.min(1, (performance.now() - start) / HANDOFF_WRITE_MS);
      draw(f >= 1 ? points : strokesUpTo(points, span.from + f * (span.to - span.from)));
      canvas.dataset.progress = String(Math.round(f * 100) / 100);
      if (f < 1) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [size, theme, phase, points, span]);
  return html`<span class="sz-hshi__ink" ref=${boxRef} data-testid=${testid} data-replay=${span ? 'timed' : 'static'}>
    <canvas ref=${canvasRef} aria-hidden="true"></canvas>
  </span>`;
}
