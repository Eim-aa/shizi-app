// 触觉（01-架构设计 §8.1 `haptic`；02 M5-5；reference/F-platform §3.1 / §4.1、D-flow §支撑）。
//
// 种类沿旧版五档（639f592 index.html L1377–L1380；WebViewController playHaptic）：
//   stamp（判断落定，Impact medium）、undo（撤销，Impact light）、action（过程完成，Impact light）、
//   select（选择切换，Selection）、milestone（Notification success；P08 里程碑已删，没有触发点，保留档位给原生兼容）。
// 原生壳内：postNative('haptic', {kind})；浏览器 / PWA：只有 stamp 在支持 navigator.vibrate 的设备上震 10ms（沿旧；
// iOS Safari 没有 vibrate，静默）。未知种类忽略。
//
// 触发点（旧版调用点按第十稿流程挪到对应的 store.commit；commit 成功才发，失败三段式不发）：
//   write:judge          「写对了 / 写错了」判断落定           stamp + 判断声 judge（P24 / P200） 旧 pickStamp L2639
//   write:correct        写字页结果行「修改判断」改成功         stamp + 按键音 judge          旧重盖后再盖 L2624/L2639
//   result:correct       结果页对照弹层「改为…」改成功          stamp + 按键音 judge          同上
//   hint                 提示（给出下一笔）                     select                        旧 #tip L2558 / 长按 L2546
//   write:answer-seen    「看答案」确认后                        action                        旧 revealAnswer L2598
//   write:answer-trace   进入「描一遍」                          select                        旧 openTracingTeaching L2603
//   write:skip-undo      跳过的 3 秒撤销                        undo                          旧重盖 undo L2624
//   result:skip-undo     结果页上撤销最后一字的跳过             undo                          同上
//   result:finish        写完最后一字、结果页出现               action                        旧 roundSummary 落章 L2717
//   write:end            「结束这组」确认（有判断时换成结果页） action                        同上
// 声音（S1，D50 ⑦）：判断类 commit 同时发判断声 j1；书写与描红不出声（没有 trace-stroke 点位）；落款盖章声不是 commit，
// 由结果页 WorkSection 在作品出现时直接调 sound.js keySound('seal')。
// 这张表是 M5-5 按旧版点位的过渡映射（第十稿没给触觉规格），已登记待定。
//
// 接线：installCommitFeedback(getStore) 在写字页 / 结果页挂载时调用（幂等：同一个 store 只订阅一次）；
// 订阅 store 的 {type:'commit', label} 通知，按上表发触觉与按键音。

import { bridge } from './bridge.js';
import { keySound } from './sound.js';

export const HAPTIC_KINDS = Object.freeze(['stamp', 'undo', 'action', 'select', 'milestone']);

/** commit label → {haptic?, sound?}（sound 是 policy.keySoundEvents 里的事件名）。 */
export const COMMIT_FEEDBACK = Object.freeze({
  'write:judge': Object.freeze({ haptic: 'stamp', sound: 'judge' }),
  'write:correct': Object.freeze({ haptic: 'stamp', sound: 'judge' }),
  'result:correct': Object.freeze({ haptic: 'stamp', sound: 'judge' }),
  hint: Object.freeze({ haptic: 'select' }),
  'write:answer-seen': Object.freeze({ haptic: 'action' }),
  'write:answer-trace': Object.freeze({ haptic: 'select' }),
  'write:skip-undo': Object.freeze({ haptic: 'undo' }),
  'result:skip-undo': Object.freeze({ haptic: 'undo' }),
  'result:finish': Object.freeze({ haptic: 'action' }),
  'write:end': Object.freeze({ haptic: 'action' }),
});

const LOG_CAP = 30;
const log = [];

/** 最近发出的触觉（旧版 hapticDebug.events 的等价物；测试与诊断用）。 */
export function hapticLog() {
  return log.slice();
}

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/**
 * 发一次触觉。返回 'native' | 'vibrate' | false。
 * @param {string} kind  HAPTIC_KINDS 之一
 * @param {{bridge?:object, win?:object}} [o]  测试注入
 */
export function haptic(kind, { bridge: b = bridge, win = globalWin() } = {}) {
  if (HAPTIC_KINDS.indexOf(kind) < 0) return false;
  log.push(kind);
  if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
  if (b && b.postNative('haptic', { kind })) return 'native';
  if (kind !== 'stamp') return false;
  try {
    const nav = win && win.navigator;
    if (nav && typeof nav.vibrate === 'function') {
      nav.vibrate(10);
      return 'vibrate';
    }
  } catch (error) {
    // vibrate 被策略拦下时静默
  }
  return false;
}

/** store 通知 → 要发的反馈（没有返回 null）。只认成功的 commit。 */
export function feedbackFor(info) {
  if (!info || info.type !== 'commit' || typeof info.label !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(COMMIT_FEEDBACK, info.label) ? COMMIT_FEEDBACK[info.label] : null;
}

/** 按一条 store 通知发触觉与判断声；state 是通知带来的新状态（声音读 settings.sound，关着只发触觉）。 */
export function applyFeedback(info, state, deps = {}) {
  const fb = feedbackFor(info);
  if (!fb) return null;
  const out = { haptic: false, sound: false };
  try {
    if (fb.haptic) out.haptic = (deps.haptic || haptic)(fb.haptic);
    if (fb.sound) out.sound = (deps.keySound || keySound)(fb.sound, { state });
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('[shizi] feedback failed:', error);
  }
  return out;
}

let installed = null; // {store, off}

/**
 * 订阅 store 的 commit 通知发反馈（幂等：同一个 store 只订阅一次；换了 store 则改订新的）。
 * @param {() => object} getStore  返回 store；store 还没建好（抛错）时什么都不做，下次再试
 * @returns {boolean} 现在是否已订阅
 */
export function installCommitFeedback(getStore) {
  let store = null;
  try {
    store = typeof getStore === 'function' ? getStore() : getStore;
  } catch (error) {
    store = null;
  }
  if (!store || typeof store.subscribe !== 'function') return false;
  if (installed && installed.store === store) return true;
  if (installed) installed.off();
  const off = store.subscribe((state, info) => applyFeedback(info, state));
  installed = { store, off };
  return true;
}

/** 测试：取消订阅并清日志。 */
export function resetCommitFeedback() {
  if (installed) installed.off();
  installed = null;
  log.length = 0;
}
