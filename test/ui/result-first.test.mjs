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

test('firstExtras (E9c, D48): the 复现句 is 「N 天后再见」 per char from the real due days (merged when equal)', () => {
  const cells = [cell('尴', 'judged', 'correct', 'r1'), cell('赢', 'judged', 'wrong', 'r2'), cell('拾', 'judged', 'correct', 'r3')];
  const out = firstExtras({
    cells, today: TODAY,
    sched: { 'base:尴': sched(addDays(TODAY, 8)), 'base:赢': sched(addDays(TODAY, 1)), 'base:拾': sched(addDays(TODAY, 3)) },
  });
  assert.equal(out.preview, '「赢」明天再见，「拾」3 天后再见，「尴」8 天后再见。');
  // 全部同一天：合并成一句
  const allRight = [cell('尴', 'judged', 'correct', 'r1'), cell('赢', 'judged', 'correct', 'r2'), cell('拾', 'judged', 'correct', 'r3')];
  const same = firstExtras({ cells: allRight, today: TODAY, sched: Object.fromEntries(['尴', '赢', '拾'].map(c => [`base:${c}`, sched(addDays(TODAY, 2))])) });
  assert.equal(same.preview, '2 天后再见。');
  // 看过答案 / 跳过的字没有调度：不进预告；一个可预告的都没有 → 没有预告句
  const noneJudged = [cell('尴', 'answer-seen', null, 'r1'), cell('赢', 'skipped', null, 'r2')];
  assert.deepEqual(firstExtras({ cells: noneJudged, today: TODAY, sched: {} }), { preview: '' });
});

test('firstExtras (C3-H / N3-01, D53 ④): the first-practice 复现句 starts with the 「拾」 sentence — written → 「你写下的第一个「拾」。」, missed → 「「拾」就是首页那个字。」 once; other variants never', () => {
  const cells = [cell('尴', 'judged', 'correct', 'r1'), cell('赢', 'judged', 'correct', 'r2'), cell('拾', 'judged', 'correct', 'r3')];
  const sch = Object.fromEntries(['尴', '赢', '拾'].map(c => [`base:${c}`, sched(addDays(TODAY, 2))]));
  const work = { cells: cells.map(c => ({ char: c.char })), empty: false };
  assert.equal(firstExtras({ cells, today: TODAY, sched: sch, work, variant: 'first' }).preview, '你写下的第一个「拾」。2 天后再见。', 'written: the same sentence as under the home cell, then the 复现句');
  // 拾写错、没进作品：说一次它就是首页那个字
  const wrongShi = [cell('尴', 'judged', 'correct', 'r1'), cell('赢', 'judged', 'correct', 'r2'), cell('拾', 'judged', 'wrong', 'r3')];
  const workNoShi = { cells: [{ char: '尴' }, { char: '赢' }], empty: false };
  assert.equal(firstExtras({ cells: wrongShi, today: TODAY, sched: sch, work: workNoShi, variant: 'first' }).preview, '「拾」就是首页那个字。2 天后再见。', 'missed: says once that it is the home-page char');
  // 全写错（work.empty）也一样
  const allWrong = [cell('尴', 'judged', 'wrong', 'r1'), cell('赢', 'judged', 'wrong', 'r2'), cell('拾', 'judged', 'wrong', 'r3')];
  assert.ok(firstExtras({ cells: allWrong, today: TODAY, sched: sch, work: { cells: [], empty: true }, variant: 'first' }).preview.startsWith('「拾」就是首页那个字。'), 'all wrong: still the home-page sentence');
  // 看过答案没有调度也说这句（没有 再见 句）
  const seen = [cell('尴', 'answer-seen', null, 'r1'), cell('拾', 'skipped', null, 'r3')];
  assert.equal(firstExtras({ cells: seen, today: TODAY, sched: {}, work: { cells: [], empty: true }, variant: 'first' }).preview, '「拾」就是首页那个字。');
  // 不是首练、或这一组里没有「拾」：不加
  assert.equal(firstExtras({ cells, today: TODAY, sched: sch, work, variant: 'daily' }).preview, '2 天后再见。', 'daily results never carry it');
  const noShi = [cell('尴', 'judged', 'correct', 'r1'), cell('赢', 'judged', 'correct', 'r2')];
  assert.equal(firstExtras({ cells: noShi, today: TODAY, sched: sch, work: { cells: [{ char: '尴' }, { char: '赢' }], empty: false }, variant: 'first' }).preview, '2 天后再见。', 'no 拾 in the group: nothing to say');
});

test('daysLaterOf: the result page cells → [{char, days, text}] for each judged char (the per-char data behind the 复现句, D48)', () => {
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

test('inviteExample: the first practice char, its word masked like the lock screen (＿ → drawn as an outlined box on the page), plus the pinyin; no word → no example', () => {
  setCardResolver(key => (key === 'base:尴' ? { chars: ['尴', '尬'], target: '尴', py: 'gān', word: '尴尬' } : key === 'base:无' ? { chars: ['无'], target: '无', py: '' } : undefined));
  try {
    assert.deepEqual(inviteExample({ queue: ['base:尴', 'base:赢'] }), { word: '＿尬', pinyin: 'gān', blanks: [true, false] });
    assert.equal(inviteExample({ queue: ['base:无'] }), null, 'no pinyin → no example');
    assert.equal(inviteExample({ queue: [] }), null);
    assert.equal(inviteExample(null), null);
  } finally {
    setCardResolver(null);
  }
});

test('HEI_ONLY_COPY: every registered key exists in copy (so it can be excluded from the Serif subset), and only these three kinds of text', () => {
  for (const key of HEI_ONLY_COPY) assert.ok(Object.prototype.hasOwnProperty.call(COPY, key), `${key} is a copy key`);
  assert.ok(HEI_ONLY_COPY.every(key => /^X-(FIRST|HOME|INVITE|WORK|ALL)\./.test(key)), 'only the P1-E5 / P1-E7 body texts');
});
