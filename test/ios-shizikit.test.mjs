// B3.1 原生组件库 ShiziKit 的 node 侧门禁（计划 B3B4-原生化架构与计划.md §3.2 / §6.1 B3.1 行）。D84 起 ShiziKit/Generated/*.json 是手改的唯一真相源
// （README 见该目录），不再有生成器；这里改成直接读 JSON：
// 1. 目录里只有两份 JSON + README；ShiziKitCopy.json 与 ShiziCore Bundled/copy.json 逐字相同；ShiziKitTokens.json 的 motion 与 Bundled/motion.json 相同；
// 2. 颜色 = 浅 / 深两套同键且与 design-system-v1/tokens.json 同值；字阶 = 各档位的 pt 值（1/64 截断倍数；档位 k = Bundled/policy.json contentSizeScale）；AX 档取值表见 test/ax-type.test.mjs；
//    （「JSON 的值 = 页面真算出来的值」由 ShiziWriteTests/ShiziKitTests.swift 在 12 个字号档位 × 浅 / 深逐项核对。）
// 3. 工程接入：JSON 在 App 的 Resources 阶段（进包），ShiziKit 的 Swift 文件都在 App 的 Sources 阶段；
// 4. App 的原生源码（ios/ShiziApp/ShiziApp 下全部 Swift；整文件 DEBUG 的开发工具除外）没有汉字字符串字面量——用户可见的字只来自 ShiziKitCopy.json。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './core/helpers.mjs';

const IOS = path.join(ROOT, 'ios/ShiziApp');
const GEN = path.join(IOS, 'ShiziApp/ShiziKit/Generated');
const BUNDLED = path.join(ROOT, 'ios/ShiziCore/Sources/ShiziCore/Bundled');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tokensJson = readJson(path.join(ROOT, 'docs/design/design-system-v1/tokens.json'));
const kit = readJson(path.join(GEN, 'ShiziKitTokens.json'));
const kitCopy = readJson(path.join(GEN, 'ShiziKitCopy.json'));
const policy = readJson(path.join(BUNDLED, 'policy.json'));

