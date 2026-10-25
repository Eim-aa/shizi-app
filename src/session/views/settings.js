// 提醒 / 外观 / 每组字数的视图模型与时间换算（B3.4：从 ui/screens/mine/prefs.js 挪来；无 DOM、无 Preact）。
// prefs.js 的写入（commit*）、原生桥同步仍在网页侧，从这里 import 同一批函数。
//
// B3.10：提醒页（remind）的视图模型 remindView 与提醒的写入函数（commitRemindEnabled / commitRemindTime /
// commitSettings / applyReminderStatus）也搬到这里——会话层不许 import 网页 UI 层，App API（src/session/api/settings.js）
// 要调的是**网页同一批函数**（契约 test/ui/native-settings.test.mjs），所以函数本体必须在会话层，网页 prefs.js 转出同一个函数对象。

import { appearanceOf } from '../../core/appearance.js';
import { currentLibraryId } from '../../data/deck.js';
import * as policy from '../../config/policy.js';
import { groupSizeOf } from '../../core/group-size.js';
import { libraryNameRef } from './library-switch.js';
import { ref } from '../../config/copy/index.js';

export const PERMISSIONS = Object.freeze(['granted', 'denied', 'unknown']);
/** 外观三段的顺序（D63：跟随系统｜日间｜夜间）。 */
export const APPEARANCE_ORDER = Object.freeze(['auto', 'light', 'dark']);

