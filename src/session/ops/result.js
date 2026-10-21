// 结果页数据与提交（结果模型、结束 / 离开、改判、从结果页撤销跳过；从 src/ui/screens/result/index.js 原样挪来，B2.1；行为不变）。
// 无 DOM、不依赖 UI：网页结果页与写字会话 API 共用。

import { t } from '../../config/copy/index.js';
import * as defaultPolicy from '../../config/policy.js';
import { localDay } from '../../core/dates.js';
import { charOfCardKey, compareRecordIds, correctRecord, isJudged, sortById } from '../../core/records.js';
import { canCorrect, clearLastEnded, endSlot, fsrsBeforeOf, isComplete } from '../../core/sessions.js';
import { replay } from '../../core/fsrs.js';
import { addedOf, buildWork } from '../../core/images/work.js';
import { allRecords, replaceRecordInDraft } from './answer.js';
import { recalledInk } from './judge.js';
import { canUndoSkip, undoSkipInDraft } from './skip.js';

/** 首练结果页标题（D28 / N3-07 / D53：固定「这三个字」）；ui/work-text.js 转出同一个函数。 */
export function firstTitle() {
  return t('X-FIRST.title');
}

export const LABELS = Object.freeze({
  finish: 'result:finish',
  leave: 'result:leave',
  correct: 'result:correct',
  undoSkip: 'result:skip-undo',
});

// 离开按钮（R-R06；04 §3.2 原型 LEAVE 映射；旧键 againList → wrongList，改动 L19）。
const LEAVE_KEYS = Object.freeze({
  wrongList: 'R-R06.leaveWrong',
  againList: 'R-R06.leaveWrong',
  forgetList: 'R-R06.leaveForget',
  dueList: 'X-LIBFOUR.leave.due',
  shakyList: 'X-LIBFOUR.leave.shaky',
  knownList: 'X-LIBFOUR.leave.known',
  skippedList: 'X-LIBFOUR.leave.skipped',
  allWritten: 'R-R06.leaveAll',
  mine: 'R-R06.leaveMine',
  library: 'R-R06.leaveLibrary',
  detail: 'R-R06.leaveDetail',
  home: 'X-RESULT.leaveHome',
});
// ---------------------------------------------------------------- 纯函数：读状态

function sessionsOf(state) {
  const s = state && state.sessions;
  return s ? { A: s.A || null, B: s.B || null, lastEnded: { ...(s.lastEnded || {}) } } : { A: null, B: null, lastEnded: {} };
}

/**
 * 结果页要显示的会话：lastEnded[slot]（已结束）或 sessions[slot]（写完但还没移入 lastEnded）。
 * @returns {{session, where:'ended'|'slot'} | null}
 */
export function findResultSession(state, { slot, sessionId }) {
  const s = sessionsOf(state);
  const ended = s.lastEnded[slot];
  if (ended && ended.id === sessionId) return { session: ended, where: 'ended' };
  const live = s[slot];
  if (live && live.id === sessionId) return { session: live, where: 'slot' };
  return null;
}

/** 本组的记录（按 id 顺序）。 */
export function recordsOfSession(state, sessionId) {
  return sortById(allRecords(state).filter(r => r && r.sessionId === sessionId));
}

function captionOf(kind, judgment) {
  if (kind === 'judged') return t(judgment === 'wrong' ? 'X-RESULT.cellWrong' : 'X-RESULT.cellCorrect');
  if (kind === 'answer-seen') return t('R-R02.cellSaw');
  return t('X-RESULT.cellSkipped');
}

function dayOfSession(session) {
  if (!session) return null;
  const at = Number.isFinite(session.endedAt) ? session.endedAt : session.updatedAt;
  return Number.isFinite(at) ? localDay(at) : session.startedDay || null;
}

/** 离开按钮：{view, label, char?}。 */
export function leaveOf(source) {
  const view = source && typeof source.view === 'string' ? source.view : 'home';
  const char = source && typeof source.char === 'string' ? source.char : null;
  if (view === 'detail' && char) return { view, char, label: t(LEAVE_KEYS.detail, { char }) };
  const key = view !== 'detail' ? LEAVE_KEYS[view] : null;
  if (key) return { view: view === 'againList' ? 'wrongList' : view, char, label: t(key) };
  return { view: 'home', char: null, label: t(LEAVE_KEYS.home) };
}

