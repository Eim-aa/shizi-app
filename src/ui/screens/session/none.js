// 「现在没有要写的字」页（R-H11；C188–C191；10.7；C067；原型可点原型模板 L56–L64 w12f、ShiziScreen noChars L125–L127）。
//
// 开今天的练习时选不出字（core/session-start.startDaily → {empty}）就推入这一页（不开组、不写入）。
// 版式沿原型 w12f：页头「习字」+ 关闭；中间一个空格子（去掉装饰大字「待」，只留空格子）、标题、说明；底部主按钮「自己选字」
// 与「回到首页 ›」。当前练习范围的字都有记录了（params.exhausted）时加次入口：「可以换一个字库，或者先练写错过的字。」
// 「看写错过的字 ›」（R-H11 noChars；两态是否同一页见 04 §6.2——过渡：同一页，次入口按 exhausted 显示）。
//
// 「自己选字」（M2-0 查字组件 pick 模式）、「看写错过的字」（M3-2）与「更换字库」（M3-5）由拥有它们的卡注册：
// setNoneActions({pick, wrongList, libSwitch})；没注册的入口不显示（不放点了没反应的按钮）。
// 字库写完（exhausted）时主按钮是「更换字库」（原型 noChars L125–L127：主按钮 更换字库 → libSwitch、链接 看写错过的字 ›；
// P83），「自己选字」降为次按钮；其余情形主按钮仍是「自己选字」。
//
// data-testid：session-none、session-none-cell、session-none-title、session-none-body、session-none-nochars、
//              session-none-libswitch、session-none-pick、session-none-wrong、session-none-home。

import { html } from '../../../../vendor/ui.js';
import { registerScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';

export const NONE_SCREEN = 'session-none';

const actions = { pick: null, wrongList: null, libSwitch: null };

/** 注册「自己选字」「看写错过的字」「更换字库」的去处（M2-1 / M2-0 / M3-2 / M3-5 调用）；传 null 取消。 */
export function setNoneActions(next) {
  if (!next || typeof next !== 'object') return;
  if ('pick' in next) actions.pick = typeof next.pick === 'function' ? next.pick : null;
  if ('wrongList' in next) actions.wrongList = typeof next.wrongList === 'function' ? next.wrongList : null;
  if ('libSwitch' in next) actions.libSwitch = typeof next.libSwitch === 'function' ? next.libSwitch : null;
}

injectStyles('session-none', `
.sz-none{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:0 16px;
  text-align:center}
.sz-none__cell{width:88px;height:88px;box-sizing:border-box;border:${T.frameW} solid ${T.frame}}
.sz-none__title{margin:0;font-family:${T.song};font-size:${T.fs22};font-weight:500;color:${T.ink1}}
.sz-none__body{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-none__home{align-self:center;justify-content:center}
`);

function NoneScreen({ params }) {
  const exhausted = !!(params && params.exhausted);
  const pick = actions.pick;
  const wrongList = actions.wrongList;
  const libSwitch = exhausted ? actions.libSwitch : null;
  const footer = html`
    ${libSwitch ? html`<${Button} variant="primary" data-testid="session-none-libswitch" onClick=${() => libSwitch()}>${t('X-SESSION.noneLibSwitch')}</${Button}>` : null}
    ${pick ? html`<${Button} variant=${libSwitch ? 'secondary' : 'primary'} data-testid="session-none-pick" onClick=${() => pick()}>${t('X-SESSION.nonePick')}</${Button}>` : null}
    <${Button} variant="text" class="sz-none__home" data-testid="session-none-home"
      onClick=${() => nav.switchTab('home')}>${t('R-H11.backHome')}</${Button}>`;
  return html`<${Page} title=${t('X-TABS.write')} leading="close" footer=${footer} testid="session-none">
    <div class="sz-none" data-exhausted=${exhausted ? 'true' : 'false'}>
      <span class="sz-none__cell" aria-hidden="true" data-testid="session-none-cell"></span>
      <h2 class="sz-none__title" data-testid="session-none-title">${t('R-H11.title')}</h2>
      <p class="sz-none__body" data-testid="session-none-body">${t('R-H11.body')}</p>
      ${exhausted ? html`<p class="sz-none__body" data-testid="session-none-nochars">${t('R-H11.noCharsBody')}</p>` : null}
      ${exhausted && wrongList ? html`<${Button} variant="text" data-testid="session-none-wrong"
        onClick=${() => wrongList()}>${t('R-H11.noCharsLink')}</${Button}>` : null}
    </div>
  </${Page}>`;
}

registerScreen(NONE_SCREEN, NoneScreen, { label: t('R-H11.title') });

/** 推入「现在没有要写的字」页。 */
export function openNonePage({ exhausted = false } = {}) {
  nav.push(NONE_SCREEN, { exhausted: !!exhausted });
}
