// 阶段 0 B2（G23 / D36 / P116）：原生读屏状态经桥传给页面。
//   iOS→JS 全局 shiziAccessibilityStatus({voiceOver, switchControl})：模块顶层同步定义、就绪前入队（只留最后一次）、
//   就绪后回放；页面侧 src/platform/accessibility.js 提供读取接口（getAccessibilityStatus / assistiveTechActive / onAccessibilityStatus）。
//   Swift 在 pageReady 与系统状态变化时调用，只传布尔值，不带面向用户的文字。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBridge, NATIVE_GLOBALS, bridge as moduleBridge } from '../../src/platform/bridge.js';
import {
  assistiveTechActive, getAccessibilityStatus, onAccessibilityStatus, receiveAccessibilityStatus, resetAccessibilityStatus,
} from '../../src/platform/accessibility.js';

const SWIFT = readFileSync(new URL('../../ios/ShiziApp/ShiziApp/WebViewController.swift', import.meta.url), 'utf8');

test('shiziAccessibilityStatus is a native global: defined at bridge creation, queued before ready (last one wins), replayed after', () => {
  assert.ok(NATIVE_GLOBALS.includes('shiziAccessibilityStatus'));
  const win = {};
  const b = createBridge(win);
  assert.equal(typeof win.shiziAccessibilityStatus, 'function');
  assert.equal(win.shiziAccessibilityStatus({ voiceOver: true, switchControl: false }), true, 'accepted (queued) before ready');
  assert.equal(win.shiziAccessibilityStatus({ voiceOver: false, switchControl: true }), true);
  const got = [];
  b.registerNativeHandler('shiziAccessibilityStatus', s => got.push(s));
  assert.deepEqual(got, [], 'not delivered before markReady');
  assert.deepEqual(b.pending().map(p => p.name), ['shiziAccessibilityStatus'], 'only the last status stays queued');
  b.markReady(null);
  assert.deepEqual(got, [{ voiceOver: false, switchControl: true }], 'replayed once, with the latest value');
  win.shiziAccessibilityStatus({ voiceOver: false, switchControl: false });
  assert.equal(got.length, 2, 'delivered directly once ready');
});

test('accessibility.js registers its implementation on the page bridge at import', () => {
  assert.equal(moduleBridge.hasHandler('shiziAccessibilityStatus'), true);
});

test('status defaults to off; receive normalises, notifies on change only, and returns true', () => {
  resetAccessibilityStatus();
  assert.deepEqual(getAccessibilityStatus(), { voiceOver: false, switchControl: false });
  assert.equal(assistiveTechActive(), false);
  const seen = [];
  const off = onAccessibilityStatus(s => seen.push(s));
  assert.equal(receiveAccessibilityStatus({ voiceOver: true, switchControl: false }), true);
  assert.deepEqual(getAccessibilityStatus(), { voiceOver: true, switchControl: false });
  assert.equal(assistiveTechActive(), true, 'VoiceOver counts');
  receiveAccessibilityStatus({ voiceOver: true, switchControl: false });
  assert.equal(seen.length, 1, 'same value is not announced again');
  receiveAccessibilityStatus({ voiceOver: false, switchControl: true });
  assert.equal(assistiveTechActive(), true, 'Switch Control counts');
  receiveAccessibilityStatus({ voiceOver: 'yes', switchControl: 0 });
  assert.deepEqual(getAccessibilityStatus(), { voiceOver: false, switchControl: false }, 'only a real true turns it on');
  assert.equal(receiveAccessibilityStatus(null), true, 'bad payload tolerated');
  assert.equal(assistiveTechActive(), false);
  off();
  receiveAccessibilityStatus({ voiceOver: true });
  assert.equal(seen.length, 3, 'unsubscribed listener no longer called');
  assert.deepEqual(getAccessibilityStatus(), { voiceOver: true, switchControl: false }, 'a missing field reads as false');
  resetAccessibilityStatus();
});

test('getAccessibilityStatus returns a copy', () => {
  resetAccessibilityStatus();
  const s = getAccessibilityStatus();
  s.voiceOver = true;
  assert.equal(assistiveTechActive(), false);
});

test('Swift reports VoiceOver / Switch Control on pageReady and on every system change, booleans only', () => {
  assert.match(SWIFT, /UIAccessibility\.isVoiceOverRunning/);
  assert.match(SWIFT, /UIAccessibility\.isSwitchControlRunning/);
  assert.match(SWIFT, /UIAccessibility\.voiceOverStatusDidChangeNotification/);
  assert.match(SWIFT, /UIAccessibility\.switchControlStatusDidChangeNotification/);
  assert.match(SWIFT, /shiziAccessibilityStatus\(\{voiceOver:\\\(/, 'evaluates the global with {voiceOver, switchControl}');
  const handlePageReady = SWIFT.match(/private func handlePageReady\(\) \{[\s\S]*?\n    \}/)[0];
  assert.match(handlePageReady, /sendAccessibilityStatus\(\)/, 'status goes out when the page reports ready');
});
