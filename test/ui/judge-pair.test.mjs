// 阶段 1 P1-E1b（D46 ⑪）：判断页上下两格的边长公式与读屏名称。
//   S = min(屏宽 − 2 × (页边 20 + 旁注 52 + 间距 12), (书写格顶到页底栏的可用高 + 1) ÷ 2)，下限 120。
// 期望值取自设计稿 求助与判断.html ④（402 宽 → 234；440 宽 → 272），写死，不从实现里算。
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgePairSize, JUDGE_ASIDE_W, JUDGE_GUTTER, JUDGE_MIN, COMPARE_GAP, CompareStage } from '../../src/ui/screens/write/compare.js';

test('constants: 168 = 2 × (20 + 52 + 12)', () => {
  assert.equal(JUDGE_GUTTER, 20);
  assert.equal(JUDGE_ASIDE_W, 52);
  assert.equal(COMPARE_GAP, 12);
  assert.equal(JUDGE_MIN, 120);
  assert.equal(2 * (JUDGE_GUTTER + JUDGE_ASIDE_W + COMPARE_GAP), 168);
});

test('judgePairSize follows the design sheet: iPhone 17 (402) → 234, Pro Max (440) → 272, width-limited when tall', () => {
  assert.equal(judgePairSize({ width: 402, available: 566 }), 234, '402 wide: min(234, 283)');
  assert.equal(judgePairSize({ width: 440, available: 650 }), 272, '440 wide: min(272, 325)');
  assert.equal(judgePairSize({ width: 393, available: 600 }), 225, '393 wide: 393 − 168');
});

test('judgePairSize is limited by the height when the screen is short: two cards share one line (2S − 1 ≤ available)', () => {
  const s = judgePairSize({ width: 375, available: 413 });
  assert.equal(s, 207, '(413 + 1) ÷ 2 = 207 = 375 − 168');
  assert.equal(judgePairSize({ width: 402, available: 300 }), 150, '(300 + 1) ÷ 2 floored');
  for (const available of [260, 300, 380, 460, 560]) {
    const size = judgePairSize({ width: 402, available });
    assert.ok(2 * size - 1 <= available || size === JUDGE_MIN, `available ${available}: ${size} fits`);
  }
});

test('judgePairSize never goes below the floor and falls back to 234 when nothing is known', () => {
  assert.equal(judgePairSize({ width: 320, available: 100 }), 120, 'floor 120');
  assert.equal(judgePairSize({ width: 0, available: 0 }), 234, 'unknown viewport');
  assert.equal(judgePairSize({}), 234);
  assert.equal(judgePairSize({ width: 402 }), 234, 'only the width known: 402 − 168');
});

function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  fn(node);
  const kids = node.props && node.props.children;
  for (const k of Array.isArray(kids) ? kids.flat(Infinity) : [kids]) walk(k, fn);
}

test('CompareStage: two stacked rows (mine above reference), side notes aria-hidden, width = S', () => {
  const vnode = CompareStage({ char: '永', py: 'yǒng', strokes: [[{ x: 1, y: 1, t: 0 }, { x: 5, y: 5, t: 10 }]], strokeData: { status: 'loading', data: null }, size: 234 });
  const found = { rows: [], asides: [] };
  walk(vnode, n => {
    const cls = n.props && (n.props.class || n.props.className);
    if (typeof cls === 'string' && cls.split(' ').includes('sz-compare__row')) found.rows.push(cls);
    if (typeof cls === 'string' && cls.split(' ').includes('sz-compare__aside')) found.asides.push(n.props);
  });
  assert.deepEqual(found.rows, ['sz-compare__row sz-compare__row--mine', 'sz-compare__row sz-compare__row--ref'], 'mine first, reference second (vertical order)');
  assert.equal(found.asides.length, 2);
  assert.ok(found.asides.every(p => p['aria-hidden'] === 'true'), 'the side notes are aria-hidden: the card names carry the reading');
  assert.equal(vnode.props.style.width, '234px', 'the stage is exactly S wide');
  assert.equal(vnode.props['data-testid'], 'write-compare');
});
