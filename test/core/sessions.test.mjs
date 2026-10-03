import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slotOfKind,
  emptySessions,
  createSession,
  currentCardKey,
  remainingCount,
  isComplete,
  withCurrent,
  advance,
  markLineChanged,
  clearLine,
  undoSkip,
  fsrsBeforeOf,
  canCorrect,
  startInSlot,
  endSlot,
  clearLastEnded,
  resumeLines,
  s02Prompt,
  endAndStartPicked,
  expireDaily,
  recoverSession,
  nextAKind,
  selectFirst,
  selectDaily,
} from '../../src/core/sessions.js';
import * as policy from '../../src/config/policy.js';
import { t } from '../../src/config/copy/index.js';
import { at, rec, policyWith } from './helpers.mjs';

const TODAY = '2026-09-24';
const K = (s) => [...s].map((c) => 'base:' + c);
const sched = (due, stability = 5) => ({ fsrs: { stability }, due, lastJudgedAt: 0 });

function daily(id, chars, day = TODAY) {
  return createSession({ id, kind: 'daily', source: { view: 'home' }, queue: K(chars), at: at(day, 8) });
}
function picked(id, chars, source = { view: 'home' }) {
  return createSession({ id, kind: 'picked', source, queue: K(chars), at: at(TODAY, 9) });
}

test('sessions: kinds map to slots A/B and createSession validates its queue', () => {
  assert.equal(slotOfKind('first'), 'A');
  assert.equal(slotOfKind('daily'), 'A');
  assert.equal(slotOfKind('picked'), 'B');
  const s = daily('s1', '静亦慢');
  assert.equal(s.slot, 'A');
  assert.equal(s.startedDay, TODAY);
  assert.equal(currentCardKey(s), 'base:静');
  assert.equal(remainingCount(s), 3);
  assert.deepEqual(s.current, { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false });
  assert.throws(() => daily('s2', '静静'), /repeat/);
  assert.throws(() => createSession({ id: 'x', kind: 'daily', queue: K('静'), at: 1 }), /session id/);
  assert.throws(() => createSession({ id: 's3', kind: 'focus', queue: K('静'), at: 1 }), /kind/);
  assert.throws(() => createSession({ id: 's3', kind: 'daily', queue: [], at: 1 }), /non-empty/);
});

test('sessions: advancing records items, moves the cursor and sets the result line (D19)', () => {
  let s = daily('s1', '静亦慢');
  s = withCurrent(s, { strokes: [[1, 2]], hints: 1 });
  s = advance(s, { cardKey: 'base:静', recordId: 'r1', kind: 'judged', fsrsBefore: null, at: 5 });
  assert.equal(s.cursor, 1);
  assert.deepEqual(s.current.strokes, [], 'fresh current for the next char');
  assert.deepEqual(s.lastLine, { recordId: 'r1', kind: 'record' });
  s = advance(s, { cardKey: 'base:亦', recordId: 'r2', kind: 'answer-seen', at: 6 });
  assert.deepEqual(s.lastLine, { recordId: 'r2', kind: 'saw' });
  s = advance(s, { cardKey: 'base:慢', recordId: 'r3', kind: 'skipped', at: 7 });
  assert.equal(s.lastLine, null, 'skip clears the line');
  assert.equal(isComplete(s), true);
  assert.deepEqual(s.items.map((i) => i.kind), ['judged', 'answer-seen', 'skipped']);
  assert.equal('fsrsBefore' in s.items[1], false, 'only judged items keep fsrsBefore');
  assert.throws(() => advance(daily('s9', '静亦'), { cardKey: 'base:亦', kind: 'judged' }), /current card/);
  assert.throws(() => withCurrent(s, { phase: 'feedback' }), /phase/);
});

test('sessions: result line can switch to "changed" and collapses on demand', () => {
  let s = advance(daily('s1', '静亦'), { cardKey: 'base:静', recordId: 'r1', kind: 'judged', fsrsBefore: null });
  assert.equal(markLineChanged(s, 'r9'), s, 'other record: unchanged');
  s = markLineChanged(s, 'r1');
  assert.deepEqual(s.lastLine, { recordId: 'r1', kind: 'changed' });
  assert.equal(t('R-W10.lineChangedCorrect', { char: '静' }), '「静」已改为写对 · 修改 ›');
  assert.equal(clearLine(s).lastLine, null);
});

