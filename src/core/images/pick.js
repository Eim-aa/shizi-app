// 图片选字与取墨口径（纯函数，无 DOM；02 M4-5；01 §10；04 R-I01 / R-I04、R-R07、R-P03、R-D04、A05；决定-D11 / D12 / D23；
// 03 P02 / P25 / P50）。
//
// 从 #180 handoff/r8-foundation/module/selectors.mjs（origin/pr-180）改造：成员来自 v2 记录（kind==='judged'，D23），
// 键为 cardKey（base:<字>），不读旧 activity / recentInk；「取哪一条」由 pick 参数决定：
//   这次的图片（session）  本组 judged 的字，按本组第一次出现的先后；每字取本组最后一次判断（D11 / Y03）。
//   这天写的字（day）      R-P03「这次的图片」= 那天判断过的字每字最近一次，按那天第一次出现的先后。
//   月字帖（month）        本月判断过的字，按本月第一次出现的先后；每字取 policy.monthSheetPick（P02 过渡 'first' = 本月第一次，
//                          M02「格子里的笔迹和格子上标的日期对应」）；角标 = 那条记录的日子「9·24」，与前一格同一天时不标。
//                          落款天数 = 本月有 judged 记录的日子（K27）。
//   单字手写图片（glyph）  这个字最近一次 judged（A05「只重绘最近一份笔迹」）；那次没有笔迹就不生成（R-D04 置灰）。
// 缺墨（P50 过渡 policy.imageMissingInk='omit'，按第十稿 10.12）：那一条没有笔迹的字不画进图、不借别次笔迹（I03），
//   落款字数跟着减（R-I04）；缺墨的字列在 missing 里供说明句。角标在去掉缺墨格之后重算（每个日子的第一格都带日期）。
// 超上限（P25 过渡 policy.imageMaxChars=80、imageOverflow='pending'）：status 'pending'，不截字（D12）。
// 「最近一次」「第一次」一律按记录 id 序号（01 §3.1），不看 at。
// 取哪一条的 D42 口径（解 03 P122；D27 起中间几次的墨迹已回收）：这次 / 这天 / 这个月这三类按时间段取「某一次」的图片，每字在该时间段内
//   按原取法的偏好顺序（月字帖 first 从早到晚、这次 / 这天 last 从晚到早）找**留有墨迹**的那一次（core/ink-pick.js pickRecordInPeriod）；
//   时间段内一份都没有时才取偏好方向上的那一条、如实缺墨；时间段外的墨迹不进候选，不冒充。单字手写图片（glyph）本来就是
//   「最近一次」、没有时间段，口径不变。角标日期跟着挑出来的那条记录走（M02「笔迹与角标对应」）。
//
// inkOf(record) → 345 单位点列（每笔 [{x,y,w,…}]，已 resampleForReplay）或 null；由调用方注入（界面层读 store 的墨迹表）。

import * as defaultPolicy from '../../config/policy.js';
import { charOfCardKey, compareRecordIds, isJudged } from '../records.js';
import { isValidDay, isValidMonth, localDay } from '../dates.js';
import { dateTag } from './layout.js';
import { pickRecordInPeriod } from '../ink-pick.js';

export const IMAGE_KINDS = Object.freeze(['session', 'day', 'month', 'glyph']);

/** state.records（{月: Record[] | 折叠月}）→ 全部记录（按 id 升序）；折叠月只剩 kept（01 §9）。 */
export function flattenRecords(records) {
  const out = [];
  if (!records || typeof records !== 'object') return out;
  for (const value of Object.values(records)) {
    if (Array.isArray(value)) out.push(...value);
    else if (value && typeof value === 'object' && Array.isArray(value.kept)) out.push(...value.kept);
  }
  return out.filter(r => r && typeof r.id === 'string').sort((a, b) => compareRecordIds(a.id, b.id));
}

/** 折叠月的 byDay（{localDay:[char]}）；没有折叠返回 null。 */
function foldedMonth(records, month) {
  const v = records && typeof records === 'object' ? records[month] : null;
  return v && !Array.isArray(v) && v.folded ? v : null;
}

function charOf(record) {
  return typeof record.char === 'string' && record.char ? record.char : charOfCardKey(record.cardKey);
}

/**
 * judged 记录按字分组：成员顺序 = 第一次出现的先后；每字按 pick 方向取一条（D42：给了 hasInk 时取该方向上第一条留有墨迹的，
 * 段内全无墨迹才取方向上的那一条；不给 hasInk 就是单纯取第一次 / 最后一次）。judged 要按 id 升序。
 * @returns {Array<{char, cardKey, record, firstDay}>}
 */
