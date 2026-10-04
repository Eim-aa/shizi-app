// 我的首页与练习记录 · 数据模型（纯函数，无 DOM；02 M4-1；04 R-M01–R-M05、R-P01–R-P05；03 P02 / P64；
// 原型 ShiziScreen-第十稿交接版 L24–L31（mine / mineEmpty）、L88–L110（records / recordsHistory / recordsMany / recordsEmpty）、
// L320–L324 imgMonth、L382–L388、L408–L429；reference/J-proto-screen.md §2.3.1–§2.3.2、§2.3.6–§2.3.9；test/ui/mine.test.mjs 直接调用）。
//
// 口径（01 §3.2；R-M01「数字全部按记录算」；R-P01 / K27「只标当天写过的日子，无补记」）：
// - 「记录」只看 judged（看过答案 / 跳过不算）；「最近一次 / 先后」按 id 序号（01 §3.1），日期只做月、日归属。
// - 有记录的日子 = 有 judged 记录的 localDay ∪ 折叠月份（01 §9，P28）byDay 里有字的日子。
//   legacy.days（v1 旧练习日，01 §12）不算：R-P01 只标「当天写过（有记录）」的日子——01 §12 写了「练习记录日历显示」，
//   与 R-P01 / K27 冲突，过渡不显示，报告登记待定。
// - 月字帖（R-P02 / R-M01）：该月每个字按「这个月第一次判断」的先后排；格子取墨按 P02 policy.monthSheetPick
//   （'first' = 这个月第一次写这个字那次，M02；'last' = 月内最后一次判断，D11）；角标 = 与前一格日期不同时标那格的日期（原型 L321）。
//   D42（解 P122；D27 起中间几次的墨迹已回收）：每字在本月内按这个偏好顺序（first 从早到晚、last 从晚到早）找**留有墨迹**的那一次
//   （core/ink-pick.js pickRecordInPeriod），本月里一份都没有才取偏好方向上的那一条、如实「没有笔迹」；不拿别月的墨迹冒充（I03）；
//   角标日期跟着挑出来的那条记录走（M02）。「有没有墨迹」由 hasInk 判断，缺省按 state.ink 的存下的墨迹。
//   折叠月份只剩 byDay / chars 与 kept：字按 chars 顺序、日期取该字最早出现的那天；记录只能从 kept 里找（同样按 D42 挑有墨迹的），
//   kept 里没有这个字（或一份墨迹都没有）时 record=null（10.12「没有笔迹」，不借别次笔迹，I03）。
// - 纸上记录（D46 ⑬ / D47，P1-E78）：recordIndex 的 judged / days **不**过滤——纸上那天仍算「写过的日子」（日历、本周、签名里的天数）；
//   月字帖（monthSheet）与某一天的字（dayItems）画的是本人笔迹，只收 isWorkRecord，折叠月份用 foldWorkByDay 去掉只在纸上写过的字；
//   所以字数（chars）不计纸上字，只在纸上写过的字不出现在我的首页字帖，也不占 pickRecordInPeriod 的兜底。
// - 我的首页字帖（R-M05，边改 M03）：7 列，最多放最近 3 行（按整张字帖 7 列排好后的最后 3 行），多了给「全部 ›」。
// - 某一天的字（R-P05「点有记录的日子列出那天的字」）：那天 judged，同字只留一条，按最近一次的先后（与首页墨迹行同一口径，
//   core/records todayInkRow）；D42：留的这一条 = 那天内从晚到早第一条留有墨迹的，那天里都没有才留最近一次；折叠日子只有字，没有记录。

import * as defaultPolicy from '../../../config/policy.js';
import { addDays, addMonths, daysInMonth, isValidDay, isValidMonth, localDay, monthOf, parseDay } from '../../../core/dates.js';
import { foldWorkByDay, isJudged, isWorkRecord, sortById } from '../../../core/records.js';
import { pickRecordInPeriod, storedInkPresent } from '../../../core/ink-pick.js';

/** 我的首页字帖列数、最多行数（原型 L26 7 列；R-M05「最近 3 行」）。 */
export const MINE_SHEET_COLS = 7;
export const MINE_SHEET_ROWS = 3;
/** 练习记录字帖列数（原型 L91 5 列）。 */
export const RECORDS_SHEET_COLS = 5;
/** 一周七天，周一开头（原型 L26 / L89「一 二 三 四 五 六 日」）。 */
export const WEEK_LENGTH = 7;

