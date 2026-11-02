// M6-6 桥错误回调 shiziShareFailed（03 P96 过渡；02 §8「M5 遗留」）：全局在桥上、就绪前排队回放、页面按 kind 发轻提示、
// Swift 侧只在失败处调用（用户取消不回调）且不带面向用户的文字。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBridge, NATIVE_GLOBALS, bridge as moduleBridge } from '../../src/platform/bridge.js';
import {
  onShareFailed, receiveShareFailed, shareFailedText, SHARE_FAILED_KEYS, SHARE_FAILED_GENERIC,
} from '../../src/ui/components/share-failed.js';
import { hideToast } from '../../src/ui/components/Toast.js';
import { t, COPY } from '../../src/config/copy/index.js';

const SWIFT = readFileSync(new URL('../../ios/ShiziApp/ShiziApp/SwiftNav.swift', import.meta.url), 'utf8');

test('shiziShareFailed is a native global: defined at bridge creation, queued before ready, replayed after', () => {
  assert.ok(NATIVE_GLOBALS.includes('shiziShareFailed'));
  const win = {};
  const b = createBridge(win);
  assert.equal(typeof win.shiziShareFailed, 'function');
  assert.equal(win.shiziShareFailed({ kind: 'backup', reason: 'write' }), true, 'accepted (queued) before ready');
  const got = [];
  b.registerNativeHandler('shiziShareFailed', info => got.push(info));
  assert.deepEqual(got, [], 'not delivered before markReady');
  b.markReady(null);
  assert.deepEqual(got, [{ kind: 'backup', reason: 'write' }], 'replayed after markReady');
  win.shiziShareFailed({ kind: 'link', reason: 'open' });
  assert.equal(got.length, 2, 'delivered directly once ready');
});

test('share-failed.js registers the implementation on the page bridge at import', () => {
  assert.equal(moduleBridge.hasHandler('shiziShareFailed'), true);
});

test('text by kind (X-SHARE, P96); unknown kind → generic sentence; every key exists in copy', () => {
  for (const [kind, key] of Object.entries(SHARE_FAILED_KEYS)) {
    assert.ok(Object.prototype.hasOwnProperty.call(COPY, key), key);
    assert.equal(shareFailedText(kind), t(key));
  }
  assert.ok(Object.prototype.hasOwnProperty.call(COPY, SHARE_FAILED_GENERIC));
  assert.equal(shareFailedText('whatever'), t(SHARE_FAILED_GENERIC));
  assert.equal(shareFailedText(undefined), t(SHARE_FAILED_GENERIC));
  assert.equal(t('X-SHARE.backupFailed'), '备份文件没有分享出去，可以再试一次。');
});

test('receiveShareFailed notifies listeners with the kind and returns true (backup page drops its pending export)', t0 => {
  t0.after(() => hideToast());
  const seen = [];
  const off = onShareFailed((kind, info) => seen.push([kind, info && info.reason]));
  assert.equal(receiveShareFailed({ kind: 'card', reason: 'activity' }), true);
  assert.equal(receiveShareFailed(null), true, 'bad payload tolerated');
  off();
  receiveShareFailed({ kind: 'backup' });
  assert.deepEqual(seen, [['card', 'activity'], ['', null]], 'unsubscribed listener no longer called');
});

test('B4.9: the native failure toast picks the same X-SHARE sentence by kind (unknown kind → generic), no user-facing text in Swift', () => {
  const fn = SWIFT.slice(SWIFT.indexOf('func postShareFailed'), SWIFT.indexOf('/// 宿主自己发的原生屏消息'));
  assert.ok(fn.length > 0, 'postShareFailed');
  const keys = Object.fromEntries([...fn.matchAll(/"([a-z]+)": "(X-SHARE\.[A-Za-z]+)"/g)].map(m => [m[1], m[2]]));
  assert.deepEqual(keys, SHARE_FAILED_KEYS, 'same kind → key table as share-failed.js');
  assert.match(fn, /\?\? "X-SHARE\.failed"/, 'unknown kind → generic sentence');
  assert.ok(!/[\u3400-\u9fff]/.test(fn.replace(/\/\/\/[^\n]*/g, '')), 'no CJK text outside doc comments');
});
