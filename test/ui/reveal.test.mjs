// 结果页作品显现与落印（R2-R1 / D51 ②；N2-01 / I2-03；03 P216）：时序是纯函数，总时长 ≤ 750ms；WorkPaper 只在给了 reveal 时才带动画类与延时；
// 进结果页不再发 result:finish 触觉（落印那一帧才发一次，在 result/work.js sealMoment，行为由 e2e 81-r1-reveal 验证）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { REVEAL_MAX_MS, revealPlan } from '../../src/ui/screens/result/work.js';
import { WorkPaper } from '../../src/ui/components/work.js';
import { Seal } from '../../src/ui/components/marks.js';
import { COMMIT_FEEDBACK, feedbackFor } from '../../src/platform/haptics.js';

function find(vnode, pred, out = []) {
  if (!vnode || typeof vnode !== 'object') return out;
  if (Array.isArray(vnode)) {
    vnode.forEach(v => find(v, pred, out));
    return out;
  }
  if (pred(vnode)) out.push(vnode);
  const kids = vnode.props && vnode.props.children;
  if (kids !== undefined) find(kids, pred, out);
  return out;
}

test('revealPlan: the whole reveal (cells → 落款 → seal lands) never exceeds 750ms, whatever the count', () => {
  assert.equal(REVEAL_MAX_MS, 750);
  for (let n = 1; n <= 80; n += 1) {
    const p = revealPlan(n);
    assert.ok(p.total <= 750, `n=${n}: total ${p.total}ms ≤ 750`);
    assert.ok(p.stagger <= 50 && p.stagger >= 0, `n=${n}: stagger ${p.stagger}`);
    assert.equal(p.total, p.sealDelay + p.sealMs, 'the seal lands at the end of its own animation');
    assert.ok(p.kuanDelay >= (n - 1) * p.stagger, `n=${n}: the 落款 comes in while the last cell is still arriving, not before the first cells`);
    assert.ok(p.sealDelay > p.kuanDelay, 'the seal comes after the 落款');
  }
});

test('revealPlan: 2–8 chars (a normal group) stagger the cells by 40–50ms; one char has nothing to stagger', () => {
  for (let n = 2; n <= 8; n += 1) {
    const { stagger } = revealPlan(n);
    assert.ok(stagger >= 40 && stagger <= 60, `n=${n}: stagger ${stagger}ms is the 「每格错开约 40–60ms」`);
  }
  assert.equal(revealPlan(1).stagger, 0);
  assert.equal(revealPlan(0).total, revealPlan(1).total, 'a bad count falls back to one cell');
  assert.ok(revealPlan(1).total < revealPlan(8).total, 'more chars take longer, within the cap');
});

const cells = n => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, ch: String.fromCodePoint(0x4e00 + i), ink: null, mode: 'under', label: 'x' }));

test('WorkPaper: without reveal it is the final state (no animation classes, no delays); with reveal each cell, the 落款 and the seal get their own delay and the seal reports landing', () => {
  const grid = { cols: 3, rows: 1, c: 100 };
  const still = WorkPaper({ cells: cells(3), grid, kuan: 'k' });
  assert.equal(find(still, x => /sz-wcell--in|sz-work__kuan--in|sz-seal--land/.test(String(x.props && x.props.class))).length, 0);
  let landed = 0;
  const plan = revealPlan(3);
  const moving = WorkPaper({ cells: cells(3), grid, kuan: 'k', reveal: { plan, onLand: () => { landed += 1; } } });
  const cellEls = find(moving, x => x.type === 'button' && /sz-wcell--in/.test(String(x.props.class)));
  assert.deepEqual(cellEls.map(e => e.props.style.animationDelay), [0, 1, 2].map(i => `${i * plan.stagger}ms`), 'each cell is delayed by one more stagger');
  const kuanEl = find(moving, x => /sz-work__kuan--in/.test(String(x.props.class)))[0];
  assert.equal(kuanEl.props.style.animationDelay, `${plan.kuanDelay}ms`);
  const seal = find(moving, x => x.type === Seal)[0];
  assert.equal(seal.props.cls, 'sz-seal--land');
  assert.equal(seal.props.style.animationDelay, `${plan.sealDelay}ms`);
  seal.props.onLand();
  assert.equal(landed, 1, 'the seal’s animationend is the landing callback (s1 and the haptic are sent from it)');
});

test('haptics: entering the result page no longer sends the finish haptic (the judgment already stamped; the one result haptic is the seal landing)', () => {
  assert.equal(COMMIT_FEEDBACK['result:finish'], undefined);
  assert.equal(feedbackFor({ type: 'commit', label: 'result:finish' }), null);
  assert.deepEqual(feedbackFor({ type: 'commit', label: 'write:judge' }), { haptic: 'stamp', sound: 'judge' }, 'the judgment feedback is unchanged');
});
