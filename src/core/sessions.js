// 会话（Session）状态与选字。纯函数；输入输出都是 01-架构设计 §3.3 的普通对象，不访问存储。
//
// sessions = { A: Session|null, B: Session|null, lastEnded: { A?: Session, B?: Session } }
//   A = first / daily（第一次练习 / 今天的练习）；B = picked（这次选的字）。两槽互不覆盖（决定-D05）。
//   lastEnded[slot] 保留最近结束的会话，供结果页、来源行、离开按钮只读；下次开同槽时清掉。
//
// Session {
//   id, slot, kind: 'first'|'daily'|'picked', source: {view, char?},
//   queue: [cardKey], cursor,
//   items: [{cardKey, recordId?, kind, fsrsBefore?}],   // fsrsBefore 只活在会话里，供本会话更正重放
//   current: {phase, strokes, hints, answerSeen, hintRange, referenceReady},
//   lastLine: {recordId, kind:'record'|'changed'|'saw'} | null,
//   startedAt, startedDay, updatedAt, endedAt?, endedEarly?
// }
//
// 选字（§5）：
// - 第一次练习：固定 policy.firstQueue（P09，已决定 D38：尴 → 赢 → 拾，3 个字；首练组大小 = 队列长度，之后每组仍是 policy.groupSize）。
// - 今天的练习（已决定 D41「保底一新 + 积压阀」，src/core/mix.js）：到期字按逾期天数降序、稳定度升序取，
//   与新字按积压天数 p 配比（p<0.5 且最近新字写对率 ≥0.6 → 3 新，p<1.5 → 2 新，p<4 → 1 新，p≥4 → 上一组有新字则全复习）；
//   到期不够时用最快到期的字提前复习补位（不计入每日复习上限 policy.dailyReviewCap，P03，练完记账）；
//   组内复、新交错，组尾放好写的字；热身字（D28 / P126）每组至多 1 个、放组首。排除今天已有 judged 的字；skipped 不影响；
//   answer-seen 按 policy.answerSeenScope（P36）；自选未写按 policy.customIntoDaily（P33）。组大小 policy.groupSize（P03）。
// - 新字顺序由调用方给（src/core/new-order.js：易忘度清单，D28）；累计满 10 组且 p<1.5 时日常组换成大写数字特别组（D40，src/core/special.js）。

import * as defaultPolicy from '../config/policy.js';
import { addDays, localDay } from './dates.js';
import { charOfCardKey, isJudged, judgedCardKeysOn, answerSeenCardKeysOn, hasAnyJudged, skippedCardKeysOn, sortById } from './records.js';
import { overdueDays } from './fsrs.js';
import { arrangeGroup, dueReviewsDoneOn, newUserCapOf, planGroup, practiceStats, pressureOf, scaledCount, warmupAllowed } from './mix.js';
import { dailyReviewCapOf, validGroupSize } from './group-size.js';
import { isWarmupKey } from './new-order.js';
import { capitalAfterKeysFor, capitalSpecial } from './special.js';

export const SESSION_KINDS = Object.freeze(['first', 'daily', 'picked']);
export const PHASES = Object.freeze(['recall', 'compare', 'answer', 'trace', 'retrace']);
const SLOT_OF_KIND = Object.freeze({ first: 'A', daily: 'A', picked: 'B' });

export function slotOfKind(kind) {
  const slot = SLOT_OF_KIND[kind];
  if (!slot) throw new RangeError('unknown session kind: ' + String(kind));
  return slot;
}

export function emptySessions() {
  return { A: null, B: null, lastEnded: {} };
}

export function freshCurrent() {
  return { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false };
}

/** 新建会话。queue 必须是不重复的 cardKey 列表。 */
export function createSession({ id, kind, source, queue, at }) {
  const slot = slotOfKind(kind);
  if (typeof id !== 'string' || !/^s[1-9]\d*$/.test(id)) throw new RangeError('session id must look like s<serial>');
  if (!Array.isArray(queue) || queue.length === 0) throw new RangeError('queue must be a non-empty array');
  if (new Set(queue).size !== queue.length) throw new RangeError('queue must not repeat a card');
  if (queue.some((k) => !charOfCardKey(k))) throw new RangeError('queue entries must be card keys');
  if (typeof at !== 'number' || !Number.isFinite(at)) throw new RangeError('at must be a finite ms timestamp');
  return {
    id,
    slot,
    kind,
    source: source ? { ...source } : { view: 'home' },
    queue: [...queue],
    cursor: 0,
    items: [],
    current: freshCurrent(),
    lastLine: null,
    startedAt: at,
    startedDay: localDay(at),
    updatedAt: at,
  };
}

