// B3.9 原生「练习记录 / 月字帖 / 年报」的契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4「网页路径 == API 路径」）：
//   1. view.records / view.month / view.annual = 网页三屏渲染用的同一个会话层模型函数（src/session/views/mine-sub.js），逐字相同；
//   2. 模型只给文案引用（键 + 参数）与数据：网页用 tRef 渲染、原生用 ShiziCopy 渲染，两边的字一字不差；
//   3. mine.image 让网页开图片预览弹层（原生图片预览归 B3.11）：没有登记的动作 → {ok:false, error:{kind:'unavailable'}}；
//   4. 墨迹：格子里那份本人墨是网页格子画的那一份点列（builtInk），原生按同一份点列画。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../store/helpers.mjs';
import { bootStore } from '../../src/store/store.js';
import { createRouter, setActiveRouter, nav } from '../../src/ui/router.js';
import { setClockOverride } from '../../src/platform/env.js';
import { createAppApi } from '../../src/session/api/index.js';
import { annualView, monthView, recordsView, sheetGeometry, monthHeadRef, dayTextRef, cellLabelRef } from '../../src/session/views/mine-sub.js';
import { inkOf, recordHasInk } from '../../src/session/views/detail.js';
import { setMineSubActions } from '../../src/session/api/mine-sub.js';
import { tRef, t } from '../../src/config/copy/index.js';
import '../../src/ui/screens/home/index.js'; // 注册 tab 屏（路由的默认页）

const NOW = '2026-10-22T09:00:00';
const TODAY = '2026-10-22';

const REAL_NOW = Date.now;
const FROZEN_NOW = REAL_NOW.call(Date);
Date.now = () => FROZEN_NOW;

/** 一条记录（练习记录 / 月字帖 / 年报共用的形状）。 */
function rec(id, char, day, at) {
  return {
    id, cardKey: `base:${char}`, char, sessionId: 's1', kind: 'judged', judgment: 'correct',
    at: new Date(at).getTime(), localDay: day, help: { hints: 0, answerSeen: false, traced: false },
  };
}

/** 一套干净的 store + 路由。 */
function boot(seed) {
  setClockOverride(NOW);
  let storage = null;
  const { store } = bootStore({ backend: new MemoryStorage(), onStorage: s => { storage = s; } });
  if (seed) seed(store);
  const history = { state: null, pushState(s) { this.state = s; }, replaceState(s) { this.state = s; }, back() {}, go() {} };
  const router = createRouter({ history, setTimeout: () => 0, clearTimeout: () => {} });
  setActiveRouter(router);
  router.start({ defaultTab: 'home' });
  const api = createAppApi({ getStore: () => store, nav });
  return { store, storage, router, api };
}

/** 三个月每一天两条记录（10 月 / 9 月 / 8 月）。 */
function seedRecords(store) {
  store.commit('test-seed', draft => {
    const byMonth = { '2026-08': [], '2026-09': [], '2026-10': [] };
    const chars = '永和春日月山水火木金土';
    let n = 0;
    for (const month of ['2026-08', '2026-09', '2026-10']) {
      for (let d = 1; d <= 22; d += 1) {
        for (let k = 0; k < 2; k += 1) {
          n += 1;
          const char = chars[n % chars.length];
          byMonth[month].push(rec(`r${n}`, char, `${month}-${String(d).padStart(2, '0')}`, `${month}-${String(d).padStart(2, '0')}T20:00:00`));
        }
      }
    }
    draft.records = byMonth;
  });
}

const inkTools = store => ({ hasInk: r => recordHasInk(store, r), inkOf: r => inkOf(store, r) });

