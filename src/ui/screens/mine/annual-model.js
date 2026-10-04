// 年报 · 数据模型（纯函数，无 DOM；阶段 1 P1-E7，交接 §8；原 02 M4-2 / 04 R-M06；D27 / D31 / D42 / D45 / D46 ⑦ ⑬；test/ui/annual.test.mjs 直接调用）。
//
// 年报不再是四个统计小节，而是一卷（交接 §8.1）：卷首（「二〇二六」、这一年写过 N 个字、今年第一个字）→ 每月一段 → 卷尾「同一个字，两次」。
// 只有一个数（年字数）；不出统计小节（最忙月份、较少见的字不再有）。
//
// 口径（与 M4-1 mine/model.js recordIndex 同一索引）：
// - 「今年」= 应用时钟今天所在的公历年；只算 localDay 在这一年的记录。
// - 「记录」只看 judged（看过答案 / 跳过不算）；折叠月份（01 §9）的 byDay 字与日子也算。**纸上记录不进、不计入年字数**（D46-13，isPaperRecord，
//   本卡只留判定接口）。
// - 年字数 count = 今年有记录的字去重（写对写错都算；整月没留下笔迹的字也算——它们在月段里画 under 衬底）。
// - 今年第一个字：字 = 今年最早的一条 judged 记录的字；笔迹按 D42（解 P122）：在今年这个字的记录里从早到晚找留有墨迹的那一次，日期是那一次的日子
//   （说明行写「{M月D日} 的笔迹」，D45：不说「今年第一次」）；今年里一份墨迹都没有才 record = 最早那条、格子画 under 衬底；不拿去年的墨冒充（I03）。
// - 每月一段：该月月字帖的格子（pick.js monthCells：每字取本月留墨的第一次，没墨画衬底）；月字数 = 格数。
// - 卷尾「同一个字，两次」（P161）：今年里同时有两份留有墨迹的记录（第一次与最近一次，D27）、两次相隔天数最大的字；并列取今年先写到的；没有则不出卷尾。
// - 空态：今年没有任何记录。去年有记录、今年没有也是空态。

import { diffDays, isValidDay, monthOf, parseDay } from '../../../core/dates.js';
import { isPaperRecord } from '../../../core/images/work.js';
import * as defaultPolicy from '../../../config/policy.js';
import { monthCells, monthMembers } from '../../../core/images/pick.js';
import { paginate, retagPages } from '../../../core/images/paginate.js';
import { dayTag } from '../../../core/images/layout.js';
import { recordIndex } from './model.js';
import { pickInkRecord, storedInkPresent } from '../../../core/ink-pick.js';

function yearOfDay(day) {
  return isValidDay(day) ? parseDay(day).year : null;
}

/**
 * 某年的记录切片（按 recordIndex 口径，纸上记录不进）。
 * @returns {{year, judged: Record[], days: string[], chars: string[], folded: {[month]: {byDay, chars}}}}
 *   judged 按 id 升序；days 升序；chars = 今年有记录的字，按第一次出现的先后（日子先后，同日按 id / byDay 顺序）。
 */
export function yearSlice(state, year) {
  const index = recordIndex(state);
  const prefix = String(year) + '-';
  const judged = index.judged.filter(r => typeof r.localDay === 'string' && r.localDay.startsWith(prefix) && isValidDay(r.localDay) && !isPaperRecord(r));
  const folded = {};
  for (const [month, fold] of Object.entries(index.folded)) if (month.startsWith(prefix)) folded[month] = fold;
  // 有记录的日子：非纸上的 judged 记录的日子 + 折叠月份 byDay 的日子（index.days 里含纸上记录的日子，这里不用）
  const daySet = new Set(judged.map(r => r.localDay));
  for (const fold of Object.values(folded)) for (const day of Object.keys(fold.byDay)) daySet.add(day);
  const days = [...daySet].sort();
  // 每个字第一次出现的日子与先后（折叠月份的字按 byDay 日子；judged 按 localDay、同日按 id）。
  const firstSeen = new Map(); // char → day
  let order = 0;
  const events = [];
  for (const fold of Object.values(folded)) {
    for (const day of Object.keys(fold.byDay).sort()) for (const c of fold.byDay[day]) events.push({ day, char: c, seq: order++ });
  }
  for (const r of judged) events.push({ day: r.localDay, char: r.char, seq: order++ });
  events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.seq - b.seq));
  for (const ev of events) if (!firstSeen.has(ev.char)) firstSeen.set(ev.char, ev.day);
  return { year, judged, days, chars: [...firstSeen.keys()], firstSeen, folded, ink: index.ink };
}

/**
 * 今年第一个字：{char, day, record|null}。
 * 字 = 今年最早的 judged 的字；折叠月份有更早的日子时取那天 byDay 的第一个字；同一天且字相同，用 judged 记录。
 * 笔迹（D42）：在今年这个字的 judged 记录里从早到晚找留有墨迹的那一次，找到了 record / day 就是那一次；
 * 今年里都没有墨迹时 record / day 是原来的取法（最早那条；折叠更早的 record=null），格子画衬底。
 * @param {object} slice  yearSlice
 * @param {{hasInk?:(record)=>boolean}} [o]  缺省按 slice.ink（state.ink）存下的墨迹
 */
