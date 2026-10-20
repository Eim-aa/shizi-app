// D66 ④：字详情里改判（detail/correct.js + core/correct.js）。
// 同一条记录只改 judgment、追加 corrections；调度重算：会话还留着 fsrsBefore 时与结果页的改判完全一致，会话清掉以后从空卡重放。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import { judgeInDraft } from '../../src/ui/screens/write/compare.js';
import { allRecords } from '../../src/ui/screens/write/answer.js';
import { commitResultCorrection } from '../../src/ui/screens/result/index.js';
import { canCorrectHere, commitCorrectRecord, CORRECT_LABEL } from '../../src/ui/screens/detail/correct.js';
import { findFsrsBefore, schedAfterCorrection } from '../../src/core/correct.js';
import { createSession, endSlot } from '../../src/core/sessions.js';
import { makeRecord } from '../../src/core/records.js';
import { replay } from '../../src/core/fsrs.js';
import { memoryZoneOf } from '../../src/ui/screens/library/model.js';

loadFSRSGlobal();

const DAY = 24 * 3600 * 1000;
const T0 = new Date(2026, 8, 24, 12, 0).getTime();
const STROKE = [{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }];

function idGen(start = 1) {
  let n = start - 1;
  return prefix => `${prefix}${(n += 1)}`;
}

function fakeStore(state) {
  let cur = state;
  let now = T0 + 10 * DAY;
  const calls = [];
  return {
    calls,
    getState: () => cur,
    getInk: () => null,
    commit(label, fn) {
      calls.push(label);
      const draft = JSON.parse(JSON.stringify(cur));
      try {
        fn(draft, { now: (now += 1000), label, nextId: p => `${p}${calls.length}` });
      } catch (error) {
        return { ok: false, error: { kind: 'mutator', reason: error.message } };
      }
      cur = draft;
      return { ok: true, keys: [] };
    },
  };
}

/** 永 在 3 天里各写一次（每天一组、每组结束后清掉 lastEnded，最后一组留在 lastEnded 里）。 */
function history({ keepLastEnded = true } = {}) {
  const d = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} }, meta: null };
  const nextId = idGen(10);
  const judgments = ['correct', 'correct', 'wrong'];
  judgments.forEach((judgment, i) => {
    const at = T0 + i * 3 * DAY;
    const id = `s${i + 1}`;
    d.sessions.A = createSession({ id, kind: 'daily', queue: ['base:永'], at });
    judgeInDraft(d, { slot: 'A', cardKey: 'base:永', judgment, strokes: [STROKE], at: at + 1000, nextId, perRecordInk: false });
    d.sessions = endSlot(d.sessions, 'A', { at: at + 2000, early: false });
    if (!(keepLastEnded && i === judgments.length - 1)) d.sessions = { ...d.sessions, lastEnded: {} };
  });
  return d;
}

const recOf = (state, id) => allRecords(state).find(r => r.id === id);

test('canCorrectHere: judged screen records only — not answer-seen / skipped / legacy / paper', () => {
  const base = { id: 'r1', cardKey: 'base:永', sessionId: 's1', at: T0 };
  const judged = makeRecord({ ...base, kind: 'judged', judgment: 'correct', help: { hints: 0, answerSeen: false, traced: false } });
  assert.equal(canCorrectHere(judged), true);
  assert.equal(canCorrectHere({ ...judged, legacy: true }), false, 'v1 records cannot be corrected (K25)');
  assert.equal(canCorrectHere({ ...judged, source: 'paper' }), false, 'paper records have no ink cell');
  assert.equal(canCorrectHere({ ...judged, kind: 'answer-seen' }), false);
  assert.equal(canCorrectHere({ ...judged, kind: 'skipped' }), false);
  assert.equal(canCorrectHere(null), false);
});

test('commitCorrectRecord (session gone): same record flipped, corrections appended, no record added, sched replayed from the card’s whole history', () => {
  const d = history({ keepLastEnded: false });
  const store = fakeStore(d);
  const before = allRecords(store.getState());
  const first = before[0];
  assert.equal(first.judgment, 'correct');
  assert.equal(findFsrsBefore(store.getState().sessions, first.id), undefined, 'no session left that remembers the card before this judgment');
  const dueBefore = store.getState().sched['base:永'].due;
  const r = commitCorrectRecord(store, { recordId: first.id });
  assert.equal(r.ok, true);
  assert.deepEqual(store.calls, [CORRECT_LABEL]);
  const after = store.getState();
  assert.equal(allRecords(after).length, before.length, 'no record added');
  const rec = recOf(after, first.id);
  assert.equal(rec.judgment, 'wrong');
  assert.deepEqual(rec.corrections.map(c => c.from), ['correct']);
  assert.equal(rec.at, first.at, 'at unchanged');
  const expected = replay(null, allRecords(after).filter(x => x.cardKey === 'base:永'), {});
  assert.deepEqual(after.sched['base:永'], expected, 'sched = the whole judged history replayed with the new judgment');
  assert.notEqual(after.sched['base:永'].due, dueBefore, 'the next-practice day moved');
  // 再点一次改回去：判断回到原来，调度也回到原来（撤销规则 = 反过来再改一次）
  assert.equal(commitCorrectRecord(store, { recordId: first.id }).ok, true);
  const back = recOf(store.getState(), first.id);
  assert.equal(back.judgment, 'correct');
  assert.equal(back.corrections.length, 2);
  assert.equal(store.getState().sched['base:永'].due, dueBefore, 'flipping back restores the schedule');
});

test('the library zone follows the corrected latest record (待复习) without any other write', () => {
  const d = history({ keepLastEnded: false });
  const store = fakeStore(d);
  const lastId = allRecords(store.getState()).slice(-1)[0].id;
  const today = '2026-10-04';
  const zoneOf = () => {
    const s = store.getState();
    const latest = allRecords(s).filter(r => r.judgment).slice(-1)[0];
    return memoryZoneOf(latest, s.sched['base:永'], today);
  };
  assert.equal(zoneOf(), 'due', 'latest is wrong → 待复习');
  assert.equal(commitCorrectRecord(store, { recordId: lastId }).ok, true);
  assert.notEqual(zoneOf(), 'due', 'latest corrected to correct → no longer in the 待复习 zone');
});

test('equivalence: when the session still remembers the card, detail correction = result-page correction (same sched, same record)', () => {
  const viaResult = fakeStore(history({ keepLastEnded: true }));
  const viaDetail = fakeStore(history({ keepLastEnded: true }));
  const lastId = allRecords(viaResult.getState()).slice(-1)[0].id; // 最后一组还在 lastEnded.A 里
  assert.notEqual(findFsrsBefore(viaDetail.getState().sessions, lastId), undefined);
  assert.equal(commitResultCorrection(viaResult, { slot: 'A', sessionId: 's3', recordId: lastId }).ok, true);
  assert.equal(commitCorrectRecord(viaDetail, { recordId: lastId }).ok, true);
  assert.deepEqual(viaDetail.getState().sched, viaResult.getState().sched);
  assert.deepEqual(recOf(viaDetail.getState(), lastId), recOf(viaResult.getState(), lastId));
});

test('commitCorrectRecord: unknown / not-correctable records are stale and write nothing', () => {
  const store = fakeStore(history({ keepLastEnded: false }));
  assert.equal(commitCorrectRecord(store, { recordId: 'r404' }).error.kind, 'stale');
  assert.deepEqual(store.calls, []);
});

test('schedAfterCorrection: a card with no judged record gives null (the caller keeps the old entry)', () => {
  assert.equal(schedAfterCorrection({ records: [], recordId: 'r1', fsrsBefore: undefined }), null);
});
