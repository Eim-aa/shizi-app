// 读屏 / 切换控制状态（阶段 0 B2，D36；03 P116）。
//
// 原生壳在 pageReady 之后和系统状态变化时（UIAccessibility.voiceOverStatusDidChangeNotification /
// switchControlStatusDidChangeNotification）调用 window.shiziAccessibilityStatus({voiceOver, switchControl})（布尔值；
// bridge.js 顶层同步定义、就绪前入队只留最后一次）。本模块注册实现并提供读取接口：
//   getAccessibilityStatus()    → {voiceOver, switchControl} 副本
//   assistiveTechActive()       → VoiceOver 或切换控制任一在运行
//   onAccessibilityStatus(fn)   → 状态变化时 fn(status)；返回取消订阅
// 不在原生壳内（浏览器 / PWA）永远是关：网页读不到系统读屏状态，保持旧行为。
// 现在只有跳过撤销条用它（write/skip.js：读屏运行时撤销条不自动收起）；用户可见的文字不在这里。
// 启动时由 app.js 在 markReady 之前导入（54-native-bridge 的时序约定：pageReady 前已有实现）。

import { registerNativeHandler } from './bridge.js';

let status = { voiceOver: false, switchControl: false };
const listeners = new Set();

/** 当前状态的副本。 */
export function getAccessibilityStatus() {
  return { ...status };
}

/** VoiceOver 或切换控制是否在运行。 */
export function assistiveTechActive() {
  return status.voiceOver || status.switchControl;
}

/** 订阅状态变化（fn(status)）；返回取消订阅。 */
export function onAccessibilityStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(next) {
  if (next.voiceOver === status.voiceOver && next.switchControl === status.switchControl) return;
  status = next;
  for (const fn of [...listeners]) {
    try {
      fn(getAccessibilityStatus());
    } catch (error) {
      console.warn('[shizi] accessibility listener failed:', error);
    }
  }
}

/** 原生 shiziAccessibilityStatus({voiceOver, switchControl}) 的实现：只有真正的 true 算开；变化时通知订阅者。返回 true（已接收）。 */
export function receiveAccessibilityStatus(info) {
  apply({ voiceOver: !!info && info.voiceOver === true, switchControl: !!info && info.switchControl === true });
  return true;
}

/** 测试用：回到全关。 */
export function resetAccessibilityStatus() {
  apply({ voiceOver: false, switchControl: false });
}

registerNativeHandler('shiziAccessibilityStatus', receiveAccessibilityStatus);
