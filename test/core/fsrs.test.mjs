import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal, loadFSRSInNewRealm, at, rec, policyWith } from './helpers.mjs';
import * as policyModule from '../../src/config/policy.js';

const policyFlat = () => ({ ...policyModule });
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
  applyAnswerSeen,
  replay,
  overdueDays,
  isDue,
  retrievability,
} from '../../src/core/fsrs.js';
import { addDays, diffDays, localDay } from '../../src/core/dates.js';
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
  // D66 ②：复习 1 次提示 Hard、2 次起 Again（D65 #4 是 1–2 次 Hard）；新字第一次 1 次 Good、2 次 Hard、3 次起 Again（不变）
  assert.equal(ratingFor('correct', { hints: 1 }), 'Hard', 'review with 1 hint → Hard');
  assert.equal(ratingFor('correct', { hints: 2 }), 'Again', 'review with 2 hints (over half the strokes) → Again');
  assert.equal(ratingFor('correct', { hints: 3 }), 'Again');
  assert.equal(ratingFor('correct', { hints: 9 }), 'Again', 'beyond the table → last entry');
  assert.equal(ratingFor('correct', { hints: 1 }, undefined, { first: true }), 'Good');
  assert.equal(ratingFor('correct', { hints: 2 }, undefined, { first: true }), 'Hard');
  assert.equal(ratingFor('correct', { hints: 4 }, undefined, { first: true }), 'Again');
  assert.equal(ratingFor('correct', { hints: 1 }, await policyWith({ ratingWithHint: 'Hard' })), 'Hard');
  assert.equal(ratingFor('correct', { hints: 2 }, await policyWith({ ratingWithHint: 'Again' })), 'Again');
  assert.equal(ratingFor('correct', { hints: 0 }, await policyWith({ ratingWithHint: 'Again' })), 'Good', 'no hint → policy not consulted');
  assert.throws(() => ratingFor('correct', { hints: 1 }, { ratingWithHint: 'Easy' }), /ratingWithHint/);
  assert.throws(() => ratingFor('unsure', {}), /judgment/);
});

