// 子页外框：44px 页头（左 44×44 返回或关闭、中间标题 17px/500、右侧 44px 槽）+ 可滚动正文 + 可选底栏。
// 规格取原型 ShiziScreen 通用页头（reference/J-proto-screen.md「通用页头」）。
// 返回键只调用 onBack（默认 nav.back() → history.back()），页面栈变化由 router 的 popstate 处理。
// 左缘右滑返回（R4-G1，P270；R5-I2 / 交互规范 N3「左缘右滑 = 点左上，无例外」）：页头左上元素的动作登记给所在图层（ui/back-action.js），
// 滑动返回与点它做同一件事。左上换成自定义内容（判断页「‹ 接着写」）时登记它的 onLead，种类 'phase'（页内回退，D58 ①，推翻 P270 判断阶段门控）；
// 自定义 lead 没给 onLead 时退回出页动作——任何时候都不登记 null（只有 leading='none' 登记 null，留给没有上一层的画面）。
// TabPage：tab 根页的正文外框（无页头、大标题），tab 条由 ui/root.js 画。
import { html } from '../../../vendor/ui.js';
import { nav } from '../router.js';
import { useBackAction } from '../back-action.js';
import { Button } from './Button.js';
import { Icons } from './icons.js';
import { injectStyles, T } from './styles.js';
import { t } from '../../config/copy/index.js';

// 页头按钮的读屏文案（copy/common.js X-COMMON）。
export const PAGE_COPY = Object.freeze({
  back: t('X-COMMON.back'),
  close: t('X-COMMON.close'),
  leave: t('X-COMMON.leave'),
});

injectStyles('page', `
.sz-page{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;color:${T.ink1}}
.sz-page__head{position:relative;flex:none;box-sizing:border-box;min-height:44px;display:flex;align-items:center;
  justify-content:space-between;padding:env(safe-area-inset-top, 0px) ${T.gutter} 0}
.sz-page__title{flex:1 1 0;min-width:0;margin:0 ${T.s2};text-align:center;font-size:${T.fs17};
  font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none} /* 标题在两端槽之间的流里居中（两端槽同宽时就是屏幕正中）；页头尾端的文字按钮再宽也不会压在标题上（H1：「排序 · 筛选」） */
.sz-page__title:focus{outline:none}
/* 页头不显示标题、只留给读屏（结果页即作品，P1-E7；不用 :has()，iOS 15.4 才认） */
.sz-page__title--hidden{position:absolute;flex:none;left:auto;right:auto;margin:-1px;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.sz-page__center{flex:1 1 0;min-width:0;margin:0 ${T.s2};display:flex;align-items:center;justify-content:center;text-align:center;pointer-events:none} /* 页头中间的内容（写字页的进度「2 / 5」，A7）：和标题一样在两端槽之间居中 */
.sz-page__lead,.sz-page__trail{flex:none;position:relative;z-index:1;min-width:44px;min-height:44px;display:flex;align-items:center}
.sz-page__trail{justify-content:flex-end;font-size:${T.fs15};color:${T.ink2}}
/* 页边对齐（H1 / T2-01）：页头两端的可见字形外缘落在 20pt 线上。图标按钮 44 × 44 保持点击区，用负外边距把图标描边外缘对到边线：
   返回箭头（22 框、笔画 x 7.5 起，加描边半宽 → 距按钮左缘 17.75）、关闭 ×（20 框，16.25）、尾端分享图标（22 框，距按钮右缘 15.25）；
   文字按钮自带负外边距（Button.js --bx），计数等纯文字直接贴边。 */
.sz-page__lead .sz-page__ico--back{margin-left:-17.75px}
.sz-page__lead .sz-page__ico--close{margin-left:-16.25px}
.sz-page__trail .sz-btn--icon{margin-right:-15.25px}
.sz-page__body,.sz-page__foot,.sz-tabpage{text-spacing-trim:trim-start} /* 中文标点挤压：连续标点与行首开括号按全角半宽处理（H1 / 03 P224；iOS 26 WebKit 是否生效待真机核实） */
.sz-page__body{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  box-sizing:border-box;padding:${T.s4} ${T.gutter} ${T.s8};display:flex;flex-direction:column;gap:${T.groupGap}}
.sz-page__foot{flex:none;box-sizing:border-box;padding:${T.s3} ${T.gutter} max(${T.s6}, env(safe-area-inset-bottom, 0px)); /* 全 App 主按钮底线：主按钮下沿 = 屏底 − max(24, 下安全区)（规范 B2，审计 P1-15；= policy.mainButtonLine.gapAboveEdge） */
  display:flex;flex-direction:column;gap:${T.s3};background:${T.paper}}
.sz-tabpage{box-sizing:border-box;padding:calc(${T.s4} + env(safe-area-inset-top, 0px)) ${T.gutter} ${T.s8};display:flex;
  flex-direction:column;gap:${T.groupGap};color:${T.ink1}}
.sz-tabpage__title{margin:0;font-family:${T.song};font-size:${T.fs28};line-height:${T.lh28};font-weight:500;
  color:${T.ink1}}
.sz-tabpage__title:focus{outline:none}
`);

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
export const BACK_ICON = () => Icons.back();
const CLOSE_ICON = () => Icons.close();

