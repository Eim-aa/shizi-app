// 偏好设置的读写与提醒同步（原「设置」页 M4-3 拆出的逻辑部分；04 R-S01–R-S03；03 P18、P24、P51、P132；01 §3 settings 形状、§8.1 原生桥）。
// D63：「设置」页已删，各项直接在「我的」页（外观、练习范围）或提醒页（remind.js）改；「写字方式」「声音」两项功能已去掉（settings.writeMode / settings.sound 旧值读到也不再生效）。
//
// 写入：一律 store.commit（01 §4），每次只改 settings 一个键、保留其余字段；值没变不写。
// 外观只写 store；<html> 的 data-theme 由 src/platform/appearance.js 订阅 store 后应用（启动时也由它应用）。
// 提醒（原生执行，M5-5 接完整链路）：只经 platform/bridge.js postNative 发消息，不在原生壳内时 postNative 返回 false，页面照常：
//   打开 → 写 enabled（首开补 hour/minute 缺省）→ 权限不是 granted 时 postNative('requestReminderPermission') → syncReminder；
//   关闭 / 改时间 → syncReminder。syncReminder 缺省发 {type:'syncReminder', enabled, hour, minute, practicedToday:false, questions:[]}；
//   题目（P48 写错过优先、其次到期最久）归 M5-5，用 setReminderSync(fn) 换成带题目的实现。
//   原生回 shiziReminderStatus({permission}) → applyReminderStatus(store, payload)（M5-5 用 registerNativeHandler 接上）。

import { getStore } from '../../../store/store.js';
import { postNative } from '../../../platform/bridge.js';
import * as policy from '../../../config/policy.js';
import { LABELS, commitSettings, commitGroupSize, commitAppearance } from '../../../session/prefs-ops.js';
import { PERMISSIONS, APPEARANCE_ORDER, parseTime, timeText, defaultRemindTime, settingsView } from '../../../session/views/settings.js';

export { LABELS, commitSettings, commitGroupSize, commitAppearance }; // B3.5c：提交函数在会话层（session/prefs-ops.js），网页与 App API 同一个
export { PERMISSIONS, APPEARANCE_ORDER, parseTime, timeText, defaultRemindTime, settingsView };

/**
 * 提醒开关。打开时若还没存过时间，补上缺省时间（P18），让存下的就是界面显示的。
 */
export function commitRemindEnabled(store, on, { p = policy } = {}) {
  const cur = (store.getState().settings || {}).remind || {};
  const patch = { enabled: !!on };
  if (on) {
    const def = defaultRemindTime(p);
    if (!Number.isInteger(cur.hour)) patch.hour = def.hour;
    if (!Number.isInteger(cur.minute)) patch.minute = def.minute;
  }
  return commitSettings(store, LABELS.remind, { remind: patch });
}

export function commitRemindTime(store, hour, minute) {
  return commitSettings(store, LABELS.remindTime, { remind: { hour, minute } });
}

/**
 * 原生回报的通知权限（shiziReminderStatus({permission})）→ settings.remind.permission。
 * M5-5 用 registerNativeHandler('shiziReminderStatus', payload => applyReminderStatus(getStore(), payload)) 接上。
 */
export function applyReminderStatus(store, payload) {
  const raw = payload && typeof payload === 'object' ? payload.permission : payload;
  const permission = PERMISSIONS.indexOf(raw) >= 0 ? raw : 'unknown';
  const result = commitSettings(store, LABELS.permission, { remind: { permission } });
  if (result.ok && !result.skipped) syncReminder(remindOf(store));
  return result;
}

export function remindOf(store) {
  return settingsView(store.getState().settings).remind;
}

let reminderSync = null;

/** M5-5 注册带题目的同步实现：fn(remind) → void；传 null 恢复缺省。 */
export function setReminderSync(fn) {
  reminderSync = typeof fn === 'function' ? fn : null;
}

/** 把提醒设置发给原生（缺省实现不带题目；不在原生壳内返回 false）。 */
export function syncReminder(remind) {
  if (reminderSync) {
    try {
      reminderSync(remind);
      return true;
    } catch (error) {
      if (typeof console !== 'undefined') console.error('[shizi] reminder sync failed:', error);
      return false;
    }
  }
  return postNative('syncReminder', {
    enabled: !!remind.enabled, hour: remind.hour, minute: remind.minute, practicedToday: false, questions: [],
  });
}

/** 打开提醒后向原生要通知权限（已 granted 不再要）。 */
export function requestReminderPermission(remind) {
  if (remind && remind.permission === 'granted') return false;
  return postNative('requestReminderPermission', {});
}

// ---------------------------------------------------------------- 旧「更大字体」字段的静默清理（D29 / P132；D58 起不再弹说明）

/** settings.large 是否还留着（v1 迁移带来、或旧版 App 内开关打开过）。 */
export function textSizeNoticeDue(settings) {
  return !!settings && settings.large === true;
}

/** 从 settings 去掉不再生效的 large（其余字段不动）。 */
export function commitTextSizeNoticeShown(store) {
  return store.commit(LABELS.textSizeNotice, draft => {
    const next = { ...(draft.settings || {}) };
    delete next.large;
    draft.settings = next;
  });
}

/**
 * 启动后（app.js，迁移与挂 UI 之后）调用一次：settings.large 还在就静默去掉，什么都不显示（I3 · P0-13；规范 F3：不可操作的提示不出现）。
 * 写入失败只是下次启动再试一次。返回是否去掉了。
 */
export function clearLegacyLargeFlag({ getStore: storeOf = getStore } = {}) {
  let store = null;
  try {
    store = storeOf();
  } catch (error) {
    return false;
  }
  if (!store || !textSizeNoticeDue(store.getState().settings)) return false;
  try {
    return commitTextSizeNoticeShown(store).ok !== false;
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('[shizi] legacy large flag not cleared:', error);
    return false;
  }
}
