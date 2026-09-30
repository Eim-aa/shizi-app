// src/platform/sw.js 单测（M5-1）：BUILD 比对防循环、注册条件、「有新版本」刷新规则（非写字页立即、写字页离开后）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD } from '../../src/build-info.js';
import {
  checkBuild, createUpdateController, shouldRegister, RELOAD_FLAG_KEY, UPDATE_FLAG_KEY,
} from '../../src/platform/sw.js';

function fakeWin({ meta = BUILD, search = '', hostname = 'example.github.io', protocol = 'https:', top = 'home', sw = true, storage = true } = {}) {
  const attrs = new Map();
  const store = new Map();
  let observerCb = null;
  const app = { getAttribute: name => (name === 'data-top-screen' ? win._top : null) };
  const win = {
    _top: top,
    reloads: 0,
    location: { search, hostname, protocol, reload() { win.reloads += 1; } },
    navigator: sw ? { serviceWorker: {} } : {},
    sessionStorage: storage ? {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    } : undefined,
    document: {
      documentElement: {
        setAttribute: (n, v) => attrs.set(n, v),
        removeAttribute: n => attrs.delete(n),
        getAttribute: n => (attrs.has(n) ? attrs.get(n) : null),
      },
      querySelector: sel => {
        if (sel === 'meta[name="shizi-asset-build"]') return meta === null ? null : { getAttribute: () => meta };
        if (sel === '.sz-app') return app;
        return null;
      },
      getElementById: () => ({}),
      body: {},
    },
    MutationObserver: class {
      constructor(cb) { observerCb = cb; }
      observe() {}
      disconnect() { observerCb = null; }
    },
    navigate(to) {
      win._top = to;
      if (observerCb) observerCb();
    },
    attrs,
    store,
  };
  return win;
}

test('checkBuild: consistent BUILD clears the anti-loop flag and never reloads', () => {
  const win = fakeWin();
  win.store.set(RELOAD_FLAG_KEY, 'x|y');
  assert.deepEqual(checkBuild(win), { ok: true, reloading: false });
  assert.equal(win.reloads, 0);
  assert.equal(win.store.has(RELOAD_FLAG_KEY), false);
});

test('checkBuild: a mismatch reloads exactly once per (meta, BUILD) pair', () => {
  const win = fakeWin({ meta: '20200101-000000000000' });
  assert.deepEqual(checkBuild(win), { ok: false, reloading: true });
  assert.equal(win.reloads, 1);
  const pair = `20200101-000000000000|${BUILD}`;
  assert.equal(win.store.get(RELOAD_FLAG_KEY), pair);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(checkBuild(win), { ok: false, reloading: false });
  } finally {
    console.warn = warn;
  }
  assert.equal(win.reloads, 1, 'second mismatched load does not reload again');
  assert.equal(win.attrs.get('data-shizi-build-mismatch'), pair);
});

test('checkBuild: without sessionStorage a mismatch does not reload (no loop possible)', () => {
  const win = fakeWin({ meta: '20200101-000000000000', storage: false });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(checkBuild(win), { ok: false, reloading: false });
  } finally {
    console.warn = warn;
  }
  assert.equal(win.reloads, 0);
});

test('shouldRegister: http(s) pages register; test host only with sw=1; no SW API or custom scheme never', () => {
  assert.equal(shouldRegister(fakeWin()), true);
  assert.equal(shouldRegister(fakeWin({ hostname: '127.0.0.1', protocol: 'http:' })), true, 'production-like localhost registers');
  assert.equal(shouldRegister(fakeWin({ hostname: '127.0.0.1', protocol: 'http:', search: '?test=1' })), false);
  assert.equal(shouldRegister(fakeWin({ hostname: '127.0.0.1', protocol: 'http:', search: '?test=1&sw=1' })), true);
  assert.equal(shouldRegister(fakeWin({ protocol: 'shizi-resource:' })), false);
  assert.equal(shouldRegister(fakeWin({ sw: false })), false);
});

test('new version on a non-write page reloads immediately; same build is ignored', () => {
  const win = fakeWin({ top: 'library' });
  const updates = createUpdateController(win);
  updates.onVersion(BUILD);
  assert.equal(win.reloads, 0);
  updates.onVersion('20990101-ffffffffffff');
  assert.equal(win.reloads, 1);
  assert.equal(win.store.get(UPDATE_FLAG_KEY), '20990101-ffffffffffff');
  assert.equal(win.attrs.get('data-shizi-update'), 'reloading');
});

test('new version on the write page waits until the top screen leaves write', () => {
  const win = fakeWin({ top: 'write' });
  const updates = createUpdateController(win);
  updates.onVersion('20990101-ffffffffffff');
  assert.equal(win.reloads, 0, 'no reload while writing');
  assert.equal(win.attrs.get('data-shizi-update'), 'pending');
  win.navigate('write'); // 仍在写字页（例如开关遮罩）
  assert.equal(win.reloads, 0);
  win.navigate('home');
  assert.equal(win.reloads, 1, 'reload once the write page is left');
  win.navigate('library');
  assert.equal(win.reloads, 1, 'only one reload');
});

test('a reload that did not land on the new build is not repeated in the same session', () => {
  const win = fakeWin({ top: 'home' });
  win.store.set(UPDATE_FLAG_KEY, '20990101-ffffffffffff');
  const warn = console.warn;
  console.warn = () => {};
  try {
    createUpdateController(win).onVersion('20990101-ffffffffffff');
  } finally {
    console.warn = warn;
  }
  assert.equal(win.reloads, 0);
  assert.equal(win.attrs.get('data-shizi-update'), 'stuck');
  createUpdateController(win).onVersion(BUILD);
  assert.equal(win.store.has(UPDATE_FLAG_KEY), false, 'reaching the build clears the flag');
});