/**
 * 页头左上元素对应的返回动作（纯函数，单测用）：{fn, kind}。
 * @param {{leading?:string, goBack:Function, lead?:any, onLead?:Function}} o
 */
export function pageBackAction({ leading = 'back', goBack, lead = null, onLead = null }) {
  if (lead) return typeof onLead === 'function' ? { fn: onLead, kind: 'phase' } : { fn: goBack, kind: 'page' };
  if (leading === 'none') return { fn: null, kind: 'page' };
  return { fn: goBack, kind: 'page' };
}

/**
 * @param {object} props
 * @param {string} [props.title]
 * @param {boolean} [props.hideTitle]  标题只给读屏、页头不显示（日常 / 首练结果页，作品就是标题）
 * @param {'back'|'close'|'none'} [props.leading]  页头左侧：返回箭头 / 关闭 X / 空
 * @param {() => void} [props.onBack]  默认 nav.back()；写字页等要先保存现场的页面自己传
 * @param {'back'|'leave'} [props.backLabel]  返回键的读屏名：缺省「返回」；页内有步骤（描一遍的两步圆点）而「‹」是整页离开时写「离开」（审计 P2-24）
 * @param {any} [props.lead]  页头左侧自定义内容（给了就替换返回 / 关闭键，例如判断页的「接着写」，M1-5）
 * @param {() => void} [props.onLead]  自定义 lead 的动作（同一个函数登记给左缘右滑，种类 'phase'：页内回退，N3-3）
 * @param {any} [props.center]  页头中间的内容（给了就占标题的位置，标题只留给读屏；写字页回忆阶段的进度，A7 / D57）
 * @param {any} [props.trailing]  页头右侧槽
 * @param {any} [props.footer]  底栏（主按钮等）
 * @param {string} [props.testid]
 */
export function Page({ title = '', hideTitle = false, leading = 'back', backLabel = 'back', onBack, lead: customLead = null, onLead = null, center = null, trailing = null, footer = null, testid, children }) {
  const goBack = () => (onBack ? onBack() : nav.back());
  const backAction = pageBackAction({ leading, goBack, lead: customLead, onLead });
  useBackAction(backAction.fn, backAction.kind);
  const lead = customLead ? customLead : leading === 'none'
    ? null
    : html`<${Button} variant="icon" class=${leading === 'close' ? 'sz-page__ico--close' : 'sz-page__ico--back'} data-testid="page-back" aria-label=${leading === 'close' ? PAGE_COPY.close : backLabel === 'leave' ? PAGE_COPY.leave : PAGE_COPY.back}
        onClick=${goBack}>${leading === 'close' ? CLOSE_ICON() : BACK_ICON()}</${Button}>`;
  return html`<div class="sz-page" data-testid=${testid}>
    <header class="sz-page__head">
      <span class="sz-page__lead">${lead}</span>
      <h1 class=${hideTitle || center ? 'sz-page__title sz-page__title--hidden' : 'sz-page__title'} tabindex="-1" data-page-title>${title}</h1>
      ${center ? html`<span class="sz-page__center">${center}</span>` : null}
      <span class="sz-page__trail">${trailing}</span>
    </header>
    <div class="sz-page__body">${children}</div>
    ${footer ? html`<div class="sz-page__foot">${footer}</div>` : null}
  </div>`;
}

export function TabPage({ title = '', testid, children }) {
  return html`<section class="sz-tabpage" data-testid=${testid}>
    <h1 class="sz-tabpage__title" tabindex="-1" data-page-title>${title}</h1>
    ${children}
  </section>`;
}
