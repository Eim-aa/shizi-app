// 记录（Record）的构造、校验与查询。纯函数；输入输出都是 01-架构设计 §3.2 的普通对象，不访问存储。
//
// Record {
//   id: 'r<序号>', cardKey, char, sessionId,
//   kind: 'judged' | 'answer-seen' | 'skipped',   // 只有 judged 是「有效记录」（决定-D18/D23）
//   judgment?: 'correct' | 'wrong',               // kind==='judged' 必填
//   at, localDay,
//   help: { hints, answerSeen, traced },          // 帮助事实，永不因更正删除（决定-D07）
//   corrections?: [{ from, at }],                 // 更正历史；更正不新增记录（决定-D19）
//   inkId?, legacy?,
//   source?: 'screen' | 'paper'                   // 阶段 1 P1-E8（D46 ⑬）：缺省 = screen（旧数据不重写）；纸上记录只能是 judged、不带墨迹
// }
//
// 口径：
// - 「最近一次」以 id 序号为准（§3.1），at/localDay 只做展示与月归属。
// - 「写错过」= 某字最近一次 judged 为 wrong（K15）；「快忘了」= 最近一次 judged 为 correct 且 FSRS 到期（§5），
//   两单互斥（K16）。更正为对同样离开写错过（I02）。
// - 「今天记录了 N 个字」= 今天 judged 按字去重；墨迹行取最近 8 条（按 id，同字留最近一次，决定-D12）。

import * as defaultPolicy from '../config/policy.js';
import { HINTS_SHAPE_MAX } from './schema.js';
import { localDay, isValidDay, monthOf, diffDays } from './dates.js';

export const RECORD_KINDS = Object.freeze(['judged', 'answer-seen', 'skipped']);
export const JUDGMENTS = Object.freeze(['correct', 'wrong']);
/** 书写方式（阶段 1 P1-E8，D46 ⑬ / 03 P166）：screen = 写在书写格里（缺省，不写进记录）；paper = 在纸上写、回来自判。 */
export const RECORD_SOURCES = Object.freeze(['screen', 'paper']);

const RECORD_ID_RE = /^r([1-9]\d*)$/;
const SESSION_ID_RE = /^s([1-9]\d*)$/;
const CARD_KEY_RE = /^(base|custom):(.+)$/u;

// ---- id 与序号（§3.1）----

/** 'r12' → 12；不合法返回 NaN。 */
export function recordSerial(id) {
  const m = typeof id === 'string' ? RECORD_ID_RE.exec(id) : null;
  return m ? Number(m[1]) : NaN;
}

/** 's7' → 7；不合法返回 NaN。 */
export function sessionSerial(id) {
  const m = typeof id === 'string' ? SESSION_ID_RE.exec(id) : null;
  return m ? Number(m[1]) : NaN;
}

export function recordId(serial) {
  if (!Number.isInteger(serial) || serial < 1) throw new RangeError('serial must be a positive integer');
  return 'r' + serial;
}

export function sessionId(serial) {
  if (!Number.isInteger(serial) || serial < 1) throw new RangeError('serial must be a positive integer');
  return 's' + serial;
}

/** 按 id 序号升序比较（不合法 id 排最前）。 */
export function compareRecordIds(a, b) {
  const sa = recordSerial(a);
  const sb = recordSerial(b);
  return (Number.isNaN(sa) ? -1 : sa) - (Number.isNaN(sb) ? -1 : sb);
}

export function sortById(records) {
  return [...(records || [])].sort((x, y) => compareRecordIds(x.id, y.id));
}

/**
 * 下一个可用序号 = max(records、sessions 中已用序号, meta.serial) + 1（§3.1；允许空洞）。
 * sessions 形如 {A, B, lastEnded:{A?, B?}}；会话 id 与 items[].recordId 都计入。
 */
