// QA-SHARD：把逐屏取证与流程用例分给 N 台模拟器（verify-native-ui.sh --shards N 用）。
// usage:
//   node shard-plan.mjs states <N> [--states a,b]     打印 ≤N 行，每行一组状态（逗号分隔）；按「外观 × 字号」屏数均衡（贪心：最重的先分给最轻的一组）
//   node shard-plan.mjs refstates <N> [--states a,b]  同上，但是网页参考的状态集（--update-reference 用）
//   node shard-plan.mjs classes <N> [--only A,B]      打印 ≤N 行，每行一组测试类；按历史耗时（flow-durations.json，没有的按 40 秒）均衡；
//                                                     计时敏感类（PERF_CLASSES，缺省 NativeStageFlowTests）不进这些组，另起一行以「perf:」开头
//   node shard-plan.mjs durations <flows.md>          用一份完整的 flows.md 刷新 flow-durations.json
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const UITESTS = join(here, '..', '..', 'ShiziUITests');
const DURATIONS = join(here, 'flow-durations.json');
const [mode, arg, ...rest] = process.argv.slice(2);
const opt = k => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : ''; };

/** 贪心均衡（LPT）：items = [{name, w}] → 至多 n 组，组内保持原顺序。 */
function balance(items, n) {
  const groups = Array.from({ length: n }, () => ({ w: 0, names: [] }));
  for (const it of [...items].sort((a, b) => b.w - a.w || a.name.localeCompare(b.name))) {
    const g = groups.reduce((m, x) => (x.w < m.w ? x : m));
    g.w += it.w; g.names.push(it.name);
  }
  const order = new Map(items.map((it, i) => [it.name, i]));
  return groups.filter(g => g.names.length).map(g => g.names.sort((a, b) => order.get(a) - order.get(b)));
}

if (mode === 'states') {
  const { APPEARANCES, STATES, fixtureOf, sizesOf } = await import('./config.mjs');
  const n = Number(arg) || 1;
  const wanted = opt('states');
  let states = STATES;
  if (wanted && wanted !== 'true') { const set = new Set(wanted.split(',').filter(Boolean)); states = STATES.filter(s => set.has(s)); }
  // 未知 / 非原生状态：capture.mjs 自己报错或过滤，这里不吞
  const items = states.map(s => ({ name: s, w: APPEARANCES.length * sizesOf(fixtureOf[s]).length }));
  for (const g of balance(items, n)) console.log(g.join(','));
} else if (mode === 'refstates') {
  // 网页参考（--update-reference）取的是全部参考状态（比原生多），单独分组
  const { REFERENCE_STATES, APPEARANCES, fixtureOf, sizesOf } = await import('./config.mjs');
  const n = Number(arg) || 1;
  const wanted = opt('states');
  let states = REFERENCE_STATES;
  if (wanted && wanted !== 'true') { const set = new Set(wanted.split(',').filter(Boolean)); states = REFERENCE_STATES.filter(s => set.has(s)); }
  for (const g of balance(states.map(s => ({ name: s, w: APPEARANCES.length * sizesOf(fixtureOf[s]).length })), n)) console.log(g.join(','));
} else if (mode === 'classes') {
  const n = Number(arg) || 1;
  const perf = new Set((process.env.PERF_CLASSES || 'NativeStageFlowTests').split(',').filter(Boolean));
  let all = readdirSync(UITESTS).filter(f => f.endsWith('.swift')).flatMap(f => [...readFileSync(join(UITESTS, f), 'utf8').matchAll(/^(?:final )?class (\w+)\s*:\s*XCTestCase/gm)].map(m => m[1]));
  const only = opt('only');
  if (only && only !== 'true') all = only.split(',').filter(Boolean);
  const dur = existsSync(DURATIONS) ? JSON.parse(readFileSync(DURATIONS, 'utf8')) : {};
  const items = all.filter(c => !perf.has(c)).map(c => ({ name: c, w: dur[c] || 40 }));
  for (const g of balance(items, n)) console.log(g.join(','));
  const p = all.filter(c => perf.has(c));
  if (p.length) console.log(`perf:${p.join(',')}`);
} else if (mode === 'durations') {
  const dur = {};
  for (const line of readFileSync(arg, 'utf8').split('\n')) {
    const m = line.match(/^\| (\w+)\.\w+ \| [^|]+\| (\d+) \|/);
    if (m) dur[m[1]] = (dur[m[1]] || 0) + Number(m[2]);
  }
  writeFileSync(DURATIONS, JSON.stringify(dur, null, 2) + '\n');
  console.log(`wrote ${DURATIONS} (${Object.keys(dur).length} classes)`);
} else {
  console.error('usage: shard-plan.mjs states|classes <N> | durations <flows.md>');
  process.exit(2);
}
