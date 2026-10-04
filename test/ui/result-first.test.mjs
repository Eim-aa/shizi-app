// 阶段 1 P1-E5：首练结果页专属区块（result/first.js）的纯函数与「放进去」状态；只用黑体的文案登记。
import test from 'node:test';
import assert from 'node:assert/strict';
import { daysLaterOf, firstExtras, inviteExample } from '../../src/ui/screens/result/first.js';
import { setCardResolver } from '../../src/data/deck.js';
import { HEI_ONLY_COPY } from '../../scripts/fonts/build_corpus.mjs';
import { COPY } from '../../src/config/copy/index.js';
import { addDays } from '../../src/core/dates.js';

const TODAY = '2026-10-05';
const sched = due => ({ fsrs: { stability: 3 }, due, lastJudgedAt: 0 });
const cell = (char, kind, judgment, recordId) => ({ char, cardKey: `base:${char}`, kind, judgment, recordId });

test('firstExtras: the preview uses the real due days (the 「放进去」 list moved to core/images/work.js with P1-E7)', () => {
  const cells = [cell('尴', 'judged', 'correct', 'r1'), cell('赢', 'judged', 'wrong', 'r2'), cell('拾', 'judged', 'correct', 'r3')];
  const out = firstExtras({
    cells, today: TODAY,
    sched: { 'base:尴': sched(addDays(TODAY, 8)), 'base:赢': sched(addDays(TODAY, 1)), 'base:拾': sched(addDays(TODAY, 3)) },
  });
  assert.equal(out.preview, '「赢」明天再来找你，「拾」过两天，「尴」过几天。');
  // 全部写对：预告句是「它们」
  const allRight = [cell('尴', 'judged', 'correct', 'r1'), cell('赢', 'judged', 'correct', 'r2'), cell('拾', 'judged', 'correct', 'r3')];
  const same = firstExtras({ cells: allRight, today: TODAY, sched: Object.fromEntries(['尴', '赢', '拾'].map(c => [`base:${c}`, sched(addDays(TODAY, 2))])) });
  assert.equal(same.preview, '过两天，它们再来找你。');
  // 看过答案 / 跳过的字没有调度：不进预告；一个可预告的都没有 → 没有预告句
  const noneJudged = [cell('尴', 'answer-seen', null, 'r1'), cell('赢', 'skipped', null, 'r2')];
  assert.deepEqual(firstExtras({ cells: noneJudged, today: TODAY, sched: {} }), { preview: '' });
});

test('daysLaterOf: the result page cells → [{char, days, text}] for each judged char (data + copy only; the layout is not touched, D48)', () => {
  const cells = [cell('尴', 'judged', 'correct', 'r1'), cell('赢', 'judged', 'wrong', 'r2'), cell('拾', 'skipped', null, 'r3'), cell('酱', 'answer-seen', null, 'r4')];
  const out = daysLaterOf({
    cells, today: TODAY,
    sched: { 'base:尴': sched(addDays(TODAY, 8)), 'base:赢': sched(addDays(TODAY, 1)), 'base:拾': sched(addDays(TODAY, 3)) },
  });
  assert.deepEqual(out, [
    { char: '尴', cardKey: 'base:尴', days: 8, text: '8 天后再见' },
    { char: '赢', cardKey: 'base:赢', days: 1, text: '明天再见' },
  ], 'skipped / answer-seen chars are not valid records → no 「再见」');
  assert.deepEqual(daysLaterOf({ cells: [], today: TODAY, sched: {} }), []);
});

test('inviteExample: the first practice char, its word masked (□), plus the pinyin; no word → no example', () => {
  setCardResolver(key => (key === 'base:尴' ? { chars: ['尴', '尬'], target: '尴', py: 'gān', word: '尴尬' } : key === 'base:无' ? { chars: ['无'], target: '无', py: '' } : undefined));
  try {
    assert.deepEqual(inviteExample({ queue: ['base:尴', 'base:赢'] }), { word: '□尬', pinyin: 'gān' });
    assert.equal(inviteExample({ queue: ['base:无'] }), null, 'no pinyin → no example');
    assert.equal(inviteExample({ queue: [] }), null);
    assert.equal(inviteExample(null), null);
  } finally {
    setCardResolver(null);
  }
});

test('HEI_ONLY_COPY: every registered key exists in copy (so it can be excluded from the Serif subset), and only these three kinds of text', () => {
  for (const key of HEI_ONLY_COPY) assert.ok(Object.prototype.hasOwnProperty.call(COPY, key), `${key} is a copy key`);
  assert.ok(HEI_ONLY_COPY.every(key => /^X-(FIRST|HOME|INVITE|WORK)\./.test(key)), 'only the P1-E5 / P1-E7 body texts');
});
