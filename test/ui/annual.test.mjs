// 年度报告数据模型单测（M4-2；04 R-M06；原型 ShiziScreen-第十稿交接版 L133–L144、逻辑 L494–L498）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annualModel, yearSlice, busiestMonth, rarestChar, firstOfYear, NO_RANK,
} from '../../src/ui/screens/mine/annual-model.js';
import { ANNUAL_SCREEN, countParts, firstLine, annualDateText } from '../../src/ui/screens/mine/annual.js';
import { getScreen } from '../../src/ui/router.js';
import { t } from '../../src/config/copy/index.js';

const TODAY = '2026-09-24';

let serial = 0;
function rec(c, day, { kind = 'judged', judgment = 'correct' } = {}) {
  serial += 1;
  const r = { id: `r${serial}`, cardKey: `base:${c}`, char: c, sessionId: 's1', kind, at: new Date(`${day}T08:00:00`).getTime() + serial,
    localDay: day, help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

function state(records, extra = {}) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, sessions: { A: null, B: null, lastEnded: {} }, ...extra };
}

const RANKS = { 的: 1, 一: 2, 静: 900, 谁: 300, 题: 450, 豕: 3100, 慢: 1200, 数: 280, 永: 1500, 和: 20 };
const cardOf = c => (c in RANKS ? { rank: RANKS[c], py: c === '豕' ? 'shǐ' : 'py-' + c } : null);

test('empty: no records / only answer-seen or skipped / only last year → empty; null state safe', () => {
  serial = 0;
  for (const s of [
    null,
    state([]),
    state([rec('户', TODAY, { kind: 'answer-seen' }), rec('虽', '2026-09-22', { kind: 'skipped' })]),
    state([rec('静', '2025-12-31'), rec('谁', '2025-06-01', { judgment: 'wrong' })]),
  ]) {
    const m = annualModel(s, TODAY, { cardOf });
    assert.equal(m.empty, true);
    assert.equal(m.year, 2026);
    assert.equal(m.count, 0);
    assert.equal(m.month, null);
    assert.equal(m.rare, null);
    assert.equal(m.first, null);
  }
});

test('section 1: distinct chars this year, correct and wrong both count, answer-seen / skipped / last year do not', () => {
  serial = 0;
  const s = state([
    rec('豕', '2025-12-30'),
    rec('静', '2026-01-03'), rec('静', '2026-02-10', { judgment: 'wrong' }), rec('谁', '2026-02-10', { judgment: 'wrong' }),
    rec('题', '2026-09-01'), rec('户', '2026-09-02', { kind: 'answer-seen' }), rec('虽', '2026-09-03', { kind: 'skipped' }),
  ]);
  const m = annualModel(s, TODAY, { cardOf });
  assert.equal(m.empty, false);
  assert.equal(m.count, 3);
  assert.deepEqual(m.chars, ['静', '谁', '题']);
  assert.equal(m.days, 3, 'days with a judged record this year');
});

test('section 2: month with the most record days; ties → later month; days not records', () => {
  serial = 0;
  // 3 月：3 天（同一天多条只算 1 天）；5 月：3 天；9 月：2 天 → 并列取 5 月。
  const s = state([
    rec('静', '2026-03-01'), rec('谁', '2026-03-01'), rec('题', '2026-03-01'), rec('数', '2026-03-02'), rec('慢', '2026-03-09'),
    rec('静', '2026-05-01'), rec('静', '2026-05-02'), rec('静', '2026-05-03', { judgment: 'wrong' }),
    rec('一', '2026-09-01'), rec('的', '2026-09-24'),
  ]);
  const m = annualModel(s, TODAY, { cardOf });
  assert.deepEqual(m.month, { month: '2026-05', monthNum: 5, days: 3 });
  assert.equal(t('R-M06.monthDays', { month: m.month.monthNum, n: m.month.days }), '5 月有记录 3 天');
  assert.deepEqual(busiestMonth(['2026-01-02', '2026-01-03', '2026-02-01']), { month: '2026-01', monthNum: 1, days: 2 });
  assert.equal(busiestMonth([]), null);
});

