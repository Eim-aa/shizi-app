// 紧凑版写字页纯逻辑单测（M1-7；X08 / V02）：看答案卡片尺寸夹取、紧凑版判定条件。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitAnswerSize, isCompact, COMPACT_GRID, ANSWER_MIN, ANSWER_MAX, COMPACT_MAX_HEIGHT, COMPACT_QUERY,
} from '../../src/ui/screens/write/compact.js';

test('constants follow X08 / V02', () => {
  assert.equal(COMPACT_GRID, 258);
  assert.equal(ANSWER_MIN, 200);
  assert.equal(ANSWER_MAX, 345);
  assert.equal(COMPACT_QUERY, `(max-height: ${COMPACT_MAX_HEIGHT}px)`);
  assert.ok(COMPACT_MAX_HEIGHT >= 640 && COMPACT_MAX_HEIGHT < 852, '360×640 is compact, 393×852 is not');
});

test('fitAnswerSize clamps the available height to 200–345 (prototype fitC)', () => {
  assert.equal(fitAnswerSize({ available: 284.7 }), 284);
  assert.equal(fitAnswerSize({ available: 120 }), 200);
  assert.equal(fitAnswerSize({ available: 900 }), 345);
  assert.equal(fitAnswerSize({ available: NaN }), 345);
  assert.equal(fitAnswerSize({ available: -50 }), 200);
});

test('fitAnswerSize never exceeds the content width', () => {
  assert.equal(fitAnswerSize({ available: 400, width: 320 }), 320);
  assert.equal(fitAnswerSize({ available: 250, width: 320 }), 250);
  assert.equal(fitAnswerSize({ available: 400, width: 0 }), 345, 'unknown width is ignored');
});

function fakeWin({ large = false, matches = false, throws = false } = {}) {
  return {
    document: { documentElement: { hasAttribute: name => name === 'data-large' && large } },
    matchMedia(q) {
      if (throws) throw new Error('no matchMedia');
      assert.equal(q, COMPACT_QUERY);
      return { matches };
    },
  };
}

test('isCompact: data-large or a short viewport', () => {
  assert.equal(isCompact(fakeWin()), false);
  assert.equal(isCompact(fakeWin({ matches: true })), true);
  assert.equal(isCompact(fakeWin({ large: true })), true);
  assert.equal(isCompact(fakeWin({ throws: true })), false);
  assert.equal(isCompact(fakeWin({ large: true, throws: true })), true);
});

test('isCompact without window (node) is false', () => {
  assert.equal(isCompact(), false);
});
