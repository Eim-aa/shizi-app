#!/usr/bin/env node
// ShiziCore 差分驱动（B4.0；计划 §4.3 ④）。同一条随机操作序列分别喂两个引擎，每一步回包（含整份状态快照）逐字段 + 逐字节比；
// 不同就自动缩小到最短复现序列，写到 scripts/core-diff/out/。
//
//   node scripts/core-diff/run.mjs                              js ↔ swift，200 个种子 × 300 步（时区 Asia/Shanghai）
//   node scripts/core-diff/run.mjs --seeds 5000 --steps 300     夜间 / 合并前
//   node scripts/core-diff/run.mjs --a js --b js-cli            任选两个引擎（js | js-cli | swift；js~<故障> 仅自检）
//   node scripts/core-diff/run.mjs --tz America/New_York        时区（两边一致：本进程与子进程都用这个 TZ）
//   node scripts/core-diff/run.mjs --self-test [--swift]        驱动自检（见 lib/selftest.mjs）
//   node scripts/core-diff/run.mjs --replay out/repro-12.jsonl  按文件重放并逐行打印两边回包
//   --seed-start N   从第 N 个种子起；--swift-bin <path>  指定命令行；--only store,schema  只用这些域（B4.4）
// 退出码：0 无差异；1 有差异；2 环境问题（例如 Swift 命令行没编）。
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const o = { a: 'js', b: 'swift', seeds: 200, steps: 300, seedStart: 1, tz: null, selfTest: false, swift: false, replay: null, swiftBin: null, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--a') o.a = argv[++i];
    else if (k === '--b') o.b = argv[++i];
    else if (k === '--seeds') o.seeds = Number(argv[++i]);
    else if (k === '--steps') o.steps = Number(argv[++i]);
    else if (k === '--seed-start') o.seedStart = Number(argv[++i]);
    else if (k === '--tz') o.tz = argv[++i];
    else if (k === '--self-test') o.selfTest = true;
    else if (k === '--swift') o.swift = true;
    else if (k === '--replay') o.replay = argv[++i];
    else if (k === '--swift-bin') o.swiftBin = argv[++i];
    else if (k === '--only') o.only = argv[++i].split(',');
    else throw new Error('unknown argument: ' + k);
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
process.env.TZ = args.tz || process.env.TZ || 'Asia/Shanghai';

const { openEngine, ROOT } = await import('./lib/engines.mjs');
const { runSeeds, describeFailure } = await import('./lib/runner.mjs');
const { lineOf } = await import('./lib/gen.mjs');
const { compareLines } = await import('./lib/compare.mjs');
const { selfTest } = await import('./lib/selftest.mjs');

const out = (s) => process.stdout.write(s + '\n');

async function main() {
  if (args.selfTest) {
    const r = await selfTest({ seeds: Math.min(args.seeds, 50), steps: args.steps, swift: args.swift, swiftPath: args.swiftBin, log: out });
    out(r.ok ? '自检通过' : '自检失败');
    return r.ok ? 0 : 1;
  }
  let a;
  let b;
  try {
    a = openEngine(args.a, { swiftPath: args.swiftBin });
    b = openEngine(args.b, { swiftPath: args.swiftBin });
  } catch (e) {
    out(e.message);
    return 2;
  }
  try {
    if (args.replay) {
      const reqs = fs.readFileSync(args.replay, 'utf8').split('\n').filter(Boolean).map((l) => ({ __raw: l }));
      await Promise.all([a.send('{"op":"reset","state":false}'), b.send('{"op":"reset","state":false}')]);
      let bad = 0;
      for (const r of reqs) {
        const [la, lb] = await Promise.all([a.send(r.__raw), b.send(r.__raw)]);
        const d = compareLines(la, lb);
        if (d) bad += 1;
        out(`> ${r.__raw}\n  ${a.name}: ${la}\n  ${b.name}: ${lb}${d ? `\n  ✗ ${d.kind} ${d.path}` : ''}`);
      }
      return bad ? 1 : 0;
    }
    const t0 = Date.now();
    const r = await runSeeds(a, b, { seedStart: args.seedStart, seeds: args.seeds, steps: args.steps, only: args.only });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.ok) {
      out(`${a.name} ↔ ${b.name}（TZ=${process.env.TZ}${args.only ? '，域 ' + args.only.join('+') : ''}）：${args.seeds} 个种子 × ${args.steps} 步，共 ${r.steps} 步，0 差异（op ${r.ops.size} 个，${secs} 秒）`);
      return 0;
    }
    out(describeFailure(r, a, b));
    const dir = path.join(ROOT, 'scripts/core-diff/out');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `repro-${r.seed}.jsonl`);
    fs.writeFileSync(file, r.shrunk.seq.map(lineOf).join('\n') + '\n');
    out(`复现：TZ=${process.env.TZ} node scripts/core-diff/run.mjs --a ${args.a} --b ${args.b} --replay ${path.relative(process.cwd(), file)}`);
    return 1;
  } finally {
    await a.close();
    await b.close();
  }
}

process.exitCode = await main();
