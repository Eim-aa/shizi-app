// B4.1 ShiziCore 配置与数据资源的 node 侧门禁（不需要 Swift）：
//   1. 生成物（ios/ShiziCore/Sources/ShiziCore/Bundled/*.json）与 src/ 同步——改了 policy / motion / char-order / epigraphs / copy / 题库就要重跑 node scripts/build_core_config.mjs；
//   2. 生成物里没有 JS 专属的东西（函数 / undefined / 非有限数），资源自洽（deck.json = deck-data.js + context-overrides.js；policy-meta 的登记表覆盖全部 policy 导出）；
//   3. 形状工厂（差分与金标准共用）造出的合法值全过 schema，变异值有相当比例被拒；
//   （Swift 与 JS 的 op 表同名由 core-diff.test.mjs 核对。）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR, deckSources, generate, sources } from '../../scripts/build_core_config.mjs';
import { makeCtx, rng } from '../../scripts/core-diff/lib/gen.mjs';
import { shapes } from '../../scripts/core-diff/lib/shapes.mjs';
import { validateValue } from '../../src/core/schema.js';
import * as policy from '../../src/config/policy.js';

test('core-config: generated resources are in sync with src/ (node scripts/build_core_config.mjs)', async () => {
  const files = await generate();
  for (const [name, text] of Object.entries(files)) {
    const cur = fs.readFileSync(path.join(OUT_DIR, name), 'utf8');
    assert.ok(cur === text, `stale ${name}: run node scripts/build_core_config.mjs`);
  }
  const onDisk = fs.readdirSync(OUT_DIR).sort();
  assert.deepEqual(onDisk, Object.keys(files).sort(), 'no stray files in Resources/');
});

test('core-config: policy.json is every policy export, in export order; motion.json carries the token tables', async () => {
  const src = await sources();
  assert.deepEqual(Object.keys(src.policy), Object.keys(policy));
  assert.deepEqual(JSON.parse(JSON.stringify(src.policy)), JSON.parse(JSON.stringify({ ...policy })));
  for (const k of ['duration', 'role', 'moment', 'easing', 'bezier', 'spring', 'scale', 'distance', 'gesture', 'timing', 'haptic', 'cssVars', 'roleKeys']) assert.ok(k in src.motion, `motion.${k}`);
  assert.equal('css' in src.motion || 'M' in src.motion || 'prefersReducedMotion' in src.motion, false, 'no functions / duplicates in motion.json');
  assert.deepEqual(Object.keys(src.signature).sort(), ['digits', 'two', 'units', 'zero']);
});

test('core-config: policy-meta registers a P number for every policy export and covers every registered P', async () => {
  const meta = (await sources())['policy-meta'];
  assert.deepEqual(Object.keys(meta.exports).sort(), Object.keys(policy).sort());
  for (const [name, entry] of Object.entries(meta.exports)) {
    assert.ok(entry.p.length > 0, name);
    for (const p of entry.p) assert.ok(meta.registered.includes(p), `${name} ${p}`);
  }
  assert.deepEqual(meta.registered.filter((p) => !meta.covered.includes(p)), []);
});

test('core-config: deck.json = deck-data.js SEED / GROUPS + context-overrides.js', () => {
  const deck = deckSources();
  const file = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'deck.json'), 'utf8'));
  assert.equal(file.seed.length, deck.seed.length);
  assert.deepEqual(file.seed, JSON.parse(JSON.stringify(deck.seed)));
  assert.deepEqual(file.overrides, JSON.parse(JSON.stringify(deck.overrides)));
  assert.deepEqual(file.groups, JSON.parse(JSON.stringify(deck.groups)));
  assert.ok(file.seed.length > 7000 && Object.keys(file.overrides).length > 800);
});

test('core-config: shape factories produce valid values; mutations are mostly rejected', () => {
  const g = makeCtx(rng(7));
  const S = shapes(g);
  S.year = () => g.int(1000, 9999); // 0–99 年的日期被 schema 拒（Date.UTC 两位年怪癖），工厂的合法值不碰它
  let bad = 0;
  let n = 0;
  for (let i = 0; i < 1500; i += 1) {
    const { key, value } = S.forKind(g.pick(S.kinds));
    const err = validateValue(key, value);
    assert.equal(err, null, `${key}: ${err}\n${JSON.stringify(value)}`);
    n += 1;
    if (validateValue(key, S.mutate(value))) bad += 1;
  }
  assert.ok(n > 1000, `valid samples ${n}`);
  assert.ok(bad / n > 0.5, `mutations rejected ${bad}/${n}`);
});
