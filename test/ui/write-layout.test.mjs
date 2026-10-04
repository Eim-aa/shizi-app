// 阶段 1 E9b（D49 实现交接 §13.2 / §9.1 / §9.4；P118 / P151 / P190）：写字页整组居中、书写格边长与判断页两格边长的纯函数。
// 期望值写死，取自设计稿（实现交接 §13.2 / §9.1 的表）：主区高 = 屏高 − 状态栏 − 页头 44 − 按钮行（上 12 + 主按钮 54 + 间 6 + 文字行 44 + 下安全区）。
//   iPhone 17 402×874（状态栏 54、下 34）：主区 626；SE 3 375×667（20、8）：479；Pro Max 440×956（62、34）：700。题面高 P = 80。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  writeGridSize, writeLayout, groupTop, judgePairSize, judgeAxLayout, estimateLayout, GRID_MIN, GRID_MAX, JUDGE_MIN, COMPARE_GAP,
} from '../../src/ui/screens/write/layout.js';

const mainOf = (h, sb, bot) => h - sb - 44 - (12 + 54 + 6 + 44 + bot);

test('the design sheet numbers: main areas of the three reference phones', () => {
  assert.equal(mainOf(874, 54, 34), 626);
  assert.equal(mainOf(667, 20, 8), 479);
  assert.equal(mainOf(956, 62, 34), 700);
});

test('writeLayout follows §13.2: 402 → prompt top 149 / grid top 245 / g 362; SE → 76 / 172 / 327; Pro Max → g 400', () => {
  const a = writeLayout({ width: 402, mainHeight: 626, promptHeight: 80 });
  assert.equal(a.g, 362);
  assert.equal(a.top, 51, 'round((626 − 498) × 0.4)');
  assert.equal(54 + 44 + a.top, 149, 'prompt top on the page');
  assert.equal(54 + 44 + a.gridTop, 245, 'grid top on the page');
  const b = writeLayout({ width: 375, mainHeight: 479, promptHeight: 80 });
  assert.equal(b.g, 327, '479 − 80 − 16 − 40 − 16');
  assert.equal(b.top, 12, 'the 40% share (6) is below the 12 floor (the spare, 16, allows 12)');
  assert.equal(20 + 44 + b.top, 76);
  assert.equal(20 + 44 + b.gridTop, 172);
  const c = writeLayout({ width: 440, mainHeight: 700, promptHeight: 80 });
  assert.equal(c.g, 400, 'capped at 400 (also 440 − 40)');
  assert.equal(c.top, 66, 'round((700 − 536) × 0.4)');
});

test('writeLayout: g is sized from the nominal prompt (80), the position from the measured prompt (hint line, big text) — the grid never shrinks for either (D36)', () => {
  const plain = writeLayout({ width: 402, mainHeight: 626, promptHeight: 80, sizingHeight: 80 });
  const hinted = writeLayout({ width: 402, mainHeight: 626, promptHeight: 80 + 10 + 22, sizingHeight: 80 });
  const big = writeLayout({ width: 402, mainHeight: 626, promptHeight: 86, sizingHeight: 80 });
  assert.equal(hinted.g, plain.g, 'a prompt hint line does not shrink the grid');
  assert.equal(big.g, plain.g, 'neither does a bigger system text size');
  assert.ok(hinted.top < plain.top, 'the group sits higher instead (centered with the taller prompt)');
  assert.equal(hinted.gridTop, hinted.top + 112 + 16);
  const ax = writeLayout({ width: 402, mainHeight: 500, promptHeight: 126, sizingHeight: 126, ax: true });
  assert.equal(ax.g, Math.max(258, 500 - 126 - 16 - 52 - 16), 'AX: sized from the measured word row and the 52-high tools row');
});

test('writeGridSize: min(W − 40, 400, main − P − 16 − T − 16) clamped to [258, 400]; independent of the text size', () => {
  const cases = [
    // [宽, 主区高, P, 期望, 说明]
    [402, 626, 80, 362, 'width first'],
    [375, 479, 80, 327, 'height first'],
    [440, 700, 80, 400, 'cap'],
    [768, 900, 80, 400, 'tablet: cap'],
    [320, 300, 80, 258, 'floor'],
    [402, 626, 126, 362, 'a taller prompt (AX) still leaves room here'],
    [402, 500, 126, 302, '500 − 126 − 16 − 40 − 16'],
    [375, 400, 80, 258, 'not enough → floor (the page scrolls)'],
  ];
  for (const [width, mainHeight, promptHeight, expected, why] of cases) {
    assert.equal(writeGridSize({ width, mainHeight, promptHeight }), expected, `${width}×${mainHeight} P${promptHeight}: ${why}`);
  }
  assert.equal(GRID_MIN, 258);
  assert.equal(GRID_MAX, 400);
});

test('writeGridSize: always within [258, 400] and never wider than the screen minus 40 unless below the floor', () => {
  for (let w = 280; w <= 900; w += 20) {
    for (let m = 300; m <= 900; m += 20) {
      const s = writeGridSize({ width: w, mainHeight: m, promptHeight: 80 });
      assert.ok(s >= 258 && s <= 400, `${w}×${m}: ${s}`);
      assert.ok(s <= Math.max(258, w - 40));
      assert.ok(Number.isInteger(s));
    }
  }
});

test('writeGridSize: missing or invalid sizes fall back to the old 345 grid / only the known side counts', () => {
  assert.equal(writeGridSize(), 345);
  assert.equal(writeGridSize({}), 345);
  assert.equal(writeGridSize({ width: NaN, mainHeight: 0 }), 345);
  assert.equal(writeGridSize({ width: 393 }), 353, 'only the width known');
  assert.equal(writeGridSize({ mainHeight: 479 }), 327, 'only the height known');
});

