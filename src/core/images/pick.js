// 图片选字与取墨口径（纯函数，无 DOM；02 M4-5；01 §10；04 R-I01 / R-I04、R-P03、R-D04、A05；决定-D11 / D12 / D23 / D31 / D39 / D42；
// 03 P02 / P25 / P50；阶段 1 P1-E7 改按「作品」口径，交接 §4.2 / §6.6 / §7 / §8）。
//
// 成员与取墨：
//   这次的图片（session）  = 作品成员规则（work.js buildWork：默认写对 ∪ 看后自写有墨；写错有墨可「放进去」，带朱点），顺序 = 组内顺序；
//                          每字取本组该字的那条记录（D11 最后一次）；成员里没有的（无墨、跳过）不画。
//   这天写的字（day）      那天判断过的字每字最近一次（按那天第一次出现的先后）；缺墨的字不画（P50 omit）。
//   月字帖（month）        本月判断过的字，按本月第一次出现的先后；每字取本月内留有墨迹的第一次（D42；policy.monthSheetPick 'first'）；
//                          整个月一份墨迹都没有的字**照样在**，画 under 衬底（交接 §7，不写「没有笔迹」）；日期角标只标每天的第一个字；
//                          纸上记录不进（D46-13 / D47，isWorkRecord；折叠月用 paperOnly 去掉），所以月字数也不计它；
//                          纸上记录必须在 pickRecordInPeriod 之前滤掉（段内全无墨时它会兜底取那条）。
//   单字手写图片（glyph）  这个字最近一次 judged、不在纸上（A05；纸上那次不占位，D47）；那次没有笔迹就不生成（R-D04 置灰）。
// 超过 80 字（D39）：不再返回 pending——plan.pages 按日期分页（paginate.js），每页独立排版。
// 「最近一次」「第一次」一律按记录 id 序号（01 §3.1），不看 at。D42：时间段内每字找留有墨迹的那一次（core/ink-pick.js），
// 时间段外的墨迹不进候选，不冒充。
//
// inkOf(record) → 345 单位点列（每笔 [{x,y,w,…}]，已 resampleForReplay）或 null；由调用方注入（界面层读 store 的墨迹表）。

import * as defaultPolicy from '../../config/policy.js';
import { charOfCardKey, compareRecordIds, foldWorkByDay, isPaperRecord, isWorkRecord } from '../records.js';
import { isValidDay, isValidMonth, localDay } from '../dates.js';
import { MAX_CHARS_PER_PAGE, withDayTags } from './layout.js';
import { paginate, retagPages } from './paginate.js';
import { dayTag } from './layout.js';
import { addedOf, buildWork } from './work.js';
import { pickRecordInPeriod } from '../ink-pick.js';

export const IMAGE_KINDS = Object.freeze(['session', 'day', 'month', 'glyph']);

export { isPaperRecord };

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

/**
 * 这次的图片的作品成员（交接 §4.2；顺序 = 组内 items 顺序）。session 的 items 之外、本组还有但没进 items 的 judged 记录（异常数据）不进。
 * @returns {{work:object, day:string|null, session:object|null}}
 */
export function sessionWork(state, { slot = null, sessionId, hasInk }) {
  const all = flattenRecords(state && state.records).filter(r => r.sessionId === sessionId);
  const session = findSession(state, { slot, sessionId });
  const byId = new Map(all.map(r => [r.id, r]));
  const items = session && Array.isArray(session.items)
    ? session.items
    : all.filter(r => r.kind === 'judged').map(r => ({ cardKey: r.cardKey, recordId: r.id, kind: r.kind }));
  const work = buildWork({ items, records: byId, hasInk: typeof hasInk === 'function' ? hasInk : () => false, added: addedOf(session), charOf: key => charOfCardKey(key) || '' });
  return { work, day: sessionDay(session, all), session };
}

