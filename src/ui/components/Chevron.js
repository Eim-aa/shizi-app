// 列表行尾的 chevron（设计系统 v1「列表行」：8 × 13 的线形箭头，--ink4；P1-E1b）。
// 纯装饰：aria-hidden，不进读屏名称；颜色取 currentColor，所在的行用 .sz-chev 给色（--ink4，不用于需要阅读的文字）。
import { html } from '../../../vendor/ui.js';
import { injectStyles, T } from './styles.js';

injectStyles('chevron', `
.sz-chev{flex:none;display:block;width:8px;height:13px;color:${T.ink4}}
`);

/** 每次渲染现取新 vnode（vendor/ui.js 注释，M6-3）。 */
export function Chevron({ class: cls } = {}) {
  return html`<svg class=${cls ? `sz-chev ${cls}` : 'sz-chev'} viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-testid="chevron"><path d="M1.5 1.5 6.5 6.5l-5 5"></path></svg>`;
}
