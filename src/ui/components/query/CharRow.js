// 查字弹层的逐字行（R-Q04 行尾记录情况；P43「自选的字 · …」过渡字样；原型 字库墨墙屏 L154、L433–L435）。
//
// 一行 = [pick 模式的勾选圈] + 字 / 拼音 / 词语 + 行尾记录情况 + ›。点行（字那一块）看卡片；pick 模式点圆圈选字。
// 勾选圈是 <button role="checkbox" aria-checked>（所有可点控件都是 button，01 §7）；不能练的字没有勾选圈、字发灰、
// 行尾「暂时不能练」，点行进「不能练」说明。lookup 模式没有勾选（输入不自动选中，任务卡 M2-0）。
// 纯视图（无 hook），test/ui/query.test.mjs 直接调用。
//
// data-testid：query-row（data-char / data-practicable / data-selected）、query-row-open、query-row-select、query-row-status。

import { html } from '../../../../vendor/ui.js';
import { Button } from '../Button.js';
import { Chevron } from '../Chevron.js';
import { injectStyles, T } from '../styles.js';
import { t } from '../../../config/copy/index.js';
import { rowStatus } from '../../../core/query.js';

injectStyles('query-row', `
.sz-qrows{display:flex;flex-direction:column;border-top:.5px solid ${T.line};margin:0;padding:0;list-style:none}
.sz-qrow{min-height:calc(64px * ${T.k});box-sizing:border-box;display:flex;align-items:center;gap:${T.s1};border-bottom:${T.hair} solid ${T.line}}
.sz-qrow__sel{flex:none;width:44px;height:44px;margin-left:-10px;display:grid;place-items:center}
.sz-qrow__dot{width:24px;height:24px;box-sizing:border-box;border-radius:50%;border:1.5px solid ${T.ink4};display:grid;place-items:center}
.sz-qrow__sel[aria-checked="true"] .sz-qrow__dot{border:0;background:${T.ink1}}
.sz-qrow__open{flex:1;min-width:0;min-height:calc(64px * ${T.k});padding:${T.s2} 0;display:flex;align-items:center;gap:${T.s3};text-align:left}
.sz-qrow__main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.sz-qrow__head{display:flex;align-items:baseline;gap:10px}
.sz-qrow__char{font-family:${T.kai};font-size:${T.fs28};line-height:${T.lh28};color:${T.ink1}}
.sz-qrow[data-practicable="false"] .sz-qrow__char{color:${T.ink4}}
.sz-qrow__py{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-qrow__word{font-family:${T.kai};font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink2}}
.sz-qrow__status{flex:none;max-width:40%;text-align:right;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
`);

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const CHECK = () => html`<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="var(--paper)" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m3 7.2 2.6 2.6L11 4.4"></path></svg>`;

/**
 * @param {object} p
 * @param {{char:string, practicable:boolean, custom:boolean, count:number}} p.summary  core/query charSummary
 * @param {string} [p.pinyin]  @param {string} [p.word]  词语（与字相同时不显示）
 * @param {boolean} p.selectable  pick 模式且能练
 * @param {boolean} p.selected
 * @param {(char:string) => void} p.onOpen  @param {(char:string) => void} [p.onToggle]
 */
export function CharRow({ summary, pinyin = '', word = '', selectable = false, selected = false, onOpen, onToggle }) {
  const c = summary.char;
  const status = rowStatus(summary);
  const statusText = t(status.key, status.vars);
  const showWord = word && word !== c;
  const sel = selectable
    ? html`<${Button} variant="plain" class="sz-qrow__sel" role="checkbox" aria-checked=${selected ? 'true' : 'false'}
        rapid=${true} aria-label=${t(selected ? 'X-QUERY.unselectAria' : 'X-QUERY.selectAria', { char: c })}
        data-testid="query-row-select" onClick=${() => onToggle && onToggle(c)}>
        <span class="sz-qrow__dot" aria-hidden="true">${selected ? CHECK() : null}</span>
      </${Button}>`
    : null;
  return html`<li class="sz-qrow" data-testid="query-row" data-char=${c} data-practicable=${summary.practicable ? 'true' : 'false'}
    data-selected=${selectable ? (selected ? 'true' : 'false') : undefined}>
    ${sel}
    <${Button} variant="plain" class="sz-qrow__open" data-testid="query-row-open" onClick=${() => onOpen && onOpen(c)}
      aria-label=${pinyin ? t('X-QUERY.rowAria', { char: c, pinyin, status: statusText }) : t('X-QUERY.rowAriaNoPinyin', { char: c, status: statusText })}>
      <span class="sz-qrow__main">
        <span class="sz-qrow__head"><span class="sz-qrow__char">${c}</span>${pinyin ? html`<span class="sz-qrow__py">${pinyin}</span>` : null}</span>
        ${showWord ? html`<span class="sz-qrow__word">${word}</span>` : null}
      </span>
      <span class="sz-qrow__status" data-testid="query-row-status">${statusText}</span>
      <${Chevron} />
    </${Button}>
  </li>`;
}