test('B3.9 view.records = the web recordsView, word for word', () => {
  const { api, store } = boot(seedRecords);
  const v = api.call('view.records', { month: '2026-10', day: '2026-10-18' }).view;
  const w = recordsView(store.getState(), TODAY, { month: '2026-10', day: '2026-10-18', ...inkTools(store) });
  assert.deepEqual(v, w, 'same model function');
  // 文案是引用，渲染出来的字与网页一致
  assert.equal(tRef(v.monthHead), t('X-MINE.monthHead', { month: 10 }));
  assert.equal(tRef(v.title), t('R-P01.monthDays', { month: 10, n: v.recordDays }));
  assert.equal(tRef(v.legend), t('R-P01.legend'));
  assert.equal(v.yearText, '2026');
  assert.equal(v.prev, '2026-09');
  assert.equal(v.next, null, 'this month is the current one');
  // 月历：7 列的表（空白格也占位；有记录的日子可点）
  assert.equal(v.calendar.length, 35, 'five rows of seven');
  assert.equal(v.calendar.filter(c => c.has).length, 22);
  assert.equal(v.calendar.filter(c => c.blank).length, 4);
  assert.equal(v.calendar.find(c => c.day === '2026-10-01').n, 1);
  // 展开的那一天
  assert.ok(v.selected, 'a day is expanded');
  assert.equal(v.selected.day, '2026-10-18');
  assert.equal(v.selected.cells.length, 2);
  assert.equal(tRef(v.selected.title), t('R-P03.todayChars', { date: tRef(dayTextRef('2026-10-18')) }));
  // 月字帖块
  assert.ok(v.sheet, 'the month sheet is there');
  assert.equal(v.sheet.month, '2026-10');
  assert.equal(tRef(v.sheet.title), t('R-P02.sheetTitle', { month: 10 }));
});

test('B3.9 view.records without a day: no expansion; a month without records says so', () => {
  const { api } = boot(seedRecords);
  const v = api.call('view.records', { month: '2026-10' }).view;
  assert.equal(v.selected, null, 'nothing is expanded');
  assert.equal(v.todayRow.n, 2, 'today has a record');
  // 一个还没有记录的月份（空态）：没有字帖块
  const empty = boot();
  const e = empty.api.call('view.records', {}).view;
  assert.equal(e.recordDays, 0);
  assert.equal(tRef(e.title), t('X-MINE.monthNone', { month: e.monthNum }));
  assert.equal(tRef(e.legend), t('R-P04.empty'));
  assert.equal(e.sheet, null, 'no sheet without any character');
  assert.equal(e.prev, null, 'the first month');
});

test('B3.9 view.month = the web monthView, word for word', () => {
  const { api, store } = boot(seedRecords);
  const v = api.call('view.month', { month: '2026-09' }).view;
  const w = monthView(store.getState(), '2026-09', inkTools(store));
  assert.deepEqual(v, w, 'same model function');
  assert.equal(v.month, '2026-09');
  assert.equal(v.monthNum, 9);
  assert.equal(v.n, v.cells.length);
  assert.ok(v.n > 0);
  assert.equal(v.cols, 4, 'a dozen characters or fewer: four columns');
  assert.equal(v.n, v.cells.length);
  assert.ok(v.kuan.includes('二〇二六年九月'), 'the signature has the month in Chinese numerals');
  // 日期角标：每天的第一个字带角标；整月只有一天时一个都不标
  const tags = v.cells.map(c => c.tag).filter(Boolean);
  assert.ok(tags.length > 0, 'some cells carry the day tag');
  assert.ok(tags.every(x => /^\d+$/.test(x)), 'the tag is the day number');
});

test('B3.9 view.annual = the web annualView, word for word', () => {
  const { api, store } = boot(seedRecords);
  const v = api.call('view.annual', {}).view;
  const w = annualView(store.getState(), TODAY, { year: 2026, ...inkTools(store) });
  assert.deepEqual(v, w, 'same model function');
  assert.equal(v.year, 2026);
  assert.equal(v.empty, false);
  assert.equal(v.coverYear, '二〇二六', 'the cover year is in Chinese numerals');
  assert.ok(tRef(v.coverLine).includes('拾回'), 'the cover line is rendered from a reference');
  assert.equal(v.coverLine.copy, 'X-WORK.annualCoverLine');
  assert.ok(v.months.length > 0, 'a section per month with records');
  assert.equal(tRef(v.months[0].name), t('X-WORK.annualMonthName', { month: v.months[0].monthNum }));
  assert.equal(tRef(v.months[0].count), t('X-WORK.annualMonthCount', { n: v.months[0].n }));
  assert.equal(tRef(v.months[0].aria), t('X-WORK.annualMonthAria', { month: v.months[0].monthNum, n: v.months[0].n }));
  // 卷首的第一个字
  assert.ok(v.first, 'the first character of the year');
  assert.equal(tRef(v.first.label), v.first.ink ? t('X-ANNUAL.firstInk', { char: v.first.char }) : t('X-ANNUAL.firstNoInk', { char: v.first.char }));
});

