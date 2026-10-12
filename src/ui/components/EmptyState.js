// 空状态（交互与动效规范 S2，审计 P2-22：原先字库首页 / 清单 / 有记录的字 / 年报 / 「没有要写的字」/「我的」各画各的，三四种画法）：全 App 唯一的写法。
//   一句标题（宋 22 墨一）说这里将来会有什么 + 一句说明（15 墨二）说怎样让它变得不空；有能让它不空的操作时才放（文字按钮，主按钮仍在 Page 底栏）。
//   上方一个空格子（笺面 + 1pt 外框，不画十字线），与首页「没写」的格同一个语言（C3-H / T3-09，D53 ⑦）；需要时格里放一个淡色示例字（清单、年报）。
//   不画插图、不讲内部概念（A3-06）；与有数据时同一页头、同一左上元素（由所在页面保证）。
//   layout：'fill'（缺省，占满正文、上下居中）/ 'inline'（嵌在有别的内容的页面里，左对齐，例如「我的」首页、月字帖的空纸）。
import { html } from '../../../vendor/ui.js';
import { Button } from './Button.js';
import { PracticeGlyph, FACE_FULL } from './PracticeGlyph.js';
import { injectStyles, T, TEX } from './styles.js';

injectStyles('empty-state', `
.sz-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${T.s2};text-align:center;padding:${T.s8} 0 ${T.s6}}
.sz-empty[data-layout="inline"]{flex:none;align-items:flex-start;text-align:left;padding:0}
.sz-empty__cell{display:grid;place-items:center;box-sizing:border-box;margin-bottom:${T.s2};width:calc(72px * ${T.k});height:calc(72px * ${T.k});${TEX};
  box-shadow:inset 0 0 0 ${T.frameW} ${T.frame};color:${T.under}}
.sz-empty__cell .sz-pg{width:60%;height:60%}
.sz-empty__title{margin:0;font-family:${T.song};font-size:${T.fs22};line-height:${T.lh22};font-weight:500;color:${T.ink1};text-wrap:balance}
.sz-empty__body{margin:0;max-width:calc(290px * ${T.k});font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-empty[data-layout="inline"] .sz-empty__body{max-width:none}
.sz-empty__action.sz-btn{margin-top:${T.s2}}
`);

/**
 * 纯视图（无 hooks）。
 * @param {object} p
 * @param {string} [p.title]
 * @param {string|Array} [p.body]          说明（可以是多段：数组逐段一行）
 * @param {boolean} [p.cell]               上方画空格子（缺省 true；inline 缺省 false）
 * @param {string} [p.glyph]               格里的淡色示例字（清单、年报）
 * @param {{label:string, onClick:Function, testid?:string}} [p.action]  能让它不空的操作（文字按钮）
 * @param {'fill'|'inline'} [p.layout]
 * @param {{root?:string, cell?:string, title?:string, body?:string}} [p.testids]
 * @param {object} [p.attrs]               外层附加属性（data-*）
 */
export function EmptyState({ title = '', body = '', cell, glyph = '', action = null, layout = 'fill', testids = {}, attrs = null, titleTag = 'h2' }) {
  const showCell = cell === undefined ? layout === 'fill' : !!cell;
  const bodies = Array.isArray(body) ? body.filter(Boolean) : body ? [body] : [];
  const tid = testids || {};
  const titleNode = !title
    ? null
    : titleTag === 'p'
      ? html`<p class="sz-empty__title" data-testid=${tid.title}>${title}</p>`
      : html`<h2 class="sz-empty__title" data-testid=${tid.title}>${title}</h2>`;
  return html`<div class="sz-empty" data-layout=${layout} data-testid=${tid.root} ...${attrs || {}}>
    ${showCell ? html`<span class="sz-empty__cell" aria-hidden="true" data-testid=${tid.cell}>${glyph ? html`<${PracticeGlyph} char=${glyph} face=${FACE_FULL} />` : null}</span>` : null}
    ${titleNode}
    ${bodies.map((b, i) => html`<p key=${i} class="sz-empty__body" data-testid=${i === 0 ? tid.body : (tid.extra && tid.extra[i - 1]) || undefined}>${b}</p>`)}
    ${action ? html`<${Button} variant="text" class="sz-empty__action" data-testid=${action.testid} onClick=${action.onClick}>${action.label}</${Button}>` : null}
  </div>`;
}
