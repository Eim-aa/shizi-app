// 首页「今天写的字」的取墨与去处（决定-D12；R-H07；阶段 1 P1-E5 起画法在 copybook.js 的 HomeTie，本文件只留两个小工具）。
//
// - recordInkPoints(record, getInk)：一条记录的本人笔迹点列（逐判断笔迹打开 P31 且这条记录有墨迹才有；字墙 library/wall.js 也用）。
// - setTodayRecordsAction(fn)：「今天的记录」去处（R-H08 / 走查-M07，mine/records.js 注册）。注册了，首页「今天写的字」整排是一个按钮，
//   点进今天的记录；没注册时整排不是按钮（不放点了没反应的控件），只作读屏图片。

import * as defaultPolicy from '../../../config/policy.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';

let todayRecordsAction = null;

/** 注册「今天的记录」去处（R-H08；M4-1 练习记录 / 今天的记录页的拥有卡调用）；传 null 取消。 */
export function setTodayRecordsAction(fn) {
  todayRecordsAction = typeof fn === 'function' ? fn : null;
}

export function getTodayRecordsAction() {
  return todayRecordsAction;
}

/** 一条记录的墨迹点列（管线点列，绝对宽）；逐判断笔迹关闭或没有墨迹时 null。 */
export function recordInkPoints(record, getInk, policy = defaultPolicy) {
  if (!record || !policy.features || !policy.features.perRecordInk || typeof getInk !== 'function') return null;
  let ink = null;
  try {
    ink = getInk(record);
  } catch (error) {
    ink = null;
  }
  const decoded = ink ? decodeInk(ink) : null;
  if (!decoded || !decoded.length) return null;
  return resampleForReplay(decoded);
}