test('section 3: rarest = largest rank among this year\'s chars; unknown rank skipped; tie → first written; none → null', () => {
  serial = 0;
  const s = state([rec('豕', '2025-11-01'), rec('的', '2026-01-02'), rec('慢', '2026-02-02'), rec('怪', '2026-03-02'), rec('谁', '2026-04-02')]);
  const m = annualModel(s, TODAY, { cardOf });
  assert.deepEqual(m.rare, { char: '慢', py: 'py-慢', rank: 1200 }, '豕 is last year; 怪 has no rank');
  assert.deepEqual(rarestChar(['和', '豕'], cardOf), { char: '豕', py: 'shǐ', rank: 3100 });
  const tie = c => ({ rank: 500, py: c });
  assert.equal(rarestChar(['乙', '甲'], tie).char, '乙', 'tie → first in order');
  assert.equal(rarestChar(['怪', '奇'], cardOf), null);
  assert.equal(rarestChar(['怪'], () => ({ rank: NO_RANK, py: '' })), null, 'default rank 999999 means no frequency');
  const none = annualModel(state([rec('怪', '2026-03-02')]), TODAY, { cardOf });
  assert.equal(none.empty, false);
  assert.equal(none.rare, null, 'section 3 hidden when nothing has a frequency rank');
});

test('section 4: first judged record of the year (id order), not last year and not answer-seen', () => {
  serial = 0;
  const s = state([
    rec('豕', '2025-12-31'),
    rec('户', '2026-01-01', { kind: 'answer-seen' }),
    rec('静', '2026-01-02', { judgment: 'wrong' }), rec('谁', '2026-01-02'), rec('静', '2026-03-01'),
  ]);
  const m = annualModel(s, TODAY, { cardOf });
  assert.equal(m.first.char, '静');
  assert.equal(m.first.day, '2026-01-02');
  assert.equal(m.first.record.id, 'r3');
  assert.equal(m.first.record.judgment, 'wrong', 'wrong also counts');
});

test('folded months: byDay chars and days count; an earlier folded day is the first (record=null)', () => {
  serial = 0;
  const kept = rec('永', '2026-02-10');
  const s = state([rec('静', '2026-03-01'), rec('谁', '2026-03-02')]);
  s.records['2026-02'] = { folded: true, month: '2026-02', byDay: { '2026-02-03': ['和', '永'], '2026-02-10': ['永', '天'] },
    chars: ['和', '永', '天'], kept: [kept] };
  s.records['2025-12'] = { folded: true, month: '2025-12', byDay: { '2025-12-01': ['豕'] }, chars: ['豕'], kept: [] };
  const m = annualModel(s, TODAY, { cardOf });
  assert.equal(m.count, 5, '和 永 天 静 谁');
  assert.deepEqual(m.chars, ['和', '永', '天', '静', '谁']);
  assert.equal(m.days, 4);
  assert.deepEqual(m.month, { month: '2026-03', monthNum: 3, days: 2 }, '2 vs 2 → later month');
  assert.deepEqual(m.first, { char: '和', day: '2026-02-03', record: null });
  assert.equal(m.rare.char, '永');
  // 同一天、同一字：用 judged 记录（可能有笔迹）。
  const sl = yearSlice({ records: { '2026-02': { folded: true, month: '2026-02', byDay: { '2026-02-10': ['永'] }, chars: ['永'], kept: [kept] } } }, 2026);
  assert.equal(firstOfYear(sl).record, kept);
});

