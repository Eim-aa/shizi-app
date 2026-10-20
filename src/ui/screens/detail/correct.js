// 字详情里改判（D66 ④；P5-01）：记录格放大弹层里的「改为写错 / 写对」。
//
// 与结果页（result/index.js correctResultInDraft）、写字页（write/result-row.js correctInDraft）同一套规则：同一条记录只改 judgment、
// 追加 corrections（core/records.correctRecord），不增加记录；撤销规则也一样——没有撤销条，弹层里的按钮反过来再点一次就改回去。
// 区别只在调度重算：结果页 / 写字页靠本会话的 fsrsBefore；字详情多半在会话清掉之后改，重算见 core/correct.js（会话还留着 fsrsBefore 就用，否则从空卡重放）。
// 改判后字库三档、首页、下次练习日同步：它们都从记录与 sched 实时算，不另存。
import * as defaultPolicy from '../../../config/policy.js';
import { correctRecord, isJudged, isPaperRecord } from '../../../core/records.js';
import { findFsrsBefore, schedAfterCorrection } from '../../../core/correct.js';
import { allRecords, replaceRecordInDraft } from '../write/answer.js';

export const CORRECT_LABEL = 'detail:correct';

/** 这条记录能不能在字详情里改判：judged、不是 v1 旧记录、不是纸上记录（纸上的没有笔迹格，也不进放大弹层）。 */
export function canCorrectHere(record) {
  return !!record && isJudged(record) && !record.legacy && !isPaperRecord(record);
}

/**
 * mutator 主体。to 缺省 = 反过来。
 * @returns {{record, entry}}
 */
export function correctRecordInDraft(draft, { recordId, to, at, policy = defaultPolicy }) {
  const all = allRecords(draft);
  const record = all.find(r => r && r.id === recordId) || null;
  if (!canCorrectHere(record)) throw new Error('correct: record cannot be corrected here');
  const target = to === undefined ? (record.judgment === 'correct' ? 'wrong' : 'correct') : to;
  const next = correctRecord(record, target, at);
  if (next === record) return { record, entry: draft.sched ? draft.sched[record.cardKey] : undefined };
  replaceRecordInDraft(draft, next);
  const mine = all.filter(r => r && r.cardKey === record.cardKey).map(r => (r.id === recordId ? next : r));
  const prev = draft.sched ? draft.sched[record.cardKey] : undefined;
  const entry = schedAfterCorrection({
    records: mine, recordId, fsrsBefore: findFsrsBefore(draft.sessions, recordId), policy, stoppedAt: prev ? prev.stoppedAt : undefined,
  });
  if (entry) draft.sched = { ...(draft.sched || {}), [record.cardKey]: entry };
  return { record: next, entry };
}

/** commit。记录已不存在 / 不能改时 {ok:false, error:{kind:'stale'}}。 */
export function commitCorrectRecord(store, { recordId, to, policy } = {}) {
  const record = allRecords(store.getState()).find(r => r && r.id === recordId) || null;
  if (!canCorrectHere(record)) return { ok: false, error: { kind: 'stale' } };
  let out = null;
  const result = store.commit(CORRECT_LABEL, (draft, ctx) => {
    out = correctRecordInDraft(draft, { recordId, to, at: ctx.now, policy });
  });
  return result && result.ok && out ? { ...result, record: out.record } : result;
}
