// 首页的品牌「拾」零件（H2 / D55：首页改为方向 E「极静」，字帖行、最近写的字、进行中格子、「拾」交接都已删除；文件名沿用）。
//
//   BrandShi        框中的品牌「拾」——只在首次打开用（首次打开的画面不变）。字形是 ui/brand/shi.js 的矢量「拾」（拾字自绘 A1 骨架精修，不取自任何字体；
//                   整字一色墨，--hand，D33），内联 SVG、currentColor；尺寸 --cell / 框 / 读屏名称（role=img + aria-label）。
//                   TODO(资产)：书家实写的「拾」到位后只换 ui/brand/shi.js 的路径数据（06 P1-D2）。
//   firstShiSize    首次打开「拾」的格宽。
//   useElementWidth 元素内容宽的 hook（首页按它取首次打开的格宽）。
//   TIE_CELL_FACE   字帖格里衬底字的字面占格比例（tokens.json typography.glyph.tieCellFace；PracticeGlyph 的默认字面系数来源，practice-glyph.test 核对）。
//
// 日常六态的「拾」不在这里：它是没有框的墨「拾」（home/index.js 的 .sz-home__shi，128pt，--hand）。
//
// data-testid：home-brand-shi（首次打开的框中「拾」与日常态的墨「拾」同名，各自只出现在自己的态里）。

import { html, useLayoutEffect, useState } from '../../../../vendor/ui.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { ShiMark } from '../../brand/shi.js';

/** 字帖格里衬底字的字面占格比例（tokens.json typography.glyph.tieCellFace）。 */
export const TIE_CELL_FACE = 0.76;

/** 首次打开的「拾」：iPhone 17 约 200、SE 3 172、Pro Max 216；按屏宽取、夹在 [172, 216]。 */
export function firstShiSize(width) {
  return Math.max(172, Math.min(216, Math.round(width * 0.5)));
}

injectStyles('home-copybook', `
.sz-hshi{position:relative;display:grid;place-items:center;box-sizing:border-box;width:var(--cell);height:var(--cell);${TEX};
  box-shadow:inset 0 0 0 ${T.frameW} ${T.frame};container-type:inline-size}
.sz-hshi__glyph{position:absolute;left:0;top:0;width:100%;height:100%;color:${T.hand}} /* 品牌「拾」是矢量图：墨框长边占格 62%，光学居中（ui/brand/shi.js） */
`);

/** 首次打开的框中品牌「拾」。 */
export function BrandShi({ size }) {
  return html`<div class="sz-hshi" style=${{ '--cell': `${size}px` }} role="img" aria-label=${t('X-HOME.shiLabel')} data-testid="home-brand-shi">
    <${ShiMark} class="sz-hshi__glyph" />
  </div>`;
}

/** 元素的内容宽（clientWidth，px），随 resize 更新；挂载前给 fallback。首次打开的格宽按它算。 */
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
