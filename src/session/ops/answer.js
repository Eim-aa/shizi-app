// 看答案 / 描一遍 / 自己写的提交函数与记录草稿工具（从 src/ui/screens/write/answer.js 原样挪来，B2.1；行为不变）。
// 无 DOM、不依赖 UI：网页写字页（answer.js useAnswerFlow）与写字会话 API（write-api.js）共用。

import { setInk } from '../../store/store.js';
import { pruneInkOfCards } from '../../store/budget.js';
import * as defaultPolicy from '../../config/policy.js';
import { decodeRawStrokes, encodeStoredInk } from '../../core/ink-math.js';
import { makeRecord } from '../../core/records.js';
import { applyAnswerSeen } from '../../core/fsrs.js';
import { advance, clearLine, currentCardKey, withCurrent } from '../../core/sessions.js';

/** answer 流程的阶段（01 §3.3）。 */
export const ANSWER_PHASES = Object.freeze(['answer', 'trace', 'retrace']);
// ---------------------------------------------------------------- 纯函数（状态 → 草稿）

/** 已发布状态 / 草稿里的全部记录（按月数组或折叠月的 kept）。 */
export function allRecords(state) {
  const out = [];
  const months = state && state.records ? state.records : {};
  for (const month of Object.keys(months)) {
    const value = months[month];
    const list = Array.isArray(value) ? value : value && Array.isArray(value.kept) ? value.kept : [];
    for (const r of list) out.push(r);
  }
  return out;
}

/** 本会话某字的 answer-seen 记录（最近一条）；没有返回 null。 */
export function findAnswerSeen(state, sessionIdValue, cardKey) {
  let found = null;
  for (const r of allRecords(state)) {
    if (r && r.kind === 'answer-seen' && r.sessionId === sessionIdValue && r.cardKey === cardKey) found = r;
  }
  return found;
}

function monthOfRecord(record) {
  return typeof record.localDay === 'string' ? record.localDay.slice(0, 7) : null;
}

/** 草稿里追加一条记录（新 id 是最大序号，放当月末尾；折叠月追加到 kept）。 */
export function appendRecordToDraft(draft, record) {
  const month = monthOfRecord(record);
  if (!month) throw new Error('appendRecord: record has no localDay');
  const value = draft.records[month];
  if (value === undefined || value === null) draft.records[month] = [record];
  else if (Array.isArray(value)) draft.records[month] = value.concat([record]);
  else if (Array.isArray(value.kept)) draft.records[month] = { ...value, kept: value.kept.concat([record]) };
  else throw new Error('appendRecord: unexpected records month shape');
}

/** 草稿里用同 id 的新记录替换旧记录（copy-on-write）。 */
export function replaceRecordInDraft(draft, next) {
  const month = monthOfRecord(next);
  const value = month ? draft.records[month] : null;
  const swap = list => list.map(r => (r.id === next.id ? next : r));
  if (Array.isArray(value)) draft.records[month] = swap(value);
  else if (value && Array.isArray(value.kept)) draft.records[month] = { ...value, kept: swap(value.kept) };
  else throw new Error('replaceRecord: month not found');
}

function sessionOf(state, slot) {
  return state && state.sessions ? state.sessions[slot] || null : null;
}

function setSession(draft, slot, session) {
  draft.sessions = { ...draft.sessions, [slot]: session };
}

const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });

/** 会话的当前字不是 cardKey（换字 / 已推进）→ 不提交，返回 stale。 */
function staleGuard(store, slot, cardKey) {
  const s = sessionOf(store.getState(), slot);
  return !s || currentCardKey(s) !== cardKey ? STALE : null;
}

/** 至少一笔、至少一个点的原始笔画。 */
function hasStrokes(strokes) {
  return Array.isArray(strokes) && strokes.some(st => Array.isArray(st) && st.length > 0);
}

/** 当前阶段是不是「自己写」：自己写一遍（retrace），或看过答案后恢复到的回忆阶段（格下同样是 R-W07.selfNote）。 */
export function isSelfWritePhase(current) {
  if (!current) return false;
  return current.phase === 'retrace' || (current.phase === 'recall' && current.answerSeen === true);
}

