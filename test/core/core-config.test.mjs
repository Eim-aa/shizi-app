// B4.1 ShiziCore 配置与数据资源的 node 侧门禁（不需要 Swift）。D84：Bundled/*.json（deck.json 除外）是手改的唯一真相源，不再与 src/ 比对：
//   1. 目录里恰好是约定的 16 个 JSON + README；资源都是纯 JSON 数据（无 undefined / 非有限数）；
//   2. policy-meta 的登记表覆盖全部 policy 导出（verify_copy 的 checkPolicyMeta，读 JSON）；motion.json 带齐令牌表；signature.json 形状正确；
//   3. deck.json 由 scripts/build_8105_chars.py 写，内容一致性由 verify:content（content-corpus）守；
//   4. 形状工厂（差分与金标准共用）造出的合法值全过 schema，变异值有相当比例被拒；
//   （Swift 与 JS 的 op 表同名由 core-diff.test.mjs 核对；policy 键与类型由 Swift ConfigDataTests 守。）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPolicyMeta, checkPolicyFiles, loadNativeCopy, PATHS } from '../../scripts/verify_copy.mjs';
import { makeCtx, rng } from '../../scripts/core-diff/lib/gen.mjs';
import { shapes } from '../../scripts/core-diff/lib/shapes.mjs';
import { validateValue } from '../../src/core/schema.js';
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ios/ShiziCore/Sources/ShiziCore/Bundled');

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, name + '.json'), 'utf8'));
const source = () => JSON.parse(fs.readFileSync(PATHS.source, 'utf8'));

test('core-config: Bundled/ holds exactly the 16 resources and a README; every one is plain JSON data', () => {
  const names = ['card-rules', 'char-order', 'copy', 'credits', 'deck-libraries', 'deck-meta', 'deck', 'epigraphs', 'fsrs-config', 'motion', 'policy-meta', 'policy', 'signature', 'unicode-scripts', 'view-brand', 'view-seal'];
  assert.deepEqual(fs.readdirSync(OUT_DIR).sort(), ['README.md', ...names.map((n) => n + '.json')].sort());
  const walk = (x, where) => {
    assert.ok(x !== undefined && typeof x !== 'function', where);
    if (typeof x === 'number') assert.ok(Number.isFinite(x), where);
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, where + '.' + k);
  };
  for (const n of names) walk(readJson(n), n);
});

test('core-config: motion.json carries the token tables; signature.json has the numeral parts', () => {
  const motion = readJson('motion');
  for (const k of ['duration', 'role', 'moment', 'easing', 'bezier', 'spring', 'scale', 'distance', 'gesture', 'timing', 'haptic', 'cssVars', 'roleKeys']) assert.ok(k in motion, `motion.${k}`);
  assert.equal('css' in motion || 'M' in motion || 'prefersReducedMotion' in motion, false, 'no functions / duplicates in motion.json');
  assert.deepEqual(Object.keys(readJson('signature')).sort(), ['digits', 'two', 'units', 'zero']);
});

test('core-config: policy-meta registers a P number for every policy export, matches 03, and covers every registered P', () => {
  const policy = readJson('policy');
  const meta = readJson('policy-meta');
  assert.deepEqual(checkPolicyFiles(source()).errors, []);
  assert.deepEqual(Object.keys(meta.exports).sort(), Object.keys(policy).sort());
  for (const [name, entry] of Object.entries(meta.exports)) {
    assert.ok(entry.p.length > 0, name);
    for (const p of entry.p) assert.ok(meta.registered.includes(p), `${name} ${p}`);
  }
  assert.deepEqual(meta.registered.filter((p) => !meta.covered.includes(p)), []);
});

test('core-config: the policy-meta check catches a missing export, an unregistered P and a stale registry', () => {
  const policy = readJson('policy');
  const meta = readJson('policy-meta');
  const pendingMarkdown = fs.readFileSync(PATHS.pending, 'utf8');
  const run = (m, pol = policy) => checkPolicyMeta(source(), { policy: pol, meta: m, pendingMarkdown }).errors;
  assert.deepEqual(run(meta), []);
  const first = Object.keys(meta.exports)[0];
  const noExport = structuredClone(meta);
  delete noExport.exports[first];
  assert.ok(run(noExport).some((e) => e.includes('differ from policy.json keys')));
  const noP = structuredClone(meta);
  noP.exports[first].p = [];
  assert.ok(run(noP).some((e) => e.includes(`policy.${first}: export has no P number`)));
  const badP = structuredClone(meta);
  badP.exports[first].p = ['P999'];
  assert.ok(run(badP).some((e) => e.includes('P999 is not registered')));
  const stale = structuredClone(meta);
  stale.registered = stale.registered.slice(1);
  assert.ok(run(stale).some((e) => e.includes('registered differs')));
});

test('core-config: copy.json and ShiziKitCopy.json are identical and every key is registered in copy-source.json', () => {
  const { modules, errors } = loadNativeCopy(source());
  assert.deepEqual(errors, []);
  assert.equal(modules.unregistered, undefined);
  assert.equal(Object.values(modules).reduce((n, t) => n + Object.keys(t).length, 0), Object.keys(readJson('copy')).length);
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