test('sessions: skip undo puts the char back at the cursor (W16)', () => {
  let s = advance(daily('s1', '静亦'), { cardKey: 'base:静', recordId: 'r1', kind: 'skipped' });
  s = undoSkip(s, 'r1', 9);
  assert.equal(currentCardKey(s), 'base:静');
  assert.equal(s.items.length, 0);
  assert.equal(s.current.phase, 'recall');
  const judged = advance(daily('s2', '静亦'), { cardKey: 'base:静', recordId: 'r2', kind: 'judged', fsrsBefore: null });
  assert.throws(() => undoSkip(judged, 'r2'), /not this skip/);
});

test('sessions: fsrsBefore lives only in the session and gates corrections', () => {
  const card = { due: '2026-09-30T00:00:00.000Z' };
  let s = advance(daily('s1', '静亦慢'), { cardKey: 'base:静', recordId: 'r1', kind: 'judged', fsrsBefore: card });
  s = advance(s, { cardKey: 'base:亦', recordId: 'r2', kind: 'answer-seen' });
  assert.equal(fsrsBeforeOf(s, 'r1'), card);
  assert.equal(canCorrect(s, 'r1'), true);
  assert.equal(canCorrect(s, 'r2'), false, 'answer-seen cannot be re-judged (K25)');
  assert.equal(canCorrect(null, 'r1'), false);
});

test('sessions: A and B are isolated — opening B leaves A exactly as it was (D05)', () => {
  let sessions = emptySessions();
  let a = withCurrent(daily('s1', '静亦慢'), { strokes: [[1, 2, 3]], hints: 1, phase: 'recall' });
  sessions = startInSlot(sessions, a);
  const snapshot = JSON.parse(JSON.stringify(sessions.A));
  sessions = startInSlot(sessions, picked('s2', '鲜境'));
  assert.deepEqual(sessions.A, snapshot);
  assert.equal(sessions.B.id, 's2');
  assert.throws(() => startInSlot(sessions, daily('s3', '额')), /occupied/);
  assert.throws(() => startInSlot(sessions, picked('s4', '额')), /occupied/);
});

test('sessions: ending moves the session to lastEnded; the next start in that slot clears it', () => {
  let sessions = startInSlot(startInSlot(emptySessions(), daily('s1', '静')), picked('s2', '鲜'));
  sessions = endSlot(sessions, 'B', { at: 50, early: true });
  assert.equal(sessions.B, null);
  assert.equal(sessions.lastEnded.B.id, 's2');
  assert.equal(sessions.lastEnded.B.endedEarly, true);
  assert.equal(sessions.lastEnded.B.endedAt, 50);
  sessions = endSlot(sessions, 'A', { at: 60 });
  assert.equal('endedEarly' in sessions.lastEnded.A, false);
  sessions = startInSlot(sessions, picked('s3', '境'));
  assert.equal(sessions.lastEnded.B, undefined, 'same slot cleared');
  assert.equal(sessions.lastEnded.A.id, 's1', 'other slot kept');
  assert.equal(clearLastEnded(sessions, 'A').lastEnded.A, undefined);
  assert.throws(() => endSlot(emptySessions(), 'A', { at: 1 }), /empty/);
});

test('sessions: home resume lines list B first, then A, with remaining counts (S01)', () => {
  let a = advance(daily('s1', '静亦慢'), { cardKey: 'base:静', recordId: 'r1', kind: 'judged', fsrsBefore: null });
  let sessions = startInSlot(startInSlot(emptySessions(), a), picked('s2', '鲜境'));
  assert.deepEqual(resumeLines(sessions), [
    { slot: 'B', kind: 'picked', remaining: 2 },
    { slot: 'A', kind: 'daily', remaining: 2 },
  ]);
  assert.equal(t('R-H04.resumePicked', { n: 2 }), '这次选的字 · 还有 2 个字没写');
  assert.deepEqual(resumeLines(emptySessions()), []);
});

test('sessions: S02 prompt lists the unwritten chars of the old B and its judged count', () => {
  let b = picked('s2', '额鲜境');
  b = advance(b, { cardKey: 'base:额', recordId: 'r1', kind: 'judged', fsrsBefore: null });
  const sessions = startInSlot(emptySessions(), b);
  const p = s02Prompt(sessions);
  assert.deepEqual(p.unwrittenChars, ['鲜', '境']);
  assert.equal(p.judgedCount, 1);
  const chars = p.unwrittenChars.map((c) => '「' + c + '」').join('');
  assert.equal(t('R-H05.body', { chars }), '上一组还有「鲜」「境」没写。');
  assert.equal(s02Prompt(emptySessions()), null);
  assert.equal(s02Prompt(startInSlot(emptySessions(), daily('s1', '静'))), null, 'only B triggers S02');
});

