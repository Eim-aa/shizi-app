// 我的子页（练习记录 / 月字帖 / 年报）的视图模型（B3.9；纯函数，无 DOM；网页 ui/screens/mine/ 与 App API 的 view.records / view.month / view.annual 同一组函数）。
//
// 只给文案引用（键 + 参数）与数据，不拼句子（B3.4 规则）；网页用 tRef 渲染、原生用 ShiziCopy 渲染，两边的渲染规则一样。
//
// 口径全部沿用已有的会话层模型（不重算）：
//   练习记录  views/mine.js recordsModel      （R-P01–R-P05：月历 / 那天写的字 / 月字帖块 / 今天的字那一行）
//   月字帖    core/images/pick.js monthCells    （D42：每字取本月留墨的第一次；没墨画衬底）
//   年报      views/annual.js annualModel      （D66 ⑪：看哪一年；卷首 / 每月一段 / 卷尾「同一个字，两次」）
//
// 墨迹：格子里的本人墨 = 网页格子画的那一份（views/detail.js inkOf → builtInk 的点列），原生按同一份点列画（ShiziKit 的 WebInk 画法）。
// 没有墨的格子画 under 衬底（标准字轮廓）。

import { ref, tRef } from '../../config/copy/index.js';
import * as defaultPolicy from '../../config/policy.js';
import { monthDayParts } from '../../core/dates.js';
import { lineStarts } from '../../core/line-starts.js';
import { sheetColumns, sheetTags, SHEET_MAX_CELL_PT } from '../../core/images/layout.js';
import { monthCells } from '../../core/images/pick.js';
import { sealGlyphPath } from '../../core/images/shi-paths.js';
import { builtInk } from '../../core/ink-build.js';
import { recordIndex, recordsModel } from './mine.js';
import { annualModel } from './annual.js';
import { annualCoverLineRef, annualYearText, kuanRef } from './kuan.js';

// ---------------------------------------------------------------- 文案引用小件

/** 「{月}月」（界面里的月份写法；月 / 日 / 年紧跟数字不留空格）。 */
export function monthHeadRef(monthNum) {
  return ref('X-MINE.monthHead', { month: monthNum });
}

/** 「{月}月{日}日」。 */
export function dayTextRef(day) {
  return ref('R-H02.dateFormat', monthDayParts(day));
}

/** 格子的读屏名（月字帖 / 年报：有墨 / 没墨两套；墨迹取自另一天时再说一句）。 */
export function cellLabelRef(cell) {
  if (cell.mode === 'under') return ref('X-WORK.monthCellNoInk', { char: cell.ch });
  return dayCellLabelRef(cell);
}

/** 某一天写的字那一格的读屏名（练习记录页：没有「没墨」的说法，一律「{字} · {日}」）。 */
export function dayCellLabelRef(cell) {
  const date = cell.day ? dayTextRef(cell.day) : '';
  const inkDay = cell.record && cell.record.localDay;
  if (inkDay && cell.day && inkDay !== cell.day) {
    return ref('X-WORK.cellInkDay', { char: cell.ch, date, inkDate: dayTextRef(inkDay) });
  }
  return ref('X-MINE.cellLabel', { char: cell.ch, date });
}

/** 一格 → 模型里的格子（ink = 网页格子画的那份点列；mode 决定画本人墨还是衬底）。 */
function cellModel(ch, record, mode, day, tag) {
  const out = {
    ch,
    ink: null,
    mode,
    tag: tag || '',
    day: day || '',
    recordId: record ? record.id : '',
    recordDay: record ? record.localDay : '',
  };
  out.label = cellLabelRef({ ...out, record });
  return out;
}

// ---------------------------------------------------------------- 月字帖

/**
 * 月字帖模型（网页月字帖页与练习记录页的字帖块共用；原生月字帖页用它）。
 * @param {object} state store 状态
 * @param {string} month YYYY-MM
 * @param {{policy?:object, hasInk?:(record)=>boolean, inkOf?:(record)=>{points,strokes}|null}} [o]
 */