test('fsrs: Good and Again on a new card are both due tomorrow or later', () => {
  for (const judgment of ['correct', 'wrong']) {
    for (const hour of [0, 9, 23]) {
      const ms = at(TODAY, hour, 30);
      const { due, card } = reviewCard(null, { judgment, at: ms, help: { hints: 0 } });
      // D66 ⑦：0:30 属于前一天（一天从 4 点起），「至少次日」按判断所在的那一天算
      assert.ok(due >= addDays(localDay(ms), 1), judgment + '@' + hour + ' → ' + due);
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
  const r = rec(1, '静', 'judged', 'correct', TODAY, { hints: 1, at: at(TODAY, 20) });
  const prior = applyJudgment(undefined, rec(0 + 1, '静', 'judged', 'correct', '2026-09-01', { at: at('2026-09-01', 20) })).entry;
  const good = applyJudgment(prior, r).entry;
  const again = applyJudgment(prior, r, { policy: await policyWith({ ratingWithHint: 'Again' }) }).entry;
  assert.ok(good.due > again.due, good.due + ' vs ' + again.due);
  assert.equal(r.help.hints, 1);
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

// ---------------------------------------------------------------- 阶段 1 P1-E4：D41 首见写对 / 热身字写对记 Easy（P126 / P127），带提示仍按 P34

function policy0() {
  return { ratingWithHint: 'Good', ratingFirstCorrect: 'Easy', warmup: { easyOnCorrect: true } };
}

test('fsrs D41: a new char judged correct on its first judgment is rated Easy; hinted correct still follows P34', async () => {
  const first = reviewCard(null, { judgment: 'correct', at: at(TODAY, 20), cardKey: 'base:亦' });
  assert.equal(first.rating, 'Easy', 'P127: first judgment, no hint → Easy');
  const hinted = reviewCard(null, { judgment: 'correct', at: at(TODAY, 20), help: { hints: 1 }, cardKey: 'base:亦' });
  assert.equal(hinted.rating, 'Good', 'P34 wins when a hint was used');
  const hintedHard = reviewCard(null, { judgment: 'correct', at: at(TODAY, 20), help: { hints: 2 }, cardKey: 'base:亦' }, { policy: await policyWith({ ratingWithHint: 'Hard' }) });
  assert.equal(hintedHard.rating, 'Hard');
  assert.equal(reviewCard(null, { judgment: 'wrong', at: at(TODAY, 20), cardKey: 'base:亦' }).rating, 'Again');
  // 第二次判断不再是「第一次」：写对记 Good
  const second = reviewCard(first.card, { judgment: 'correct', at: at(addDays(TODAY, 8), 20), cardKey: 'base:亦' });
  assert.equal(second.rating, 'Good');
  // Easy 的初始稳定度远大于 Good：首次写对的 due 更晚
  const asGood = reviewCard(null, { judgment: 'correct', at: at(TODAY, 20) }, { policy: await policyWith({ ratingFirstCorrect: 'Good' }) });
  assert.equal(asGood.rating, 'Good');
  assert.ok(first.card.stability > asGood.card.stability * 2, `${first.card.stability} vs ${asGood.card.stability}`);
  assert.ok(first.due > asGood.due, `${first.due} vs ${asGood.due}`);
  assert.throws(() => ratingFor('correct', { hints: 0 }, { ...policy0(), ratingFirstCorrect: 'Hard' }, { first: true }), /ratingFirstCorrect/);
});

test('fsrs D41: first-time-wrong then later correct is Good (the first judgment was the wrong one); a correction replays the Easy rule', () => {
  const r1 = rec(1, '亦', 'judged', 'wrong', '2026-09-01', { at: at('2026-09-01', 20) });
  const r2 = rec(2, '亦', 'judged', 'correct', '2026-09-03', { at: at('2026-09-03', 20) });
  const e1 = applyJudgment(undefined, r1);
  assert.equal(reviewCard(e1.entry.fsrs, r2).rating, 'Good');
  // 结果页「改为写对」：重放从 fsrsBefore（空卡）起，第一条判断现在是写对 → Easy，且与「一开始就判写对」同一结果
  const corrected = correctRecord(r1, 'correct', at('2026-09-01', 21));
  const replayed = replay(e1.fsrsBefore, [corrected]);
  const direct = applyJudgment(undefined, { ...r1, judgment: 'correct' }).entry;
  assert.deepEqual(replayed, direct);
  assert.equal(reviewCard(e1.fsrsBefore, corrected).rating, 'Easy');
});

test('fsrs D41: warm-up characters are rated Easy when correct without a hint (P126), on first and later reviews; hints fall back to P34', () => {
  // 春：热身字（src/config/char-order.js warmup）；亦：普通字
  const warmFirst = applyJudgment(undefined, rec(1, '春', 'judged', 'correct', '2026-09-01', { at: at('2026-09-01', 20) }));
  const warmSecond = reviewCard(warmFirst.entry.fsrs, rec(2, '春', 'judged', 'correct', '2026-09-20', { at: at('2026-09-20', 20) }));
  assert.equal(warmSecond.rating, 'Easy', 'later correct reviews of a warm-up char are Easy too');
  const plainFirst = applyJudgment(undefined, rec(3, '亦', 'judged', 'correct', '2026-09-01', { at: at('2026-09-01', 20) }));
  const plainSecond = reviewCard(plainFirst.entry.fsrs, rec(4, '亦', 'judged', 'correct', '2026-09-20', { at: at('2026-09-20', 20) }));
  assert.equal(plainSecond.rating, 'Good');
  const warmHinted = reviewCard(warmFirst.entry.fsrs, rec(5, '春', 'judged', 'correct', '2026-09-20', { at: at('2026-09-20', 20), hints: 1 }));
  assert.equal(warmHinted.rating, 'Hard', 'a hint means it was not easy (D65 #4: review with a hint → Hard)');
  const warmWrong = reviewCard(warmFirst.entry.fsrs, rec(6, '春', 'judged', 'wrong', '2026-09-20', { at: at('2026-09-20', 20) }));
  assert.equal(warmWrong.rating, 'Again');
  assert.equal(reviewCard(warmFirst.entry.fsrs, { judgment: 'correct', at: at('2026-09-20', 20), cardKey: 'base:春' }, { warmup: false }).rating, 'Good', 'opts.warmup overrides');
});

// ---------------------------------------------------------------- D66 ① ②：看过答案 = 当天没写出来；提示 2 次起 Again

/** 单字实验（产品体验评审 P2-01 / P2-02 同一套）：第 0 天 Easy、第 10 天 Good，第 56 天前后到期。 */
function matureCard() {
  const d0 = '2026-01-01';
  const e0 = applyJudgment(undefined, rec(1, '静', 'judged', 'correct', d0, { at: at(d0, 20) })).entry;
  const d10 = addDays(d0, 10);
  return { d0, entry: applyJudgment(e0, rec(2, '静', 'judged', 'correct', d10, { at: at(d10, 20) })).entry };
}

test('fsrs D66 ①: a review char whose answer was seen gets one Again that day (not a judged record); a new char gets no schedule', () => {
  const { entry } = matureCard();
  const day = entry.due;
  const seen = rec(3, '静', 'answer-seen', null, day, { at: at(day, 20) });
  const out = applyAnswerSeen(entry, seen);
  assert.equal(out.applied, true);
  const wrong = applyJudgment(entry, rec(3, '静', 'judged', 'wrong', day, { at: at(day, 20) })).entry;
  assert.deepEqual(out.entry.fsrs, wrong.fsrs, 'same FSRS step as writing it wrong (Again)');
  assert.equal(out.entry.due, wrong.due);
  assert.ok(diffDays(day, out.entry.due) <= 5, 'back within days: ' + diffDays(day, out.entry.due));
  assert.equal(out.entry.seenAgainDay, day);
  assert.equal(out.entry.lastJudgedAt, entry.lastJudgedAt, 'not a judgment: lastJudgedAt unchanged');
  assert.equal(out.entry.fsrs.lapses, entry.fsrs.lapses + 1, 'counted as a lapse');
  // 同一天第二次看答案：不再记
  assert.equal(applyAnswerSeen(out.entry, rec(4, '静', 'answer-seen', null, day, { at: at(day, 21) })).applied, false, 'once a day');
  // 当天已经判断过：不再记
  const judgedToday = applyJudgment(entry, rec(5, '静', 'judged', 'correct', day, { at: at(day, 19) })).entry;
  assert.equal(applyAnswerSeen(judgedToday, rec(6, '静', 'answer-seen', null, day, { at: at(day, 20) })).applied, false, 'already judged today');
  // 新字：不建调度项
  assert.equal(applyAnswerSeen(undefined, rec(7, '亦', 'answer-seen', null, day)).applied, false);
  // 开关关（对照）
  assert.equal(applyAnswerSeen(entry, seen, { policy: { ...policyFlat(), answerSeenRating: 'none' } }).applied, false);
});

test('fsrs D66 ① (P2-01 experiment): due day seen the answer, next day correct → back in days, not 7 months', () => {
  const { entry } = matureCard();
  const day = entry.due;
  const next = addDays(day, 1);
  // 修前：到期当天看答案不改调度，第二天写对按 Good → 约 178 天
  const before = applyJudgment(entry, rec(4, '静', 'judged', 'correct', next, { at: at(next, 20) })).entry;
  assert.ok(diffDays(next, before.due) > 100, 'old path: ' + diffDays(next, before.due) + ' days');
  // D66 ①：看答案那天记 Again，第二天写对
  const seen = applyAnswerSeen(entry, rec(3, '静', 'answer-seen', null, day, { at: at(day, 20) })).entry;
  const after = applyJudgment(seen, rec(4, '静', 'judged', 'correct', next, { at: at(next, 20) })).entry;
  assert.ok(diffDays(next, after.due) <= 14, 'seen → Again → correct next day: ' + diffDays(next, after.due) + ' days');
  const wrongPath = applyJudgment(applyJudgment(entry, rec(3, '静', 'judged', 'wrong', day, { at: at(day, 20) })).entry, rec(4, '静', 'judged', 'correct', next, { at: at(next, 20) })).entry;
  assert.deepEqual(after.fsrs, wrongPath.fsrs, 'same as writing it wrong that day');
  assert.equal(after.seenAgainDay, undefined, 'the mark is cleared by the next real judgment');
});

test('fsrs D66 ①: a judgment written the same day after the answer was seen is not rated again (no second Again); corrections replay it', () => {
  const { entry } = matureCard();
  const day = entry.due;
  const seen = applyAnswerSeen(entry, rec(3, '静', 'answer-seen', null, day, { at: at(day, 20) })).entry;
  for (const judgment of ['wrong', 'correct']) {
    const r = rec(4, '静', 'judged', judgment, day, { at: at(day, 20, 30), hints: 4 });
    const { entry: held, fsrsBefore } = applyJudgment(seen, r);
    assert.deepEqual(held.fsrs, seen.fsrs, judgment + ': FSRS card unchanged');
    assert.equal(held.due, seen.due);
    assert.equal(held.lastJudgedAt, r.at);
    assert.equal(fsrsBefore.seenAgainDay, day, 'fsrsBefore carries the mark for replay');
    // 本会话更正：改过去、改回来都按同一规则重放
    assert.deepEqual(replay(fsrsBefore, [r]), held);
    assert.deepEqual(replay(fsrsBefore, [correctRecord(r, judgment === 'wrong' ? 'correct' : 'wrong', at(day, 21))]), held, 'corrected: still held');
  }
  // 从头重放这个字的全部记录（judged + answer-seen）= 实际的调度项
  const r4 = rec(4, '静', 'judged', 'correct', day, { at: at(day, 20, 30) });
  const live = applyJudgment(seen, r4).entry;
  const d10 = addDays('2026-01-01', 10);
  const all = [rec(1, '静', 'judged', 'correct', '2026-01-01', { at: at('2026-01-01', 20) }), rec(2, '静', 'judged', 'correct', d10, { at: at(d10, 20) }),
    rec(3, '静', 'answer-seen', null, day, { at: at(day, 20) }), r4];
  assert.deepEqual(replay(null, all), live, 'full replay incl. answer-seen');
  // 第二天的判断照常评级
  const next = addDays(day, 1);
  const tomorrow = applyJudgment(live, rec(5, '静', 'judged', 'correct', next, { at: at(next, 20) })).entry;
  assert.notDeepEqual(tomorrow.fsrs, live.fsrs);
});

test('fsrs D66 ①: a new char whose answer was seen before its first judgment is not rated Easy (review mapping)', () => {
  const day = TODAY;
  const next = addDays(day, 1);
  const seen = rec(1, '亦', 'answer-seen', null, day, { at: at(day, 20) });
  const judged = rec(2, '亦', 'judged', 'correct', next, { at: at(next, 20) });
  const clean = applyJudgment(undefined, judged);
  const after = applyJudgment(undefined, judged, { records: [seen, judged] });
  assert.ok(diffDays(next, clean.entry.due) >= 5, 'never seen: Easy ' + diffDays(next, clean.entry.due) + ' days');
  assert.ok(diffDays(next, after.entry.due) <= 3, 'seen before: Good ' + diffDays(next, after.entry.due) + ' days');
  assert.equal(after.fsrsBefore.seenBefore, true);
  assert.deepEqual(replay(after.fsrsBefore, [judged]), after.entry, 'correction replay keeps the rule');
  assert.deepEqual(replay(null, [seen, judged]), after.entry, 'full replay keeps the rule');
  // 带提示：按复习一档（1 次 Hard，2 次起 Again）
  const hinted = rec(2, '亦', 'judged', 'correct', next, { at: at(next, 20), hints: 2 });
  const h = applyJudgment(undefined, hinted, { records: [seen, hinted] });
  assert.equal(h.entry.due, addDays(next, 1), 'seen before + 2 hints → Again');
  // 看答案在判断之后（id 更大）不算
  const later = rec(3, '亦', 'answer-seen', null, next, { at: at(next, 21) });
  assert.deepEqual(applyJudgment(undefined, judged, { records: [judged, later] }).entry, clean.entry);
});

test('fsrs D66 ② (P2-02 experiment): on a mature char, 2 hints now give the same short interval as a wrong answer', () => {
  const { entry } = matureCard();
  const day = entry.due;
  const one = applyJudgment(entry, rec(3, '静', 'judged', 'correct', day, { at: at(day, 20), hints: 1 })).entry;
  const two = applyJudgment(entry, rec(3, '静', 'judged', 'correct', day, { at: at(day, 20), hints: 2 })).entry;
  const wrong = applyJudgment(entry, rec(3, '静', 'judged', 'wrong', day, { at: at(day, 20) })).entry;
  assert.ok(diffDays(day, one.due) > 30, '1 hint → Hard: ' + diffDays(day, one.due));
  assert.equal(two.due, wrong.due, '2 hints → Again = wrong');
});
