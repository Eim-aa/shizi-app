// B3.5c「我的」（tab 根）App API 契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4）：网页路径 == API 路径。
//   1. view.mine = 网页「我的」页渲染用的同一组函数（views/mine-page.js）；概览、字帖格、读屏名、落款、备份行、设置行的字与网页一字不差；
//   2. mine.appearance / mine.groupSize = 同一个提交函数（prefs-ops.js；网页 prefs.js 转出同一个）：整份 store 状态相同、提交顺序相同、D07 失败不写、stale（值没变）不写；
//   3. 根页开关（B3.5d 之前 tab 根页的原生版挡着）与原生栈对根页的认领。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, rec } from '../core/helpers.mjs';
import { createAppApi, listOps } from '../../src/session/api/index.js';
import * as policy from '../../src/config/policy.js';
import { ref, renderRefs, t, tRef } from '../../src/config/copy/index.js';
import { buildStroke, encodeInk } from '../../src/core/ink-math.js';
import { sheetGrid, sheetTags } from '../../src/core/images/layout.js';
import { mineModel } from '../../src/session/views/mine.js';
import { MINE_TARGETS, backupValueRef, cellLabelRef, mineChoices, mineSheetRows, mineSheetView, mineView, monthSheetCells, trimSheetCells } from '../../src/session/views/mine-page.js';
import { kuanRef } from '../../src/session/views/kuan.js';
import { settingsView } from '../../src/session/views/settings.js';
import { annualDefaultYear } from '../../src/session/views/annual.js';
import { commitAppearance, commitGroupSize } from '../../src/session/prefs-ops.js';
import * as prefs from '../../src/ui/screens/mine/prefs.js';
import * as mineIndex from '../../src/ui/screens/mine/index.js';
import { cellLabel, mineSheetModel, monthModel } from '../../src/ui/screens/mine/month.js';
import { MINE_ROUTES } from '../../src/ui/screens/mine/records.js';
import { kuan } from '../../src/ui/work-text.js';
import { nativeRootsEnabled, nativeRunBelow, nativeScreenOn } from '../../src/ui/native-stage.js';

const BUILD = { version: '1.0.0', build: '20261001-000000000000' };
const TODAY = '2026-10-22';
const INK = encodeInk([buildStroke([{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }], { final: true })]);

/** 十月里 n 个字（每天两个）；inked 里的记录有墨。 */
function stateWith(chars, { extra = {}, inked = new Set() } = {}) {
  const records = chars.map((ch, i) => rec(i + 1, ch, 'judged', 'correct', `2026-10-${String(1 + Math.floor(i / 2)).padStart(2, '0')}`));
  const state = { records: { '2026-10': records }, sessions: { A: null, B: null, lastEnded: {} }, settings: {}, ...extra };
  return { state, inked: new Set([...inked].map(i => `r${i + 1}`)) };
}

function fakeStore(state, inked = new Set(), { usage = null } = {}) {
  let cur = state;
  const store = {
    failures: 0,
    labels: [],
    status: { usage },
    getState: () => cur,
    getInk: r => (inked.has(r.id) ? INK : null),
    commit(label, fn) {
      store.labels.push(label);
      const draft = JSON.parse(JSON.stringify(cur));
      try {
        fn(draft, { now: 1, label, nextId: p => `${p}1` });
      } catch (error) {
        return { ok: false, error: { kind: 'mutator', reason: error.message } };
      }
      if (store.failures > 0) {
        store.failures -= 1;
        return { ok: false, error: { kind: 'generic' } };
      }
      cur = draft;
      return { ok: true, keys: [] };
    },
  };
  return store;
}

const CHARS = Array.from('永和春日月山水火木金土人大小中国学习写字书法天地花鸟风云雨雪');

function apiOf(store) {
  return createAppApi({ getStore: () => store, build: BUILD, native: true });
}

test('B3.5c op table: view.mine / mine.appearance / mine.groupSize', () => {
  const ops = listOps();
  for (const op of ['view.mine', 'mine.appearance', 'mine.groupSize']) assert.ok(ops.includes(op), op);
});