export function currentCardKey(session) {
  if (!session || session.cursor >= session.queue.length) return null;
  return session.queue[session.cursor];
}

/** 还没写的字（含当前字）。 */
export function remainingKeys(session) {
  return session ? session.queue.slice(session.cursor) : [];
}

export function remainingCount(session) {
  return session ? Math.max(0, session.queue.length - session.cursor) : 0;
}

export function isComplete(session) {
  return !!session && session.cursor >= session.queue.length;
}

/** 本会话有判断的条目。 */
export function judgedItems(session) {
  return session ? session.items.filter((it) => it.kind === 'judged') : [];
}

/** 更新当前字的现场（笔画、提示、阶段…）。 */
export function withCurrent(session, patch, at) {
  if (patch && patch.phase !== undefined && !PHASES.includes(patch.phase)) {
    throw new RangeError('unknown phase: ' + String(patch.phase));
  }
  return { ...session, current: { ...session.current, ...patch }, updatedAt: at ?? session.updatedAt };
}

/**
 * 当前字处理完（judged / answer-seen / skipped）→ 追加 item、推进 cursor、重置现场、更新结果行。
 * 结果行（决定-D19 / 走查-X02）：判断 → 'record'；看过答案 → 'saw'；跳过 → 清空。
 */
export function advance(session, { cardKey, recordId, kind, fsrsBefore, at }) {
  if (currentCardKey(session) !== cardKey) throw new RangeError('advance: not the current card');
  if (!['judged', 'answer-seen', 'skipped'].includes(kind)) throw new RangeError('advance: unknown item kind');
  const item = { cardKey, kind };
  if (recordId !== undefined) item.recordId = recordId;
  if (kind === 'judged' && fsrsBefore !== undefined) item.fsrsBefore = fsrsBefore;
  let lastLine = null;
  if (kind === 'judged' && recordId) lastLine = { recordId, kind: 'record' };
  else if (kind === 'answer-seen' && recordId) lastLine = { recordId, kind: 'saw' };
  return {
    ...session,
    items: [...session.items, item],
    cursor: session.cursor + 1,
    current: freshCurrent(),
    lastLine,
    updatedAt: at ?? session.updatedAt,
  };
}

/** 结果行上的「修改」完成后：同一记录的行改为「已改为…」。 */
export function markLineChanged(session, recordId) {
  if (!session.lastLine || session.lastLine.recordId !== recordId) return session;
  return { ...session, lastLine: { recordId, kind: 'changed' } };
}

/** 结果行收起（落笔 / 跳过 / 确认看答案，决定-D19）。 */
export function clearLine(session) {
  return session.lastLine ? { ...session, lastLine: null } : session;
}

/** 跳过撤销（走查-W16）：最后一个 item 必须是这条 skipped；字放回 cursor，current 回到 recall。 */
export function undoSkip(session, recordId, at) {
  const last = session.items[session.items.length - 1];
  if (!last || last.kind !== 'skipped' || last.recordId !== recordId) throw new RangeError('undoSkip: last item is not this skip');
  return {
    ...session,
    items: session.items.slice(0, -1),
    cursor: session.cursor - 1,
    current: freshCurrent(),
    lastLine: null,
    updatedAt: at ?? session.updatedAt,
  };
}

/** 本会话某字判断前的卡（更正重放用）；没有返回 undefined（会话已结束或不是本会话判断）。 */
export function fsrsBeforeOf(session, recordId) {
  const item = session ? session.items.find((it) => it.recordId === recordId && it.kind === 'judged') : null;
  return item ? item.fsrsBefore : undefined;
}

/** 本会话结果页仍可见的判断记录才可更正（决定-D19，§3.2）。 */
export function canCorrect(session, recordId) {
  return !!session && !!session.items.find((it) => it.recordId === recordId && it.kind === 'judged' && 'fsrsBefore' in it);
}

// ---- 槽位 ----

