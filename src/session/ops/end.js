// 「结束这组」的计数与提交（从 src/ui/screens/write/end.js 原样挪来，B2.1；行为不变）。确认框仍在 end.js。

import { isJudged } from '../../core/records.js';
import { endSlot, isComplete, remainingCount } from '../../core/sessions.js';
import { allRecords } from './answer.js';

export const END_LABEL = 'write:end';
// ---------------------------------------------------------------- 纯函数

function sessionOf(state, slot) {
  return state && state.sessions ? state.sessions[slot] || null : null;
}

function sessionsOf(state) {
  const s = state && state.sessions;
  return s ? { A: s.A || null, B: s.B || null, lastEnded: { ...(s.lastEnded || {}) } } : { A: null, B: null, lastEnded: {} };
}

/** 本组已判断的字数（按记录算：judged 且 sessionId 是本组，按字去重）。 */
export function judgedCountOf(state, sessionId) {
  const keys = new Set();
  for (const r of allRecords(state)) if (isJudged(r) && r.sessionId === sessionId) keys.add(r.cardKey);
  return keys.size;
}

/** 确认框数字：n = 没写的字（含当前字），m = 已判断的字。 */
export function endConfirmCounts(state, slot) {
  const s = sessionOf(state, slot);
  if (!s) return { n: 0, m: 0 };
  return { n: remainingCount(s), m: judgedCountOf(state, s.id) };
}

/** 哪些组能「结束这组」（D66 ⑥：今天的练习也能；首次练习只有三个字，不放）。 */
const ENDABLE_KINDS = Object.freeze(['picked', 'daily']);

/** 能不能「结束这组」：picked / daily 会话、还有没写的字。 */
export function canEndGroup(session) {
  return !!session && ENDABLE_KINDS.includes(session.kind) && !isComplete(session);
}

/**
 * 结束这组的 mutator 主体：会话移入 lastEnded[slot]（没写完 → endedEarly）。
 * @returns {{ended, judgedCount}}
 */
export function endInDraft(draft, { slot, sessionId, at }) {
  const s = sessionOf(draft, slot);
  if (!s || s.id !== sessionId) throw new Error('end: session changed');
  if (!ENDABLE_KINDS.includes(s.kind)) throw new Error('end: only a picked or daily group can be ended');
  const next = endSlot(sessionsOf(draft), slot, { at, early: !isComplete(s) });
  draft.sessions = next;
  return { ended: next.lastEnded[slot], judgedCount: judgedCountOf(draft, sessionId) };
}

const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });

/** 结束这组 commit。会话已不是 sessionId 时 stale。成功时另带 {ended, judgedCount}。 */
export function commitEndGroup(store, { slot, sessionId }) {
  const s = sessionOf(store.getState(), slot);
  if (!s || s.id !== sessionId || !ENDABLE_KINDS.includes(s.kind)) return STALE;
  let out = null;
  const result = store.commit(END_LABEL, (draft, ctx) => {
    out = endInDraft(draft, { slot, sessionId, at: ctx.now });
  });
  return result && result.ok && out ? { ...result, ...out } : result;
}