test('B3.5c view.mine = the same functions the web page renders (overview, sheet, rows, version)', () => {
  const { state, inked } = stateWith(CHARS, { inked: new Set([12, 13, 20, 25]) });
  const store = fakeStore(state, inked);
  const view = apiOf(store).call('view.mine', { width: 402, ax: 0, today: TODAY }).view;
  const model = mineModel(state, TODAY, { policy, hasInk: r => inked.has(r.id) });
  // 概览三个数与标签
  assert.deepEqual(view.overview.map(s => s.n), [model.overview.streak, model.overview.total, model.overview.chars]);
  assert.deepEqual(view.overview.map(s => [t(view.overview[0].label.copy) && tRef(s.label), tRef(s.unit)]), [['连续练习', '天'], ['累计练习', '天'], ['已练汉字', '字']]);
  assert.equal(view.empty, false);
  assert.equal(tRef(view.title), '我的');
  // 字帖：与网页 monthModel + mineSheetModel 同一批格（字、模式、角标、日、记录、读屏名），一样的几何
  const web = monthModel(state, model.month, { store, policy });
  const { cols, max } = mineSheetRows(web.n, 0);
  const shown = mineSheetModel(web, max);
  assert.equal(view.sheet.total, web.n);
  assert.equal(view.sheet.truncated, shown.truncated);
  assert.equal(view.sheet.shown, shown.model.n);
  const paper = view.sheet.paper;
  assert.deepEqual(paper.cells.map(c => [c.ch, c.mode, c.day, c.record, tRef(c.label)]), shown.model.cells.map(c => [c.ch, c.mode, c.day, c.record, c.label]));
  assert.deepEqual(paper.cells.map(c => c.tag), sheetTags(shown.model.cells));
  const g = sheetGrid(shown.model.n, 402 - 40, { cols: shown.truncated ? cols : 0 });
  assert.deepEqual([paper.cols, paper.rows, paper.c, paper.W, paper.H, paper.full], [g.cols, g.rows, g.c, g.W, g.H, g.full]);
  assert.deepEqual(paper.cells.map(c => [c.x, c.y]), g.cells.map(c => [c.x, c.y]));
  assert.equal(paper.outline, g.outline);
  assert.equal(paper.inner, g.inner);
  assert.equal(paper.sign, !shown.truncated, '只放最近两行时不画落款与印');
  assert.equal(paper.kuan, null);
  assert.equal(tRef(view.sheet.title), t('R-P02.sheetTitle', { month: 10 }));
  assert.equal(tRef(view.sheet.all), t('R-M05.sheetAll', { n: web.n }));
  assert.equal(tRef(view.sheet.note), t('X-WORK.monthUnderNote'), '有衬底字时才有说明句');
  // 有墨的格带笔画（桥上的紧凑原始点），没墨的格没有
  assert.ok(paper.cells.some(c => c.mode === 'hand' && c.strokes.length > 0));
  assert.ok(paper.cells.filter(c => c.mode === 'under').every(c => c.strokes.length === 0));
  // 行
  const sv = settingsView(state.settings);
  assert.equal(view.remind.on, false);
  assert.equal(tRef(view.remind.off), '关');
  assert.equal(view.remind.time, null);
  assert.equal(tRef(view.library.value), tRef(sv.libraryName));
  assert.equal(view.library.to, MINE_ROUTES.library);
  assert.equal(view.remind.to, MINE_ROUTES.remind);
  assert.equal(view.about.to, MINE_ROUTES.about);
  assert.equal(view.backup.to, MINE_ROUTES.backup);
  assert.equal(view.records.to, MINE_ROUTES.records);
  assert.equal(view.detail.to, MINE_ROUTES.detail);
  assert.equal(view.annual.to, MINE_ROUTES.annual);
  assert.deepEqual(MINE_TARGETS, MINE_ROUTES, '去处与网页同一组屏名');
  assert.equal(view.annual.year, String(annualDefaultYear(state, TODAY)));
  assert.deepEqual(view.annual.params, {});
  assert.equal(tRef(view.version), '版本 1.0.0（20261001）');
});

test('B3.5c view.mine: empty (no records) → empty block, no sheet', () => {
  const store = fakeStore({ records: {}, sessions: { A: null, B: null, lastEnded: {} }, settings: {} });
  const view = apiOf(store).call('view.mine', { today: TODAY }).view;
  assert.equal(view.empty, true);
  assert.equal(view.sheet, null);
  assert.equal(tRef(view.emptyBlock.title), t('R-M04.emptyTitle'));
  assert.equal(tRef(view.emptyBlock.body), t('R-M04.emptyBody'));
  assert.deepEqual(view.overview.map(s => s.n), [0, 0, 0]);
});

