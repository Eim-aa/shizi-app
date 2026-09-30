// 会话开始与选字的 store.commit 包装（02 M2-2；01 §3.3、§5；03 P09 / P33 / P36 / P37 / P38 / P46 / P60 / P61）。
//
// 纯选字在 core/sessions.js（selectFirst / selectDaily / nextAKind / s02Prompt / endAndStartPicked / expireDaily）；
// 本模块把它们接成「一次 commit」的开组操作。不访问 DOM / 路由 / 平台：store、题库适配器（deck）、时钟（now）都由调用方注入
// （UI 侧入口见 src/ui/screens/session/index.js，它传 data/deck.js 的 deckAdapter 与 platform/env.js 的 now）。
//
// 口径：
// - 开 A 槽（第一次练习 / 今天的练习）：先做跨天过期（P37：daily 的 startedDay ≠ 今天 → 按 policy.dailyExpiry 处理；
//   first / picked 按 policy.sessionExpiry，P61 过渡都不过期）；A 槽仍有没写完的组 → 不开新组（调用方续写）；
//   A 槽的组已写完（cursor 到头、还没移入 lastEnded）→ 同一次 commit 里先 endSlot 再开新组。
//   第一次还是今天的练习按 nextAKind（决定-D17；P46 清空后重回首练）。首练队列 = policy.firstQueue（P09）。
// - 今天的练习的队列 = selectDaily（到期优先、每日复习上限 policy.dailyReviewCap「练完记账」、今天已 judged 的字不再出、
//   skipped 只在本会话排除、answer-seen 按 policy.answerSeenScope、自选未写按 policy.customIntoDaily、组大小 policy.groupSize）；
//   新字来源 = 当前练习范围（deck.newCandidates(libraryId)，SEED 字频序）。队列为空 → 不写入，返回 {empty}（R-H11 页）。
// - 开 B 槽（这次选的字）：B 有没写完的组 → 不写入，返回 S02 数据（s02Prompt）；否则一次 commit 开新 B
//   （B 已写完但没结束 → 同一次 commit 先 endSlot）。
// - S02「结束那组，开新的」：一次 commit（endAndStartPicked：旧 B endedEarly 移入 lastEnded.B + 新 B）；P38 过渡不进旧组结果页，
//   旧 B 有判断时返回 notice {kind:'oldGroupSaved', judgedCount} 供轻提示。
// - 所有写入只经 store.commit；失败原样返回 commit 的 {ok:false, error}，调用方留在原处（D07）。

import * as defaultPolicy from '../config/policy.js';
import { localDay } from './dates.js';
import { charOfCardKey } from './records.js';
import {
  createSession, endAndStartPicked, endSlot, expireDaily, isComplete, nextAKind, s02Prompt, selectDaily, selectFirst,
  startInSlot,
} from './sessions.js';

export const LABELS = Object.freeze({
  expire: 'session:expire',
  startFirst: 'session:start-first',
  startDaily: 'session:start-daily',
  startPicked: 'session:start-picked',
  endAndStartPicked: 'session:end-and-start-picked',
});

// ---------------------------------------------------------------- 读状态

/** store 状态 → 全部记录（records 按月分组，折叠月份取 kept）。 */
export function recordsOf(state) {
  const out = [];
  const months = (state && state.records) || {};
  for (const month of Object.keys(months).sort()) {
    const value = months[month];
    const list = Array.isArray(value) ? value : value && Array.isArray(value.kept) ? value.kept : [];
    for (const r of list) out.push(r);
  }
  return out;
}

function sessionsOf(state) {
  const s = state && state.sessions;
  return s ? { A: s.A || null, B: s.B || null, lastEnded: s.lastEnded || {} } : { A: null, B: null, lastEnded: {} };
}

/**
 * 是否曾有过记录（P46 afterClearRestartFirst=false 时 nextAKind 才用到）：清空所有记录留下的结论句、或导入过旧数据的练习日。
 */
export function everPracticed(state) {
  const concl = state && state.backupMeta && state.backupMeta.lastConclusion;
  if (concl && concl.kind === 'clear') return true;
  const legacy = state && state.legacy;
  return !!(legacy && Array.isArray(legacy.days) && legacy.days.length);
}

/**
 * 首页 / 开 A 槽要知道的：下一组 A 是第一次练习还是今天的练习，以及「第一次」是不是真的第一次来
 * （R-H09 / 走查-K06：清空所有记录后重回首练时首页不再说「第一次来」，说法由首页决定）。
 * @returns {{kind:'first'|'daily', firstVisit:boolean}}
 */
export function aStartInfo(state, { policy = defaultPolicy } = {}) {
  const ever = everPracticed(state);
  const kind = nextAKind(recordsOf(state), { policy, everPracticed: ever });
  return { kind, firstVisit: kind === 'first' && !ever };
}

