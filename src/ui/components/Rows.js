// 「名称 …… 值 ›」行与块（D60 字库首页行模板；D63「我的」页用同一套，数值与 library/index.js 的 sz-libr__row 一致）。
// 字号层级：名称 17 / 500 墨一 · 值 17 墨二 · 数 15 墨三 · 小字 13 墨三。块 = 顶一条发丝线、块内每行底下一条；块与块之间 26。
// 整行一个 <button>（Button plain：按压反馈、防连点）；AX（:root[data-ax]）：名称与值上下排、箭头靠右居中。
// 读屏（M6-1）：按钮的名字只读名称（aria-label），右边的值作为描述（aria-describedby）读在名字之后；箭头是装饰。
import { html } from '../../../vendor/ui.js';
import { Button } from './Button.js';
import { Chevron } from './Chevron.js';
import { injectStyles, T } from './styles.js';

injectStyles('rows', `
.sz-rblk{flex:none;margin-top:26px;border-top:${T.hair} solid ${T.line}}
.sz-rblk--first{margin-top:0}
.sz-rrow{box-sizing:border-box;width:100%;min-height:56px;display:flex;align-items:center;gap:${T.s2};position:relative;
  border-bottom:${T.hair} solid ${T.line};text-align:left;color:${T.ink1}}
.sz-rrow__nm{font-size:${T.fs17};line-height:${T.lh17s};font-weight:500;color:${T.ink1}}
.sz-rrow__sp{flex:1;min-width:0}
.sz-rrow__val{min-width:0;font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink2};font-variant-numeric:tabular-nums;text-align:right}
:root[data-ax] .sz-rblk{margin-top:10px}
:root[data-ax] .sz-rblk--first{margin-top:0}
:root[data-ax] .sz-rrow{flex-wrap:wrap;min-height:56px;padding:${T.s2} 30px ${T.s2} 0;column-gap:${T.s3};row-gap:0}
:root[data-ax] .sz-rrow .sz-chev{position:absolute;right:0;top:50%;margin-top:-6.5px}
:root[data-ax] .sz-rrow__sp{display:none}
:root[data-ax] .sz-rrow__val{flex:1 0 100%;text-align:left;font-size:${T.fs15};line-height:${T.lh15}}
`);

/** 一块：顶一条发丝线，里面是若干行（或别的行内容）。first = 紧贴上面的内容，不留块间距。 */
export function RowBlock({ children, first = false, testid }) {
  return html`<div class=${first ? 'sz-rblk sz-rblk--first' : 'sz-rblk'} data-testid=${testid}>${children}</div>`;
}

/** 一行：名称 …… 值 ›。整行一次点击。 */
export function Row({ testid, name, nameTestid, value = null, valueTestid, onClick, extra = {} }) {
  const valueId = `sz-${testid}-value`;
  return html`<${Button} variant="plain" class="sz-rrow" data-testid=${testid} onClick=${onClick} aria-label=${name}
    aria-describedby=${value === null ? undefined : valueId} ...${extra}>
    <span class="sz-rrow__nm" data-testid=${nameTestid}>${name}</span>
    <span class="sz-rrow__sp"></span>
    ${value === null ? null : html`<span class="sz-rrow__val" id=${valueId} data-testid=${valueTestid}>${value}</span>`}
    <${Chevron} />
  </${Button}>`;
}

/** 一行里放别的控件（例如外观的三段）：同一个行高与行线，名称同一级。 */
export function RowShell({ testid, name, nameTestid, children, cls = '' }) {
  return html`<div class=${`sz-rrow sz-rrow--shell ${cls}`.trim()} data-testid=${testid}>
    <span class="sz-rrow__nm" data-testid=${nameTestid}>${name}</span>
    <span class="sz-rrow__sp"></span>
    ${children}
  </div>`;
}
