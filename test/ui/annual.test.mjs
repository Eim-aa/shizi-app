// 年报数据模型单测（阶段 1 P1-E7，交接 §8；原 M4-2 / 04 R-M06）。
// 年报是一卷：卷首（年字数、今年第一个字）→ 每月一段 → 卷尾「同一个字，两次」；只有一个数；不出统计小节；纸上记录不进、不计字数（D46-13）；
// 册页 = 卷首 1 + 每月（超 80 字分张）+ 卷尾（有才出）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annualDefaultYear, annualModel, annualPlan, annualYears, firstOfYear, twiceOfYear, yearMonths, yearSlice,
} from '../../src/session/views/annual.js';
import * as annualModule from '../../src/session/views/annual.js';
import { ANNUAL_SCREEN, annualDateText, firstLine } from '../../src/ui/screens/mine/annual.js';
import { annualCoverLine, annualFirstDateText, annualYearText, kuan } from '../../src/ui/work-text.js';
import { getScreen } from '../../src/ui/router.js';
import { t } from '../../src/config/copy/index.js';

const TODAY = '2026-09-24';

let serial = 0;
function rec(c, day, { kind = 'judged', judgment = 'correct', source } = {}) {
  serial += 1;
  const r = { id: `r${serial}`, cardKey: `base:${c}`, char: c, sessionId: 's1', kind, at: new Date(`${day}T08:00:00`).getTime() + serial,
    localDay: day, help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  if (source) r.source = source;
  return r;
}

function state(records, extra = {}) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, sessions: { A: null, B: null, lastEnded: {} }, ...extra };
}

const INK = { s: ['AAAAAAAA'] };
const POINTS = [[{ x: 60, y: 170, w: 11.5 }, { x: 280, y: 172, w: 11.5 }]];

test('the statistics sections are gone: the model has one number (count) and no busiest month / rarest char', () => {
  const m = annualModel(state([rec('静', '2026-03-01')]), TODAY);
  assert.deepEqual(Object.keys(m).sort(), ['chars', 'count', 'days', 'empty', 'first', 'months', 'nextYear', 'prevYear', 'today', 'twice', 'year', 'years']);
  assert.equal(annualModule.busiestMonth, undefined);
  assert.equal(annualModule.rarestChar, undefined);
});

test('empty: no records / only answer-seen or skipped / only last year / only paper → empty; null state safe', () => {
  serial = 0;
  for (const s of [
    null,
    state([]),
    state([rec('户', TODAY, { kind: 'answer-seen' }), rec('虽', '2026-09-22', { kind: 'skipped' })]),
    state([rec('静', '2025-12-31'), rec('谁', '2025-06-01', { judgment: 'wrong' })]),
    state([rec('静', '2026-03-01', { source: 'paper' })]),
  ]) {
    const m = annualModel(s, TODAY);
    assert.equal(m.empty, true);
    assert.equal(m.year, 2026);
    assert.equal(m.count, 0);
    assert.equal(m.first, null);
    assert.deepEqual(m.months, []);
    assert.equal(m.twice, null);
  }
});

test('the year count: distinct work chars this year (right ones; a wrong-only char does not count, D51 ⑤); answer-seen / skipped / last year / 纸上 do not (D46-13)', () => {
  serial = 0;
  const s = state([
    rec('豕', '2025-12-30'),
    rec('静', '2026-01-03'), rec('静', '2026-02-10', { judgment: 'wrong' }), rec('谁', '2026-02-10', { judgment: 'wrong' }),
    rec('题', '2026-09-01'), rec('户', '2026-09-02', { kind: 'answer-seen' }), rec('虽', '2026-09-03', { kind: 'skipped' }),
    rec('纸', '2026-09-04', { source: 'paper' }),
  ]);
  const m = annualModel(s, TODAY);
  assert.equal(m.empty, false);
  assert.equal(m.count, 2);
  assert.deepEqual(m.chars, ['静', '题'], '谁 was only ever written wrong this year');
  assert.equal(m.days, 2, 'days with a work record this year: the wrong-only day and the paper day are not counted');
});

test('months: one section per month that has chars, ascending; the count is the month sheet size (chars with no ink included)', () => {
  serial = 0;
  const s = state([
    rec('静', '2026-04-26'), rec('谁', '2026-04-26'), rec('题', '2026-04-27'),
    rec('数', '2026-09-02'), rec('慢', '2026-09-02', { source: 'paper' }),
  ]);
  const m = annualModel(s, TODAY);
  assert.deepEqual(m.months, [{ month: '2026-04', monthNum: 4, n: 3 }, { month: '2026-09', monthNum: 9, n: 1 }], 'the paper char is not in September');
  assert.deepEqual(yearMonths(s, yearSlice(s, 2026)), m.months);
  // 折叠月：byDay 的字也是一个月的格
  const f = state([rec('静', '2026-03-01')]);
  f.records['2026-02'] = { folded: true, month: '2026-02', byDay: { '2026-02-03': ['和', '永'], '2026-02-10': ['永', '天'] }, chars: ['和', '永', '天'], kept: [] };
  assert.deepEqual(annualModel(f, TODAY).months.map(x => [x.month, x.n]), [['2026-02', 3], ['2026-03', 1]]);
});

