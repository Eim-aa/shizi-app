import test from 'node:test';
import assert from 'node:assert/strict';
import { hintQuota, hintMode, hintsRemaining, nextHintRange, hintButtonState, hintButtonCopy } from '../../src/core/hints.js';
import { t } from '../../src/config/copy/index.js';
import { policyWith } from './helpers.mjs';

test('hints: each hint is max(1, round(N/4)) strokes', () => {
  const cases = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 8: 2, 10: 3, 12: 3, 14: 4, 16: 4, 20: 5 };
  for (const [n, q] of Object.entries(cases)) assert.equal(hintQuota(Number(n)), q, 'N=' + n);
  assert.throws(() => hintQuota(0), RangeError);
  assert.throws(() => hintQuota(2.5), RangeError);
});

test('hints: 14-stroke char continues from the written stroke count (P01)', () => {
  const base = { totalStrokes: 14, hasStrokeData: true, hasGroups: true };
  assert.deepEqual(nextHintRange({ ...base, writtenStrokes: 0, used: 0 }), { from: 0, count: 4, index: 1 });
  assert.deepEqual(nextHintRange({ ...base, writtenStrokes: 5, used: 1 }), { from: 5, count: 4, index: 2 });
  assert.deepEqual(nextHintRange({ ...base, writtenStrokes: 12, used: 0 }), { from: 10, count: 4, index: 1 }, 'clamped to N − q');
  assert.equal(nextHintRange({ ...base, writtenStrokes: 6, used: 2 }), null, 'used up after hintMax (P17 = 2)');
});

test('hints: 3-stroke char gives one stroke at a time', () => {
  const base = { totalStrokes: 3, hasGroups: true };
  assert.deepEqual(nextHintRange({ ...base, writtenStrokes: 0, used: 0 }), { from: 0, count: 1, index: 1 });
  assert.deepEqual(nextHintRange({ ...base, writtenStrokes: 1, used: 1 }), { from: 1, count: 1, index: 2 });
  assert.deepEqual(nextHintRange({ ...base, writtenStrokes: 3, used: 0 }), { from: 2, count: 1, index: 1 }, 'extra strokes clamp');
});

test('hints: chars without group data get the first 1, then first 2 strokes', () => {
  const base = { totalStrokes: 9, hasGroups: false };
  assert.equal(hintMode(base), 'prefix');
  assert.deepEqual(nextHintRange({ ...base, writtenStrokes: 4, used: 0 }), { from: 0, count: 1, index: 1 });
  assert.deepEqual(nextHintRange({ ...base, writtenStrokes: 4, used: 1 }), { from: 0, count: 2, index: 2 });
  assert.equal(nextHintRange({ ...base, used: 2 }), null);
  assert.deepEqual(nextHintRange({ totalStrokes: 1, hasGroups: false, used: 1 }), { from: 0, count: 1, index: 2 }, 'never beyond N');
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

test('hints: button label sequence 还有 2 次 → 还有 1 次 → 已用完 (改动 L85)', () => {
  const labels = [0, 1, 2].map((used) => {
    const c = hintButtonCopy(hintButtonState({ used }));
    return t(c.key, c.vars);
  });
  assert.deepEqual(labels, ['提示 · 还有 2 次', '提示 · 还有 1 次', '提示已用完']);
});

test('hints: hintMax comes from policy (P17)', async () => {
  const p = await policyWith({ hintMax: 3 });
  assert.equal(hintsRemaining(0, p), 3);
  assert.deepEqual(nextHintRange({ totalStrokes: 12, writtenStrokes: 6, used: 2 }, p), { from: 6, count: 3, index: 3 });
  assert.equal(nextHintRange({ totalStrokes: 12, used: 3 }, p), null);
  assert.equal(hintsRemaining(5), 0);
});

test('hints: unsupported start rule and bad input fail loudly', async () => {
  const p = await policyWith({ hintStartRule: 'geometry' });
  assert.throws(() => nextHintRange({ totalStrokes: 8, used: 0 }, p), /hintStartRule/);
  assert.throws(() => nextHintRange({ totalStrokes: 0, used: 0 }), /totalStrokes/);
  assert.throws(() => hintButtonCopy({ state: 'weird' }), /unknown/);
});
