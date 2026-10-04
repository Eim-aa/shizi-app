// 阶段 1 P1-E1b / E9b（D46 ⑪、D49）：判断页上下两格的结构与读屏名称。边长公式的测试在 write-layout.test.mjs。
//   D49：两格没有旁注（「你的书写 / 参考字形」只留读屏名称）；AX 档可并排（layout='side'，整体宽 2S + 12）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { CompareStage, judgePairSize, COMPARE_GAP, JUDGE_MIN } from '../../src/ui/screens/write/compare.js';

test('compare.js still re-exports the pair size function and constants (callers keep their import path)', () => {
  assert.equal(typeof judgePairSize, 'function');
  assert.equal(COMPARE_GAP, 12);
  assert.equal(JUDGE_MIN, 120);
});

function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  fn(node);
  const kids = node.props && node.props.children;
  for (const k of Array.isArray(kids) ? kids.flat(Infinity) : [kids]) walk(k, fn);
}

const stage = o => CompareStage({ char: '永', py: 'yǒng', strokes: [[{ x: 1, y: 1, t: 0 }, { x: 5, y: 5, t: 10 }]], strokeData: { status: 'loading', data: null }, ...o });

function classes(vnode) {
  const out = [];
  walk(vnode, n => {
    const cls = n.props && (n.props.class || n.props.className);
    if (typeof cls === 'string') out.push(...cls.split(' '));
  });
  return out;
}

test('CompareStage (stack): two rows, mine above reference, no side notes at all, width = S', () => {
  const vnode = stage({ size: 231 });
  const rows = [];
  walk(vnode, n => {
    const cls = n.props && (n.props.class || n.props.className);
    if (typeof cls === 'string' && cls.split(' ').includes('sz-compare__row')) rows.push(cls);
  });
  assert.deepEqual(rows, ['sz-compare__row sz-compare__row--mine', 'sz-compare__row sz-compare__row--ref'], 'mine first, reference second (vertical order)');
  assert.ok(!classes(vnode).includes('sz-compare__aside'), 'D49: no 「你的书写 / 参考字形」 side notes');
  const ids = [];
  walk(vnode, n => { const id = n.props && (n.props['data-testid'] || n.props.testid); if (id) ids.push(id); });
  assert.deepEqual(ids, ['write-compare', 'write-compare-mine', 'write-compare-ref']);
  assert.equal(vnode.props.style.width, '231px', 'the stage is exactly S wide');
  assert.equal(vnode.props['data-layout'], 'stack');
});

test('CompareStage (side, AX): left = mine, right = reference, width = 2S + 12', () => {
  const vnode = stage({ size: 161, layout: 'side' });
  assert.equal(vnode.props['data-layout'], 'side');
  assert.equal(vnode.props.style.width, `${2 * 161 + 12}px`);
  const order = [];
  walk(vnode, n => { const id = n.props && (n.props['data-testid'] || n.props.testid); if (/write-compare-(mine|ref)$/.test(id || '')) order.push(id); });
  assert.deepEqual(order, ['write-compare-mine', 'write-compare-ref'], 'DOM (= reading) order: mine first');
});
