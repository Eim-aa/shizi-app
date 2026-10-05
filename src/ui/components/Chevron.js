// 列表行尾的 chevron（设计系统 v1「列表行」：8 × 13 的线形箭头，--ink4；P1-E1b）。
// 纯装饰：aria-hidden，不进读屏名称；颜色取 currentColor，所在的行用 .sz-chev 给色（--ink4，不用于需要阅读的文字）。
import { Icons } from './icons.js';
import { injectStyles, T } from './styles.js';

injectStyles('chevron', `
.sz-chev{flex:none;display:block;width:8px;height:13px;color:${T.ink4}}
`);

/** 每次渲染现取新 vnode（vendor/ui.js 注释，M6-3）；线宽与别的图标一样取 icons.js 的 ICON_STROKE。 */
export function Chevron({ class: cls } = {}) {
  return Icons.chevron({ cls: cls ? `sz-chev ${cls}` : 'sz-chev', testid: 'chevron' });
}