/** 某天写的字：那天 judged，每字取那天内从晚到早第一条留有墨迹的判断（R-P03 的「最近一次」+ D42）。 */
export function dayMembers(state, day, { hasInk = null } = {}) {
  if (!isValidDay(day)) throw new Error('INVALID_DAY');
  const judged = flattenRecords(state && state.records).filter(r => isWorkRecord(r) && r.localDay === day);
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
  const judged = flattenRecords(records).filter(r => isWorkRecord(r) && typeof r.localDay === 'string' && r.localDay.startsWith(prefix));
  let members;
  let days;
  if (folded) {
    const byDay = foldWorkByDay(folded); // 折叠时记下的「只在纸上写过」的字不进（D47）
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
  const judged = flattenRecords(state && state.records).filter(r => isWorkRecord(r) && charOf(r) === char);
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

function pointsOf(inkOf, record) {
  if (!record || typeof inkOf !== 'function') return null;
  try {
    const points = inkOf(record);
    return hasPoints(points) ? points : null;
  } catch (error) {
    return null;
  }
}

/** 一个成员 → 排版 / 渲染用的格子：有墨 'hand'，没墨 'under'；day = 那一格记录的日子（角标 / 分页用）。 */
export function cellOfMember(member, inkOf, { under = false } = {}) {
  const ink = pointsOf(inkOf, member.record);
  const day = member.record ? member.record.localDay : member.firstDay || null;
  if (!ink && !under) return null;
  return { ch: member.char, ink, mode: ink ? 'hand' : 'under', dot: false, tag: '', day, record: member.record || null };
}

/**
 * 月字帖 / 年报月页的格子（交接 §7 / §8）：本月每个字一格，有墨取留墨的第一次，一份都没有的画 under；日期角标只标每天的第一个字。
 * @returns {{month:string, days:number, cells:Array, members:Array, inked:number}}
 */
export function monthCells(state, month, { inkOf, hasInk = null, policy = defaultPolicy } = {}) {
  const has = typeof hasInk === 'function' ? hasInk : record => inkPointsPresent(inkOf, record);
  const r = monthMembers(state, month, { pick: policy.monthSheetPick, hasInk: has });
  const raw = r.members.map(m => cellOfMember(m, inkOf, { under: true }));
  const cells = withDayTags(raw);
  return { month: r.month, days: r.days, cells, members: r.members, inked: cells.filter(c => c.mode === 'hand').length };
}

/**
 * 成图计划（纯函数）：成员、取墨、数量、状态、分页。
 * @param {object} state
 * @param {{kind:'session'|'day'|'month'|'glyph', slot?, sessionId?, day?, month?, char?}} scope
 * @param {{inkOf:(record)=>Array|null, hasInk?:(record)=>boolean, policy?:object}} o
 *   hasInk：D42 挑「时间段内留有墨迹的那一次」时判断一条记录有没有墨迹——界面层传按月表查找的廉价判据（不解码，ink-pick.js storedInkPresent）；
 *   缺省按 inkOf 的结果判断（要解码，单测与小数据用）。
 * @returns {{kind, status:'ready'|'empty'|'noInk', key, day, month, days, members, cells, drawn, missing, n, pages, maxChars, recordIds, work?}}
 *   cells = 全部要画的格子（render 用）；pages = cells 按 D39 分页（≤ maxChars 一页；session 的默认顺序即组内顺序，不分日）；
 *   drawn = 有墨的格子（glyph 图用 drawn[0].points）；missing = 没画进去的字（day / session 里缺墨的）。
 */
export function imagePlan(state, scope, { inkOf, hasInk = null, policy = defaultPolicy } = {}) {
  const kind = scope && scope.kind;
  if (!IMAGE_KINDS.includes(kind)) throw new Error('INVALID_KIND');
  const maxChars = Number.isSafeInteger(policy.imageMaxChars) ? policy.imageMaxChars : MAX_CHARS_PER_PAGE;
  const has = typeof hasInk === 'function' ? hasInk : record => inkPointsPresent(inkOf, record);
  let members = [];
  let cells = [];
  let day = null;
  let month = null;
  let days = null;
  let work = null;
  let missing = [];
  let key;
  if (kind === 'session') {
    const r = sessionWork(state, { slot: scope.slot || null, sessionId: scope.sessionId, hasInk: has });
    work = r.work;
    day = r.day;
    key = scope.sessionId;
    members = work.cells;
    cells = work.cells.map(e => ({ ch: e.char, ink: pointsOf(inkOf, e.record), mode: 'hand', dot: e.dot, tag: '', day, record: e.record }));
    missing = work.entries.filter(e => e.state !== 'in' && e.state !== 'added' && e.state !== 'addable').map(e => e.char);
  } else if (kind === 'day') {
    const r = dayMembers(state, scope.day, { hasInk: has });
    members = r.members;
    day = r.day;
    key = scope.day;
    for (const m of members) {
      const cell = cellOfMember(m, inkOf);
      if (cell) cells.push(cell);
      else missing.push(m.char);
    }
  } else if (kind === 'month') {
    const r = monthCells(state, scope.month, { inkOf, hasInk: has, policy });
    members = r.members;
    cells = r.cells;
    month = r.month;
    days = r.days;
    key = scope.month;
  } else {
    const m = glyphMember(state, scope.char);
    members = m ? [m] : [];
    day = m ? m.record.localDay : null;
    key = scope.char;
    const cell = m ? cellOfMember(m, inkOf) : null;
    cells = cell ? [cell] : [];
    if (m && !cell) missing = [m.char]; // 最近一次没有笔迹：不生成，也不借别次（I03）
  }
  const drawn = cells.filter(c => c.mode === 'hand').map(c => ({ char: c.ch, record: c.record, points: c.ink, tag: c.tag }));
  let status = 'ready';
  if (kind === 'glyph') status = drawn.length ? 'ready' : 'noInk';
  else if (!cells.length) status = 'empty';
  const pages = kind === 'glyph' || !cells.length ? (cells.length ? [cells] : []) : retagPagesFor(kind, paginate(cells, maxChars));
  return {
    kind,
    key,
    status,
    day,
    month,
    days,
    maxChars,
    members,
    cells,
    drawn,
    missing,
    n: cells.length,
    pages,
    work,
    recordIds: cells.filter(c => c.record).map(c => c.record.id),
  };
}

function retagPagesFor(kind, pages) {
  return kind === 'month' ? retagPages(pages, dayTag) : pages;
}
