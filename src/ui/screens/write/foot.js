// 写字页底栏（A7，D57，P280）：求助行 + 主按钮——本阶段的次要路径（回忆：提示 / 看答案；看答案：自己写 / 下一个；……）是「写好了」正上方 20pt 的一行凹面按钮，一次点击直达，没有菜单。
//
// 沿革：R4-F1（D55，P260）推翻了 R3-C3W 的「主按钮 + ⋯ 菜单」，改为主按钮下面一行文字按钮；产品负责人在 D57 选定设计稿 A7：求助下到拇指最顺的区域（位置同 A1，但用凹面 field 而不是描边，
// 免得读成「另一个确认」），撤销 / 清空贴着书写格（write/index.js 的格下工具行），跳过进页头右上（离开动作），进度在页头中间。
//   底栏 = [求助行：1–2 枚等宽凹面按钮（高 48，AX 档 56；17 号 500，带图标时图标在字前），空着也占位（各阶段同高，书写格顶边与主按钮位置在同一张卡的所有阶段不动；判断页用同一高度的留空行，compare.js）]
//          [20][主按钮（当前阶段最该点的那个，满宽）]
//   一个按钮时占满整行，两个按钮 12 间隔等分；写字页两阶段切换时按钮位置不跳（行高固定）。
// 凹面按钮是写字页里 field 色的新用法（设计系统里 field 原是输入框、分段控件和按下底；D57 点头）：对纸只有 1.18 的对比，「看得出是按钮、但不抢」，比墨色主按钮轻得多。
// AX 档（P261）：求助行按钮 56 高、字号分层封顶（AX1–AX2 17pt、AX3–AX5 22pt，policy.writeGrid.axAux.links）；一行放得下（两枚各约 169 宽），不再折行；
//   书写格放不下 220（tight）时，主按钮字号封顶 34pt（compact，让出约 25pt），仍放不下才让页面正文可滚动；提示 / 看答案任何字号都不收起。
// 「在纸上写」不在写字页（D56，P275）：写字方式只在设置里选。
// 槽位 testid：write-links（求助行）、write-hint-slot、write-answer-slot（回忆阶段）；看答案流程的按钮自带 testid；跳过 / 结束这组在页头（write-skip-slot / write-end-slot，write/index.js）。

import { html } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { Icons } from '../../components/icons.js';
import { injectStyles, T } from '../../components/styles.js';

injectStyles('write-foot', `
.sz-write__foot{display:flex;flex-direction:column;gap:20px}
.sz-write__links{min-height:48px;display:flex;align-items:stretch;gap:${T.s3}}
.sz-write__slot{flex:1 1 0;min-width:0;display:flex;align-items:stretch}
.sz-write__slot:empty{display:none}
.sz-write__slot>*{flex:1 1 auto;min-width:0}
.sz-write__links--ghost{visibility:hidden}
.sz-write__links .sz-btn--text{--bx:0px;width:100%;min-height:48px;margin:0;padding:0 ${T.s3};justify-content:center;gap:8px;border-radius:${T.rCtl};
  background:${T.field};color:${T.ink1};font-size:${T.fs17};line-height:${T.lh17};font-weight:500}
.sz-write__links .sz-btn--text::after{display:none}
.sz-write__links .sz-btn--text[data-pressed]{color:${T.ink1};filter:brightness(.94)}
.sz-write__links .sz-btn--text[disabled]{color:${T.ink4}}
.sz-write__ic{flex:none;width:18px;height:18px;color:${T.ink2};display:inline-flex}
.sz-write__ic svg{width:100%;height:100%}
.sz-write__links .sz-btn--text[disabled] .sz-write__ic{color:${T.ink4}}
.sz-write__links .sz-nohint{min-height:48px;flex:1 1 auto;justify-content:center;text-align:center}
:root[data-ax][data-text-large] .sz-page[data-testid] .sz-write__foot[data-compact="true"] .sz-btn--primary{font-size:calc(34px * 1);line-height:40px;min-height:52px;padding-top:0;padding-bottom:0}
:root[data-ax] .sz-write__links--ghost{display:none}
:root[data-ax] .sz-write__links,:root[data-ax] .sz-write__links .sz-btn--text,:root[data-ax] .sz-write__links .sz-nohint{min-height:56px}
:root[data-ax] .sz-write__links .sz-btn--text,:root[data-ax] .sz-write__links .sz-nohint{font-size:calc(17px * 1);line-height:24px}
:root[data-ax="3"] .sz-write__links .sz-btn--text,:root[data-ax="4"] .sz-write__links .sz-btn--text,:root[data-ax="5"] .sz-write__links .sz-btn--text,
:root[data-ax="3"] .sz-write__links .sz-nohint,:root[data-ax="4"] .sz-write__links .sz-nohint,:root[data-ax="5"] .sz-write__links .sz-nohint{font-size:calc(22px * 1);line-height:30px}
:root[data-ax] .sz-write__ic{width:22px;height:22px}
.sz-write__foot[data-compact="true"]{gap:6px}
:root[data-ax] .sz-write__foot[data-compact="true"] .sz-write__links,:root[data-ax] .sz-write__foot[data-compact="true"] .sz-write__links .sz-btn--text{min-height:48px} /* 书写格仍放不下 220（P261 / P278）：求助行与主按钮的间距 20 → 6、行高 56 → 48、主按钮 60 → 52；write/index.js 的 data-tight 再收书写格下的间距，共让出约 34pt（热区仍 ≥ 44；WebKit 的 SE 3 AX3 / AX5 实测超出 20pt） */
`);

/** 文字行里的一个槽：没有内容时 :empty 整个收起（不留间隔）。 */
export function Slot({ testid, cls = 'sz-write__linkrow', children = null }) {
  return html`<div class=${`${cls} sz-write__slot`} data-testid=${testid}>${children}</div>`;
}

/**
 * 底栏：求助行 + 主按钮。纯视图。
 * @param {{primary: {testid:string, label:string, disabled?:boolean, onClick:Function}, left?: any, right?: any, testid?: string, stage?: string, failed?: boolean, lead?: any}} props
 *   left / right：求助行的内容（vnode，每个 Slot 是一枚按钮；left 在前、right 在后，同一行等分）；全空时求助行仍占位（同高，不让主按钮跳）。
 */
export function WriteFoot({ primary, left = null, right = null, testid = 'write-foot', stage, failed = false, lead = null, compact = false }) {
  return html`<div class="sz-write__foot" data-testid=${testid} data-stage=${stage} data-failed=${failed ? 'true' : 'false'} data-compact=${compact ? 'true' : null}>
    ${lead}
    <div class="sz-write__links" data-testid="write-links">${left}${right}</div>
    <${Button} variant="primary" data-testid=${primary.testid} disabled=${!!primary.disabled} onClick=${primary.onClick}>${primary.label}</${Button}>
  </div>`;
}

/** 求助行里的一枚凹面按钮（图标在字前，icon 可省）。 */
export function LinkButton({ testid, label, onClick, disabled = false, icon = null, ...rest }) {
  return html`<${Button} variant="text" data-testid=${testid} disabled=${disabled} onClick=${onClick} ...${rest}>${icon ? html`<span class="sz-write__ic" aria-hidden="true">${icon}</span>` : null}${label}</${Button}>`;
}
