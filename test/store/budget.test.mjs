// store/budget.js：占用估算与预警阈值、墨迹淘汰层级（01 §9 优先级）、记录折叠。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUDGET_DEFAULTS, bucketOfKey, entryBytes, estimateUsage, indexRecords, inkTier, needsRecovery, recover,
} from '../../src/store/budget.js';
import { KEYS, recordsKey } from '../../src/core/schema.js';
import { inkEntry, record } from './helpers.mjs';

const MiB = 1024 * 1024;
const NOW = new Date(2026, 9, 2, 10).getTime(); // 本地 2026-10-02

test('entryBytes is UTF-16: (key + value) × 2', () => {
  assert.equal(entryBytes('ab', 'cde'), 10);
  assert.equal(entryBytes('k', null), 0);
  assert.equal(entryBytes('k', '字'), 4);
});

test('estimateUsage buckets and warn threshold (> 80% of assumed quota)', () => {
  const quota = 1000;
  const budgets = { quotaBytes: quota };
  const mk = total => [['x', 'y'.repeat(total / 2 - 1)]];
  assert.equal(estimateUsage(mk(800), budgets).level, 'ok', 'exactly 80% is not yet a warning');
  assert.equal(estimateUsage(mk(802), budgets).level, 'warn');
  assert.equal(estimateUsage(mk(1000), budgets).level, 'full');
  const usage = estimateUsage([[KEYS.meta, '{}'], [recordsKey('2026-09'), '[]'], ['shizi.corrupt.shizi.v2.sched', 'x'], ['shizi.memory.v1', '{}'], ['other', '1']]);
  assert.deepEqual(Object.keys(usage.byBucket).sort(), ['corrupt', 'foreign', 'legacy-v1', 'meta', 'records']);
  assert.equal(usage.total, [[KEYS.meta, '{}'], [recordsKey('2026-09'), '[]'], ['shizi.corrupt.shizi.v2.sched', 'x'], ['shizi.memory.v1', '{}'], ['other', '1']].reduce((n, [k, v]) => n + entryBytes(k, v), 0));
  assert.equal(BUDGET_DEFAULTS.warnRatio, 0.8);
  assert.equal(BUDGET_DEFAULTS.recordsBudgetBytes, 1.5 * MiB);
  assert.equal(BUDGET_DEFAULTS.inkBudgetBytes, 1.5 * MiB);
  assert.equal(bucketOfKey(KEYS.txn), 'txn');
});

// 「人」：r1(2026-07 首) r2(2026-07 中) r3(2026-07 末) r4(2026-10 中) r5(2026-10 最近) ；「口」：r6(2026-08 唯一)
function tierFixture() {
  const records = {
    '2026-07': [record(1, '人', { day: '2026-07-01' }), record(2, '人', { day: '2026-07-02' }), record(3, '人', { day: '2026-07-03' })],
    '2026-08': [record(6, '口', { day: '2026-08-01' })],
    '2026-10': [record(4, '人', { day: '2026-10-01' }), record(5, '人', { day: '2026-10-02' }), record(7, '人', { day: '2026-10-02', kind: 'skipped' })],
  };
  // 注意 r6 比 r4/r5 大但属于 8 月：月份数组内按 id 升序即可
  const ink = {};
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r99']) ink[id] = inkEntry(20, 4);
  return { records, ink };
}

test('ink tiers follow 01 §9: orphan < other-month rest < this-month rest < monthly first/last < first per char < latest (never)', () => {
  const { records } = tierFixture();
  const index = indexRecords(records);
  const tiers = {};
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r99']) tiers[id] = inkTier(id, index, '2026-10');
  assert.equal(tiers.r99, 0, 'orphan');
  assert.equal(tiers.r2, 1, 'other month, not first/last');
  assert.equal(tiers.r7, 2, 'this month, non-judged rest');
  assert.equal(tiers.r3, 3, 'monthly last of 人 in July');
  assert.equal(tiers.r4, 3, 'monthly first of 人 in October');
  assert.equal(tiers.r1, 4, 'first judged of 人');
  assert.equal(tiers.r5, Infinity, 'latest judged of 人');
  assert.equal(tiers.r6, Infinity, 'latest (and only) judged of 口');
});

test('recover (ink over budget): evicts lowest tier first, oldest first within a tier, stops once under budget', () => {
  const draft = tierFixture();
  const one = entryBytes('r1', JSON.stringify(inkEntry(20, 4))) + 8;
  const total = entryBytes(KEYS.ink, JSON.stringify(draft.ink));
  const budget = total - one * 2.5; // 需要淘汰 3 份
  const { actions } = recover(draft, { now: NOW, budgets: { inkBudgetBytes: budget } });
  const evicted = actions.filter(a => a.type === 'evictInk').map(a => a.id);
  assert.deepEqual(evicted, ['r99', 'r2', 'r7']);
  assert.ok(draft.ink.r5 && draft.ink.r6 && draft.ink.r1);
  assert.equal(draft.records['2026-07'].length, 3, 'records untouched when under records budget');
});

test('recover (force, quota): evicts down to but never including latest-per-char', () => {
  const draft = tierFixture();
  const { actions } = recover(draft, { now: NOW, force: true, needBytes: 10 * MiB, limit: { ink: true, months: [] } });
  assert.deepEqual(Object.keys(draft.ink).sort(), ['r5', 'r6']);
  assert.ok(actions.every(a => a.type === 'evictInk'), 'limit keeps records untouched');
});

test('recover (records over budget): folds oldest month first, keeps latest-per-char, drops folded ink; current month never folded', () => {
  const draft = tierFixture();
  const { actions } = recover(draft, { now: NOW, budgets: { recordsBudgetBytes: 10 } });
  const folds = actions.filter(a => a.type === 'fold').map(a => a.month);
  assert.deepEqual(folds, ['2026-07', '2026-08'], 'oldest first, current month (2026-10) skipped');
  const july = draft.records['2026-07'];
  assert.equal(july.folded, true);
  assert.deepEqual(july.byDay, { '2026-07-01': ['人'], '2026-07-02': ['人'], '2026-07-03': ['人'] });
  assert.deepEqual(july.kept, [], '人 has a later record in October');
  assert.deepEqual(draft.records['2026-08'].kept.map(r => r.id), ['r6'], '口 only record kept');
  assert.ok(!draft.ink.r1 && !draft.ink.r2 && !draft.ink.r3, 'ink of folded-away records dropped');
  assert.ok(draft.ink.r6, 'ink of kept record stays');
  assert.ok(Array.isArray(draft.records['2026-10']));
});

test('needsRecovery: aged months (> 400 days) trigger even under budget', () => {
  const records = { '2025-06': [record(1, '人', { day: '2025-06-01' })], '2026-10': [record(2, '口', { day: '2026-10-01' })] };
  const n = needsRecovery({ records, ink: null }, { now: NOW });
  assert.equal(n.aged, true);
  assert.equal(n.any, true);
  const fresh = needsRecovery({ records: { '2025-09': [record(1, '人', { day: '2025-09-01' })] }, ink: null }, { now: NOW });
  assert.equal(fresh.aged, false, '2025-09 ends 366 days before 2026-10-02');
  assert.equal(fresh.any, false);
});
