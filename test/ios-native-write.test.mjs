// B2.0 原生写字页的静态门禁（docs/engineering/v10/B2-原生写字架构.md §5 / §9）：
// 1. 文案单一来源：原生写字页的 Swift 源码里不得有含汉字的字符串字面量——用户可见的字一律取自页面 src/config/copy（open 回包的 copy 字典）；
// 2. 原生写字页用到的文案键都在 native-session.js 的 NATIVE_WRITE_COPY_KEYS 里（键名写错 = 原生拿到空字符串）；
// 3. B3.1 起写字 / 判断 / 结果 / 重写错字页与 ShiziKit 是 Release 组件（不包 #if DEBUG；开关 -shizi-native-write 默认关、到 B3.F 为止），
//    纵切量测 NativeWriteMetrics 仍整文件只在 DEBUG（verify-archive 另查标记）；
// 4. B2.1 书写面转正：NativeInkView / InkModel 是 Release 组件（不包 #if DEBUG），spike 叠层 NativeInkSpike 与金标准自检 InkModelCheck 仍整体只在 DEBUG，
//    书写面里的量测钩子（NativeInkLatency 等）只在 #if DEBUG 块里。B4.9：spike 叠层 NativeInkSpike 随 WKWebView 删除（它是网页上的叠层）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './core/helpers.mjs';
import { NATIVE_WRITE_COPY_KEYS } from '../src/ui/screens/write/native-session.js';
import { NATIVE_RESULT_COPY_KEYS } from '../src/session/result-api.js';
import { COPY } from '../src/config/copy/index.js';

const DIR = path.join(ROOT, 'ios/ShiziApp/ShiziApp');
const FILES = ['NativeWriteViewController.swift', 'NativeStage.swift', 'WriteSessionChannel.swift', 'RootViewController.swift', 'SoundPlayer.swift', 'NativeGlyph.swift', 'NativeWriteLayout.swift', 'NativeHint.swift', 'NativeJudge.swift', 'NativeTrace.swift',
  'NativeResult.swift', // B2.7 原生结果页
  // B3.1 ShiziKit：从上面这些文件里提出来的共用组件（原 NativeSkipEnd.swift → ShiziUndoBar / ShiziConfirm；NativeJudge 的字阶 / 弹层 / 按钮；转场对象）
  'ShiziKit/NativeType.swift', 'ShiziKit/ShiziA11y.swift', 'ShiziKit/ShiziButtons.swift', 'ShiziKit/ShiziChangeSheet.swift', 'ShiziKit/ShiziConfirm.swift', 'ShiziKit/ShiziOverlay.swift',
  'ShiziKit/ShiziPageHeader.swift', 'ShiziKit/ShiziProbe.swift', 'ShiziKit/ShiziTokens.swift', 'ShiziKit/ShiziTransitions.swift', 'ShiziKit/ShiziUndoBar.swift',
  // B3.2：NativeStage（原 NativeWriteCoordinator.swift）、引擎、原生页底座与试点页
  'ShiziKit/ShiziEngine.swift', 'ShiziKit/ShiziScreen.swift', 'Screens/About.swift'];
// B2.7：画墨接口 NativeInkPaint 与书写面同为 Release 组件（R11-A 的网页同算法墨换进来的地方）；B3.1 挪进 ShiziKit/Ink/
const SURFACE = ['ShiziKit/Ink/NativeInkView.swift', 'ShiziKit/Ink/InkModel.swift', 'ShiziKit/Ink/NativeInkWire.swift', 'ShiziKit/Ink/NativeInkPaint.swift', 'ShiziKit/Ink/WebInk.swift'];
const HAN = /[㐀-鿿＀-￯　-〿]/;

