// 时间段视图取「某一次」笔迹的共用口径（决定 D42，解 03 P122；01 §3.5 / §12；D27 / D31）。
//
// D27 起每个字只留「第一次」与「最近一次」判断的墨迹，中间几次回收。按时间段取某一次的页面（月字帖、这天 / 这次 / 这个月的图片、
// 年报第四节「这一年第一个有记录的字」）因此在旧月份多半取到已回收的那次。D42：在该时间段内、按原取法的偏好顺序
// （原来取第一次就从早到晚找，原来取最后一次就从晚到早找）找**留有墨迹**的那一次；时间段内一份都没有才如实显示没有笔迹；
// 不拿时间段外的墨迹冒充（调用方只把「这个时间段内的这个字的记录」传进来，段外的记录根本不进候选）。
//
// 全部是纯函数，无 DOM；有没有墨迹由调用方注入（hasInk）。性能：hasInk 只做「那条记录的墨迹在不在」的按月表查找
// （storedInkPresent：state.ink[月][id] 一次属性查找，不解码），挑出来之后才由格子 / 渲染各自解码一次。

import { inkIdOf, inkMonthOf } from './schema.js';

/** 偏好方向：'first' = 从早到晚找；其余一律按 'last'（从晚到早）。 */
export function normalizePrefer(prefer) {
  return prefer === 'first' ? 'first' : 'last';
}

/**
 * 一条存下的墨迹里有没有笔画（不解码）：v4 原始点 {r:[打包串…]} / v3 打包 {s:[base64…]} / 旧 v2 {s:[[…]]}，只看有没有非空的一笔。
 */
export function inkHasStrokes(ink) {
  if (!ink || typeof ink !== 'object') return false;
  if (Array.isArray(ink.r)) return ink.r.some(str => typeof str === 'string' && str.length > 0);
  return Array.isArray(ink.s) && ink.s.some(row => row && row.length > 0);
}

/**
 * 这条记录在 state.ink（按月分键的墨迹表）里有没有存下的墨迹：state.ink[inkMonthOf(r)][inkIdOf(r)]，一次查找，不解码。
 * state 缺 ink / 记录缺月份或 id 都是 false。
 */
export function storedInkPresent(state, record) {
  const table = state && state.ink && typeof state.ink === 'object' ? state.ink : null;
  if (!table) return false;
  const month = inkMonthOf(record);
  const id = inkIdOf(record);
  if (!month || !id) return false;
  const months = table[month];
  if (!months || typeof months !== 'object' || !Object.prototype.hasOwnProperty.call(months, id)) return false;
  return inkHasStrokes(months[id]);
}

/** state → hasInk(record)：按存下的墨迹判断（storedInkPresent）；调用方可另行注入含页面内笔画的判据。 */
export function hasInkOfState(state) {
  return record => storedInkPresent(state, record);
}

/**
 * 在一个时间段内某个字的记录序列里，按偏好顺序找留有墨迹的那一条；段内一条都没有墨迹返回 null。
 * @param {object[]} records  该时间段内这个字的记录，按 id 升序（早 → 晚）；段外的记录不要放进来
 * @param {{prefer?:'first'|'last', hasInk:(record)=>boolean}} o
 *   prefer 'first' 从早到晚找，'last' 从晚到早找；hasInk 抛错按没有墨迹算
 * @returns {object|null}
 */
export function pickInkRecord(records, { prefer = 'last', hasInk } = {}) {
  if (!Array.isArray(records) || !records.length || typeof hasInk !== 'function') return null;
  const forward = normalizePrefer(prefer) === 'first';
  for (let k = 0; k < records.length; k += 1) {
    const record = records[forward ? k : records.length - 1 - k];
    if (!record) continue;
    let has = false;
    try {
      has = !!hasInk(record);
    } catch (error) {
      has = false;
    }
    if (has) return record;
  }
  return null;
}

/**
 * pickInkRecord + 段内全无墨迹时的兜底：兜底取偏好方向上的那一条（第一次 / 最后一次），格子照旧标它的日子、显示「没有笔迹」。
 * @returns {{record:object|null, inked:boolean}}  records 为空时 record 为 null
 */
export function pickRecordInPeriod(records, { prefer = 'last', hasInk } = {}) {
  if (!Array.isArray(records) || !records.length) return { record: null, inked: false };
  const found = pickInkRecord(records, { prefer, hasInk });
  if (found) return { record: found, inked: true };
  return { record: normalizePrefer(prefer) === 'first' ? records[0] : records[records.length - 1], inked: false };
}
