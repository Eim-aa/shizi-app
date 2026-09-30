// 年度报告 · 数据模型（纯函数，无 DOM；02 M4-2；04 R-M06；走查-M01；原型 ShiziScreen-第十稿交接版 L133–L144、逻辑 L494–L498；
// reference/J-proto-screen.md §2.3.16；test/ui/annual.test.mjs 直接调用）。
//
// 口径（R-M06「年度报告全部按记录算」；01 §3.2；与 M4-1 mine/model.js recordIndex 同一索引）：
// - 「今年」= 应用时钟今天所在的公历年；只算 localDay 在这一年的记录（页底「只算今年的记录。」）。
// - 「记录」只看 judged（看过答案 / 跳过不算）；折叠月份（01 §9，P28）的 byDay 字与日子也算（kept 已在 judged 里）。
// - 一 · 今年有记录的字：去重字数（写对写错都算）。
// - 二 · 有记录天数最多的月份：每月有记录的日子数取最大；并列取月份大的（原型 L496 sort `…||y-x`）。
// - 三 · 较少见的字：今年有记录的字里题库字频序 rank 最大的一个（旧版 yearReportData `rarest` 同口径，E-shell §2.5；
//   SEED 的 rank =「字频#N」）。没有字频的字（自造字 / 题库外）不参与；一个都没有时整节不显示（原型 annRareOn）。
//   并列（同 rank）取今年先写到的那个。原型写死「豕」，这里改为按 rank 算——过渡口径，报告登记待定（P23-04「需字频表」）。
//   字形是标准字形（原型 ref()，不是笔迹）；拼音取题库卡的 py。
// - 四 · 这一年第一个有记录的字：今年最早的一条 judged 记录（按 id 先后，01 §3.1）；折叠月份里更早的日子只剩字，
//   record=null（格子「没有笔迹」，不借别次笔迹，I03）。
// - 空态：今年没有任何记录（R-M06 空「今年还没有记录」）。去年有记录、今年没有也是空态。

import { isValidDay, monthOf, parseDay } from '../../../core/dates.js';
import { cardForKey } from '../../../data/deck.js';
import { recordIndex } from './model.js';

/** 没有字频的卡（cards.js buildCards 的缺省 rank）。 */
export const NO_RANK = 999999;

/** 题库卡查找（默认读 data/deck.js；单测注入）。返回 {py, rank} 或 null。 */
export function defaultCardOf(char) {
  try {
    return cardForKey('base:' + char);
  } catch (error) {
    return null;
  }
}

function yearOfDay(day) {
  return isValidDay(day) ? parseDay(day).year : null;
}

/**
 * 某年的记录切片（按 recordIndex 口径）。
 * @returns {{year, judged: Record[], days: string[], chars: string[], folded: {[month]: {byDay, chars}}}}
 *   judged 按 id 升序；days 升序；chars = 今年有记录的字，按第一次出现的先后（日子先后，同日按 id / byDay 顺序）。
 */
export function yearSlice(state, year) {
  const index = recordIndex(state);
  const prefix = String(year) + '-';
  const judged = index.judged.filter(r => typeof r.localDay === 'string' && r.localDay.startsWith(prefix) && isValidDay(r.localDay));
  const days = [...index.days].filter(d => d.startsWith(prefix)).sort();
  const folded = {};
  for (const [month, fold] of Object.entries(index.folded)) if (month.startsWith(prefix)) folded[month] = fold;
  // 每个字第一次出现的日子与先后（折叠月份的字按 byDay 日子；judged 按 localDay、同日按 id）。
  const firstSeen = new Map(); // char → {day, order}
  let order = 0;
  const events = [];
  for (const fold of Object.values(folded)) {
    for (const day of Object.keys(fold.byDay).sort()) for (const c of fold.byDay[day]) events.push({ day, char: c, seq: order++ });
  }
  for (const r of judged) events.push({ day: r.localDay, char: r.char, seq: order++ });
  events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.seq - b.seq));
  for (const ev of events) if (!firstSeen.has(ev.char)) firstSeen.set(ev.char, ev.day);
  return { year, judged, days, chars: [...firstSeen.keys()], firstSeen, folded };
}

/** 二 · 有记录天数最多的月份：{month:'YYYY-MM', monthNum, days} 或 null。并列取月份大的。 */
export function busiestMonth(days) {
  const byMonth = new Map();
  for (const d of days || []) {
    const m = monthOf(d);
    byMonth.set(m, (byMonth.get(m) || 0) + 1);
  }
  let best = null;
  for (const [month, n] of byMonth) {
    if (!best || n > best.days || (n === best.days && month > best.month)) best = { month, days: n };
  }
  return best ? { month: best.month, monthNum: Number(best.month.slice(5, 7)), days: best.days } : null;
}

/** 三 · 较少见的字：chars 里字频序 rank 最大的一个；并列取 chars 里靠前（先写到）的。{char, py, rank} 或 null。 */
export function rarestChar(chars, cardOf = defaultCardOf) {
  let best = null;
  for (const char of chars || []) {
    const card = cardOf(char);
    const rank = card && Number.isFinite(Number(card.rank)) ? Number(card.rank) : NO_RANK;
    if (!(rank > 0) || rank >= NO_RANK) continue;
    if (!best || rank > best.rank) best = { char, py: card && typeof card.py === 'string' ? card.py : '', rank };
  }
  return best;
}

/**
 * 四 · 这一年第一个有记录的字：{char, day, record|null}。
 * 今年最早的 judged（id 先后）；折叠月份有更早的日子时取那天 byDay 的第一个字（record=null）；
 * 同一天且字相同，用 judged 记录（可能有笔迹）。
 */
export function firstOfYear(slice) {
  const r0 = slice.judged.length ? slice.judged[0] : null;
  let fold = null;
  for (const f of Object.values(slice.folded)) {
    for (const day of Object.keys(f.byDay).sort()) {
      if (!f.byDay[day].length) continue;
      if (!fold || day < fold.day) fold = { day, char: f.byDay[day][0] };
      break;
    }
  }
  if (r0 && (!fold || r0.localDay < fold.day || (r0.localDay === fold.day && r0.char === fold.char))) {
    return { char: r0.char, day: r0.localDay, record: r0 };
  }
  if (fold) return { char: fold.char, day: fold.day, record: null };
  return null;
}

/**
 * 年度报告页面模型（R-M06）。
 * @param {object|null} state  store 状态
 * @param {string} today       YYYY-MM-DD（应用时钟）
 * @param {{cardOf?: (char:string) => ({py?:string, rank?:number}|null)}} [opts]
 * @returns {{today, year, empty:boolean, count:number, chars:string[], days:number,
 *   month: {month, monthNum, days}|null, rare: {char, py, rank}|null, first: {char, day, record|null}|null}}
 */
export function annualModel(state, today, { cardOf = defaultCardOf } = {}) {
  const year = yearOfDay(today);
  const slice = yearSlice(state, year);
  const empty = slice.days.length === 0 && slice.chars.length === 0;
  return {
    today,
    year,
    empty,
    count: slice.chars.length,
    chars: slice.chars,
    days: slice.days.length,
    month: empty ? null : busiestMonth(slice.days),
    rare: empty ? null : rarestChar(slice.chars, cardOf),
    first: empty ? null : firstOfYear(slice),
  };
}