/**
 * 结果页模型（纯函数；单测直接调用）。
 * @param {object} state   store 状态
 * @param {{slot:'A'|'B', sessionId:string, hasInk?:(record)=>boolean, policy?:object}} o
 *   hasInk：这条 judged 记录有没有本人笔迹（「这次的图片」只画有笔迹的字，R-R07 / 10.12）。口径与格子一致（I6 / P88）：
 *   存下的墨迹（perRecordInk）或本页面会话里刚判断时记下的笔画（write/compare.js recalledInk）任一即算——图片取墨
 *   （images-entry.js inkPointsOf）也是这两处。页面内笔画刷新即失：perRecordInk 关时刷新后入口按 R-R07.allMissing。
 *   缺省看 state.ink + recalledInk；页面传入与格子同一个取法（inkOf）。perRecordInk=true（D27）时 recalledInk 不再补位，
 *   只看存下的墨迹。
 */
export function resultModel(state, { slot, sessionId, hasInk = null, policy = defaultPolicy }) {
  const found = findResultSession(state, { slot, sessionId });
  const session = found ? found.session : null;
  const records = recordsOfSession(state, sessionId);
  const byId = new Map(records.map(r => [r.id, r]));
  const items = session
    ? session.items.concat(seenCurrentItem(session, records))
    : records.map(r => ({ cardKey: r.cardKey, recordId: r.id, kind: r.kind }));
  const cells = items.map((it, index) => {
    const record = it.recordId ? byId.get(it.recordId) || null : null;
    const kind = record ? record.kind : it.kind;
    const char = record ? record.char : charOfCardKey(it.cardKey);
    const judgment = kind === 'judged' && record ? record.judgment : null;
    return {
      index,
      cardKey: it.cardKey,
      recordId: record ? record.id : it.recordId || null,
      char,
      kind,
      judgment,
      caption: captionOf(kind, judgment),
      canChange: kind === 'judged' && !!record && !record.legacy && !!session && canCorrect(session, record.id),
    };
  });
  const count = new Set(records.filter(isJudged).map(r => r.cardKey)).size;
  const variant = session ? (session.kind === 'picked' ? 'picked' : session.kind === 'first' ? 'first' : 'daily') : slot === 'B' ? 'picked' : 'daily';
  const early = !!(session && session.endedEarly);
  const unwritten = session ? Math.max(0, session.queue.length - session.cursor) : 0;
  const source = session && session.source ? session.source : { view: 'home' };
  const day = dayOfSession(session);

  // 三种结果页同一个作品版式（交接 §5.1；自选组 R2-R1 起也是）：最上面就是作品，不写「这次记录了 N 个字」「点一个格子…」；数量只出现在落款里。
  // 首练保留标题（D28 / P1-E5；N3-07 / D53 起固定「这三个字」，firstTitle）；自选组只在中途结束时多一行「还有 N 个字没写。」。
  const sub = [];
  let title = null;
  const header = t(variant === 'first' ? 'X-RESULT.headerFirst' : variant === 'picked' ? 'R-R05.kicker' : 'X-RESULT.headerDaily');
  if (variant !== 'first' && early && unwritten > 0) sub.push(t('R-R05.bodyEarly', { n: unwritten })); // 今天的练习中途结束（D66 ⑥）与自选组同一句

  // 作品（三种结果页都有）：成员规则见 core/work-members.js / core/images/work.js。inkTest = 这条记录有没有本人墨
  // （存下的墨迹或本页面会话里刚判断时记下的笔画，与格子 / 图片取墨同一取法，I6）。
  const inkTest = typeof hasInk === 'function' ? hasInk : record => !!inkEntryOf(state, record) || hasStrokes(recalledInk(record.id, policy));
  const work = cells.length
    ? buildWork({ items: items.map(it => ({ cardKey: it.cardKey, recordId: it.recordId, kind: it.kind })), records: byId, hasInk: inkTest, added: addedOf(session) })
    : null;
  // 分享入口：作品里至少有一个字（没有任何墨时隐藏，§4.1）
  const share = !!work && work.cells.length > 0;
  // 首练标题按这一页上实际有几个字取数（V2-05）：作品里有几格就是几；没有墨时是衬底一行的字数
  if (variant === 'first') title = firstTitle();

  return {
    found: !!session,
    where: found ? found.where : null,
    session,
    slot,
    sessionId,
    variant,
    early,
    header,
    title,
    sub,
    cells,
    count,
    unwritten,
    day,
    work,
    share,
    leave: leaveOf(source),
    again: variant === 'daily' || variant === 'first',
    source,
  };
}

