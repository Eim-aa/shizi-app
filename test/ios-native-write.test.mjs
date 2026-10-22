// B2.0 原生写字页的静态门禁（docs/engineering/v10/B2-原生写字架构.md §5 / §9）：
// 1. 文案单一来源：原生写字页的 Swift 源码里不得有含汉字的字符串字面量——用户可见的字一律取自页面 src/config/copy（open 回包的 copy 字典）；
// 2. 原生写字页用到的文案键都在 native-session.js 的 NATIVE_WRITE_COPY_KEYS 里（键名写错 = 原生拿到空字符串）；
// 3. 纵切只在开发构建：这些文件整体包在 #if DEBUG 里（Release 产物不含，verify-archive 另查标记）；
// 4. B2.1 书写面转正：NativeInkView / InkModel 是 Release 组件（不包 #if DEBUG），spike 叠层 NativeInkSpike 与金标准自检 InkModelCheck 仍整体只在 DEBUG，
//    书写面里的量测钩子（NativeInkLatency 等）只在 #if DEBUG 块里。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './core/helpers.mjs';
import { NATIVE_WRITE_COPY_KEYS } from '../src/ui/screens/write/native-session.js';
import { NATIVE_RESULT_COPY_KEYS } from '../src/session/result-api.js';

const DIR = path.join(ROOT, 'ios/ShiziApp/ShiziApp');
const FILES = ['NativeWriteViewController.swift', 'NativeWriteCoordinator.swift', 'NativeWriteBridge.swift', 'NativeGlyph.swift', 'NativeWriteLayout.swift', 'NativeHint.swift', 'NativeJudge.swift', 'NativeTrace.swift', 'NativeSkipEnd.swift',
  'NativeResult.swift']; // B2.7 原生结果页
// B2.7：画墨接口 NativeInkPaint 与书写面同为 Release 组件（R11-A 的网页同算法墨换进来的地方）
const SURFACE = ['NativeInkView.swift', 'InkModel.swift', 'NativeInkWire.swift', 'NativeInkPaint.swift'];
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
  const src = ['NativeWriteViewController.swift', 'NativeJudge.swift'].map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  const used = [...new Set([...src.matchAll(/tr\("([A-Z][\w-]*\.\w+)"/g)].map(m => m[1]))];
  assert.ok(used.length >= 10);
  for (const k of used) assert.ok(NATIVE_WRITE_COPY_KEYS.includes(k), `${k} missing from NATIVE_WRITE_COPY_KEYS`);
});

test('native write sources: DEBUG only during B2.0', () => {
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8').trim();
    assert.ok(src.startsWith('#if DEBUG') && src.endsWith('#endif'), f);
  }
});

test('native ink surface: Release component since B2.1; spike overlay, golden self-check and latency hooks stay DEBUG-only', () => {
  for (const f of SURFACE) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8').trim();
    assert.ok(!src.startsWith('#if DEBUG'), `${f} is compiled into Release`);
  }
  for (const f of ['NativeInkSpike.swift', 'InkModelCheck.swift']) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8').trim();
    assert.ok(src.startsWith('#if DEBUG') && src.endsWith('#endif'), `${f} stays DEBUG-only`);
  }
  // 书写面里 DEBUG 专用的东西（T1 量测、spike 落定原型的钩子、淡出）只出现在 #if DEBUG 块里
  const lines = fs.readFileSync(path.join(DIR, 'NativeInkView.swift'), 'utf8').split('\n');
  const stack = [];
  const leaks = [];
  lines.forEach((line, i) => {
    const d = line.trim();
    if (/^#if\b/.test(d)) stack.push(/^#if\s+DEBUG\b/.test(d));
    else if (/^#else\b/.test(d) && stack.length) stack[stack.length - 1] = false;
    else if (/^#endif\b/.test(d)) stack.pop();
    else if (/NativeInkLatency|latency\.|overlayFrame|afterFrame|fadeOutAndHide|stepFade/.test(line.replace(/\/\/.*$/, '')) && !stack.some(Boolean)) leaks.push(i + 1);
  });
  assert.deepEqual(leaks, []);
  // Release 可执行文件含书写面：ObjC 名固定（verify-archive.sh 按它查）
  assert.match(lines.join('\n'), /@objc\(ShiziNativeInkView\)\s*\nfinal class NativeInkView/);
  assert.match(fs.readFileSync(path.join(ROOT, 'ios/ShiziApp/scripts/verify-archive.sh'), 'utf8'), /ShiziNativeInkView/);
});

test('B2.2: the native write page does not depend on the DEBUG spike (wire / colour tools are the Release NativeInkWire)', () => {
  for (const f of FILES) {
    const src = code(fs.readFileSync(path.join(DIR, f), 'utf8'));
    assert.ok(!/NativeInkSpike/.test(src), `${f} references the spike`);
  }
  const spike = fs.readFileSync(path.join(DIR, 'NativeInkSpike.swift'), 'utf8');
  assert.match(spike, /NativeInkWire\.parseColor/);
  assert.match(spike, /NativeInkWire\.rawStrokes/);
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
