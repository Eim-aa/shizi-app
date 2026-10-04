// 紧凑版写字页纯逻辑单测（M1-7；V02；P0-D / D36 起书写格不再随紧凑版缩小）：书写格边长公式、看答案卡片尺寸夹取、紧凑版判定条件。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitAnswerSize, isCompact, axLevelOf, GRID_MIN, GRID_MAX, ANSWER_MIN, ANSWER_MAX, COMPACT_MAX_HEIGHT, COMPACT_QUERY,
} from '../../src/ui/screens/write/compact.js';
import * as policy from '../../src/config/policy.js';

test('constants follow D36 / V02', () => {
  assert.equal(GRID_MIN, 258);
  assert.equal(GRID_MAX, 400);
  assert.deepEqual(
    { ...policy.writeGrid },
    { min: 258, max: 400, sideMargin: 20, promptGap: 16, toolsHeight: 40, toolsHeightAx: 52, bottomGap: 16, topShare: 0.4, topMin: 12, nominalHead: 44, nominalFoot: 116, footBottomMin: 8, nominalPrompt: 80 },
    'P118（D49：整组居中公式的参数；书写格边长公式的测试在 write-layout.test.mjs）',
  );
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

test('fitAnswerSize max follows the grid edge (write page passes it)', () => {
  assert.equal(fitAnswerSize({ available: 900, max: 361 }), 361);
  assert.equal(fitAnswerSize({ available: 900, max: 258 }), 258);
  assert.equal(fitAnswerSize({ available: 150, max: 361 }), 200);
});

test('fitAnswerSize never exceeds the content width', () => {
  assert.equal(fitAnswerSize({ available: 400, width: 320 }), 320);
  assert.equal(fitAnswerSize({ available: 250, width: 320 }), 250);
  assert.equal(fitAnswerSize({ available: 400, width: 0 }), 345, 'unknown width is ignored');
});

function fakeWin({ large = false, matches = false, throws = false } = {}) {
  return {
    document: { documentElement: { hasAttribute: name => name === 'data-text-large' && large } },
    matchMedia(q) {
      if (throws) throw new Error('no matchMedia');
      assert.equal(q, COMPACT_QUERY);
      return { matches };
    },
  };
}

test('isCompact: data-text-large (system text --k ≥ 1.3, P131) or a short viewport; the old data-large no longer counts (D29)', () => {
  assert.equal(isCompact(fakeWin()), false);
  assert.equal(isCompact(fakeWin({ matches: true })), true);
  assert.equal(isCompact(fakeWin({ large: true })), true);
  assert.equal(isCompact(fakeWin({ throws: true })), false);
  assert.equal(isCompact(fakeWin({ large: true, throws: true })), true);
  const oldLarge = { document: { documentElement: { hasAttribute: name => name === 'data-large' } }, matchMedia: () => ({ matches: false }) };
  assert.equal(isCompact(oldLarge), false, 'a stray data-large (old in-app switch) no longer selects the compact layout');
});

test('isCompact without window (node) is false', () => {
  assert.equal(isCompact(), false);
});

test('axLevelOf reads <html data-ax> (1–5); anything else is 0', () => {
  const win = v => ({ document: { documentElement: { getAttribute: name => (name === 'data-ax' ? v : null) } } });
  assert.equal(axLevelOf(win('5')), 5);
  assert.equal(axLevelOf(win('1')), 1);
  assert.equal(axLevelOf(win(null)), 0);
  assert.equal(axLevelOf(win('')), 0);
  assert.equal(axLevelOf(win('x')), 0);
  assert.equal(axLevelOf(), 0, 'no window (node)');
});
