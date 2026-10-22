// B4.0 ShiziCore 等价性底座的 node 侧门禁（不需要 Swift；Swift 一侧由 pnpm run verify:core-diff 跑）：
//   1. 金标准夹具（ios/ShiziCore/Tests/ShiziCoreTests/Fixtures/*.json）与 JS 代码同步——改了 src/core/dates.js 等就要重生成；
//   2. 差分驱动自检：JS ↔ JS（经子进程）0 差异；埋的错必抓且缩到最短；
//   3. 两边 op 表同名：Swift CoreEngine 的 op 名都在 JS 参考引擎里（静态核对源码，防止只改一边）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { DOMAINS, goldenPath, goldenText } from '../../scripts/core-golden/golden.mjs';
import { selfTest } from '../../scripts/core-diff/lib/selftest.mjs';
import { createJsEngine } from '../../scripts/core-diff/lib/js-engine.mjs';

test('core golden fixtures are in sync with the JS reference (node scripts/core-golden/golden.mjs)', () => {
  for (const d of DOMAINS) assert.equal(fs.readFileSync(goldenPath(d.id), 'utf8'), goldenText(d), `stale ${d.id}: run node scripts/core-golden/golden.mjs --only ${d.id}`);
  const dates = JSON.parse(fs.readFileSync(goldenPath('dates'), 'utf8'));
  assert.ok(dates.groups.length >= 5, 'several time zones');
  assert.ok(dates.groups.every((g) => g.cases.some((c) => c.ok === false)), 'each zone pins error codes too');
});

test('core-diff self-test: js ↔ js-cli agree; planted faults are caught and shrunk', { timeout: 120000 }, async () => {
  const prev = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  try {
    const r = await selfTest({ seeds: 10, steps: 200 });
    assert.ok(r.ok, r.lines.join('\n'));
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
});

test('Swift CoreEngine op table = JS reference op table', () => {
  // B4.1 起 op 分在多个文件：CoreEngine（空规则 + dates）、ConfigOps（配置 / 题库 / 题记 / 文案 / 落款汉字数字）、SchemaOps（形状表 / 模型往返）、
  // SchedOps（B4.2：FSRS 与出题调度）……——Engine 目录下的全部 .swift 一起核对（各卡加自己的文件，不用改这里）。
  const dir = path.join(ROOT, 'ios/ShiziCore/Sources/ShiziCore/Engine');
  const swiftOps = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.swift')).sort()) {
    swiftOps.push(...[...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^\s{8}"([a-zA-Z0-9.]+)": \{/gm)].map((m) => m[1]));
  }
  assert.deepEqual(swiftOps.sort(), createJsEngine().ops());
});
