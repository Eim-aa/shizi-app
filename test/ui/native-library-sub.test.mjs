// B3.8 原生字库子页的契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4「网页路径 == API 路径」）：
//   1. view.library-list / view.library-all / view.library-switch = 网页页面渲染用的**同一个模型函数**的结果（同一个函数对象，deepEqual）；
//   2. 写入 op（library.list.start / library.all.start / library.switch）调的是网页同一个函数：同一组输入分别走两条路，整份 store deepEqual、commit 序列相同、路由栈相同；
//   3. D07：写失败回 {ok:false, error:{kind}}、store 不动，重试只记一次；
//   4. native:true 的屏 ⇔ Swift 里 @objc(ShiziScreen_<屏名>) 的类（两边集合相等）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MemoryStorage } from '../store/helpers.mjs';
import { bootStore } from '../../src/store/store.js';
import { createRouter, setActiveRouter, nav } from '../../src/ui/router.js';
import { setClockOverride, now as envNow } from '../../src/platform/env.js';
import { createAppApi } from '../../src/session/api/index.js';
import { replyOf } from '../../src/session/api/library-sub.js';
import { listModel } from '../../src/session/views/library-list.js';
import { allModel } from '../../src/session/views/library-all.js';
import { libraryRows } from '../../src/session/views/library-switch.js';
import { setCardResolver } from '../../src/data/deck.js';
import { localDay } from '../../src/core/dates.js';
import * as defaultPolicy from '../../src/config/policy.js';
import { tRef } from '../../src/config/copy/index.js';
import * as listScreen from '../../src/ui/screens/library/list.js';
import * as allScreen from '../../src/ui/screens/library/all.js';
import * as switchScreen from '../../src/ui/screens/library/switch.js';
import * as home from '../../src/ui/screens/home/index.js';

const NOW = '2026-10-22T09:00:00';

// 两条路径各 boot 一次，两次之间真实时钟会走过一两毫秒：把 Date.now 冻在同一个瞬间，两条路径的时刻就逐字相同。
const REAL_NOW = Date.now;
const FROZEN_NOW = REAL_NOW.call(Date);
Date.now = () => FROZEN_NOW;

/** 一套干净的 store + 路由（每条路径各一套，同一时钟）。 */
function boot(seed) {
  setClockOverride(NOW);
  let storage = null;
  const { store } = bootStore({ backend: new MemoryStorage(), onStorage: s => { storage = s; } });
  if (seed) seed(store);
  const history = { state: null, pushState(s) { this.state = s; }, replaceState(s) { this.state = s; }, back() {}, go() {} };
  const router = createRouter({ history, setTimeout: () => 0, clearTimeout: () => {} });
  setActiveRouter(router);
  router.start({ defaultTab: 'home' });
  const labels = [];
  store.subscribe((state, info) => { if (info && info.type === 'commit') labels.push(info.label); });
  const api = createAppApi({ getStore: () => store, nav });
  return { store, storage, router, api, labels };
}

const names = r => r.getState().stack.map(e => e.n);

/** 两条路径各跑一遍，比整份 store、commit 序列、路由栈。 */
function samePaths(seed, web, op, args = {}) {
  const a = boot(seed);
  const rWeb = replyOf(web());
  const webOut = { state: a.store.getState(), labels: a.labels, stack: names(a.router) };
  const b = boot(seed);
  const rApi = b.api.call(op, args);
  assert.deepEqual(rApi, rWeb, `${op}: same reply`);
  assert.deepEqual(b.store.getState(), webOut.state, `${op}: whole store deepEqual`);
  assert.deepEqual(b.labels, webOut.labels, `${op}: same commit sequence`);
  assert.deepEqual(names(b.router), webOut.stack, `${op}: same route`);
  return { web: webOut, api: b, reply: rApi };
}

/** 造几条记录（写对 / 写错 / 跳过），字库三档与清单页都要用。 */
function seedRecords(store) {
  store.commit('test-seed', draft => {
    const mk = (i, char, day, judgment) => ({
      id: `r${i}`, cardKey: `base:${char}`, char, sessionId: `s${i}`, kind: 'judged', judgment,
      at: Date.parse(`${day}T09:00:00`), localDay: day, help: { hints: 0, answerSeen: false, traced: false },
    });
    draft.records = {
      '2026-10': [mk(1, '永', '2026-10-20', 'correct'), mk(2, '和', '2026-10-21', 'wrong')],
      '2026-09': [mk(3, '春', '2026-09-20', 'correct')],
    };
    draft.sched = {};
  });
}

/** 假题库：这几个字有卡（可练、有词语与拼音），别的没有。 */
const CARDS = new Map([
  ['base:永', { key: 'base:永', target: '永', word: '永久', py: 'yong3' }],
  ['base:和', { key: 'base:和', target: '和', word: '和平', py: 'he2' }],
  ['base:春', { key: 'base:春', target: '春', word: '春天', py: 'chun1' }],
]);
setCardResolver(key => (CARDS.has(key) ? CARDS.get(key) : undefined));

