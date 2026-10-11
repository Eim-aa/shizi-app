// R4-G1（P270 / P272）：原生左缘返回识别器。静态核对 ios/ShiziApp/ShiziApp/WebViewController.swift（不编译 Xcode 工程；
// 模拟器实测见报告与 ios/ShiziApp/DEVICE_QA.md「左缘右滑返回」）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACK_COMMIT_RATIO, BACK_COMMIT_VELOCITY, BACK_RETURN_VELOCITY } from '../src/ui/router.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swift = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/WebViewController.swift'), 'utf8');
const smoke = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/NativeSmoke.swift'), 'utf8');
const validator = readFileSync(join(ROOT, 'ios/ShiziApp/scripts/validate-native-smoke.py'), 'utf8');

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
  const d = body(/func dispatchBackGesture\(phase: String, distance: CGFloat, velocity: CGFloat\) -> Bool \{([\s\S]*?)\n    \}/);
  assert.match(d, /BackGestureThreshold\.commits\(distance: distance, velocity: velocity, width: width\)/, 'dispatch uses the shared table');
  assert.doesNotMatch(d, /0\.5/, 'no stale 50% threshold');
});

test('recognizers live on a container view, not on the WKWebView (WebKit deferring gestures would delay them)', () => {
  const load = body(/override func loadView\(\) \{([\s\S]*?)\n    \}/);
  assert.match(load, /let container = UIView\(frame: \.zero\)/);
  assert.match(load, /container\.addSubview\(webView\)/);
  assert.match(load, /webView\.autoresizingMask = \[\.flexibleWidth, \.flexibleHeight\]/);
  assert.match(load, /UIScreenEdgePanGestureRecognizer\(target: self, action: #selector\(handlePracticeBackGesture\(_:\)\)\)/);
  assert.match(load, /practiceBackGesture\.edges = \.left/);
  assert.match(load, /container\.addGestureRecognizer\(practiceBackGesture\)/);
  assert.match(load, /let marginBackGesture = UIPanGestureRecognizer\(target: self, action: #selector\(handlePracticeBackGesture\(_:\)\)\)/);
  assert.match(load, /marginBackGesture\.require\(toFail: practiceBackGesture\)/, 'margin recognizer only fills in when the system edge recognizer fails');
  assert.match(load, /container\.addGestureRecognizer\(marginBackGesture\)/);
  assert.match(load, /view = container/);
  assert.doesNotMatch(load, /webView\.addGestureRecognizer/, 'nothing is installed on the WKWebView itself');
});

test('delegate: gate, margin start zone + rightward-dominant, scroll pans wait for the edge recognizers', () => {
  const ext = body(/extension WebViewController: UIGestureRecognizerDelegate \{([\s\S]*?)\n\}/);
  assert.match(ext, /g === practiceBackGesture \|\| g === marginBackGesture/);
  assert.match(ext, /guard backGestureEnabled else \{ return false \}/, 'page gate (tab root / blocked / compare phase) refuses');
  assert.match(ext, /backGestureStartsInMargin\(\) && v\.x > 0 && v\.x > abs\(v\.y\) \* BackGestureThreshold\.marginSlope/, 'margin pan: starts in the 20pt zone and moves right (diagonal starts allowed like the system edge pan)');
  assert.match(ext, /shouldReceive touch: UITouch\) -> Bool \{[\s\S]*?let x = touch\.location\(in: view\)\.x[\s\S]*?x <= BackGestureThreshold\.marginWidth[\s\S]*?marginTouchStartX = receive \? x : nil/, 'margin pan ignores touches outside the zone (the writing grid is never tracked) and remembers the press point');
  assert.match(ext, /shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer/);
  assert.match(ext, /otherGestureRecognizer is UIPanGestureRecognizer/);
  assert.match(ext, /otherGestureRecognizer\.view as\? UIScrollView/);
  assert.match(ext, /return other\.isDescendant\(of: webView\)/, 'only scroll views inside the web view wait');
  const start = body(/func backGestureStartsInMargin\(\) -> Bool \{([\s\S]*?)\n    \}/);
  assert.match(start, /guard let x = marginTouchStartX else \{ return false \}/, 'press point recorded in shouldReceive (translation starts after the pan slop, so location − translation is not the press point)');
  assert.match(swift, /static let marginSlope: CGFloat = 0\.5/);
});

test('one handler for both recognizers; progress events go to the page (began cancels the current stroke there)', () => {
  const h = body(/@objc private func handlePracticeBackGesture\(_ gesture: UIPanGestureRecognizer\) \{([\s\S]*?)\n    \}/);
  for (const phase of ['began', 'changed', 'ended', 'cancelled']) assert.match(h, new RegExp(`phase = "${phase}"`));
  assert.match(h, /gesture\.translation\(in: view\)\.x/);
  assert.match(h, /gesture\.velocity\(in: view\)\.x/);
  assert.match(swift, /new CustomEvent\('shizi-native-back-progress',\{detail:/);
  const ink = readFileSync(join(ROOT, 'src/ui/canvas/ink-canvas.js'), 'utf8');
  assert.match(ink, /if \(detailObj\.phase === 'began'\) cancelCurrent\('native-back'\)/, 'page drops the stroke in progress on began');
});

test('native smoke: the write page now swipes back; recognizers are checked on the container', () => {
  assert.match(smoke, /step\('edgeBackOnWrite'\)[\s\S]*?writeAllowed: onWrite\.detail\.allowed,[\s\S]*?writeFired: onWrite\.detail\.fired/);
  assert.match(smoke, /"marginGestureInstalled": view\.gestureRecognizers\?\.contains\(where: \{ \$0 === marginBackGesture \}\) == true/);
  assert.match(validator, /"edgeBackOnWrite": edge\.get\("writeAllowed"\) is True/);
  assert.doesNotMatch(validator, /edgeBackGateOnWrite/);
});

test('native ink spike layer covers only the grid (inside the 20pt gutter), so it never sits on the edge', () => {
  const spike = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/NativeInkSpike.swift'), 'utf8');
  assert.match(spike, /let frame = CGRect\(x: num\("x"\), y: num\("y"\), width: num\("w"\), height: num\("h"\)\)/, 'ink view frame = the grid rect sent by the page');
  const settle = /guard let v = NativeInkView\(frame: webView\.bounds, renderer: renderer\) else \{ return \}\s*v\.drawable = false\s*v\.isUserInteractionEnabled = false/;
  assert.match(spike, settle, 'the full-screen settle overlay never takes touches');
});
