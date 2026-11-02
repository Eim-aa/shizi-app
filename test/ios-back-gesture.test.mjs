// R4-G1（P270 / P272）：左缘返回的阈值。静态核对 ios/ShiziApp/ShiziApp/RootViewController.swift 的 BackGestureThreshold（不编译 Xcode 工程；
// 模拟器实测见 ios/ShiziApp/DEVICE_QA.md「左缘右滑返回」）。B4.9：WKWebView 宿主上的识别器与「把进度派给页面」随网页一起删了，
// 原生页各自的跟手返回（写字页、通用原生页的转场、字详情放大）都用这张表。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACK_COMMIT_RATIO, BACK_COMMIT_VELOCITY, BACK_RETURN_VELOCITY } from '../src/ui/router.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swift = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/RootViewController.swift'), 'utf8');

function body(re) {
  const m = re.exec(swift);
  assert.ok(m, `found ${re}`);
  return m[1];
}

test('thresholds are one table and match router.js (v > 500 || (x > w/3 && v > -200))', () => {
  const t = body(/enum BackGestureThreshold \{([\s\S]*?)\n\}/);
  assert.match(t, /static let commitRatio: CGFloat = 1\.0 \/ 3\.0/);
  assert.equal(BACK_COMMIT_RATIO, 1 / 3);
  assert.match(t, new RegExp(`static let commitVelocity: CGFloat = ${BACK_COMMIT_VELOCITY}\\b`));
  assert.match(t, new RegExp(`static let returnVelocity: CGFloat = ${BACK_RETURN_VELOCITY}\\b`));
  assert.match(t, /static let marginWidth: CGFloat = 20\b/, 'margin start zone = the page gutter (20pt)');
  assert.match(t, /velocity > commitVelocity \|\| \(distance > width \* commitRatio && velocity > returnVelocity\)/);
  assert.doesNotMatch(t, /commitRatio: CGFloat = 0\.5/, 'no stale 50% threshold');
});

test('B4.9: every native swipe-back commits through the same table', () => {
  for (const f of ['NativeWriteViewController.swift', 'ShiziKit/ShiziTransitions.swift', 'Screens/DetailZoom.swift']) {
    const src = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp', f), 'utf8');
    assert.match(src, /BackGestureThreshold\.commits\(distance: /, f);
  }
  assert.doesNotMatch(swift, /shizi-native-back|import WebKit|evaluateJavaScript/, 'no page to dispatch the gesture to');
});