export function groupByChar(judged, pick = 'last', hasInk = null) {
  const byChar = new Map();
  for (const r of judged) {
    const char = charOf(r);
    const row = byChar.get(char);
    if (!row) byChar.set(char, { char, list: [r] });
    else row.list.push(r);
  }
  return [...byChar.values()].map(row => {
    const prefer = pick === 'first' ? 'first' : 'last';
    const record = typeof hasInk === 'function'
      ? pickRecordInPeriod(row.list, { prefer, hasInk }).record
      : prefer === 'first' ? row.list[0] : row.list[row.list.length - 1];
    return { char: row.char, cardKey: record.cardKey, record, firstDay: row.list[0].localDay };
  });
}

// ---------------------------------------------------------------- 成员

function sessionsOf(state) {
  const s = state && state.sessions && typeof state.sessions === 'object' ? state.sessions : {};
  return { A: s.A || null, B: s.B || null, lastEnded: s.lastEnded && typeof s.lastEnded === 'object' ? s.lastEnded : {} };
}

/** 找会话（lastEnded 优先，其次槽里；与结果页 findResultSession 同口径）。 */
export function findSession(state, { slot = null, sessionId }) {
  const s = sessionsOf(state);
  const slots = slot ? [slot] : ['A', 'B'];
  for (const k of slots) {
    const ended = s.lastEnded[k];
    if (ended && ended.id === sessionId) return ended;
  }
  for (const k of slots) {
    const live = s[k];
    if (live && live.id === sessionId) return live;
  }
  return null;
}

/** 会话的日子（落款日期）：与结果页 dayOfSession 同口径（结束时刻 → 最后更新 → 开始日）。 */
export function sessionDay(session, records = []) {
  if (session) {
    const at = Number.isFinite(session.endedAt) ? session.endedAt : session.updatedAt;
    if (Number.isFinite(at)) return localDay(at);
    if (isValidDay(session.startedDay)) return session.startedDay;
  }
  const last = records.length ? records[records.length - 1] : null;
  return last && isValidDay(last.localDay) ? last.localDay : null;
}

/** 这次的图片：本组 judged，按本组先后；每字取本组内从晚到早第一条留有墨迹的判断（D11 的「最后一次」+ D42）。 */
export function sessionMembers(state, { slot = null, sessionId, hasInk = null }) {
  const all = flattenRecords(state && state.records).filter(r => r.sessionId === sessionId);
  const judged = all.filter(isJudged);
  const session = findSession(state, { slot, sessionId });
  // 顺序以会话 items（结果页格子顺序）为准；items 里没有的（异常数据）按记录先后接在后面。
  const order = [];
  if (session && Array.isArray(session.items)) {
    for (const it of session.items) {
      const r = it && it.recordId ? judged.find(x => x.id === it.recordId) : null;
      if (r && !order.includes(charOf(r))) order.push(charOf(r));
    }
  }
  const groups = groupByChar(judged, 'last', hasInk);
  groups.sort((a, b) => {
    const ia = order.indexOf(a.char);
    const ib = order.indexOf(b.char);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return 0;
  });
  return { members: groups, day: sessionDay(session, all), session };
}

/** 某天写的字：那天 judged，每字取那天内从晚到早第一条留有墨迹的判断（R-P03 的「最近一次」+ D42）。 */
export function dayMembers(state, day, { hasInk = null } = {}) {
  if (!isValidDay(day)) throw new Error('INVALID_DAY');
  const judged = flattenRecords(state && state.records).filter(r => isJudged(r) && r.localDay === day);
  return { members: groupByChar(judged, 'last', hasInk), day };
}

/**
 * 月字帖成员。折叠月（01 §9）只剩 byDay / chars 与 kept：成员按 byDay 的日子先后，记录只能从 kept 里取到
 * 「仍是某字最新 judged」的那条——取不到的格子按缺墨处理（墨迹随折叠删除）。
 */
export function monthMembers(state, month, { pick = defaultPolicy.monthSheetPick, hasInk = null } = {}) {
  if (!isValidMonth(month)) throw new Error('INVALID_MONTH');
  const records = state && state.records;
  const folded = foldedMonth(records, month);
  const prefix = month + '-';
  const judged = flattenRecords(records).filter(r => isJudged(r) && typeof r.localDay === 'string' && r.localDay.startsWith(prefix));
  let members;
  let days;
  if (folded) {
    const byDay = folded.byDay && typeof folded.byDay === 'object' ? folded.byDay : {};
    days = Object.keys(byDay).filter(d => d.startsWith(prefix)).sort();
    const seen = new Set();
    members = [];
    for (const d of days) {
      for (const char of byDay[d] || []) {
        if (seen.has(char)) continue;
        seen.add(char);
        const kept = judged.filter(r => charOf(r) === char);
        const prefer = pick === 'first' ? 'first' : 'last';
        const record = kept.length
          ? (typeof hasInk === 'function' ? pickRecordInPeriod(kept, { prefer, hasInk }).record : prefer === 'first' ? kept[0] : kept[kept.length - 1])
          : null;
        members.push({ char, cardKey: record ? record.cardKey : 'base:' + char, record, firstDay: d });
      }
    }
  } else {
    days = [...new Set(judged.map(r => r.localDay))].sort();
    members = groupByChar(judged, pick === 'first' ? 'first' : 'last', hasInk);
  }
  return { members, days: days.length, dayList: days, month, pick };
}

