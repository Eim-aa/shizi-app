// 查字 / 自己选字组件入口（M2-0；决定-D21；R-H06 首页「自己选字」、M3-3 字库查字框共用）。
//
//   openQuery({mode, onPick, onPractice, onDetail, text}) → {id, close()}
//     mode：'lookup'（查字）| 'pick'（自己选字）；其余模式抛错（P42 policy.queryModes）。
//     onPick(chars, api)：pick 底栏「练这 N 个字 / 练这个字」；卡片「练这个字」在没有 onPractice 时也走它（chars = [字]）。
//     onPractice(char, api)：卡片「练这个字」。
//     onDetail(char, api)：卡片「查看记录」（单字详情 M3-6 接入前不传 → 按钮置灰）。
//     api = {close(), mode}。回调返回（或 resolve 成）{ok:false} 时弹层就地显示 R-H06 三段式、保留输入；其余返回值忽略。
//     开 B 会话、S02、跳转写字页都由调用方做；弹层不关，调用方需要时 api.close()（R-Q07：练完返回回到弹层）。
//   **必须在用户点击的事件处理里同步调用**：这里同步聚焦代理输入框让 iOS 弹键盘（R-Q08，见 input.js）。
//
// 测试宿主（?test=1 且本机）另注册开发路由 'query-demo'（demo.js），e2e scripts/e2e/20-query.spec.js 用；生产形态不加载。

import { nav } from '../../router.js';
import { isTestHost } from '../../../platform/env.js';
import { normalizeMode } from '../../../core/query.js';
import { QuerySheet } from './QuerySheet.js';
import { focusProxyInput } from './input.js';

export { QuerySheet } from './QuerySheet.js';
export { CharRow } from './CharRow.js';
export { CharCard, BadCard } from './CharCard.js';

export const QUERY_OVERLAY = 'query';

/**
 * 打开查字 / 自己选字弹层。见文件头。
 * @returns {{id:string, close: () => void}}
 */
export function openQuery({ mode = 'lookup', onPick, onPractice, onDetail, text = '' } = {}) {
  const m = normalizeMode(mode);
  const opener = typeof document !== 'undefined' ? document.activeElement : null;
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

if (isTestHost()) {
  import('./demo.js').catch(error => console.error('[shizi] query demo failed to load:', error));
}
