// 作品「放进去 / 拿出来」与落印记录的提交（从 src/ui/screens/result/work.js 原样挪来，B2.1；行为不变）。

import { toggleAdded } from '../../core/images/work.js';

export const WORK_LABELS = Object.freeze({ added: 'result:added', sealed: 'result:sealed' });

// ---------------------------------------------------------------- 写入

const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });

function sessionsOf(state) {
  const s = state && state.sessions;
  return s ? { A: s.A || null, B: s.B || null, lastEnded: { ...(s.lastEnded || {}) } } : { A: null, B: null, lastEnded: {} };
}

/** 找本组会话在哪个槽、结束了没有（slot 缺省时按会话 id 找）。 */
export function locateSession(state, { slot = null, sessionId }) {
  const s = sessionsOf(state);
  const slots = slot ? [slot] : ['A', 'B'];
  for (const k of slots) if (s.lastEnded[k] && s.lastEnded[k].id === sessionId) return { slot: k, where: 'ended', session: s.lastEnded[k] };
  for (const k of slots) if (s[k] && s[k].id === sessionId) return { slot: k, where: 'slot', session: s[k] };
  return null;
}

/** 「放进去」/「拿出来」的 mutator 主体：只改本组会话的 added。on 缺省 = 切换。 */
export function setAddedInDraft(draft, { slot = null, sessionId, recordId, on }) {
  const found = locateSession(draft, { slot, sessionId });
  if (!found) throw new Error('added: session not found');
  const { session } = found;
  if (!session.items.some(it => it && it.recordId === recordId)) throw new Error('added: record is not in this session');
  const next = { ...session, added: toggleAdded(session, recordId, on) };
  const cur = sessionsOf(draft);
  if (found.where === 'ended') draft.sessions = { ...cur, lastEnded: { ...cur.lastEnded, [found.slot]: next } };
  else draft.sessions = { ...cur, [found.slot]: next };
  return next;
}

/** 「放进去」/「拿出来」一次 commit。会话已不在（离开了结果页）时 stale。 */
export function commitAdded(store, { slot = null, sessionId, recordId, on } = {}) {
  if (!locateSession(store.getState(), { slot, sessionId })) return STALE;
  return store.commit(WORK_LABELS.added, draft => {
    setAddedInDraft(draft, { slot, sessionId, recordId, on });
  });
}

/** 记下这一组已经落过印（会话上的 sealedAt；冷启动 / 刷新恢复结果页时据此不重演、不再响，I3-05）。幂等：已记过不再写。 */
export function commitSealed(store, { slot = null, sessionId } = {}) {
  const found = locateSession(store.getState(), { slot, sessionId });
  if (!found) return STALE;
  if (Number.isFinite(found.session.sealedAt)) return { ok: true, keys: [], recovered: [], already: true };
  return store.commit(WORK_LABELS.sealed, (draft, ctx) => {
    const again = locateSession(draft, { slot, sessionId });
    if (!again) throw new Error('sealed: session not found');
    const next = { ...again.session, sealedAt: ctx && Number.isFinite(ctx.now) ? ctx.now : Date.now() };
    const cur = sessionsOf(draft);
    if (again.where === 'ended') draft.sessions = { ...cur, lastEnded: { ...cur.lastEnded, [again.slot]: next } };
    else draft.sessions = { ...cur, [again.slot]: next };
  });
}
