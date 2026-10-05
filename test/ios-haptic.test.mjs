// 第三轮 C3-R（D53，I3-04）：iOS 壳的触觉档位。不编译 Xcode 工程，只对 WebViewController.swift 做静态核对：
//   · 页面 haptics.js 的每一档 HAPTIC_KINDS 在 playHaptic 里都有对应 case（新增 seal 不能漏）；
//   · seal 是 UIImpactFeedbackGenerator(style: .rigid)，impactOccurred(intensity: 0.8)；
//   · 判断的 stamp 之后顺手 prepare() 落印那一档，落印那一下不延迟；未知 kind 忽略。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAPTIC_KINDS } from '../src/platform/haptics.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swift = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/WebViewController.swift'), 'utf8');
const section = swift.slice(swift.indexOf('// MARK: - 触觉反馈'), swift.indexOf('// MARK: - 练习提醒'));

test('每一档页面触觉在原生 playHaptic 里都有 case', () => {
  assert.ok(HAPTIC_KINDS.includes('seal'), 'haptics.js has the seal kind');
  for (const kind of HAPTIC_KINDS) assert.match(section, new RegExp(`case "${kind}":`), `playHaptic handles ${kind}`);
  assert.match(section, /default:\s*\n\s*break/, 'unknown kinds are ignored');
});

test('seal = rigid 0.8，只此一处；stamp 之后预热它', () => {
  assert.match(swift, /private lazy var sealHaptic = UIImpactFeedbackGenerator\(style: \.rigid\)/);
  assert.match(section, /case "seal":\s*\n\s*sealHaptic\.impactOccurred\(intensity: 0\.8\)\s*\n\s*sealHaptic\.prepare\(\)/);
  assert.equal((swift.match(/style: \.rigid/g) || []).length, 1, 'rigid is used only for the seal');
  const stamp = section.slice(section.indexOf('case "stamp":'), section.indexOf('case "seal":'));
  assert.match(stamp, /sealHaptic\.prepare\(\)/, 'a judgement stamp warms up the seal generator');
});