test('sessions: "结束那组，开新的" ends old B early into lastEnded and starts the new one in one step (P38)', () => {
  let b = picked('s2', '额鲜境');
  b = advance(b, { cardKey: 'base:额', recordId: 'r1', kind: 'judged', fsrsBefore: null });
  const a = daily('s1', '静');
  const sessions = startInSlot(startInSlot(emptySessions(), a), b);
  const res = endAndStartPicked(sessions, picked('s3', '慢'), { at: 99 });
  assert.equal(res.sessions.B.id, 's3');
  assert.equal(res.sessions.lastEnded.B.id, 's2');
  assert.equal(res.sessions.lastEnded.B.endedEarly, true);
  assert.equal(res.sessions.A, a, 'A untouched');
  assert.deepEqual(res.notice, { kind: 'oldGroupSaved', judgedCount: 1 });
  assert.equal(res.showOldResult, false);
  const zero = endAndStartPicked(startInSlot(emptySessions(), picked('s2', '鲜')), picked('s3', '慢'), { at: 1 });
  assert.equal(zero.notice, null, 'no judged → no toast');
});

test('sessions: S02 policy alternative shows the old result page instead', async () => {
  let b = advance(picked('s2', '额鲜'), { cardKey: 'base:额', recordId: 'r1', kind: 'judged', fsrsBefore: null });
  const res = endAndStartPicked(startInSlot(emptySessions(), b), picked('s3', '慢'), { at: 1, policy: await policyWith({ s02EndOld: 'result' }) });
  assert.equal(res.showOldResult, true);
  assert.equal(res.notice, null);
  assert.throws(() => endAndStartPicked(emptySessions(), daily('s4', '静'), { at: 1 }), /picked/);
});

test('sessions: an unfinished daily from yesterday expires; today, first and picked do not (P37)', async () => {
  const yesterday = daily('s1', '静亦', '2026-09-23');
  const { sessions, expired } = expireDaily({ A: yesterday, B: null, lastEnded: {} }, TODAY);
  assert.equal(sessions.A, null);
  assert.equal(expired, yesterday);
  assert.equal(sessions.lastEnded.A, undefined, 'discard: no result page');
  const todays = { A: daily('s2', '静'), B: null, lastEnded: {} };
  assert.equal(expireDaily(todays, TODAY).sessions, todays);
  const first = createSession({ id: 's3', kind: 'first', queue: K('尴'), at: at('2026-09-20') });
  assert.equal(expireDaily({ A: first, B: null, lastEnded: {} }, TODAY).expired, null);
  const res = expireDaily({ A: yesterday, B: null, lastEnded: {} }, TODAY, await policyWith({ dailyExpiry: 'result' }));
  assert.equal(res.sessions.lastEnded.A.id, 's1');
  assert.equal(res.sessions.lastEnded.A.endedEarly, true);
  assert.throws(() => expireDaily({ A: yesterday, B: null, lastEnded: {} }, TODAY, { dailyExpiry: 'x' }), /dailyExpiry/);
});

test('sessions: first / picked cross-day expiry follows policy.sessionExpiry (P61)', async () => {
  const first = createSession({ id: 's3', kind: 'first', queue: K('尴'), at: at('2026-09-20') });
  const oldPicked = createSession({ id: 's4', kind: 'picked', source: { view: 'home' }, queue: K('额'), at: at('2026-09-20', 9) });
  const both = { A: first, B: oldPicked, lastEnded: {} };
  const kept = expireDaily(both, TODAY);
  assert.equal(kept.sessions, both, "default 'never': nothing expires, same object back");
  assert.deepEqual(kept.expiredAll, []);
  const same = await policyWith({ sessionExpiry: { first: 'daily', picked: 'daily' } });
  const gone = expireDaily(both, TODAY, same);
  assert.equal(gone.sessions.A, null);
  assert.equal(gone.sessions.B, null);
  assert.equal(gone.expired, first, 'A first');
  assert.deepEqual(gone.expiredAll.map((s) => s.id), ['s3', 's4']);
  const asResult = expireDaily(both, TODAY, await policyWith({ sessionExpiry: { first: 'never', picked: 'daily' }, dailyExpiry: 'result' }));
  assert.equal(asResult.sessions.A, first, 'first still never expires');
  assert.equal(asResult.sessions.lastEnded.B.id, 's4');
  const badPolicy = await policyWith({ sessionExpiry: { first: 'x', picked: 'never' } });
  assert.throws(() => expireDaily(both, TODAY, badPolicy), /sessionExpiry\.first/);
});

