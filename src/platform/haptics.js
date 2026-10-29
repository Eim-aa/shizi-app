// 触觉（01-架构设计 §8.1 `haptic`；交互与动效规范 F1，D58 ③；审计 P1-34 / P1-35）。
//
// 五档（tokens.json haptic，config/motion.js M.haptic；原生 WebViewController.swift playHaptic 参数由 test/ios-haptic.test.mjs 逐值核对）：
//   judge  UIImpactFeedbackGenerator(.soft) intensity 0.7   判断落定「写对了 / 写错了」、修改判断成功（两种判断完全相同）
//   seal   .rigid 0.8                                     结果页印着纸那一帧（全 App 只此一处，result/work.js sealMoment，与 s1 同帧）
//   light  .light 0.5                                     「写好了」书写格开始收缩；看答案显影；结束这组确认（有判断、换成结果页时）
//   select UISelectionFeedbackGenerator                   推进与切换：下一个、跳过、撤销跳过、进入描一遍、自己写、提示显影
//   none   —                                              书写、撤销一笔、清空、返回 / 推入 / 切 Tab、开关、成功保存、失败、冷启动恢复
// 旧档名（stamp → judge、action / undo → light，撤销跳过改 select、milestone 删除）不再发出；原生仍认旧名一个版本（过渡）。
// 规则（F1）：会写记录的操作 commit 成功后发（失败三段式不发，再试成功时补发——还是这一次 commit）；不写记录的操作随用户动作发；
// 一次用户动作 ≤ 1 次触觉；只属于写字流程（写字页、结果页）；减少动态效果下照发。
// 原生壳内：postNative('haptic', {kind})；浏览器 / PWA：只有 judge 在支持 navigator.vibrate 的设备上震 10ms（iOS Safari 没有 vibrate，静默）。未知种类忽略。
//
// commit 触发点（COMMIT_FEEDBACK，commit 成功才发）：
//   write:judge / write:correct / result:correct   judge + 判断声 j1（P24 / P200）
//   hint                                           select（提示显影）
//   write:answer-seen / write:answer-answer        light（看答案显影）
//   write:answer-trace                             select（进入描一遍）
//   write:answer-retrace                           select（自己写）
//   write:answer-next                              select（下一个）
//   write:skip                                     select（跳过）
//   write:skip-undo / result:skip-undo             select（撤销跳过）
// 不写记录 / 要看结果的点位由页面直接调 haptic()：「写好了」light（write/index.js onDone）；结束这组 light（write/end.js，只在有判断、换成结果页时；
// 零判断回来源不发——那里已不是写字流程，P1-35）；落印 seal（result/work.js）。
// 声音（F2，D50 ⑦）：判断类 commit 同时发判断声 j1；落印 s1 由结果页在印着纸那一帧直接调。
//
// 引擎模式（iOS 壳，网页界面不挂）：engine.js mountEngine 启动时调 installCommitFeedback(getStore, {haptics:false}) 一次——
// 声音（j1 轮换）由 JS 决定变体、原生只播（postNative('sound')）；触觉原生页自己发，这里不发，避免双震。
// 接线：installCommitFeedback(getStore) 在写字页 / 结果页挂载时调用（幂等：同一个 store 只订阅一次）；
// 订阅 store 的 {type:'commit', label} 通知，按上表发触觉与按键音。

import { bridge } from './bridge.js';
import { keySound } from './sound.js';
import { M } from '../config/motion.js';

/** F1 的四档（none 不发）。顺序即 tokens.json haptic 的顺序。 */
export const HAPTIC_KINDS = Object.freeze(['judge', 'seal', 'light', 'select']);
/** 每档的原生参数（tokens.json haptic；原生 playHaptic 逐值一致）。 */
export const HAPTIC_SPEC = M.haptic;

/** commit label → {haptic?, sound?}（sound 是 policy.keySoundEvents 里的事件名）。 */
export const COMMIT_FEEDBACK = Object.freeze({
  'write:judge': Object.freeze({ haptic: 'judge', sound: 'judge' }),
  'write:correct': Object.freeze({ haptic: 'judge', sound: 'judge' }),
  'result:correct': Object.freeze({ haptic: 'judge', sound: 'judge' }),
  hint: Object.freeze({ haptic: 'select' }),
  'write:answer-seen': Object.freeze({ haptic: 'light' }),
  'write:answer-answer': Object.freeze({ haptic: 'light' }),
  'write:answer-trace': Object.freeze({ haptic: 'select' }),
  'write:answer-retrace': Object.freeze({ haptic: 'select' }),
  'write:answer-next': Object.freeze({ haptic: 'select' }),
  'write:skip': Object.freeze({ haptic: 'select' }),
  'write:skip-undo': Object.freeze({ haptic: 'select' }),
  'result:skip-undo': Object.freeze({ haptic: 'select' }),
});

const LOG_CAP = 30;
const log = [];
const logTimes = [];

/** 最近发出的触觉（旧版 hapticDebug.events 的等价物；测试与诊断用）。 */
export function hapticLog() {
  return log.slice();
}

/** 与 hapticLog() 一一对应的发出时刻（performance.now()，ms；e2e 核对「触觉与 s1 同一帧」用）。 */
export function hapticTimes() {
  return logTimes.slice();
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
  logTimes.push(typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
  if (log.length > LOG_CAP) {
    log.splice(0, log.length - LOG_CAP);
    logTimes.splice(0, logTimes.length - LOG_CAP);
  }
  if (b && b.postNative('haptic', { kind })) return 'native';
  if (kind !== 'judge') return false;
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

/** 按一条 store 通知发触觉与判断声。 */
export function applyFeedback(info, state, deps = {}) {
  const fb = feedbackFor(info);
  if (!fb) return null;
  const out = { haptic: false, sound: false };
  try {
    if (fb.haptic) out.haptic = (deps.haptic || haptic)(fb.haptic);
    if (fb.sound) out.sound = (deps.keySound || keySound)(fb.sound);
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
export function installCommitFeedback(getStore, { haptics = true } = {}) {
  let store = null;
  try {
    store = typeof getStore === 'function' ? getStore() : getStore;
  } catch (error) {
    store = null;
  }
  if (!store || typeof store.subscribe !== 'function') return false;
  if (installed && installed.store === store && installed.haptics === haptics) return true;
  if (installed) installed.off();
  // haptics:false（引擎模式）：触觉原生自己发（每个点位一次，B3.Z-f 探针核对），这里只发判断声 j1；轮换规则仍只在 sound.js。
  const deps = haptics ? {} : { haptic: () => false };
  const off = store.subscribe((state, info) => applyFeedback(info, state, deps));
  installed = { store, off, haptics };
  return true;
}

/** 测试：取消订阅并清日志。 */
export function resetCommitFeedback() {
  if (installed) installed.off();
  installed = null;
  log.length = 0;
  logTimes.length = 0;
}