test('B3.5c sheet block: a small month signs (kuan + seal, same text as the web kuan()), AX uses at most four columns', () => {
  const { state, inked } = stateWith(Array.from('永和春日月山'), { inked: new Set([0, 1, 2, 3, 4, 5]) });
  const store = fakeStore(state, inked);
  const view = apiOf(store).call('view.mine', { width: 402, today: TODAY }).view;
  const paper = view.sheet.paper;
  assert.equal(paper.sign, true);
  assert.equal(tRef(paper.kuan), kuan({ month: '2026-10', n: 6 }));
  assert.equal(tRef(paper.kuan), '二〇二六年十月　六字');
  assert.equal(view.sheet.note, null, '整月全有墨：没有说明句');
  assert.equal(paper.seal.size, 24);
  assert.ok(paper.sealPath.length > 10);
  assert.deepEqual(paper.cells.map(c => c.tag), ['1', '', '2', '', '3', ''].map((x, i) => (i === 0 ? '1' : i % 2 ? '' : String(1 + i / 2))));
  // AX：列数最多 4
  const ax = apiOf(fakeStore(stateWith(CHARS, { inked: new Set([0]) }).state)).call('view.mine', { width: 402, ax: 3, today: TODAY }).view.sheet;
  assert.ok(ax.paper.cols <= 4);
  assert.equal(ax.shown, ax.paper.cols * 2);
});

test('B3.5c kuanRef renders the same text as the web kuan() for every shape (day / month / picked / part / brand)', () => {
  const shapes = [{ day: '2026-10-05', n: 2 }, { month: '2026-10', n: 46 }, { month: '2026-10' }, { day: '2026-10-04', n: 5, picked: true }, { day: '2026-10-04', n: 5, part: 2, of: 3 }, { brand: true }];
  for (const o of shapes) assert.equal(tRef(kuanRef(o)), kuan(o), JSON.stringify(o));
});

test('B3.5c backup row value: stale / pressure / recent / none (D66 ⑱) — one function, same strings as before', () => {
  const base = { empty: false, lastBackup: null, backupHint: null };
  assert.equal(tRef(backupValueRef(base)), t('R-M03.noBackup'));
  assert.equal(tRef(backupValueRef({ ...base, lastBackup: '2026-09-05' })), t('R-M03.lastBackup', { date: t('R-H02.dateFormat', { month: 9, day: 5 }) }));
  assert.equal(tRef(backupValueRef({ ...base, backupHint: { kind: 'stale', days: 113 } })), '113 天没有备份');
  assert.equal(tRef(backupValueRef({ ...base, backupHint: { kind: 'pressure' } })), t('X-MINE.backupNearFull'));
  // 整页：快满了 → 备份行是预警
  const { state, inked } = stateWith(CHARS);
  const store = fakeStore(state, inked, { usage: { level: 'warn', ratio: 0.86 } });
  const view = apiOf(store).call('view.mine', { today: TODAY }).view;
  assert.equal(view.backup.hint, 'pressure');
  assert.equal(tRef(view.backup.value), t('X-MINE.backupNearFull'));
});

test('B3.5c choices: appearance / group size labels, aria and AX value text come from the same copy as the web rows', () => {
  const c = mineChoices(settingsView({ appearance: 'dark', groupSize: 10 }));
  assert.deepEqual(c.appearance.options.map(o => [o.id, tRef(o.label)]), [['auto', '跟随系统'], ['light', '日间'], ['dark', '夜间']]);
  assert.equal(tRef(c.appearance.valueText), '夜间');
  assert.equal(tRef(c.appearance.title), '外观');
  assert.deepEqual(c.groupSize.options.map(o => [o.id, o.label, tRef(o.aria), tRef(o.sheetLabel)]), policy.groupSizeOptions.map(n => [n, String(n), `${n} 个`, `${n} 个`]));
  assert.equal(tRef(c.groupSize.valueText), '10 个');
  assert.equal(c.appearance.value, 'dark');
  assert.equal(c.groupSize.value, 10);
  assert.equal(tRef(ref('X-SETTINGS.saveFailed')), '没保存上，刚才的选择没记下。');
});

test('B3.5c write ops: mine.appearance / mine.groupSize run the same commit as the web (whole-store deepEqual, same commit order)', () => {
  for (const [op, commit, value] of [['mine.appearance', commitAppearance, 'dark'], ['mine.groupSize', commitGroupSize, 10]]) {
    const a = fakeStore(stateWith(CHARS).state);
    const b = fakeStore(stateWith(CHARS).state);
    const r = apiOf(a).call(op, { value });
    commit(b, value);
    assert.deepEqual(r, { ok: true, skipped: false });
    assert.deepEqual(a.getState(), b.getState());
    assert.deepEqual(a.labels, b.labels);
    // 值没变 = 不写（skipped）
    const again = apiOf(a).call(op, { value });
    assert.deepEqual(again, { ok: true, skipped: true });
    assert.equal(a.labels.length, 1);
  }
  const s = stateWith(CHARS).state;
  assert.equal(fakeStore(s).getState().settings.appearance, undefined);
  const x = fakeStore(s);
  apiOf(x).call('mine.appearance', { value: 'light' });
  assert.equal(x.getState().settings.appearance, 'light');
  assert.equal(settingsView(x.getState().settings).appearance, 'light');
});

