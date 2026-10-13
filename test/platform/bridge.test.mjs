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

// ---------------------------------------------------------------- M5-5：就绪幂等、import 即有全局、消息体形状（haptic / sound / syncReminder）

test('markReady is idempotent: first call returns true, later calls keep / update the store and replay what is still queued', () => {
  const { win } = fakeWin();
  const b = createBridge(win);
  const s1 = { id: 1 };
  assert.equal(b.isReady(), false);
  assert.equal(b.markReady(s1), true);
  assert.equal(b.markReady(), false, 'second call is not a fresh ready');
  assert.equal(b.getStore(), s1, 'undefined keeps the store');
  const s2 = { id: 2 };
  assert.equal(b.markReady(s2), false);
  assert.equal(b.getStore(), s2);
  win.shiziCardSaved({ success: true });
  assert.equal(b.hasHandler('shiziCardSaved'), false);
  assert.equal(b.pending().length, 1, 'no handler yet → stays queued even after ready');
  const got = [];
  b.registerNativeHandler('shiziCardSaved', r => got.push(r.success));
  assert.deepEqual(got, [true]);
  assert.equal(b.hasHandler('shiziCardSaved'), true);
  assert.equal(b.isNative(), true);
  assert.equal(createBridge({}).isNative(), false);
});

test('importing bridge.js in a page defines every global immediately (before any app code) and queues calls', async () => {
  const { win, sent } = fakeWin();
  const prev = globalThis.window;
  globalThis.window = win;
  try {
    const mod = await import('../../src/platform/bridge.js?page-instance');
    for (const name of NATIVE_GLOBALS) assert.equal(typeof win[name], 'function', `${name} defined at import`);
    assert.equal(win.__shiziBridge, mod.bridge);
    assert.equal(win.shiziOpenReminderTarget('base:习'), true, 'Swift sees true (received)');
    assert.deepEqual(mod.bridge.pending(), [{ name: 'shiziOpenReminderTarget', args: ['base:习'] }]);
    assert.equal(mod.isNative(), true);
    assert.equal(mod.postNative('pageReady'), true);
    assert.deepEqual(sent, [{ type: 'pageReady' }]);
  } finally {
    if (prev === undefined) delete globalThis.window;
    else globalThis.window = prev;
  }
});

test('haptic and sound messages: {type:"haptic", kind} for the F1 kinds judge / seal / light / select (D58 ③), {type:"sound", kind:<file stem>, gain} (S1, D50 ⑦); no sound switch (D63)', async () => {
  const { haptic, applyFeedback, feedbackFor, installCommitFeedback, resetCommitFeedback, COMMIT_FEEDBACK, HAPTIC_KINDS } = await import('../../src/platform/haptics.js');
  const { keySound, resetSound, SOUND_FILES } = await import('../../src/platform/sound.js');
  const { win, sent } = fakeWin();
  const b = createBridge(win);
  assert.deepEqual([...HAPTIC_KINDS], ['judge', 'seal', 'light', 'select']);
  assert.equal(haptic('judge', { bridge: b }), 'native');
  assert.equal(haptic('nope', { bridge: b }), false);
  for (const old of ['stamp', 'undo', 'action', 'milestone']) assert.equal(haptic(old, { bridge: b }), false, `old kind ${old} is no longer sent`);
  assert.deepEqual(sent, [{ kind: 'judge', type: 'haptic' }]);

  const vib = [];
  const web = createBridge({});
  assert.equal(haptic('judge', { bridge: web, win: { navigator: { vibrate: ms => vib.push(ms) } } }), 'vibrate', 'browser: judge vibrates 10ms (old)');
  assert.equal(haptic('select', { bridge: web, win: { navigator: { vibrate: ms => vib.push(ms) } } }), false);
  assert.deepEqual(vib, [10]);

  resetSound();
  sent.length = 0;
  assert.deepEqual(Object.keys(SOUND_FILES), ['judge', 'seal']);
  assert.equal(keySound('judge', { bridge: b, settings: null }), 'native', 'default on');
  assert.equal(keySound('trace-stroke', { bridge: b }), false, 'writing / tracing is silent (D50 ⑦)');
  assert.equal(keySound('tap', { bridge: b }), false, 'not a sound event');
  assert.equal(keySound('judge', { bridge: b, policy: { keySoundEvents: ['seal'] } }), false, 'policy.keySoundEvents gates');
  assert.equal(keySound('seal', { bridge: b, key: 'k' }), 'native');
  assert.deepEqual(sent, [
    { kind: 'j1_page_settle', gain: 1, type: 'sound' },
    { kind: 's1_wood_muted', gain: 1, type: 'sound' },
  ]);

  // commit label → 反馈
  assert.deepEqual(feedbackFor({ type: 'commit', label: 'write:judge' }), { haptic: 'judge', sound: 'judge' });
  assert.equal(feedbackFor({ type: 'status' }), null);
  assert.equal(feedbackFor({ type: 'commit', label: 'write:strokes' }), null);
  for (const fb of Object.values(COMMIT_FEEDBACK)) assert.ok(HAPTIC_KINDS.includes(fb.haptic));
  const calls = [];
  const deps = { haptic: k => calls.push(['h', k]) && 'native', keySound: e => calls.push(['s', e]) && 'native' };
  applyFeedback({ type: 'commit', label: 'write:judge' }, {}, deps);
  applyFeedback({ type: 'commit', label: 'write:skip-undo' }, {}, deps);
  assert.deepEqual(calls, [['h', 'judge'], ['s', 'judge'], ['h', 'select']], 'undoing a skip is a select (F1)');

  // installCommitFeedback：同一个 store 只订阅一次
  const subs = [];
  const store = { subscribe: fn => { subs.push(fn); return () => subs.splice(subs.indexOf(fn), 1); } };
  assert.equal(installCommitFeedback(() => store), true);
  assert.equal(installCommitFeedback(() => store), true);
  assert.equal(subs.length, 1);
  assert.equal(installCommitFeedback(() => { throw new Error('not booted'); }), false);
  resetCommitFeedback();
  assert.equal(subs.length, 0);
});
