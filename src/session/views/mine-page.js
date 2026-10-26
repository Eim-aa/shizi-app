// 「我的」首页（tab 根）的页面视图（B3.5c；网页 ui/screens/mine/index.js 与 App API 的 view.mine 同一组函数）。无 DOM。
//
// 在 mine.js 的 mineModel / settingsView / annualDefaultYear 之上，把这一页要画的东西都算好交给界面：概览三个数、字帖块（月字帖纸的格、角标、外框与格间线、落款与印）、
// 提醒 / 练习范围 / 外观 / 每组字数四行、备份 / 年度报告 / 关于三行、页底版本行。只给文案引用（键 + 参数）与数据，不拼句子（B3.4 规则）：网页用 tRef 渲染、原生用 ShiziCopy。
// 版式几何（字帖格宽 / 列数 / 外框 / 格间线）仍是 core/images/layout.js 的 sheetGrid（屏上与导出图同一个函数），原生只画不算。
// 墨迹（本人笔迹）不在这里取：调用方注入 strokesOf(record)（原生页给桥上的紧凑原始点，session/write-api.js sheetStrokes）。

import * as defaultPolicy from '../../config/policy.js';
import { ref } from '../../config/copy/index.js';
import { monthDayParts } from '../../core/dates.js';
import { monthCells } from '../../core/images/pick.js';
import { INK_PAD, MINE_SHEET_MAX_CHARS, dayTag, inkWidthScale, sheetColumns, sheetGrid, sheetTags } from '../../core/images/layout.js';
import { sealGlyphPath } from '../../core/images/shi-paths.js';
import { annualDefaultYear } from './annual.js';
import { inkOf, recordHasInk } from './detail.js';
import { kuanRef } from './kuan.js';
import { mineModel } from './mine.js';
import { APPEARANCE_ORDER, settingsView, timeText } from './settings.js';
import { versionRefs } from './about.js';

/** 本页各行的去处（网页 mine/records.js MINE_ROUTES 同一组屏名；test/ui/native-mine.test.mjs 核对）。 */
export const MINE_TARGETS = Object.freeze({ records: 'records', annual: 'annual', remind: 'remind', library: 'library-switch', backup: 'backup', about: 'about', detail: 'detail' });

/** 印的边长（网页 components/marks.js SEAL_PT；印只有一种）。 */
export const MINE_SEAL_PT = 24;

// ---------------------------------------------------------------- 字帖块

/** 一格的读屏名称（引用）：有墨「疆 · 9 月 2 日」，没墨「疆，这个月没有留下笔迹」；取到的墨迹在另一天时补一句「9 月 28 日 的笔迹」（N2-07）。 */
export function cellLabelRef(cell) {
  if (cell.mode === 'under') return ref('X-WORK.monthCellNoInk', { char: cell.ch });
  const date = cell.day ? ref('R-H02.dateFormat', monthDayParts(cell.day)) : '';
  const inkDay = cell.record && cell.record.localDay;
  if (inkDay && cell.day && inkDay !== cell.day) {
    return ref('X-WORK.cellInkDay', { char: cell.ch, date, inkDate: ref('R-H02.dateFormat', monthDayParts(inkDay)) });
  }
  return ref('X-MINE.cellLabel', { char: cell.ch, date });
}

/** 取墨函数 → pick.js 要的「有点列才算有墨」（与网页 builtInk 同一个判定：点列或原始笔画里至少有一笔非空）。 */
function pointsOfInk(ink) {
  if (!ink) return null;
  const pts = Array.isArray(ink.points) && ink.points.length ? ink.points : Array.isArray(ink.strokes) && ink.strokes.length ? ink.strokes : null;
  return pts && pts.some(s => Array.isArray(s) && s.length) ? pts : null;
}

/**
 * 月字帖的格（网页 mine/month.js monthModel 的会话层版；没有墨点列，只有记录与模式）。
 * @returns {{month, monthNum, cells:Array<{key, ch, mode, tag, day, record:string, rec:object|null, label}>, n, days, under:boolean, kuan:object|null}}
 */
