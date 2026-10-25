import { bridge as defaultBridge } from './bridge.js';
import { now as envNow } from './env.js';
import * as defaultPolicy from '../config/policy.js';
import { t } from '../config/copy/index.js';
import { addDays, isValidDay, localDay } from '../core/dates.js';
import { compareRecordIds, isJudged, todayCount } from '../core/records.js';
import { recordsOf } from '../core/session-start.js';
import { cardForKey, hasContextWord, isPracticable, withWordOff } from '../data/deck.js';
import {
  REMINDER_DAYS, defaultDeck, fireDayOf, maskedWord, normalizeTargetKey, reminderCandidates, reminderPayload, reminderPayloadRefs,
  reminderQuestion, reminderQuestionRefs, reminderQuestions, remindOf,
} from '../core/reminder.js';

// B3.10：提醒内容的纯计算挪进了 src/core/reminder.js（会话层的 App API 不许 import platform/）。
// 这里转出**同一个函数对象**，网页路径与原生路径算的是同一份内容。
export {
  REMINDER_DAYS, fireDayOf, maskedWord, normalizeTargetKey, reminderCandidates, reminderPayload, reminderPayloadRefs,
  reminderQuestion, reminderQuestionRefs, reminderQuestions, remindOf,
};

/** store 变化后重新同步的去抖（ms）。 */
export const RESYNC_DELAY_MS = 300;
/** 通知点开时开组的来源（sessions.B.source.view；结果页离开按钮按未知来源回首页，来源说明按「自己选的」）。 */
export const REMINDER_SOURCE_VIEW = 'reminder';

// ---------------------------------------------------------------- 运行时（页面内唯一一份）

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/**
 * 建一个提醒控制器（测试可注入全部依赖；页面用 startReminder）。
 * @param {{getStore:Function, bridge?:object, win?:object, now?:Function, deck?:object, policy?:object,
 *          startPicked?:Function, applyReminderStatus?:Function}} deps
 */