/** perRecordInk 开关（P31 / D27）：显式传入优先，否则读 policy.features。 */
function inkEnabled(perRecordInk, policy) {
  if (typeof perRecordInk === 'boolean') return perRecordInk;
  const p = policy || defaultPolicy;
  return !!(p.features && p.features.perRecordInk === true);
}

/**
 * Q1：把「自己写一遍」的本人笔画存成本会话这个字的 answer-seen 记录的墨迹（store.commit 的 mutate 里调用）。
 * 当前阶段不是自己写、没有 answer-seen 记录、没有笔画或 perRecordInk 关时什么都不做。strokes 缺省取会话现场
 * （session.current.strokes，抬笔写回的那份——刷新 / 冷启动后本地现场即由它恢复）。同一记录键覆盖 = 只留最后一次；
 * 随后 pruneInkOfCards 回收这个字更早的看后自写（组已关的），判断墨迹的 D27 留存不变。
 * @returns {{stored:boolean, recordId:string|null}}
 */
export function storeSelfInkInDraft(draft, { slot, cardKey, strokes, perRecordInk, policy, inkFormat } = {}) {
  const none = { stored: false, recordId: null };
  const s = sessionOf(draft, slot);
  if (!s || currentCardKey(s) !== cardKey || !isSelfWritePhase(s.current)) return none;
  if (!inkEnabled(perRecordInk, policy)) return none;
  const record = findAnswerSeen(draft, s.id, cardKey);
  if (!record) return none;
  const raw = Array.isArray(strokes) ? strokes : decodeRawStrokes(s.current.strokes || []);
  if (!hasStrokes(raw)) return { stored: false, recordId: record.id };
  // B2.3：原生存原始点（Ink v4），网页存 v3（inkFormat = ctx.inkFormat）
  setInk(draft, record, encodeStoredInk(raw, { policy: policy || defaultPolicy, format: inkFormat }));
  pruneInkOfCards(draft, [cardKey]);
  return { stored: true, recordId: record.id };
}

/**
 * 点「看答案」：一次 commit 写 answer-seen 记录 + 会话现场（直接进描一遍 phase='trace'、answerSeen、结果行收起；D64 ②：标准写法淡显在空格子里，马上能描）。
 * 进描一遍 = 记录 help.traced=true（帮助事实）。同一会话同一字已有 answer-seen 记录时只更新会话（事件不重复）。
 *
 * stay：提示给完整个字时（D64 ①）走同一个函数、同一口径记为看过答案，但留在回忆阶段继续写（本人笔画不动、不进描一遍）；
 *   此时 hints / hintRange 一并写进现场（同一次 commit），记录 help.traced 仍是 false。
 * @returns store.commit 的结果；当前字已不是 cardKey 时 {ok:false, error:{kind:'stale'}}
 */
export function commitAnswerSeen(store, { slot, cardKey, stay = false, hints: hintsNow, hintRange = null }) {
  const stale = staleGuard(store, slot, cardKey);
  if (stale) return stale;
  return store.commit('write:answer-seen', (draft, ctx) => {
    const s = sessionOf(draft, slot);
    if (!s || currentCardKey(s) !== cardKey) throw new Error('answer-seen: not the current card');
    const stored = s.current && Number.isInteger(s.current.hints) ? s.current.hints : 0;
    const hints = Math.max(stored, Number.isInteger(hintsNow) ? hintsNow : 0);
    const existing = findAnswerSeen(draft, s.id, cardKey);
    if (!existing) {
      const record = makeRecord({
        id: ctx.nextId('r'),
        cardKey,
        sessionId: s.id,
        kind: 'answer-seen',
        at: ctx.now,
        help: { hints, answerSeen: true, traced: !stay },
      });
      appendRecordToDraft(draft, record);
      // D66 ①（P321）：复习字看了答案 = 当天记一次「没写出来」（Again）；新字、当天已评过级的不记（core/fsrs.js applyAnswerSeen）
      const seen = applyAnswerSeen(draft.sched ? draft.sched[cardKey] : undefined, record, { policy: defaultPolicy });
      if (seen.applied) draft.sched = { ...(draft.sched || {}), [cardKey]: seen.entry };
    } else if (!stay && !existing.help.traced) {
      replaceRecordInDraft(draft, { ...existing, help: { ...existing.help, traced: true } });
    }
    const patch = stay
      ? { answerSeen: true, hints, hintRange: hintRange ? { from: hintRange.from, to: hintRange.to } : null }
      : { phase: 'trace', strokes: [], answerSeen: true, hintRange: null };
    setSession(draft, slot, clearLine(withCurrent(s, patch, ctx.now)));
  });
}

