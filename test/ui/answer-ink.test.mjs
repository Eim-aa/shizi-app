// Q1（QA simB D1）：看答案后「自己写一遍」的本人墨迹存进这条「看过答案」记录（D31 作品成员「看后写的」；D18 不变）。
// 只经 store.commit；记录 kind 仍是 answer-seen、不写判断、不动 sched；描一遍的笔迹不存；一次看答案后多次自己写只留最后一次。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import { commitAnswerSeen, commitAnswerPhase, commitAnswerNext, storeSelfInkInDraft } from '../../src/ui/screens/write/answer.js';
import { commitJudgment } from '../../src/ui/screens/write/compare.js';
import { createSession, withCurrent } from '../../src/core/sessions.js';
import { decodeInk, encodeRawStrokes } from '../../src/core/ink-math.js';
import { buildWork } from '../../src/core/images/work.js';
import { storedInkPresent } from '../../src/core/ink-pick.js';

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

test('Q1: 看答案 → 自己写 → 下一个 stores the self-written ink on the answer-seen record (kind unchanged, no judgment, no sched)', () => {
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
  assert.deepEqual(Object.keys(inkTable(st)), [rec.id], 'exactly one ink entry, keyed by the answer-seen record');
  assert.equal(storedInkPresent(st, rec), true);
  assert.deepEqual(starts(st, rec.id), [[172, 60], [60, 170]], 'the strokes written in 自己写一遍');
  // 作品成员：看过答案 ∧ 有看后自写的本人墨 → 'in'，标「看后写的」
  const work = buildWork({ items: st.sessions.A.items, records: new Map([[rec.id, rec]]), hasInk: x => storedInkPresent(st, x) });
  assert.deepEqual(work.entries.map(e => [e.char, e.state, e.tag]), [['永', 'in', 'afterSeen']]);
});

test('Q1: 描一遍 strokes are never stored; several 自己写 rounds keep only the last one', () => {
  const store = fakeStore(baseState());
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'trace' });
  // 描好了，自己写：离开的是描一遍 → 不存
  assert.ok(commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace', strokes: [D] }).ok);
  assert.deepEqual(inkTable(store.getState()), {}, 'trace strokes are practice, not stored');
  // 第一次自己写 → 再描一遍：存下第一次
  assert.ok(commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'trace', strokes: [H] }).ok);
  const id = records(store.getState())[0].id;
  assert.deepEqual(starts(store.getState(), id), [[60, 170]], 'first self-write stored when leaving 自己写一遍');
  // 再描（不存）→ 第二次自己写 → 下一个：只留第二次
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace', strokes: [D, D] });
  assert.ok(commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [V] }).ok);
  const st = store.getState();
  assert.deepEqual(Object.keys(inkTable(st)), [id], 'still one ink entry for the record');
  assert.deepEqual(starts(st, id), [[172, 60]], 'only the last self-write is kept');
});

test('Q1: an empty last 自己写 keeps the previous one; 下一个 straight from 看答案 / 描一遍 stores nothing', () => {
  const store = fakeStore(baseState(['永', '和', '春']));
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'trace', strokes: [H] });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace', strokes: [D] });
  commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [] });
  const yong = records(store.getState())[0];
  assert.deepEqual(starts(store.getState(), yong.id), [[60, 170]], 'empty last round → the earlier self-write stays');
  // 和：看答案页底部「下一个」（没写）
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:和' });
  commitAnswerNext(store, { slot: 'A', cardKey: 'base:和', strokes: [H] });
  // 春：描一遍里直接「下一个」
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:春' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:春', phase: 'trace' });
  commitAnswerNext(store, { slot: 'A', cardKey: 'base:春', strokes: [H] });
  assert.deepEqual(Object.keys(inkTable(store.getState())), [yong.id], 'answer / trace phases never store ink');
});

test('Q1: the stored session strokes are used when the caller passes none (refresh / cold start in 自己写一遍)', () => {
  const s0 = baseState();
  const store = fakeStore(s0);
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace' });
  // 抬笔写回的会话现场（persist.js commitStrokes 同一编码）
  store.commit('write:strokes', draft => {
    draft.sessions.A = withCurrent(draft.sessions.A, { strokes: encodeRawStrokes([V]) }, T0);
  });
  assert.ok(commitAnswerNext(store, { slot: 'A', cardKey: 'base:永' }).ok);
  const id = records(store.getState())[0].id;
  assert.deepEqual(starts(store.getState(), id), [[172, 60]]);
});