test('sessions: recovery is idempotent — a committed judgment is not counted twice (D07)', () => {
  const s = withCurrent(daily('s1', '静亦'), { phase: 'compare', strokes: [[1]] });
  const records = [rec(4, '静', 'judged', 'correct', TODAY, { sessionId: 's1' })];
  const once = recoverSession(s, records);
  assert.equal(once.recovered, true);
  assert.equal(currentCardKey(once.session), 'base:亦');
  assert.equal(once.session.items.length, 1);
  const twice = recoverSession(once.session, records);
  assert.equal(twice.recovered, false);
  assert.equal(twice.session.items.length, 1);
  const other = recoverSession(s, [rec(5, '静', 'judged', 'correct', TODAY, { sessionId: 's9' })]);
  assert.equal(other.recovered, false, 'another session’s record does not count');
});

test('sessions: compare with no strokes falls back to recall on restore', () => {
  const s = withCurrent(daily('s1', '静'), { phase: 'compare', strokes: [] });
  const { session, recovered } = recoverSession(s, []);
  assert.equal(recovered, true);
  assert.equal(session.current.phase, 'recall');
});

test('sessions: first practice is the fixed 3 chars 尴 赢 拾 (D38 / P09; was 5 chars in D17)', () => {
  const q = selectFirst();
  assert.equal(q.length, 3);
  assert.deepEqual(q, policy.firstQueue.map((c) => 'base:' + c));
  assert.deepEqual(q, ['base:尴', 'base:赢', 'base:拾']);
  const s = createSession({ id: 's1', kind: 'first', queue: q, at: at(TODAY) });
  assert.equal(t('R-W01.progress', { n: s.cursor + 1, total: s.queue.length }), '1 / 3');
  assert.equal(t('R-H03.firstVisit'), '第一次来，先写 3 个字试试。');
  assert.equal(policy.groupSize, 5, 'D38 只影响首练，日常组仍是 5');
});

test('sessions: next A group is first until any judged record exists (P46)', async () => {
  assert.equal(nextAKind([]), 'first');
  assert.equal(nextAKind([rec(1, '静', 'answer-seen', null, TODAY)]), 'first', 'answer-seen is not a record');
  assert.equal(nextAKind([rec(1, '静', 'judged', 'wrong', TODAY)]), 'daily');
  assert.equal(nextAKind([], { everPracticed: true }), 'first', 'after clearing all records → first again (default)');
  assert.equal(nextAKind([], { everPracticed: true, policy: await policyWith({ afterClearRestartFirst: false }) }), 'daily');
});

test('daily: chars judged today are excluded', () => {
  const records = [rec(1, '静', 'judged', 'correct', TODAY)];
  const s = { 'base:静': sched('2026-09-20') };
  const { queue } = selectDaily({ sched: s, records, today: TODAY, newCandidates: K('静亦慢额鲜境') });
  assert.equal(queue.includes('base:静'), false);
  assert.deepEqual(queue, K('亦慢额鲜境'));
});

test('daily: a char skipped today can come back in a new daily group', () => {
  const records = [rec(1, '亦', 'skipped', null, TODAY, { sessionId: 's1' })];
  const { queue } = selectDaily({ sched: {}, records, today: TODAY, newCandidates: K('亦慢') });
  assert.deepEqual(queue, K('亦慢'));
});

test('daily: answer-seen today follows policy.answerSeenScope (P36)', async () => {
  const records = [rec(1, '亦', 'answer-seen', null, TODAY)];
  const args = { sched: {}, records, today: TODAY, newCandidates: K('亦慢') };
  assert.deepEqual(selectDaily(args).queue, K('亦慢'), "default 'none': may appear again");
  assert.deepEqual(selectDaily({ ...args, policy: await policyWith({ answerSeenScope: 'today' }) }).queue, K('慢'));
  assert.throws(() => selectDaily({ ...args, policy: { ...policy, answerSeenScope: 'week' } }), /answerSeenScope/);
});

