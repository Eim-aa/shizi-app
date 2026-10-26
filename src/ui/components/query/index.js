// 查字 / 自己选字组件入口（M2-0；决定-D21；R-H06 首页「自己选字」、M3-3 字库查字框共用）。
//
//   openQuery({mode, onPick, onPractice, onDetail, text}) → {id, close()}
//     mode：'lookup'（查字）| 'pick'（自己选字）；其余模式抛错（P42 policy.queryModes）。
//     onPick(chars, api)：pick 底栏「练这 N 个字 / 练这个字」；卡片「练这个字」（没有 onPractice 时也走它，chars = [字]）。
//     onPractice(char, api)：卡片「练这个字」。
//     onDetail(char, api)：卡片「查看记录」（单字详情 M3-6 接入前不传 → 按钮置灰）。
//     api = {close(), mode}。回调返回（或 resolve 成）{ok:false} 时弹层就地显示 R-H06 三段式、保留输入；其余返回值忽略。
//     开 B 会话、S02、跳转写字页都由调用方做；弹层不关，调用方需要时 api.close()（R-Q07：练完返回回到弹层）。
//   **必须在用户点击的事件处理里同步调用**（网页版）：这里同步聚焦代理输入框让 iOS 弹键盘（R-Q08，见 input.js）。
//
// B3.6 原生化：原生壳内（原生有 ShiziScreen_query 类时）查字弹层由原生画——它是一屏（路由里的 'query'），
//   动作经 App API 回调（query.pick / query.detail，src/session/api/query.js）；网页这一侧只登记回调、不画弹层。
//   网页版（原生开关关着）行为一字不变：仍是遮罩栈里的弹层。

import { html } from '../../../../vendor/ui.js';
import { getRouter, nav, registerScreen } from '../../router.js';
import { isTestHost } from '../../../platform/env.js';
import { normalizeMode } from '../../../core/query.js';
import { QuerySheet } from './QuerySheet.js';
import { focusProxyInput } from './input.js';
import { cardActionLineStarts } from './layout.js';
import { nativeScreenOn } from '../../native-stage.js';
import { setQueryActions, setQueryLayout } from '../../../session/api/query.js';

export { QuerySheet } from './QuerySheet.js';
export { CharRow } from './CharRow.js';
export { CharCard, BadCard } from './CharCard.js';

export const QUERY_OVERLAY = 'query';
/** 原生查字弹层的屏名（与 Swift 的 ShiziScreen_query 一一对应）。 */
export const QUERY_SCREEN = 'query';

/**
 * 打开查字 / 自己选字弹层。见文件头。
 * @returns {{id:string, close: () => void}}
 */
export function openQuery({ mode = 'lookup', onPick, onPractice, onDetail, text = '', selected = [], composing = false } = {}) {
  const m = normalizeMode(mode);
  const opener = typeof document !== 'undefined' ? document.activeElement : null;
  if (nativeScreenOn(QUERY_SCREEN)) {
    // 原生弹层（B3.6）：推入一屏原生宿主；回调登记在会话层，原生经 query.pick / query.detail 调用（网页路径 == API 路径）。
    // text / selected / composing = 弹层的初始状态（输入原文、预选字、输入法组字中——原生弹层没有网页的输入框可点）。
    setQueryActions({ onPick, onPractice, onDetail, mode: m, close: closeNativeQuery });
    // 卡片次要键的折行点（网页量的；原生按这些位置换行）。
    setQueryLayout({ cardAction: cardActionLineStarts });
    nav.push(QUERY_SCREEN, {
      mode: m,
      text: typeof text === 'string' ? text : '',
      selected: Array.isArray(selected) ? selected.filter(c => typeof c === 'string') : [],
      composing: composing === true,
    });
    return { id: QUERY_SCREEN, close: closeNativeQuery };
  }
  focusProxyInput(); // 同一个点击事件里同步 focus（R-Q08）
  const id = nav.openOverlay(QuerySheet, {
    mode: m,
    onPick,
    onPractice,
    onDetail,
    initialText: typeof text === 'string' ? text : '',
    opener,
  }, { name: QUERY_OVERLAY });
  return { id, close: () => nav.closeOverlay(id) };
}

/**
 * 收起原生查字屏（= 网页版 nav.closeOverlay）：它在栈顶时出栈（宿主卸载 → 原生收起）。回调里的 api.close() 走这里——
 * 与网页版同一时序：先关弹层，再开 S02 / 写字页（不然出栈的会是后推入的那一页）。
 */
function closeNativeQuery() {
  const router = getRouter();
  const top = router ? router.getState().top : null;
  if (top && top.n === QUERY_SCREEN) nav.back();
}

// 原生弹层那一屏的网页兜底（原生开关关着时万一被推入）：画网页版弹层。
function QueryFallback(p) {
  const params = (p && p.params) || {};
  return html`<${QuerySheet} mode=${params.mode === 'pick' ? 'pick' : 'lookup'} initialText=${params.text || ''} active=${false} />`;
}

registerScreen(QUERY_SCREEN, QueryFallback, { native: true });

if (isTestHost()) {
  import('./demo.js').catch(error => console.error('[shizi] query demo failed to load:', error));
}
