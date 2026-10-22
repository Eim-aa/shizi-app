// 金标准 · 配比参考实现（docs/engineering/v10/phase1/tools/simulate-mix.mjs 的 RULES.D / planGroup；研究用，只有 JS）。
// test/core/mix.test.mjs 前 3 条把 src/core/mix.js 与它对照；Swift 没有这个参考实现，所以把同一批输入（网格 + 3000 个随机状态，
// 种子与 JS 测试相同）和参考实现的输出导成夹具，MixTests.swift 用 Mix.newTargetOf / Mix.planGroup 比。非 op 夹具（同 number-format）。
// 字串用「连在一起的字」存（每个字一个码点），Swift 侧按 unicodeScalars 拆。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAR_ORDER } from '../../../src/config/char-order.js';
import * as sim from '../../../docs/engineering/v10/phase1/tools/simulate-mix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const joined = (list) => {
  const s = list.join('');
  if ([...s].length !== list.length) throw new Error('mix-sim: a key is not a single code point');
  return s;
};

export default {
  id: 'mix-sim',
  source: 'docs/engineering/v10/phase1/tools/simulate-mix.mjs（RULES.D.newTarget、planGroup）',
  build() {
    const cases = [];
    const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/engineering/v10/phase1/易忘度字表-1.0.json'), 'utf8'));
    cases.push({
      kind: 'meta',
      tableWarmupOrder: table.warmup.order,
      simPlanGroupIsFunction: typeof sim.planGroup === 'function',
      simRuleDNewTargetIsFunction: typeof sim.RULES.D.newTarget === 'function',
    });
    // newTarget 网格
    for (const backlog of [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 17, 20, 40]) {
      for (const G of [1, 1.5, 2, 3, 4, 6]) {
        for (const newAcc of [0, 0.3, 0.59, 0.6, 0.61, 1]) {
          for (const lastHadNew of [true, false]) {
            const expected = sim.RULES.D.newTarget({ backlog, groupsPerDayEma: G, newAcc, lastHadNew }, {});
            cases.push({ kind: 'grid', backlog, G, newAcc, lastHadNew, expected });
          }
        }
      }
    }
    // planGroup 随机状态（与 mix.test.mjs 同一个生成过程）
    const WARM = new Set(CHAR_ORDER.warmup);
    const rnd = mulberry32(20261003);
    const pick = (n) => Math.floor(rnd() * n);
    const warmList = [...CHAR_ORDER.warmup];
    const plainPool = CHAR_ORDER.order.filter((c) => !WARM.has(c));
    for (let trial = 0; trial < 3000; trial += 1) {
      const nDue = pick(15);
      const due = [];
      for (let i = 0; i < nDue; i += 1) due.push(rnd() < 0.2 ? warmList[pick(warmList.length)] : plainPool[pick(plainPool.length)]);
      const dueKeys = [...new Set(due)];
      const earlyKeys = [...new Set(Array.from({ length: pick(9) }, () => plainPool[100 + pick(200)]))].filter((c) => !dueKeys.includes(c));
      const budget = rnd() < 0.15 ? pick(4) : 30;
      const G = 1 + rnd() * 5;
      const state = { backlog: dueKeys.length + pick(3) * pick(6), newAcc: rnd(), allAcc: rnd(), groupsPerDayEma: G, day: 1 + pick(20), lastHadNew: rnd() < 0.5 };
      const warmPeek = rnd() < 0.8 ? warmList[pick(warmList.length)] : null;
      const a = sim.planGroup({ ruleName: 'D', state, opts: {}, budget, due: dueKeys.map((ch) => ({ ch })), early: earlyKeys, warmPeek, day: state.day });
      cases.push({
        kind: 'plan', trial, due: joined(dueKeys), early: joined(earlyKeys), budget, state, warmPeek,
        expected: { newTarget: a.newTarget, revKeys: joined(a.revKeys), earlyKeys: joined(a.earlyKeys), newSlots: a.newSlots, warmNew: a.warmNew, warmRev: a.warmRev },
      });
    }
    return { cases };
  },
};