test('first of the year: first work record of the year (id order), not last year, not answer-seen, not a wrong write (D51 ⑤)', () => {
  serial = 0;
  const s = state([
    rec('豕', '2025-12-31'),
    rec('户', '2026-01-01', { kind: 'answer-seen' }),
    rec('静', '2026-01-02', { judgment: 'wrong' }), rec('谁', '2026-01-02'), rec('静', '2026-03-01'),
  ]);
  const m = annualModel(s, TODAY);
  assert.equal(m.first.char, '谁', '静 was first written wrong on 01-02: that is not a work record');
  assert.equal(m.first.day, '2026-01-02');
  assert.equal(m.first.record.id, 'r4');
  assert.equal(m.first.record.judgment, 'correct');
});

test('folded months: byDay chars and days count; an earlier folded day is the first (record=null)', () => {
  serial = 0;
  const kept = rec('永', '2026-02-10');
  const s = state([rec('静', '2026-03-01'), rec('谁', '2026-03-02')]);
  s.records['2026-02'] = { folded: true, month: '2026-02', byDay: { '2026-02-03': ['和', '永'], '2026-02-10': ['永', '天'] },
    chars: ['和', '永', '天'], kept: [kept] };
  s.records['2025-12'] = { folded: true, month: '2025-12', byDay: { '2025-12-01': ['豕'] }, chars: ['豕'], kept: [] };
  const m = annualModel(s, TODAY);
  assert.equal(m.count, 5, '和 永 天 静 谁');
  assert.deepEqual(m.chars, ['和', '永', '天', '静', '谁']);
  assert.equal(m.days, 4);
  assert.deepEqual(m.first, { char: '和', day: '2026-02-03', record: null });
  const sl = yearSlice({ records: { '2026-02': { folded: true, month: '2026-02', byDay: { '2026-02-10': ['永'] }, chars: ['永'], kept: [kept] } } }, 2026);
  assert.equal(firstOfYear(sl).record, kept);
});

test('D42 first of the year: the ink comes from the earliest of this year\'s records of that char that still has ink (date = that record\'s day); none this year → earliest record; last year\'s ink never stands in', () => {
  serial = 0;
  const rs = [rec('静', '2025-12-30'), rec('静', '2026-01-02'), rec('静', '2026-03-05'), rec('静', '2026-05-09'), rec('谁', '2026-01-03')];
  const base = { '2025-12': { r1: INK }, '2026-05': { r4: INK } };
  const m = annualModel(state(rs, { ink: base }), TODAY);
  assert.equal(m.first.char, '静');
  assert.equal(m.first.record.id, 'r4', '1-02 and 3-05 recycled → the 5-09 one');
  assert.equal(m.first.day, '2026-05-09', 'the date shown is the ink record\'s day');
  const none = annualModel(state(rs, { ink: { '2025-12': { r1: INK } } }), TODAY);
  assert.deepEqual([none.first.char, none.first.day, none.first.record.id], ['静', '2026-01-02', 'r2']);
  const own = annualModel(state(rs, { ink: { '2026-01': { r2: INK } } }), TODAY);
  assert.deepEqual([own.first.day, own.first.record.id], ['2026-01-02', 'r2']);
  const kept = rec('和', '2026-02-10');
  const s = state([rec('静', '2026-03-01')], { ink: { '2026-02': { [kept.id]: INK } } });
  s.records['2026-02'] = { folded: true, month: '2026-02', byDay: { '2026-02-03': ['和'], '2026-02-10': ['和'] }, chars: ['和'], kept: [kept] };
  const f = annualModel(s, TODAY);
  assert.deepEqual([f.first.char, f.first.day, f.first.record.id], ['和', '2026-02-10', kept.id]);
  s.ink = {};
  assert.deepEqual(annualModel(s, TODAY).first, { char: '和', day: '2026-02-03', record: null });
  assert.equal(annualModel(state(rs, { ink: base }), TODAY, { hasInk: r => r.id === 'r3' }).first.record.id, 'r3');
});

