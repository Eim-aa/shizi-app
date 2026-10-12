// R2-A1（A2-05）：读屏「两指 Z 形」退出手势转给页面。静态核对 ios/ShiziApp/ShiziApp/WebViewController.swift（不编译 Xcode 工程）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swift = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/WebViewController.swift'), 'utf8');
const router = readFileSync(join(ROOT, 'src/ui/router.js'), 'utf8');

test('WebViewController 实现 accessibilityPerformEscape：能返回（门控 true）时派发 shizi-native-escape 并返回 true，否则返回 false（R5-I2 / P0-16）', () => {
  const m = /override func accessibilityPerformEscape\(\) -> Bool \{([\s\S]*?)\n    \}/.exec(swift);
  assert.ok(m, 'accessibilityPerformEscape override');
  assert.match(m[1], /guard backGestureEnabled else \{ return false \}/, 'tab 根 / 阻断页：返回 false');
  assert.ok(m[1].indexOf('guard backGestureEnabled') < m[1].indexOf('dispatchAccessibilityEscape()'), '先判门控再派发');
  assert.match(m[1], /dispatchAccessibilityEscape\(\)/);
  assert.match(m[1], /return true/);
  const d = /func dispatchAccessibilityEscape\(\) \{([\s\S]*?)\n    \}/.exec(swift);
  assert.ok(d);
  assert.match(d[1], /webView\.evaluateJavaScript\(/);
  assert.match(d[1], /new CustomEvent\('shizi-native-escape'\)/);
});

test('事件名与页面一致（router.js NATIVE_ESCAPE_EVENT）', () => {
  assert.match(router, /NATIVE_ESCAPE_EVENT = 'shizi-native-escape'/);
  assert.match(swift, /shizi-native-escape/);
});
