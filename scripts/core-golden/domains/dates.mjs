// 金标准 · 日期（src/core/dates.js；计划 §4.3 ①「日期 4 点分界 × 时区 × 夏令时」）。
// 每个时区一组：4 点分界前后 1ms、0 点、夏令时跳变前后、跳变日的 dayStartMs / addDays、两位年怪癖、非法日键……
// 时刻都在本时区里用 new Date(y, m, d, h, …) 现算（所以同一用例在不同时区是不同的 ms），期望值来自参考引擎。
import * as policy from '../../../src/config/policy.js';

const TZS = ['Asia/Shanghai', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'America/Santiago', 'UTC'];
const HOUR = 3600000;

/** 本时区 2026 年的偏移跳变时刻。 */
function transitions2026() {
  const off = (t) => new Date(t).getTimezoneOffset();
  const out = [];
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += HOUR) {
    if (off(t) === off(t + HOUR)) continue;
    let lo = t;
    let hi = t + HOUR;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (off(mid) === off(lo)) lo = mid;
      else hi = mid;
    }
    out.push(hi);
  }
  return out;
}

function requests() {
  const R = [];
  const at = (t) => {
    R.push({ op: 'dates.localDay', args: { t } });
    R.push({ op: 'dates.calendarDay', args: { t } });
    R.push({ op: 'dates.periodOf', args: { t } });
  };
  // 4 点分界 / 0 点 / 午夜
  for (const [y, m, d] of [[2026, 2, 2], [2026, 0, 1], [2024, 1, 29], [2026, 11, 31], [2026, 2, 1]]) {
    for (const [h, mi, s, ms] of [[3, 59, 59, 999], [4, 0, 0, 0], [4, 0, 0, 1], [0, 0, 0, 0], [23, 59, 59, 999], [12, 0, 0, 0]]) at(new Date(y, m, d, h, mi, s, ms).getTime());
  }
  // 夏令时跳变
  const trans = transitions2026();
  for (const t of trans) {
    for (const dt of [-HOUR - 1, -1, 0, 1, HOUR, 4 * HOUR]) at(t + dt);
    const day = new Date(t).toISOString().slice(0, 10);
    R.push({ op: 'dates.dayStartMs', args: { day } });
    R.push({ op: 'dates.addDays', args: { day, n: 1 } });
    R.push({ op: 'dates.addDays', args: { day, n: -1 } });
  }
  // 换 dayStartHour（policy 覆盖）
  const t4 = new Date(2026, 2, 2, 4, 30).getTime();
  for (const dayStartHour of [0, 1, 4, 5, 23, 24, -1, 2.5, null, '4']) R.push({ op: 'dates.localDay', args: { t: t4, dayStartHour } });
  // 时间值边角：纪元、TimeClip 边界、小数 ms、非数字
  for (const t of [0, -1, 1.5, -0.5, 8.64e15, 8.64e15 + 1, -8.64e15, -8.64e15 - 1]) at(t);
  for (const t of ['x', null, false]) R.push({ op: 'dates.localDay', args: { t } });
  // 日键
  const days = ['2026-03-02', '2026-02-29', '2028-02-29', '2100-02-29', '2000-02-29', '0000-02-29', '0004-02-29', '0050-01-01', '0099-12-31', '0100-01-01',
    '9999-12-31', '1000-01-01', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-1', '26-01-01', '２０２６-01-01', '2026/01/01', ' 2026-01-01', '', null, 20260101];
  for (const value of days) {
    R.push({ op: 'dates.isValidDay', args: { value } });
    R.push({ op: 'dates.parseDay', args: { day: value } });
    R.push({ op: 'dates.dayStartMs', args: { day: value } });
    R.push({ op: 'dates.dayOfYear', args: { day: value } });
    R.push({ op: 'dates.monthOf', args: { dayOrMs: value } });
    R.push({ op: 'dates.monthDayParts', args: { day: value } });
  }
  for (const [day, n] of [['2026-03-02', 1], ['2026-03-02', -1], ['2026-02-28', 1], ['2024-02-28', 1], ['2026-12-31', 1], ['2026-01-01', -1], ['2026-03-02', 0.9],
    ['2026-03-02', -0.9], ['2026-03-02', 365], ['2026-03-02', -3652425], ['0050-01-01', 1], ['0099-12-31', 1], ['0100-01-01', -1], ['9999-12-31', 1], ['2026-03-02', 1e7], ['2026-03-02', -1e7]]) {
    R.push({ op: 'dates.addDays', args: { day, n } });
  }
  for (const [a, b] of [['2026-01-01', '2026-03-02'], ['2026-03-02', '2026-01-01'], ['2024-01-01', '2025-01-01'], ['0050-01-01', '0051-01-01'], ['0099-12-31', '0100-01-01'], ['2026-03-08', '2026-03-09']]) {
    R.push({ op: 'dates.diffDays', args: { a, b } });
  }
  for (const [month, n] of [['2026-03', 1], ['2026-12', 1], ['2026-01', -1], ['0000-01', -1], ['0000-01', -13], ['0000-12', -24], ['2026-03', 0.5], ['2026-13', 1], ['2026-1', 1]]) {
    R.push({ op: 'dates.addMonths', args: { month, n } });
  }
  for (const value of ['2026-03', '2026-13', '2026-00', '0000-01', '2026-1', '2026-03-02', '', null]) R.push({ op: 'dates.isValidMonth', args: { value } });
  for (const [year, month] of [[2026, 2], [2024, 2], [1900, 2], [2000, 2], [0, 2], [4, 2], [99, 2], [100, 2], [-1, 2], [2026, 0], [2026, 13], [2026, -14], [199999, 2]]) {
    R.push({ op: 'dates.daysInMonth', args: { year, month } });
  }
  for (const hour of [0, 4, 5, 9, 10, 14, 15, 18, 19, 23, 24, -1, 4.5]) R.push({ op: 'dates.periodOfHour', args: { hour } });
  return R;
}

export default {
  id: 'dates',
  source: 'src/core/dates.js',
  build({ withTZ, opCases }) {
    return {
      policy: { dayStartHour: policy.dayStartHour },
      groups: TZS.map((tz) => withTZ(tz, () => ({ tz, cases: opCases(requests()) }))),
    };
  },
};
