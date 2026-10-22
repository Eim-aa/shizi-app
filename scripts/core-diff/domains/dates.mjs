// 日期域（src/core/dates.js；B4.0 示例域）：时刻偏向 4 点分界、0 点、夏令时跳变的前后几毫秒；日键 / 月键含非法与边角形状。
const HOUR = 3600000;
const transitionsCache = new Map();

/** 当前时区 2024–2027 年的偏移跳变时刻（精确到毫秒）。 */
export function transitions() {
  const tz = process.env.TZ || '';
  if (transitionsCache.has(tz)) return transitionsCache.get(tz);
  const off = (t) => new Date(t).getTimezoneOffset();
  const out = [];
  const end = Date.UTC(2028, 0, 1);
  for (let t = Date.UTC(2024, 0, 1); t < end; t += HOUR) {
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
  transitionsCache.set(tz, out);
  return out;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

export default {
  id: 'dates',
  prepare(g) {
    const trans = transitions();
    const year = () => g.weighted([[() => g.int(2024, 2028), 6], [() => g.int(1900, 2100), 2], [() => g.int(0, 120), 1], [() => g.int(1000, 9999), 1]])();
    g.time = () => g.weighted([
      // 本地某天 4 点分界 / 0 点 / 午夜前后
      [() => {
        const d = new Date(g.int(2024, 2028), g.int(0, 11), g.int(1, 31), g.pick([4, 4, 0, 3, 5, 23, 12]), 0, 0, 0).getTime();
        return d + g.pick([0, 0, -1, 1, -1000, 1000, -60000, 59 * 60000, HOUR - 1]);
      }, 6],
      [() => (trans.length ? g.pick(trans) + g.pick([0, -1, 1, -HOUR, HOUR, -HOUR - 1, 2 * HOUR, -4 * HOUR]) : Date.UTC(2026, 2, 8)), 3],
      [() => Date.UTC(2026, 0, 1) + Math.floor(g.float() * 4 * 365 * 86400000), 3],
      [() => Date.UTC(1900, 0, 1) + Math.floor(g.float() * 200 * 365.25 * 86400000), 1],
      [() => g.pick([0, -1, 1, 8.64e15, -8.64e15, 8.64e15 + 1, -8.64e15 - 1, 1.5, -0.5, 1772488800000.25]), 1],
    ])();
    g.day = () => g.weighted([
      [() => `${pad(year(), 4)}-${pad(g.int(1, 12))}-${pad(g.int(1, 28))}`, 6],
      [() => `${pad(year(), 4)}-${pad(g.int(1, 12))}-${pad(g.pick([29, 30, 31]))}`, 2],
      [() => g.pick(['2026-02-29', '2028-02-29', '2100-02-29', '2000-02-29', '0000-02-29', '0004-02-29', '0050-01-01', '0099-12-31', '0100-01-01',
        '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-1', '26-01-01', '２０２６-01-01', '2026/01/01', ' 2026-01-01', '2026-01-01T00', '', '9999-12-31', '1000-01-01']), 2],
      [() => g.pick([null, 20260101, true, ['2026-01-01'], { d: 1 }]), 0.5],
    ])();
    g.month = () => g.weighted([
      [() => `${pad(year(), 4)}-${pad(g.int(1, 12))}`, 6],
      [() => g.pick(['0000-01', '0000-12', '2026-13', '2026-00', '2026-1', '2026-01-01', '', null, 202601]), 1],
    ])();
    g.delta = () => g.weighted([[() => g.int(-40, 40), 6], [() => g.int(-5000, 5000), 2], [() => g.pick([0, -0, 0.5, -0.5, 1.9, -1.9, 1e7, -1e7, 3652425, -3652425]), 1]])();
  },
  ops: {
    'clock.set': { weight: 6, args: (g) => ({ t: g.time() }) },
    'dates.localDay': {
      weight: 8,
      args: (g) => {
        const a = g.chance(0.5) ? {} : { t: g.chance(0.95) ? g.time() : g.pick(['x', null, '1772488800000', false]) };
        if (g.chance(0.2)) a.dayStartHour = g.pick([0, 1, 4, 5, 23, 24, -1, 2.5, null, '4']);
        return a;
      },
    },
    'dates.calendarDay': { weight: 3, args: (g) => (g.chance(0.5) ? {} : { t: g.time() }) },
    'dates.periodOf': { weight: 2, args: (g) => (g.chance(0.5) ? {} : { t: g.time() }) },
    'dates.isValidDay': { weight: 3, args: (g) => ({ value: g.day() }) },
    'dates.isValidMonth': { weight: 1, args: (g) => ({ value: g.month() }) },
    'dates.daysInMonth': { weight: 1, args: (g) => ({ year: g.pick([2026, 2024, 1900, 2000, 2100, 0, 4, 99, 100, -1, -400, 199999]), month: g.int(-14, 26) }) },
    'dates.parseDay': { weight: 1, args: (g) => ({ day: g.day() }) },
    'dates.dayStartMs': { weight: 2, args: (g) => ({ day: g.day() }) },
    'dates.addDays': { weight: 6, args: (g) => ({ day: g.day(), n: g.delta() }) },
    'dates.diffDays': { weight: 3, args: (g) => ({ a: g.day(), b: g.day() }) },
    'dates.monthOf': { weight: 2, args: (g) => ({ dayOrMs: g.chance(0.5) ? g.day() : g.time() }) },
    'dates.addMonths': { weight: 2, args: (g) => ({ month: g.month(), n: g.delta() }) },
    'dates.dayOfYear': { weight: 1, args: (g) => ({ day: g.day() }) },
    'dates.periodOfHour': { weight: 1, args: (g) => ({ hour: g.pick([0, 4, 5, 9, 10, 14, 15, 18, 19, 23, 24, -1, 4.5]) }) },
    'dates.monthDayParts': { weight: 1, args: (g) => ({ day: g.day() }) },
  },
};