export function monthView(state, month, { policy = defaultPolicy, hasInk = null, inkOf = null } = {}) {
  const r = monthCells(state, month, {
    inkOf: record => {
      const ink = inkOf ? inkOf(record) : null;
      return ink ? builtInk(ink) : null;
    },
    hasInk,
    policy,
  });
  const cells = r.cells.map((cell, i) => {
    const rec = cell.record || null;
    const ink = cell.ink ? { points: cell.ink } : null;
    const out = cellModel(cell.ch, rec, cell.mode, cell.day || '', cell.tag);
    out.key = `${cell.ch}-${i}`;
    out.ink = ink;
    return out;
  });
  // 日期角标：整页只有一天时一个都不标（网页 core/images/layout.js sheetTags；网页路径与 API 路径同一份）
  const tags = sheetTags(cells);
  cells.forEach((c, i) => { c.tag = tags[i]; });
  return {
    month: r.month,
    monthNum: Number(r.month.slice(5)),
    cells,
    n: cells.length,
    days: r.days,
    under: cells.some(c => c.mode === 'under'),
    // 落款（宋 13 / 20，右对齐；图形文字，不随字号放大）
    kuan: cells.length ? tRef(kuanRef({ month: r.month, n: cells.length })) : '',
    // 版式：列数（网页 sheetGrid 同一规则；格宽按屏宽算）
    cols: sheetColumns(cells.length),
    // 印（marks.js <Seal/> 的字形路径；原生按同一份路径画）
    seal: sealGlyphPath(),
    // 折行点（网页量的：副标题在 AX 档会折行，原生照网页的位置折）
    lines: { sub: lineStarts('month-sub', tRef(ref('X-MINE.sheetOrder'))) },
  };
}

/**
 * 字帖格的几何（网页 core/images/layout.js sheetGrid 同一规则；原生按屏宽算）。
 * @param {number} n 字数
 * @param {number} width 可用宽（pt）
 */
export function sheetGeometry(n, width) {
  if (!n) return { n: 0, cols: 0, rows: 0, c: 0, W: 0, H: 0, lastW: 0, full: true, cells: [] };
  const cols = sheetColumns(n);
  const rows = Math.ceil(n / cols);
  let c = Math.min(SHEET_MAX_CELL_PT, width / cols);
  c = Math.floor(c);
  const lastN = n - (rows - 1) * cols;
  return {
    n, cols, rows, c, W: cols * c, H: rows * c, lastW: lastN * c, full: lastN === cols,
    cells: Array.from({ length: n }, (_, i) => ({ x: (i % cols) * c, y: Math.floor(i / cols) * c, col: i % cols, row: Math.floor(i / cols) })),
  };
}

// ---------------------------------------------------------------- 练习记录

/**
 * 练习记录页的视图模型。
 * @param {object} state store 状态
 * @param {string} today YYYY-MM-DD
 * @param {{month?:string, day?:string, policy?:object, hasInk?:(record)=>boolean, inkOf?:(record)=>{points,strokes}|null}} o
 */