test('B3.8 view.library-list = the web list model (same function object), rendered word for word', () => {
  const { api, store } = boot(seedRecords);
  const state = store.getState();
  const v = api.call('view.library-list', { kind: 'due' }).view;
  const model = listModel(state, {
    kind: 'due', sel: null, today: localDay(envNow()), policy: defaultPolicy,
    cardFor: k => (CARDS.get(k) || null), practicable: k => CARDS.has(k),
  });
  assert.deepEqual(v, model, 'same model');
  assert.equal(tRef(v.title), tRef(model.title));
  assert.equal(tRef(v.head), tRef(model.head));
  assert.equal(tRef(v.top), tRef(model.top));
  assert.equal(tRef(v.hint), tRef(model.hint));
  assert.equal(tRef(v.button.label), tRef(model.button.label));
  // 勾选状态：sel = null 时是默认（最该练的前 N 个）；给了 sel 就是那几个字
  const someChar = v.rows.length ? v.rows[0].char : '和';
  const v2 = api.call('view.library-list', { kind: 'due', sel: [someChar] }).view;
  assert.equal(v2.rows.filter(r => r.selected).length, 1);
  assert.equal(v2.rows.find(r => r.char === someChar).selected, true);
  assert.deepEqual(v2.selectedKeys, listModel(state, {
    kind: 'due', sel: [someChar], today: localDay(envNow()), policy: defaultPolicy,
    cardFor: k => (CARDS.get(k) || null), practicable: k => CARDS.has(k),
  }).selectedKeys);
});

test('B3.8 view.library-all = the web all model (same function object)', () => {
  const { api, store } = boot(seedRecords);
  const state = store.getState();
  const args = { sort: 'recent', filter: '', fold: {}, find: '', width: 402, large: false };
  const v = api.call('view.library-all', args).view;
  const model = allModel(state, {
    today: localDay(envNow()), policy: defaultPolicy, compact: false, width: 402,
    sort: 'recent', filter: '', fold: {}, find: '', pyOf: c => (CARDS.get(`base:${c}`) || {}).py || '', practicable: k => CARDS.has(k),
  });
  assert.deepEqual(v, model, 'same model');
  assert.equal(v.cols, model.cols);
  assert.deepEqual(v.sorts.map(s => s.key), ['recent', 'py', 'age']);
  assert.deepEqual(v.chips.map(c => c.key), ['due', 'shaky', 'known', 'unw', 'custom']);
  // 拼音排序：每格带拼音
  const py = api.call('view.library-all', { ...args, sort: 'py' }).view;
  assert.equal(py.sort, 'py');
  assert.ok(py.groups.some(g => g.cells.some(c => c.py)), 'pinyin labels');
});

test('B3.8 view.library-switch = the web library rows (same function object)', () => {
  const { api, store } = boot(seedRecords);
  const v = api.call('view.library-switch', {}).view;
  assert.deepEqual(v, libraryRows(store.getState()), 'same rows');
  assert.equal(v.length, 4);
  assert.equal(v.filter(r => r.current).length, 1);
  assert.equal(tRef(v[0].name), tRef(libraryRows(store.getState())[0].name));
});

test('B3.8 library.list.start = web startListKeys: same store, commits and route', () => {
  const result = samePaths(seedRecords, () => listScreen.startListKeys(['base:永'], 'dueList'), 'library.list.start', { keys: ['base:永'], view: 'dueList' });
  assert.equal(result.reply.ok, true);
  assert.ok(result.web.labels.length >= 1, 'one commit');
});

test('B3.8 library.all.start = web startAllGroup: same store, commits and route', () => {
  const result = samePaths(seedRecords, () => allScreen.startAllGroup({ kind: 'start', keys: ['base:永'] }), 'library.all.start', { kind: 'start', keys: ['base:永'] });
  assert.equal(result.reply.ok, true);
  assert.ok(result.web.labels.length >= 1, 'one commit');
});

test('B3.8 library.switch = web switchLibrary: same store, commits and route', () => {
  const result = samePaths(seedRecords, () => switchScreen.switchLibrary('rare'), 'library.switch', { id: 'rare' });
  assert.equal(result.reply.ok, true);
  assert.equal(result.api.store.getState().settings.library, 'rare');
  assert.deepEqual(result.web.labels, ['library:switch']);
});

test('B3.8 D07: a failed switch returns {ok:false, error:{kind}}, the store does not move, the retry commits once', () => {
  const { api, store, storage, labels } = boot(seedRecords);
  const before = store.getState();
  storage.failNextWrite(1, { kind: 'generic' });
  const r = api.call('library.switch', { id: 'rare' });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error.kind, 'string');
  assert.deepEqual(store.getState(), before, 'nothing written');
  assert.deepEqual(labels, []);
  const again = api.call('library.switch', { id: 'rare' });
  assert.equal(again.ok, true);
  assert.equal(labels.length, 1, 'one commit for the retry');
});

test('B3.8 the three library sub screens are registered as native screens', () => {
  // 网页这一侧：三个屏都注册了（import 即注册）
  assert.ok(listScreen.LIST_SCREEN === 'library-list');
  assert.ok(allScreen.ALL_SCREEN === 'library-all');
  assert.ok(switchScreen.LIBRARY_SWITCH_SCREEN === 'library-switch');
  assert.ok(home, 'home module');
  // 原生这一侧：Swift 里有 @objc(ShiziScreen_library_list / _library_all / _library_switch)
  const dir = new URL('../../ios/ShiziApp/ShiziApp/Screens/', import.meta.url);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.swift'));
  const all = files.map(f => fs.readFileSync(new URL(f, dir), 'utf8')).join('\n');
  for (const cls of ['ShiziScreen_library_list', 'ShiziScreen_library_all', 'ShiziScreen_library_switch']) {
    assert.ok(all.includes(`@objc(${cls})`), `${cls} exists`);
  }
});