/**
 * 在对应槽位开新会话。槽位必须为空（B 有未完成会话走 S02 的 endAndStartPicked）；清掉同槽 lastEnded。
 * 另一槽不动（决定-D05）。
 */
export function startInSlot(sessions, session) {
  const slot = session.slot;
  if (sessions[slot]) throw new RangeError('slot ' + slot + ' is occupied');
  const lastEnded = { ...(sessions.lastEnded || {}) };
  delete lastEnded[slot];
  return { ...sessions, [slot]: session, lastEnded };
}

/** 结束槽位里的会话 → 移入 lastEnded[slot]。early = 中途结束（决定-D22）。 */
export function endSlot(sessions, slot, { at, early = false } = {}) {
  const session = sessions[slot];
  if (!session) throw new RangeError('slot ' + slot + ' is empty');
  const ended = { ...session, endedAt: at };
  if (early) ended.endedEarly = true;
  return { ...sessions, [slot]: null, lastEnded: { ...(sessions.lastEnded || {}), [slot]: ended } };
}

/** 离开结果页后清掉 lastEnded[slot]。 */
export function clearLastEnded(sessions, slot) {
  if (!sessions.lastEnded || !sessions.lastEnded[slot]) return sessions;
  const lastEnded = { ...sessions.lastEnded };
  delete lastEnded[slot];
  return { ...sessions, lastEnded };
}

/**
 * 首页「继续写字」两行（S01 / R-H04）：B 优先续写，A 保留；只列未完成的会话。
 * @returns {Array<{slot, kind, remaining}>}
 */
export function resumeLines(sessions) {
  const out = [];
  for (const slot of ['B', 'A']) {
    const s = sessions[slot];
    if (s && !isComplete(s)) out.push({ slot, kind: s.kind, remaining: remainingCount(s) });
  }
  return out;
}

/**
 * S02 开新组确认框的数据（R-H05 / T08）：旧 B 未完成时返回没写的字与已判断数，否则 null。
 * 「上一组还有「鲜」「境」没写。」
 */
export function s02Prompt(sessions) {
  const b = sessions.B;
  if (!b || isComplete(b)) return null;
  const unwrittenKeys = remainingKeys(b);
  return {
    sessionId: b.id,
    unwrittenKeys,
    unwrittenChars: unwrittenKeys.map(charOfCardKey),
    judgedCount: judgedItems(b).length,
  };
}

/**
 * S02「结束那组，开新的」= 一次 commit 的数据变换（§3.3）：旧 B 置 endedEarly/endedAt 移入 lastEnded.B，建新 B。
 * P38 过渡默认（policy.s02EndOld='toast'）：不进旧 B 结果页；旧 B 有判断时给轻提示（M 个字已经记下）。
 * @returns {{sessions, notice: null | {kind:'oldGroupSaved', judgedCount}, showOldResult: boolean}}
 */
export function endAndStartPicked(sessions, newSession, { at, policy = defaultPolicy } = {}) {
  if (newSession.slot !== 'B') throw new RangeError('endAndStartPicked: new session must be picked');
  const old = sessions.B;
  if (!old) return { sessions: { ...sessions, B: newSession }, notice: null, showOldResult: false };
  const judgedCount = judgedItems(old).length;
  const ended = { ...old, endedAt: at, endedEarly: true };
  const next = { ...sessions, B: newSession, lastEnded: { ...(sessions.lastEnded || {}), B: ended } };
  const showOldResult = policy.s02EndOld === 'result' && judgedCount > 0;
  const notice = policy.s02EndOld === 'toast' && judgedCount > 0 ? { kind: 'oldGroupSaved', judgedCount } : null;
  return { sessions: next, notice, showOldResult };
}

/**
 * 跨天未完成的会话：startedDay !== today 即过期。已判断的记录保留在 records 里，
 * 没写的按决定-D22 口径不算记录也不算跳过。
 * 哪些会话会过期：daily 总是（P37）；first / picked 按 policy.sessionExpiry（P61，过渡都 'never' 不过期；
 * 'daily' = 与今天的练习同口径）。
 * 过期后怎么处理按 policy.dailyExpiry（P37）：
 * - 'discard'（A，过渡默认）：直接清空该槽，不进结果页。
 * - 'result'（B）：移入 lastEnded[slot] 供次日先显示昨天结果页。
 * 没有会话过期时原样返回同一个 sessions 对象。
 * @returns {{sessions, expired: Session|null, expiredAll: Session[]}}  expired = 最先过期的那个（A 优先）
 */