/**
 * P77（过渡「补进」）：从看答案阶段（answer / trace / retrace，或看过答案后恢复到的 recall）「结束这组」时，当前字已写了
 * answer-seen 记录但会话没推进（items 里没有它）——结果页补一格「看过答案」（不可改判，K25）。
 * 只认本会话（sessionId 已由 records 过滤）、当前字的最近一条 answer-seen 记录；没有记录就不补（D22：没写完的字不算）。
 * 标题数字只按 judged 算，不受影响；说明句里的看过答案列举含它。
 * @returns {Array<{cardKey, recordId, kind:'answer-seen'}>} 0 或 1 项
 */
export function seenCurrentItem(session, records) {
  const cur = session && session.current;
  if (!cur || cur.answerSeen !== true) return [];
  if (!(session.cursor >= 0 && session.cursor < session.queue.length)) return [];
  const key = session.queue[session.cursor];
  if (session.items.some(it => it && it.cardKey === key)) return [];
  let rec = null;
  for (const r of records) if (r && r.kind === 'answer-seen' && r.cardKey === key && r.sessionId === session.id) rec = r; // 按 id 升序，取最后
  return rec ? [{ cardKey: key, recordId: rec.id, kind: 'answer-seen' }] : [];
}

function hasStrokes(strokes) {
  return Array.isArray(strokes) && strokes.some(st => Array.isArray(st) && st.length > 0);
}

/** 格子上的本人笔迹是否有东西可画（inkOf 的结果；「这次的图片」入口与格子同一判据，I6）。 */
export function inkPresent(ink) {
  return !!(ink && ((ink.points && ink.points.length) || (ink.strokes && ink.strokes.length)));
}

function inkEntryOf(state, record) {
  if (!state || !record || !state.ink) return null;
  const month = typeof record.localDay === 'string' ? record.localDay.slice(0, 7) : null;
  const id = record.inkId || record.id;
  const table = month ? state.ink[month] : null;
  return table && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}

// ---------------------------------------------------------------- 纯函数：草稿变换

/** 写完的会话还在槽里 → 移入 lastEnded[slot]（正常结束，01 §3.3）。 */
export function finishInDraft(draft, { slot, sessionId, at }) {
  const s = sessionsOf(draft);
  const live = s[slot];
  if (!live || live.id !== sessionId) throw new Error('finish: session not in slot');
  if (!isComplete(live)) throw new Error('finish: session not complete');
  draft.sessions = endSlot(s, slot, { at, early: false });
}

const CLEAN = Object.freeze({ ok: true, noop: true, keys: Object.freeze([]) });
const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });

/** 结束写完的会话（幂等：已在 lastEnded → noop）。 */
export function commitFinish(store, { slot, sessionId }) {
  const found = findResultSession(store.getState(), { slot, sessionId });
  if (!found) return STALE;
  if (found.where === 'ended') return CLEAN;
  if (!isComplete(found.session)) return STALE;
  return store.commit(LABELS.finish, (draft, ctx) => finishInDraft(draft, { slot, sessionId, at: ctx.now }));
}

/** 离开结果页：清掉 lastEnded[slot]（只清本组）。 */
export function commitLeave(store, { slot, sessionId }) {
  const s = sessionsOf(store.getState());
  if (!s.lastEnded[slot] || s.lastEnded[slot].id !== sessionId) return CLEAN;
  return store.commit(LABELS.leave, draft => {
    const cur = sessionsOf(draft);
    if (cur.lastEnded[slot] && cur.lastEnded[slot].id === sessionId) draft.sessions = clearLastEnded(cur, slot);
  });
}

/**
 * 结果页修改判断的 mutator 主体（决定-D19）：同一条记录只改 judgment、追加 corrections；
 * 以 items[].fsrsBefore 为起点、各记录 at 为 review 时间重放本字此后的 judged 记录，更新 sched；会话不动。
 * @returns {{record, entry}}
 */