export function nextSerial({ records = [], sessions = null, metaSerial = 0 } = {}) {
  let max = Number.isInteger(metaSerial) && metaSerial > 0 ? metaSerial : 0;
  for (const r of records) {
    const s = recordSerial(r && r.id);
    if (s > max) max = s;
  }
  const visit = (session) => {
    if (!session) return;
    const s = sessionSerial(session.id);
    if (s > max) max = s;
    for (const item of session.items || []) {
      const rs = recordSerial(item && item.recordId);
      if (rs > max) max = rs;
    }
  };
  if (sessions) {
    visit(sessions.A);
    visit(sessions.B);
    if (sessions.lastEnded) {
      visit(sessions.lastEnded.A);
      visit(sessions.lastEnded.B);
    }
  }
  return max + 1;
}

// ---- 卡键 ----

/** 'base:静' → '静'；不合法返回 null。 */
export function charOfCardKey(cardKey) {
  const m = typeof cardKey === 'string' ? CARD_KEY_RE.exec(cardKey) : null;
  if (!m) return null;
  return Array.from(m[2]).length === 1 ? m[2] : null;
}

// ---- 构造与校验 ----

function normalizeHelp(help) {
  const h = help || {};
  const hints = Number(h.hints) || 0;
  return {
    hints: Math.max(0, Math.min(HINTS_SHAPE_MAX, Math.trunc(hints))),
    answerSeen: h.answerSeen === true,
    traced: h.traced === true,
  };
}

/** 记录形状校验；返回错误列表（空 = 合法）。 */
export function validateRecord(r) {
  const errors = [];
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['record must be an object'];
  if (Number.isNaN(recordSerial(r.id))) errors.push('id must look like r<serial>');
  const ch = charOfCardKey(r.cardKey);
  if (!ch) errors.push('cardKey must be base:<字> or custom:<字>');
  else if (r.char !== ch) errors.push('char must match cardKey');
  if (!RECORD_KINDS.includes(r.kind)) errors.push('kind must be judged | answer-seen | skipped');
  if (r.kind === 'judged') {
    if (!JUDGMENTS.includes(r.judgment)) errors.push('judged record needs judgment correct | wrong');
  } else if (r.judgment !== undefined) {
    errors.push('only judged records carry a judgment');
  }
  if (!r.legacy && Number.isNaN(sessionSerial(r.sessionId))) errors.push('sessionId must look like s<serial>');
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) errors.push('at must be a finite ms timestamp');
  if (!isValidDay(r.localDay)) errors.push('localDay must be YYYY-MM-DD');
  const help = r.help;
  if (!help || typeof help !== 'object') errors.push('help must be an object');
  else {
    if (!Number.isInteger(help.hints) || help.hints < 0 || help.hints > HINTS_SHAPE_MAX) errors.push('help.hints must be an integer 0..' + HINTS_SHAPE_MAX);
    if (typeof help.answerSeen !== 'boolean') errors.push('help.answerSeen must be boolean');
    if (typeof help.traced !== 'boolean') errors.push('help.traced must be boolean');
  }
  if (r.corrections !== undefined) {
    if (!Array.isArray(r.corrections)) errors.push('corrections must be an array');
    else if (r.kind !== 'judged') errors.push('only judged records can be corrected');
    else if (r.corrections.some((c) => !c || !JUDGMENTS.includes(c.from) || typeof c.at !== 'number')) {
      errors.push('corrections entries must be {from, at}');
    }
  }
  if (r.inkId !== undefined && typeof r.inkId !== 'string') errors.push('inkId must be a string');
  if (r.legacy !== undefined && r.legacy !== true) errors.push('legacy must be true when present');
  if (r.source !== undefined) {
    if (!RECORD_SOURCES.includes(r.source)) errors.push('source must be screen | paper');
    else if (r.source === 'paper') {
      if (r.kind !== 'judged') errors.push('only judged records can be on paper');
      if (r.inkId !== undefined) errors.push('a paper record has no ink (inkId not allowed)');
    }
  }
  return errors;
}

