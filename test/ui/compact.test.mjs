// 紧凑版写字页纯逻辑单测（M1-7；V02；P0-D / D36 起书写格不再随紧凑版缩小）：书写格边长公式、看答案卡片尺寸夹取、紧凑版判定条件。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitAnswerSize, isCompact, writeGridSize, gridSizeOfWindow, GRID_MIN, GRID_MAX, ANSWER_MIN, ANSWER_MAX, COMPACT_MAX_HEIGHT, COMPACT_QUERY,
} from '../../src/ui/screens/write/compact.js';
import * as policy from '../../src/config/policy.js';

test('constants follow D36 / V02', () => {
  assert.equal(GRID_MIN, 258);
  assert.equal(GRID_MAX, 400);
  assert.deepEqual({ ...policy.writeGrid }, { min: 258, max: 400, sideMargin: 20, reserveStd: 422, reserveCompact: 350 }, 'P118（P1-E1b：页边 20、结果行进格下说明位、页底栏两行）');
  assert.equal(ANSWER_MIN, 200);
  assert.equal(ANSWER_MAX, 345);
  assert.equal(COMPACT_QUERY, `(max-height: ${COMPACT_MAX_HEIGHT}px)`);
  assert.ok(COMPACT_MAX_HEIGHT >= 640 && COMPACT_MAX_HEIGHT < 852, '360×640 is compact, 393×852 is not');
});

// 书写格边长公式（D36，P118；P1-E1b 起页边 20）：min(屏宽 − 40, 视口高 − 预算) 夹在 [258, 400]；视口高 ≤ 760 用紧凑预算 350，否则标准预算 422。
// 期望值写死（不从实现里算）。
const GRID_CASES = [
  // [宽, 高, 期望, 说明]
  [393, 852, 353, '屏宽 − 40 先到'],
  [440, 956, 400, '上限 400'],
  [375, 667, 317, '667 − 350'],
  [320, 568, 258, '预算不够，取下限'],
  [360, 640, 290, '640 − 350'],
  [375, 812, 335, '屏宽 − 40'],
  [393, 760, 353, '紧凑预算：760 − 350 = 410，屏宽先到'],
  [393, 761, 339, '标准预算：761 − 422'],
  [412, 915, 372, '屏宽 − 40'],
  [768, 1024, 400, '平板：上限'],
];

test('writeGridSize: the five reference viewports and neighbours', () => {
  for (const [width, height, expected, why] of GRID_CASES) {
    assert.equal(writeGridSize({ width, height }), expected, `${width}×${height}: ${why}`);
  }
});

test('writeGridSize: always within [258, 400] and never wider than the screen minus 40 unless that is below the floor', () => {
  for (let w = 280; w <= 900; w += 20) {
    for (let h = 480; h <= 1100; h += 20) {
      const s = writeGridSize({ width: w, height: h });
      assert.ok(s >= 258 && s <= 400, `${w}×${h}: ${s}`);
      assert.ok(s <= Math.max(258, w - 40), `${w}×${h}: ${s} ≤ width − 40`);
      assert.ok(Number.isInteger(s));
    }
  }
});

test('writeGridSize: safe areas take height (top in full, bottom only above the footer padding baseline)', () => {
  assert.equal(writeGridSize({ width: 393, height: 780, safeTop: 59, safeBottom: 34 }), 285, '780 − 422 − 59 − (34 − 20)');
  assert.equal(writeGridSize({ width: 393, height: 852, safeTop: 0, safeBottom: 20 }), 353, 'bottom padding at the baseline costs nothing');
  assert.equal(writeGridSize({ width: 393, height: 700, safeTop: 20, safeBottom: 34 }), 700 - 350 - 20 - (34 - 6), 'compact baseline is 6');
  assert.equal(writeGridSize({ width: 393, height: 852, safeTop: 400 }), 258, 'floor wins');
});

test('writeGridSize: missing or invalid viewport falls back to the old 345 grid', () => {
  assert.equal(writeGridSize(), 345);
  assert.equal(writeGridSize({}), 345);
  assert.equal(writeGridSize({ width: NaN, height: 0 }), 345);
  assert.equal(writeGridSize({ width: 393 }), 353, 'only the width known');
  assert.equal(writeGridSize({ height: 667 }), 317, 'only the height known');
});

function sizedWin({ width, height, large }) {
  return {
    innerWidth: width,
    innerHeight: height,
    document: { documentElement: { hasAttribute: name => name === 'data-text-large' && large, clientWidth: width, clientHeight: height } },
  };
}

test('gridSizeOfWindow ignores the system text size (data-text-large): same viewport, same grid (D36 / G05, P131)', () => {
  for (const [width, height, expected] of GRID_CASES.slice(0, 6)) {
    const normal = gridSizeOfWindow(sizedWin({ width, height, large: false }));
    const large = gridSizeOfWindow(sizedWin({ width, height, large: true }));
    assert.equal(normal, expected, `${width}×${height} normal`);
    assert.equal(large, expected, `${width}×${height} data-text-large`);
  }
  assert.equal(gridSizeOfWindow(), 345, 'no window (node) → 345');
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
