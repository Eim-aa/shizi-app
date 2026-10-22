// 品牌字「拾」的矢量字形——品牌字的单一来源（卡 B1；D33：品牌「拾」整字一色墨，朱色只用于批改与印章）。
//
// 字形：拾字自绘的 A1 端正楷书骨架，逐笔三次贝塞尔精修（71 个锚点），不取自任何字体文件；是程序化精修的过渡母版，还不是书家实写。
// 数据与 docs/design/brand/shi-A1.svg 同源（九笔按笔顺：横 · 竖钩 · 提 · 撇 · 捺 · 横 · 竖 · 横折 · 横；1024 视框，每笔一条顺时针闭合轮廓，
// 同色非零填充叠放，没有做布尔合并）。改字形：换 docs/design/brand/ 里的母版后，把九条 d 同步到这里（test/ui/brand-shi.test.mjs 会校验两边一致）。
//
// 图标母版（assets/branding/app-icon-*.svg）用的是同一骨架的加粗墨重，由 docs/design/brand/ 的生成脚本导出；App 内用 A1 墨重。

import { html } from '../../../vendor/ui.js';
import {
  SHI_UNITS, SHI_PATHS, SHI_VIEW, SHI_CENTER, SHI_VIEWBOX,
  SHI_BOLD_PATHS, SHI_BOLD_TRANSFORM, SHI_SEAL_VIEW, SHI_BOLD_CENTER, SHI_SEAL_VIEWBOX, SHI_BOLD_TRANSFORM_ATTR,
} from '../../core/images/shi-paths.js';

// 路径 / 视框常量在 core/images/shi-paths.js（core 的导出图也要用，不得反向依赖 ui）；这里原样转出，原导入路径不变。
export {
  SHI_UNITS, SHI_PATHS, SHI_VIEW, SHI_CENTER, SHI_VIEWBOX,
  SHI_BOLD_PATHS, SHI_BOLD_TRANSFORM, SHI_SEAL_VIEW, SHI_BOLD_CENTER, SHI_SEAL_VIEWBOX, SHI_BOLD_TRANSFORM_ATTR,
};

/**
 * 品牌字「拾」的内联 SVG：填色 currentColor（颜色由调用方用 CSS 的 color 给墨色令牌，如 --hand），宽高 100% 填满外层元素；装饰性（aria-hidden），
 * 读屏名称由外层元素给。
 */
export function ShiMark({ class: cls = '' } = {}) {
  return html`<svg class=${cls} viewBox=${SHI_VIEWBOX} width="100%" height="100%" fill="currentColor" aria-hidden="true" focusable="false" data-testid="brand-shi-mark">
    ${SHI_PATHS.map((d, i) => html`<path key=${i} d=${d}></path>`)}
  </svg>`;
}

/**
 * 印文「拾」的内联 SVG（白文：填 currentColor，调用方在朱底上给 color: --on-seal），铺满外层印（印是定尺寸的方块），装饰性（aria-hidden）。
 */
export function ShiSealMark({ class: cls = '' } = {}) {
  return html`<svg class=${cls} viewBox=${SHI_SEAL_VIEWBOX} width="100%" height="100%" fill="currentColor" aria-hidden="true" focusable="false" data-testid="seal-shi-mark">
    <g transform=${SHI_BOLD_TRANSFORM_ATTR}>${SHI_BOLD_PATHS.map((d, i) => html`<path key=${i} d=${d}></path>`)}</g>
  </svg>`;
}
