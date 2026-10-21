// 写字页结果行的模型与改判提交（D19；从 src/ui/screens/write/result-row.js 原样挪来，B2.1；行为不变）。弹层仍在 result-row.js。

import { t } from '../../config/copy/index.js';
import * as defaultPolicy from '../../config/policy.js';
import { compareRecordIds, correctRecord, isJudged, sortById } from '../../core/records.js';
import { canCorrect, fsrsBeforeOf, markLineChanged } from '../../core/sessions.js';
import { replay } from '../../core/fsrs.js';
import { allRecords, replaceRecordInDraft } from './answer.js';

// ---------------------------------------------------------------- 纯函数

const LINE_KEYS = Object.freeze({
  record: { correct: 'R-W10.lineRecordedCorrect', wrong: 'R-W10.lineRecordedWrong' },
  changed: { correct: 'R-W10.lineChangedCorrect', wrong: 'R-W10.lineChangedWrong' },
});

/** 按 id 找记录（全部月份，含折叠月 kept）。 */
export function findRecord(state, recordId) {
  for (const r of allRecords(state)) if (r && r.id === recordId) return r;
  return null;
}

/**
 * 结果行模型（不看「是否显示」，只看会话里紧挨着的上一个字）。
 * @returns {{state:'judged'|'saw'|'skipped'|'none', kind?, recordId?, char?, judgment?, text?, action?, canChange?}}
 */
export function resultRowModel(session, state) {
  if (!session) return { state: 'none' };
  const line = session.lastLine;
  if (!line) {
    const last = session.items && session.items.length ? session.items[session.items.length - 1] : null;
    return last && last.kind === 'skipped' ? { state: 'skipped' } : { state: 'none' };
  }
  const record = findRecord(state, line.recordId);
  const char = record ? record.char : null;
  if (!record || !char) return { state: 'none' };
  if (line.kind === 'saw') {
    return { state: 'saw', kind: 'saw', recordId: record.id, char, text: t('R-W10.lineSaw', { char }), action: null, canChange: false };
  }
  if (!isJudged(record)) return { state: 'none' };
  const keys = LINE_KEYS[line.kind === 'changed' ? 'changed' : 'record'];
  const full = t(keys[record.judgment], { char });
  // 「「X」记为写对 · 修改 ›」→ 正文 +「修改 ›」按钮（原型 L39–L40：· 分隔，› aria-hidden）。
  const cut = full.lastIndexOf(' · ');
  const text = cut >= 0 ? full.slice(0, cut) : full;
  const action = cut >= 0 ? full.slice(cut + 3) : null;
  return {
    state: 'judged',
    kind: line.kind === 'changed' ? 'changed' : 'record',
    recordId: record.id,
    char,
    judgment: record.judgment,
    text,
    action,
    canChange: !!action && canCorrect(session, record.id),
  };
}

/** 结果行是否显示（决定-D19）：回忆阶段、没看过答案、格子里没有本人笔画、本字没落过笔。 */
export function lineVisible({ phase, answerSeen, strokeCount, penDown }) {
  return phase === 'recall' && !answerSeen && !(strokeCount > 0) && !penDown;
}

function sessionOf(state, slot) {
  return state && state.sessions ? state.sessions[slot] || null : null;
}

/**
 * 修改判断的 mutator 主体：同一记录改 judgment + 追加 corrections；从 fsrsBefore 重放本字此后的 judged 记录更新 sched；
 * 会话只改 lastLine（'changed'），current 不动。
 * @returns {{record, entry}}
 */
export function correctInDraft(draft, { slot, recordId, to, at, policy = defaultPolicy }) {
  const s = sessionOf(draft, slot);
  if (!s || !s.lastLine || s.lastLine.recordId !== recordId) throw new Error('correct: not the line record');
  if (!canCorrect(s, recordId)) throw new Error('correct: record cannot be corrected in this session');
  const all = allRecords(draft);
  const record = all.find(r => r && r.id === recordId) || null;
  if (!record || !isJudged(record)) throw new Error('correct: judged record not found');
  const target = to === undefined ? (record.judgment === 'correct' ? 'wrong' : 'correct') : to;
  const next = correctRecord(record, target, at);
  if (next === record) return { record, entry: draft.sched ? draft.sched[record.cardKey] : undefined };
  replaceRecordInDraft(draft, next);
  const later = sortById(all.filter(r => isJudged(r) && r.cardKey === record.cardKey && compareRecordIds(r.id, recordId) >= 0))
    .map(r => (r.id === recordId ? next : r));
  const prev = draft.sched ? draft.sched[record.cardKey] : undefined;
  const entry = replay(fsrsBeforeOf(s, recordId), later, { policy, stoppedAt: prev ? prev.stoppedAt : undefined });
  if (entry) draft.sched = { ...(draft.sched || {}), [record.cardKey]: entry };
  draft.sessions = { ...draft.sessions, [slot]: markLineChanged(s, recordId) };
  return { record: next, entry };
}

/**
 * 修改判断 commit。to 缺省 = 反过来。当前结果行已不是这条记录时 {ok:false, error:{kind:'stale'}}。
 */
export function commitCorrection(store, { slot, recordId, to, policy } = {}) {
  const s = sessionOf(store.getState(), slot);
  if (!s || !s.lastLine || s.lastLine.recordId !== recordId || !canCorrect(s, recordId)) {
    return { ok: false, error: { kind: 'stale' } };
  }
  let out = null;
  const result = store.commit('write:correct', (draft, ctx) => {
    out = correctInDraft(draft, { slot, recordId, to, at: ctx.now, policy });
  });
  return result && result.ok && out ? { ...result, record: out.record } : result;
}
