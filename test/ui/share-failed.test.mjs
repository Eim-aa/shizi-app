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

const SWIFT = readFileSync(new URL('../../ios/ShiziApp/ShiziApp/WebViewController.swift', import.meta.url), 'utf8');

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

test('Swift calls window.shiziShareFailed only with known kinds, on failure paths, without user-facing text', () => {
  const calls = [...SWIFT.matchAll(/notifyShareFailed\(kind: "([a-z]+)", reason: "([a-z]+)"\)/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(calls, [
    ['backup', 'write'], ['backup', 'activity'], ['card', 'payload'], ['card', 'write'], ['card', 'activity'],
    ['link', 'refused'], ['link', 'open'],
  ]);
  for (const [kind] of calls) assert.ok(Object.prototype.hasOwnProperty.call(SHARE_FAILED_KEYS, kind), kind);
  assert.match(SWIFT, /window\.shiziShareFailed\(\{kind:'\\\(kind\)',reason:'\\\(reason\)'\}\)/, 'evaluates the global with {kind, reason}');
  // 用户取消不回调：备份分享的 completion 先看 activityError，未完成（取消）直接返回、不提示
  assert.match(SWIFT, /if activityError != nil \{\s*self\?\.notifyShareFailed\(kind: "backup", reason: "activity"\)\s*return\s*\}\s*guard completed else \{ return \}/);
  const fn = SWIFT.slice(SWIFT.indexOf('func notifyShareFailed'), SWIFT.indexOf('private func sharePracticeCard'));
  assert.ok(fn.length > 0 && !/[㐀-鿿]/.test(fn.replace(/\/\/\/[^\n]*/g, '')), 'no CJK text outside doc comments');
});
