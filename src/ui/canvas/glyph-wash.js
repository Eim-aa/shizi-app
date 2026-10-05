// 帮助层的唯一画法（D53 ①，第三轮 V3-01 / T3-02：覆盖 W1 的「淡填充 + ink3 外廓」）：
//   给出的笔画用 --danzhu 不透明实填（整层一次合成，交叠处不叠色，没有整层不透明度）；描一遍里「还没轮到」的笔只画同色相 0.75pt 的双钩（不填色）。
//   没有灰外廓：对比度由淡朱自己承担（对笺 / 对本人墨都 ≥ 3:1，test/ui/contrast.test.mjs），本人墨永远是画面上最深的东西、第一焦点。
//   提示只画给出的那几笔；描一遍 = 当前一笔实心、其余笔双钩、已描过的笔被本人墨盖住不再画。颜色全走令牌（--danzhu）。
// 给 hint-layer.js / answer.js 用；同文件放这两个层共用的 canvas 小工具（paintCanvas、useThemeVersion）。
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../vendor/ui.js';
import { drawGlyphHook, drawGlyphSolid, glyphColor, HOOK_WIDTH_PT, HOOK_WIDTH_MORE_CONTRAST_PT, prefersMoreContrast } from './glyph.js';
import { injectStyles } from '../components/styles.js';

injectStyles('glyph-wash', `
.sz-wash{position:absolute;inset:0;pointer-events:none}
.sz-wash canvas{position:absolute;left:0;top:0;display:block}
`);

/** 深浅色变化计数（matchMedia 与 data-theme）；canvas 的颜色在绘制时读，变化后要重画。 */
export function useThemeVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const bump = () => setVersion(v => v + 1);
    let mq = null;
    try {
      mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    } catch (error) {
      mq = null;
    }
    if (mq && mq.addEventListener) mq.addEventListener('change', bump);
    let observer = null;
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(bump);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    return () => {
      if (mq && mq.removeEventListener) mq.removeEventListener('change', bump);
      if (observer) observer.disconnect();
    };
  }, []);
  return version;
}

/** 把 canvas 调成 cssSize 见方、按书写格内部 345 单位作画的 2d 上下文（DPR 缩放已设好，已清空）。 */
export function paintCanvas(canvas, cssSize) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const px = Math.round(cssSize * dpr);
  if (canvas.width !== px) canvas.width = px;
  if (canvas.height !== px) canvas.height = px;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = (dpr * cssSize) / 345;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  return ctx;
}

/**
 * 帮助层：实填 + 双钩画在同一张 canvas 上。父元素须 position:relative 且与书写格参考字形层同尺寸。
 * @param {object} props
 * @param {{strokes:string[]}|null} props.data  笔画数据（没有就什么都不画）
 * @param {number[]} [props.solid]              实填的笔序号列表（缺省用 from / to）
 * @param {number} [props.from] [props.to]      实填 [from, to) 笔（solid 缺省时；都缺省则整字）
 * @param {number[]} [props.hook]               只画双钩（细轮廓、不填色）的笔序号列表
 * @param {number} [props.cssSize]              边长（缺省量父元素，再缺省 345）
 * @param {string} [props.fillTestid]           画布的 data-testid
 */
export function GlyphWash({ data, solid, from, to, hook, cssSize, fillTestid = 'write-wash-fill' }) {
  const rootRef = useRef(null);
  const fillRef = useRef(null);
  const theme = useThemeVersion();
  const [box, setBox] = useState(cssSize || 0);
  const solidKey = Array.isArray(solid) ? solid.join(',') : '';
  const hookKey = Array.isArray(hook) ? hook.join(',') : '';

  // 量出边长（父元素就是书写格里的参考字形层）；尺寸变了重画
  useLayoutEffect(() => {
    if (cssSize) {
      setBox(cssSize);
      return undefined;
    }
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth || 0;
      setBox(prev => (prev === w ? prev : w));
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    return () => {
      if (ro) ro.disconnect();
    };
  }, [cssSize]);

  useLayoutEffect(() => {
    const fill = fillRef.current;
    if (!fill) return;
    const size = box || 345;
    const ctx = paintCanvas(fill, size);
    if (!(data && Array.isArray(data.strokes))) return;
    const color = glyphColor('--danzhu');
    // 双钩先画、实填后画（同一色相，实填盖住与之交叠的钩线）。线宽按 pt 换算成书写格 345 单位。
    if (Array.isArray(hook) && hook.length) {
      const pt = prefersMoreContrast() ? HOOK_WIDTH_MORE_CONTRAST_PT : HOOK_WIDTH_PT;
      drawGlyphHook(ctx, data, { color, width: (pt * 345) / size, strokes: hook });
    }
    drawGlyphSolid(ctx, data, Array.isArray(solid) ? { color, strokes: solid } : { color, from, to });
  }, [data, solidKey, hookKey, from, to, box, theme]);

  return html`<div class="sz-wash" ref=${rootRef} aria-hidden="true">
    <canvas ref=${fillRef} data-testid=${fillTestid}></canvas>
  </div>`;
}
