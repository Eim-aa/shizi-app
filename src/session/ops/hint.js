// 提示的现场写入（hints / hintRange；从 src/ui/screens/write/hint-layer.js 挪来，B2.1；行为不变）。
// 提示给完整个字时记为看过答案走 answer.js commitAnswerSeen（stay），与网页同一口径（D64 ①）。

import { currentCardKey, withCurrent } from '../../core/sessions.js';

/**
 * store.commit 的 mutator 主体：把 {hints?, hintRange} 写进 draft.sessions[slot].current。
 * 会话 / 当前字已经变了（换字、会话结束）就不写，返回 false。
 */
export function applyHintToDraft(draft, { slot, sessionId, cardKey, hints, hintRange }, at) {
  const sessions = draft.sessions;
  const s = sessions ? sessions[slot] : null;
  if (!s || s.id !== sessionId || currentCardKey(s) !== cardKey || !s.current) return false;
  const patch = { hintRange: hintRange ? { from: hintRange.from, to: hintRange.to } : null };
  if (hints !== undefined) patch.hints = Math.max(Number(s.current.hints) || 0, hints);
  draft.sessions = { ...sessions, [slot]: withCurrent(s, patch, at) };
  return true;
}

/**
 * 提示的现场写入一次 commit（label：'hint' 给出提示 / 'hint-fade' 提示笔收掉或回来）。写入失败按 P52 不阻断，调用方只记下结果。
 * 会话 / 当前字已经变了时 commit 成功但 applied = false（与 applyHintToDraft 同口径）。
 * @returns {{ok:true, applied:boolean} | {ok:false, error}}
 */
export function commitHint(store, { slot, sessionId, cardKey, hints, hintRange }, label = 'hint') {
  let applied = false;
  const result = store.commit(label, (draft, ctx) => {
    applied = applyHintToDraft(draft, { slot, sessionId, cardKey, hints, hintRange }, ctx.now);
  });
  return result && result.ok ? { ok: true, applied } : { ok: false, error: result && result.error };
}
