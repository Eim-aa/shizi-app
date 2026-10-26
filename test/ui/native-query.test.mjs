// B3.6 原生查字弹层与 S02 确认框的契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4「网页路径 == API 路径」）：
//   1. view.query = 网页弹层渲染用的同一个模型函数（views/query.js querySheetModel），文案只给 copy 键 + 参数、原生渲染出来一字不差；
//   2. query.add = 网页弹层的同一个 commit（views/query.js commitAdd）：整份 store deepEqual、commit 序列相同；已在自选里不写；
//   3. query.pick / query.detail = 网页弹层登记的同一个回调（onPractice / onPick / onDetail）：回 {ok:false} 时原生就地三段式；
//   4. view.s02 / s02.decide = 网页 S02 的同一批回调（接着写 / 结束那组开新的 / 取消）；D07：保存失败留在框内、store 不动；
//   5. 网页路径 == API 路径（会话层不导入 UI：动作回调由界面层登记，会话层只调用）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../store/helpers.mjs';
import { bootStore } from '../../src/store/store.js';
import { createRouter, setActiveRouter, nav } from '../../src/ui/router.js';
import { setClockOverride } from '../../src/platform/env.js';
import { createAppApi } from '../../src/session/api/index.js';
import { setQueryActions, setS02Actions, setQueryLayout, quoteChars } from '../../src/session/api/query.js';
import { querySheetModel, deckPredicates, commitAdd } from '../../src/session/views/query.js';
import { sheetModel } from '../../src/session/views/query.js';
import { t } from '../../src/config/copy/index.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setDeckSource } from '../../src/data/deck.js';
import '../../src/ui/screens/home/index.js'; // 注册 tab 根页（路由要有一个 tab）

// 真题库（node 里没有全局 SEED）：查字的「能不能练」与拼音索引都靠它（与 library-switch.test.mjs 同一份做法）
const deckCtx = {};
vm.createContext(deckCtx);
vm.runInContext(`${readFileSync(new URL('../../deck-data.js', import.meta.url), 'utf8')}\n;globalThis.__seed = SEED;`, deckCtx);
vm.runInContext(`${readFileSync(new URL('../../data/context-overrides.js', import.meta.url), 'utf8')}\n;globalThis.__ov = CONTEXT_OVERRIDES;`, deckCtx);
setDeckSource({ seed: deckCtx.__seed, overrides: deckCtx.__ov });

const NOW = '2026-10-05T19:30:00';
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

/** 同一组输入分别走网页路径与 API 路径：整份 store、commit 序列、路由栈都要一样。 */
function samePaths(seed, web, op, args = {}) {
  const a = boot(seed);
  const rWeb = web(a.store);
  const webOut = { state: a.store.getState(), labels: a.labels, stack: names(a.router) };
  const b = boot(seed);
  const rApi = b.api.call(op, args);
  assert.deepEqual(rApi, rWeb, `${op}: same reply`);
  assert.deepEqual(b.store.getState(), webOut.state, `${op}: whole store deepEqual`);
  assert.deepEqual(b.labels, webOut.labels, `${op}: same commit sequence`);
  assert.deepEqual(names(b.router), webOut.stack, `${op}: same route`);
  return { web: webOut, api: b, reply: rApi };
}

test('B3.6 view.query = the web sheet model, rendered word for word', () => {
  const { api, store } = boot();
  const state = store.getState();
  const predicates = deckPredicates(state.settings);
  const args = { mode: 'lookup', text: '永', cur: '', selected: [], state, predicates, getInk: (id) => store.getInk(id) };
  const v = api.call('view.query', { mode: 'lookup', text: '永' }).view;
  assert.deepEqual(v, querySheetModel(args), 'same function');
  // 网页弹层自己的模型（sheetModel）与 API 里的模型是同一份纯逻辑
  const m = sheetModel({ mode: 'lookup', text: '永', cur: '', selected: [], state, predicates });
  assert.equal(v.view, m.view);
  assert.equal(v.cur, m.cur);
  assert.equal(v.card.char, '永');
  assert.equal(t(v.title.key, v.title.vars), t('R-Q01.titleLookup'));
  assert.equal(t(v.card.meta.key, v.card.meta.vars), t('X-QUERY.cardMeta', { pinyin: v.card.pinyin, n: v.card.strokes }));
  assert.equal(t(v.card.stat.key, v.card.stat.vars), t('R-Q04.rowNone'));
  // lookup 没有底栏；pick 有（0 个字 = 真禁用）
  const p = api.call('view.query', { mode: 'pick', text: '永和' }).view;
  assert.equal(p.bar.disabled, true);
  assert.equal(t(p.bar.key, p.bar.vars), t('R-Q06.btnNone'));
  assert.equal(p.rows.length, 2);
  assert.equal(t(p.rows[0].status.key, p.rows[0].status.vars), t('R-Q04.rowNone'));
});

