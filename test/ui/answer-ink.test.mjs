// D70 ②（NF-05，覆盖 Q1）：看答案后「凭记忆写」的笔迹只算练习，不存为作品里的「看后写的」。
// 只经 store.commit；记录 kind 仍是 answer-seen、不写判断、不动 sched；描一遍与凭记忆写的笔迹都不存；已有存量数据不迁移。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import { commitAnswerSeen, commitAnswerPhase, commitAnswerNext, storeSelfInkInDraft } from '../../src/ui/screens/write/answer.js';
import { commitJudgment } from '../../src/ui/screens/write/compare.js';
import { createSession, withCurrent } from '../../src/core/sessions.js';
import { decodeInk, encodeRawStrokes } from '../../src/core/ink-math.js';
import { buildWork } from '../../src/core/images/work.js';
import { storedInkPresent } from '../../src/core/ink-pick.js';
import { applyJudgment } from '../../src/core/fsrs.js';
import { makeRecord } from '../../src/core/records.js';

loadFSRSGlobal();

const T0 = new Date(2026, 9, 4, 12, 0).getTime();
const H = [{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }];
const V = [{ x: 172, y: 60, t: 0 }, { x: 173, y: 170, t: 60 }, { x: 174, y: 280, t: 120 }];
const D = [{ x: 80, y: 80, t: 0 }, { x: 170, y: 170, t: 60 }, { x: 260, y: 260, t: 120 }];

function baseState(chars = ['永', '和']) {
  const A = createSession({ id: 's1', kind: 'daily', queue: chars.map(c => 'base:' + c), at: T0 });
  return { records: {}, sched: {}, ink: {}, sessions: { A, B: null, lastEnded: {} }, meta: null };
}

/** 最小 store：commit = 深拷贝草稿 → mutate；可注入失败。 */
function fakeStore(state, { fail = 0 } = {}) {
  let cur = state;
  let failures = fail;
  let now = T0 + 60_000;
  let serial = 10;
  return {
    getState: () => cur,
    failNext(n = 1) { failures = n; },
    commit(label, fn) {
      const draft = JSON.parse(JSON.stringify(cur));
      try {
        fn(draft, { now: (now += 1000), label, nextId: p => `${p}${(serial += 1)}` });
      } catch (error) {
        return { ok: false, error: { kind: 'mutator', reason: error.message } };
      }
      if (failures > 0) {
        failures -= 1;
        return { ok: false, error: { kind: 'generic' } };
      }
      cur = draft;
      return { ok: true, keys: [] };
    },
  };
}

function records(state) {
  return Object.values(state.records).flatMap(v => (Array.isArray(v) ? v : v.kept));
}

function inkTable(state) {
  const out = {};
  for (const m of Object.keys(state.ink || {})) Object.assign(out, state.ink[m]);
  return out;
}

/** 解码后每笔的起点（345 单位）。 */
function starts(state, id) {
  const month = Object.keys(state.ink).find(m => state.ink[m][id]);
  return decodeInk(state.ink[month][id]).map(s => [Math.round(s[0].x), Math.round(s[0].y)]);
}

test('D70 ②: 看答案 → 凭记忆写 → 下一个 stores no ink (kind unchanged, no judgment, no sched); the record is still 看过答案 and not an 作品 member', () => {
  const store = fakeStore(baseState());
  assert.ok(commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' }).ok);
  assert.ok(commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace' }).ok);
  const r = commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [V, H] });
  assert.ok(r.ok);
  const st = store.getState();
  const [rec] = records(st);
  assert.equal(rec.kind, 'answer-seen', 'still 看过答案 (D18)');
  assert.equal(rec.judgment, undefined, 'no judgment');
  assert.deepEqual(st.sched, {}, 'no FSRS entry');
  assert.deepEqual(inkTable(st), {}, 'the memory-write strokes are practice only — nothing stored');
  assert.equal(storedInkPresent(st, rec), false);
  // 没有看后自写的本人墨 → 不是作品成员（不进结果页作品 / 字库缩略图）
  const work = buildWork({ items: st.sessions.A.items, records: new Map([[rec.id, rec]]), hasInk: x => storedInkPresent(st, x) });
  assert.ok(!work.entries.some(e => e.state === 'in'), 'no 看后写的 cell in the work');
});