export function recordsView(state, today, { month, day, policy = defaultPolicy, hasInk = null, inkOf = null } = {}) {
  const model = recordsModel(state, today, { month, day, policy, hasInk });
  const inkPointsOf = record => {
    const ink = inkOf ? inkOf(record) : null;
    return ink ? builtInk(ink) : null;
  };
  // 月历：每一天（空白格也带上，网页按同一组格子排）
  const calendar = model.calendar.map(cell => ({
    key: cell.key,
    blank: !!cell.blank,
    day: cell.blank ? '' : cell.day,
    n: cell.blank ? 0 : cell.n,
    has: cell.blank ? false : !!cell.has,
    today: cell.blank ? false : !!cell.today,
    future: cell.blank ? false : !!cell.future,
  }));
  // 展开的那一天：那天写的字（同字只留一条）
  const selected = model.selected
    ? {
      day: model.selected.day,
      title: ref('R-P03.todayChars', { date: dayTextRef(model.selected.day) }),
      paper: model.selected.items.length === 0,
      paperNote: ref('X-MINE.paperDayNote'),
      cells: model.selected.items.map(it => {
        const points = inkPointsOf(it.record);
        const out = cellModel(it.char, it.record, points ? 'hand' : 'under', model.selected.day, '');
        out.key = `d-${it.char}`;
        out.ink = points ? { points } : null;
        out.label = dayCellLabelRef({ ...out, record: it.record });
        return out;
      }),
    }
    : null;
  const titleRef = model.recordDays ? ref('R-P01.monthDays', { month: model.monthNum, n: model.recordDays }) : ref('X-MINE.monthNone', { month: model.monthNum });
  const legendRef = model.recordDays ? ref('R-P01.legend') : ref('R-P04.empty');
  const dayList = model.dayList.map(row => ({
    day: row.day,
    n: row.n,
    today: row.today,
    label: row.n ? ref('X-MINE.axDayRow', { date: dayTextRef(row.day), n: row.n }) : ref('X-MINE.axDayRowPaper', { date: dayTextRef(row.day) }),
  }));
  const sheet = monthSheetOf(state, model.month, { policy, hasInk, inkOf });
  const sheetUnder = !!(sheet && sheet.n > 0 && sheet.under);
  return {
    today,
    month: model.month,
    year: model.year,
    monthNum: model.monthNum,
    current: model.current,
    prev: model.prev,
    next: model.next,
    monthHead: monthHeadRef(model.monthNum),
    yearText: String(model.year),
    title: titleRef,
    legend: legendRef,
    weekdays: ref('X-MINE.weekdays'),
    calendar,
    recordDays: model.recordDays,
    dayList: dayList,
    selected,
    sheet,
    todayRow: model.todayRow
      ? {
        day: model.todayRow.day,
        n: model.todayRow.n,
        title: ref('R-P03.todayChars', { date: dayTextRef(model.todayRow.day) }),
        note: ref('R-P03.todayImage'),
      }
      : null,
    // 印（marks.js <Seal/> 的字形路径；原生按同一份路径画）
    seal: sealGlyphPath(),
    // 折行点（网页量的：标题 / 图例在 AX 档会折行，原生照网页的位置折）
    lines: {
      title: lineStarts('records-title', tRef(titleRef)),
      legend: lineStarts('records-legend', tRef(legendRef)),
      dayRows: dayList.map(row => lineStarts('records-axrow', tRef(row.label))),
      paperday: selected ? lineStarts('records-paperday', tRef(selected.paperNote)) : null,
      daylistTitle: selected ? lineStarts('records-daylist-title', tRef(selected.title)) : null,
      sheetNote: sheetUnder ? lineStarts('records-sheet-note', tRef(ref('X-WORK.monthUnderNote'))) : null,
    },
  };
}

/** 练习记录页里的月字帖块（网页 MonthBody 那一块；这个月没有字 → null）。 */
export function monthSheetOf(state, month, { policy = defaultPolicy, hasInk = null, inkOf = null } = {}) {
  const r = monthCells(state, month, {
    inkOf: record => {
      const ink = inkOf ? inkOf(record) : null;
      return ink ? builtInk(ink) : null;
    },
    hasInk,
    policy,
  });
  if (!r.cells.length) return null;
  const cells = r.cells.map((cell, i) => {
    const rec = cell.record || null;
    const out = cellModel(cell.ch, rec, cell.mode, cell.day || '', cell.tag);
    out.key = `${cell.ch}-${i}`;
    out.ink = cell.ink ? { points: cell.ink } : null;
    return out;
  });
  // 日期角标：整月只有一天时一个都不标（网页 sheetTags）
  const tags = sheetTags(cells);
  cells.forEach((c, i) => { c.tag = tags[i]; });
  return {
    month: r.month,
    monthNum: Number(r.month.slice(5)),
    cells,
    n: cells.length,
    days: r.days,
    under: cells.some(c => c.mode === 'under'),
    kuan: tRef(kuanRef({ month: r.month, n: cells.length })),
    cols: sheetColumns(cells.length),
    folded: !!recordIndex(state).folded[r.month],
    title: ref('R-P02.sheetTitle', { month: Number(r.month.slice(5)) }),
    // 印（marks.js <Seal/> 的字形路径）
    seal: sealGlyphPath(),
  };
}