test('B3.6 view.query: input filtering notes and the pinyin branch are the web ones', () => {
  const { api } = boot();
  const v = api.call('view.query', { mode: 'lookup', text: 'a1' }).view;
  assert.equal(v.view, 'hint');
  assert.equal(v.notes.length, 1);
  assert.equal(t(v.notes[0].key, v.notes[0].vars), t('R-Q03.onlyHanzi'));
  const py = api.call('view.query', { mode: 'lookup', text: 'yong' }).view;
  assert.equal(py.view, 'rows');
  assert.ok(py.rows.length > 0, 'pinyin matches');
  assert.equal(py.notes.length, 0, 'pinyin letters are not "only Han"');
});

test('B3.6 query.add = the web commitAdd: same store, same commit sequence; already in the list writes nothing', () => {
  const { web, reply, api: b } = samePaths(null, (store) => {
    const r = commitAdd(store, '永');
    return { ok: r.ok === true };
  }, 'query.add', { char: '永' });
  assert.equal(reply.ok, true);
  assert.deepEqual(web.labels, ['query:add']);
  assert.equal(web.state.custom.added.length, 1);
  assert.equal(web.state.custom.added[0].char, '永');
  // 已在自选里：不写（网页 withCustomAdded 返回 null → 不产生 commit）
  const before = b.store.getState();
  const again = b.api.call('query.add', { char: '永' });
  assert.equal(again.ok, true);
  assert.deepEqual(b.store.getState(), before, 'the list did not change');
  assert.deepEqual(b.labels, ['query:add', 'query:add'], 'the web commit runs the same way (an empty commit)');
});

test('B3.6 D07: a failed add returns {ok:false}, the store does not move, the retry commits once', () => {
  const { api, store, storage, labels } = boot();
  const before = store.getState();
  storage.failNextWrite(1, { kind: 'generic' });
  const r = api.call('query.add', { char: '永' });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error.kind, 'string');
  assert.deepEqual(store.getState(), before, 'nothing written');
  assert.deepEqual(labels, []);
  assert.equal(api.call('query.add', { char: '永' }).ok, true);
  assert.equal(labels.length, 1);
});

test('B3.6 query.pick / query.detail call the callbacks the web sheet registered', async () => {
  const picked = [];
  const detailed = [];
  setQueryActions({
    mode: 'lookup',
    onPractice: (char) => { picked.push(char); return { ok: true }; },
    onPick: (chars) => { picked.push(chars.join('')); return { ok: true }; },
    onDetail: (char) => { detailed.push(char); return { ok: true }; },
  });
  try {
    const { api } = boot();
    assert.equal((await api.call('query.pick', { chars: ['永'], from: 'card' })).ok, true);
    assert.equal((await api.call('query.pick', { chars: ['永', '和'], from: 'bar' })).ok, true);
    assert.equal((await api.call('query.detail', { char: '永' })).ok, true);
    assert.deepEqual(picked, ['永', '永和']);
    assert.deepEqual(detailed, ['永']);
  } finally {
    setQueryActions(null);
  }
});

test('B3.6 query.pick: a callback that fails comes back as {ok:false} (the native sheet shows the three-stage block)', async () => {
  setQueryActions({ mode: 'pick', onPick: () => ({ ok: false, error: { kind: 'generic' } }) });
  try {
    const { api } = boot();
    const r = await api.call('query.pick', { chars: ['永'], from: 'bar' });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error.kind, 'string');
  } finally {
    setQueryActions(null);
  }
});

