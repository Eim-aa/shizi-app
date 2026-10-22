// 纸上记录不进作品（阶段 1 P1-E78；D46 ⑬ / D47；实现交接 §4.2 / §5 / §10.2）。
// 凡是画「本人笔迹」的地方都没有它：图片成员（这次 / 这天 / 月字帖 / 单字）、结果页作品、月字帖、年报、年字数与月字数；
// 日历「写过的日子」不过滤（纸上那天仍算写过）。折叠月份记下 paperOnly，折叠后年报 / 月字数仍不计只在纸上写过的字。
import test from 'node:test';
import assert from 'node:assert/strict';
import { at, rec } from './helpers.mjs';
import { dayMembers, glyphMember, imagePlan, monthCells, monthMembers, sessionWork } from '../../src/core/images/pick.js';
import { foldWorkByDay, isWorkRecord, withoutPaper } from '../../src/core/records.js';
import { validateRecordsMonth } from '../../src/core/schema.js';
import { recover } from '../../src/store/budget.js';
import { annualModel, annualPlan, yearMonths, yearSlice } from '../../src/session/views/annual.js';
import { calendarModel, dayItems, mineModel, monthSheet, recordIndex, overviewModel, recordsModel } from '../../src/session/views/mine.js';

const INK = [[{ x: 60, y: 170, w: 11.5 }, { x: 280, y: 172, w: 11.5 }]];
const inkOf = r => (r.source === 'paper' ? null : INK);
const paper = r => ({ ...r, source: 'paper' });

function stateOf(records, sessions = { A: null, B: null, lastEnded: {} }) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, sessions, ink: {} };
}

test('isWorkRecord / withoutPaper: judged and not on paper', () => {
  assert.equal(isWorkRecord(rec(1, '永', 'judged', 'correct', '2026-09-02')), true);
  assert.equal(isWorkRecord(paper(rec(1, '永', 'judged', 'correct', '2026-09-02'))), false);
  assert.equal(isWorkRecord(rec(1, '永', 'skipped', null, '2026-09-02')), false);
  assert.equal(isWorkRecord(rec(1, '永', 'answer-seen', null, '2026-09-02')), false);
  assert.equal(isWorkRecord(null), false);
  assert.deepEqual(withoutPaper([rec(1, '永', 'judged', 'correct', '2026-09-02'), paper(rec(2, '和', 'judged', 'correct', '2026-09-02'))]).map(r => r.id), ['r1']);
});

// ---------------------------------------------------------------- core/images/pick.js

test('pick: a char written only on paper is not a member of day / month / glyph; with a screen record too, the screen record is the member (D42 fallback must not pick the paper one)', () => {
  const recs = [
    rec(1, '永', 'judged', 'correct', '2026-09-02'),
    paper(rec(2, '纸', 'judged', 'correct', '2026-09-02')),
    // 和：屏幕上写过但没留墨（段内全无墨 → 兜底取偏好方向上那条）、之后又在纸上写过：兜底必须落在屏幕那条，不能是纸上那条
    rec(3, '和', 'judged', 'correct', '2026-09-03'),
    paper(rec(4, '和', 'judged', 'correct', '2026-09-04')),
  ];
  const st = stateOf(recs);
  const noInk = () => false;
  assert.deepEqual(dayMembers(st, '2026-09-02', { hasInk: noInk }).members.map(m => m.char), ['永'], 'day: the paper-only char is not in');
  assert.deepEqual(dayMembers(st, '2026-09-04', { hasInk: noInk }).members, [], 'a paper-only day has no members');
  const month = monthMembers(st, '2026-09', { hasInk: noInk });
  assert.deepEqual(month.members.map(m => [m.char, m.record.id]), [['永', 'r1'], ['和', 'r3']], 'month: 纸 not in; 和 fallback is its screen record r3');
  assert.deepEqual(month.members.map(m => m.record.source), [undefined, undefined]);
  assert.equal(month.days, 2, 'month days count work days only (the calendar uses recordIndex instead)');
  const cells = monthCells(st, '2026-09', { inkOf });
  assert.deepEqual(cells.cells.map(c => [c.ch, c.mode]), [['永', 'hand'], ['和', 'hand']], 'inkOf is only asked for work records');
  assert.equal(glyphMember(st, '纸'), null, 'glyph: only on paper → no member');
  assert.equal(glyphMember(st, '和').record.id, 'r3', 'glyph: the latest record is on paper → the latest screen record, the paper one takes no place');
  assert.equal(glyphMember(st, '和').firstDay, '2026-09-03');
});

