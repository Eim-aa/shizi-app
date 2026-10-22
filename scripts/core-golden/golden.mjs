#!/usr/bin/env node
// ShiziCore 金标准生成器（B4.0；计划 §4.3 ①）：用 JS 参考实现对固定输入算出期望值，写成 JSON 夹具，Swift 的 ShiziCoreTests 逐条读入比对。
//
//   node scripts/core-golden/golden.mjs            重新生成全部域
//   node scripts/core-golden/golden.mjs --check    只核对（夹具与当前代码不同步时列出并退出 1；test/core/core-golden.test.mjs 守住）
//   node scripts/core-golden/golden.mjs --only dates
//
// 一个域 = scripts/core-golden/domains/<id>.mjs，导出 { id, source, build() → 夹具对象 }。夹具写到
// ios/ShiziCore/Tests/ShiziCoreTests/Fixtures/<id>.json。按 op 组织的域（dates 等）可用下面的 opCases() 走 js-engine，
// 期望值就是参考引擎的回包（ok + reply，或 ok:false + 错误码），Swift 侧用 CoreEngine 跑同一个 op 比（GoldenTests.swift）。
// 需要多个时区的域在 build() 里用 withTZ() 逐个切换 process.env.TZ（Node 运行时改 TZ 立即生效）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsEngine } from '../core-diff/lib/js-engine.mjs';
import datesDomain from './domains/dates.mjs';
import numberFormatDomain from './domains/number-format.mjs';
import schemaDomain from './domains/schema.mjs';
import signatureDomain from './domains/signature.mjs';
import copyDomain from './domains/copy.mjs';
import fsrsDomain from './domains/fsrs.mjs';
import scheduleDomain from './domains/schedule.mjs';
import mixSimDomain from './domains/mix-sim.mjs';
import recordsDomain from './domains/records.mjs';
import queryDomain from './domains/query.mjs';
import cardsDomain from './domains/cards.mjs';
import membersDomain from './domains/members.mjs';
import inkDomain from './domains/ink.mjs';
import contractDomain from './domains/contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FIXTURE_DIR = path.join(ROOT, 'ios/ShiziCore/Tests/ShiziCoreTests/Fixtures');
export const DOMAINS = [datesDomain, numberFormatDomain, schemaDomain, signatureDomain, copyDomain, recordsDomain, queryDomain, cardsDomain, membersDomain, inkDomain, contractDomain, fsrsDomain, scheduleDomain, mixSimDomain];

export function withTZ(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

/** 把 [{op, args}] 交参考引擎（每组一个新引擎），得到带期望值的用例。 */
export function opCases(requests) {
  const engine = createJsEngine();
  return requests.map(({ op, args }) => {
    const r = engine.handle(JSON.parse(JSON.stringify({ op, args, state: false })));
    const c = { op, args };
    if (r.ok) {
      c.ok = true;
      c.reply = JSON.parse(JSON.stringify(r.reply === undefined ? null : r.reply));
    } else {
      c.ok = false;
      c.code = r.error.code;
    }
    return c;
  });
}

export const goldenPath = (id) => path.join(FIXTURE_DIR, id + '.json');

export function goldenText(domain) {
  const doc = { domain: domain.id, source: domain.source, generator: `scripts/core-golden/domains/${domain.id}.mjs`, ...domain.build({ withTZ, opCases }) };
  // 一个用例一行，便于审阅 diff。
  const head = JSON.stringify({ ...doc, groups: undefined, cases: undefined });
  const body = (cases) => '[\n' + cases.map((c) => '  ' + JSON.stringify(c)).join(',\n') + '\n]';
  let text = head.slice(0, -1);
  if (doc.groups) text += ',"groups":[\n' + doc.groups.map((g) => `{"tz":${JSON.stringify(g.tz)},"cases":${body(g.cases)}}`).join(',\n') + '\n]';
  if (doc.cases) text += ',"cases":' + body(doc.cases);
  return text + '}\n';
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const oi = argv.indexOf('--only');
  const only = oi >= 0 ? argv[oi + 1].split(',') : null;
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  let stale = 0;
  for (const d of DOMAINS) {
    if (only && !only.includes(d.id)) continue;
    const text = goldenText(d);
    const file = goldenPath(d.id);
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const n = (JSON.parse(text).groups || [{ cases: JSON.parse(text).cases }]).reduce((s, g) => s + g.cases.length, 0);
    if (check) {
      if (cur !== text) {
        stale += 1;
        process.stdout.write(`过期：${path.relative(ROOT, file)}（node scripts/core-golden/golden.mjs --only ${d.id}）\n`);
      } else process.stdout.write(`同步：${d.id}（${n} 条）\n`);
    } else {
      fs.writeFileSync(file, text);
      process.stdout.write(`${cur === text ? '未变' : '已写'}：${path.relative(ROOT, file)}（${n} 条）\n`);
    }
  }
  if (stale) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