test('B3.6 query.pick: the callback can ask the sheet to close (the web side closes it before the write page)', async () => {
  let closed = false;
  setQueryActions({ mode: 'pick', onPick: (chars, api) => { api.close(); return { ok: true }; } });
  try {
    const { api } = boot();
    const r = await api.call('query.pick', { chars: ['永'], from: 'bar' });
    assert.equal(r.ok, true);
    assert.equal(r.close, true);
    assert.equal(closed, false);
  } finally {
    setQueryActions(null);
  }
});

test('B3.6 view.s02 = the web S02 body and buttons', () => {
  const { api } = boot();
  const v = api.call('view.s02', { chars: ['春', '日', '月'] }).view;
  assert.equal(t(v.body.key, v.body.vars), t('R-H05.body', { chars: quoteChars(['春', '日', '月']) }));
  assert.equal(t(v.continue.key, v.continue.vars), t('R-H05.continueOld'));
  assert.equal(t(v.endStart.key, v.endStart.vars), t('R-H05.endOldStartNew'));
  assert.equal(t(v.cancel.key, v.cancel.vars), t('R-H05.cancel'));
  assert.equal(t(v.fail.key, v.fail.vars), t('X-SESSION.s02SaveFailed'));
  assert.equal(quoteChars(['春', '日']), '「春」「日」');
});

test('B3.6 s02.decide: the three buttons call the web callbacks; a failed save stays in the box', async () => {
  const calls = [];
  setS02Actions({
    onContinue: () => calls.push('continue'),
    onEndStart: () => { calls.push('endStart'); return { ok: true }; },
    onStarted: () => calls.push('started'),
  });
  try {
    const { api } = boot();
    assert.deepEqual(await api.call('s02.decide', { action: 'continue' }), { ok: true, close: true });
    assert.deepEqual(await api.call('s02.decide', { action: 'endStart' }), { ok: true, close: true });
    assert.deepEqual(await api.call('s02.decide', { action: 'cancel' }), { ok: true, close: true });
    assert.deepEqual(calls, ['continue', 'endStart', 'started']);
  } finally {
    setS02Actions(null);
  }
  setS02Actions({ onEndStart: () => ({ ok: false, error: { kind: 'generic' } }) });
  try {
    const { api, store, labels } = boot();
    const before = store.getState();
    const r = await api.call('s02.decide', { action: 'endStart' });
    assert.equal(r.ok, false, 'the dialog stays in place');
    assert.deepEqual(store.getState(), before, 'nothing written');
    assert.deepEqual(labels, []);
  } finally {
    setS02Actions(null);
  }
});

test('B3.6 the session layer does not import the UI (the actions come from the interface layer)', () => {
  const src = readFileSync(new URL('../../src/session/api/query.js', import.meta.url), 'utf8');
  assert.ok(!/from '.*ui\//.test(src), 'no UI import in the session layer');
});

test('B3.6 the page\'s line break points travel with the model (the native breaks the Chinese text at the web\'s places)', () => {
  setQueryLayout({ s02Body: text => [3, 7], cardAction: text => [2] });
  try {
    const { api } = boot();
    const s02 = api.call('view.s02', { chars: ['春'] }).view;
    assert.deepEqual(s02.bodyLines, [3, 7], 'the body\'s line break points');
    const v = api.call('view.query', { mode: 'lookup', text: '永' }).view;
    assert.deepEqual(v.card.addLines, [2], 'the add button\'s line break points');
    assert.deepEqual(v.card.detailLines, [2], 'the records button\'s line break points');
  } finally {
    setQueryLayout(null);
  }
  // 没有页面登记（node:test）时没有折行点：原生按自己的宽度折行。
  const { api } = boot();
  const s02 = api.call('view.s02', { chars: ['春'] }).view;
  assert.equal(s02.bodyLines, undefined);
  const v = api.call('view.query', { mode: 'lookup', text: '永' }).view;
  assert.equal(v.card.addLines, undefined);
});