/**
 * 构造一条记录。localDay 由 at 按本地日推出；help 规整为 {hints, answerSeen, traced}。
 * 形状不合法时抛错（调用方在 commit 前构造，错误属于编程错误）。
 */
export function makeRecord({ id, cardKey, sessionId: sid, kind, judgment, at, help, inkId, source }) {
  const record = {
    id,
    cardKey,
    char: charOfCardKey(cardKey),
    sessionId: sid,
    kind,
    at,
    localDay: typeof at === 'number' && Number.isFinite(at) ? localDay(at) : undefined,
    help: normalizeHelp(help),
  };
  // 非 judged 带 judgment 视为编程错误：放进对象让校验报出来，而不是静默丢掉。
  if (kind === 'judged' || judgment !== undefined) record.judgment = judgment;
  if (kind === 'answer-seen') record.help.answerSeen = true;
  if (inkId !== undefined) record.inkId = inkId;
  // 书写方式：screen 是缺省，不写进记录（旧数据不带 source，读取时同样按 screen，P166）；其余值放进去让校验报出来。
  if (source !== undefined && source !== 'screen') record.source = source;
  const errors = validateRecord(record);
  if (errors.length) throw new RangeError('invalid record: ' + errors.join('; '));
  return record;
}

export function isJudged(r) {
  return !!r && r.kind === 'judged';
}

// ---- 纸上记录（阶段 1 P1-E8，D46 ⑬ / D47；03 P166 / P169）----
// 纸上记录是有效记录：判断、FSRS、写错过 / 快忘了、字库字数、字墙照常。只有「画本人笔迹」的地方没有它：
// 作品（结果页、这次 / 这天的图片）、月字帖、年报，以及年报与月份的字数（D47）都只收 isWorkRecord。

/** 记录的书写方式：source 缺省（旧数据、屏幕上写的）= 'screen'。 */
export function recordSource(r) {
  return r && r.source === 'paper' ? 'paper' : 'screen';
}

/** 在纸上写、回来自判的记录（没有墨迹，标注「纸上」）。 */
export function isPaperRecord(r) {
  return !!r && r.source === 'paper';
}

/** 能进作品 / 图片 / 月字帖 / 年报（含年字数、月字数）的记录：judged 且不在纸上（D46 ⑬ / D47）。 */
export function isWorkRecord(r) {
  return isJudged(r) && !isPaperRecord(r);
}

/**
 * 看后自写（Q1，QA simB D1；D31「写对与看后自己写的字」）：看过答案、且这条记录上留有「自己写一遍」的本人墨。
 * 它仍不是有效记录（D18 / D23：不算写对写错、不进统计 / 清单 / 日历），只在画本人笔迹的作品出口里与 isWorkRecord 并列：
 * 结果页作品与这次的图片（core/images/work.js）、这天的图片与月字帖、年报（含年字数 / 月字数）。hasInk 由调用方注入。
 */
export function isAfterSeenWork(r, hasInk) {
  if (!r || r.kind !== 'answer-seen' || typeof hasInk !== 'function') return false;
  try {
    return !!hasInk(r);
  } catch (error) {
    return false;
  }
}

/** 作品出口收的记录：isWorkRecord ∪ isAfterSeenWork（Q1）。 */
export function isWorkOrAfterSeen(r, hasInk) {
  return isWorkRecord(r) || isAfterSeenWork(r, hasInk);
}

/** 去掉纸上记录（时间段视图先过一遍再交给 core/ink-pick：段内只有纸上记录的字不出现、不计数，D47）。 */
export function withoutPaper(records) {
  return (records || []).filter((r) => !isPaperRecord(r));
}

/**
 * 折叠月份（01 §9）里「作品」的 byDay：byDay 去掉只在纸上写过的（日, 字）（fold.paperOnly，折叠时记下，P1-E78）；
 * 去掉后没有字的日子不出现。没有 paperOnly（该月折叠时还没有纸上记录，或没有纸上记录）就是 byDay 本身。
 * 日历「写过的日子」不用它——纸上那天仍算写过（D47）。
 * @returns {{[localDay]: string[]}}
 */