/** 'HH:MM' → {hour, minute}；不合法返回 null。 */
export function parseTime(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(typeof text === 'string' ? text.trim() : '');
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const pad2 = n => (n < 10 ? `0${n}` : String(n));

/** {hour, minute} → 'HH:MM'（<input type=time> 的值）。 */
export function timeText(hour, minute) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** 提醒缺省时间（P18 policy.remindDefault；写坏了退回 20:00）。 */
export function defaultRemindTime(p = policy) {
  return parseTime(p.remindDefault) || { hour: 20, minute: 0 };
}

/**
 * settings（可为 null）→ 页面要显示的值（补缺省）。
 * @returns {{library:string, libraryName:{copy:string}, remind:{enabled:boolean, hour:number, minute:number, permission:string},
 *   denied:boolean, on:boolean, appearance:'auto'|'light'|'dark', appearanceSwitch:boolean,
 *   remindPage: {title, label, sub, timeLabel, time, note, fail}}}
 */
export function settingsView(settings, { p = policy } = {}) {
  const s = settings || {};
  const library = currentLibraryId(settings);
  const r = s.remind || {};
  const def = defaultRemindTime(p);
  const permission = PERMISSIONS.indexOf(r.permission) >= 0 ? r.permission : 'unknown';
  const remind = {
    enabled: r.enabled === true,
    hour: Number.isInteger(r.hour) ? r.hour : def.hour,
    minute: Number.isInteger(r.minute) ? r.minute : def.minute,
    permission,
  };
  const features = p.features || {};
  const base = {
    library,
    libraryName: libraryNameRef(library), // 文案引用（键 + 参数）
    remind,
    // 手机关了通知就显示 R-S02；开关按 iOS 习惯如实显示「现在收不收得到」：on = 用户选了开 且 通知没被手机关掉（E3）。
    // remind.enabled 仍是用户存下的选择——手机里重新允许通知后，开关自己回到开。
    denied: permission === 'denied',
    on: r.enabled === true && permission !== 'denied',
    appearance: appearanceOf(settings, { features }).theme,
    groupSize: groupSizeOf(settings, p), // D65 ②
    appearanceSwitch: features.appearanceSwitch !== false,
  };
  return { ...base, remindPage: remindPageOf(base) };
}

/**
 * 提醒页正文的文案引用 + 数据（B3.10）：开关行的小字、时间行、通知被关时的说明、写入失败的三段式。
 * 只给键 + 参数，不拼句子（B3.4）：网页用 tRef 渲染，原生用 ShiziCopy 渲染。
 */
function remindPageOf(base) {
  return {
    title: ref('R-M03.remind'),
    label: ref('X-SETTINGS.remindLabel'),
    // 开关行的小字：通知没被手机关掉时是 R-S01 的说明，被关掉时是 R-S02 的标题（页面按 denied 选一个）。
    sub: { on: ref('R-S01.remindNote'), denied: ref('R-S02.title') },
    timeLabel: ref('X-SETTINGS.remindTime'),
    /** 开着时多一行「提醒时间」（<input type=time> 的值，'HH:MM'）。 */
    time: base.on ? timeText(base.remind.hour, base.remind.minute) : null,
    /** 通知被手机关掉时的说明与「手机设置 ›」（页面按 denied 显示）。 */
    note: { body: ref('R-S02.body'), link: ref('R-S02.link') },
    /** 写入失败的三段式（D07）：说明 +「先不保存」+「再试一次」。 */
    fail: {
      text: ref('X-SETTINGS.saveFailed'),
      cancel: ref('X-SETTINGS.cancel'),
      retry: ref('X-SETTINGS.retry'),
    },
  };
}

/**
 * 提醒页（view.remind）的视图模型。网页提醒页（ui/screens/mine/remind.js）与原生提醒页（Screens/Remind.swift）
 * 渲染的是**同一个函数的结果**：网页 import 这个函数，App API 的 view.remind 也调它（契约 test/ui/native-settings.test.mjs）。
 * @param {object} settings store 里的 settings（可为 null）
 */
export function remindView(settings, { p = policy } = {}) {
  return settingsView(settings, { p });
}

// ---------------------------------------------------------------- 提醒的写入（B3.10：从 ui/screens/mine/prefs.js 搬来）
//
// 网页路径与 App API 路径调的是**同一个函数对象**（prefs.js 转出这里的函数）：契约 test/ui/native-settings.test.mjs。
// 原生桥的同步（syncReminder / requestReminderPermission）在网页侧（platform/bridge.js），会话层不碰。

/** 提醒的提交标签（网页 prefs.js LABELS.remind / remind-time / permission 同一批）。 */
export const REMIND_LABELS = Object.freeze({
  remind: 'settings:remind',
  remindTime: 'settings:remind-time',
  permission: 'settings:remind-permission',
});

function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 一次 commit 把 fields 合进 settings（只改给出的字段，其余保留）。值没变不写，返回 {ok:true, keys:[], skipped:true}。
 * fields.remind 若给出，与原 remind 合并（保留 permission 等）。
 */
export function commitSettings(store, label, fields) {
  const cur = store.getState().settings || {};
  const next = { ...cur };
  for (const key of Object.keys(fields)) {
    if (key === 'remind') next.remind = { ...(cur.remind || {}), ...fields.remind };
    else next[key] = fields[key];
  }
  if (sameJSON(next, cur) && store.getState().settings) return { ok: true, keys: [], skipped: true };
  return store.commit(label, draft => {
    const base = draft.settings || {};
    const merged = { ...base };
    for (const key of Object.keys(fields)) {
      if (key === 'remind') merged.remind = { ...(base.remind || {}), ...fields.remind };
      else merged[key] = fields[key];
    }
    draft.settings = merged;
  });
}

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
  return commitSettings(store, REMIND_LABELS.remind, { remind: patch });
}

export function commitRemindTime(store, hour, minute) {
  return commitSettings(store, REMIND_LABELS.remindTime, { remind: { hour, minute } });
}

/** store 里的提醒设置（补缺省）。 */
export function remindOf(store) {
  return settingsView(store.getState().settings).remind;
}

/**
 * 原生回报的通知权限 → settings.remind.permission（只写这一件事；同步提醒内容由调用方做——网页路径在 prefs.js 里
 * 补一次 syncReminder，原生路径由原生页自己重排）。
 */
export function applyReminderStatus(store, payload) {
  const raw = payload && typeof payload === 'object' ? payload.permission : payload;
  const permission = PERMISSIONS.indexOf(raw) >= 0 ? raw : 'unknown';
  return commitSettings(store, REMIND_LABELS.permission, { remind: { permission } });
}

// ---------------------------------------------------------------- 提醒页的视图模型（B3.10）

// remindView / remindPageOf 在上面（settingsView 旁边）：提醒页的模型就是 settingsView 的同一份结果。