test('pick: image plans — day / month / glyph exclude paper; the glyph of a paper-only char is empty', () => {
  const st = stateOf([
    rec(1, '永', 'judged', 'correct', '2026-09-02'),
    paper(rec(2, '纸', 'judged', 'correct', '2026-09-02')),
    paper(rec(3, '永', 'judged', 'wrong', '2026-09-05')),
  ]);
  const day = imagePlan(st, { kind: 'day', day: '2026-09-02' }, { inkOf });
  assert.deepEqual(day.cells.map(c => c.ch), ['永']);
  assert.deepEqual(day.missing, [], 'the paper char is not even listed as missing');
  const dayPaper = imagePlan(st, { kind: 'day', day: '2026-09-05' }, { inkOf });
  assert.equal(dayPaper.status, 'empty');
  const month = imagePlan(st, { kind: 'month', month: '2026-09' }, { inkOf });
  assert.deepEqual(month.cells.map(c => c.ch), ['永']);
  assert.equal(month.n, 1);
  assert.equal(imagePlan(st, { kind: 'glyph', char: '纸' }, { inkOf }).status, 'noInk');
  const g = imagePlan(st, { kind: 'glyph', char: '永' }, { inkOf });
  assert.equal(g.status, 'ready');
  assert.equal(g.drawn[0].record.id, 'r1', 'the glyph image uses the latest screen record, not the later paper one');
});

test('pick: session work — the paper char is not in the work, shows as a paper row with no 「放进去」; all on paper → the no-ink variant', () => {
  const rs = [
    { ...rec(1, '疆', 'judged', 'correct', '2026-10-05'), sessionId: 's9' },
    { ...paper(rec(2, '酱', 'judged', 'wrong', '2026-10-05')), sessionId: 's9' },
    { ...paper(rec(3, '痒', 'judged', 'correct', '2026-10-05')), sessionId: 's9' },
  ];
  const items = rs.map(r => ({ cardKey: r.cardKey, recordId: r.id, kind: r.kind }));
  const session = { id: 's9', kind: 'daily', items, endedAt: at('2026-10-05', 21), startedDay: '2026-10-05', added: ['r2'] };
  const st = stateOf(rs, { A: null, B: null, lastEnded: { A: session } });
  const { work } = sessionWork(st, { slot: 'A', sessionId: 's9', hasInk: () => true });
  assert.deepEqual(work.cells.map(c => c.char), ['疆']);
  assert.deepEqual(work.rows.filter(r => r.state !== 'in').map(r => [r.char, r.state, r.judgment]), [['酱', 'paper', 'wrong'], ['痒', 'paper', 'correct']]);
  assert.deepEqual(work.addable, [], 'no 「放进去」, even when its id is in session.added');
  const plan = imagePlan(st, { kind: 'session', slot: 'A', sessionId: 's9' }, { inkOf: () => INK });
  assert.deepEqual(plan.cells.map(c => c.ch), ['疆'], 'the share image has the screen char only');
  assert.deepEqual(plan.work.cells.map(c => c.dot), [false]);
  const allPaper = stateOf(rs.map(paper), { A: null, B: null, lastEnded: { A: session } });
  const w2 = sessionWork(allPaper, { slot: 'A', sessionId: 's9', hasInk: () => true }).work;
  assert.equal(w2.empty, true, 'all on paper → the no-ink variant (under row, share hidden)');
  assert.deepEqual(w2.entries.map(e => e.state), ['paper', 'paper', 'paper']);
  assert.equal(imagePlan(allPaper, { kind: 'session', slot: 'A', sessionId: 's9' }, { inkOf: () => INK }).status, 'empty');
});

// ---------------------------------------------------------------- 年报与月字数

function mixedYear() {
  return [
    paper(rec(0, '先', 'judged', 'correct', '2026-01-02')), // 今年最早，但只在纸上 → 不是「今年第一个字」
    rec(1, '永', 'judged', 'correct', '2026-03-02'),
    rec(2, '和', 'judged', 'correct', '2026-03-02'),
    paper(rec(3, '纸', 'judged', 'correct', '2026-03-03')), // 只在纸上写过 → 不计
    paper(rec(4, '和', 'judged', 'wrong', '2026-03-04')), // 和 屏幕上也写过 → 仍是 1 个字
    rec(5, '山', 'judged', 'correct', '2026-09-02'),
    paper(rec(6, '笔', 'judged', 'wrong', '2026-09-05')),
  ];
}