test('D42 section 4: the ink comes from the earliest of this year\'s records of that char that still has ink (date = that record\'s day); none this year → earliest record, no ink; last year\'s ink never stands in', () => {
  serial = 0;
  const INK = { s: ['AAAAAAAA'] };
  const rs = [rec('静', '2025-12-30'), rec('静', '2026-01-02'), rec('静', '2026-03-05'), rec('静', '2026-05-09'), rec('谁', '2026-01-03')];
  const base = { '2025-12': { r1: INK }, '2026-05': { r4: INK } };
  const m = annualModel(state(rs, { ink: base }), TODAY, { cardOf });
  assert.equal(m.first.char, '静');
  assert.equal(m.first.record.id, 'r4', '1-02 and 3-05 recycled → the 5-09 one');
  assert.equal(m.first.day, '2026-05-09', 'the date shown is the ink record\'s day');
  // 今年一份都没有（去年 12-30 那份不冒充）：最早那条、没有笔迹
  const none = annualModel(state(rs, { ink: { '2025-12': { r1: INK } } }), TODAY, { cardOf });
  assert.deepEqual([none.first.char, none.first.day, none.first.record.id], ['静', '2026-01-02', 'r2']);
  // 最早那条自己有墨：照旧
  const own = annualModel(state(rs, { ink: { '2026-01': { r2: INK } } }), TODAY, { cardOf });
  assert.deepEqual([own.first.day, own.first.record.id], ['2026-01-02', 'r2']);
  // 折叠月份里更早的日子只剩字：今年内 kept 里有墨的那次接上；都没有则 record=null
  const kept = rec('和', '2026-02-10');
  const s = state([rec('静', '2026-03-01')], { ink: { '2026-02': { [kept.id]: INK } } });
  s.records['2026-02'] = { folded: true, month: '2026-02', byDay: { '2026-02-03': ['和'], '2026-02-10': ['和'] }, chars: ['和'], kept: [kept] };
  const f = annualModel(s, TODAY, { cardOf });
  assert.deepEqual([f.first.char, f.first.day, f.first.record.id], ['和', '2026-02-10', kept.id]);
  s.ink = {};
  assert.deepEqual(annualModel(s, TODAY, { cardOf }).first, { char: '和', day: '2026-02-03', record: null });
  // 注入的 hasInk 优先
  assert.equal(annualModel(state(rs, { ink: base }), TODAY, { cardOf, hasInk: r => r.id === 'r3' }).first.record.id, 'r3');
});

test('year boundary: on 2027-01-01 the 2026 records do not count', () => {
  serial = 0;
  const s = state([rec('静', '2026-12-31'), rec('谁', '2027-01-01')]);
  const m26 = annualModel(s, '2026-12-31', { cardOf });
  assert.deepEqual([m26.year, m26.count, m26.first.char], [2026, 1, '静']);
  const m27 = annualModel(s, '2027-01-01', { cardOf });
  assert.deepEqual([m27.year, m27.count, m27.first.char, m27.month.month], [2027, 1, '谁', '2027-01']);
  assert.equal(annualModel(s, '2028-03-01', { cardOf }).empty, true);
});

test('300 chars: counts and speed', () => {
  serial = 0;
  const chars = [];
  for (let i = 0; i < 300; i += 1) chars.push(String.fromCharCode(0x4e00 + i));
  const rs = chars.map((c, i) => rec(c, `2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`));
  const s = state(rs);
  const ranks = c => ({ rank: c.charCodeAt(0) - 0x4e00 + 1, py: '' });
  const t0 = Date.now();
  const m = annualModel(s, TODAY, { cardOf: ranks });
  const ms = Date.now() - t0;
  assert.equal(m.count, 300);
  assert.equal(m.rare.char, chars[299]);
  assert.ok(ms < 200, `model under 200ms (${ms}ms)`);
});

test('view helpers: count split, first line with / without ink, date text; screen registered', () => {
  assert.deepEqual(countParts(12), { before: '', num: '12', after: ' 个字' });
  assert.equal(firstLine('2026-01-02', true), '1 月 2 日 · 你当时的笔迹');
  assert.equal(firstLine('2026-01-02', false), '1 月 2 日');
  assert.equal(annualDateText('bad'), '');
  assert.equal(ANNUAL_SCREEN, 'annual');
  assert.ok(getScreen('annual'), 'annual screen registered on import');
  assert.equal(t('X-ANNUAL.section2'), '二 · 有记录天数最多的月份');
});
