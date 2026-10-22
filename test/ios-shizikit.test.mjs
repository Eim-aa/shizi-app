// B3.1 原生组件库 ShiziKit 的 node 侧门禁（计划 B3B4-原生化架构与计划.md §3.2 / §6.1 B3.1 行）：
// 1. 生成物同步：ios/ShiziApp/ShiziApp/ShiziKit/Generated/*.json 与 tokens.json / tokens.css / policy / motion.js / copy 同步（改了来源要重跑
//    node scripts/build_shizikit.mjs；pnpm run verify:tokens / verify:copy 也跑 --check）；
// 2. 生成规则：颜色 = tokens.css 浅 / 深块的声明原文（页面 getComputedStyle 同串）且与 tokens.json 同值；字阶 = 各档位 --k 下的表达式（WebKit 1/64 截断），
//    AX 档 = :root[data-ax] 直接取值；写字 / 结果页的动效与时刻 = write-api.js 同一批函数；文案 = COPY；
//    （「生成规则 = 页面在 WKWebView 里真算出来的值」由 ShiziWriteTests/ShiziKitTests.swift 在 12 个字号档位 × 浅 / 深逐项核对。）
// 3. 工程接入：生成物在 App 的 Resources 阶段（进包），ShiziKit 的 Swift 文件都在 App 的 Sources 阶段；
// 4. App 的原生源码（ios/ShiziApp/ShiziApp 下全部 Swift；整文件 DEBUG 的开发工具除外）没有汉字字符串字面量——用户可见的字只来自 src/config/copy（ShiziCopy / 回包）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './core/helpers.mjs';
import { OUT_DIR, CATEGORIES, generate, sources, layoutUnit } from '../scripts/build_shizikit.mjs';
import * as policy from '../src/config/policy.js';
import { COPY } from '../src/config/copy/index.js';
import { writeMotion, writeTiming, resultMotion } from '../src/session/write-api.js';
import { NATIVE_WRITE_COLOR_TOKENS, NATIVE_WRITE_TYPE_TOKENS } from '../src/ui/screens/write/native-session.js';

const IOS = path.join(ROOT, 'ios/ShiziApp');
const tokensJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/design/design-system-v1/tokens.json'), 'utf8'));

test('shizikit: generated resources are in sync with their sources (node scripts/build_shizikit.mjs)', async () => {
  const files = await generate();
  for (const [name, text] of Object.entries(files)) {
    const cur = fs.readFileSync(path.join(OUT_DIR, name), 'utf8');
    assert.ok(cur === text, `stale ${name}: run node scripts/build_shizikit.mjs`);
  }
  assert.deepEqual(fs.readdirSync(OUT_DIR).sort(), Object.keys(files).sort(), 'no stray files in ShiziKit/Generated/');
});

test('shizikit: colours are the tokens.css declarations (light / dark) and agree with tokens.json; every colour the B2 pages ask for is there', async () => {
  const { ShiziKitTokens: t } = await sources();
  const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (const theme of ['light', 'dark']) {
    for (const k of NATIVE_WRITE_COLOR_TOKENS) assert.ok(t.colors[theme][k], `${theme} ${k}`);
    for (const [k, v] of Object.entries(t.colors[theme])) {
      if (k.endsWith('-shadow')) continue;
      const j = tokensJson.color[theme][camel(k)];
      if (j && /^#/.test(j)) assert.equal(v.toUpperCase(), j.toUpperCase(), `${theme} ${k} vs tokens.json`);
    }
  }
  assert.notEqual(t.colors.light.paper, t.colors.dark.paper);
});

test('shizikit: type scale per content size = tokens.css at --k (1/64 px truncation); AX rows are the data-ax values', async () => {
  const { ShiziKitTokens: t } = await sources();
  assert.deepEqual(Object.keys(t.type.categories), [...CATEGORIES]);
  for (const cat of CATEGORIES) {
    const row = t.type.categories[cat];
    assert.equal(row.k, policy.contentSizeScale[cat]);
    for (const k of NATIVE_WRITE_TYPE_TOKENS) assert.ok(row.values[k] > 0, `${cat} ${k}`);
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

test('shizikit: page motion / timing are the write-api bundles; copy is COPY', async () => {
  const { ShiziKitTokens: t, ShiziKitCopy: copy } = await sources();
  assert.deepEqual(t.write.motion, JSON.parse(JSON.stringify(writeMotion())));
  assert.deepEqual(t.write.timing, writeTiming());
  assert.deepEqual(t.result.motion, JSON.parse(JSON.stringify({ ...writeMotion(), result: resultMotion() })));
  assert.deepEqual(copy, JSON.parse(JSON.stringify(COPY)));
  for (const k of ['duration', 'role', 'moment', 'bezier', 'gesture', 'timing']) assert.ok(k in t.motion, `motion.${k}`);
  for (const k of ['space', 'radius', 'line', 'touch']) assert.deepEqual(t[k], tokensJson[k]);
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
