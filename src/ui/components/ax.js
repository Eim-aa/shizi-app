// AX 档（系统「更大字体」辅助功能档 AX1–AX5）防溢出规则（阶段 1 P1-E6；D29「AX 档单独排版」；03 P131）。
//
// platform/text-size.js 在 AX 档给 <html> 加 data-ax="1".."5"（--k 1.6–2.4，policy.contentSizeScale，P130），同时 --k ≥ 1.3
// 一定带 data-text-large（紧凑排布）。这里只放最关键的过渡规则，保证首页、写字页（题面 / 底栏）、判断页、结果页、设置页、Tab 栏
// 在 AX 档下不横向溢出、关键按钮在视口内且触控区够大：
//   - 多行折行：页头标题从「左右按钮之间的一行省略号」改成单独一行、可折行（左右按钮留在第一行）；按钮文字可折行。
//   - 首页：日期行、墨迹旁的计数、「第二个组」入口按钮改为可折行（P1-E1a 起首页字号乘 --k，AX 档下不再有一行放得下的前提）。
//   - 横排改竖排：写字页底栏「提示 · 写好了」、判断页「写错了 · 写对了」两键改上下排；「看答案 · 跳过 · 结束这组」放不下时折行；
//     设置页带值的行（练习范围、外观、备份与恢复）标题与值改上下排。
//   - 按钮最小高随字号：主 / 次按钮、文字按钮、判断键的最小高度按自身字号算（1.3em + 内边距），不再是固定 52 / 72 × --k。
//   - Tab 栏不放大（D49 收紧 Q2-11 的封顶）：Tabs.js 的高、图标 24、标签 11 本来就不读 --k，AX 档没有任何额外规则（iOS 系统 Tab 栏同样不随 Dynamic Type 放大）。
//   - 字阶（D49）：AX 档的 --fsN / --lhN / --btn-h 由 tokens.css 的 :root[data-ax="N"] 逐级给出（不再统一乘 --k），下面按钮的最小高直接取 --btn-h。
// 写字页 / 判断页 / 看答案页在 AX 档有自己的专属版式（D51 ⑦，P225；ADA A2-01 / A2-04 / A2-09 / A2-11）：永不滚动、书写格按实际可用高度排（下限 220）、
// 底栏 = 主按钮 + 一行文字按钮（提示 / 看答案 / 跳过…一次点击直达，字号封顶 17 / 22pt，折行时按词折，R4-F1 P260–P261）、撤销 / 清空在页头、辅助字分层封顶——样式在 write/index.js、write/prompt.js、write/foot.js，尺寸在 write/layout.js axWriteLayout。
// 本文件只放各页共用的防溢出规则；按钮文字词内不折行（A2-11）：按钮文字经 components/Words.js 分词、词与词之间才折；不用 word-break:keep-all——
// 它让中文整句不能折行，WebKit 里按钮文字溢出、被裁（第三轮审查 A3-02，R3-K1 P242）。
// 选择器一律以 :root[data-ax][data-text-large] 开头，比紧凑版（write/compact.js 的 :root[data-text-large] …）多一个属性，
// 注入顺序无关。由 ui/root.js 导入一次。

import { useEffect, useState } from '../../../vendor/ui.js';
import { getTextSize, onTextSize } from '../../platform/text-size.js';
import { injectStyles } from './styles.js';

/** AX 档规则的根选择器（导出给单测）。 */
export const AX_ROOT = ':root[data-ax][data-text-large]';
const A = AX_ROOT;
/** 写字 / 判断页规则再加一个 [data-testid]，比紧凑版同名规则（:root[data-text-large] .sz-page[data-testid=…] …）更具体。 */
const W = `${A} .sz-page[data-testid]`;

export const AX_CSS = `
${A} .sz-page .sz-page__head{flex-wrap:wrap;align-items:center}
${A} .sz-page .sz-page__head>.sz-page__title{position:relative;left:auto;right:auto;order:3;flex:1 0 100%;min-width:0;
  padding:0 8px 6px;white-space:normal;overflow:visible;text-overflow:clip;text-align:left;line-height:var(--lh17);text-wrap:pretty}
${A} .sz-page .sz-page__head>.sz-page__lead,${A} .sz-page .sz-page__head>.sz-page__trail{flex:none}
${A} .sz-btn--primary,${A} .sz-btn--secondary{min-height:var(--btn-h);height:auto;padding-top:6px;padding-bottom:6px;
  white-space:normal;line-break:strict}
${A} .sz-btn--text{min-height:max(44px, calc(1.3em + 12px));white-space:normal;line-break:strict;text-align:left}
${W} .sz-write__foot .sz-btn--primary,${W} .sz-write__foot .sz-btn--secondary{min-height:calc(1.3em + 20px);white-space:normal}
${W} .sz-write__hint .sz-hintbtn{white-space:normal}
${W} .sz-judge__btns,${W} .sz-judge__fail{grid-template-columns:minmax(0,1fr)}
${W} .sz-judge__btn{min-height:calc(1.3em + 28px)}
${A} .sz-home .sz-home__date,${A} .sz-home .sz-home__line,${A} .sz-home .sz-home__other.sz-btn{white-space:normal}
${A} .sz-set__row.sz-set__row--value{flex-direction:column;align-items:flex-start;justify-content:center;gap:4px}
${A} .sz-set__row--value .sz-set__value{flex-wrap:wrap;max-width:100%}
`;

/** 当前 AX 档位 1–5（不在 AX 档为 0）；系统字号变化时更新。需要 JS 改结构的页面用它（首页首次打开的横排题跋、AX 档字帖格宽）；纯样式差异用 :root[data-ax]。 */
export function useAxLevel() {
  const [ax, setAx] = useState(() => getTextSize().ax);
  useEffect(() => {
    setAx(getTextSize().ax);
    return onTextSize(view => setAx(view.ax));
  }, []);
  return ax;
}

injectStyles('ax', AX_CSS);
