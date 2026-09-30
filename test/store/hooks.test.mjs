// platform/env.js 的 isTestHost 规则与 platform/test-hooks.js：生产形态不挂载；测试宿主下钩子可用，
// getWriteLog 能区分经由 storage.js 的写与绕过它的直接写；reset 保留 shizi.nativeSmoke.v1。
import test from 'node:test';
import assert from 'node:assert/strict';
import { isNativeShell, isStandalone, isTestHost, now, setClockOverride } from '../../src/platform/env.js';
import { mountTestHooks } from '../../src/platform/test-hooks.js';
import { createStorage } from '../../src/store/storage.js';
import { createStore } from '../../src/store/store.js';
import { KEYS, NATIVE_SMOKE_KEY } from '../../src/core/schema.js';
import { MemoryStorage, baselineState, judgeMutation } from './helpers.mjs';

function fakeWin(href, extra = {}) {
  const url = new URL(href);
  return Object.assign({ location: { search: url.search, hostname: url.hostname } }, extra);
}

test('isTestHost: test=1 AND (localhost/127.0.0.1 OR __shiziNativeDev===true)', () => {
  const yes = [
    'http://localhost:8000/?test=1',
    'http://127.0.0.1:8765/index.html?dev=1&test=1',
  ];
  const no = [
    'http://localhost:8000/',
    'http://localhost:8000/?test=0',
    'http://localhost:8000/?test=true',
    'http://localhost:8000/#test=1',
    'https://eim-aa.github.io/shizi-app/?test=1',
    'https://example.com/?test=1',
    'http://192.168.1.5:8000/?test=1',
    'http://[::1]:8000/?test=1',
    'shizi-app://app/index.html?test=1',
  ];
  for (const href of yes) assert.equal(isTestHost(fakeWin(href)), true, href);
  for (const href of no) assert.equal(isTestHost(fakeWin(href)), false, href);
  // iOS DEBUG 壳：自定义 scheme + 注入 __shiziNativeDev
  assert.equal(isTestHost(fakeWin('shizi-app://app/index.html?test=1', { __shiziNativeDev: true })), true);
  assert.equal(isTestHost(fakeWin('shizi-app://app/index.html', { __shiziNativeDev: true })), false, 'still needs test=1');
  assert.equal(isTestHost(fakeWin('shizi-app://app/index.html?test=1', { __shiziNativeDev: 'true' })), false, 'strictly === true');
  assert.equal(isTestHost(undefined), false);
  assert.equal(isTestHost({}), false);
});

test('isStandalone / isNativeShell', () => {
  assert.equal(isStandalone({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }), navigator: {} }), false);
  assert.equal(isNativeShell({ webkit: { messageHandlers: { shiziNative: { postMessage() {} } } } }), true);
  assert.equal(isNativeShell({}), false);
});

test('setClockOverride shifts now() and resets', () => {
  const t = setClockOverride('2030-01-01T00:00:00Z');
  assert.ok(Math.abs(t - Date.parse('2030-01-01T00:00:00Z')) < 50);
  assert.ok(now() >= t);
  assert.throws(() => setClockOverride('not a date'));
  setClockOverride(null);
  assert.ok(Math.abs(now() - Date.now()) < 50);
});

function boot(href, extra) {
  const win = fakeWin(href, extra);
  const backend = new MemoryStorage();
  const storage = createStorage(backend);
  let store = null;
  const api = mountTestHooks({ win, storage, getStore: () => store });
  store = createStore({ storage });
  store.load();
  return { win, backend, storage, store, api };
}

test('production-form URL: window.__shiziTest stays undefined', () => {
  for (const href of ['https://eim-aa.github.io/shizi-app/', 'https://eim-aa.github.io/shizi-app/?test=1', 'http://localhost:8000/']) {
    const { win, api } = boot(href);
    assert.equal(api, null);
    assert.equal(win.__shiziTest, undefined, href);
    assert.equal(Object.prototype.hasOwnProperty.call(win, '__shiziTest'), false);
  }
});

