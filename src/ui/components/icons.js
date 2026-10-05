// 图标（第三轮 C3-R，T2-20 / T3-13 / 第三轮「最后一批规格」）：全 App 页面里画的线形图标都从这里取，不再每个页面内联一份 SVG。
//
// 规格：线宽只有一个值 ICON_STROKE = 1.5（视口单位，与 viewBox 同比例；写字页的十字参考线 0.75 虚线是格子的第二档线，不是图标），圆端圆角，
// 线形、不填色、颜色取 currentColor（需要别的颜色的地方传 color）。每个图标自己的 viewBox 保持原来的栅格（返回箭头 22、关闭 20、分享 22、查找 22、
// 勾 14 / 22、翻页 18、chevron 8 × 13），视觉尺寸由 size 给；阶段 3 原生外壳整体换 SF Symbols 时只改这一个文件。
// 底部 Tab 栏的图标另有 24 栅格的线描 / 实心一对（tab-icons.js），线宽同样取 ICON_STROKE。
//
// 每次调用现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
// scripts/verify_tokens.mjs 不管这个；test/ui/icons.test.mjs 扫描全仓：stroke-width 只许 1.5（逐条登记的例外除外）。
import { html } from '../../../vendor/ui.js';

export const ICON_STROKE = 1.5;

/** 线形图标的公共外壳。@param {{box:number|string, size?:number, color?:string, cls?:string, testid?:string}} o */
function frame({ box, size = 0, color = '', cls = '', testid = '' }, body) {
  const viewBox = typeof box === 'number' ? `0 0 ${box} ${box}` : box;
  const attrs = {
    viewBox, fill: 'none', stroke: color || 'currentColor', 'stroke-width': ICON_STROKE, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
  };
  if (size) {
    attrs.width = size;
    attrs.height = size;
  }
  if (cls) attrs.class = cls;
  if (testid) attrs['data-testid'] = testid;
  return html`<svg ...${attrs}>${body}</svg>`;
}

export const Icons = {
  /** 页头返回箭头（22 栅格，视觉 22）。 */
  back: (o = {}) => frame({ box: 22, size: 22, ...o }, html`<path d="M13.5 5 7.5 11l6 6"></path>`),
  /** 页头关闭 ×（20 栅格，视觉 20；横幅里的小号传 size 18）。 */
  close: (o = {}) => frame({ box: 20, size: 20, ...o }, html`<path d="M5 5l10 10M15 5 5 15"></path>`),
  /** 分享（22 栅格，视觉 22）。 */
  share: (o = {}) => frame({ box: 22, size: 22, ...o }, html`<path d="M11 14V3.5M7.2 7 11 3.2 14.8 7M6 10H5v8h12v-8h-1"></path>`),
  /** 查找（22 栅格，视觉默认 18）。 */
  search: (o = {}) => frame({ box: 22, size: 18, ...o }, html`<circle cx="10" cy="10" r="6"></circle><path d="m14.5 14.5 4 4"></path>`),
  /** 勾（14 栅格，字库清单 / 查字行的选中圆里用，颜色传 var(--paper)）。 */
  check: (o = {}) => frame({ box: 14, size: 14, ...o }, html`<path d="m3 7.2 2.6 2.6L11 4.4"></path>`),
  /** 设置里的选中勾（22 栅格，尺寸由样式给）。 */
  checkLarge: (o = {}) => frame({ box: 22, ...o }, html`<path d="M5 11.5 9.2 15.5 17 7"></path>`),
  /** 日历翻页（18 栅格，视觉 18）。 */
  prev: (o = {}) => frame({ box: 18, size: 18, ...o }, html`<path d="M11 4 6 9l5 5"></path>`),
  next: (o = {}) => frame({ box: 18, size: 18, ...o }, html`<path d="m7 4 5 5-5 5"></path>`),
  /** 列表行尾的 chevron（8 × 13，纯装饰）。 */
  chevron: (o = {}) => frame({ box: '0 0 8 13', ...o }, html`<path d="M1.5 1.5 6.5 6.5l-5 5"></path>`),
};