test('groupTop: 40% of the spare height above (60% below), at least 12 — but never more than the spare (the top gap never pushes the group out)', () => {
  assert.equal(groupTop({ mainHeight: 626, groupHeight: 498 }), 51);
  assert.equal(groupTop({ mainHeight: 479, groupHeight: 463 }), 12, 'SE: 40% of 16 is 6, the floor is 12 and the spare (16) allows it');
  assert.equal(groupTop({ mainHeight: 472, groupHeight: 461.7 }), 10, 'XXXL on the shortest screen: only 10.3 spare → top 10, no overflow');
  assert.equal(groupTop({ mainHeight: 500, groupHeight: 498 }), 2, 'spare 2 → top 2');
  assert.equal(groupTop({ mainHeight: 400, groupHeight: 498 }), 0, 'overflow: the page scrolls, the top gap is 0');
  assert.equal(groupTop({ mainHeight: 700, groupHeight: 536 }), 66);
  assert.equal(groupTop({}), 12);
});

test('judgePairSize follows §9.1: 402 → 231, SE → 177, Pro Max → 261; width-limited when tall; floor 120', () => {
  // S = min(W − 40, ⌊(主区高 − 书写格顶 − 16) ÷ 2⌋)
  assert.equal(judgePairSize({ width: 402, mainHeight: 626, gridTop: 147 }), 231, '(626 − 147 − 16) ÷ 2');
  assert.equal(judgePairSize({ width: 375, mainHeight: 479, gridTop: 108 }), 177, '(479 − 108 − 16) ÷ 2');
  assert.equal(judgePairSize({ width: 440, mainHeight: 700, gridTop: 162 }), 261, '(700 − 162 − 16) ÷ 2');
  assert.equal(judgePairSize({ width: 402, mainHeight: 1600, gridTop: 147 }), 362, 'width-limited: W − 40');
  assert.equal(judgePairSize({ width: 320, mainHeight: 200, gridTop: 100 }), JUDGE_MIN, 'floor');
  assert.equal(judgePairSize({}), 234, 'nothing known');
  // 与整组位置的联动：同一组输入
  for (const [w, main] of [[402, 626], [375, 479], [440, 700]]) {
    const L = writeLayout({ width: w, mainHeight: main, promptHeight: 80 });
    const s = judgePairSize({ width: w, mainHeight: main, gridTop: L.gridTop });
    assert.ok(L.gridTop + 2 * s - 1 <= main - 16 + 1, `${w}: the pair (2S − 1 tall) ends ≥ 16 above the button row`);
    assert.ok(s <= w - 40);
  }
});

test('judgeAxLayout (D49 ⑧): stack vs side — take the one with the bigger cells; side is (W − 40 − 12) ÷ 2', () => {
  // 402 AX5：上下排 181（实现交接 §9.4）：S_v = ⌊(主区高 − 12 − P − 16 − 16) ÷ 2⌋，P = 126（AX5 拼音 58 + 4 + 题面格 64）→ 主区高 532
  const a = judgeAxLayout({ width: 402, mainHeight: 532, promptHeight: 126 });
  assert.deepEqual([a.layout, a.s, a.top, a.stack, a.side], ['stack', 181, 12, 181, 175]);
  // SE AX5：并排 161 = ⌊(375 − 40 − 12) ÷ 2⌋，上下排放不下（更小）
  const b = judgeAxLayout({ width: 375, mainHeight: 400, promptHeight: 126 });
  assert.deepEqual([b.layout, b.s, b.stack, b.side], ['side', 161, 115, 161], '⌊(400 − 12 − 126 − 16 − 16) ÷ 2⌋ = 115 < 161');
  assert.equal(b.top, Math.max(12, Math.round((400 - (126 + 16 + 161)) * 0.4)), 'side: the 40% rule on the group (P + 16 + S)');
  assert.equal(COMPARE_GAP, 12);
  // 平手取上下排；并排只在更大时才用
  const c = judgeAxLayout({ width: 402, mainHeight: 44 + 126 + 2 * 175, promptHeight: 126 });
  assert.equal(c.stack, 175);
  assert.equal(c.layout, 'stack', 'a tie keeps the stack');
  const d = judgeAxLayout({ width: 402, mainHeight: 44 + 126 + 2 * 174, promptHeight: 126 });
  assert.equal(d.layout, 'side', '174 < 175');
  assert.equal(d.s, 175);
  // 任何一种取法，格子都是两种里更大的（下限 120 除外）
  for (const main of [300, 400, 532, 700]) {
    for (const w of [375, 402, 440]) {
      const r = judgeAxLayout({ width: w, mainHeight: main, promptHeight: 126 });
      assert.equal(r.layout, r.side > r.stack ? 'side' : 'stack', `${w}×${main}: the layout with the bigger cells wins`);
      assert.equal(r.s, r.layout === 'side' ? r.side : Math.max(JUDGE_MIN, r.stack), `${w}×${main}: S of the chosen layout (stack has the 120 floor)`);
    }
  }
});

test('estimateLayout: first-frame guess from the window (no safe area, standard prompt)', () => {
  const win = (width, height) => ({ innerWidth: width, innerHeight: height, document: { documentElement: { clientWidth: width, clientHeight: height } } });
  const a = estimateLayout(win(402, 874));
  assert.equal(a.g, 362);
  const b = estimateLayout(win(375, 667));
  assert.equal(b.g, 335, 'no safe area: 375 − 40 (the height 667 − 44 − 124 − 72 − 80 = 347 is not the limit)');
  assert.equal(estimateLayout().g, 345, 'no window (node) → 345');
});