export function foldWorkByDay(fold) {
  const byDay = fold && fold.byDay && typeof fold.byDay === 'object' ? fold.byDay : {};
  const paperOnly = fold && fold.paperOnly && typeof fold.paperOnly === 'object' ? fold.paperOnly : null;
  const out = {};
  for (const [day, chars] of Object.entries(byDay)) {
    if (!Array.isArray(chars)) continue;
    const skip = paperOnly && Array.isArray(paperOnly[day]) ? paperOnly[day] : null;
    const kept = skip ? chars.filter((c) => !skip.includes(c)) : chars.slice();
    if (kept.length) out[day] = kept;
  }
  return out;
}

/**
 * 更正（决定-D19）：只改 judgment、追加 corrections；id/at/localDay 不变、帮助事实不变。
 * 同判断视为无变化（返回原对象）。legacy 记录与非 judged 记录不可更正（K25）。
 */
export function correctRecord(record, judgment, at) {
  if (!isJudged(record)) throw new RangeError('only judged records can be corrected');
  if (record.legacy) throw new RangeError('legacy records cannot be corrected');
  if (!JUDGMENTS.includes(judgment)) throw new RangeError('judgment must be correct or wrong');
  if (record.judgment === judgment) return record;
  return {
    ...record,
    judgment,
    corrections: [...(record.corrections || []), { from: record.judgment, at }],
  };
}

/** 用同 id 的新记录替换（保持数组顺序）。 */
export function replaceRecord(records, next) {
  let found = false;
  const out = records.map((r) => {
    if (r.id === next.id) {
      found = true;
      return next;
    }
    return r;
  });
  if (!found) throw new RangeError('record not found: ' + String(next && next.id));
  return out;
}

/** 删除一条记录（跳过撤销，走查-W16）。 */
export function removeRecord(records, id) {
  const out = records.filter((r) => r.id !== id);
  if (out.length === records.length) throw new RangeError('record not found: ' + String(id));
  return out;
}

// ---- 查询 ----

/** 每个 cardKey 最近一次 judged 记录（按 id 序号，决定-D23）。 */
export function latestJudgedByCard(records) {
  const latest = new Map();
  for (const r of records || []) {
    if (!isJudged(r)) continue;
    const prev = latest.get(r.cardKey);
    if (!prev || compareRecordIds(prev.id, r.id) < 0) latest.set(r.cardKey, r);
  }
  return latest;
}

export function latestJudged(records, cardKey) {
  return latestJudgedByCard((records || []).filter((r) => r.cardKey === cardKey)).get(cardKey) || null;
}

/** 某字的全部记录（按 id 升序）。 */
export function recordsOfCard(records, cardKey) {
  return sortById((records || []).filter((r) => r.cardKey === cardKey));
}

/** 「记录了 N 次」= 该字 judged 条数。 */
export function judgedCountOfCard(records, cardKey) {
  return (records || []).filter((r) => isJudged(r) && r.cardKey === cardKey).length;
}

/** 「一共写错 N 次」= 该字当前判断为 wrong 的 judged 条数（更正后按新判断）。 */
export function wrongCountOfCard(records, cardKey) {
  return (records || []).filter((r) => isJudged(r) && r.cardKey === cardKey && r.judgment === 'wrong').length;
}

/** 该字第一条 judged 记录（年报/「从 X 开始记录」）。 */
export function firstJudgedOfCard(records, cardKey) {
  return sortById((records || []).filter((r) => isJudged(r) && r.cardKey === cardKey))[0] || null;
}

/** 有 judged 记录的 cardKey 集合。 */
export function writtenCardKeys(records) {
  return new Set(latestJudgedByCard(records).keys());
}

export function hasAnyJudged(records) {
  return (records || []).some(isJudged);
}