test('B3.5c D07: a failed commit writes nothing and answers {ok:false, error:{kind}}; a retry of the same target writes once; invalid values are refused', () => {
  const store = fakeStore(stateWith(CHARS).state);
  const api = apiOf(store);
  const before = JSON.stringify(store.getState());
  store.failures = 1;
  const failed = api.call('mine.groupSize', { value: 30 });
  assert.deepEqual(failed, { ok: false, error: { kind: 'generic' } });
  assert.equal(JSON.stringify(store.getState()), before, 'a failed write leaves the store as it was');
  assert.deepEqual(api.call('mine.groupSize', { value: 30 }), { ok: true, skipped: false }, 'retry = same target once more');
  assert.equal(store.getState().settings.groupSize, 30);
  assert.deepEqual(api.call('mine.groupSize', { value: 7 }), { ok: false, error: { kind: 'invalid' } });
  assert.deepEqual(api.call('mine.appearance', { value: 'sepia' }), { ok: false, error: { kind: 'invalid' } });
  assert.equal(store.labels.length, 2, 'only the two real commit attempts reached the store');
});

test('B3.5c the web prefs module re-exports the session commit functions (one implementation, two callers)', () => {
  assert.equal(prefs.commitAppearance, commitAppearance);
  assert.equal(prefs.commitGroupSize, commitGroupSize);
  assert.equal(mineIndex.mineSheetRows, mineSheetRows);
  assert.equal(cellLabel({ mode: 'under', ch: '永' }), tRef(cellLabelRef({ mode: 'under', ch: '永' })));
});

test('B3.5c trimSheetCells = what the web mine page shows (last N, first corner tag recomputed)', () => {
  const cells = Array.from({ length: 30 }, (_, i) => ({ ch: String(i), day: `2026-10-${String(1 + Math.floor(i / 3)).padStart(2, '0')}`, tag: i % 3 === 0 ? String(1 + i / 3) : '' }));
  const r = trimSheetCells(cells, 16);
  assert.equal(r.truncated, true);
  assert.equal(r.cells.length, 16);
  assert.equal(r.hidden, 14);
  assert.ok(r.cells[0].tag !== '', 'the first shown cell re-tags its day');
  assert.deepEqual(trimSheetCells(cells, 40).cells, cells);
});

// ---------------------------------------------------------------- 根页开关与原生栈

test('B3.5c root switch: a tab root screen is native only when the roots flag is on; other native screens do not need it', async () => {
  await import('../../src/ui/screens/mine/index.js');
  await import('../../src/ui/screens/mine/about.js');
  const win = { __shiziNative: true, __shiziNativeWriteForce: true, __shiziNativeScreens: ['mine', 'about'] };
  assert.equal(nativeRootsEnabled(win), false);
  assert.equal(nativeScreenOn('mine', win), false, 'tab root: blocked until B3.5d');
  assert.equal(nativeScreenOn('about', win), true, 'a pushed page is not a root');
  win.__shiziNativeRoots = true;
  assert.equal(nativeScreenOn('mine', win), true);
  assert.equal(nativeScreenOn('home', win), false, 'no native class → web');
});

test('B3.5c native stack: the tab root joins the run below a native page only when the root is native', async () => {
  await import('../../src/ui/screens/mine/index.js');
  const snap = { stack: [{ k: 's', id: 'a', n: 'mine', p: {} }, { k: 's', id: 'b', n: 'about', p: {} }] };
  const win = { __shiziNative: true, __shiziNativeWriteForce: true, __shiziNativeScreens: ['mine', 'about'] };
  assert.deepEqual(nativeRunBelow(snap, 'b', false, win), []);
  win.__shiziNativeRoots = true;
  assert.deepEqual(nativeRunBelow(snap, 'b', false, win), [{ entryId: 'a', screen: 'mine', params: {} }]);
});

test('B3.5c Swift side: ShiziScreen_mine exists, is flagged native in the web screen, no Chinese literals, root flag injected by the shell', () => {
  const swift = fs.readFileSync(path.join(ROOT, 'ios/ShiziApp/ShiziApp/Screens/Mine.swift'), 'utf8');
  assert.match(swift, /@objc\(ShiziScreen_mine\)/);
  assert.doesNotMatch(swift.replace(/\/\/.*$/gm, ''), /[一-鿿]/, 'no Chinese literals in native code');
  const stage = fs.readFileSync(path.join(ROOT, 'ios/ShiziApp/ShiziApp/NativeStage.swift'), 'utf8');
  assert.match(stage, /__shiziNativeRoots/);
});
