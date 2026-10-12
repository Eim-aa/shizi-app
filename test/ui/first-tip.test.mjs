// 阶段 1 Q2-1（03 P181）：首练第 1 字格下的一次性提示——何时出现（纯函数）与「只出现一次」的记录（commitFirstTipSeen / schema）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { firstTipDue, commitFirstTipSeen } from '../../src/ui/screens/write/first-tip.js';
import { validateValue, KEYS } from '../../src/core/schema.js';
import { t } from '../../src/config/copy/index.js';

const first = { kind: 'first', cursor: 0 };

test('firstTipDue：只在首练第 1 字、回忆阶段、没出现过', () => {
  assert.equal(firstTipDue({ settings: null, session: first, phase: 'recall' }), true);
  assert.equal(firstTipDue({ settings: {}, session: first, phase: 'recall' }), true);
  assert.equal(firstTipDue({ settings: { firstTipSeen: false }, session: first, phase: 'recall' }), true);
  assert.equal(firstTipDue({ settings: { firstTipSeen: true }, session: first, phase: 'recall' }), false, '出现过不再出现');
  assert.equal(firstTipDue({ settings: null, session: { kind: 'first', cursor: 1 }, phase: 'recall' }), false, '第 2 字不出现');
  assert.equal(firstTipDue({ settings: null, session: { kind: 'daily', cursor: 0 }, phase: 'recall' }), false, '日常组不出现');
  assert.equal(firstTipDue({ settings: null, session: { kind: 'picked', cursor: 0 }, phase: 'recall' }), false, '自选组不出现');
  assert.equal(firstTipDue({ settings: null, session: first, phase: 'compare' }), false, '判断页不出现');
  assert.equal(firstTipDue({ settings: null, session: first, phase: 'answer' }), false, '看答案不出现');
  assert.equal(firstTipDue({ settings: null, session: null, phase: 'recall' }), false, '没有会话不出现');
});

test('commitFirstTipSeen：经 store.commit 写 settings.firstTipSeen；已记过不再写', () => {
  const calls = [];
  let state = { settings: { sound: true } };
  const store = {
    getState: () => state,
    commit(label, fn) {
      const draft = JSON.parse(JSON.stringify(state));
      fn(draft, { now: 0 });
      state = draft;
      calls.push(label);
      return { ok: true, keys: ['settings'] };
    },
  };
  const r = commitFirstTipSeen(store);
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['write:first-tip']);
  assert.deepEqual(state.settings, { sound: true, firstTipSeen: true }, '保留其他设置');
  const again = commitFirstTipSeen(store);
  assert.equal(again.skipped, true);
  assert.equal(calls.length, 1, '已记过不再 commit');
});

test('schema：settings.firstTipSeen 是布尔，类型不对被拒绝', () => {
  assert.equal(validateValue(KEYS.settings, { firstTipSeen: true }), null);
  assert.notEqual(validateValue(KEYS.settings, { firstTipSeen: 'yes' }), null);
});

test('文案：X-WRITE.firstTip 与交接 §3 一致', () => {
  assert.equal(t('X-WRITE.firstTip'), '凭记忆写；想不起来，点下面的「提示」。');
});