/**
 * 今天的练习会选出哪些字（不写入）。
 * @param {object} state  store 状态
 * @param {{today:string, deck:{newCandidates:Function, practicable:Function, currentLibraryId?:Function}, policy?}} o
 * @returns {{queue, dueKeys, newKeys, customKeys, reviewBudgetLeft, libraryId, libraryExhausted:boolean}}
 *   libraryExhausted：当前练习范围里已没有可当新字出的字（R-H11「字库都写过」的次入口）。
 */
export function planDaily(state, { today, deck, policy = defaultPolicy }) {
  // deck 没有 currentLibraryId（测试替身）时：settings.library → 否则 policy.defaultLibrary（P73）。
  const settingsLib = state && state.settings && typeof state.settings.library === 'string' ? state.settings.library : null;
  const libraryId = deck.currentLibraryId
    ? deck.currentLibraryId(state && state.settings)
    : settingsLib || policy.defaultLibrary || null;
  const newCandidates = deck.newCandidates(libraryId);
  const sched = (state && state.sched) || {};
  const plan = selectDaily({
    sched,
    records: recordsOf(state),
    today,
    newCandidates,
    custom: (state && state.custom) || null,
    practicable: deck.practicable,
    policy,
  });
  const libraryExhausted = !newCandidates.some(key => deck.practicable(key) && !sched[key]);
  return { ...plan, libraryId, libraryExhausted };
}

/** S02 确认框数据（R-H05）：旧 B 没写完 → {sessionId, unwrittenKeys, unwrittenChars, judgedCount}；否则 null。 */
export function s02Data(state) {
  return s02Prompt(sessionsOf(state));
}

// ---------------------------------------------------------------- 草稿变换

function setSessions(draft, sessions) {
  draft.sessions = { A: sessions.A || null, B: sessions.B || null, lastEnded: { ...(sessions.lastEnded || {}) } };
}

/** 草稿里做跨天过期；返回过期掉的会话列表。 */
function expireInDraft(draft, today, policy) {
  const current = sessionsOf(draft);
  const { sessions, expiredAll } = expireDaily(current, today, policy);
  if (expiredAll.length) setSessions(draft, sessions);
  return expiredAll;
}

/** 草稿里：槽位的组已写完但没结束 → 移入 lastEnded（正常结束）。 */
function endCompleteInDraft(draft, slot, at) {
  const current = sessionsOf(draft);
  if (current[slot] && isComplete(current[slot])) setSessions(draft, endSlot(current, slot, { at }));
}

