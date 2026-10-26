// 「我的」页设置行的提交函数（B3.5c：从 ui/screens/mine/prefs.js 挪来；无 DOM）。网页 prefs.js 转出同一批函数、App API（api/mine.js）直接调：
// 网页路径 == API 路径（test/ui/native-mine.test.mjs）。提醒的 commit*（要发原生消息）仍在网页侧，归 B3.10。
//
// 写入：一律 store.commit（01 §4），每次只改 settings 一个键、保留其余字段；值没变不写。

import * as policy from '../config/policy.js';
import { isGroupSizeOption } from '../core/group-size.js';
import { APPEARANCES } from '../core/appearance.js';
import { commitSettings } from './views/settings.js'; // 与提醒（B3.10）同一个 commitSettings

export { commitSettings };

export const LABELS = Object.freeze({
  remind: 'settings:remind',
  remindTime: 'settings:remind-time',
  permission: 'settings:remind-permission',
  appearance: 'settings:appearance',
  groupSize: 'settings:group-size', // D65 ②
  textSizeNotice: 'settings:text-size-notice', // 静默去掉旧 large 字段的提交标签
});

export function commitGroupSize(store, value, { p = policy } = {}) {
  if (!isGroupSizeOption(value, p)) throw new RangeError(`unknown group size: ${value}`);
  return commitSettings(store, LABELS.groupSize, { groupSize: value });
}

export function commitAppearance(store, value) {
  if (APPEARANCES.indexOf(value) < 0) throw new RangeError(`unknown appearance: ${value}`);
  return commitSettings(store, LABELS.appearance, { appearance: value });
}
