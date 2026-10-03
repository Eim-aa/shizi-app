// AX 档（系统「更大字体」辅助功能档 AX1–AX5）防溢出规则（阶段 1 P1-E6；D29「AX 档单独排版」；03 P131）。
//
// platform/text-size.js 在 AX 档给 <html> 加 data-ax="1".."5"（--k 1.6–2.4，policy.contentSizeScale，P130），同时 --k ≥ 1.3
// 一定带 data-text-large（紧凑排布）。这里只放最关键的过渡规则，保证首页、写字页（题面 / 底栏）、判断页、结果页、设置页、Tab 栏
// 在 AX 档下不横向溢出、关键按钮在视口内且触控区够大：
//   - 多行折行：页头标题从「左右按钮之间的一行省略号」改成单独一行、可折行（左右按钮留在第一行）；按钮文字可折行。
//   - 横排改竖排：写字页底栏「提示 · 写好了」、判断页「写错了 · 写对了」两键改上下排；「看答案 · 跳过 · 结束这组」放不下时折行；
//     设置页带值的行（练习范围、外观、备份与恢复）标题与值改上下排。
//   - 按钮最小高随字号：主 / 次按钮、文字按钮、判断键的最小高度按自身字号算（1.3em + 内边距），不再是固定 52 / 72 × --k。
//   - Tab 栏不随 AX 继续放大：高度、图标、标签封顶在 XXXL 的倍率（iOS 系统 Tab 栏同样不随 Dynamic Type 放大）。
// 书写格边长不受影响（P118 / D36，按可用空间算）。完整 AX 版式（逐级字阶、说明折叠到 ⓘ 等，ADA A03 / A04）等设计稿给出后替换本文件。
// 选择器一律以 :root[data-ax][data-text-large] 开头，比紧凑版（write/compact.js 的 :root[data-text-large] …）多一个属性，
// 注入顺序无关。由 ui/root.js 导入一次。

import { injectStyles } from './styles.js';
import * as policy from '../../config/policy.js';

/** AX 档规则的根选择器（导出给单测）。 */
export const AX_ROOT = ':root[data-ax][data-text-large]';
/** Tab 栏在 AX 档的倍率上限 = XXXL 档的倍率（P130）。 */
export const TAB_SCALE_CAP = policy.contentSizeScale.XXXL;

const A = AX_ROOT;
/** 写字 / 判断页规则再加一个 [data-testid]，比紧凑版同名规则（:root[data-text-large] .sz-page[data-testid=…] …）更具体。 */
const W = `${A} .sz-page[data-testid]`;

export const AX_CSS = `
${A} .sz-page .sz-page__head{flex-wrap:wrap;align-items:center}
${A} .sz-page .sz-page__head>.sz-page__title{position:relative;left:auto;right:auto;order:3;flex:1 0 100%;min-width:0;
  padding:0 8px 6px;white-space:normal;overflow:visible;text-overflow:clip;text-align:left;line-height:1.3;text-wrap:pretty}
${A} .sz-page .sz-page__head>.sz-page__lead,${A} .sz-page .sz-page__head>.sz-page__trail{flex:none}
${A} .sz-btn--primary,${A} .sz-btn--secondary{min-height:calc(1.3em + 24px);height:auto;padding-top:6px;padding-bottom:6px;
  white-space:normal;letter-spacing:.02em}
${A} .sz-btn--text{min-height:max(44px, calc(1.3em + 12px));white-space:normal;text-align:left}
${W} .sz-write__main{grid-template-columns:minmax(0,1fr);gap:8px}
${W} .sz-write__foot .sz-btn--primary,${W} .sz-write__foot .sz-btn--secondary{min-height:calc(1.3em + 20px);white-space:normal}
${W} .sz-write__hint .sz-hintbtn{white-space:normal}
${W} .sz-write__links{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0 16px}
${W} .sz-write__links>.sz-write__linkrow,${W} .sz-write__links>.sz-write__skiprow{justify-self:auto}
${W} .sz-judge__btns,${W} .sz-judge__fail{grid-template-columns:minmax(0,1fr)}
${W} .sz-judge__btn{min-height:calc(1.3em + 28px)}
${A} .sz-set__row.sz-set__row--value{flex-direction:column;align-items:flex-start;justify-content:center;gap:4px}
${A} .sz-set__row--value .sz-set__value{flex-wrap:wrap;max-width:100%}
${A} .sz-tabs{height:calc(64px * ${TAB_SCALE_CAP});margin-bottom:max(calc(22px * ${TAB_SCALE_CAP}), env(safe-area-inset-bottom, 0px))}
${A} .sz-tabs .sz-tabs__tab{font-size:calc(11px * ${TAB_SCALE_CAP})}
${A} .sz-tabs .sz-tabs__tab svg{width:calc(22px * ${TAB_SCALE_CAP});height:calc(22px * ${TAB_SCALE_CAP})}
`;

injectStyles('ax', AX_CSS);