// ---------------------------------------------------------------- 年报

/**
 * 年报页的视图模型。
 * @param {object} state store 状态
 * @param {string} today YYYY-MM-DD
 * @param {{year?:number|null, policy?:object, hasInk?:(record)=>boolean, inkOf?:(record)=>{points,strokes}|null}} [o]
 */
export function annualView(state, today, { year = null, policy = defaultPolicy, hasInk = null, inkOf = null } = {}) {
  const model = annualModel(state, today, { hasInk, policy, year });
  const inkPointsOf = record => {
    const ink = inkOf ? inkOf(record) : null;
    return ink ? builtInk(ink) : null;
  };
  const cellOf = (ch, record) => {
    const points = inkPointsOf(record);
    const out = cellModel(ch, record, points ? 'hand' : 'under', '', '');
    out.ink = points ? { points } : null;
    return out;
  };
  const firstInk = model.first && model.first.record ? inkPointsOf(model.first.record) : null;
  const first = model.first
    ? {
      char: model.first.char,
      day: model.first.day,
      recordId: model.first.record ? model.first.record.id : '',
      ink: firstInk ? { points: firstInk } : null,
      label: firstInk ? ref('X-ANNUAL.firstInk', { char: model.first.char }) : ref('X-ANNUAL.firstNoInk', { char: model.first.char }),
      date: firstInk ? ref('R-M06.inkDate', { date: dayTextRef(model.first.day) }) : dayTextRef(model.first.day),
    }
    : null;
  const months = model.months.map(m => {
    const r = monthCells(state, m.month, {
      inkOf: record => {
        const points = inkPointsOf(record);
        return points ? points : null;
      },
      hasInk,
      policy,
    });
    return {
      month: m.month,
      monthNum: m.monthNum,
      n: r.cells.length,
      name: ref('X-WORK.annualMonthName', { month: m.monthNum }),
      count: ref('X-WORK.annualMonthCount', { n: r.cells.length }),
      aria: ref('X-WORK.annualMonthAria', { month: m.monthNum, n: r.cells.length }),
      cells: r.cells.map(cell => cellOf(cell.ch, cell.record)),
    };
  });
  const twice = model.twice
    ? {
      char: model.twice.char,
      title: ref('X-WORK.annualTwiceTitle'),
      first: {
        recordId: model.twice.first.record.id,
        day: model.twice.first.day,
        ink: (() => { const points = inkPointsOf(model.twice.first.record); return points ? { points } : null; })(),
        label: ref('X-WORK.annualFirstCellAria', { char: model.twice.char }),
        date: dayTextRef(model.twice.first.day),
      },
      last: {
        recordId: model.twice.last.record.id,
        day: model.twice.last.day,
        ink: (() => { const points = inkPointsOf(model.twice.last.record); return points ? { points } : null; })(),
        label: ref('X-WORK.annualLastCellAria', { char: model.twice.char }),
        date: dayTextRef(model.twice.last.day),
      },
    }
    : null;
  const coverLine = annualCoverLineRef(model.count);
  return {
    today,
    year: model.year,
    years: model.years,
    prevYear: model.prevYear,
    nextYear: model.nextYear,
    empty: model.empty,
    count: model.count,
    days: model.days,
    // 卷首：年份（汉字数字）与一句话（字数为汉字数字）
    coverYear: annualYearText(model.year),
    coverLine,
    first,
    months,
    twice,
    emptyTitle: ref('R-M06.emptyTitle'),
    emptyBody: ref('R-M06.emptyBody'),
    emptyGlyph: ref('X-ANNUAL.emptyGlyph'),
    adjust: ref('X-WORK.adjustImage'),
    adjustAria: ref('X-WORK.adjustAria'),
    save: ref('R-M01.saveImage'),
    // 印（marks.js <Seal/> 的字形路径）
    seal: sealGlyphPath(),
    // 折行点（网页量的：卷首那句与今年首字在 AX 档会折行，原生照网页的位置折）
    lines: {
      head: lineStarts('annual-head', tRef(coverLine)),
      firstDate: first ? lineStarts('annual-first-date', tRef(first.date)) : null,
    },
  };
}