export function monthSheetCells(state, month, { store = null, policy = defaultPolicy } = {}) {
  const r = monthCells(state, month, {
    inkOf: record => pointsOfInk(inkOf(store, record)),
    hasInk: record => recordHasInk(store, record),
    policy,
  });
  const cells = r.cells.map((cell, i) => ({
    key: `${cell.ch}-${i}`,
    ch: cell.ch,
    mode: cell.mode,
    tag: cell.tag,
    day: cell.day || '',
    record: cell.record ? cell.record.id : '',
    rec: cell.record || null,
    label: cellLabelRef(cell),
  }));
  return {
    month: r.month,
    monthNum: Number(r.month.slice(5)),
    cells,
    n: cells.length,
    days: r.days,
    under: cells.some(c => c.mode === 'under'),
    kuan: cells.length ? kuanRef({ month: r.month, n: cells.length }) : null,
  };
}

/**
 * 「我的」页字帖的成员：不超过一张（80 字，D39）时就是整月；超过只放最近的 80 个字，第一格重标日期（点进月字帖看全部）。
 * @returns {{cells, truncated:boolean, hidden:number, total:number}}
 */
export function trimSheetCells(cells, max = MINE_SHEET_MAX_CHARS) {
  const n = cells.length;
  if (n <= max) return { cells, truncated: false, hidden: 0, total: n };
  const tail = cells.slice(n - max);
  let prev = null;
  const tagged = tail.map(c => {
    const tag = c.day && c.day !== prev ? dayTag(c.day) : '';
    if (c.day) prev = c.day;
    return { ...c, tag };
  });
  return { cells: tagged, truncated: true, hidden: n - max, total: n };
}

/** 整月字数 → 「我的」页放几个字：两行（列数按整月字数定，月字帖页同一个规则 sheetColumns；AX 档四列，格子随字号放大，设计稿 AX5）。 */
export function mineSheetRows(n, ax = 0) {
  const cols = ax > 0 && n > 0 ? Math.min(4, sheetColumns(n)) : sheetColumns(n);
  return { cols, max: cols * 2 };
}

/**
 * 字帖块（网页 mine/index.js Sheet）。
 * @param {{store?, policy?, width:number, ax:number, strokesOf?:(record)=>Array}} o  width = 页宽（pt / CSS px）；ax = AX 档位 0–5
 */
export function mineSheetView(state, model, { store = null, policy = defaultPolicy, width, ax = 0, strokesOf = null } = {}) {
  const monthView = monthSheetCells(state, model.month, { store, policy });
  const { cols, max } = mineSheetRows(monthView.n, ax);
  const trimmed = trimSheetCells(monthView.cells, max || 1);
  const shown = trimmed.cells;
  const out = {
    month: model.month,
    monthNum: monthView.monthNum,
    title: ref('R-P02.sheetTitle', { month: monthView.monthNum }),
    aria: ref('X-WORK.monthTitle', { month: monthView.monthNum }),
    total: monthView.n,
    shown: shown.length,
    truncated: trimmed.truncated,
    days: model.sheet.days,
    all: monthView.n ? ref('R-M05.sheetAll', { n: monthView.n }) : null,
    empty: shown.length ? null : ref('X-MINE.sheetEmpty'),
    note: shown.length && monthView.under ? ref('X-WORK.monthUnderNote') : null,
    paper: null,
  };
  if (!shown.length) return out;
  const g = sheetGrid(shown.length, width - 40, { cols: trimmed.truncated || ax > 0 ? cols : 0 });
  const tags = sheetTags(shown);
  const sign = !trimmed.truncated;
  out.paper = {
    cols: g.cols, rows: g.rows, c: g.c, W: g.W, H: g.H, lastW: g.lastW, full: g.full, outline: g.outline, inner: g.inner,
    pad: INK_PAD, widthScale: inkWidthScale(g.c),
    sign,
    kuan: sign ? monthView.kuan : null,
    seal: { size: MINE_SEAL_PT, below: g.full, x: g.lastW + 8, y: g.H - MINE_SEAL_PT },
    sealPath: sealGlyphPath(),
    cells: shown.map((cell, i) => ({
      ch: cell.ch, mode: cell.mode, tag: tags[i], day: cell.day, record: cell.record, label: cell.label,
      x: g.cells[i].x, y: g.cells[i].y,
      strokes: cell.mode === 'hand' && cell.rec && typeof strokesOf === 'function' ? strokesOf(cell.rec) : [],
    })),
  };
  return out;
}

// ---------------------------------------------------------------- 设置行