function normalizeKeys(input) {
  const out = [];
  for (const item of input || []) {
    const key = typeof item === 'string' && item.includes(':') ? item : 'base:' + item;
    if (!charOfCardKey(key)) continue;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

// ---------------------------------------------------------------- 提交

function nowOf(now) {
  return typeof now === 'function' ? now() : typeof now === 'number' ? now : Date.now();
}

/**
 * 只做跨天过期（首页读取时 / 回前台时调用）。没有过期的会话时不写入。
 * @returns {{ok:true, expired:Session[]} | {ok:false, error}}
 */
export function expireStale(store, { now, policy = defaultPolicy } = {}) {
  const today = localDay(nowOf(now));
  const { expiredAll } = expireDaily(sessionsOf(store.getState()), today, policy);
  if (!expiredAll.length) return { ok: true, expired: [] };
  const result = store.commit(LABELS.expire, draft => {
    expireInDraft(draft, today, policy);
  });
  return result.ok ? { ok: true, expired: expiredAll } : result;
}

/**
 * 不写入的续写判断：该槽有没写完、且按现在的时间不会跨天过期的组 → 返回它；否则 null。
 */
export function resumableSession(state, slot, { now, policy = defaultPolicy } = {}) {
  const today = localDay(nowOf(now));
  const s = expireDaily(sessionsOf(state), today, policy).sessions[slot];
  return s && !isComplete(s) ? s : null;
}

/**
 * 续写某槽之前的检查（含跨天过期）：返回该槽还能不能续写。
 * @returns {{ok:true, session:Session|null, expired:Session[]} | {ok:false, error}}
 *   session 非 null = 该槽有没写完的组，调用方打开写字页。
 */
export function resumeSlot(store, slot, { now, policy = defaultPolicy } = {}) {
  if (slot !== 'A' && slot !== 'B') throw new RangeError('resumeSlot: slot must be A or B');
  const expired = expireStale(store, { now, policy });
  if (!expired.ok) return expired;
  const s = sessionsOf(store.getState())[slot];
  return { ok: true, session: s && !isComplete(s) ? s : null, expired: expired.expired };
}

function startA(store, { kind, now, deck, source, policy }) {
  const at = nowOf(now);
  const today = localDay(at);
  const state = store.getState();
  // 先按现在的状态判断：跨天过期后 A 槽还有没写完的组 → 不开新组。
  const afterExpiry = expireDaily(sessionsOf(state), today, policy).sessions;
  if (afterExpiry.A && !isComplete(afterExpiry.A)) {
    return { ok: true, started: false, occupied: true, session: afterExpiry.A };
  }
  let queue;
  let plan = null;
  if (kind === 'first') {
    queue = selectFirst(policy);
  } else {
    plan = planDaily(state, { today, deck, policy });
    queue = plan.queue;
  }
  if (!queue.length) {
    // 没有要写的字（R-H11）：只把过期写下（如有），不开组。
    const expired = expireStale(store, { now: at, policy });
    if (!expired.ok) return expired;
    return { ok: true, started: false, empty: true, kind, plan, libraryExhausted: !!(plan && plan.libraryExhausted) };
  }
  let created = null;
  const result = store.commit(kind === 'first' ? LABELS.startFirst : LABELS.startDaily, (draft, ctx) => {
    expireInDraft(draft, localDay(ctx.now), policy);
    endCompleteInDraft(draft, 'A', ctx.now);
    const session = createSession({ id: ctx.nextId('s'), kind, source: source || { view: 'home' }, queue, at: ctx.now });
    setSessions(draft, startInSlot(sessionsOf(draft), session));
    created = session;
  });
  if (!result.ok) return result;
  return { ok: true, started: true, kind, session: created, plan };
}

/** 开第一次练习（固定 policy.firstQueue，P09）。 */
export function startFirst(store, { now, source, policy = defaultPolicy } = {}) {
  return startA(store, { kind: 'first', now, source, policy, deck: null });
}

/**
 * 开今天的练习（01 §5 选字）。
 * @returns {{ok:true, started:true, session, plan} | {ok:true, started:false, occupied:true, session}
 *          | {ok:true, started:false, empty:true, plan, libraryExhausted} | {ok:false, error}}
 */
export function startDaily(store, { now, deck, source, policy = defaultPolicy } = {}) {
  if (!deck) throw new TypeError('startDaily needs a deck adapter');
  return startA(store, { kind: 'daily', now, deck, source, policy });
}

/** 开 A 槽的下一组：第一次练习或今天的练习（nextAKind）。返回同 startDaily，另带 kind。 */
export function startNextA(store, { now, deck, source, policy = defaultPolicy } = {}) {
  const { kind } = aStartInfo(store.getState(), { policy });
  return startA(store, { kind, now, deck, source, policy });
}

/**
 * 开这次选的字（B）。keys 为 cardKey 或单字；去重、只收 practicable。
 * @returns {{ok:true, started:true, session} | {ok:true, started:false, s02:{…}} | {ok:false, error}}
 */
export function startPicked(store, { keys, source, deck = null } = {}) {
  const queue = normalizeKeys(keys).filter(k => !deck || deck.practicable(k));
  if (!queue.length) throw new RangeError('startPicked: no practicable card');
  const prompt = s02Data(store.getState());
  if (prompt) return { ok: true, started: false, s02: prompt, queue };
  let created = null;
  const result = store.commit(LABELS.startPicked, (draft, ctx) => {
    endCompleteInDraft(draft, 'B', ctx.now);
    const session = createSession({ id: ctx.nextId('s'), kind: 'picked', source: source || { view: 'home' }, queue, at: ctx.now });
    setSessions(draft, startInSlot(sessionsOf(draft), session));
    created = session;
  });
  if (!result.ok) return result;
  return { ok: true, started: true, session: created };
}

/**
 * S02「结束那组，开新的」：一次 commit（P38）。旧 B 已不在 / 已写完时等同开新 B。
 * @returns {{ok:true, session, ended:Session|null, notice:null|{kind:'oldGroupSaved', judgedCount}, showOldResult:boolean}
 *          | {ok:false, error}}
 */
export function endOldAndStartPicked(store, { keys, source, deck = null, policy = defaultPolicy } = {}) {
  const queue = normalizeKeys(keys).filter(k => !deck || deck.practicable(k));
  if (!queue.length) throw new RangeError('endOldAndStartPicked: no practicable card');
  let out = null;
  const result = store.commit(LABELS.endAndStartPicked, (draft, ctx) => {
    endCompleteInDraft(draft, 'B', ctx.now);
    const current = sessionsOf(draft);
    const old = current.B;
    const session = createSession({ id: ctx.nextId('s'), kind: 'picked', source: source || { view: 'home' }, queue, at: ctx.now });
    const r = old
      ? endAndStartPicked(current, session, { at: ctx.now, policy })
      : { sessions: startInSlot(current, session), notice: null, showOldResult: false };
    setSessions(draft, r.sessions);
    out = { session, ended: old ? r.sessions.lastEnded.B : null, notice: r.notice, showOldResult: r.showOldResult };
  });
  if (!result.ok) return result;
  return { ok: true, ...out };
}
