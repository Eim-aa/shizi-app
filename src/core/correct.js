// 事后改判的调度重算（D66 ④；P5-01：离开结果页后，字详情的记录里也能改判）。
//
// 结果页 / 写字页的改判（write/result-row.js、result/index.js）靠本会话 items[].fsrsBefore（判断前的卡）重放：会话还在槽里或刚结束时才有。
// 字详情里改的多半是更早的记录，会话早已清掉，所以这里多一条路：
//   1. 这条记录所在的会话（槽 A / B 或各自的 lastEnded）还留着 fsrsBefore → 与原来完全相同：从它起重放本字此后的 judged 记录；
//   2. 没有 → 从空卡起，把本字全部 judged 记录（按 id 顺序，以各自的 at 为 review 时间）重放一遍。
//      这是近似：v1 迁移来的卡、历史上别的调度动作（看过答案记的一次没写出来等）不在 judged 记录里，重放不到；
//      首次判断 / 提示次数 / 热身字的评级都由记录本身决定，所以只改判断本身带来的差别是准的。
//
// 纯函数，不碰存储；调用方（detail/actions.js）在 store.commit 里用它。
import { replay } from './fsrs.js';
import { compareRecordIds, isJudged, sortById } from './records.js';
import { fsrsBeforeOf } from './sessions.js';

/** 在 A / B 两个槽和各自的 lastEnded 里找这条记录判断前的卡；找不到返回 undefined。 */
export function findFsrsBefore(sessions, recordId) {
  const s = sessions || {};
  const candidates = [s.A, s.B, s.lastEnded && s.lastEnded.A, s.lastEnded && s.lastEnded.B];
  for (const session of candidates) {
    const found = session ? fsrsBeforeOf(session, recordId) : undefined;
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 改判后这个字新的 sched 项。
 * @param {object} o
 * @param {object[]} o.records   本字的全部 judged 记录（已含改判后的那一条）
 * @param {string} o.recordId    被改的那条
 * @param {object|undefined} o.fsrsBefore  findFsrsBefore 的结果
 * @param {object} [o.policy] @param {number} [o.stoppedAt]
 * @returns {object|null} 新 sched 项；本字没有 judged 记录时 null（调用方保留原项）
 */
export function schedAfterCorrection({ records, recordId, fsrsBefore, policy, stoppedAt }) {
  const judged = sortById((records || []).filter(isJudged));
  const opts = stoppedAt === undefined ? { policy } : { policy, stoppedAt };
  if (fsrsBefore !== undefined) {
    return replay(fsrsBefore, judged.filter((r) => compareRecordIds(r.id, recordId) >= 0), opts);
  }
  return replay(null, judged, opts);
}