test('Q1: a failed 下一个 writes nothing (no ink, no advance); retry stores once', () => {
  const store = fakeStore(baseState());
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace' });
  store.failNext(1);
  assert.equal(commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [V] }).ok, false);
  assert.deepEqual(inkTable(store.getState()), {});
  assert.equal(store.getState().sessions.A.cursor, 0);
  assert.ok(commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [V] }).ok);
  assert.equal(Object.keys(inkTable(store.getState())).length, 1);
  assert.equal(store.getState().sessions.A.cursor, 1);
});

test('Q1: perRecordInk off (P31) → no after-seen ink either', () => {
  const store = fakeStore(baseState());
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace' });
  commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [V], perRecordInk: false });
  assert.deepEqual(inkTable(store.getState()), {});
});

test('Q1: storeSelfInkInDraft only keeps the latest after-seen ink of a card — an older one (another group) goes, judged first / latest stay', () => {
  // 永：s1 写对（r11，有墨）→ s2 看过答案并自己写（r12）→ s3 又看过答案、正在自己写（当前组）
  const st = baseState(['永']);
  const at = T0;
  st.records = { '2026-10': [
    { id: 'r11', cardKey: 'base:永', char: '永', sessionId: 's1', kind: 'judged', judgment: 'correct', at, localDay: '2026-10-04', help: { hints: 0, answerSeen: false, traced: false } },
    { id: 'r12', cardKey: 'base:永', char: '永', sessionId: 's2', kind: 'answer-seen', at: at + 1, localDay: '2026-10-04', help: { hints: 0, answerSeen: true, traced: false } },
    { id: 'r13', cardKey: 'base:永', char: '永', sessionId: 's3', kind: 'answer-seen', at: at + 2, localDay: '2026-10-04', help: { hints: 0, answerSeen: true, traced: false } },
  ] };
  st.ink = { '2026-10': { r11: { v: 3, c: 345, s: ['AAAA'] }, r12: { v: 3, c: 345, s: ['AAAA'] } } };
  const A = createSession({ id: 's3', kind: 'daily', queue: ['base:永'], at: T0 });
  st.sessions = { A: withCurrent(A, { phase: 'retrace', answerSeen: true }, T0), B: null, lastEnded: {} };
  const draft = JSON.parse(JSON.stringify(st));
  const out = storeSelfInkInDraft(draft, { slot: 'A', cardKey: 'base:永', strokes: [V] });
  assert.equal(out.stored, true);
  assert.equal(out.recordId, 'r13');
  assert.deepEqual(Object.keys(draft.ink['2026-10']).sort(), ['r11', 'r13'], 'r12 (older after-seen, its group closed) recycled; judged r11 kept');
});

test('Q1: a later judgment of the same card does not drop ink while its group is still open (result page / 这次的图片)', () => {
  const store = fakeStore(baseState(['永']));
  commitAnswerSeen(store, { slot: 'A', cardKey: 'base:永' });
  commitAnswerPhase(store, { slot: 'A', cardKey: 'base:永', phase: 'retrace' });
  commitAnswerNext(store, { slot: 'A', cardKey: 'base:永', strokes: [V] });
  const seen = records(store.getState())[0];
  // A 组写完停在结果页（lastEnded.A），同时 B 组（这次选的字）判断了「永」
  store.commit('test:end-A', draft => {
    const A = draft.sessions.A;
    draft.sessions = { A: null, B: createSession({ id: 's2', kind: 'picked', queue: ['base:永'], at: T0 }), lastEnded: { A: { ...A, endedAt: T0 } } };
  });
  assert.ok(commitJudgment(store, { slot: 'B', cardKey: 'base:永', judgment: 'correct', strokes: [H] }).ok);
  assert.equal(storedInkPresent(store.getState(), seen), true, 'after-seen ink of the open group survives the new judgment');
  // 离开结果页（lastEnded 清掉）后，下一次判断就回收它（D27 只留判断的首 / 末；看后写的保留到下次同字有判断）
  store.commit('test:leave-A', draft => {
    draft.sessions = { ...draft.sessions, B: null, lastEnded: {} };
    draft.sessions.A = createSession({ id: 's4', kind: 'daily', queue: ['base:永'], at: T0 });
  });
  assert.ok(commitJudgment(store, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: [D] }).ok);
  assert.equal(storedInkPresent(store.getState(), seen), false, 'recycled once a later judgment exists and its group is closed');
});