// ---------------------------------------------------------------- 记录索引

/**
 * store 状态 → 记录索引：
 *   judged: 全部 judged 记录（含折叠月份 kept；按 id 升序）
 *   folded: {'YYYY-MM': {byDay, chars}}（折叠月份的日子与字）
 *   days:   Set<localDay>（有记录的日子）
 *   ink:    state.ink（按月分键的墨迹表，D42 挑留有墨迹的那一次时只查在不在）；没有为 null
 */
export function recordIndex(state) {
  const judged = [];
  const folded = {};
  const days = new Set();
  const months = (state && state.records && typeof state.records === 'object') ? state.records : {};
  for (const month of Object.keys(months)) {
    const value = months[month];
    if (Array.isArray(value)) {
      for (const r of value) if (isJudged(r)) judged.push(r);
    } else if (value && typeof value === 'object') {
      if (Array.isArray(value.kept)) for (const r of value.kept) if (isJudged(r)) judged.push(r);
      if (value.folded === true) {
        const byDay = {};
        for (const [day, chars] of Object.entries(value.byDay || {})) {
          if (!isValidDay(day) || !Array.isArray(chars) || !chars.length) continue;
          byDay[day] = chars.slice();
          days.add(day);
        }
        folded[month] = { byDay, chars: Array.isArray(value.chars) ? value.chars.slice() : [] };
        // 折叠时记下的「只在纸上写过」的字（D47，P1-E78）：只带过来，index.days / 日历不受影响；字帖与日子的字表用 foldWorkByDay 去掉它们。
        if (value.paperOnly && typeof value.paperOnly === 'object') folded[month].paperOnly = value.paperOnly;
      }
    }
  }
  const sorted = sortById(judged);
  for (const r of sorted) if (isValidDay(r.localDay)) days.add(r.localDay);
  const ink = state && state.ink && typeof state.ink === 'object' ? state.ink : null;
  return { judged: sorted, folded, days, ink };
}

/** D42：这条记录有没有存下的墨迹（按 index.ink 一次查找，不解码）。界面可另传含页面内笔画的 hasInk。 */
function inkChecker(index, hasInk) {
  if (typeof hasInk === 'function') return hasInk;
  const state = { ink: index && index.ink };
  return record => storedInkPresent(state, record);
}

/** 有没有任何有效记录（R-M04 空态的反面）。 */
export function hasRecords(index) {
  return index.days.size > 0;
}

/** 最早有记录的月份（练习记录「‹」到头变灰）；没有记录时 null。 */
export function firstRecordMonth(index) {
  let first = null;
  for (const day of index.days) if (!first || day < first) first = day;
  return first ? monthOf(first) : null;
}

// ---------------------------------------------------------------- 日期

/** 周一 = 0 … 周日 = 6。 */
export function weekdayIndex(day) {
  const { year, month, day: d } = parseDay(day);
  return (new Date(year, month - 1, d).getDay() + 6) % 7;
}

/** 这一周（R-M01；原型 L386）：今天所在的周一到周日；has = 这天有记录；今天红字；今天以后浅字。 */
export function weekModel(index, today) {
  const monday = addDays(today, -weekdayIndex(today));
  const out = [];
  for (let i = 0; i < WEEK_LENGTH; i += 1) {
    const day = addDays(monday, i);
    out.push({ day, n: parseDay(day).day, weekday: i, has: index.days.has(day), today: day === today, future: day > today });
  }
  return out;
}

/**
 * 月历（R-P01 / R-P05；原型 L413–L416）：前面补空格到周一开头，后面补到 7 的倍数。
 * cells：{blank:true} 或 {day, n, has, today, future}。
 */
export function calendarModel(index, month, today) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const cells = [];
  for (let i = 0; i < weekdayIndex(first); i += 1) cells.push({ blank: true, key: `b${i}` });
  const total = daysInMonth(y, m);
  for (let d = 1; d <= total; d += 1) {
    const day = `${month}-${d < 10 ? '0' + d : d}`;
    cells.push({ day, key: day, n: d, has: index.days.has(day), today: day === today, future: day > today });
  }
  let k = 0;
  while (cells.length % WEEK_LENGTH) cells.push({ blank: true, key: `t${k++}` });
  return cells;
}