export function createReminder(deps) {
  const b = deps.bridge || defaultBridge;
  const win = deps.win === undefined ? globalWin() : deps.win;
  const nowFn = deps.now || envNow;
  const policy = deps.policy || defaultPolicy;
  let lastSent = null; // 上次发出的消息体 JSON
  let timer = null;
  const sent = [];

  function state() {
    try {
      const store = deps.getStore();
      return store ? store.getState() : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 算好并发给原生。force=false 时内容与上次相同不发；从没发过且提醒关着也不发（没有要清的）。
   * 返回发出的消息体，没发返回 null。
   */
  function sync({ remind = null, force = false } = {}) {
    const st = state();
    if (!st) return null;
    let payload;
    try {
      const nowMs = nowFn();
      payload = reminderPayload(st, { remind, today: localDay(nowMs, policy), now: nowMs, deck: deps.deck, policy });
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[shizi] reminder content failed:', error);
      return null;
    }
    const json = JSON.stringify(payload);
    if (!force && (json === lastSent || (lastSent === null && !payload.enabled))) return null;
    if (!b.postNative('syncReminder', payload)) return null;
    lastSent = json;
    sent.push(payload);
    if (sent.length > 20) sent.shift();
    return payload;
  }

  function scheduleSync() {
    if (!b.isNative()) return;
    const setT = win && typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
    const clearT = win && typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
    if (timer !== null) clearT(timer);
    timer = setT(() => {
      timer = null;
      sync();
    }, RESYNC_DELAY_MS);
  }

  function queryStatus() {
    return b.postNative('queryReminderStatus', {});
  }

  function receiveStatus(payload) {
    const store = (() => {
      try {
        return deps.getStore();
      } catch (error) {
        return null;
      }
    })();
    if (!store || typeof deps.applyReminderStatus !== 'function') return null;
    return deps.applyReminderStatus(store, payload);
  }

  /** P47：以 B 开这个字（旧 B 没写完走 S02）。返回 startPicked 的结果，认不出 / 不能练返回 {ok:false}。 */
  function openTarget(raw) {
    const cardKey = normalizeTargetKey(raw);
    const deck = deps.deck || defaultDeck();
    if (!cardKey || !deck.practicable(cardKey)) {
      if (typeof console !== 'undefined') console.warn('[shizi] reminder target is not practicable:', raw);
      return { ok: false, error: { kind: 'invalid', reason: 'target' } };
    }
    if (policy.reminderOpens !== 'picked-s02') {
      if (typeof console !== 'undefined') console.warn('[shizi] unsupported policy.reminderOpens:', policy.reminderOpens);
      return { ok: false, error: { kind: 'invalid', reason: 'policy' } };
    }
    const char = cardKey.slice(cardKey.indexOf(':') + 1);
    return deps.startPicked([cardKey], { source: { view: REMINDER_SOURCE_VIEW, char } });
  }

  return {
    sync,
    scheduleSync,
    queryStatus,
    receiveStatus,
    openTarget,
    /** 最近发出的 syncReminder 消息体（测试 / 诊断）。 */
    sent: () => sent.slice(),
    /** 忘掉上次发出的内容（下一次非 force 同步照发）。 */
    forget() {
      lastSent = null;
    },
  };
}

// 会改变提醒内容的写入：记录（今天是否已练、写错过）、sched（到期）、settings（开关 / 时间）、wordOff（词语）。
// 抬笔写会话现场（sessions）等不重算。整体替换（load / 恢复备份 / seed）一律重算。
const REMINDER_KEY = /^shizi\.v2\.(records|sched|settings|wordOff)(\.|$)/;

/** store 通知是否可能改变提醒内容。 */
export function affectsReminder(info) {
  if (!info) return false;
  if (info.type === 'load' || info.replace === true) return true;
  if (info.type !== 'commit' && info.type !== 'recover') return false;
  return Array.isArray(info.keys) && info.keys.some(key => REMINDER_KEY.test(String(key)));
}

let running = null; // {controller, off, store}

/**
 * 启动（app.js 在界面挂好之后调用一次；幂等）：
 *   1. 注册 shiziReminderStatus / shiziOpenReminderTarget 的实现；把设置页的同步换成带题目的实现（setReminderSync）；
 *   2. bridge.markReady(store)：回放 store / 界面就绪前到达的原生调用（冷启动深链在这里执行）；
 *   3. 原生壳内且提醒开着：queryReminderStatus + 同步一次；之后 store 变化去抖同步、回到前台再查权限并同步。
 * @returns {Promise<object>} 控制器
 */
export async function startReminder({ win = globalWin(), bridge: b = defaultBridge } = {}) {
  if (running) return running.controller;
  const [{ getStore }, settings, session, routeMemory] = await Promise.all([
    import('../store/store.js'),
    import('../ui/screens/mine/prefs.js'),
    import('../ui/screens/session/index.js'),
    import('../ui/route-memory.js'),
  ]);
  if (running) return running.controller;
  const controller = createReminder({
    getStore, bridge: b, win,
    startPicked: session.startPicked,
    applyReminderStatus: settings.applyReminderStatus,
  });
  settings.setReminderSync(remind => {
    controller.sync({ remind, force: true });
  });
  b.registerNativeHandler('shiziReminderStatus', payload => controller.receiveStatus(payload));
  // 审查整改 F1：深链压过冷启动恢复的页面栈（恢复后还没动过 → 先静默回首页再开组，见 ui/route-memory.js）。
  b.registerNativeHandler('shiziOpenReminderTarget', key => routeMemory.runDeepLink(() => controller.openTarget(key)));

  let store = null;
  try {
    store = getStore();
  } catch (error) {
    store = null;
  }
  const off = store ? store.subscribe((next, info) => {
    if (affectsReminder(info)) controller.scheduleSync();
  }) : () => {};
  running = { controller, off, store };
  b.markReady(store);

  if (b.isNative()) {
    const enabled = store ? remindOf(store.getState() && store.getState().settings).enabled : false;
    if (enabled) {
      controller.queryStatus();
      controller.sync();
    }
    const doc = win && win.document;
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState !== 'visible') return;
        let on = false;
        try {
          on = remindOf(getStore().getState().settings).enabled;
        } catch (error) {
          on = false;
        }
        if (!on) return;
        controller.queryStatus();
        controller.scheduleSync();
      });
    }
  }
  return controller;
}

/** 当前页面的提醒控制器（startReminder 之前为 null；测试 / 诊断用）。 */
export function reminderController() {
  return running ? running.controller : null;
}

// ---------------------------------------------------------------- 首练结果页的提醒邀请（阶段 1 P1-E5；D35 / D46 ③）
// 邀请本身（文案、次数、状态）在 core/first-result.js 与 ui/screens/result/first.js；这里只是两个调用入口，沿用设置页的写入与同步
// （settings.js commitSettings / requestReminderPermission / syncReminder），不改上面的提醒机制：
//   inviteReminder    点「好」：一次 settings commit 打开提醒并写下时间 → 才向原生请求通知权限 → 同步（带题目）。
//   inviteChangeTime  邀请块里的「改时间」：写时间 → 同步。

/**
 * 点了邀请里的「好」。
 * @returns {Promise<{ok:true, requested:boolean} | {ok:false, error}>}  requested = 这次真的发出了系统权限请求（原生壳内且还没授权）
 */
export async function inviteReminder(store, { hour, minute }) {
  const settings = await import('../ui/screens/mine/prefs.js');
  const result = settings.commitSettings(store, settings.LABELS.remind, { remind: { enabled: true, hour, minute } });
  if (!result.ok) return result;
  const remind = settings.settingsView(store.getState().settings).remind;
  const requested = settings.requestReminderPermission(remind);
  settings.syncReminder(remind);
  return { ok: true, requested: requested === true };
}

/** 邀请块里的「改时间」。 */
export async function inviteChangeTime(store, { hour, minute }) {
  const settings = await import('../ui/screens/mine/prefs.js');
  const result = settings.commitRemindTime(store, hour, minute);
  if (!result.ok) return result;
  settings.syncReminder(settings.settingsView(store.getState().settings).remind);
  return { ok: true };
}
