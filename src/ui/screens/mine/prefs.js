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
import { APPEARANCES } from '../../../platform/appearance.js';
import * as policy from '../../../config/policy.js';
import { isGroupSizeOption } from '../../../core/group-size.js';
import { PERMISSIONS, APPEARANCE_ORDER, parseTime, timeText, defaultRemindTime, settingsView, REMIND_LABELS, commitSettings, commitRemindEnabled, commitRemindTime, remindOf, applyReminderStatus as commitReminderStatus } from '../../../session/views/settings.js';

export const LABELS = Object.freeze({
  remind: REMIND_LABELS.remind,
  remindTime: REMIND_LABELS.remindTime,
  permission: REMIND_LABELS.permission,
  appearance: 'settings:appearance',
  groupSize: 'settings:group-size', // D65 ②
  textSizeNotice: 'settings:text-size-notice', // 静默去掉旧 large 字段的提交标签
});

export {
  PERMISSIONS, APPEARANCE_ORDER, parseTime, timeText, defaultRemindTime, settingsView,
  commitSettings, commitRemindEnabled, commitRemindTime, remindOf,
};

/** 每组字数（D65 ②，P314）：只收 policy.groupSizeOptions 里的值；改了从下一组起生效（开着的组不变）。 */
export function commitGroupSize(store, value, { p = policy } = {}) {
  if (!isGroupSizeOption(value, p)) throw new RangeError(`unknown group size: ${value}`);
  return commitSettings(store, LABELS.groupSize, { groupSize: value });
}

export function commitAppearance(store, value) {
  if (APPEARANCES.indexOf(value) < 0) throw new RangeError(`unknown appearance: ${value}`);
  return commitSettings(store, LABELS.appearance, { appearance: value });
}

/**
 * 提醒开关。打开时若还没存过时间，补上缺省时间（P18），让存下的就是界面显示的。
 * （写入本体在会话层 session/views/settings.js，B3.10：App API 与网页调同一个函数对象。）
 */

/**
 * 原生回报的通知权限（shiziReminderStatus({permission})）→ settings.remind.permission。
 * 写入在会话层（session/views/settings.js，B3.10：App API 调同一个函数对象），这里补一次同步提醒内容。
 * M5-5 用 registerNativeHandler('shiziReminderStatus', payload => applyReminderStatus(getStore(), payload)) 接上。
 */
export function applyReminderStatus(store, payload) {
  const result = commitReminderStatus(store, payload);
  if (result.ok && !result.skipped) syncReminder(remindOf(store));
  return result;
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