test('annual: year count, first char of the year and each month\'s 「{n} 字」 skip paper-only chars (D47)', () => {
  const st = stateOf(mixedYear());
  const m = annualModel(st, '2026-09-24', { hasInk: () => true });
  assert.equal(m.count, 3, '永 和 山 — 先 纸 笔 are paper-only');
  assert.deepEqual(m.chars, ['永', '和', '山']);
  assert.equal(m.first.char, '永', 'the earliest record this year is on paper → the first char is the earliest work record');
  assert.equal(m.first.day, '2026-03-02');
  assert.deepEqual(m.months, [{ month: '2026-03', monthNum: 3, n: 2 }, { month: '2026-09', monthNum: 9, n: 1 }]);
  assert.equal(m.days, 2, 'days with work this year');
  const plan = annualPlan(st, { today: '2026-09-24', inkOf: r => (r.source === 'paper' ? null : INK), hasInk: r => r.source !== 'paper' });
  assert.deepEqual(plan.months.map(x => x.cells.map(c => c.ch).join('')), ['永和', '山'], 'the month pages of the annual have no paper chars');
  // 只在纸上写过的月份不出一段
  const onlyPaper = annualModel(stateOf([rec(1, '永', 'judged', 'correct', '2026-03-02'), paper(rec(2, '纸', 'judged', 'correct', '2026-05-02'))]), '2026-09-24');
  assert.deepEqual(onlyPaper.months.map(x => x.month), ['2026-03']);
  assert.equal(onlyPaper.count, 1);
});

test('mine sheet / day list / month count: monthSheet and dayItems skip paper; the signature days and the calendar do not (a paper day still counts as written)', () => {
  const st = stateOf(mixedYear());
  const index = recordIndex(st);
  const sheet = monthSheet(index, '2026-03', { hasInk: () => true });
  assert.deepEqual(sheet.cells.map(c => c.char), ['永', '和'], 'the home / records month sheet: no 纸');
  assert.equal(sheet.chars, 2, 'the character count does not count 纸');
  assert.equal(sheet.days, 3, 'days written in March: 3-02, 3-03 (paper), 3-04 (paper) — the signature counts days the way the calendar does');
  assert.deepEqual(dayItems(index, '2026-03-03').map(x => x.char), [], 'a paper-only day has no chars to list');
  assert.deepEqual(dayItems(index, '2026-03-04').map(x => x.char), [], '和 on paper that day: the screen record is on another day');
  assert.deepEqual(dayItems(index, '2026-03-02').map(x => x.char), ['永', '和']);
  // 日历 / 概览天数：不过滤
  const cal = calendarModel(index, '2026-03', '2026-09-24').filter(c => c.day);
  assert.deepEqual(cal.filter(c => c.has).map(c => c.day), ['2026-03-02', '2026-03-03', '2026-03-04'], 'calendar: the paper days still show a dot');
  const ov = overviewModel(stateOf([paper(rec(1, '纸', 'judged', 'correct', '2026-09-24'))]), '2026-09-24');
  assert.deepEqual([ov.streak, ov.total], [1, 1], 'overview: a paper-only day still counts as a practice day');
  const rm = recordsModel(st, '2026-09-24', { month: '2026-03', day: '2026-03-03', hasInk: () => true });
  assert.equal(rm.recordDays, 3, 'records model: written days include the paper days');
  assert.deepEqual(rm.selected.items, [], 'the selected paper-only day exists but has no items');
  assert.equal(rm.todayRow, null);
  const mm = mineModel(stateOf([paper(rec(1, '纸', 'judged', 'correct', '2026-09-24'))]), '2026-09-24', { hasInk: () => true });
  assert.equal(mm.empty, false, 'only paper this month: not an empty 我的 (it was written)');
  assert.equal(mm.sheetOn, false, 'but no sheet block: there is nothing to put in it');
});

// ---------------------------------------------------------------- 折叠月份

function foldFixture() {
  return {
    records: {
      '2026-03': [
        rec(1, '永', 'judged', 'correct', '2026-03-02'),
        rec(2, '和', 'judged', 'correct', '2026-03-02'),
        paper(rec(3, '纸', 'judged', 'correct', '2026-03-03')),
        paper(rec(4, '和', 'judged', 'wrong', '2026-03-04')),
        paper(rec(5, '永', 'judged', 'wrong', '2026-03-02')), // 永 当天屏幕上也写过 → 不记 paperOnly
      ],
      '2026-10': [rec(6, '山', 'judged', 'correct', '2026-10-02')],
    },
    ink: {},
  };
}
const NOW = new Date(2026, 9, 2, 10).getTime();