test('daily: custom chars not yet written stay out of daily (P33 customIntoDaily=none)', async () => {
  const custom = { added: [{ char: '鲜', at: 1 }, { char: '馨', at: 2 }] };
  const s = { 'base:静': sched('2026-09-20') };
  const args = { sched: s, records: [], today: TODAY, newCandidates: K('鲜亦馨慢额境'), custom };
  const res = selectDaily(args);
  assert.deepEqual(res.queue, K('静亦慢额境'));
  assert.deepEqual(res.customKeys, []);
  const after = selectDaily({ ...args, policy: await policyWith({ customIntoDaily: 'after-due' }) });
  assert.deepEqual(after.queue, K('静鲜馨亦慢'));
  const first = selectDaily({ ...args, policy: await policyWith({ customIntoDaily: 'first' }) });
  assert.deepEqual(first.queue, K('鲜馨静亦慢'));
});

test('daily: due chars are taken most overdue first then least stable; new chars in candidate order, interleaved (D41)', () => {
  const s = {
    'base:静': sched('2026-09-22', 10),
    'base:亦': sched('2026-09-10', 30),
    'base:慢': sched('2026-09-22', 2),
    'base:额': sched('2026-09-30', 1), // 未到期
  };
  // 这些字里有热身字（静、慢）；热身字复习每组至多 1 个另有测试，这里用 isWarm=false 只看到期排序与配比。
  const res = selectDaily({ sched: s, records: [], today: TODAY, newCandidates: K('鲜境额'), isWarm: () => false });
  assert.deepEqual(res.dueKeys, K('亦慢静'));
  // 旧断言 queue = 亦慢静鲜境（到期字全在新字前）；D41：3 个到期 → p = 0.75 → 2 新，复、新交错（复 新 复 新 复），已写过的额不算新字
  assert.deepEqual(res.queue, K('亦鲜慢境静'), 'new chars in candidate order; seen chars are not new');
  assert.deepEqual(res.newKeys, K('鲜境'));
});

test('daily: at most dailyReviewCap (30) due reviews per day, counted as they are done', () => {
  const s = {};
  const records = [];
  let serial = 1;
  // 28 个复习字今天已经写过（以前有记录）
  for (let i = 0; i < 28; i += 1) {
    const ch = String.fromCodePoint(0x4e00 + i);
    records.push(rec(serial++, ch, 'judged', 'correct', '2026-09-01'));
    records.push(rec(serial++, ch, 'judged', 'correct', TODAY));
    s['base:' + ch] = sched('2026-10-10');
  }
  for (let i = 0; i < 10; i += 1) s['base:' + String.fromCodePoint(0x5000 + i)] = sched('2026-09-20');
  const res = selectDaily({ sched: s, records, today: TODAY, newCandidates: K('鲜境额慢') });
  assert.equal(res.reviewBudgetLeft, 2);
  assert.equal(res.dueKeys.length, 2);
  assert.deepEqual(res.newKeys, K('鲜境额'));
  const none = selectDaily({ sched: s, records, today: TODAY, newCandidates: [], policy: { ...policy, dailyReviewCap: 28 } });
  assert.deepEqual(none.queue, []);
});

test('daily: group size comes from policy (P03) and stopped cards are skipped', async () => {
  const s = { 'base:静': { ...sched('2026-09-01'), stoppedAt: 3 } };
  const cands = K('一二三四五六七八');
  assert.equal(selectDaily({ sched: s, records: [], today: TODAY, newCandidates: cands }).queue.length, policy.groupSize);
  const big = selectDaily({ sched: s, records: [], today: TODAY, newCandidates: cands, policy: await policyWith({ groupSize: 7 }) });
  assert.equal(big.queue.length, 7);
  assert.equal(big.queue.includes('base:静'), false);
  assert.deepEqual(selectDaily({ sched: {}, records: [], today: TODAY, newCandidates: [] }).queue, [], 'nothing to write (R-H11)');
});

test('daily: custom: keys outside the deck are never selected', () => {
  const res = selectDaily({ sched: { 'custom:𠀋': sched('2026-09-01') }, records: [], today: TODAY, newCandidates: ['custom:𠀋', 'base:静'] });
  assert.deepEqual(res.queue, ['base:静']);
});