export function firstOfYear(slice, { hasInk = null } = {}) {
  const r0 = slice.judged.length ? slice.judged[0] : null;
  let fold = null;
  for (const f of Object.values(slice.folded)) {
    for (const day of Object.keys(f.byDay).sort()) {
      if (!f.byDay[day].length) continue;
      if (!fold || day < fold.day) fold = { day, char: f.byDay[day][0] };
      break;
    }
  }
  let base = null;
  if (r0 && (!fold || r0.localDay < fold.day || (r0.localDay === fold.day && r0.char === fold.char))) {
    base = { char: r0.char, day: r0.localDay, record: r0 };
  } else if (fold) {
    base = { char: fold.char, day: fold.day, record: null };
  }
  if (!base) return null;
  const has = typeof hasInk === 'function' ? hasInk : record => storedInkPresent({ ink: slice.ink }, record);
  const found = pickInkRecord(slice.judged.filter(r => r.char === base.char), { prefer: 'first', hasInk: has });
  return found ? { char: base.char, day: found.localDay, record: found } : base;
}

/**
 * 卷尾「同一个字，两次」（P161）：今年里同时有两份留有墨迹的记录、相隔天数最大的字。
 * @returns {{char, first:{record, day}, last:{record, day}, gap:number}|null}
 */
export function twiceOfYear(slice, { hasInk = null } = {}) {
  const has = typeof hasInk === 'function' ? hasInk : record => storedInkPresent({ ink: slice.ink }, record);
  const byChar = new Map();
  for (const r of slice.judged) {
    let ok = false;
    try {
      ok = !!has(r);
    } catch (error) {
      ok = false;
    }
    if (!ok) continue;
    const list = byChar.get(r.char);
    if (list) list.push(r);
    else byChar.set(r.char, [r]);
  }
  let best = null;
  for (const char of slice.chars) {
    const list = byChar.get(char);
    if (!list || list.length < 2) continue;
    const first = list[0];
    const last = list[list.length - 1];
    const gap = diffDays(first.localDay, last.localDay);
    if (!(gap >= 1)) continue;
    if (!best || gap > best.gap) best = { char, first: { record: first, day: first.localDay }, last: { record: last, day: last.localDay }, gap };
  }
  return best;
}

/** 今年每月一段：[{month:'YYYY-MM', monthNum, n}]，按月份升序；没有字的月份不出。月字数 = 月字帖里的格数（含衬底字）。 */
export function yearMonths(state, slice, { policy } = {}) {
  const months = new Set();
  for (const r of slice.judged) months.add(monthOf(r.localDay));
  for (const m of Object.keys(slice.folded)) months.add(m);
  const out = [];
  for (const month of [...months].sort()) {
    const n = monthMembers(state, month, policy ? { pick: policy.monthSheetPick } : {}).members.length;
    if (n > 0) out.push({ month, monthNum: Number(month.slice(5, 7)), n });
  }
  return out;
}

/**
 * 年报页面模型。
 * @param {object|null} state  store 状态
 * @param {string} today       YYYY-MM-DD（应用时钟）
 * @param {{hasInk?:(record)=>boolean, policy?:object}} [opts]  hasInk：D42 挑留墨记录用，缺省按 state.ink
 * @returns {{today, year, empty:boolean, count:number, chars:string[], days:number,
 *   first: {char, day, record|null}|null, months: Array<{month, monthNum, n}>, twice: object|null}}
 */
export function annualModel(state, today, { hasInk = null, policy = null } = {}) {
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
    first: empty ? null : firstOfYear(slice, { hasInk }),
    months: empty ? [] : yearMonths(state, slice, { policy }),
    twice: empty ? null : twiceOfYear(slice, { hasInk }),
  };
}

/** 某条记录 → 年报里的一格（有墨 hand，没墨 under）。 */
function cellOfRecord(char, record, inkOf) {
  const ink = record ? inkOf(record) : null;
  return { ch: char, ink, mode: ink ? 'hand' : 'under', dot: false, tag: '', record };
}

/**
 * 年报的图计划（纯数据）：卷首、每月的页、卷尾。
 * @returns {{status:'ready'|'empty', model, cover, months:Array<{month, monthNum, cells, pages}>, tail, pages:Array<{type, ...}>}}
 */
export function annualPlan(state, { today, inkOf, hasInk = null, policy = defaultPolicy }) {
  const model = annualModel(state, today, { hasInk, policy });
  if (model.empty || !model.first) return { status: 'empty', model, cover: null, months: [], tail: null, pages: [] };
  const first = cellOfRecord(model.first.char, model.first.record, inkOf);
  const months = model.months.map(m => {
    const r = monthCells(state, m.month, { inkOf, hasInk, policy });
    const pages = retagPages(paginate(r.cells, policy.imageMaxChars), dayTag);
    return { month: m.month, monthNum: m.monthNum, cells: r.cells, pages };
  });
  const tail = model.twice
    ? { first: cellOfRecord(model.twice.char, model.twice.first.record, inkOf), last: cellOfRecord(model.twice.char, model.twice.last.record, inkOf), firstDay: model.twice.first.day, lastDay: model.twice.last.day }
    : null;
  const pages = [{ type: 'cover' }];
  for (const m of months) m.pages.forEach((cells, i) => pages.push({ type: 'month', month: m.month, cells, part: i + 1, of: m.pages.length }));
  if (tail) pages.push({ type: 'tail' });
  return { status: 'ready', model, first, months, tail, pages };
}
