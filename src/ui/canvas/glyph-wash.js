// 帮助层的唯一画法（W1 验收：提示与描一遍同一种画法，全 App 只保留这一种）：
//   整层淡填充（所有要画的笔同色不透明填进一层 canvas，整层 TRACE_FILL_ALPHA 不透明度，交叠处不叠色）+ 外侧一圈墨三 --ink3 外廓
//   （drawGlyphRing，只画在字形外侧，不穿过笔画交叠处）。提示只画给出的那几笔（from / to），描一遍画整字。
//   颜色全走令牌：填充 --danzhu（整层 .4），外廓 --ink3（对笺面浅深、红绿色觉异常都 ≥ 3:1，不靠色相）。
// 给 hint-layer.js / answer.js 用；同文件放这两个层共用的 canvas 小工具（paintCanvas、useThemeVersion）。
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../vendor/ui.js';
import { drawGlyphRing, drawGlyphSolid, glyphColor, TRACE_FILL_ALPHA } from './glyph.js';
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
 * 整层淡填充 + 外廓。父元素须 position:relative 且与书写格参考字形层同尺寸。
 * @param {object} props
 * @param {{strokes:string[]}|null} props.data  笔画数据（没有就什么都不画）
 * @param {number} [props.from] [props.to]      只画 [from, to) 笔（缺省整字）
 * @param {number} [props.cssSize]              边长（缺省量父元素，再缺省 345）
 * @param {string} [props.fillTestid] [props.ringTestid]
 */
export function GlyphWash({ data, from, to, cssSize, fillTestid = 'write-wash-fill', ringTestid = 'write-wash-ring' }) {
  const rootRef = useRef(null);
  const fillRef = useRef(null);
  const ringRef = useRef(null);
  const theme = useThemeVersion();
  const [box, setBox] = useState(cssSize || 0);

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
    const ring = ringRef.current;
    if (!fill || !ring) return;
    const size = box || 345;
    const fctx = paintCanvas(fill, size);
    const rctx = paintCanvas(ring, size);
    if (data && Array.isArray(data.strokes)) {
      drawGlyphSolid(fctx, data, { color: glyphColor('--danzhu'), from, to });
      drawGlyphRing(rctx, data, { color: glyphColor('--ink3'), from, to });
    }
  }, [data, from, to, box, theme]);

  return html`<div class="sz-wash" ref=${rootRef} aria-hidden="true">
    <canvas ref=${fillRef} data-testid=${fillTestid} style=${{ opacity: TRACE_FILL_ALPHA }}></canvas>
    <canvas ref=${ringRef} data-testid=${ringTestid}></canvas>
  </div>`;
}
