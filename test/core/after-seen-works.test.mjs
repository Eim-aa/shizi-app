// Q1（QA simB D1）：看后自写的字进作品出口（D31「写对与看后自己写的字」；实现交接 §4.2；D42 取段内留有墨迹的那一次）。
// 看过答案的记录只有留有看后自写的本人墨时才算；没写（无墨）的看过答案、跳过仍不进。纸上记录照旧不进（D47）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { rec } from './helpers.mjs';
import { dayMembers, imagePlan, monthCells, monthMembers, sessionWork } from '../../src/core/images/pick.js';
import { hasInkOfState } from '../../src/core/ink-pick.js';
import { annualModel, yearSlice } from '../../src/session/views/annual.js';
import { dayItems, monthSheet, recordIndex } from '../../src/session/views/mine.js';

const POINTS = [[{ x: 60, y: 170, w: 11.5 }, { x: 280, y: 172, w: 11.5 }]];
const STORED = { v: 3, c: 345, s: ['AAAAAAAA'] };

/** 记录按月放好；inked = 留有墨迹的记录 id（state.ink 按记录月份分键）。 */
function stateOf(records, inked, sessions = { A: null, B: null, lastEnded: {} }) {
  const months = {};
  const ink = {};
  for (const r of records) {
    const m = r.localDay.slice(0, 7);
    (months[m] || (months[m] = [])).push(r);
    if (inked.includes(r.id)) (ink[m] || (ink[m] = {}))[r.id] = STORED;
  }
  return { records: months, sessions, ink };
}

// 10-02：永 写对（r1，有墨）；和 看过答案并自己写（r2，有墨）；春 看过答案没写（r3，无墨）；大 跳过（r4）
// 10-05：和 写错（r5，墨已回收）；中 看过答案并自己写（r6，有墨）
function fixture() {
  const records = [
    rec(1, '永', 'judged', 'correct', '2026-10-02'),
    rec(2, '和', 'answer-seen', null, '2026-10-02'),
    rec(3, '春', 'answer-seen', null, '2026-10-02'),
    rec(4, '大', 'skipped', null, '2026-10-02'),
    rec(5, '和', 'judged', 'wrong', '2026-10-05', { sessionId: 's2' }),
    rec(6, '中', 'answer-seen', null, '2026-10-05', { sessionId: 's2' }),
  ];
  return stateOf(records, ['r1', 'r2', 'r6']);
}

test('Q1 pick: the day image takes after-seen chars with ink; seen-without-ink / skipped stay out', () => {
  const st = fixture();
  const has = hasInkOfState(st);
  assert.deepEqual(dayMembers(st, '2026-10-02', { hasInk: has }).members.map(m => [m.char, m.record.id]), [['永', 'r1'], ['和', 'r2']]);
  // 不给 hasInk 时按 state.ink 判断看后自写有没有墨
  assert.deepEqual(dayMembers(st, '2026-10-02').members.map(m => m.char), ['永', '和']);
  const plan = imagePlan(st, { kind: 'day', day: '2026-10-02' }, { inkOf: r => (has(r) ? POINTS : null), hasInk: has });
  assert.deepEqual(plan.cells.map(c => [c.ch, c.mode]), [['永', 'hand'], ['和', 'hand']]);
});

test('Q1 pick: the month sheet takes after-seen chars; D42 picks the record with ink inside the month (an after-seen one counts)', () => {
  const st = fixture();
  const has = hasInkOfState(st);
  const m = monthMembers(st, '2026-10', { hasInk: has });
  assert.deepEqual(m.members.map(x => [x.char, x.record.id]), [['永', 'r1'], ['和', 'r2'], ['中', 'r6']],
    '和: the first record with ink this month is the after-seen r2 (the later judged r5 lost its ink); 春 (seen, no ink) is not in');
  const cells = monthCells(st, '2026-10', { inkOf: r => (has(r) ? POINTS : null), hasInk: has });
  assert.deepEqual(cells.cells.map(c => [c.ch, c.mode]), [['永', 'hand'], ['和', 'hand'], ['中', 'hand']]);
  // 没有 hasInk 也同口径（年报 yearMonths 只问成员数）
  assert.equal(monthMembers(st, '2026-10').members.length, 3);
});

test('Q1 pick: the session image keeps the after-seen member with its ink (作品「看后写的」)', () => {
  const st = fixture();
  const A = { id: 's1', slot: 'A', kind: 'daily', queue: ['base:永', 'base:和', 'base:春', 'base:大'], cursor: 4,
    items: [{ cardKey: 'base:永', recordId: 'r1', kind: 'judged' }, { cardKey: 'base:和', recordId: 'r2', kind: 'answer-seen' },
      { cardKey: 'base:春', recordId: 'r3', kind: 'answer-seen' }, { cardKey: 'base:大', recordId: 'r4', kind: 'skipped' }] };
  st.sessions = { A: null, B: null, lastEnded: { A } };
  const has = hasInkOfState(st);
  const w = sessionWork(st, { sessionId: 's1', hasInk: has }).work;
  assert.deepEqual(w.cells.map(e => [e.char, e.tag]), [['永', ''], ['和', 'afterSeen']]);
  assert.deepEqual(w.rows.map(e => [e.char, e.state]), [['春', 'seen'], ['大', 'skipped']]);
  const plan = imagePlan(st, { kind: 'session', sessionId: 's1' }, { inkOf: r => (has(r) ? POINTS : null), hasInk: has });
  assert.deepEqual(plan.cells.map(c => [c.ch, c.mode]), [['永', 'hand'], ['和', 'hand']]);
  assert.deepEqual(plan.recordIds, ['r1', 'r2']);
});

test('Q1 mine: 月字帖 and the chars of a day include after-seen chars with ink', () => {
  const st = fixture();
  const index = recordIndex(st);
  const sheet = monthSheet(index, '2026-10');
  assert.deepEqual(sheet.cells.map(c => [c.char, c.record && c.record.id]), [['永', 'r1'], ['和', 'r2'], ['中', 'r6']]);
  assert.equal(sheet.chars, 3, 'month char count = cells');
  assert.deepEqual(dayItems(index, '2026-10-05').map(x => [x.char, x.record.id]), [['中', 'r6']], '和 on 10-05 is a wrong write: not a member (D51 ⑤), and nothing is borrowed from 10-02');
  assert.deepEqual(dayItems(index, '2026-10-02').map(x => x.char), ['永', '和']);
  // 日历「写过的日子」仍只看判断（看过答案不是有效记录，D18 / D23）
  assert.deepEqual([...index.days].sort(), ['2026-10-02', '2026-10-05']);
});

test('Q1 annual: 年字数 and month sections count after-seen chars with ink; the first char of the year is still the first judged one', () => {
  const st = stateOf([
    rec(1, '中', 'answer-seen', null, '2026-01-03'),
    rec(2, '永', 'judged', 'correct', '2026-01-05'),
    rec(3, '春', 'answer-seen', null, '2026-02-01'),
  ], ['r1', 'r2']);
  const slice = yearSlice(st, 2026);
  assert.deepEqual(slice.chars, ['中', '永'], '春 (seen, never written) is not counted');
  const model = annualModel(st, '2026-10-04');
  assert.equal(model.count, 2);
  assert.deepEqual(model.months.map(m => [m.month, m.n]), [['2026-01', 2]]);
  assert.equal(model.first.char, '永', '「这一年第一个有记录的字」stays the first judged char');
});
