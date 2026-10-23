// 字详情的提交函数（B3.7：从 src/ui/screens/detail/actions.js / correct.js 原样挪来；行为不变，原导入路径仍转出同一批函数）。
// 无 DOM、不依赖 UI：网页字详情页与 App API（api/detail.js：detail.wordOff / wordOn / addCustom / removeCustom / restoreCustom / correct）共用，store.commit 仍是唯一写入口。
//
//   commitWordOff(store, cardKey)          「换掉这个词语」：wordOff[cardKey] = now（01 §3.5）。写字页题面随之改只按拼音写。
//   commitWordOn(store, cardKey)           横幅「撤销」：删掉 wordOff[cardKey]。
//   commitAddCustom(store, char)           「加入自选」（D66 ⑮；与查字卡同一个规则：已在自选里不写）。
//   commitRemoveCustom(store, char)        「移出自选」：从 custom.added 删掉这个字；记录不动（R-D06）。返回 {ok, removed:{entry, index}}（撤销用）。
//   commitRestoreCustom(store, removed)    撤销：按原来的位置放回原来的 {char, at}（已在里面时不写）。
//   commitCorrectRecord(store, {recordId, to?})  记录格放大里改判（D66 ④）：同一条记录只改 judgment、追加 corrections；调度重算见 core/correct.js。
// 失败（D07）：store.commit 回 {ok:false, error}，什么都不写；页面就地三段式。

import * as defaultPolicy from '../../config/policy.js';
import { correctRecord, isJudged, isPaperRecord } from '../../core/records.js';
import { findFsrsBefore, schedAfterCorrection } from '../../core/correct.js';
import { withCustomAdded } from '../../core/query.js';
import { allRecords, replaceRecordInDraft } from './answer.js';

export const LABELS = Object.freeze({
  wordOff: 'detail:word-off',
  wordOn: 'detail:word-off-undo',
  remove: 'detail:custom-remove',
  restore: 'detail:custom-restore',
});

/** 加入自选的提交标签（与查字卡 QuerySheet 的 ADD_LABEL 同值：两条路径写出同一个提交序列）。 */
export const ADD_CUSTOM_LABEL = 'query:add';
export const CORRECT_LABEL = 'detail:correct';

/** 「换掉这个词语」：wordOff[cardKey] = now。已换掉时不写。 */
export function commitWordOff(store, cardKey) {
  return store.commit(LABELS.wordOff, (draft, ctx) => {
    const cur = draft.wordOff && typeof draft.wordOff === 'object' ? draft.wordOff : {};
    if (Object.prototype.hasOwnProperty.call(cur, cardKey)) return;
    draft.wordOff = { ...cur, [cardKey]: ctx.now };
  });
}

/** 撤销「换掉这个词语」：删掉 wordOff[cardKey]。不在里面时不写。 */
export function commitWordOn(store, cardKey) {
  return store.commit(LABELS.wordOn, draft => {
    const cur = draft.wordOff && typeof draft.wordOff === 'object' ? draft.wordOff : null;
    if (!cur || !Object.prototype.hasOwnProperty.call(cur, cardKey)) return;
    const next = { ...cur };
    delete next[cardKey];
    draft.wordOff = next;
  });
}

/** 「从自选的字移除」：custom.added 删掉这个字（记录不动，D21 / R-D06）。返回 commit 结果 + removed。 */
export function commitRemoveCustom(store, char) {
  let removed = null;
  const result = store.commit(LABELS.remove, draft => {
    const custom = draft.custom && typeof draft.custom === 'object' ? draft.custom : null;
    const added = custom && Array.isArray(custom.added) ? custom.added : [];
    const index = added.findIndex(e => e && e.char === char);
    if (index < 0) return;
    removed = { entry: { ...added[index] }, index };
    draft.custom = { ...custom, added: added.filter((_, i) => i !== index) };
  });
  return result.ok ? { ...result, removed } : result;
}

/** 撤销移除：把原来的 {char, at} 放回原来的位置（已在里面时不写）。 */
export function commitRestoreCustom(store, removed) {
  return store.commit(LABELS.restore, draft => {
    if (!removed || !removed.entry) return;
    const custom = draft.custom && typeof draft.custom === 'object' ? draft.custom : {};
    const added = Array.isArray(custom.added) ? custom.added : [];
    if (added.some(e => e && e.char === removed.entry.char)) return;
    const at = Math.max(0, Math.min(Number.isInteger(removed.index) ? removed.index : added.length, added.length));
    draft.custom = { ...custom, added: [...added.slice(0, at), { ...removed.entry }, ...added.slice(at)] };
  });
}

/** 「加入自选」（D66 ⑮）：已在自选里不写，经 store.commit（与查字卡 commitAdd 同一条规则、同一个标签）。 */
export function commitAddCustom(store, char) {
  return store.commit(ADD_CUSTOM_LABEL, (draft, ctx) => {
    const next = withCustomAdded(draft.custom, char, ctx.now);
    if (next) draft.custom = next;
  });
}

// ---------------------------------------------------------------- 字详情里改判（D66 ④；P5-01）
// 与结果页（result/index.js correctResultInDraft）、写字页（write/result-row.js correctInDraft）同一套规则：同一条记录只改 judgment、
// 追加 corrections（core/records.correctRecord），不增加记录；撤销规则也一样——没有撤销条，弹层里的按钮反过来再点一次就改回去。
// 区别只在调度重算：结果页 / 写字页靠本会话的 fsrsBefore；字详情多半在会话清掉之后改，重算见 core/correct.js（会话还留着 fsrsBefore 就用，否则从空卡重放）。

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
