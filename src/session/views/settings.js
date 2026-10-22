// 提醒 / 外观 / 每组字数的视图模型与时间换算（B3.4：从 ui/screens/mine/prefs.js 挪来；无 DOM、无 Preact）。
// prefs.js 的写入（commit*）、原生桥同步仍在网页侧，从这里 import 同一批函数。

import { appearanceOf } from '../../core/appearance.js';
import { currentLibraryId } from '../../data/deck.js';
import * as policy from '../../config/policy.js';
import { groupSizeOf } from '../../core/group-size.js';
import { libraryNameRef } from './library-switch.js';

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
 *   denied:boolean, on:boolean, appearance:'auto'|'light'|'dark', appearanceSwitch:boolean}}
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
  return {
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
}
