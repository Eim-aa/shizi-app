// 金标准 · 契约（test/core/contract.test.mjs 的 Swift 对口）：core 产出的记录 / 调度项 / 会话（整个生命周期每一步）必须通过 store 形状表。
// JS 一侧用真实的 core（makeRecord / correctRecord / applyJudgment / replay / sessions.*）造出这些值，写成夹具 {label, key, value}；
// Swift 的 ContractTests 对每一条跑 Schema.validateValue 并走模型往返（逐字节不变）。B4.2 的 Swift 版 fsrs / sessions 落地后，
// 它们产出的值由各自的测试与随机差分过同一张形状表。
import { makeRecord, correctRecord } from '../../../src/core/records.js';
import { recordsKey, KEYS } from '../../../src/core/schema.js';
import {
  emptySessions, createSession, withCurrent, advance, undoSkip, startInSlot, endSlot, endAndStartPicked, expireDaily, markLineChanged,
} from '../../../src/core/sessions.js';
import { applyJudgment, replay } from '../../../src/core/fsrs.js';
import * as policy from '../../../src/config/policy.js';
import { loadFSRSGlobal, at } from '../../../test/core/helpers.mjs';

const TODAY = '2026-09-24';
const K = (s) => [...s].map((c) => 'base:' + c);

export default {
  id: 'contract',
  source: 'src/core/records.js、fsrs.js、sessions.js（产出）→ src/core/schema.js（形状表）',
  build({ withTZ }) {
    loadFSRSGlobal();
    return withTZ('Asia/Shanghai', () => {
      const cases = [];
      const add = (label, key, value) => cases.push({ label, key, value: JSON.parse(JSON.stringify(value)) });

      // 1. 记录
      const judged = makeRecord({ id: 'r1', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'wrong', at: at(TODAY, 20), help: { hints: 2, traced: false } });
      const seen = makeRecord({ id: 'r2', cardKey: 'base:亦', sessionId: 's1', kind: 'answer-seen', at: at(TODAY, 20, 1) });
      const skipped = makeRecord({ id: 'r3', cardKey: 'base:慢', sessionId: 's1', kind: 'skipped', at: at(TODAY, 20, 2) });
      const corrected = correctRecord(judged, 'correct', at(TODAY, 20, 5));
      add('records: month list', recordsKey('2026-09'), [judged, seen, skipped]);
      add('records: corrected', recordsKey('2026-09'), [corrected]);

      // 2. 调度项
      const r1 = makeRecord({ id: 'r1', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'correct', at: at('2026-09-01', 20) });
      const r2 = makeRecord({ id: 'r2', cardKey: 'base:静', sessionId: 's2', kind: 'judged', judgment: 'wrong', at: at(TODAY, 20) });
      const first = applyJudgment(undefined, r1);
      const second = applyJudgment(first.entry, r2);
      const fixed = replay(second.fsrsBefore, [correctRecord(r2, 'correct', at(TODAY, 21))]);
      add('sched: applyJudgment / replay', KEYS.sched, { 'base:静': fixed, 'base:亦': applyJudgment(undefined, { ...r1, id: 'r3', cardKey: 'base:亦', char: '亦' }).entry });
      add('sched: first judgment', KEYS.sched, { 'base:静': first.entry });
      add('sched: second judgment', KEYS.sched, { 'base:静': second.entry });

      // 3. 会话生命周期
      let sessions = emptySessions();
      add('sessions: empty', KEYS.sessions, sessions);
      const rr = makeRecord({ id: 'r2', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'wrong', at: at(TODAY, 8) });
      const { fsrsBefore } = applyJudgment(undefined, rr);
      let a = createSession({ id: 's1', kind: 'daily', source: { view: 'home' }, queue: K('静亦慢'), at: at(TODAY, 8) });
      a = withCurrent(a, { strokes: [[1, 2, 3]], hints: 1, hintRange: { from: 0, count: 1, index: 1 } }, at(TODAY, 8, 1));
      sessions = startInSlot(sessions, a);
      add('sessions: A started with current', KEYS.sessions, sessions);
      a = advance(sessions.A, { cardKey: 'base:静', recordId: 'r2', kind: 'judged', fsrsBefore, at: at(TODAY, 8, 2) });
      a = markLineChanged(a, 'r2');
      a = advance(a, { cardKey: 'base:亦', recordId: 'r3', kind: 'skipped', at: at(TODAY, 8, 3) });
      a = undoSkip(a, 'r3', at(TODAY, 8, 4));
      sessions = { ...sessions, A: a };
      add('sessions: A advanced', KEYS.sessions, sessions);
      let b = createSession({ id: 's4', kind: 'picked', source: { view: 'detail', char: '鲜' }, queue: K('鲜境'), at: at(TODAY, 9) });
      b = advance(b, { cardKey: 'base:鲜', recordId: 'r5', kind: 'answer-seen', at: at(TODAY, 9, 1) });
      sessions = startInSlot(sessions, b);
      add('sessions: A + B', KEYS.sessions, sessions);
      const s02 = endAndStartPicked(sessions, createSession({ id: 's6', kind: 'picked', source: { view: 'wrongList' }, queue: K('额'), at: at(TODAY, 10) }), { at: at(TODAY, 10) });
      add('sessions: after S02', KEYS.sessions, s02.sessions);
      add('sessions: A ended', KEYS.sessions, endSlot(s02.sessions, 'A', { at: at(TODAY, 11), early: true }));
      const yesterday = { ...s02.sessions, A: createSession({ id: 's7', kind: 'daily', queue: K('主'), at: at('2026-09-23', 8) }) };
      add('sessions: expired (discard)', KEYS.sessions, expireDaily(yesterday, TODAY).sessions);
      add('sessions: expired (result)', KEYS.sessions, expireDaily(yesterday, TODAY, { ...policy, dailyExpiry: 'result' }).sessions);
      return { cases };
    });
  },
};