export function expireDaily(sessions, today, policy = defaultPolicy) {
  let next = sessions;
  const expiredAll = [];
  for (const slot of ['A', 'B']) {
    const s = next[slot];
    if (!s || s.startedDay === today) continue;
    if (expiryRuleOf(s.kind, policy) !== 'daily') continue;
    if (policy.dailyExpiry === 'discard') {
      next = { ...next, [slot]: null };
    } else if (policy.dailyExpiry === 'result') {
      const ended = { ...s, endedAt: s.updatedAt, endedEarly: true };
      next = { ...next, [slot]: null, lastEnded: { ...(next.lastEnded || {}), [slot]: ended } };
    } else {
      throw new RangeError('unsupported policy.dailyExpiry: ' + String(policy.dailyExpiry));
    }
    expiredAll.push(s);
  }
  return { sessions: next, expired: expiredAll.length ? expiredAll[0] : null, expiredAll };
}

/** 某类会话的跨天规则：'daily'（按 P37 过期）| 'never'。daily 恒为 'daily'；first / picked 读 policy.sessionExpiry（P61）。 */
function expiryRuleOf(kind, policy) {
  if (kind === 'daily') return 'daily';
  const table = policy.sessionExpiry;
  const rule = table ? table[kind] : undefined;
  if (rule === 'never' || rule === 'daily') return rule;
  throw new RangeError('unsupported policy.sessionExpiry.' + String(kind) + ': ' + String(rule));
}

/**
 * 恢复幂等（§3.3，决定-D07 不重复计数）：
 * - records 里已有 sessionId===会话 && cardKey===当前字 的 judged 记录（items 里还没有）→ 补写 item、推进 cursor；
 * - phase==='compare' 且笔画为空 → 回退 recall（D63：「在纸上写」已删，旧会话里存着的 current.paper===true 也按这条回到 recall、去掉 paper 标记）。
 * @returns {{session, recovered: boolean}}
 */
export function recoverSession(session, records) {
  if (!session) return { session, recovered: false };
  let s = session;
  let recovered = false;
  const key = currentCardKey(s);
  if (key) {
    const already = s.items.some((it) => it.cardKey === key);
    const committed = (records || []).find((r) => isJudged(r) && r.sessionId === s.id && r.cardKey === key);
    if (committed && !already) {
      s = advance(s, { cardKey: key, recordId: committed.id, kind: 'judged', at: s.updatedAt });
      recovered = true;
    }
  }
  if (s.current && s.current.phase === 'compare' && (!s.current.strokes || s.current.strokes.length === 0)) {
    s = { ...s, current: { ...s.current, phase: 'recall' } };
    recovered = true;
  }
  if (s.current && s.current.paper === true) {
    const { paper, ...rest } = s.current; // eslint-disable-line no-unused-vars
    s = { ...s, current: rest };
    recovered = true;
  }
  return { session: s, recovered };
}

// ---- 选字 ----

/**
 * 开 A 槽新组时是第一次练习还是今天的练习（决定-D17；P46 清空所有记录后重回首练）。
 * @param {boolean} everPracticed 是否曾有过记录（清空前）；policy.afterClearRestartFirst=false 时才用到
 */
export function nextAKind(records, { policy = defaultPolicy, everPracticed = false } = {}) {
  if (hasAnyJudged(records)) return 'daily';
  if (everPracticed && !policy.afterClearRestartFirst) return 'daily';
  return 'first';
}

/** 第一次练习的字（P09，D38：尴 赢 拾）→ cardKey 队列。 */
export function selectFirst(policy = defaultPolicy) {
  return policy.firstQueue.map((c) => 'base:' + c);
}

