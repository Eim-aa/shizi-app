import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal, loadFSRSInNewRealm, at, rec, policyWith } from './helpers.mjs';
import {
  FSRS_CONFIG,
  getFSRSLibrary,
  setFSRSLibrary,
  emptyCard,
  serializeCard,
  isCompactCard,
  ratingFor,
  reviewCard,
  applyJudgment,
  replay,
  overdueDays,
  isDue,
  retrievability,
} from '../../src/core/fsrs.js';
import { addDays, diffDays } from '../../src/core/dates.js';
import { correctRecord } from '../../src/core/records.js';

const FSRS = loadFSRSGlobal();
const TODAY = '2026-09-24';

test('fsrs: vendored library is ts-fsrs 5.2.0 / FSRS-6 and is read from globalThis', () => {
  assert.match(FSRS.FSRSVersion, /5\.2\.0/);
  assert.match(FSRS.FSRSVersion, /FSRS-6/);
  assert.equal(getFSRSLibrary(), FSRS);
  assert.throws(() => getFSRSLibrary({}), /FSRS library unavailable/);
  assert.equal(FSRS_CONFIG.requestRetention, 0.9);
  assert.equal(FSRS_CONFIG.maximumInterval, 365);
});

test('fsrs: rating mapping — correct → Good, wrong → Again, hinted correct reads policy (P34)', async () => {
  assert.equal(ratingFor('correct', { hints: 0 }), 'Good');
  assert.equal(ratingFor('wrong', { hints: 2 }), 'Again');
  assert.equal(ratingFor('correct', { hints: 1 }), 'Good', 'default policy.ratingWithHint = Good');
  assert.equal(ratingFor('correct', { hints: 1 }, await policyWith({ ratingWithHint: 'Hard' })), 'Hard');
  assert.equal(ratingFor('correct', { hints: 2 }, await policyWith({ ratingWithHint: 'Again' })), 'Again');
  assert.equal(ratingFor('correct', { hints: 0 }, await policyWith({ ratingWithHint: 'Again' })), 'Good', 'no hint → policy not consulted');
  assert.throws(() => ratingFor('correct', { hints: 1 }, { ratingWithHint: 'Easy' }), /ratingWithHint/);
  assert.throws(() => ratingFor('unsure', {}), /judgment/);
});

test('fsrs: Good and Again on a new card are both due tomorrow or later', () => {
  for (const judgment of ['correct', 'wrong']) {
    for (const hour of [0, 9, 23]) {
      const { due, card } = reviewCard(null, { judgment, at: at(TODAY, hour, 30), help: { hints: 0 } });
      assert.ok(due >= addDays(TODAY, 1), judgment + '@' + hour + ' → ' + due);
      assert.ok(isCompactCard(card));
    }
  }
  assert.equal(reviewCard(null, { judgment: 'wrong', at: at(TODAY, 20) }).due, addDays(TODAY, 1), 'Again → next day, no pendingLearning limbo');
});

test('fsrs: due stays within [tomorrow, today + 365] over long random histories', () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let run = 0; run < 20; run += 1) {
    let card = null;
    let day = TODAY;
    for (let i = 0; i < 12; i += 1) {
      const judgment = rand() < 0.7 ? 'correct' : 'wrong';
      const step = reviewCard(card, { judgment, at: at(day, 8 + Math.floor(rand() * 12)), help: { hints: rand() < 0.2 ? 1 : 0 } });
      assert.ok(step.due >= addDays(day, 1), 'due ≥ tomorrow');
      assert.ok(diffDays(day, step.due) <= FSRS_CONFIG.maximumInterval + 1, 'within max interval');
      card = step.card;
      day = rand() < 0.5 ? step.due : addDays(step.due, Math.floor(rand() * 10));
    }
  }
});

test('fsrs: replay is deterministic — same records → same card and due', () => {
  const records = [
    rec(1, '静', 'judged', 'correct', '2026-09-01', { at: at('2026-09-01', 20) }),
    rec(2, '静', 'judged', 'wrong', '2026-09-05', { at: at('2026-09-05', 7) }),
    rec(3, '静', 'judged', 'correct', '2026-09-06', { at: at('2026-09-06', 21) }),
    rec(4, '静', 'judged', 'correct', '2026-09-20', { at: at('2026-09-20', 9) }),
  ];
  const a = replay(null, records);
  const b = replay(null, records);
  assert.deepEqual(a, b);
  // 逐条 applyJudgment 与一次 replay 结果相同
  let entry;
  for (const r of records) entry = applyJudgment(entry, r).entry;
  assert.deepEqual(entry, a);
  assert.equal(entry.lastJudgedAt, records[3].at);
});