test('D70 ②: 描一遍 and 凭记忆写 strokes are never stored, however many rounds and whichever way you leave', () => {
  const store = fakeStore(baseState(['永', '和', '春']));
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'trace' });
  assert.ok(commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace', strokes: [D] }).ok);
  assert.ok(commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'trace', strokes: [H] }).ok, 'leaving 凭记忆写 to 再描一遍');
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace', strokes: [D, D] });
  assert.ok(commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [V] }).ok);
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:和' });
  commitAnswerNext(store, { slot: 'A', cardKey: 'base:和', strokes: [H] });
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:春' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:春', phase: 'trace' });
  commitAnswerNext(store, { slot: 'A', cardKey: 'base:春', strokes: [H] });
  assert.deepEqual(inkTable(store.getState()), {});
  assert.equal(store.getState().sessions.A.cursor, 3, 'the group still advances');
});

test('D70 ②: the session strokes (refresh / cold start in 凭记忆写) are not stored either', () => {
  const store = fakeStore(baseState());
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace' });
  store.commit('write:strokes', draft => {
    draft.sessions.A = withCurrent(draft.sessions.A, { strokes: encodeRawStrokes([V]) }, T0);
  });
  assert.ok(commitAnswerNext(store, { slot: 'A', cardKey: 'base:永' }).ok);
  assert.deepEqual(inkTable(store.getState()), {});
});

test('D70 ②: a failed 下一个 writes nothing and does not advance; retry advances without ink', () => {
  const store = fakeStore(baseState());
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace' });
  store.failNext(1);
  assert.equal(commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [V] }).ok, false);
  assert.equal(store.getState().sessions.A.cursor, 0);
  assert.ok(commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [V] }).ok);
  assert.deepEqual(inkTable(store.getState()), {});
  assert.equal(store.getState().sessions.A.cursor, 1);
});

test('D70 ②: storeSelfInkInDraft never writes (existing stored after-seen ink is left as is — no migration)', () => {
  const st = baseState(['永']);
  const at = T0;
  st.records = { '2026-10': [
    { id: 'r12', cardKey: 'base:永', char: '永', sessionId: 's2', kind: 'answer-seen', at, localDay: '2026-10-04', help: { hints: 0, answerSeen: true, traced: false } },
    { id: 'r13', cardKey: 'base:永', char: '永', sessionId: 's3', kind: 'answer-seen', at: at + 2, localDay: '2026-10-04', help: { hints: 0, answerSeen: true, traced: false } },
  ] };
  st.ink = { '2026-10': { r12: { v: 3, c: 345, s: ['AAAA'] } } };
  const A = createSession({ id: 's3', kind: 'daily', queue: ['base:永'], at: T0 });
  st.sessions = { A: withCurrent(A, { phase: 'retrace', answerSeen: true }, T0), B: null, lastEnded: {} };
  const draft = JSON.parse(JSON.stringify(st));
  const out = storeSelfInkInDraft(draft, { slot: 'A', cardKey: 'base:永', strokes: [V] });
  assert.equal(out.stored, false);
  assert.equal(out.recordId, 'r13');
  assert.deepEqual(draft.ink, st.ink, 'draft ink untouched');
});

// ---------------------------------------------------------------- D66 ①：看答案的调度（经真实的 commit 函数）

test('D66 ①: 看答案 on a review char records one Again in the same commit; a judgment written after it the same day is not rated again', () => {
  const state = baseState(['永', '和']);
  // 永 是复习字：三周前第一次写对，今天到期
  const old = makeRecord({ id: 'r1', cardKey: 'base:永', sessionId: 's9', kind: 'judged', judgment: 'correct', at: T0 - 21 * 86400000, help: {} });
  state.records[old.localDay.slice(0, 7)] = [old];
  state.sched['base:永'] = { ...applyJudgment(undefined, old).entry, due: '2026-10-04' };
  const store = fakeStore(state);
  const before = store.getState().sched['base:永'];
  // 提示给完整个字 = 看过答案，留在回忆阶段继续写（stay），然后判断
  assert.ok(commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永', stay: true, hints: 4 }).ok);
  const seen = store.getState().sched['base:永'];
  assert.equal(seen.seenAgainDay, '2026-10-04');
  assert.equal(seen.fsrs.reps, before.fsrs.reps + 1, 'one FSRS step (Again)');
  assert.equal(seen.fsrs.lapses, before.fsrs.lapses + 1);
  assert.equal(seen.lastJudgedAt, before.lastJudgedAt, 'not a judgment');
  assert.equal(records(store.getState()).filter(r => r.kind === 'judged').length, 1, 'no new judged record');
  const j = commitJudgment(store, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [H, V], hints: 4, perRecordInk: false });
  assert.ok(j.ok);
  const after = store.getState().sched['base:永'];
  assert.deepEqual(after.fsrs, seen.fsrs, 'held: no second Again, no credit');
  assert.equal(after.due, seen.due);
  // 新字看答案：不建调度项
  assert.ok(commitAnswerSeen(store, { slot: 'A', cardKey: 'base:和' }).ok);
  assert.equal(store.getState().sched['base:和'], undefined);
});