function customUnwrittenKeys(custom, sched, practicable) {
  const out = [];
  for (const row of (custom && custom.added) || []) {
    const key = 'base:' + row.char;
    if (!practicable(key)) continue;
    if (sched && sched[key]) continue; // 有 judged 记录的字已在调度里，不再算「还没写」
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** cardKey → 最近一次判断记录（按 id 序）。 */
function latestJudgmentByKey(records) {
  const out = new Map();
  for (const r of sortById((records || []).filter(isJudged))) out.set(r.cardKey, r);
  return out;
}

/**
 * 每组保底带几个「最近一次练习日写错、今天到期」的字（D65 #1，policy.wrongFirst.reserveShare P315）：ceil(组大小 × 比例)，
 * 不受每日复习上限和新字目标挤占（5 字一组 1 个、10 字 2 个、20 字 4 个、30 字 6 个）。
 */
export function wrongReserveOf(size, policy = defaultPolicy) {
  const cfg = policy.wrongFirst;
  if (!cfg || cfg.enabled === false) return 0;
  const share = Number(cfg.reserveShare) || 0;
  return Math.max(0, Math.min(size, Math.ceil(size * share)));
}

/**
 * 跳过后推迟进新字池的字（D65 #5，policy.skipNewDeferDays，P06）：最近 skipNewDeferDays 天内（今天算第 1 天）跳过过的字。
 * 只对新字起作用（选字时新字池才看它；有调度项的字到期照常出，当天的排除另按 skipScope）。
 */
export function skipDeferredNewKeys(records, today, policy = defaultPolicy) {
  const days = Number.isInteger(policy.skipNewDeferDays) && policy.skipNewDeferDays > 0 ? policy.skipNewDeferDays : 0;
  if (!days) return new Set();
  return skippedCardKeysOn(records, today, addDays(today, -(days - 1)));
}

/**
 * 今天的练习选字（§5，D41 规则 D；D40 特别组）。
 * @param {object} args
 * @param {object} args.sched         {[cardKey]: {fsrs, due, lastJudgedAt, stoppedAt?}}
 * @param {Array}  args.records       全部记录
 * @param {string} args.today         YYYY-MM-DD
 * @param {Array}  args.newCandidates 当前练习范围内的新字 cardKey（已按新字顺序排好：易忘度清单在前、其余字频序，见 new-order.orderNewKeys）
 * @param {Array}  [args.warmupCandidates] 当前练习范围内的热身字 cardKey（按热身清单顺序，见 new-order.warmupKeys）；缺省没有热身字
 * @param {object} [args.custom]      {added:[{char, at}]}
 * @param {function} [args.practicable] cardKey → 是否可练（默认 base: 前缀）
 * @param {function} [args.isWarm]    cardKey → 是否热身字（默认读 CHAR_ORDER.warmup）
 * @returns {{queue: string[], dueKeys: string[], earlyKeys: string[], newKeys: string[], warmKeys: string[], customKeys: string[],
 *   reviewBudgetLeft: number, backlog: number, pressure: number, newTarget: number, special: null|{kind:string, keys:string[]}}}
 *   dueKeys = 到期复习；earlyKeys = 提前复习补位；newKeys = 新字（含热身新字，warmKeys 是其中的热身字）；special = 大写数字特别组。
 */
export function selectDaily({
  sched = {},
  records = [],
  today,
  newCandidates = [],
  warmupCandidates = [],
  custom = null,
  practicable = (key) => typeof key === 'string' && key.startsWith('base:'),
  policy = defaultPolicy,
  isWarm = (key) => isWarmupKey(key),
  capitalDeferredDay = null,
  groupSize = null,
}) {
  const mix = policy.groupMix;
  const excluded = new Set(judgedCardKeysOn(records, today)); // 刚写过的字当天不再出（交接备注十.5）
  if (policy.answerSeenScope === 'today') {
    for (const key of answerSeenCardKeysOn(records, today)) excluded.add(key);
  } else if (policy.answerSeenScope !== 'none') {
    throw new RangeError('unsupported policy.answerSeenScope: ' + String(policy.answerSeenScope));
  }
  // D65 #5（P06）：跳过的字当天不再出（skipScope 'today'）；跳过的新字另在新字池里推迟 skipNewDeferDays 天（见 ②）
  if (policy.skipScope === 'today') {
    for (const key of skippedCardKeysOn(records, today)) excluded.add(key);
  } else if (policy.skipScope !== 'session') {
    throw new RangeError('unsupported policy.skipScope: ' + String(policy.skipScope));
  }
  const deferredNew = skipDeferredNewKeys(records, today, policy);
  if (!['none', 'after-due', 'first'].includes(policy.customIntoDaily)) {
    throw new RangeError('unsupported policy.customIntoDaily: ' + String(policy.customIntoDaily));
  }
  // P60：自选组里的复习计入每日上限（reviewsDoneOn 按当天全部 judged 记账）。不计入需要记录能区分会话类型，未实现。
  if (policy.dailyCapCountsPicked !== true) {
    throw new RangeError('unsupported policy.dailyCapCountsPicked: ' + String(policy.dailyCapCountsPicked));
  }
  const customUnwritten = customUnwrittenKeys(custom, sched, practicable);
  const customSet = new Set(customUnwritten);

  const stats = practiceStats(records, today, { policy, isWarm });
  // ① 到期字与可提前复习的字（未到期，快到期的在前）。
  // 到期字排序（D65 #1，policy.wrongFirst P315）：先「最近一次练习日（今天以前最近一个有判断的日子）写错、今天到期」的字（tier 0），
  // 再「最近一次判断是写错」的其余到期字（tier 1），最后普通到期字（tier 2）；同一层内逾期天数降序、稳定度升序、键。
  const lastJudged = latestJudgmentByKey(records);
  const due = [];
  const early = [];
  for (const [key, entry] of Object.entries(sched || {})) {
    if (excluded.has(key) || !practicable(key)) continue;
    if (!entry || entry.stoppedAt !== undefined) continue;
    const od = overdueDays(entry, today);
    if (od === null) continue;
    const stability = entry.fsrs ? Number(entry.fsrs.stability) || 0 : 0;
    if (od >= 0) {
      const last = lastJudged.get(key);
      const wrong = !!last && last.judgment === 'wrong';
      const tier = wrong && policy.wrongFirst && policy.wrongFirst.enabled !== false
        ? (stats.lastDay !== null && last.localDay === stats.lastDay ? 0 : 1) : 2;
      due.push({ key, od, stability, tier });
    } else if (!isWarm(key)) early.push({ key, dueDay: entry.due, stability });
  }
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  due.sort((a, b) => a.tier - b.tier || b.od - a.od || a.stability - b.stability || byKey(a, b));
  early.sort((a, b) => (a.dueDay < b.dueDay ? -1 : a.dueDay > b.dueDay ? 1 : 0) || a.stability - b.stability || byKey(a, b));
  // D65 #2（P314）：组大小 = 用户的「每组字数」（调用方从 settings 读，见 core/group-size.js）；每日复习上限按组大小换算。
  const full = validGroupSize(groupSize, policy);
  const reviewBudgetLeft = Math.max(0, dailyReviewCapOf(full, policy) - dueReviewsDoneOn(records, today, { sched, policy }));

  // D48 ⑧（P184）：离开 ≥ returnAfterDays 天回来的第一组（今天还没有判断）缩短为 returnGroupSize 个字（按组大小换算：5 字一组 3 个、20 字一组 12 个）；
  // 特别组不受影响（见下，整组出）。
  const size = stats.firstBack && Number.isInteger(mix.returnGroupSize) && mix.returnGroupSize > 0
    ? Math.min(full, scaledCount(mix.returnGroupSize, full, mix)) : full;
  const backlog = due.length;
  const pressure = pressureOf(backlog, stats.groupsPerDay, mix, full);
  const base = { dueKeys: [], earlyKeys: [], newKeys: [], warmKeys: [], customKeys: [], reviewBudgetLeft, backlog, pressure, groupSize: full };

  // D40 大写数字特别组：整组换掉日常配比（特别组固定 5 个字，与每组字数无关）
  const special = capitalSpecial({ records, stats, pressure, practicable, excluded, policy, today, deferredDay: capitalDeferredDay });
  if (special) {
    return { ...base, queue: special.keys.slice(0, Math.max(full, special.keys.length)), newTarget: 0, special: { kind: special.kind, keys: special.keys } };
  }

  // ② 新字池：不在调度里（从没有 judged）、没被排除；自选未写的字在 'none' 下不进 daily；特别组之后佰仟排最前
  const customPick = policy.customIntoDaily === 'none' ? [] : customUnwritten.filter((k) => !excluded.has(k));
  const dueSet = new Set(due.map((d) => d.key));
  const taken = new Set(dueSet);
  const pool = [];
  for (const key of [...customPick, ...capitalAfterKeysFor(records, policy), ...newCandidates]) {
    if (taken.has(key) || excluded.has(key) || deferredNew.has(key) || !practicable(key)) continue;
    if (sched && sched[key]) continue;
    if (customSet.has(key) && !customPick.includes(key)) continue;
    pool.push(key);
    taken.add(key);
  }
  // 热身字：下一个还没写过的（热身字也在字频序里，所以这里不看 taken——它可能已经被新字池收走；放进组里时再从新字池去重）
  let warmNext = null;
  for (const key of warmupCandidates || []) {
    if (dueSet.has(key) || excluded.has(key) || deferredNew.has(key) || !practicable(key) || (sched && sched[key])) continue;
    warmNext = key;
    break;
  }

  // 没有到期字、也没有新字可出（字库写完）时，不用提前复习凑一组：保持 R-H11「现在没有要写的字」（想接着写，可以自己选字）。
  const earlyPool = due.length || pool.length || warmNext ? early.map((e) => e.key) : [];
  const plan = planGroup({
    size,
    budget: reviewBudgetLeft,
    due,
    early: earlyPool,
    isWarm,
    warmNext,
    warmOk: warmupAllowed(stats, policy.warmup),
    state: { backlog, groupsPerDay: stats.groupsPerDay, newAccuracy: stats.newAccuracy, lastHadNew: stats.lastHadNew, firstBack: stats.firstBack },
    mix,
    pressureSize: full,
    newCap: newUserCapOf(stats, policy.newUserRamp, full, mix), // D66 ⑫：新用户前 3 天每组新字至多 2 份
    reserve: Math.min(wrongReserveOf(size, policy), due.filter((d) => d.tier === 0).length),
    newAvailable: pool.length + (warmNext && !pool.includes(warmNext) ? 1 : 0),
  });
  const ordinaryNew = pool.filter((k) => k !== plan.warmNew).slice(0, plan.newSlots - (plan.warmNew ? 1 : 0)); // 热身字也可能在字频尾部：不重复出
  let queue = arrangeGroup({ warmNew: plan.warmNew, revKeys: plan.revKeys, earlyKeys: plan.earlyKeys, newKeys: ordinaryNew, isWarm });
  const customKeys = queue.filter((k) => customPick.includes(k));
  if (policy.customIntoDaily === 'first') queue = [...customKeys, ...queue.filter((k) => !customKeys.includes(k))];
  return {
    ...base,
    queue,
    dueKeys: queue.filter((k) => plan.revKeys.includes(k)),
    earlyKeys: queue.filter((k) => plan.earlyKeys.includes(k)),
    newKeys: [...(plan.warmNew ? [plan.warmNew] : []), ...ordinaryNew], // 新字按候选顺序（热身新字在前），不随组内排列变
    warmKeys: plan.warmNew ? [plan.warmNew] : [],
    customKeys,
    newTarget: plan.newTarget,
    special: null,
  };
}

/** 下一次日常组是不是大写数字特别组（首页提示用，不选字）；返回 {kind, keys} 或 null。参数同 selectDaily 的子集。 */
export function specialPlan({ sched = {}, records = [], today, practicable = (key) => typeof key === 'string' && key.startsWith('base:'), policy = defaultPolicy, isWarm = (key) => isWarmupKey(key), capitalDeferredDay = null, groupSize = null }) {
  const cfg = policy.capitalNumerals;
  if (!cfg || cfg.enabled === false) return null;
  if (capitalDeferredDay === today) return null; // D46 ④：今天点了「这次先写平常的字」
  const stats = practiceStats(records, today, { policy, isWarm });
  if (stats.groupsTotal < cfg.afterGroups) return null; // 还没满：不用算积压
  const excluded = new Set(judgedCardKeysOn(records, today));
  let backlog = 0;
  for (const [key, entry] of Object.entries(sched || {})) {
    if (excluded.has(key) || !practicable(key) || !entry || entry.stoppedAt !== undefined) continue;
    const od = overdueDays(entry, today);
    if (od !== null && od >= 0) backlog += 1;
  }
  const pressure = pressureOf(backlog, stats.groupsPerDay, policy.groupMix, validGroupSize(groupSize, policy));
  return capitalSpecial({ records, stats, pressure, practicable, excluded, policy, today, deferredDay: capitalDeferredDay });
}
