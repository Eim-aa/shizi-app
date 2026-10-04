// 阶段 1 P1-E5：首练结果页专属区块（result/first.js）的纯函数与「放进去」状态；首页题记留白；只用黑体的文案登记。
import test from 'node:test';
import assert from 'node:assert/strict';
import { addedMembers, firstExtras, inviteExample, toggleAdded } from '../../src/ui/screens/result/first.js';
import { setCardResolver } from '../../src/data/deck.js';
import { epigraphReserve, tieIntrudesEpigraph } from '../../src/ui/screens/home/today.js';
import { EPIGRAPHS } from '../../src/config/epigraphs.js';
import { HEI_ONLY_COPY } from '../../scripts/fonts/build_corpus.mjs';
import { COPY } from '../../src/config/copy/index.js';
import { addDays } from '../../src/core/dates.js';

const TODAY = '2026-10-05';
const sched = due => ({ fsrs: { stability: 3 }, due, lastJudgedAt: 0 });
const cell = (char, kind, judgment, recordId) => ({ char, cardKey: `base:${char}`, kind, judgment, recordId });

test('firstExtras: the preview uses the real due days; the excluded list is wrong + inked chars only', () => {
  const cells = [cell('尴', 'judged', 'correct', 'r1'), cell('赢', 'judged', 'wrong', 'r2'), cell('拾', 'judged', 'correct', 'r3')];
  const out = firstExtras({
    cells, today: TODAY, hasInk: id => id !== 'r1',
    sched: { 'base:尴': sched(addDays(TODAY, 8)), 'base:赢': sched(addDays(TODAY, 1)), 'base:拾': sched(addDays(TODAY, 3)) },
  });
  assert.equal(out.preview, '「赢」明天再来找你，「拾」过两天，「尴」过几天。');
  assert.deepEqual(out.excluded, [{ char: '赢', recordId: 'r2' }]);
  // 写错但没有墨迹 → 没有可放进去的（设计稿：没有墨的没有动作）
  assert.deepEqual(firstExtras({ cells, today: TODAY, sched: {}, hasInk: () => false }).excluded, []);
  // 全部写对：没有「没放进图里」，预告句是「它们」
  const allRight = [cell('尴', 'judged', 'correct', 'r1'), cell('赢', 'judged', 'correct', 'r2'), cell('拾', 'judged', 'correct', 'r3')];
  const same = firstExtras({ cells: allRight, today: TODAY, hasInk: () => true, sched: Object.fromEntries(['尴', '赢', '拾'].map(c => [`base:${c}`, sched(addDays(TODAY, 2))])) });
  assert.deepEqual([same.preview, same.excluded], ['过两天，它们再来找你。', []]);
  // 看过答案 / 跳过的字没有调度：不进预告，也不进「放进去」；一个可预告的都没有 → 没有预告句
  const noneJudged = [cell('尴', 'answer-seen', null, 'r1'), cell('赢', 'skipped', null, 'r2')];
  assert.deepEqual(firstExtras({ cells: noneJudged, today: TODAY, hasInk: () => true, sched: {} }), { preview: '', excluded: [] });
});

test('「放进去」: a per-session set in page memory (the membership rule itself is P1-E7)', () => {
  assert.deepEqual(addedMembers('s-test'), []);
  assert.equal(toggleAdded('s-test', 'r2'), true);
  assert.deepEqual(addedMembers('s-test'), ['r2']);
  assert.deepEqual(addedMembers('other'), [], 'per session');
  assert.equal(toggleAdded('s-test', 'r2'), false);
  assert.deepEqual(addedMembers('s-test'), []);
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

test('epigraphReserve: how far down the top-right epigraph reaches (wide copybooks keep clear of it)', () => {
  const reserve = EPIGRAPHS.map(e => epigraphReserve(e));
  assert.deepEqual(reserve, [174, 169, 245], 'per epigraph (出处 length and quote column height differ)');
  assert.ok(reserve[2] > reserve[0] && reserve[2] > reserve[1], 'the long 苏轼 line reaches the lowest');
  assert.ok(reserve.every(r => r > 96), 'all reach below the 96px header, so a wide copybook needs a margin');
  assert.deepEqual(EPIGRAPHS.map(e => epigraphReserve(e, { compact: true })), [174, 203, 261], 'compact: one 13pt column of both lines + seal, no source');
  assert.equal(epigraphReserve(null), 0);
  assert.equal(reserve[2], 245, '4 + 71 + 10 × 14.56 + 8 + 16 for 苏轼《石苍舒醉墨堂》');
});

test('HEI_ONLY_COPY: every registered key exists in copy (so it can be excluded from the Serif subset), and only these three kinds of text', () => {
  for (const key of HEI_ONLY_COPY) assert.ok(Object.prototype.hasOwnProperty.call(COPY, key), `${key} is a copy key`);
  assert.ok(HEI_ONLY_COPY.every(key => /^X-(FIRST|HOME|INVITE)\./.test(key)), 'only the P1-E5 body texts');
});

test('tieIntrudesEpigraph: which copybooks reach under the top-right epigraph (they get a top margin; a single 「拾」 does not)', () => {
  assert.equal(tieIntrudesEpigraph({ width: 393, tieWidth: 340 }), true, 'four cells at 393');
  assert.equal(tieIntrudesEpigraph({ width: 393, tieWidth: 214 }), true, 'two cells just reach it');
  assert.equal(tieIntrudesEpigraph({ width: 393, tieWidth: 167 }), false, 'a single 拾 cell is narrow');
  assert.equal(tieIntrudesEpigraph({ width: 360, tieWidth: 280, compact: true }), false, 'compact: two rows of four (280) stay clear of the one-column epigraph');
  assert.equal(tieIntrudesEpigraph({ width: 360, tieWidth: 320, compact: true }), true, 'compact: five cells (320) reach it');
});
