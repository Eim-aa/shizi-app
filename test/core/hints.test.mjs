import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hintQuota, hintMode, hintsGiven, hintSegments, hintsRemaining, hintsAllGiven, nextHintRange, hintButtonState, hintButtonCopy,
} from '../../src/core/hints.js';
import * as policy from '../../src/config/policy.js';
import { t } from '../../src/config/copy/index.js';

test('hints: each segment is max(1, round(N/4)) strokes', () => {
  const cases = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 8: 2, 10: 3, 12: 3, 14: 4, 16: 4, 20: 5 };
  for (const [n, q] of Object.entries(cases)) assert.equal(hintQuota(Number(n)), q, 'N=' + n);
  assert.throws(() => hintQuota(0), RangeError);
  assert.throws(() => hintQuota(2.5), RangeError);
});

test('hints (D64): 14-stroke char — every tap continues after the strokes already given, up to the whole char', () => {
  const base = { totalStrokes: 14, hasStrokeData: true, hasGroups: true };
  const got = [];
  for (let used = 0; ; used += 1) {
    const r = nextHintRange({ ...base, used });
    if (!r) break;
    got.push([r.from, r.from + r.count, r.index]);
  }
  assert.deepEqual(got, [[0, 4, 1], [4, 8, 2], [8, 12, 3], [12, 14, 4]], 'four segments, the last one is short, no repeated strokes');
  assert.equal(nextHintRange({ ...base, used: 4 }), null);
  assert.equal(nextHintRange({ ...base, used: 9 }), null);
});

test('hints (D64): the next segment does not depend on how many strokes the user wrote (the old second-tap bug)', () => {
  const base = { totalStrokes: 12, hasGroups: true, used: 1 };
  assert.deepEqual(nextHintRange({ ...base, writtenStrokes: 0 }), { from: 3, count: 3, index: 2 });
  assert.deepEqual(nextHintRange({ ...base, writtenStrokes: 9 }), { from: 3, count: 3, index: 2 });
});

test('hints (D64): 3-stroke char gives one stroke per tap, three taps', () => {
  const base = { totalStrokes: 3, hasGroups: true };
  assert.deepEqual([0, 1, 2].map((used) => nextHintRange({ ...base, used }).from), [0, 1, 2]);
  assert.equal(nextHintRange({ ...base, used: 3 }), null);
});

test('hints (D64): chars without group data get one more stroke per tap', () => {
  const base = { totalStrokes: 9, hasGroups: false };
  assert.equal(hintMode(base), 'prefix');
  assert.deepEqual([0, 1, 2, 8].map((used) => nextHintRange({ ...base, used })), [
    { from: 0, count: 1, index: 1 }, { from: 1, count: 1, index: 2 }, { from: 2, count: 1, index: 3 }, { from: 8, count: 1, index: 9 },
  ]);
  assert.equal(nextHintRange({ ...base, used: 9 }), null);
  assert.equal(hintSegments(base), 9);
  assert.equal(hintSegments({ totalStrokes: 14, hasGroups: true }), 4);
  assert.equal(hintSegments({ totalStrokes: 10, hasGroups: true }), 4, '10 strokes: 3 + 3 + 3 + 1');
});

test('hints (D64): given strokes, remaining segments and the whole-char state', () => {
  const b = { totalStrokes: 14, hasGroups: true };
  assert.deepEqual([0, 1, 2, 3, 4, 7].map((used) => hintsGiven({ ...b, used })), [0, 4, 8, 12, 14, 14]);
  assert.deepEqual([0, 1, 2, 3, 4, 7].map((used) => hintsRemaining({ ...b, used })), [4, 3, 2, 1, 0, 0]);
  assert.deepEqual([0, 3, 4].map((used) => hintsAllGiven({ ...b, used })), [false, false, true]);
  assert.equal(hintsAllGiven({ totalStrokes: 0, used: 5 }), false, 'stroke data not here yet: never counts as all given');
  assert.equal(hintsAllGiven({ totalStrokes: 8, hasStrokeData: false, used: 5 }), false);
});

test('hints: no stroke data → no stepped hints, button says 暂时没有提示 (R-W08)', () => {
  assert.equal(hintMode({ hasStrokeData: false }), 'none');
  assert.equal(nextHintRange({ totalStrokes: 8, hasStrokeData: false, used: 0 }), null);
  const btn = hintButtonState({ used: 0, hasStrokeData: false });
  assert.deepEqual(btn, { state: 'unavailable' });
  const c = hintButtonCopy(btn);
  assert.equal(t(c.key, c.vars), '暂时没有提示');
  assert.equal(t('R-W05.noHintNote'), '这个字暂时没有提示，可以直接看答案。');
});

test('hints (D64): screen-reader name counts the remaining segments, ends at 提示已用完', () => {
  const b = { totalStrokes: 14, hasGroups: true };
  const labels = [0, 1, 2, 3, 4].map((used) => {
    const c = hintButtonCopy(hintButtonState({ ...b, used }));
    return t(c.key, c.vars);
  });
  assert.deepEqual(labels, ['提示，还有 4 次', '提示，还有 3 次', '提示，还有 2 次', '提示，还有 1 次', '提示已用完']);
  const loading = hintButtonCopy(hintButtonState({ used: 0 }));
  assert.equal(t(loading.key, loading.vars), '提示', 'stroke data not loaded yet: just 提示');
});

test('hints (D64): policy no longer carries a per-char cap or a start rule', () => {
  assert.equal('hintMax' in policy, false);
  assert.equal('hintStartRule' in policy, false);
});

test('hints: bad input fails loudly', () => {
  assert.throws(() => nextHintRange({ totalStrokes: 0, used: 0 }), /totalStrokes/);
  assert.throws(() => hintButtonCopy({ state: 'weird' }), /unknown/);
});