/** 写错过（K15）：最近一次 judged 为 wrong 的字，最近写错的排前。返回这些最近记录。 */
export function wrongList(records) {
  return [...latestJudgedByCard(records).values()]
    .filter((r) => r.judgment === 'wrong')
    .sort((a, b) => compareRecordIds(b.id, a.id));
}

export function isInWrongList(records, cardKey) {
  const r = latestJudged(records, cardKey);
  return !!r && r.judgment === 'wrong';
}

/**
 * 快忘了（K16，P04）：最近一次 judged 为 correct 且 sched 到期（due ≤ today，无 stoppedAt）。
 * 排序：逾期天数降序 → 稳定度升序 → 最近记录 id 升序；最多 policy.forgetCap 个。
 * @returns {{items: Array<{cardKey, record, due, overdue}>, total: number}}
 */
export function forgetList({ records, sched, today, policy = defaultPolicy }) {
  if (policy.forgetRule !== 'due') throw new RangeError('unsupported policy.forgetRule: ' + String(policy.forgetRule));
  const all = [];
  for (const [cardKey, record] of latestJudgedByCard(records)) {
    if (record.judgment !== 'correct') continue;
    const entry = sched ? sched[cardKey] : undefined;
    if (!entry || entry.stoppedAt !== undefined || !isValidDay(entry.due)) continue;
    const overdue = diffDays(entry.due, today);
    if (overdue < 0) continue;
    all.push({ cardKey, record, due: entry.due, overdue, stability: entry.fsrs ? Number(entry.fsrs.stability) || 0 : 0 });
  }
  all.sort((a, b) => b.overdue - a.overdue || a.stability - b.stability || compareRecordIds(a.record.id, b.record.id));
  const cap = Number.isInteger(policy.forgetCap) && policy.forgetCap >= 0 ? policy.forgetCap : all.length;
  return {
    items: all.slice(0, cap).map(({ cardKey, record, due, overdue }) => ({ cardKey, record, due, overdue })),
    total: all.length,
  };
}

/** 某天有 judged 记录的 cardKey 集合。 */
export function judgedCardKeysOn(records, day) {
  const out = new Set();
  for (const r of records || []) if (isJudged(r) && r.localDay === day) out.add(r.cardKey);
  return out;
}

/** 某天有「看过答案」记录的 cardKey 集合。 */
export function answerSeenCardKeysOn(records, day) {
  const out = new Set();
  for (const r of records || []) if (r && r.kind === 'answer-seen' && r.localDay === day) out.add(r.cardKey);
  return out;
}

/** 「今天记录了 N 个字」：今天 judged 按字去重的个数。 */
export function todayCount(records, today) {
  return judgedCardKeysOn(records, today).size;
}

/** 本日 judged 的「复习字」个数：今天有 judged、且在今天以前已有 judged（每日上限记账，§5「练完记账」）。 */
export function reviewsDoneOn(records, day) {
  const firstDay = new Map();
  for (const r of records || []) {
    if (!isJudged(r)) continue;
    const prev = firstDay.get(r.cardKey);
    if (!prev || r.localDay < prev) firstDay.set(r.cardKey, r.localDay);
  }
  let count = 0;
  for (const key of judgedCardKeysOn(records, day)) {
    if (firstDay.get(key) < day) count += 1;
  }
  return count;
}

/** 按月索引：{ 'YYYY-MM': Record[]（按 id 升序） }（对应 shizi.v2.records.<YYYY-MM> 分键）。 */
export function recordsByMonth(records) {
  const out = {};
  for (const r of sortById(records)) {
    const month = monthOf(r.localDay);
    (out[month] || (out[month] = [])).push(r);
  }
  return out;
}

/** 某月有 judged 记录的日子（升序），练习记录日历用（R-P01：只标当天写过的日子）。 */
export function judgedDaysInMonth(records, month) {
  const days = new Set();
  for (const r of records || []) if (isJudged(r) && r.localDay.startsWith(month + '-')) days.add(r.localDay);
  return [...days].sort();
}