test('fold: foldMonth records paperOnly — (day, char) pairs written only on paper — and nothing when there are none; the shape validates', () => {
  const draft = foldFixture();
  recover(draft, { now: NOW, budgets: { recordsBudgetBytes: 10 } });
  const march = draft.records['2026-03'];
  assert.equal(march.folded, true);
  assert.deepEqual(march.byDay, { '2026-03-02': ['永', '和'], '2026-03-03': ['纸'], '2026-03-04': ['和'] }, 'byDay keeps every written day (calendar)');
  assert.deepEqual(march.paperOnly, { '2026-03-03': ['纸'], '2026-03-04': ['和'] }, 'only-on-paper pairs: 纸 on 3-03; 和 on 3-04 (its screen record is on 3-02); 永 is not (screen the same day)');
  assert.equal(validateRecordsMonth(march, '2026-03'), null);
  assert.deepEqual(foldWorkByDay(march), { '2026-03-02': ['永', '和'] });
  // 没有纸上记录的月份不带这个字段（旧数据形状不变）
  const plain = { records: { '2026-03': [rec(1, '永', 'judged', 'correct', '2026-03-02')], '2026-10': [rec(2, '山', 'judged', 'correct', '2026-10-02')] }, ink: {} };
  recover(plain, { now: NOW, budgets: { recordsBudgetBytes: 10 } });
  assert.equal('paperOnly' in plain.records['2026-03'], false);
  assert.deepEqual(foldWorkByDay({ byDay: { '2026-03-02': ['永'] } }), { '2026-03-02': ['永'] }, 'no paperOnly (older folds) = byDay');
  assert.deepEqual(foldWorkByDay(null), {});
});

test('fold: a folded month — annual year count / month count / month members skip paper-only chars; the calendar days keep them', () => {
  const draft = foldFixture();
  recover(draft, { now: NOW, budgets: { recordsBudgetBytes: 10 } });
  const st = { ...draft, sessions: { A: null, B: null, lastEnded: {} } };
  const m = annualModel(st, '2026-10-05', { hasInk: () => false });
  assert.deepEqual(m.chars, ['永', '和', '山'], '纸 (only on paper in a folded month) is not counted');
  assert.equal(m.count, 3);
  assert.deepEqual(m.months.map(x => [x.month, x.n]), [['2026-03', 2], ['2026-10', 1]]);
  assert.equal(m.days, 2, 'year days: work days only (3-02 and 10-02)');
  assert.deepEqual(monthMembers(st, '2026-03').members.map(x => x.char), ['永', '和']);
  assert.equal(monthMembers(st, '2026-03').days, 1);
  const slice = yearSlice(st, 2026);
  assert.deepEqual(slice.days, ['2026-03-02', '2026-10-02']);
  assert.deepEqual(yearMonths(st, slice).map(x => x.month), ['2026-03', '2026-10']);
  // 日历 / 记录页：纸上那几天仍是写过的日子；月字帖没有 纸
  const index = recordIndex(st);
  assert.deepEqual([...index.days].filter(d => d.startsWith('2026-03')).sort(), ['2026-03-02', '2026-03-03', '2026-03-04']);
  assert.deepEqual(monthSheet(index, '2026-03', { hasInk: () => false }).cells.map(c => c.char), ['永', '和']);
  assert.deepEqual(dayItems(index, '2026-03-03'), []);
  assert.deepEqual(dayItems(index, '2026-03-02').map(x => x.char), ['永', '和']);
});

test('fold: a month folded with paper-only chars only gives no month section and no count', () => {
  const draft = {
    records: { '2026-03': [paper(rec(1, '纸', 'judged', 'correct', '2026-03-03'))], '2026-10': [rec(2, '山', 'judged', 'correct', '2026-10-02')] },
    ink: {},
  };
  recover(draft, { now: NOW, budgets: { recordsBudgetBytes: 10 } });
  const st = { ...draft, sessions: { A: null, B: null, lastEnded: {} } };
  const m = annualModel(st, '2026-10-05');
  assert.deepEqual(m.chars, ['山']);
  assert.deepEqual(m.months.map(x => x.month), ['2026-10']);
  assert.ok(recordIndex(st).days.has('2026-03-03'), 'the calendar still has the paper day');
});
