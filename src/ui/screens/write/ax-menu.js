// 写字页底栏：只留一个主按钮 + 一个「⋯」菜单（D51 ⑦，P225；ADA A2-01 / A2-11；D53 ②：从 AX 档推广到所有字号，常规字号与 AX 同构，P257）。
//
// 底栏 = [主按钮（当前阶段最该点的那个，满宽）][⋯ 更多]，只有一行，各阶段高度一致，书写格因此永远完整落在首屏、顶边不动：
//   回忆：主「写好了」；菜单收进 在纸上写 / 提示 / 看答案 / 跳过（/ 结束这组）（「在纸上写」排第一：读屏、手抖用户的替代路径，X1）。
//   看答案：主「描一遍」；菜单 自己写 / 下一个（/ 结束这组）。描一遍：主「描好了，自己写」（AX3 起「自己写」，P259）；菜单 下一个。自己写：主「下一个」；菜单 再描一遍。
//   保存失败：主「再试一次」；菜单「先不保存」。
// 菜单是现有的底部弹层（components/Sheet.js，经 nav.openOverlay 打开），菜单项竖排、字号随 AX 档、可折行（按词折，components/Words.js；A2-11 / A3-02）。
// 菜单项沿用原按钮的 data-testid（write-hint / write-show-answer / write-skip / write-to-paper / write-end / write-answer-next …），
// 选了菜单项 = 先关弹层再执行原来那个按钮的动作（动作是页面渲染时取的闭包 / live ref，菜单开着期间页面状态不会变）。
// R3-K1（P241）：格子缩到下限 220 仍放不下格下说明位时（layout.js axWriteLayout noteInMenu），说明位的内容（结果行「修改」、读屏的纸上写建议、
// 看答案的后果说明…）并入菜单顶部（head），格下不画——不被底栏盖住，也不丢。

import { html } from '../../../../vendor/ui.js';
import { nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { Sheet } from '../../components/Sheet.js';
import { Words } from '../../components/Words.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';

injectStyles('write-ax', `
.sz-write__foot.sz-write__foot--ax{flex-direction:row;align-items:stretch;gap:${T.s3}}
.sz-write__foot--ax>.sz-btn--primary,.sz-write__foot--ax>.sz-write__alt{flex:1 1 0;min-width:0;line-break:strict;text-wrap:balance}
.sz-write__more{flex:none;width:max(56px, calc(var(--btn-h) * .8));min-height:var(--btn-h);padding:0;display:grid;place-items:center}
.sz-write__more svg{width:28px;height:28px}
.sz-axmenu{display:flex;flex-direction:column;gap:0}
.sz-axmenu__head{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:4px 4px 12px;color:${T.ink2};
  font-size:${T.fs15};line-height:${T.lh15};box-shadow:inset 0 -${T.hair} 0 ${T.line}}
.sz-write__more{position:relative}
.sz-write__more[data-note="true"]::after{content:"";position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:${T.ink2}} /* 说明并入了菜单（P241） */
.sz-axmenu__item{width:100%;min-height:max(${T.hit}, calc(var(--lh17) + 20px));padding:10px 4px;text-align:left;font-size:${T.fs17};
  line-height:${T.lh17};color:${T.ink1};white-space:normal;line-break:strict;display:flex;align-items:center;
  box-shadow:inset 0 -${T.hair} 0 ${T.line}}
.sz-axmenu__item:last-child{box-shadow:none}
.sz-axmenu__item[data-pressed]{background:${T.field}}
.sz-axmenu__item[disabled],.sz-axmenu__item[data-static="true"]{color:${T.ink4}}
`);

const MORE_ICON = () => html`<svg viewBox="0 0 28 28" fill="currentColor" aria-hidden="true" focusable="false">
  <circle cx="6" cy="14" r="2.2"></circle><circle cx="14" cy="14" r="2.2"></circle><circle cx="22" cy="14" r="2.2"></circle></svg>`;

/**
 * 菜单项：{testid, label, ariaLabel?, disabled?, state?, remaining?, onSelect}（state / remaining 原样写成 data-state / data-remaining，提示项的「还有几次」给测试读）。disabled 的项照样列出（灰），读屏知道有这一项但现在不能用（例如提示已用完）。
 * @param {{items: Array, close?: () => void, active?: boolean}} props  overlay 组件：root 注入 close / active
 */
export function AxMenu({ items = [], head = null, close, active = true }) {
  return html`<${Sheet} onClose=${close} active=${active} testid="write-ax-menu">
    <div class="sz-axmenu" role="group" aria-label=${t('X-WRITE.moreLabel')}>
      ${head ? html`<div class="sz-axmenu__head" data-testid="write-menu-note">${head}</div>` : null}
      ${items.map(it => it.static
    ? html`<span key=${it.testid} class="sz-axmenu__item" data-static="true" data-testid=${it.testid}><${Words} text=${it.label} /></span>`
    : html`<${Button} key=${it.testid} variant="plain" class="sz-axmenu__item" data-testid=${it.testid}
        aria-label=${it.ariaLabel || undefined} disabled=${!!it.disabled} data-state=${it.state || undefined} data-remaining=${it.remaining !== undefined ? it.remaining : undefined}
        onClick=${() => {
          if (close) close();
          if (typeof it.onSelect === 'function') it.onSelect();
        }}>${it.label}</${Button}>`)}
    </div>
  </${Sheet}>`;
}

/** 打开 AX 菜单；head：并入菜单顶部的格下说明（P241，可缺省）。返回 overlay id。 */
export function openAxMenu(items, head = null) {
  return nav.openOverlay(AxMenu, { items, head }, { name: 'write-ax-menu' });
}

/**
 * 底栏的一行（所有字号）：主按钮 + 「⋯」。纯视图（点「⋯」才开弹层）。
 * @param {{primary: {testid:string, label:string, disabled?:boolean, onClick:Function, variant?:string}, secondary?: {testid:string, label:string, onClick:Function}|null,
 *          items: Array, testid?: string, stage?: string, failed?: boolean}} props
 *   items 为空时不画「⋯」（主按钮独占一行）。secondary：主按钮左边的次按钮（保存失败的「先不保存」，R-G04 三段式；常规字号两键都摆出来，AX 档放不下才收进菜单）。
 */
export function AxFoot({ primary, secondary = null, items = [], testid = 'write-foot', stage, failed = false, lead = null, head = null }) {
  return html`<div class="sz-write__foot sz-write__foot--ax" data-testid=${testid} data-stage=${stage} data-failed=${failed ? 'true' : 'false'}>
    ${lead}
    ${secondary ? html`<${Button} variant="secondary" class="sz-write__alt" data-testid=${secondary.testid} onClick=${secondary.onClick}>${secondary.label}</${Button}>` : null}
    <${Button} variant=${primary.variant || 'primary'} data-testid=${primary.testid} disabled=${!!primary.disabled}
      onClick=${primary.onClick}>${primary.label}</${Button}>
    ${items.length || head
    ? html`<${Button} variant="secondary" class="sz-write__more" data-testid="write-more" aria-label=${t('X-WRITE.moreLabel')}
        aria-haspopup="dialog" data-note=${head ? 'true' : null} onClick=${() => openAxMenu(items, head)}>${MORE_ICON()}</${Button}>`
    : null}
  </div>`;
}