export function correctResultInDraft(draft, { slot, sessionId, recordId, to, at, policy = defaultPolicy }) {
  const found = findResultSession(draft, { slot, sessionId });
  if (!found) throw new Error('correct: session not found');
  const s = found.session;
  if (!canCorrect(s, recordId)) throw new Error('correct: record cannot be corrected in this session');
  const all = allRecords(draft);
  const record = all.find(r => r && r.id === recordId) || null;
  if (!record || !isJudged(record) || record.sessionId !== sessionId) throw new Error('correct: judged record not found');
  const target = to === undefined ? (record.judgment === 'correct' ? 'wrong' : 'correct') : to;
  const next = correctRecord(record, target, at);
  if (next === record) return { record, entry: draft.sched ? draft.sched[record.cardKey] : undefined };
  replaceRecordInDraft(draft, next);
  const later = sortById(all.filter(r => isJudged(r) && r.cardKey === record.cardKey && compareRecordIds(r.id, recordId) >= 0))
    .map(r => (r.id === recordId ? next : r));
  const prev = draft.sched ? draft.sched[record.cardKey] : undefined;
  const entry = replay(fsrsBeforeOf(s, recordId), later, { policy, stoppedAt: prev ? prev.stoppedAt : undefined });
  if (entry) draft.sched = { ...(draft.sched || {}), [record.cardKey]: entry };
  return { record: next, entry };
}

/** 结果页修改判断 commit。已不能改（会话不在 / 不是本组可改的记录）时 stale。 */
export function commitResultCorrection(store, { slot, sessionId, recordId, to, policy } = {}) {
  const found = findResultSession(store.getState(), { slot, sessionId });
  if (!found || !canCorrect(found.session, recordId)) return STALE;
  let out = null;
  const result = store.commit(LABELS.correct, (draft, ctx) => {
    out = correctResultInDraft(draft, { slot, sessionId, recordId, to, at: ctx.now, policy });
  });
  return result && result.ok && out ? { ...result, record: out.record } : result;
}

/** 结果页上还能不能撤销这次跳过：会话在（lastEnded 或槽里）、最后一个 item 就是这条 skipped、槽没被新组占住。 */
export function canUndoSkipFromResult(state, { slot, sessionId, recordId }) {
  const found = findResultSession(state, { slot, sessionId });
  if (!found) return false;
  if (found.where === 'ended' && sessionsOf(state)[slot]) return false;
  const last = found.session.items[found.session.items.length - 1];
  return !!last && last.kind === 'skipped' && last.recordId === recordId;
}

/**
 * 结果页上的跳过撤销（mutator 主体）：已结束的会话放回槽里（去掉 endedAt / endedEarly、清 lastEnded[slot]），
 * 然后同写字页的撤销：删 skipped 记录、字放回 cursor、current 回 recall、提示次数与笔画写回（skip.js undoSkipInDraft）。
 */
export function undoSkipFromResultInDraft(draft, { slot, sessionId, recordId, strokes, at }) {
  const s = sessionsOf(draft);
  const ended = s.lastEnded[slot];
  if (ended && ended.id === sessionId) {
    if (s[slot]) throw new Error('undo skip: slot is occupied by a newer group');
    const { endedAt, endedEarly, ...rest } = ended; // eslint-disable-line no-unused-vars
    draft.sessions = { ...clearLastEnded(s, slot), [slot]: rest };
  } else if (!s[slot] || s[slot].id !== sessionId) {
    throw new Error('undo skip: session changed');
  }
  return undoSkipInDraft(draft, { slot, sessionId, recordId, at, strokes });
}

export function commitResultSkipUndo(store, { slot, sessionId, recordId, strokes } = {}) {
  const state = store.getState();
  const found = findResultSession(state, { slot, sessionId });
  if (found && found.where === 'slot') {
    if (!canUndoSkip(state, { slot, sessionId, recordId })) return STALE;
  } else if (!canUndoSkipFromResult(state, { slot, sessionId, recordId })) {
    return STALE;
  }
  return store.commit(LABELS.undoSkip, (draft, ctx) => {
    undoSkipFromResultInDraft(draft, { slot, sessionId, recordId, strokes, at: ctx.now });
  });
}
