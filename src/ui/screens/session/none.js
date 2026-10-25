// 「现在没有要写的字」页（R-H11；C188–C191；10.7；C067；原型可点原型模板 L56–L64 w12f、ShiziScreen noChars L125–L127）。
//
// 开今天的练习时选不出字（core/session-start.startDaily → {empty}）就推入这一页（不开组、不写入）。
// 版式沿原型 w12f：页头「习字」+「‹」（推入页一律「‹」，D58 ④ / 交互规范 N2；原为关闭 ×）；中间是全 App 唯一的空状态（components/EmptyState.js，规范 S2，审计 P2-22：空格子、标题、说明，「看写错过的字 ›」是它的操作）；
// 底部主按钮「自己选字」。D58 ④ 去掉「回到首页 ›」：它与「‹」做的事不同（从字库进来时一个回字库一个去首页），出口只留左上「‹」（文案键 R-H11.backHome 暂留在 copy 未用）。当前练习范围的字都有记录了（params.exhausted）时加次入口：「可以换一个字库，或者先练写错过的字。」
// 「看写错过的字 ›」（R-H11 noChars；两态是否同一页见 04 §6.2——过渡：同一页，次入口按 exhausted 显示）。
//
// 「自己选字」（M2-0 查字组件 pick 模式）、「看写错过的字」（M3-2）与「更换字库」（M3-5）由拥有它们的卡注册：
// setNoneActions({pick, wrongList, libSwitch})；没注册的入口不显示（不放点了没反应的按钮）。
// 字库写完（exhausted）时主按钮是「更换字库」（原型 noChars L125–L127：主按钮 更换字库 → libSwitch、链接 看写错过的字 ›；
// P83），「自己选字」降为次按钮；其余情形主按钮仍是「自己选字」。
//
// B3.12 原生化：这一屏可以由原生显示（registerScreen 的 native:true；原生类 ShiziScreen_session_none，
// ios/ShiziApp/ShiziApp/Screens/SessionNone.swift）。原生渲染用的是同一份模型（session/views/session.js noneView）与同一组登记的入口
// （session/api/session.js setNoneActions——网页模块把**同一个函数对象**登记进来，网页路径 == API 路径）。
//
// data-testid：session-none、session-none-cell、session-none-title、session-none-body、session-none-nochars、
//              session-none-libswitch、session-none-pick、session-none-wrong。

import { html } from '../../../../vendor/ui.js';
import { registerScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { EmptyState } from '../../components/EmptyState.js';
// 量网页的折行点（空状态的段落）：本模块加载时把「量」的实现登记进会话层（src/session/views/lines.js 的槽位）。
import '../../components/lines.js';
import { t, tRef } from '../../../config/copy/index.js';
import { setNoneActions, noneActions } from '../../../session/api/session.js';
import { noneView } from '../../../session/views/session.js';

export const NONE_SCREEN = 'session-none';

// 入口的登记放在会话层（原生与网页共用一份）：本模块转出去，别处（首页 / 字库清单 / 换库页）照旧从这里 import。
export { setNoneActions };


function NoneScreen({ params }) {
  const exhausted = !!(params && params.exhausted);
  const actions = noneActions();
  // 网页与原生渲染的是同一份模型（session/views/session.js noneView）：网页路径 == API 路径。
  const model = noneView({
    exhausted,
    pick: !!actions.pick,
    wrongList: !!actions.wrongList,
    libSwitch: !!actions.libSwitch,
  });
  // 模型给的是入口的名字（pick / libSwitch / wrongList），动作是登记进来的那一个函数对象。
  const go = to => {
    const fn = actions[to];
    if (typeof fn === 'function') fn();
  };
  const footer = html`
    ${model.primary ? html`<${Button} variant="primary" data-testid=${model.primary.to === 'libSwitch' ? 'session-none-libswitch' : 'session-none-pick'} onClick=${() => go(model.primary.to)}>${tRef(model.primary.label)}</${Button}>` : null}
    ${model.secondary ? html`<${Button} variant="secondary" data-testid="session-none-pick" onClick=${() => go(model.secondary.to)}>${tRef(model.secondary.label)}</${Button}>` : null}`;
  return html`<${Page} title=${tRef(model.title)} footer=${model.primary || model.secondary ? footer : null} testid="session-none">
    ${EmptyState({
      title: tRef(model.empty.title), body: [...model.empty.body, ...model.empty.extra].map(tRef), attrs: { 'data-exhausted': model.exhausted ? 'true' : 'false' },
      action: model.empty.action ? { label: tRef(model.empty.action.label), onClick: () => go(model.empty.action.to), testid: 'session-none-wrong' } : null,
      testids: { root: 'session-none-body-wrap', cell: 'session-none-cell', title: 'session-none-title', body: 'session-none-body', extra: ['session-none-nochars'] },
    })}
  </${Page}>`;
}

// B3.12：这一屏可以由原生显示（原生有 ShiziScreen_session_none 类且开关打开时，root.js 画成原生宿主）。
registerScreen(NONE_SCREEN, NoneScreen, { label: t('R-H11.title'), native: true });

/** 推入「现在没有要写的字」页。 */
export function openNonePage({ exhausted = false } = {}) {
  nav.push(NONE_SCREEN, { exhausted: !!exhausted });
}
