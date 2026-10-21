// R11-A（D72 ②）：原生书写面与网页同一算法——Swift WebInkTests 逐点对比的金标准（网页 buildStroke 的输出）必须与代码 / policy 同步。
// 改了 src/core/ink-math.js buildStroke 或 policy.ink：node ios/ShiziApp/scripts/web-ink-golden.mjs 重新生成。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldenPath, goldenText } from '../../ios/ShiziApp/scripts/web-ink-golden.mjs';

test('web-ink golden (Swift WebInk reference) matches buildStroke and policy.ink', () => {
  const committed = readFileSync(goldenPath, 'utf8');
  assert.equal(committed, goldenText(), 'stale: run node ios/ShiziApp/scripts/web-ink-golden.mjs');
  const doc = JSON.parse(committed);
  assert.ok(doc.cases.length >= 30);
  const ids = doc.cases.map(c => c.id);
  for (const want of ['finger-fast-60hz', 'pencil-pressure-240hz', 'short-dot-stroke', 'single-point', 'qa-harness-horizontal (live)']) assert.ok(ids.includes(want), want);
  assert.ok(doc.cases.some(c => c.dot && !c.single), 'covers a dot stroke');
  assert.ok(doc.cases.some(c => c.single), 'covers a single point');
  assert.ok(doc.cases.some(c => c.pressure), 'covers pencil pressure');
});