test('fsrs: correction replays from fsrsBefore, adds no record and gives a deterministic due (D19)', () => {
  const prior = rec(1, '静', 'judged', 'correct', '2026-09-10', { at: at('2026-09-10', 20) });
  const { entry: afterPrior } = applyJudgment(undefined, prior);
  const judged = rec(2, '静', 'judged', 'wrong', TODAY, { at: at(TODAY, 20, 5), sessionId: 's2' });
  const { entry: afterWrong, fsrsBefore } = applyJudgment(afterPrior, judged);
  assert.deepEqual(fsrsBefore, afterPrior.fsrs, 'fsrsBefore = card before this judgment');
  const corrected = correctRecord(judged, 'correct', at(TODAY, 20, 9));
  const fixed1 = replay(fsrsBefore, [corrected]);
  const fixed2 = replay(fsrsBefore, [corrected]);
  assert.deepEqual(fixed1, fixed2, 'deterministic');
  const direct = applyJudgment(afterPrior, { ...judged, judgment: 'correct' }).entry;
  assert.deepEqual(fixed1, direct, 'same as if it had been judged correct at the original time');
  assert.notEqual(fixed1.due, afterWrong.due);
  assert.equal(fixed1.lastJudgedAt, judged.at, 'review time = the record at, not the correction time');
  // 改回写错：回到原来的调度
  assert.deepEqual(replay(fsrsBefore, [correctRecord(corrected, 'wrong', 1)]), afterWrong);
});

test('fsrs: ratingWithHint changes scheduling while help facts stay on the record', async () => {
  const r = rec(1, '静', 'judged', 'correct', TODAY, { hints: 2, at: at(TODAY, 20) });
  const prior = applyJudgment(undefined, rec(0 + 1, '静', 'judged', 'correct', '2026-09-01', { at: at('2026-09-01', 20) })).entry;
  const good = applyJudgment(prior, r).entry;
  const again = applyJudgment(prior, r, { policy: await policyWith({ ratingWithHint: 'Again' }) }).entry;
  assert.ok(good.due > again.due, good.due + ' vs ' + again.due);
  assert.equal(r.help.hints, 2);
});

test('fsrs: applyJudgment keeps stoppedAt and rejects non-judged records', () => {
  const prior = { ...applyJudgment(undefined, rec(1, '静', 'judged', 'correct', '2026-09-01')).entry, stoppedAt: 5 };
  const { entry, fsrsBefore } = applyJudgment(prior, rec(2, '静', 'judged', 'correct', TODAY));
  assert.equal(entry.stoppedAt, 5);
  assert.deepEqual(fsrsBefore, prior.fsrs);
  assert.throws(() => applyJudgment(prior, rec(3, '静', 'answer-seen', null, TODAY)), /judged/);
  const fresh = applyJudgment(undefined, rec(4, '亦', 'judged', 'wrong', TODAY, { at: at(TODAY, 20) }));
  assert.deepEqual(fresh.fsrsBefore, emptyCard(at(TODAY, 20)), 'new char: fsrsBefore = empty card at judgment time');
  assert.deepEqual(replay(fresh.fsrsBefore, [rec(4, '亦', 'judged', 'wrong', TODAY, { at: at(TODAY, 20) })]), fresh.entry);
  assert.deepEqual(replay(null, [rec(4, '亦', 'judged', 'wrong', TODAY, { at: at(TODAY, 20) })]), fresh.entry, 'null ≡ empty card');
  assert.equal(replay(prior.fsrs, [rec(5, '静', 'skipped', null, TODAY)]), null, 'nothing to replay → null');
});

test('fsrs: serialized cards are plain JSON and round-trip through the library', () => {
  const card = emptyCard(at(TODAY));
  assert.ok(isCompactCard(card));
  assert.deepEqual(JSON.parse(JSON.stringify(card)), card);
  assert.equal(card.last_review, null);
  const step = reviewCard(card, { judgment: 'correct', at: at(TODAY, 20) });
  assert.deepEqual(serializeCard(step.card), step.card);
  assert.equal(isCompactCard({ ...card, stability: 'x' }), false);
  assert.equal(isCompactCard({ ...card, due: 'nope' }), false);
});

test('fsrs: a library injected from another realm gives identical results', () => {
  const foreign = loadFSRSInNewRealm();
  assert.notEqual(foreign, FSRS);
  const records = [rec(1, '静', 'judged', 'correct', '2026-09-01'), rec(2, '静', 'judged', 'wrong', '2026-09-03')];
  const local = replay(null, records);
  setFSRSLibrary(foreign);
  try {
    assert.deepEqual(replay(null, records), local);
  } finally {
    setFSRSLibrary(null);
  }
  assert.deepEqual(replay(null, records, { lib: foreign }), local, 'per-call injection');
});

test('fsrs: overdueDays / isDue / retrievability', () => {
  assert.equal(overdueDays({ due: '2026-09-20' }, TODAY), 4);
  assert.equal(overdueDays({ due: '2026-09-30' }, TODAY), -6);
  assert.equal(overdueDays(null, TODAY), null);
  assert.equal(isDue({ due: TODAY }, TODAY), true);
  assert.equal(isDue({ due: '2026-09-25' }, TODAY), false);
  assert.equal(isDue({ due: '2026-09-01', stoppedAt: 1 }, TODAY), false);
  const { entry } = applyJudgment(undefined, rec(1, '静', 'judged', 'correct', '2026-09-01', { at: at('2026-09-01', 20) }));
  const r = retrievability(entry, at(TODAY));
  assert.ok(r > 0 && r < 1, String(r));
});
