// 原生分享 / 外链失败的页内轻提示（03 P96 过渡，M6-6；02 §8「M5 遗留：桥错误回调」）。
//
// M5-3 删除原生 alert 后，iOS 壳里分享面板没打开（临时文件写不进、图片数据不对、分享面板报错）或外链打不开时变成静默。
// 现在原生调用 window.shiziShareFailed({kind, reason})（bridge.js 顶层定义、就绪前入队），本模块注册实现：按 kind 取 X-SHARE
// 文案发一条轻提示（role=status，aria-live=polite）。文案在 Web 侧（05 评审「Swift 不含面向用户文案」）。
//   kind   backup（备份文件分享）| card（图片分享）| link（外链）；其他值用通用句。
//   reason write | payload | activity | refused | open —— 只作诊断，不进文案。
// 用户在分享面板里取消不算失败，原生不回调。备份页用 onShareFailed 清掉等待中的导出记账（没有导出就不记）。
// 由 ui/screens/mine/backup.js 导入（启动时随 root 加载），pageReady 之前已注册（54-native-bridge 的时序约定）。

import { registerNativeHandler } from '../../platform/bridge.js';
import { showToast } from './Toast.js';
import { t } from '../../config/copy/index.js';

export const SHARE_FAILED_KEYS = Object.freeze({
  backup: 'X-SHARE.backupFailed',
  card: 'X-SHARE.cardFailed',
  link: 'X-SHARE.linkFailed',
});
export const SHARE_FAILED_GENERIC = 'X-SHARE.failed';

const listeners = new Set();

/** 某种失败对应的提示句（未知 kind → 通用句）。 */
export function shareFailedText(kind) {
  return t(Object.prototype.hasOwnProperty.call(SHARE_FAILED_KEYS, kind) ? SHARE_FAILED_KEYS[kind] : SHARE_FAILED_GENERIC);
}

/** 订阅失败回调（fn(kind, info)）；返回取消订阅。 */
export function onShareFailed(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 原生 shiziShareFailed({kind, reason}) 的实现：通知订阅者；有订阅者在屏上就地给了三段式（返回 true：图片预览、备份页还开着）就到此为止，
 * 否则（失败的地方已经不在屏上，F3 ①）发一条失败提示条。返回 true（已接收）。
 */
export function receiveShareFailed(info) {
  const kind = info && typeof info.kind === 'string' ? info.kind : '';
  let shown = false;
  for (const fn of [...listeners]) {
    try {
      if (fn(kind, info || null) === true) shown = true;
    } catch (error) {
      console.warn('[shizi] shareFailed listener failed:', error);
    }
  }
  if (!shown) showToast(shareFailedText(kind), { kind: 'failure' });
  return true;
}

registerNativeHandler('shiziShareFailed', receiveShareFailed);
