// 子页外框：44px 页头（左 44×44 返回或关闭、中间标题 17px/500、右侧 44px 槽）+ 可滚动正文 + 可选底栏。
// 规格取原型 ShiziScreen 通用页头（reference/J-proto-screen.md「通用页头」）。
// 返回键只调用 onBack（默认 nav.back() → history.back()），页面栈变化由 router 的 popstate 处理。
// TabPage：tab 根页的正文外框（无页头、大标题），tab 条由 ui/root.js 画。
import { html } from '../../../vendor/ui.js';
import { nav } from '../router.js';
import { Button } from './Button.js';
import { injectStyles, T } from './styles.js';
import { t } from '../../config/copy/index.js';

// 页头按钮的读屏文案（copy/common.js X-COMMON）。
export const PAGE_COPY = Object.freeze({
  back: t('X-COMMON.back'),
  close: t('X-COMMON.close'),
});

injectStyles('page', `
.sz-page{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;color:${T.i1}}
.sz-page__head{position:relative;flex:none;box-sizing:border-box;min-height:44px;display:flex;align-items:center;
  justify-content:space-between;padding:env(safe-area-inset-top, 0px) 8px 0}
.sz-page__title{position:absolute;left:56px;right:56px;margin:0;text-align:center;font-size:calc(17px * ${T.k});
  font-weight:500;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.sz-page__title:focus{outline:none}
.sz-page__lead,.sz-page__trail{position:relative;z-index:1;min-width:44px;min-height:44px;display:flex;align-items:center}
.sz-page__trail{justify-content:flex-end;padding-right:4px;font-size:calc(15px * ${T.k});color:${T.i2}}
.sz-page__body{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  box-sizing:border-box;padding:14px 24px 32px;display:flex;flex-direction:column;gap:24px}
.sz-page__foot{flex:none;box-sizing:border-box;padding:12px 24px max(20px, env(safe-area-inset-bottom, 0px));
  display:flex;flex-direction:column;gap:12px;background:${T.p}}
.sz-tabpage{box-sizing:border-box;padding:calc(14px + env(safe-area-inset-top, 0px)) 24px 32px;display:flex;
  flex-direction:column;gap:26px;color:${T.i1}}
.sz-tabpage__title{margin:0;font-family:${T.serif};font-size:calc(26px * ${T.k});line-height:1.4;font-weight:500;
  color:${T.i1}}
.sz-tabpage__title:focus{outline:none}
`);

const BACK_ICON = html`<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor"
  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M13.5 5 7.5 11l6 6"></path></svg>`;
const CLOSE_ICON = html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"
  stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 5l10 10M15 5 5 15"></path></svg>`;

/**
 * @param {object} props
 * @param {string} [props.title]
 * @param {'back'|'close'|'none'} [props.leading]  页头左侧：返回箭头 / 关闭 X / 空
 * @param {() => void} [props.onBack]  默认 nav.back()；写字页等要先保存现场的页面自己传
 * @param {any} [props.lead]  页头左侧自定义内容（给了就替换返回 / 关闭键，例如判断页的「接着写」，M1-5）
 * @param {any} [props.trailing]  页头右侧槽
 * @param {any} [props.footer]  底栏（主按钮等）
 * @param {string} [props.testid]
 */
export function Page({ title = '', leading = 'back', onBack, lead: customLead = null, trailing = null, footer = null, testid, children }) {
  const goBack = () => (onBack ? onBack() : nav.back());
  const lead = customLead ? customLead : leading === 'none'
    ? null
    : html`<${Button} variant="icon" data-testid="page-back" aria-label=${leading === 'close' ? PAGE_COPY.close : PAGE_COPY.back}
        onClick=${goBack}>${leading === 'close' ? CLOSE_ICON : BACK_ICON}</${Button}>`;
  return html`<div class="sz-page" data-testid=${testid}>
    <header class="sz-page__head">
      <span class="sz-page__lead">${lead}</span>
      <h1 class="sz-page__title" tabindex="-1" data-page-title>${title}</h1>
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
