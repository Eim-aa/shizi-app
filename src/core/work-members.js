// 作品成员规则（纯函数，无 DOM；D27 Q1 / D31 / D42 / D51 ⑤；第二轮审查 N2-06、汇总-第二轮 R1）。
//
// 哪些字算「我的作品」只有这一条规则，首页今天的字帖行、结果页作品与这次的图片、月字帖（含「我的」里的预览）、年报四个出口共用：
//   作品 = 写对 ∪ 看后自写（看过答案、且留有自己写一遍的本人墨，D27 Q1）；
//   写错的字只在用户手动放进来时进入（added：记录 id 集合），并且一律带朱点（dot，D46 ⑥）；
//   不进：写错没放进来、跳过、看过答案没写、纸上记录（D46 ⑬ / D47：没有笔迹就不进作品）。
// 每字取某个时间段内的一条记录（D42）：段内按偏好方向（'first' 从早到晚 / 'last' 从晚到早）找留有墨迹的那一次，一份墨迹都没有才取偏好方向上的那一条
//   （格子画 under 衬底）；时间段由调用方先用 records 的筛选给出，段外的墨迹不冒充。
// 「没有墨」与成员资格是两件事：写对的字没留下墨迹仍是成员（月字帖、首页画衬底，不写「没有笔迹」）；结果页作品（core/images/work.js buildWork）要画本人墨，
//   所以那里另要求有墨——它们成员资格的判定都经过 isWorkMember（test/core/work-members.test.mjs 逐种情形对照）。

import { compareRecordIds, isAfterSeenWork, isPaperRecord } from './records.js';
import { pickRecordInPeriod } from './ink-pick.js';

function addedHas(added, id) {
  if (!added || typeof id !== 'string') return false;
  if (typeof added.has === 'function') return added.has(id);
  return Array.isArray(added) && added.includes(id);
}

/**
 * 一条记录算不算作品成员（单一来源）。
 * @param {object} record
 * @param {{hasInk?:(record)=>boolean, added?:Set<string>|string[]}} [o]
 *   hasInk：看后自写有没有本人墨（缺省按没有）；added：用户手动放进来的记录 id（只对写错的记录有意义）。
 */
export function isWorkMember(record, { hasInk = null, added = null } = {}) {
  if (!record) return false;
  if (record.kind === 'judged') {
    if (isPaperRecord(record)) return false;
    return record.judgment === 'wrong' ? addedHas(added, record.id) : true;
  }
  if (record.kind === 'answer-seen') return isAfterSeenWork(record, hasInk);
  return false;
}

/** 这条成员记录要不要带朱点：写错而被手动放进来的（isWorkMember 为真的写错记录一定是手动放进来的）。 */
export function isWrongMember(record) {
  return !!record && record.kind === 'judged' && record.judgment === 'wrong';
}

/** 从一批记录里筛出作品成员记录（id 升序）。 */
export function workMemberRecords(records, opts = {}) {
  return (records || []).filter(r => isWorkMember(r, opts)).sort((a, b) => compareRecordIds(a.id, b.id));
}

function charOf(record) {
  if (typeof record.char === 'string' && record.char) return record.char;
  const key = typeof record.cardKey === 'string' ? record.cardKey : '';
  return key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
}

/**
 * 一个时间段的作品成员：记录先过成员规则，再按字分组，每字取一条（D42）。
 * @param {object[]} records  这个时间段内的记录（任意顺序；段外的记录不要放进来）
 * @param {{prefer?:'first'|'last', order?:'first'|'last', hasInk?:(record)=>boolean, pickInk?:((record)=>boolean)|null, added?:Set<string>|string[]}} [o]
 *   prefer：每字取哪一次（缺省 'last'）；order：成员顺序——'first' = 字在段内第一次出现的先后（月字帖、这天的图片），
 *   'last' = 字最近一次出现的先后（首页今天的字帖行：同一个字再写一遍挪到后面，决定-D12）。
 * @returns {Array<{char:string, cardKey:string, record:object, firstDay:string|null, dot:boolean}>}
 *   firstDay = 这个字在段内（作为成员）第一次出现的日子——月字帖的排序与角标都用它。
 */
export function workMembers(records, { prefer = 'last', order = 'first', hasInk = null, pickInk = undefined, added = null } = {}) {
  const sorted = workMemberRecords(records, { hasInk, added });
  const byChar = new Map();
  for (const r of sorted) {
    const char = charOf(r);
    const row = byChar.get(char);
    if (!row) byChar.set(char, { char, list: [r] });
    else row.list.push(r);
  }
  let rows = [...byChar.values()];
  if (order === 'last') rows = rows.sort((a, b) => compareRecordIds(a.list[a.list.length - 1].id, b.list[b.list.length - 1].id));
  // pickInk 缺省与 hasInk 同一个判据；显式传 null = 不做 D42（每字就取偏好方向上的那一条）
  const picker = pickInk === undefined ? hasInk : pickInk;
  const inkTest = typeof picker === 'function' ? picker : null;
  return rows.map(row => {
    const { record } = pickRecordInPeriod(row.list, { prefer: prefer === 'first' ? 'first' : 'last', hasInk: inkTest });
    return { char: row.char, cardKey: record.cardKey, record, firstDay: row.list[0].localDay || null, dot: isWrongMember(record) };
  });
}