/** 单字：这个字最近一次 judged（A05）。 */
export function glyphMember(state, char) {
  const judged = flattenRecords(state && state.records).filter(r => isJudged(r) && charOf(r) === char);
  const record = judged.length ? judged[judged.length - 1] : null;
  return record ? { char, cardKey: record.cardKey, record, firstDay: judged[0].localDay } : null;
}

// ---------------------------------------------------------------- 取墨与成图计划

function hasPoints(points) {
  return Array.isArray(points) && points.some(s => Array.isArray(s) && s.length);
}

/** inkOf(record) 有没有可画的点列（取墨函数抛错按没有算）。 */
function inkPointsPresent(inkOf, record) {
  if (!record || typeof inkOf !== 'function') return false;
  try {
    return hasPoints(inkOf(record));
  } catch (error) {
    return false;
  }
}

/**
 * 按成员里已选定的那条记录取墨（只取这一条，不再借别次，I03）。选哪一条已在成员里按 D42 在时间段内挑过
 * （挑的时候就是「留有墨迹的那一次」，段内全无墨迹的字才会走到 missing）。
 */
export function splitByInk(members, inkOf) {
  const drawn = [];
  const missing = [];
  for (const m of members) {
    let points = null;
    if (m.record && typeof inkOf === 'function') {
      try {
        points = inkOf(m.record);
      } catch (error) {
        points = null;
      }
    }
    const has = hasPoints(points);
    if (has) drawn.push({ ...m, points });
    else missing.push(m.char);
  }
  return { drawn, missing };
}

/** 月字帖角标：那一格记录的日子，与前一格同一天时不标。 */
export function withTags(cells) {
  let prev = null;
  return cells.map(c => {
    const day = c.record ? c.record.localDay : null;
    const tag = day && day !== prev ? dateTag(day) : '';
    if (day) prev = day;
    return { ...c, tag };
  });
}

/**
 * 成图计划（纯函数）：成员、取墨、缺墨、数量、状态。
 * @param {object} state
 * @param {{kind:'session'|'day'|'month'|'glyph', slot?, sessionId?, day?, month?, char?}} scope
 * @param {{inkOf:(record)=>Array|null, hasInk?:(record)=>boolean, policy?:object}} o
 *   hasInk：D42 挑「时间段内留有墨迹的那一次」时判断一条记录有没有墨迹——界面层传按月表查找的廉价判据（不解码，ink-pick.js storedInkPresent）；
 *   缺省按 inkOf 的结果判断（要解码，单测与小数据用）。
 * @returns {{kind, status:'ready'|'empty'|'pending'|'noInk', key, day, month, members, drawn, missing, n, days, maxChars, recordIds}}
 */
export function imagePlan(state, scope, { inkOf, hasInk = null, policy = defaultPolicy } = {}) {
  const kind = scope && scope.kind;
  if (!IMAGE_KINDS.includes(kind)) throw new Error('INVALID_KIND');
  const maxChars = Number.isSafeInteger(policy.imageMaxChars) ? policy.imageMaxChars : 80;
  const has = typeof hasInk === 'function' ? hasInk : record => inkPointsPresent(inkOf, record);
  let members = [];
  let day = null;
  let month = null;
  let days = null;
  let key;
  if (kind === 'session') {
    const r = sessionMembers(state, { slot: scope.slot || null, sessionId: scope.sessionId, hasInk: has });
    members = r.members;
    day = r.day;
    key = scope.sessionId;
  } else if (kind === 'day') {
    const r = dayMembers(state, scope.day, { hasInk: has });
    members = r.members;
    day = r.day;
    key = scope.day;
  } else if (kind === 'month') {
    const r = monthMembers(state, scope.month, { pick: policy.monthSheetPick, hasInk: has });
    members = r.members;
    month = r.month;
    days = r.days;
    key = scope.month;
  } else {
    const m = glyphMember(state, scope.char);
    members = m ? [m] : [];
    day = m ? m.record.localDay : null;
    key = scope.char;
  }
  const { drawn: rawDrawn, missing } = splitByInk(members, inkOf);
  const drawn = kind === 'month' ? withTags(rawDrawn) : rawDrawn.map(c => ({ ...c, tag: '' }));
  let status = 'ready';
  if (kind === 'glyph') status = drawn.length ? 'ready' : 'noInk';
  else if (!drawn.length) status = 'empty';
  else if (drawn.length > maxChars) status = 'pending'; // P25：不截字
  return {
    kind,
    key,
    status,
    day,
    month,
    days,
    maxChars,
    members,
    drawn,
    missing,
    n: drawn.length,
    recordIds: drawn.map(c => c.record.id),
  };
}
