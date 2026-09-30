import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDay,
  isValidMonth,
  localDay,
  parseDay,
  dayStartMs,
  addDays,
  diffDays,
  monthOf,
  addMonths,
  dayOfYear,
  periodOfHour,
  periodOf,
  PERIODS,
  monthDayParts,
  cnDigits,
  cnNumber,
  signatureDateParts,
  signatureMonthParts,
} from '../../src/core/dates.js';
import { t } from '../../src/config/copy/index.js';

test('dates: isValidDay checks format and calendar', () => {
  assert.equal(isValidDay('2026-09-24'), true);
  assert.equal(isValidDay('2024-02-29'), true);
  assert.equal(isValidDay('2026-02-29'), false);
  assert.equal(isValidDay('2026-13-01'), false);
  assert.equal(isValidDay('2026-9-24'), false);
  assert.equal(isValidDay(20260924), false);
  assert.equal(isValidMonth('2026-09'), true);
  assert.equal(isValidMonth('2026-00'), false);
});

test('dates: localDay uses local calendar with a local-midnight boundary', () => {
  assert.equal(localDay(new Date(2026, 8, 24, 23, 59, 59)), '2026-09-24');
  assert.equal(localDay(new Date(2026, 8, 25, 0, 0, 0)), '2026-09-25');
  assert.equal(localDay(new Date(2026, 8, 24, 0, 0, 0).getTime()), '2026-09-24');
  assert.throws(() => localDay('2026-09-24'), TypeError);
});

test('dates: dayStartMs is local midnight and parseDay round-trips', () => {
  const ms = dayStartMs('2026-09-24');
  const d = new Date(ms);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 8, 24, 0, 0]);
  assert.deepEqual(parseDay('2026-09-24'), { year: 2026, month: 9, day: 24 });
  assert.throws(() => parseDay('2026-02-30'), RangeError);
});

test('dates: addDays and diffDays cross months, years and DST', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(diffDays('2026-09-24', '2026-10-03'), 9);
  assert.equal(diffDays('2026-10-03', '2026-09-24'), -9);
  assert.equal(diffDays('2026-03-01', '2026-04-01'), 31);
  assert.equal(diffDays('2026-10-20', '2026-11-10'), 21);
  for (let i = -400; i <= 400; i += 37) assert.equal(diffDays('2026-09-24', addDays('2026-09-24', i)), i);
});

test('dates: monthOf and addMonths', () => {
  assert.equal(monthOf('2026-09-24'), '2026-09');
  assert.equal(monthOf(new Date(2026, 0, 1).getTime()), '2026-01');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-09', -21), '2024-12');
});

test('dates: dayOfYear matches prototype index (9 月 24 日 = 267)', () => {
  assert.equal(dayOfYear('2026-01-01'), 1);
  assert.equal(dayOfYear('2026-09-24'), 267);
  assert.equal(dayOfYear('2026-12-31'), 365);
  assert.equal(dayOfYear('2024-12-31'), 366);
});

test('dates: period boundaries 5–10 / 10–15 / 15–19 / 19–5', () => {
  const expect = {
    0: 'night', 4: 'night', 5: 'dawn', 9: 'dawn', 10: 'noon', 14: 'noon',
    15: 'dusk', 18: 'dusk', 19: 'night', 23: 'night',
  };
  for (const [h, p] of Object.entries(expect)) assert.equal(periodOfHour(Number(h)), p, 'hour ' + h);
  assert.deepEqual([...PERIODS], ['dawn', 'noon', 'dusk', 'night']);
  assert.equal(periodOf(new Date(2026, 8, 24, 9, 59)), 'dawn');
  assert.equal(periodOf(new Date(2026, 8, 24, 10, 0)), 'noon');
  assert.throws(() => periodOfHour(24), RangeError);
});

test('dates: period words and date line come from copy (R-H02)', () => {
  const words = PERIODS.map((p) => t('R-H02.period.' + p));
  assert.deepEqual(words, ['早上', '中午', '傍晚', '晚上']);
  const date = t('R-H02.dateFormat', monthDayParts('2026-09-24'));
  assert.equal(date, '9 月 24 日');
  assert.equal(t('R-H02.line', { date, period: t('R-H02.period.' + periodOfHour(20)) }), '9 月 24 日 · 晚上');
});

test('dates: cnNumber counts in Chinese numerals (signature only)', () => {
  const cases = { 0: '〇', 1: '一', 9: '九', 10: '十', 11: '十一', 20: '二十', 22: '二十二', 80: '八十', 100: '一百', 105: '一百零五', 110: '一百一十', 1000: '一千', 2026: '二千零二十六' };
  for (const [n, s] of Object.entries(cases)) assert.equal(cnNumber(Number(n)), s, String(n));
  assert.throws(() => cnNumber(-1), RangeError);
  assert.throws(() => cnNumber(1.5), RangeError);
});

test('dates: signature parts produce the paper-seal date with copy templates', () => {
  assert.equal(cnDigits(2026), '二〇二六');
  assert.deepEqual(signatureDateParts('2026-09-24'), { year: '二〇二六', month: '九', day: '二十四' });
  assert.equal(t('R-I01.signatureDate', signatureDateParts('2026-09-24')), '二〇二六年九月二十四日');
  assert.equal(t('R-I01.signatureMonth', signatureMonthParts('2026-09')), '二〇二六年九月');
  const month = t('R-I01.signatureMonth', signatureMonthParts('2026-09'));
  assert.equal(t('R-I01.monthSignature', { month, n: cnNumber(22), m: cnNumber(80) }), '二〇二六年九月 · 有记录二十二天 · 八十个字');
  const date = t('R-I01.signatureDate', signatureDateParts('2026-09-24'));
  assert.equal(t('R-P03.signature', { date, n: cnNumber(5) }), '二〇二六年九月二十四日 · 五个字');
});
