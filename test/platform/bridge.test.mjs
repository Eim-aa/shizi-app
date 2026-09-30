// M0-7：src/platform/bridge.js 骨架（01 §8.1）——顶层同步定义全局、就绪前入队、提醒深链只留最后一个、backGestureEnabled 去重。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, NATIVE_GLOBALS, bridge as moduleBridge } from '../../src/platform/bridge.js';

function fakeWin({ native = true } = {}) {
  const sent = [];
  const win = {};
  if (native) win.webkit = { messageHandlers: { shiziNative: { postMessage: msg => sent.push(msg) } } };
  return { win, sent };
}

test('module instance under node installs no globals and posts nothing', () => {
  assert.equal(typeof globalThis.shiziOpenReminderTarget, 'undefined');
  assert.equal(moduleBridge.postNative('pageReady'), false);
});

test('defines every 01 §8.1 global synchronously and they return true', () => {
  const { win } = fakeWin();
  createBridge(win);
  for (const name of NATIVE_GLOBALS) {
    assert.equal(typeof win[name], 'function', name);
  }
  assert.equal(win.shiziCardSaved({ success: true }), true);
  assert.equal(win.shiziOCRResult, undefined);
});

test('same window returns the same bridge', () => {
  const { win } = fakeWin();
  assert.equal(createBridge(win), createBridge(win));
});

test('calls before markReady are queued and replayed in order; reminder keeps only the last cardKey', () => {
  const { win } = fakeWin();
  const b = createBridge(win);
  const seen = [];
  b.registerNativeHandler('shiziOpenReminderTarget', key => seen.push(['open', key]));
  b.registerNativeHandler('shiziReminderStatus', s => seen.push(['status', s.permission]));
  win.shiziOpenReminderTarget('base:甲');
  win.shiziReminderStatus({ permission: 'granted' });
  win.shiziOpenReminderTarget('base:乙');
  assert.deepEqual(seen, []);
  assert.deepEqual(b.pending().map(p => p.name), ['shiziReminderStatus', 'shiziOpenReminderTarget']);
  const store = { id: 'store' };
  b.markReady(store);
  assert.equal(b.getStore(), store);
  assert.deepEqual(seen, [['status', 'granted'], ['open', 'base:乙']]);
  assert.deepEqual(b.pending(), []);
  win.shiziOpenReminderTarget('base:丙');
  assert.deepEqual(seen.at(-1), ['open', 'base:丙']);
});

test('calls without a registered handler stay queued until one registers after ready', () => {
  const { win } = fakeWin();
  const b = createBridge(win);
  b.markReady(null);
  win.shiziBackupRejected({ reason: 'tooLarge' });
  assert.equal(b.pending().length, 1);
  const got = [];
  b.registerNativeHandler('shiziBackupRejected', d => got.push(d.reason));
  assert.deepEqual(got, ['tooLarge']);
  assert.deepEqual(b.pending(), []);
  assert.throws(() => b.registerNativeHandler('shiziOCRResult', () => {}), /unknown native global/);
});

test('a throwing handler does not break the bridge', () => {
  const { win } = fakeWin();
  const b = createBridge(win);
  const orig = console.error;
  console.error = () => {};
  try {
    b.registerNativeHandler('markBackupExported', () => { throw new Error('boom'); });
    b.markReady();
    assert.equal(win.markBackupExported(), true);
  } finally {
    console.error = orig;
  }
});

test('postNative and setBackGestureEnabled send only inside the native shell and dedupe', () => {
  const { win, sent } = fakeWin();
  const b = createBridge(win);
  assert.equal(b.postNative('haptic', { kind: 'stamp', type: 'spoof' }), true);
  assert.deepEqual(sent[0], { kind: 'stamp', type: 'haptic' });
  assert.equal(b.setBackGestureEnabled(false), true);
  assert.equal(b.setBackGestureEnabled(false), false);
  assert.equal(b.setBackGestureEnabled(true), true);
  assert.deepEqual(sent.slice(1), [{ type: 'backGestureEnabled', value: false }, { type: 'backGestureEnabled', value: true }]);

  const off = fakeWin({ native: false });
  const b2 = createBridge(off.win);
  assert.equal(b2.setBackGestureEnabled(false), false);
  assert.equal(b2.postNative('pageReady'), false);
});