/**
 * answer 流程内换阶段（answer / trace / retrace；看过答案后的 recall 也可回到 answer）：笔画清空。
 * 进 trace 时同一次 commit 把该字的 answer-seen 记录 help.traced 置 true（帮助事实，01 §3.2）。
 * 离开自己写一遍时同一次 commit 存下本人笔画（Q1，storeSelfInkInDraft；strokes = 写字页本地现场，缺省取会话现场）。
 */
export function commitAnswerPhase(store, { slot, cardKey, phase, strokes, perRecordInk, policy }) {
  if (!ANSWER_PHASES.includes(phase)) throw new RangeError('commitAnswerPhase: not an answer-flow phase');
  const stale = staleGuard(store, slot, cardKey);
  if (stale) return stale;
  return store.commit(`write:answer-${phase}`, (draft, ctx) => {
    const s = sessionOf(draft, slot);
    if (!s || currentCardKey(s) !== cardKey) throw new Error('answer phase: not the current card');
    storeSelfInkInDraft(draft, { slot, cardKey, strokes, perRecordInk, policy, inkFormat: ctx.inkFormat });
    if (phase === 'trace') {
      const record = findAnswerSeen(draft, s.id, cardKey);
      if (record && !record.help.traced) replaceRecordInDraft(draft, { ...record, help: { ...record.help, traced: true } });
    }
    // 看答案（answer）与回忆共用一份笔画现场（本人墨不清空）；描一遍 / 自己写是空格子。
    const patch = phase === 'answer' ? { phase, hintRange: null } : { phase, strokes: [], hintRange: null };
    setSession(draft, slot, withCurrent(s, patch, ctx.now));
  });
}

/**
 * 看过答案后「下一个」：推进到下一字（item kind='answer-seen'，结果行 'saw'），不进判断页。
 * 从自己写一遍按「下一个」时同一次 commit 存下本人笔画（Q1，storeSelfInkInDraft）；写失败什么都不留（D07）。
 */
export function commitAnswerNext(store, { slot, cardKey, strokes, perRecordInk, policy }) {
  const stale = staleGuard(store, slot, cardKey);
  if (stale) return stale;
  return store.commit('write:answer-next', (draft, ctx) => {
    const s = sessionOf(draft, slot);
    if (!s || currentCardKey(s) !== cardKey) throw new Error('answer next: not the current card');
    storeSelfInkInDraft(draft, { slot, cardKey, strokes, perRecordInk, policy, inkFormat: ctx.inkFormat });
    const record = findAnswerSeen(draft, s.id, cardKey);
    setSession(draft, slot, advance(s, { cardKey, recordId: record ? record.id : undefined, kind: 'answer-seen', at: ctx.now }));
  });
}

/**
 * 写字页笔画现场的分组键：描一遍 / 自己写各自一份（都是空格子，原型 strokes:[]）；看答案（answer）与回忆共用一份——
 * 答案衬在本人墨下层、本人墨不清空（D34 / D51 ⑧）。
 */
export function answerInkKey(cardKey, phase) {
  return phase === 'trace' || phase === 'retrace' ? `${cardKey}|${phase}` : cardKey;
}

/** 看答案第一次的格下说明：记下已出现过（settings.answerNoteSeen = true，只出现一次，P212）。已记过不写。 */
export function commitAnswerNoteSeen(store) {
  const cur = store.getState().settings;
  if (cur && cur.answerNoteSeen === true) return { ok: true, keys: [], skipped: true };
  return store.commit('write:answer-note', draft => {
    draft.settings = { ...(draft.settings || {}), answerNoteSeen: true };
  });
}

/** 这一刻要不要出现第一次的说明：在看答案阶段、从没出现过。纯函数。 */
export function answerNoteDue({ settings = null, phase = 'recall' } = {}) {
  return phase === 'answer' && !(settings && settings.answerNoteSeen === true);
}
