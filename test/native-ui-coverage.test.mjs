// QA-H1 覆盖门禁（B3.3；B3B4 §5.1）：已注册的每一屏、每个弹层、每个浮条，至少有一个状态夹具，
// 且该夹具的原生基线（Baseline/<状态>_<外观>_<字号>.png + .json）都在册；或者在 coverage.json 的 notApplicable 里写明理由。
// 另：夹具文件本身的形状（状态名 = 文件名、字段类型）、夹具引用的 base / template / op 都存在。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, BASELINE_DIR, STATES_DIR, loadFixtures, sizesOf } from '../ios/ShiziApp/scripts/native-ui/registry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coverage = JSON.parse(readFileSync(join(root, 'ios/ShiziApp/scripts/native-ui/coverage.json'), 'utf8'));
const NA = new Set(Object.keys(coverage.notApplicable));
const APPEARANCES = ['light', 'dark'];

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

/** src/ui 里 registerScreen(名字…) 注册的全部屏名（名字是字符串字面量，或同文件 const 常量）。 */
function registeredScreens() {
  const names = new Set();
  for (const file of walk(join(root, 'src/ui'))) {
    if (file.endsWith('/router.js')) continue;
    const src = readFileSync(file, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    for (const m of src.matchAll(/registerScreen\(\s*([A-Za-z_][A-Za-z0-9_]*|'[^']+')/g)) {
      const arg = m[1];
      if (arg.startsWith("'")) { names.add(arg.slice(1, -1)); continue; }
      const def = new RegExp(`const ${arg}\\s*=\\s*'([^']+)'`).exec(src);
      assert.ok(def, `${file}: registerScreen(${arg}) — 找不到 const ${arg} = '…'`);
      names.add(def[1]);
    }
  }
  return names;
}

/** src/ui 里的弹层名：export const X_OVERLAY = '…' 与 openOverlay(…, { name: '…' })。 */
function overlayNames() {
  const names = new Set();
  for (const file of walk(join(root, 'src/ui'))) {
    const src = readFileSync(file, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    for (const m of src.matchAll(/const [A-Z_]*OVERLAY\s*=\s*'([^']+)'/g)) names.add(m[1]);
    for (const m of src.matchAll(/openOverlay\([^)]*\{\s*name:\s*'([^']+)'/g)) names.add(m[1]);
  }
  names.delete('overlay');
  return names;
}

const parityFixtures = FIXTURES.filter(f => f.parity !== false);
const coveredBy = (field, name) => parityFixtures.filter(f => f[field] === name);

test('every registered screen has a fixture or is listed as not applicable', () => {
  const known = new Set([...coverage.screens, ...NA]);
  const registered = registeredScreens();
  const unlisted = [...registered].filter(n => !known.has(n));
  assert.deepEqual(unlisted, [], `新注册的屏没有在 coverage.json 登记：${unlisted.join(', ')}`);
  for (const name of coverage.screens) {
    assert.ok(coveredBy('screen', name).length > 0, `屏 ${name} 没有任何状态夹具（ShiziUITests/States/*.json 的 "screen": "${name}"）`);
  }
});

test('every overlay and floater has a fixture or is listed as not applicable', () => {
  const known = new Set([...coverage.overlays, ...NA]);
  const unlisted = [...overlayNames()].filter(n => !known.has(n));
  assert.deepEqual(unlisted, [], `新弹层没有在 coverage.json 登记：${unlisted.join(', ')}`);
  for (const name of coverage.overlays) assert.ok(coveredBy('overlay', name).length > 0, `弹层 ${name} 没有任何状态夹具（"overlay": "${name}"）`);
  for (const name of coverage.floaters) assert.ok(coveredBy('floater', name).length > 0, `浮条 ${name} 没有任何状态夹具（"floater": "${name}"）`);
});

test('notApplicable entries carry a reason and are not also claimed as covered', () => {
  for (const [name, why] of Object.entries(coverage.notApplicable)) {
    assert.ok(typeof why === 'string' && why.length >= 6, `${name}: notApplicable 要写理由`);
    assert.ok(![...coverage.screens, ...coverage.overlays, ...coverage.floaters].includes(name), `${name} 既登记为要覆盖又写了不适用`);
  }
});

test('every native fixture has its baseline PNG + JSON (light / dark × L / XXXL; AX3 / AX5 for ax states; or the fixture own sizes)', () => {
  const missing = [];
  for (const f of parityFixtures) {
    for (const a of APPEARANCES) for (const s of sizesOf(f)) {
      for (const ext of ['png', 'json']) {
        const file = join(BASELINE_DIR, `${f.state}_${a}_${s}.${ext}`);
        if (!existsSync(file)) missing.push(`${f.state}_${a}_${s}.${ext}`);
      }
    }
  }
  assert.deepEqual(missing.slice(0, 20), [], `缺基线 ${missing.length} 个（verify-native-ui.sh --update-baseline --states …）`);
});

test('no orphan baseline files (every Baseline file belongs to a fixture)', () => {
  const names = new Set(parityFixtures.map(f => f.state));
  const orphans = readdirSync(BASELINE_DIR).filter(f => /\.(png|json)$/.test(f)).filter(f => {
    const m = /^(.+)_(light|dark)_([A-Za-z0-9]+)\.(png|json)$/.exec(f);
    return !m || !names.has(m[1]);
  });
  assert.deepEqual(orphans, [], `没有对应夹具的基线文件：${orphans.slice(0, 10).join(', ')}`);
});

test('fixtures are well-formed: base / template / op references exist, screen is declared', () => {
  const all = new Map(FIXTURES.map(f => [f.state, f]));
  const internal = readdirSync(STATES_DIR).filter(f => f.startsWith('_') && f.endsWith('.json')).map(f => f.slice(0, -5));
  for (const n of internal) all.set(n, JSON.parse(readFileSync(join(STATES_DIR, `${n}.json`), 'utf8')));
  // D84：造数据 op 由 Swift 执行（ShiziApp/QAOps.swift 的 switch），不再有 States/_ops/*.js
  const ops = new Set([...readFileSync(join(root, 'ios/ShiziApp/ShiziApp/QAOps.swift'), 'utf8').matchAll(/^\s*case "(\w+)"/gm)].map(m => m[1]));
  const templates = new Set(readdirSync(join(STATES_DIR, '_templates')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)));
  for (const [name, f] of all) {
    if (f.base) assert.ok(all.has(f.base), `${name}: base "${f.base}" 不存在`);
    if (f.template) assert.ok(templates.has(f.template), `${name}: template "${f.template}" 不存在`);
    for (const s of f.setup || []) assert.ok(ops.has(s.op), `${name}: 未知 op "${s.op}"（ShiziApp/QAOps.swift 里没有 case "${s.op}"）`);
    if (!name.startsWith('_') && f.parity !== false) {
      assert.ok(typeof f.screen === 'string' && f.screen, `${name}: 缺 "screen"`);
      assert.ok(typeof f.name === 'string' && f.name, `${name}: 缺 "name"`);
    }
  }
  // 数据驱动的承诺：状态夹具读得进来（文件名 = 状态名）
  assert.ok(loadFixtures().length === FIXTURES.length);
});
