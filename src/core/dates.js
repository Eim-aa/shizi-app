// 本地日期工具（纯函数，无 DOM）。
// 01-架构设计 §3.1：localDay = YYYY-MM-DD（设备本地日）；at 为 ms。
// 一天的分界（D66 ⑦，policy.dayStartHour P320）：凌晨 4 点，不是 0 点——0:00–3:59 仍算前一天。
// 「今天」与归日只有这一个函数 localDay：记录的 localDay、今日计划与跨天作废（startedDay）、到期判断（due ≤ 今天）、
// 连续 / 累计练习天数、年报与月字帖归日、提醒的 practicedToday 都由它算。已经存下的 localDay / due / startedDay 字串不改写。
// calendarDay 是日历上的日期（0 点分界），只用于「v1 旧数据按旧口径归日」等少数地方。
// 界面上的日期文字格式（「{month} 月 {day} 日」、时段词、落款的「年/月/日」）都在
// src/config/copy/ 里；本模块只给数字与时段 id，汉字数字只供纸面落款（文案 T10 / 文案-D3）。

import * as defaultPolicy from '../config/policy.js';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const MS_PER_DAY = 86400000;

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function toDate(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'number' && Number.isFinite(input)) return new Date(input);
  throw new TypeError('expected a Date or a finite ms timestamp');
}