/** 某月有记录的日子（升序）。 */
export function recordDaysInMonth(index, month) {
  return [...index.days].filter(day => day.startsWith(month + '-')).sort();
}

// ---------------------------------------------------------------- 月字帖

function retag(cells) {
  let prev = null;
  return cells.map(cell => {
    const tag = cell.day !== prev ? cell.day : null;
    prev = cell.day;
    return Object.assign({}, cell, { tag });
  });
}

/**
 * 某月字帖（R-P02 / R-M01 / P02 / D42）。
 * @param {object} index  recordIndex
 * @param {string} month
 * @param {{policy?:object, hasInk?:(record)=>boolean}} [o]  hasInk 缺省按 index.ink 存下的墨迹
 * @returns {{month, cells:[{char, day, record|null, tag:localDay|null}], days:number, chars:number, folded:boolean, pick}}
 *   days = 这个月有记录的天数（落款「有记录 N 天」，K27），chars = 字数（落款「N 个字」）。
 */
export function monthSheet(index, month, { policy = defaultPolicy, hasInk = null } = {}) {
  const pick = policy.monthSheetPick === 'last' ? 'last' : 'first';
  const has = inkChecker(index, hasInk);
  const days = recordDaysInMonth(index, month).length;
  const fold = index.folded[month];
  const inMonth = index.judged.filter(r => isWorkRecord(r) && typeof r.localDay === 'string' && r.localDay.startsWith(month + '-'));
  if (fold) {
    const firstDay = new Map();
    const workByDay = foldWorkByDay(fold);
    for (const day of Object.keys(workByDay).sort()) {
      for (const c of workByDay[day]) if (!firstDay.has(c)) firstDay.set(c, day);
    }
    const order = fold.chars.filter(c => firstDay.has(c));
    for (const c of firstDay.keys()) if (!order.includes(c)) order.push(c);
    order.sort((a, b) => (firstDay.get(a) < firstDay.get(b) ? -1 : firstDay.get(a) > firstDay.get(b) ? 1 : 0));
    // 折叠月份只剩 kept：只在 kept 里找（D42），找不到的字 record=null、日期取 byDay 里最早出现的那天。
    const keptOf = new Map();
    for (const r of inMonth) {
      if (!keptOf.has(r.char)) keptOf.set(r.char, []);
      keptOf.get(r.char).push(r);
    }
    const cells = retag(order.map(char => {
      const { record } = pickRecordInPeriod(keptOf.get(char), { prefer: pick, hasInk: has });
      return { char, day: record ? record.localDay : firstDay.get(char), record };
    }));
    return { month, cells, days, chars: cells.length, folded: true, pick };
  }
  const byChar = new Map(); // char → 本月该字的记录（id 升序）；插入顺序 = 本月第一次出现的先后
  for (const r of inMonth) {
    if (!byChar.has(r.char)) byChar.set(r.char, []);
    byChar.get(r.char).push(r);
  }
  const cells = retag([...byChar.values()].map(list => {
    // D42：本月内按偏好顺序找留有墨迹的那一次；一份都没有才取偏好方向上的那一条（如实没有笔迹）。
    const { record } = pickRecordInPeriod(list, { prefer: pick, hasInk: has });
    // 角标日期跟格子里的笔迹走（M02「格子里的笔迹和格子上标的日期对应」）。
    return { char: list[0].char, day: record.localDay, record };
  }));
  return { month, cells, days, chars: cells.length, folded: false, pick };
}

/**
 * 我的首页字帖预览（R-M05）：整张字帖按 cols 列排好，超过 rows 行时只放最后 rows 行，第一格重标角标。
 * @returns {{cells, truncated:boolean, hidden:number, total:number}}
 */
export function sheetPreview(sheet, { cols = MINE_SHEET_COLS, rows = MINE_SHEET_ROWS } = {}) {
  const total = sheet.cells.length;
  const totalRows = Math.ceil(total / cols);
  if (totalRows <= rows) return { cells: sheet.cells, truncated: false, hidden: 0, total };
  const start = (totalRows - rows) * cols;
  return { cells: retag(sheet.cells.slice(start)), truncated: true, hidden: start, total };
}

// ---------------------------------------------------------------- 某一天的字

/**
 * 某天写的字（R-P05；首页墨迹行「今天的记录」同一口径）：那天 judged，同字只留一条，按最近一次的先后。
 * 留的这一条 = 那天内从晚到早第一条留有墨迹的（D42），那天里都没有才留最近一次。折叠日子：byDay 的字，record=null。
 * @returns {[{char, record|null}]}
 */