/** 备份行的右值（D66 ⑱：≥ 30 天没备份 / 笔迹存储接近上限时写在右值里；否则上次备份日或「还没有备份」）。 */
export function backupValueRef(model) {
  const hint = model.backupHint;
  if (hint) return hint.kind === 'pressure' ? ref('X-MINE.backupNearFull') : ref('X-MINE.backupStale', { n: hint.days });
  return model.lastBackup ? ref('R-M03.lastBackup', { date: ref('R-H02.dateFormat', monthDayParts(model.lastBackup)) }) : ref('R-M03.noBackup');
}

/** 外观 / 每组字数两个几选一设置行的配置（网页 appearance.js / group-size.js 的 cfg）。 */
export function mineChoices(view, policy = defaultPolicy) {
  const appearance = {
    title: ref('R-S03.appearance'),
    value: view.appearance,
    valueText: ref(`R-S03.appearance.${view.appearance}`),
    options: APPEARANCE_ORDER.map(id => ({ id, label: ref(`R-S03.appearance.${id}`), aria: null, sheetLabel: ref(`R-S03.appearance.${id}`) })),
  };
  const sizeRef = n => ref('X-SETTINGS.groupSizeValue', { n });
  const groupSize = {
    title: ref('X-SETTINGS.groupSize'),
    value: view.groupSize,
    valueText: sizeRef(view.groupSize),
    options: policy.groupSizeOptions.map(n => ({ id: n, label: String(n), aria: sizeRef(n), sheetLabel: sizeRef(n) })),
  };
  return { appearance, groupSize };
}

// ---------------------------------------------------------------- 整页

/**
 * 「我的」首页（view.mine）。
 * @param {object} state  store 状态
 * @param {string} today  YYYY-MM-DD
 * @param {{store?, policy?, width?:number, ax?:number, build:{version:string, build:string}, storagePressure?, strokesOf?}} o
 */
export function mineView(state, today, { store = null, policy = defaultPolicy, width = 402, ax = 0, build, storagePressure, strokesOf = null } = {}) {
  const model = mineModel(state, today, { policy, hasInk: record => recordHasInk(store, record), storagePressure });
  const view = settingsView(state && state.settings);
  const annualYear = annualDefaultYear(state, today);
  const stat = (id, n, label, unit) => ({ id, n, label: ref(label), unit: ref(unit) });
  return {
    title: ref('X-TABS.mine'),
    today,
    month: model.month,
    empty: model.empty,
    overview: [
      stat('streak', model.overview.streak, 'X-MINE.ovStreak', 'X-MINE.ovDay'),
      stat('total', model.overview.total, 'X-MINE.ovTotal', 'X-MINE.ovDay'),
      stat('chars', model.overview.chars, 'X-MINE.ovChars', 'X-MINE.ovChar'),
    ],
    emptyBlock: model.empty ? { title: ref('R-M04.emptyTitle'), body: ref('R-M04.emptyBody') } : null,
    sheet: model.empty ? null : mineSheetView(state, model, { store, policy, width, ax, strokesOf }),
    remind: { label: ref('R-M03.remind'), on: view.on, time: view.on ? timeText(view.remind.hour, view.remind.minute) : null, off: ref('R-M03.remindOff'), to: MINE_TARGETS.remind },
    library: { label: ref('R-S01.library'), value: view.libraryName, id: view.library, to: MINE_TARGETS.library },
    appearanceOn: view.appearanceSwitch,
    choices: mineChoices(view, policy),
    choiceFail: { note: ref('X-SETTINGS.saveFailed'), cancel: ref('X-SETTINGS.cancel'), retry: ref('X-SETTINGS.retry') },
    done: ref('X-COMMON.done'),
    backup: { label: ref('R-M03.backup'), value: backupValueRef(model), last: model.lastBackup || '', hint: model.backupHint ? model.backupHint.kind : '', to: MINE_TARGETS.backup },
    annual: {
      label: ref('X-MINE.annual'), year: String(annualYear), to: MINE_TARGETS.annual,
      params: annualYear === model.year ? {} : { year: annualYear },
    },
    about: { label: ref('X-MINE.about'), to: MINE_TARGETS.about },
    records: { to: MINE_TARGETS.records, params: { month: model.month } },
    detail: { to: MINE_TARGETS.detail },
    version: versionRefs(build.version, build.build).line,
  };
}