/** 去掉 // 行注释与块注释后的源码（字符串里的 // 不在这些文件里出现）。 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}

test('native write sources: no Chinese string literals (copy comes from src/config/copy)', () => {
  for (const f of [...FILES, ...SURFACE]) {
    const literals = code(fs.readFileSync(path.join(DIR, f), 'utf8')).match(/"(?:[^"\\\n]|\\.)*"/g) || [];
    const bad = literals.filter(s => HAN.test(s));
    assert.deepEqual(bad, [], `${f} has user-visible literals`);
  }
});

test('B2.7 native result page: every copy key it asks for is shipped in resultLook (write keys + NATIVE_RESULT_COPY_KEYS)', () => {
  const src = fs.readFileSync(path.join(DIR, 'NativeResult.swift'), 'utf8');
  const used = [...new Set([...src.matchAll(/tr\("([A-Z][\w-]*\.\w+)"/g)].map(m => m[1]))];
  assert.ok(used.length >= 10);
  for (const k of used) assert.ok(NATIVE_WRITE_COPY_KEYS.includes(k) || NATIVE_RESULT_COPY_KEYS.includes(k), `${k} missing from the result copy keys`);
});

test('native write sources: every copy key the page asks for is shipped in the open payload', () => {
  const src = ['NativeWriteViewController.swift', 'ShiziKit/ShiziChangeSheet.swift'].map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  const used = [...new Set([...src.matchAll(/tr\("([A-Z][\w-]*\.\w+)"/g)].map(m => m[1]))];
  assert.ok(used.length >= 10);
  for (const k of used) assert.ok(NATIVE_WRITE_COPY_KEYS.includes(k), `${k} missing from NATIVE_WRITE_COPY_KEYS`);
});

test('B3.1: every copy key a native page asks for exists in src/config/copy (ShiziCopy = the generated COPY)', () => {
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of src.matchAll(/(?:\btr|ShiziCopy\.t)\("([A-Z][\w-]*\.\w+)"/g)) assert.ok(Object.hasOwn(COPY, m[1]), `${f}: ${m[1]}`);
  }
});

test('B3.1: the native write flow and ShiziKit are Release components; vertical-slice metrics stay DEBUG-only', () => {
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8').trim();
    assert.ok(!src.startsWith('#if DEBUG'), `${f} is compiled into Release`);
  }
  const metrics = fs.readFileSync(path.join(DIR, 'NativeWriteMetrics.swift'), 'utf8').trim();
  assert.ok(metrics.startsWith('#if DEBUG') && metrics.endsWith('#endif'), 'NativeWriteMetrics stays DEBUG-only');
  // 测试宿主的东西（QATrace / QAClock / -shizi-qa* / 量测）只在 #if DEBUG 块里；原生页面经 ShiziProbe 留钩子
  for (const f of FILES) {
    const stack = [];
    const leaks = [];
    fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
      const d = line.trim();
      if (/^#if\b/.test(d)) stack.push(/^#if\s+DEBUG\b/.test(d));
      else if (/^#else\b/.test(d) && stack.length) stack[stack.length - 1] = false;
      else if (/^#endif\b/.test(d)) stack.pop();
      else if (/QATrace|QAClock|QAProbe|NativeQA|shizi-qa|NativeWriteMetrics|NativeInkLatency|\bNSLog\(/.test(line.replace(/\/\/.*$/, '')) && !stack.some(Boolean)) leaks.push(i + 1);
    });
    assert.deepEqual(leaks, [], `${f}: DEBUG-only hooks outside #if DEBUG`);
  }
});

test('native ink surface: Release component since B2.1; spike overlay, golden self-check and latency hooks stay DEBUG-only', () => {
  for (const f of SURFACE) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8').trim();
    assert.ok(!src.startsWith('#if DEBUG'), `${f} is compiled into Release`);
  }
  for (const f of ['InkModelCheck.swift', 'NativeQAHarness.swift', 'QAFixtures.swift', 'QAOps.swift']) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8').trim();
    assert.ok(src.startsWith('#if DEBUG') && src.endsWith('#endif'), `${f} stays DEBUG-only`);
  }
  assert.ok(!fs.existsSync(path.join(DIR, 'NativeInkSpike.swift')), 'B4.9: the web-overlay spike is gone');
  // 书写面里 DEBUG 专用的东西（T1 量测、spike 落定原型的钩子、淡出）只出现在 #if DEBUG 块里
  const lines = fs.readFileSync(path.join(DIR, 'ShiziKit/Ink/NativeInkView.swift'), 'utf8').split('\n');
  const stack = [];
  const leaks = [];
  lines.forEach((line, i) => {
    const d = line.trim();
    if (/^#if\b/.test(d)) stack.push(/^#if\s+DEBUG\b/.test(d));
    else if (/^#else\b/.test(d) && stack.length) stack[stack.length - 1] = false;
    else if (/^#endif\b/.test(d)) stack.pop();
    else if (/NativeInkLatency|latency\.|fadeOutAndHide|stepFade/.test(line.replace(/\/\/.*$/, '')) && !stack.some(Boolean)) leaks.push(i + 1);
  });
  assert.deepEqual(leaks, []);
  // Release 可执行文件含书写面：ObjC 名固定（verify-archive.sh 按它查）
  assert.match(lines.join('\n'), /@objc\(ShiziNativeInkView\)\s*\nfinal class NativeInkView/);
  assert.match(fs.readFileSync(path.join(ROOT, 'ios/ShiziApp/scripts/verify-archive.sh'), 'utf8'), /ShiziNativeInkView/);
});

test('B2.2 / B4.9: no native source references the deleted spike, the web view or the JS bridges', () => {
  const all = fs.readdirSync(DIR, { recursive: true }).filter(f => f.endsWith('.swift'));
  for (const f of all) {
    const src = code(fs.readFileSync(path.join(DIR, f), 'utf8'));
    assert.ok(!/NativeInkSpike|WKWebView|import WebKit|evaluateJavaScript|callAsyncJavaScript|WebViewController|NativeStoreBridge|NativeWriteBridge|LocalWebSchemeHandler|ShadowEngine|ShiziEngineMode/.test(src), `${f} still references the web layer`);
  }
});

test('B2.5: the judge page times come from the page (motion.settle / easeOut), not from the Swift source', () => {
  const src = code(fs.readFileSync(path.join(DIR, 'NativeJudge.swift'), 'utf8'));
  // M23 的时刻 / 缩放 / 曲线只出现在 open 回包里；原生源码里不得写死
  assert.ok(!/\b(100|380|460)\b/.test(src.replace(/\b(100)\b(?=\s*\/\s*1000)/g, '')), 'no hard-coded settle milliseconds');
  assert.ok(!/0\.97|0\.985|0\.015/.test(src), 'no hard-coded lift scale');
  assert.ok(!/0\.5,\s*0,\s*0\.15|0\.2,\s*0\.7/.test(src), 'no hard-coded bezier');
  const vc = code(fs.readFileSync(path.join(DIR, 'NativeWriteViewController.swift'), 'utf8'));
  assert.match(vc, /NativeSettleSpec\(motion:/);
  assert.match(vc, /NativeBezier\.timing\(easeOut\)/);
});

test('B2.8: page transitions live in one object (NativeWriteTransitions) and take every time / curve / distance from the page (motion.nav)', () => {
  // B3.1：转场对象挪进 ShiziKit/ShiziTransitions.swift（协调者只剩消息分派）；时长等改取 ShiziKit 生成值（= 回包 motion.nav 同一份）
  const src = code(['NativeStage.swift', 'ShiziKit/ShiziTransitions.swift'].map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n'));
  // 交互规范 T0 的时长（300 / 420 / 360 / 220 / 180 / 150 ms）、视差 0.3、0.96 起始缩放、贝塞尔控制点都只在 open 回包 motion.nav 里
  assert.ok(!/withDuration:\s*[0-9]/.test(src), 'no literal UIView durations');
  assert.ok(!/\b0\.(35|3|42|36|22|18|15|96)\b/.test(src), 'no hard-coded transition seconds / scale');
  assert.ok(!/\b(300|420|360|220|180|150)\b/.test(src), 'no hard-coded transition milliseconds');
  assert.ok(!/0\.2,\s*0\.7|\.3,\s*0,\s*\.1/.test(src), 'no hard-coded bezier');
  assert.match(src, /final class NativeWriteTransitions: NSObject/);
  assert.match(src, /static func update\(payload(?: raw)?: \[String: Any\]\)/);
  assert.equal((src.match(/class NativeWriteTransitions\b/g) || []).length, 1, 'one transition object');
  // 写字页 / 结果页的左缘右滑都交给同一个对象（跟手画同一个 frame(s)），不再用 UIPercentDrivenInteractiveTransition
  for (const f of ['NativeWriteViewController.swift', 'NativeResult.swift']) {
    const vc = code(fs.readFileSync(path.join(DIR, f), 'utf8'));
    assert.match(vc, /transitions\.drag\(g, page: self\)/, `${f}: edge back drives the transition object`);
    assert.ok(!/UIPercentDrivenInteractiveTransition/.test(vc), `${f}: no UIKit percent-driven transition`);
  }
});