/** 原生页面要的颜色 / 字阶令牌（写字页 + 结果页；从原 src/ui/screens/write/native-session.js 的清单搬来）。 */
const COLOR_TOKENS = ['paper', 'hand', 'ref', 'frame', 'line', 'ink1', 'ink2', 'ink3', 'ink4', 'field', 'danzhu', 'toast-bg', 'toast-fg', 'toast-act', 'toast-line', 'toast-shadow', 'scrim', 'elev', 'sheet', 'btn-bg', 'btn-fg', 'guide', 'under', 'zhu', 'seal', 'on-seal'];
const TYPE_TOKENS = ['fs13', 'lh13', 'fs15', 'lh15', 'fs17', 'lh17', 'lh17s', 'fs22', 'lh22', 'fs28', 'btn-h', 'r-box'];
const CATEGORIES = ['xS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'AX1', 'AX2', 'AX3', 'AX4', 'AX5'];
const layoutUnit = (px) => Math.trunc(px * 64 + 1e-9) / 64;

test('shizikit: Generated/ holds the two hand-edited JSON files and a README; copy and motion agree with ShiziCore Bundled', () => {
  assert.deepEqual(fs.readdirSync(GEN).sort(), ['README.md', 'ShiziKitCopy.json', 'ShiziKitTokens.json']);
  assert.deepEqual(kitCopy, readJson(path.join(BUNDLED, 'copy.json')), 'ShiziKitCopy.json = Bundled/copy.json');
  assert.deepEqual(kit.motion, readJson(path.join(BUNDLED, 'motion.json')), 'ShiziKitTokens.json motion = Bundled/motion.json');
  for (const f of ['ShiziKitTokens.json', 'ShiziKitCopy.json']) assert.ok(fs.readFileSync(path.join(GEN, f), 'utf8').endsWith('\n'), f);
});

test('shizikit: colours — light / dark carry the same keys, agree with tokens.json, and every colour the B2 pages ask for is there', () => {
  const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  assert.deepEqual(Object.keys(kit.colors.light), Object.keys(kit.colors.dark));
  for (const theme of ['light', 'dark']) {
    for (const k of COLOR_TOKENS) assert.ok(kit.colors[theme][k], `${theme} ${k}`);
    for (const [k, v] of Object.entries(kit.colors[theme])) {
      if (k.endsWith('-shadow')) continue;
      const j = tokensJson.color[theme][camel(k)];
      if (j && /^#/.test(j)) assert.equal(v.toUpperCase(), j.toUpperCase(), `${theme} ${k} vs tokens.json`);
    }
  }
  assert.notEqual(kit.colors.light.paper, kit.colors.dark.paper);
});

test('shizikit: type scale per content size (1/64 pt multiples); k = policy.contentSizeScale; AX rows are absolute values', () => {
  const t = kit;
  assert.deepEqual(Object.keys(t.type.categories), CATEGORIES);
  assert.equal(t.type.compactTextScale, policy.compactTextScale);
  for (const cat of CATEGORIES) {
    const row = t.type.categories[cat];
    assert.equal(row.k, policy.contentSizeScale[cat]);
    for (const k of TYPE_TOKENS) assert.ok(row.values[k] > 0, `${cat} ${k}`);
    for (const v of Object.values(row.values)) assert.equal(v, layoutUnit(v), `${cat}: values are LayoutUnit multiples`);
  }
  const L = t.type.categories.L.values;
  assert.deepEqual([L.fs13, L.lh13, L.fs15, L.fs17, L.lh17s, L.fs22, L.fs28, L['btn-h'], L['r-box']], [13, 20, 15, 17, 22, 22, 28, 54, 24]);
  const X = t.type.categories.XXXL.values;
  assert.equal(X.fs17, 22.9375, 'XXXL 17 × 1.35 = 22.95 → 22.9375');
  assert.equal(X.fs13, layoutUnit(13 * 1.35));
  assert.equal(t.type.categories.xS.values.fs13, 12, 'fs13 floor 12 (max(12px, …))');
  const ax = tokensJson.typography.dynamicType.ax;
  for (let i = 0; i < 5; i++) {
    const v = t.type.categories[`AX${i + 1}`].values;
    assert.equal(t.type.categories[`AX${i + 1}`].ax, i + 1);
    assert.equal(v.fs17, ax.t17[i]);
    assert.equal(v.fs13, ax.t13[i]);
    assert.equal(v['btn-h'], Math.max(54, v.lh17 + 26), 'btn-h = max(54, lh17 + 26)');
  }
});

test('shizikit: page motion / timing bundles and the design-system tables are present', () => {
  for (const k of ['duration', 'role', 'moment', 'bezier', 'gesture', 'timing']) assert.ok(k in kit.motion, `motion.${k}`);
  for (const k of ['motion', 'timing']) {
    assert.ok(kit.write[k] && Object.keys(kit.write[k]).length > 0, `write.${k}`);
    assert.ok(kit.result[k] && Object.keys(kit.result[k]).length > 0, `result.${k}`);
  }
  assert.ok(kit.result.motion.result, 'result.motion.result');
  for (const k of ['space', 'radius', 'line', 'touch']) assert.deepEqual(kit[k], tokensJson[k]);
  for (const v of Object.values(kitCopy)) assert.ok(typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')));
});

test('shizikit: the Xcode project ships the generated resources and compiles every ShiziKit source into the app', () => {
  const pbx = fs.readFileSync(path.join(IOS, 'ShiziApp.xcodeproj/project.pbxproj'), 'utf8');
  for (const f of ['ShiziKitTokens.json', 'ShiziKitCopy.json']) assert.match(pbx, new RegExp(`/\\* ${f.replace('.', '\\.')} in Resources \\*/,`), f);
  const kit = path.join(IOS, 'ShiziApp/ShiziKit');
  const swift = fs.readdirSync(kit, { recursive: true }).filter((f) => f.endsWith('.swift'));
  assert.ok(swift.length >= 15, 'kit sources');
  for (const f of swift) {
    const name = path.basename(f);
    assert.match(pbx, new RegExp(`/\\* ${name.replace('.', '\\.')} in Sources \\*/,`), name);
    const src = fs.readFileSync(path.join(kit, f), 'utf8').trim();
    assert.ok(!src.startsWith('#if DEBUG'), `${name} is a Release component`);
  }
});

const HAN = /[㐀-鿿＀-￯　-〿]/;
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const swiftFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'build' || e.name.endsWith('.xcodeproj') ? [] : swiftFiles(p);
  return e.name.endsWith('.swift') ? [p] : [];
});

// DEBUG 专用的开发工具（整文件 #if DEBUG，Release 不编译；字串是给开发者看的自检 / spike 标签，不是用户可见文案）
const DEV_TOOLS = ['NativeInkSpike.swift', 'InkModelCheck.swift'];

test('native sources: no Chinese string literals in any app Swift file (user-visible text comes from src/config/copy)', () => {
  const files = swiftFiles(path.join(IOS, 'ShiziApp'));
  assert.ok(files.length >= 30);
  for (const f of files) {
    if (DEV_TOOLS.includes(path.basename(f))) {
      const src = fs.readFileSync(f, 'utf8').trim();
      assert.ok(src.startsWith('#if DEBUG') && src.endsWith('#endif'), `${path.basename(f)} stays a DEBUG-only developer tool`);
      continue;
    }
    const literals = code(fs.readFileSync(f, 'utf8')).match(/"(?:[^"\\\n]|\\.)*"/g) || [];
    assert.deepEqual(literals.filter((s) => HAN.test(s)), [], `${path.relative(ROOT, f)} has Chinese literals`);
  }
});
