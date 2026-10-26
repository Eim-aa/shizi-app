// 「我的」页设置行的提交函数（B3.5c：从 ui/screens/mine/prefs.js 挪来；无 DOM）。网页 prefs.js 转出同一批函数、App API（api/mine.js）直接调：
// 网页路径 == API 路径（test/ui/native-mine.test.mjs）。提醒的 commit*（要发原生消息）仍在网页侧，归 B3.10。
//
// 写入：一律 store.commit（01 §4），每次只改 settings 一个键、保留其余字段；值没变不写。

import * as policy from '../config/policy.js';
import { isGroupSizeOption } from '../core/group-size.js';
import { APPEARANCES } from '../core/appearance.js';

export const LABELS = Object.freeze({
  remind: 'settings:remind',
  remindTime: 'settings:remind-time',
  permission: 'settings:remind-permission',
  appearance: 'settings:appearance',
  groupSize: 'settings:group-size', // D65 ②
  textSizeNotice: 'settings:text-size-notice', // 静默去掉旧 large 字段的提交标签
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

/** 每组字数（D65 ②，P314）：只收 policy.groupSizeOptions 里的值；改了从下一组起生效（开着的组不变）。 */
export function commitGroupSize(store, value, { p = policy } = {}) {
  if (!isGroupSizeOption(value, p)) throw new RangeError(`unknown group size: ${value}`);
  return commitSettings(store, LABELS.groupSize, { groupSize: value });
}

export function commitAppearance(store, value) {
  if (APPEARANCES.indexOf(value) < 0) throw new RangeError(`unknown appearance: ${value}`);
  return commitSettings(store, LABELS.appearance, { appearance: value });
}
