// 写字页底栏（R4-F1，D55，P260）：主按钮 + 其下一行文字按钮——提示 / 看答案 / 跳过 等求助与次要操作一次点击直达，不进任何菜单。
//
// 产品负责人真机试用后推翻了 R3-C3W 的「主按钮 + ⋯ 菜单」（P258）：常用操作不得为了画面简洁而藏进菜单。
//   底栏 = [主按钮（当前阶段最该点的那个，满宽）]
//          [文字按钮行：左组 = 本阶段的次要路径（回忆：提示 / 看答案；看答案：自己写；自己写：再描一遍…），右端 = 离开动作（结束这组 / 跳过 / 下一个）]
//   各阶段的文字行同高（min-height 44，空着也占位），书写格顶边与主按钮位置在同一张卡的所有阶段不动；判断页用同一高度的留空行（compare.js）。
// 文字按钮用全 App 统一的规格（components/Button.js variant="text"：黑体 15、ink2、无下划线、热区 ≥ 44）。一行放不下时按词折行（flex-wrap；按钮文字经 components/Words.js 分词）。
// AX 档（P261）：文字行字号分层封顶（AX1–AX2 17pt、AX3–AX5 22pt，policy.writeGrid.axAux.links）——不封顶时 AX5 的 49pt 字让四个按钮折成三四行，书写格放不下 220；
//   折行后仍放不下（书写格会低于下限 220）时，主按钮字号封顶 34pt（compact，让出约 25pt），仍放不下才让页面正文可滚动；提示 / 看答案 / 跳过任何字号都不收起。
// 「在纸上写」不在写字页（D56，P275）：写字方式只在设置里选。
// 槽位 testid：write-links（文字行）、write-hint-slot、write-answer-slot、write-end-slot、write-skip-slot（回忆阶段）；看答案流程的按钮自带 testid。

import { html } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';

injectStyles('write-foot', `
.sz-write__foot{display:flex;flex-direction:column;gap:6px}
.sz-write__links{min-height:${T.hit};display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;column-gap:${T.s3}}
.sz-write__linkgrp{display:flex;flex-wrap:wrap;align-items:center;column-gap:${T.s4};min-width:0}
.sz-write__linkgrp:last-child{margin-left:auto;justify-content:flex-end}
.sz-write__slot:empty{display:none}
.sz-write__linkrow,.sz-write__hint,.sz-write__skiprow,.sz-write__endslot{min-height:${T.hit};display:flex;align-items:center}
.sz-write__links--ghost{visibility:hidden}
:root[data-ax][data-text-large] .sz-page[data-testid] .sz-write__foot[data-compact="true"] .sz-btn--primary{font-size:calc(34px * 1);line-height:40px;min-height:60px;padding-top:0;padding-bottom:0}
:root[data-ax] .sz-write__links--ghost{display:none}
:root[data-ax] .sz-write__links .sz-btn--text,:root[data-ax] .sz-write__links .sz-nohint{font-size:calc(17px * 1);line-height:24px}
:root[data-ax="3"] .sz-write__links .sz-btn--text,:root[data-ax="4"] .sz-write__links .sz-btn--text,:root[data-ax="5"] .sz-write__links .sz-btn--text,
:root[data-ax="3"] .sz-write__links .sz-nohint,:root[data-ax="4"] .sz-write__links .sz-nohint,:root[data-ax="5"] .sz-write__links .sz-nohint{font-size:calc(22px * 1);line-height:30px}
`);

/** 文字行里的一个槽：没有内容时 :empty 整个收起（不留间隔）。 */
export function Slot({ testid, cls = 'sz-write__linkrow', children = null }) {
  return html`<div class=${`${cls} sz-write__slot`} data-testid=${testid}>${children}</div>`;
}

/**
 * 底栏：主按钮 + 文字行。纯视图。
 * @param {{primary: {testid:string, label:string, disabled?:boolean, onClick:Function}, left?: any, right?: any, testid?: string, stage?: string, failed?: boolean, lead?: any}} props
 *   left / right：文字行左组 / 右端组的内容（vnode，可含多个槽）；两组都空时文字行仍占位（同高，不让主按钮跳）。
 */
export function WriteFoot({ primary, left = null, right = null, testid = 'write-foot', stage, failed = false, lead = null, compact = false }) {
  return html`<div class="sz-write__foot" data-testid=${testid} data-stage=${stage} data-failed=${failed ? 'true' : 'false'} data-compact=${compact ? 'true' : null}>
    ${lead}
    <${Button} variant="primary" data-testid=${primary.testid} disabled=${!!primary.disabled} onClick=${primary.onClick}>${primary.label}</${Button}>
    <div class="sz-write__links" data-testid="write-links">
      <div class="sz-write__linkgrp">${left}</div>
      <div class="sz-write__linkgrp">${right}</div>
    </div>
  </div>`;
}

/** 文字行里的一个文字按钮（全 App 统一规格）。 */
export function LinkButton({ testid, label, onClick, disabled = false, ...rest }) {
  return html`<${Button} variant="text" data-testid=${testid} disabled=${disabled} onClick=${onClick} ...${rest}>${label}</${Button}>`;
}
