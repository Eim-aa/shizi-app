// R2-X1（D51 ②，P227；第二轮审查 I2-03 的写字页部分）：每字一次触觉。真实页面里的计数在 scripts/e2e/87-x1-haptic-once.spec.js。
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMIT_FEEDBACK, feedbackFor, applyFeedback } from '../../src/platform/haptics.js';

test('haptics (I2-03, write page): the judgement sends exactly one stamp + one judge sound; entering / leaving the judge page, hints, strokes, phases send none', () => {
  const sent = [];
  const deps = { haptic: k => { sent.push(['haptic', k]); return true; }, keySound: k => { sent.push(['sound', k]); return true; } };
  applyFeedback({ type: 'commit', label: 'write:judge' }, {}, deps);
  assert.deepEqual(sent, [['haptic', 'judge'], ['sound', 'judge']], 'one judgement → one judge haptic (soft 0.7, D58 ③), one sound');
  sent.length = 0;
  for (const label of ['write:compare', 'write:continue', 'write:strokes', 'hint-fade', 'write:first-tip', 'write:paper', 'write:answer-note', 'result:finish']) {
    assert.equal(feedbackFor({ type: 'commit', label }), null, `${label} sends nothing`);
  }
  const haptics = Object.entries(COMMIT_FEEDBACK).filter(([, v]) => v.haptic).map(([k]) => k);
  assert.ok(!haptics.includes('result:finish'), 'no finish haptic: the last judgement does not stack a second one');
  assert.equal(haptics.filter(k => k === 'write:judge').length, 1);
});
