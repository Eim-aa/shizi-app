// AX 档（系统「更大字体」AX1–AX5）写字页底栏：只留一个主按钮 + 一个「⋯」菜单（D51 ⑦，P225；ADA A2-01 / A2-11）。
//
// 底栏 = [主按钮（当前阶段最该点的那个，满宽）][⋯ 更多]，只有一行，各阶段高度一致，书写格因此永远完整落在首屏：
//   回忆：主「写好了」；菜单收进 提示 / 看答案 / 跳过 / 在纸上写（/ 结束这组）。
//   看答案：主「描一遍」；菜单 自己写 / 下一个（/ 结束这组）。描一遍：主「描好了，自己写」；菜单 下一个。自己写：主「下一个」；菜单 再描一遍。
//   保存失败：主「再试一次」；菜单「先不保存」。
// 菜单是现有的底部弹层（components/Sheet.js，经 nav.openOverlay 打开），菜单项竖排、字号随 AX 档、可折行（词内不折，A2-11）。
// 菜单项沿用原按钮的 data-testid（write-hint / write-show-answer / write-skip / write-to-paper / write-end / write-answer-next …），
// 选了菜单项 = 先关弹层再执行原来那个按钮的动作（动作是页面渲染时取的闭包 / live ref，菜单开着期间页面状态不会变）。

import { html } from '../../../../vendor/ui.js';
import { nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { Sheet } from '../../components/Sheet.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';

injectStyles('write-ax', `
.sz-write__foot.sz-write__foot--ax{flex-direction:row;align-items:stretch;gap:${T.s3}}
.sz-write__foot--ax>.sz-btn--primary{flex:1 1 0;min-width:0;word-break:keep-all;text-wrap:balance}
.sz-write__more{flex:none;width:max(56px, calc(var(--btn-h) * .8));min-height:var(--btn-h);padding:0;display:grid;place-items:center}
.sz-write__more svg{width:28px;height:28px}
.sz-axmenu{display:flex;flex-direction:column;gap:0}
.sz-axmenu__item{width:100%;min-height:max(${T.hit}, calc(var(--lh17) + 20px));padding:10px 4px;text-align:left;font-size:${T.fs17};
  line-height:${T.lh17};color:${T.ink1};white-space:normal;word-break:keep-all;display:flex;align-items:center;
  box-shadow:inset 0 -${T.hair} 0 ${T.line}}
.sz-axmenu__item:last-child{box-shadow:none}
.sz-axmenu__item[data-pressed]{background:${T.field}}
.sz-axmenu__item[disabled],.sz-axmenu__item[data-static="true"]{color:${T.ink4}}
`);

const MORE_ICON = () => html`<svg viewBox="0 0 28 28" fill="currentColor" aria-hidden="true" focusable="false">
  <circle cx="6" cy="14" r="2.2"></circle><circle cx="14" cy="14" r="2.2"></circle><circle cx="22" cy="14" r="2.2"></circle></svg>`;

/**
 * 菜单项：{testid, label, ariaLabel?, disabled?, onSelect}。disabled 的项照样列出（灰），读屏知道有这一项但现在不能用（例如提示已用完）。
 * @param {{items: Array, close?: () => void, active?: boolean}} props  overlay 组件：root 注入 close / active
 */
export function AxMenu({ items = [], close, active = true }) {
  return html`<${Sheet} onClose=${close} active=${active} testid="write-ax-menu">
    <div class="sz-axmenu" role="group" aria-label=${t('X-WRITE.moreLabel')}>
      ${items.map(it => it.static
    ? html`<span key=${it.testid} class="sz-axmenu__item" data-static="true" data-testid=${it.testid}>${it.label}</span>`
    : html`<${Button} key=${it.testid} variant="plain" class="sz-axmenu__item" data-testid=${it.testid}
        aria-label=${it.ariaLabel || undefined} disabled=${!!it.disabled}
        onClick=${() => {
          if (close) close();
          if (typeof it.onSelect === 'function') it.onSelect();
        }}>${it.label}</${Button}>`)}
    </div>
  </${Sheet}>`;
}

/** 打开 AX 菜单；返回 overlay id。 */
export function openAxMenu(items) {
  return nav.openOverlay(AxMenu, { items }, { name: 'write-ax-menu' });
}

/**
 * AX 档底栏的一行：主按钮 + 「⋯」。纯视图（点「⋯」才开弹层）。
 * @param {{primary: {testid:string, label:string, disabled?:boolean, onClick:Function, variant?:string}, items: Array, testid?: string, stage?: string, failed?: boolean}} props
 *   items 为空时不画「⋯」（主按钮独占一行）。
 */
export function AxFoot({ primary, items = [], testid = 'write-foot', stage, failed = false, lead = null }) {
  return html`<div class="sz-write__foot sz-write__foot--ax" data-testid=${testid} data-stage=${stage} data-failed=${failed ? 'true' : 'false'}>
    ${lead}
    <${Button} variant=${primary.variant || 'primary'} data-testid=${primary.testid} disabled=${!!primary.disabled}
      onClick=${primary.onClick}>${primary.label}</${Button}>
    ${items.length
    ? html`<${Button} variant="secondary" class="sz-write__more" data-testid="write-more" aria-label=${t('X-WRITE.moreLabel')}
        aria-haspopup="dialog" onClick=${() => openAxMenu(items)}>${MORE_ICON()}</${Button}>`
    : null}
  </div>`;
}