test('卷尾「同一个字，两次」(P161): a char with two inked records this year, the pair furthest apart; ties → written first; none → no tail', () => {
  serial = 0;
  const rs = [
    rec('疆', '2026-04-27'), rec('酱', '2026-04-27'), rec('酱', '2026-05-30'), rec('疆', '2026-10-02'), rec('永', '2026-06-01'), rec('永', '2026-06-01'),
  ];
  const inkAll = { '2026-04': { r1: INK, r2: INK }, '2026-05': { r3: INK }, '2026-10': { r4: INK }, '2026-06': { r5: INK, r6: INK } };
  const sl = yearSlice(state(rs, { ink: inkAll }), 2026);
  const twice = twiceOfYear(sl);
  assert.equal(twice.char, '疆');
  assert.deepEqual([twice.first.record.id, twice.first.day, twice.last.record.id, twice.last.day], ['r1', '2026-04-27', 'r4', '2026-10-02']);
  assert.equal(twice.gap, 158);
  // 酱 只有 36 天；永 同一天两条不算（要相隔 ≥ 1 天）
  // 墨迹被回收到只剩一份 → 没有卷尾
  assert.equal(twiceOfYear(yearSlice(state(rs, { ink: { '2026-04': { r1: INK } } }), 2026)), null);
  // 去年的那份不冒充
  const lastYear = [rec('疆', '2025-04-27'), rec('疆', '2026-04-27')];
  assert.equal(twiceOfYear(yearSlice(state(lastYear, { ink: { '2025-04': { r1: INK }, '2026-04': { r2: INK } } }), 2026)), null);
  // 并列取今年先写到的
  const tie = [rec('甲', '2026-01-01'), rec('乙', '2026-01-01'), rec('乙', '2026-01-11'), rec('甲', '2026-01-11')];
  const tt = twiceOfYear(yearSlice(state(tie, { ink: { '2026-01': Object.fromEntries(tie.map(r => [r.id, INK])) } }), 2026));
  assert.equal(tt.char, '甲');
});

test('year boundary: on 2027-01-01 the 2026 records do not count', () => {
  serial = 0;
  const s = state([rec('静', '2026-12-31'), rec('谁', '2027-01-01')]);
  const m26 = annualModel(s, '2026-12-31');
  assert.deepEqual([m26.year, m26.count, m26.first.char], [2026, 1, '静']);
  const m27 = annualModel(s, '2027-01-01');
  assert.deepEqual([m27.year, m27.count, m27.first.char, m27.months[0].month], [2027, 1, '谁', '2027-01']);
  assert.equal(annualModel(s, '2028-03-01').empty, true);
});

test('300 chars: counts and speed', () => {
  serial = 0;
  const chars = [];
  for (let i = 0; i < 300; i += 1) chars.push(String.fromCharCode(0x4e00 + i));
  const rs = chars.map((c, i) => rec(c, `2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`));
  const s = state(rs);
  const t0 = Date.now();
  const m = annualModel(s, TODAY);
  const ms = Date.now() - t0;
  assert.equal(m.count, 300);
  assert.equal(m.months.reduce((n, x) => n + x.n, 0), 300);
  assert.ok(ms < 300, `model under 300ms (${ms}ms)`);
});

// ---------------------------------------------------------------- 册页张数（§8.2）

function planOf(records, extra = {}) {
  return annualPlan(state(records, extra), { today: '2026-10-04', inkOf: r => (extra.noInk ? null : POINTS), hasInk: r => !extra.noInk });
}

test('album pages: 1 cover + every month (a month over 80 chars is split by date, D39) + 1 tail (only if there is one)', () => {
  serial = 0;
  const rs = [rec('疆', '2026-04-27'), rec('酱', '2026-04-27')];
  // 九月 96 字（同一天 96 个字 → 80 + 16）
  for (let i = 0; i < 96; i += 1) rs.push(rec(String.fromCodePoint(0x4e00 + i), '2026-09-10'));
  rs.push(rec('疆', '2026-10-02'));
  const plan = planOf(rs);
  assert.equal(plan.status, 'ready');
  const kinds = plan.pages.map(p => (p.type === 'month' ? `${p.month}#${p.part}/${p.of}:${p.cells.length}` : p.type));
  assert.deepEqual(kinds, ['cover', '2026-04#1/1:2', '2026-09#1/2:80', '2026-09#2/2:16', '2026-10#1/1:1', 'tail']);
  assert.equal(plan.pages.length, 6);
  assert.ok(plan.pages.filter(p => p.type === 'month').every(p => p.cells.length <= 80));
  assert.equal(plan.tail.first.ch, '疆');
  assert.equal(plan.first.ch, '疆', 'the cover shows the first char of the year');
  // 页内日期角标：分出来的新页第一个字一定带角标
  assert.equal(plan.pages[3].cells[0].tag, '10');
  // 没有卷尾：每个字这一年只有一份墨迹
  const noTail = planOf([rec('疆', '2026-04-27'), rec('酱', '2026-05-01')]);
  assert.deepEqual(noTail.pages.map(p => p.type), ['cover', 'month', 'month']);
  assert.equal(noTail.tail, null);
  // 空
  assert.equal(planOf([]).status, 'empty');
  assert.deepEqual(planOf([]).pages, []);
});