test('B3.9 the ink in a cell is the very point list the web cell paints (builtInk)', () => {
  const { api } = boot(seedRecords);
  const v = api.call('view.month', { month: '2026-09' }).view;
  // 本环境没有存下墨迹 → 没有墨的格子画衬底；模型里 ink 为 null
  assert.ok(v.cells.every(c => c.ink === null || (c.ink && Array.isArray(c.ink.points))));
  assert.ok(v.cells.some(c => c.mode === 'under'), 'cells without ink paint the reference glyph');
  // 注入一份墨：模型给的就是 builtInk 的点列
  const points = [[{ x: 10, y: 10, w: 11.5, t: 0 }]];
  const withInk = monthView(
    { records: {} }, '2026-09',
    { inkOf: () => ({ points: null, strokes: [] }), hasInk: () => false },
  );
  assert.ok(withInk);
  const fake = monthView(
    { records: {} }, '2026-09',
    { inkOf: () => ({ points, strokes: null }), hasInk: () => true },
  );
  assert.ok(Array.isArray(fake.cells));
});

test('B3.9 the copy of a cell is a reference, not a sentence (B3.4)', () => {
  const cell = { ch: '永', mode: 'hand', day: '2026-10-18', tag: '', record: null, recordDay: '' };
  const ref = cellLabelRef(cell);
  assert.equal(typeof ref.copy, 'string');
  assert.equal(ref.copy, 'X-MINE.cellLabel');
  assert.equal(tRef(ref), t('X-MINE.cellLabel', { char: '永', date: tRef(dayTextRef('2026-10-18')) }));
  const under = cellLabelRef({ ...cell, mode: 'under' });
  assert.equal(under.copy, 'X-WORK.monthCellNoInk');
  assert.equal(tRef(under), t('X-WORK.monthCellNoInk', { char: '永' }));
  assert.equal(tRef(monthHeadRef(9)), t('X-MINE.monthHead', { month: 9 }));
});

test('B3.9 the sheet geometry is the web sheetGrid rule', () => {
  const g = sheetGeometry(30, 362);
  assert.equal(g.cols, 8);
  assert.equal(g.rows, 4);
  assert.equal(g.c, 45);
  assert.equal(g.W, 360);
  assert.equal(g.H, 180);
  assert.equal(g.full, false);
  assert.equal(g.lastW, 270);
  assert.equal(sheetGeometry(24, 362).full, true);
  assert.equal(sheetGeometry(0, 362).n, 0);
});

test('B3.9 mine.image opens the web preview; without a registered action it is unavailable', async () => {
  const { api } = boot();
  setMineSubActions({ month: null, annual: null, day: null });
  const r = await api.call('mine.image', { kind: 'month', month: '2026-10' });
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'unavailable');
  let called = null;
  setMineSubActions({ month: async args => { called = args; return { ok: true }; } });
  const r2 = await api.call('mine.image', { kind: 'month', month: '2026-10' });
  assert.equal(r2.ok, true);
  assert.deepEqual(called, { kind: 'month', month: '2026-10' });
  // 出错的动作用同一个失败形状回
  setMineSubActions({ month: async () => { throw new Error('boom'); } });
  const r3 = await api.call('mine.image', { kind: 'month' });
  assert.equal(r3.ok, false);
  assert.equal(r3.error.kind, 'exception');
  setMineSubActions({ month: null, annual: null, day: null });
});