/** 是否为合法的 YYYY-MM-DD（含月份天数校验）。 */
export function isValidDay(value) {
  if (typeof value !== 'string') return false;
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/** 是否为合法的 YYYY-MM。 */
export function isValidMonth(value) {
  if (typeof value !== 'string') return false;
  const m = MONTH_RE.exec(value);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

export function daysInMonth(year, month) {
  // month 1–12；Date 的第 0 天 = 上月最后一天。
  return new Date(year, month, 0).getDate();
}

/** ms 或 Date → 日历日键 YYYY-MM-DD（本地 0 点分界）。 */
export function calendarDay(input) {
  const date = toDate(input);
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

/** 一天从几点开始（policy.dayStartHour，P320；0–23 的整数，其余按 0）。 */
export function dayStartHourOf(policy = defaultPolicy) {
  const h = policy ? policy.dayStartHour : 0;
  return Number.isInteger(h) && h > 0 && h < 24 ? h : 0;
}

/**
 * ms 或 Date → 本地日键 YYYY-MM-DD（练习用的「一天」：凌晨 dayStartHour 点分界，D66 ⑦）。
 * 本地时间早于 dayStartHour 点时算前一天（按本地钟点判断，夏令时不错位）。
 */
export function localDay(input, policy = defaultPolicy) {
  const date = toDate(input);
  const day = calendarDay(date);
  const h = dayStartHourOf(policy);
  return h && date.getHours() < h ? addDays(day, -1) : day;
}

/** YYYY-MM-DD → {year, month, day}（数字）。 */
export function parseDay(day) {
  if (!isValidDay(day)) throw new RangeError('invalid day key: ' + String(day));
  const [y, m, d] = day.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** 日历日的 0 点（ms；不是练习日的开始，练习日从 dayStartHour 点起）。 */
export function dayStartMs(day) {
  const { year, month, day: d } = parseDay(day);
  return new Date(year, month - 1, d).getTime();
}

/** 日键加减 n 天（按日历，不受夏令时影响）。 */
export function addDays(day, n) {
  const { year, month, day: d } = parseDay(day);
  // 取当日正午再加减，避开个别时区 0 点不存在的情况。
  return calendarDay(new Date(year, month - 1, d + Math.trunc(n), 12));
}

/** b − a 的日历天数（b 晚于 a 为正）。 */
export function diffDays(a, b) {
  const pa = parseDay(a);
  const pb = parseDay(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / MS_PER_DAY,
  );
}

/** 日键或 ms → YYYY-MM。 */
export function monthOf(dayOrMs) {
  const day = typeof dayOrMs === 'string' ? dayOrMs : localDay(dayOrMs);
  if (!isValidDay(day)) throw new RangeError('invalid day key: ' + String(day));
  return day.slice(0, 7);
}

/** YYYY-MM 加减 n 个月。 */
export function addMonths(month, n) {
  if (!isValidMonth(month)) throw new RangeError('invalid month key: ' + String(month));
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + Math.trunc(n);
  return Math.floor(index / 12) + '-' + pad2((index % 12) + 1);
}

/** 一年中的第几天（1 月 1 日 = 1）。题记轮换用（P23，原型 `267 % 3` 即 9 月 24 日）。 */
export function dayOfYear(day) {
  const { year } = parseDay(day);
  return diffDays(year + '-01-01', day) + 1;
}

// ---- 时段（R-H02；交接备注 L134：晨 5–10、午 10–15、暮 15–19、夜 19–5）----

export const PERIODS = Object.freeze(['dawn', 'noon', 'dusk', 'night']);

/** 小时（0–23）→ 时段 id。边界左闭右开：5–10 dawn、10–15 noon、15–19 dusk、其余 night。 */
export function periodOfHour(hour) {
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) throw new RangeError('hour must be an integer 0–23');
  if (h >= 5 && h < 10) return 'dawn';
  if (h >= 10 && h < 15) return 'noon';
  if (h >= 15 && h < 19) return 'dusk';
  return 'night';
}

/** ms 或 Date → 时段 id（按本地时间）。 */
export function periodOf(input) {
  return periodOfHour(toDate(input).getHours());
}

/** 日键 → 界面日期的数字部分 {month, day}（配合 copy R-H02.dateFormat「{month} 月 {day} 日」）。 */
export function monthDayParts(day) {
  const p = parseDay(day);
  return { month: p.month, day: p.day };
}

// ---- 落款汉字数字（只用于纸面落款：文案 T10 / 文案-D3）----

const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_ZERO = '零';

/** 年份式逐位汉字：2026 → 二〇二六。 */
export function cnDigits(n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0) throw new RangeError('cnDigits expects a non-negative integer');
  return String(v)
    .split('')
    .map((c) => CN_DIGITS[Number(c)])
    .join('');
}

/** 计数式汉字数字（0–9999）：22 → 二十二，80 → 八十，10 → 十，105 → 一百零五。 */
export function cnNumber(n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0 || v > 9999) throw new RangeError('cnNumber supports integers 0–9999');
  if (v === 0) return CN_DIGITS[0];
  const units = ['', '十', '百', '千'];
  const digits = String(v).split('').map(Number);
  const len = digits.length;
  let out = '';
  let pendingZero = false;
  for (let i = 0; i < len; i += 1) {
    const d = digits[i];
    const unit = units[len - 1 - i];
    if (d === 0) {
      pendingZero = out.length > 0;
      continue;
    }
    if (pendingZero) {
      out += CN_ZERO;
      pendingZero = false;
    }
    // 10–19 读作「十…」而不是「一十…」。
    if (!(d === 1 && unit === '十' && i === 0)) out += CN_DIGITS[d];
    out += unit;
  }
  return out;
}

/**
 * 数量词（落款「两个字」「有记录两天」）：口语里 2 读「两」，开头的 200 / 2000 读「两百」「两千」；
 * 12、22、2026 等其余数字同 cnNumber（十二、二十二、两千零二十六 里的十位 / 个位 / 非开头仍是「二」）。年份不走这里（用 cnDigits）。
 */
export function cnCount(n) {
  const v = Number(n);
  if (v === 2) return '两';
  const out = cnNumber(v);
  return /^二[百千]/.test(out) ? `两${out.slice(1)}` : out;
}

/** 日键 → 落款日期各段（汉字数字），配合 copy 的落款模板拼接。 */
export function signatureDateParts(day) {
  const p = parseDay(day);
  return { year: cnDigits(p.year), month: cnNumber(p.month), day: cnNumber(p.day) };
}

/** YYYY-MM → 落款月份各段（汉字数字）。 */
export function signatureMonthParts(month) {
  if (!isValidMonth(month)) throw new RangeError('invalid month key: ' + String(month));
  const [y, m] = month.split('-').map(Number);
  return { year: cnDigits(y), month: cnNumber(m) };
}