test('album pages: a month with no ink is all under cells (still a page, still counted); the cover cell is under when the year has no ink for the first char', () => {
  serial = 0;
  const plan = planOf([rec('静', '2026-03-01'), rec('谁', '2026-03-02')], { noInk: true });
  assert.deepEqual(plan.pages.map(p => p.type), ['cover', 'month']);
  assert.ok(plan.pages[1].cells.every(c => c.mode === 'under'));
  assert.equal(plan.first.mode, 'under');
});

// ---------------------------------------------------------------- 视图小件

test('view helpers: first line with / without ink, date text, 纸面汉字文案；screen registered', () => {
  assert.equal(firstLine('2026-01-02', true), '1月2日的笔迹');
  assert.equal(firstLine('2026-01-02', false), '1月2日');
  assert.equal(annualDateText('bad'), '');
  assert.equal(ANNUAL_SCREEN, 'annual');
  assert.ok(getScreen('annual'), 'annual screen registered on import');
  assert.equal(annualYearText(2026), '二〇二六');
  assert.equal(annualCoverLine(290), '这一年，你拾回两百九十个字。');
  assert.equal(annualCoverLine(2), '这一年，你拾回两个字。');
  assert.equal(annualCoverLine(218), '这一年，你拾回两百一十八个字。', 'N2-14: the page head and the album cover are one sentence, Chinese numerals');
  assert.equal(annualFirstDateText('2026-04-26'), '四月二十六日的笔迹');
  assert.equal(kuan({ month: '2026-10' }), '二〇二六年十月');
  assert.throws(() => t('X-WORK.annualHead', { n: 290 }), /unknown copy key/, 'N2-14: no separate Arabic-numeral head any more');
});

test('D45: the first-char date line reads 「{date}的笔迹」 and never says it is the first time this year', () => {
  const slot = t('R-M06.inkDate', { date: '3月9日' });
  assert.equal(slot, '3月9日的笔迹');
  assert.ok(!/第一次|当时|首次/.test(slot), 'the date is the day of the ink record, not 今年第一次');
  assert.equal(firstLine('2026-03-09', true), '3月9日的笔迹');
  assert.equal(firstLine('2026-03-09', false), '3月9日');
});

test('D66 ⑪ past years: annualYears lists years with records; default year falls back to the latest one; year option views a past year', () => {
  serial = 0;
  const s = state([rec('静', '2024-05-01'), rec('谁', '2025-12-31'), rec('户', '2025-06-01', { judgment: 'wrong' }), rec('虽', '2025-07-01', { kind: 'answer-seen' })]);
  assert.deepEqual(annualYears(s), [2024, 2025], 'wrong-but-not-added / answer-seen only do not count; judged correct do');
  assert.equal(annualDefaultYear(s, TODAY), 2025, 'nothing in 2026 → most recent year with records');
  assert.equal(annualDefaultYear(state([rec('静', '2026-01-02'), rec('谁', '2025-12-31')]), TODAY), 2026, 'this year has records → this year');
  assert.equal(annualDefaultYear(null, TODAY), 2026, 'no records at all → this year (empty state)');
  assert.equal(annualDefaultYear(state([rec('静', '2027-02-01')]), TODAY), 2027, 'only future years (clock rewound) → that year');
  const past = annualModel(s, TODAY, { year: 2025 });
  assert.equal(past.empty, false);
  assert.equal(past.year, 2025);
  assert.equal(past.count, 1);
  assert.deepEqual([past.prevYear, past.nextYear, past.years], [2024, null, [2024, 2025]]);
  const old = annualModel(s, TODAY, { year: 2024 });
  assert.deepEqual([old.prevYear, old.nextYear, old.first.char], [null, 2025, '静']);
  assert.equal(annualModel(s, TODAY).empty, true, 'default (today) year is still empty');
  const plan = annualPlan(s, { today: TODAY, inkOf: () => null, year: 2025 });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.model.year, 2025);
});

test('D66 ⑪ a single year of records has no previous / next year (nothing to switch)', () => {
  serial = 0;
  const m = annualModel(state([rec('静', '2026-03-01')]), TODAY);
  assert.deepEqual([m.years, m.prevYear, m.nextYear], [[2026], null, null]);
});