test('test host: hooks seed/getState/failNextWrite/interruptAfterWrite/setClock/reset/getWriteLog', () => {
  const { win, backend, store } = boot('http://127.0.0.1:8765/?test=1');
  const t = win.__shiziTest;
  assert.ok(t, 'mounted');
  // 固定应用时钟到 fixture 所在的月份（baselineState 的记录在 2026-09、judgeMutation 写 2026-10）：store 的回收口径按
  // 「现在」算，不固定时钟时下面的配额断言会随真实日期变红（M2 验收 H2）。后面的 setClock / reset 断言照旧改写 / 复原时钟。
  t.setClock('2026-09-30T04:00:00.000Z');
  assert.deepEqual(t.seed(baselineState()).ok, true);
  assert.equal(t.getState().records['2026-09'].length, 2);
  assert.equal(t.seed({ bogus: true }).ok, false, 'seed goes through shape validation');

  // failNextWrite(generic) → commit 失败（storage 归为 unknown）、状态不变
  const before = t.getState();
  t.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.records.*' });
  const g = store.commit('judge', judgeMutation('大'));
  assert.equal(g.ok, false);
  assert.equal(g.error.kind, 'unknown');
  assert.deepEqual(t.getState(), before);

  // failNextWrite(quota)：store 在配额失败后回收并重试一次（01 §9），稳定制造配额失败要 n ≥ 2
  t.failNextWrite(2, { kind: 'quota', matchKey: 'shizi.v2.records.*' });
  const r = store.commit('judge', judgeMutation('大'));
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'quota');
  assert.deepEqual(t.getState(), before);

  // interruptAfterWrite：写 2 次后中断，重载后回到写前
  t.interruptAfterWrite(2);
  assert.equal(store.commit('judge', judgeMutation('大')).ok, false);
  const reloadedStorage = createStorage(backend);
  const reloaded = createStore({ storage: reloadedStorage });
  reloaded.load();
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.getState())), before);

  // setClock
  const iso = t.setClock('2027-02-03T04:05:06.000Z');
  assert.ok(iso.indexOf('2027-02-03T04:05') === 0);

  // getWriteLog：storage.js 的写标 via=storage；直接写 localStorage 标 via=direct
  const log = t.getWriteLog();
  assert.ok(log.length > 0);
  assert.ok(log.every(e => e.via === 'storage'), 'all writes so far went through storage.js');
  backend.setItem('shizi.v2.sneaky', '1');
  const direct = t.getWriteLog().filter(e => e.via === 'direct');
  assert.deepEqual(direct.map(e => [e.op, e.key]), [['set', 'shizi.v2.sneaky']]);

  // reset：删全部 shizi.*，保留 nativeSmoke；清故障、复原时钟、清日志
  backend.setItem(NATIVE_SMOKE_KEY, '2026-09-30T00:00:00Z');
  backend.setItem('shizi.memory.v1', '{}');
  backend.setItem('unrelated', 'x');
  const res = t.reset();
  assert.equal(res.ok, true);
  assert.equal(backend.getItem(NATIVE_SMOKE_KEY), '2026-09-30T00:00:00Z');
  assert.equal(backend.getItem('shizi.memory.v1'), null);
  assert.equal(backend.getItem(KEYS.meta), null);
  assert.equal(backend.getItem('unrelated'), 'x', 'non-shizi keys untouched');
  assert.deepEqual(t.getWriteLog(), []);
  assert.ok(Math.abs(t.now() - Date.now()) < 50, 'clock restored');
  assert.equal(t.getState().meta, null);
  assert.equal(t.seed(baselineState()).ok, true, 'store usable after reset (faults cleared)');
  assert.ok(t.getRawKeys()[KEYS.meta]);
  assert.equal(t.getStatus().available, true);
});

test('iOS DEBUG shell form (__shiziNativeDev + test=1) mounts hooks', () => {
  const { win } = boot('shizi-app://app/index.html?test=1', { __shiziNativeDev: true });
  assert.equal(typeof win.__shiziTest.seed, 'function');
});
