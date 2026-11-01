#!/usr/bin/env node
// 真实数据双读（B4.8 预备；计划 §4.4）。
//
//   node scripts/dual-read/run.mjs <备份.json | 手机上拷下来的库文件>     先脱敏，再 JS 读 / Swift 读比整份状态，再回放随机操作
//   node scripts/dual-read/run.mjs --self-test                          合成「一年练习」夹具，备份与 SQLite 两种输入各跑一遍（门禁）
//   选项：--seeds N（缺省 50）--steps N（缺省 200）--seed-start N  --tz <IANA>（缺省 Asia/Shanghai）
//         --now <ISO 时间>（时钟；缺省 = 数据里最晚记录 + 1 小时）--swift-bin <path>  --keep（保留脱敏副本）  --no-replay（只比载入）
// 退出码：0 A == B 且回放 0 差异；1 有差异；2 环境问题（没编 shizi-core-cli、输入读不了）。
// 只打印计数与差异路径，不打印记录内容。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const o = { input: null, selfTest: false, seeds: null, steps: null, seedStart: 1, tz: null, now: null, swiftBin: null, keep: false, replay: true };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--self-test') o.selfTest = true;
    else if (k === '--seeds') o.seeds = Number(argv[++i]);
    else if (k === '--steps') o.steps = Number(argv[++i]);
    else if (k === '--seed-start') o.seedStart = Number(argv[++i]);
    else if (k === '--tz') o.tz = argv[++i];
    else if (k === '--now') o.now = Date.parse(argv[++i]);
    else if (k === '--swift-bin') o.swiftBin = argv[++i];
    else if (k === '--keep') o.keep = true;
    else if (k === '--no-replay') o.replay = false;
    else if (k.startsWith('--')) throw new Error('unknown argument: ' + k);
    else if (!o.input) o.input = k;
    else throw new Error('只接受一个输入文件');
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
process.env.TZ = args.tz || process.env.TZ || 'Asia/Shanghai';
if (args.now !== null && !Number.isFinite(args.now)) throw new Error('--now 不是有效时间');

const { dualRead } = await import('./pipeline.mjs');
const out = (s) => process.stdout.write(s + '\n');

async function selfTest() {
  const { buildFixture } = await import('./fixture.mjs');
  const { writeSqlite, anonymize, sniff } = await import('./anonymize.mjs');
  const { openEngine } = await import('../core-diff/lib/engines.mjs');
  try {
    openEngine('swift', { swiftPath: args.swiftBin }).close();
  } catch (e) {
    out(e.message);
    return 2;
  }
  const fx = await buildFixture();
  out(`夹具：${fx.expect.records} 条记录（含折叠月 ${fx.expect.folded} 个），磁盘 ${Object.keys(fx.disk).length} 个键，备份文本 ${fx.backupText.length} 字节`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-dual-read-fixture-'));
  let bad = 0;
  try {
    const backup = path.join(dir, 'fixture-backup.json');
    const sqlite = path.join(dir, 'fixture.sqlite');
    fs.writeFileSync(backup, fx.backupText);
    writeSqlite(sqlite, fx.disk, fx.endAt);
    // 脱敏自检：图片与报告字串被换掉、同长度；记录与墨迹不变
    for (const f of [backup, sqlite]) {
      const a = anonymize(f);
      try {
        if (sniff(f) !== a.kind) throw new Error('kind');
        if (a.stats.images < 1 || a.stats.strings < 1) throw new Error('nothing anonymized');
        const text = a.kind === 'backup' ? fs.readFileSync(a.file, 'utf8') : null;
        if (text && (text.includes('private note') || text.includes('QUJDREVGRw'))) throw new Error('personal text survived');
        if (text) {
          const before = JSON.parse(fs.readFileSync(f, 'utf8'));
          const after = JSON.parse(text);
          for (const k of Object.keys(before.data)) {
            if (/records|ink|sched/.test(k) && before.data[k] !== after.data[k]) throw new Error('data changed: ' + k);
            if (before.data[k].length !== after.data[k].length) throw new Error('length changed: ' + k);
          }
        }
        out(`脱敏自检 ${a.kind}：通过（图片 ${a.stats.images}、报告字串 ${a.stats.strings}）`);
      } catch (e) {
        bad += 1;
        out(`脱敏自检失败 ${f.endsWith('.json') ? 'backup' : 'sqlite'}：${e.message}`);
      } finally {
        fs.rmSync(a.dir, { recursive: true, force: true });
      }
    }
    for (const [label, file] of [['备份 JSON', backup], ['SQLite 库', sqlite]]) {
      out(`\n== 自测：${label} ==`);
      const r = await dualRead(file, { seeds: args.seeds ?? 6, steps: args.steps ?? 100, seedStart: args.seedStart, swiftBin: args.swiftBin, now: args.now, keep: args.keep, replay: args.replay, log: out });
      if (!r.ok) bad += 1;
      else if (r.counts['records条数'] + r.counts['折叠月保留条数'] !== fx.expect.records) {
        bad += 1;
        out(`记录条数与夹具不符：${r.counts['records条数'] + r.counts['折叠月保留条数']} ≠ ${fx.expect.records}`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  out(bad ? '\n自测失败' : '\n自测通过');
  return bad ? 1 : 0;
}

async function main() {
  if (args.selfTest) return selfTest();
  if (!args.input) {
    out('用法：node scripts/dual-read/run.mjs <备份.json | 库文件> [--seeds 50] [--steps 200]\n      node scripts/dual-read/run.mjs --self-test');
    return 2;
  }
  try {
    const r = await dualRead(args.input, { seeds: args.seeds ?? 50, steps: args.steps ?? 200, seedStart: args.seedStart, swiftBin: args.swiftBin, now: args.now, keep: args.keep, replay: args.replay, log: out });
    if (r.stage === 'env') return 2;
    return r.ok ? 0 : 1;
  } catch (e) {
    out('错误：' + e.message);
    return 2;
  }
}

process.exitCode = await main();