export function dayItems(index, day, { hasInk = null } = {}) {
  if (!isValidDay(day)) return [];
  const fold = index.folded[monthOf(day)];
  if (fold) return (foldWorkByDay(fold)[day] || []).map(char => ({ char, record: null }));
  const has = inkChecker(index, hasInk);
  const byChar = new Map();
  for (const r of index.judged) {
    if (!isWorkRecord(r) || r.localDay !== day) continue;
    const list = byChar.get(r.char) || [];
    list.push(r);
    byChar.delete(r.char); // 顺序按最近一次的先后
    byChar.set(r.char, list);
  }
  return [...byChar.values()].map(list => ({ char: list[0].char, record: pickRecordInPeriod(list, { prefer: 'last', hasInk: has }).record }));
}

// ---------------------------------------------------------------- 页面模型

/** backupMeta.lastExportAt（ms）→ 本地日；没有备份过 null（R-M03「上次备份 {date} ›」/「还没有备份」）。 */
export function lastBackupDay(backupMeta) {
  const at = backupMeta && backupMeta.lastExportAt;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null;
  return localDay(at);
}

/**
 * 我的首页（R-M01–R-M05）。
 * @returns {{today, empty, week, month, sheet, preview, sheetOn, lastBackup, year}}
 */
export function mineModel(state, today, { policy = defaultPolicy, hasInk = null } = {}) {
  const index = recordIndex(state);
  const empty = !hasRecords(index);
  const month = monthOf(today);
  const sheet = monthSheet(index, month, { policy, hasInk });
  return {
    today,
    empty,
    week: weekModel(index, today),
    month,
    sheet,
    preview: sheetPreview(sheet),
    // 这个月还没有字时不画字帖块（原型 mineSheet=false 一态；空态同样不画，原型 mineEmpty）。
    sheetOn: !empty && sheet.cells.length > 0,
    lastBackup: lastBackupDay(state && state.backupMeta),
    year: parseDay(today).year,
  };
}

/** 把参数里的月份夹到 [最早有记录的月份, 本月]；不合法时回本月。 */
export function clampMonth(month, index, today) {
  const current = monthOf(today);
  const first = firstRecordMonth(index) || current;
  const lo = first < current ? first : current;
  if (!isValidMonth(month)) return current;
  if (month > current) return current;
  if (month < lo) return lo;
  return month;
}

/**
 * 练习记录（R-P01–R-P05）。
 * @param {{month?:string, day?:string, policy?:object, hasInk?:(record)=>boolean}} opts  month / day 来自页面参数（nav.setParams 写回）；
 *   hasInk（D42 挑留有墨迹的那一次）缺省按 state.ink
 * @returns {{today, month, year, monthNum, current:boolean, prev:string|null, next:string|null, calendar, recordDays:number,
 *   sheet, selected:{day, items}|null, todayRow:{day, n}|null, empty:boolean}}
 */
export function recordsModel(state, today, { month, day, policy = defaultPolicy, hasInk = null } = {}) {
  const index = recordIndex(state);
  const currentMonth = monthOf(today);
  const m = clampMonth(month, index, today);
  const first = firstRecordMonth(index);
  const { year, month: monthNum } = parseDay(`${m}-01`);
  const days = recordDaysInMonth(index, m);
  let selected = null;
  if (isValidDay(day) && day.startsWith(m + '-') && index.days.has(day)) selected = { day, items: dayItems(index, day, { hasInk }) };
  const todayItems = index.days.has(today) ? dayItems(index, today, { hasInk }) : [];
  return {
    today,
    month: m,
    year,
    monthNum,
    current: m === currentMonth,
    prev: first && m > first ? addMonths(m, -1) : null,
    next: m < currentMonth ? addMonths(m, 1) : null,
    calendar: calendarModel(index, m, today),
    recordDays: days.length,
    sheet: monthSheet(index, m, { policy, hasInk }),
    selected,
    // 页底「{今天}写的字 / 这次的图片」（R-P03）：只在本月、今天有记录时；历史月份没有这一行（原型 recordsHistory）。
    todayRow: m === currentMonth && todayItems.length ? { day: today, n: todayItems.length, items: todayItems } : null,
    empty: !hasRecords(index),
  };
}

