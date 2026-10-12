// iOS 壳的触觉档位（第三轮 C3-R，D53，I3-04；交互与动效规范 F1，D58 ③，审计 P1-34）。不编译 Xcode 工程，只对 WebViewController.swift 做静态核对：
//   · 页面 haptics.js 的每一档 HAPTIC_KINDS 在 playHaptic 里都有对应 case；
//   · 每档的生成器与强度逐值等于 tokens.json haptic（judge soft 0.7、seal rigid 0.8、light light 0.5、select Selection）；
//   · 判断之后顺手 prepare() 落印那一档，落印那一下不延迟；未知 kind 忽略；旧档名只作过渡别名，不再有 .medium 与 milestone。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAPTIC_KINDS } from '../src/platform/haptics.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swift = readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/WebViewController.swift'), 'utf8');
const tokens = JSON.parse(readFileSync(join(ROOT, 'docs/design/design-system-v1/tokens.json'), 'utf8'));
const section = swift.slice(swift.indexOf('// MARK: - 触觉反馈'), swift.indexOf('// MARK: - 练习提醒'));

const GENERATOR = { judge: 'judgeHaptic', seal: 'sealHaptic', light: 'lightHaptic', select: 'selectionHaptic' };

test('每一档页面触觉在原生 playHaptic 里都有 case；HAPTIC_KINDS 就是 tokens.json 的四档', () => {
  assert.deepEqual([...HAPTIC_KINDS].sort(), Object.keys(tokens.haptic).filter(k => k !== 'note' && k !== 'none').sort());
  for (const kind of HAPTIC_KINDS) assert.match(section, new RegExp(`case [^\\n]*"${kind}"[^\\n]*:`), `playHaptic handles ${kind}`);
  assert.match(section, /default:\s*\n\s*break/, 'unknown kinds are ignored');
});

test('生成器与强度逐值等于 tokens.json haptic（judge soft 0.7，D58 ③）', () => {
  for (const kind of HAPTIC_KINDS) {
    const spec = tokens.haptic[kind];
    const gen = GENERATOR[kind];
    if (spec.native === 'UISelectionFeedbackGenerator') {
      assert.match(swift, new RegExp(`private lazy var ${gen} = UISelectionFeedbackGenerator\\(\\)`), kind);
      continue;
    }
    assert.match(swift, new RegExp(`private lazy var ${gen} = UIImpactFeedbackGenerator\\(style: \\.${spec.style}\\)`), `${kind} style .${spec.style}`);
    assert.match(section, new RegExp(`${gen}\\.impactOccurred\\(intensity: ${spec.intensity}\\)`), `${kind} intensity ${spec.intensity}`);
  }
  assert.doesNotMatch(swift, /style: \.medium/, 'the judgement is no longer .medium without intensity (P1-34)');
  assert.doesNotMatch(swift, /UINotificationFeedbackGenerator|milestone/, 'milestone is gone');
});

test('seal = rigid 0.8，只此一处；判断之后预热它', () => {
  assert.match(section, /case "seal":\s*\n\s*sealHaptic\.impactOccurred\(intensity: 0\.8\)\s*\n\s*sealHaptic\.prepare\(\)/);
  assert.equal((swift.match(/style: \.rigid/g) || []).length, 1, 'rigid is used only for the seal');
  const judge = section.slice(section.indexOf('case "judge"'), section.indexOf('case "seal":'));
  assert.match(judge, /sealHaptic\.prepare\(\)/, 'a judgement warms up the seal generator');
});

test('旧档名只作过渡别名（stamp → judge，action / undo → light）', () => {
  assert.match(section, /case "judge", "stamp":/);
  assert.match(section, /case "light", "action", "undo":/);
});
