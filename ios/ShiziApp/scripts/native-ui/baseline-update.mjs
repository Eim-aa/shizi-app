// D84：把一次逐屏取证存成冻结的原生基线（verify-native-ui.sh --update-baseline 调用）。
//
// usage: node baseline-update.mjs --from <取证目录> --to <基线目录> [--states a,b]
// - 取证目录里每个 <状态>_<外观>_<字号>.json 都必须是取证成功的（ok !== false、没有 error）——有一屏出错就一个都不存，退出码 1；
// - 全量（不给 --states）：先清掉基线目录里的 png / json，再整份拷入（夹具删掉的状态不会留下孤儿）；
//   给了 --states：只替换这几个状态的文件，其余不动；
// - 只拷夹具 native: true 的状态，并且要求每个状态的 外观 × 字号 都齐（缺了退出码 1）。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { APPEARANCES, STATES, fixtureOf, sizesOf } from './config.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const { from, to } = args;
if (!from || !to) {
  console.error('usage: node baseline-update.mjs --from <dir> --to <dir> [--states a,b]');
  process.exit(2);
}
const only = args.states && args.states !== 'true' ? new Set(args.states.split(',').filter(Boolean)) : null;
const states = STATES.filter(s => !only || only.has(s));

const names = [];
const problems = [];
for (const state of states) {
  for (const appearance of APPEARANCES) {
    for (const size of sizesOf(fixtureOf[state])) {
      const name = `${state}_${appearance}_${size}`;
      names.push(name);
      const json = join(from, `${name}.json`);
      const png = join(from, `${name}.png`);
      if (!existsSync(json) || !existsSync(png)) { problems.push(`${name}: 没有取证`); continue; }
      const dump = JSON.parse(readFileSync(json, 'utf8'));
      if (dump.ok === false || dump.error) problems.push(`${name}: 取证出错（${dump.error || 'ok: false'}）`);
    }
  }
}
if (problems.length) {
  console.error(`baseline NOT updated: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
  process.exit(1);
}

mkdirSync(to, { recursive: true });
const fileState = f => { const m = /^(.+)_(light|dark)_[A-Za-z0-9]+\.(png|json)$/.exec(f); return m ? m[1] : null; };
for (const f of readdirSync(to)) {
  const st = fileState(f);
  if (st !== null && (!only || only.has(st))) rmSync(join(to, f)); // 全量：清光；--states：只清这几个状态的旧文件
}
for (const name of names) for (const ext of ['png', 'json']) copyFileSync(join(from, `${name}.${ext}`), join(to, `${name}.${ext}`));
console.log(`baseline updated: ${states.length} states, ${names.length} screens (png + json) → ${to}`);
