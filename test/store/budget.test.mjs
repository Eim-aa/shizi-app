// store/budget.js：占用估算与预警阈值、墨迹淘汰层级（01 §9 优先级）、记录折叠。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUDGET_DEFAULTS, bucketOfKey, entryBytes, estimateUsage, indexRecords, inkBytes, inkTier, needsRecovery, recover,
} from '../../src/store/budget.js';
import { KEYS, inkKey, inkRecordKey, recordsKey } from '../../src/core/schema.js';
import * as policy from '../../src/config/policy.js';
import { flatInk, inkEntry, record } from './helpers.mjs';
import * as budgetModule from '../../src/store/budget.js';

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
  assert.equal(BUDGET_DEFAULTS.quotaBytes, 5 * MiB);
  assert.equal(BUDGET_DEFAULTS.recordsBudgetBytes, 1.5 * MiB);
  assert.equal(BUDGET_DEFAULTS.inkBudgetBytes, 1.5 * MiB);
  // P57：预警阈值与假定配额来自 policy.js（不再硬编码在 budget.js），且仍可注入
  assert.equal(BUDGET_DEFAULTS.warnRatio, policy.storageWarnRatio);
  assert.equal(BUDGET_DEFAULTS.quotaBytes, policy.assumedQuotaBytes);
  assert.equal(BUDGET_DEFAULTS.inkBudgetBytes, policy.inkBudgetBytes);
  assert.equal(BUDGET_DEFAULTS.recordsBudgetBytes, policy.recordsBudgetBytes);
  assert.equal(estimateUsage(mk(900), { quotaBytes: quota, warnRatio: 0.95 }).level, 'ok', 'warnRatio is injectable');
  assert.equal(bucketOfKey(inkKey('2026-09')), 'ink', 'ink month keys count in the ink bucket');
  assert.equal(bucketOfKey('shizi.v2.ink'), 'legacy-v1', 'the old single ink key is no longer a v2 key');
  assert.equal(bucketOfKey(KEYS.txn), 'txn');
});

// 「人」：r1(2026-07 首) r2(2026-07 中) r3(2026-07 末) r4(2026-10 中) r5(2026-10 最近) ；「口」：r6(2026-08 唯一)
function tierFixture() {
  const records = {
    '2026-07': [record(1, '人', { day: '2026-07-01' }), record(2, '人', { day: '2026-07-02' }), record(3, '人', { day: '2026-07-03' })],
    '2026-08': [record(6, '口', { day: '2026-08-01' })],
    '2026-10': [record(4, '人', { day: '2026-10-01' }), record(5, '人', { day: '2026-10-02' }), record(7, '人', { day: '2026-10-02', kind: 'skipped' })],
  };
  // 注意 r6 比 r4/r5 大但属于 8月：月份数组内按 id 升序即可
  // 墨迹按记录月份分键；r99 是孤儿（找不到记录），放在 10月键里
  const monthOfId = { r1: '2026-07', r2: '2026-07', r3: '2026-07', r6: '2026-08', r4: '2026-10', r5: '2026-10', r7: '2026-10', r99: '2026-10' };
  const ink = {};
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r99']) (ink[monthOfId[id]] = ink[monthOfId[id]] || {})[id] = inkEntry(20, 4);
  return { records, ink };
}

test('ink tiers follow 01 §9 as amended by D27: orphan < other-month rest < this-month rest < monthly first/last < first + latest per char (never)', () => {
  const { records } = tierFixture();
  const index = indexRecords(records);
  const tiers = {};
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r99']) tiers[id] = inkTier(id, index, '2026-10');
  assert.equal(tiers.r99, 0, 'orphan');
  assert.equal(tiers.r2, 1, 'other month, not first/last');
  assert.equal(tiers.r7, 2, 'this month, non-judged rest');
  assert.equal(tiers.r3, 3, 'monthly last of 人 in July');
  assert.equal(tiers.r4, 3, 'monthly first of 人 in October');
  assert.equal(tiers.r1, Infinity, 'first judged of 人 (D27: never recycled; was tier 4 before P1-E3)');
  assert.equal(tiers.r5, Infinity, 'latest judged of 人');
  assert.equal(tiers.r6, Infinity, 'latest (and only) judged of 口');
});

test('recover (ink over budget): evicts lowest tier first, oldest first within a tier, stops once under budget', () => {
  const draft = tierFixture();
  const one = entryBytes(inkRecordKey('2026-10', 'r1'), JSON.stringify(inkEntry(20, 4)));
  const total = inkBytes(draft.ink);
  // B2.3 ink schema 2：落盘每条一个键，估算 = 每条键之和
  assert.equal(total, Object.keys(draft.ink).reduce((n, m) => n + Object.keys(draft.ink[m]).reduce((k, id) => k + entryBytes(inkRecordKey(m, id), JSON.stringify(draft.ink[m][id])), 0), 0), 'ink bytes = sum over one-record keys');
  const budget = total - one * 2.5; // 需要淘汰 3 份
  const before = draft.ink;
  const { actions } = recover(draft, { now: NOW, budgets: { inkBudgetBytes: budget } });
  const evicted = actions.filter(a => a.type === 'evictInk').map(a => a.id);
  assert.deepEqual(evicted, ['r99', 'r2', 'r7'], 'tier order across month keys');
  assert.deepEqual(actions.filter(a => a.type === 'evictInk').map(a => a.month), ['2026-10', '2026-07', '2026-10']);
  const ink = flatInk(draft.ink);
  assert.ok(ink.r5 && ink.r6 && ink.r1);
  assert.equal(draft.ink['2026-08'], before['2026-08'], 'untouched month table keeps its identity (not rewritten)');
  assert.notEqual(draft.ink, before, 'copy-on-write: ink domain replaced, not mutated');
  assert.equal(draft.records['2026-07'].length, 3, 'records untouched when under records budget');
});

test('recover (force, quota): evicts down to but never including first / latest per char (D27)', () => {
  const draft = tierFixture();
  const { actions } = recover(draft, { now: NOW, force: true, needBytes: 10 * MiB, limit: { inkMonths: ['2026-07', '2026-08', '2026-10'], months: [] } });
  assert.deepEqual(Object.keys(flatInk(draft.ink)).sort(), ['r1', 'r5', 'r6'], 'D27: r1 (first of 人) now survives too');
  assert.deepEqual(Object.keys(draft.ink['2026-07']), ['r1'], 'July keeps only the first judgment of 人');
  const emptied = { records: { '2026-07': [record(1, '人', { day: '2026-07-01' }), record(2, '人', { day: '2026-07-02' })], '2026-10': [record(5, '人', { day: '2026-10-02' })] },
    ink: { '2026-07': { r2: inkEntry(20, 4) }, '2026-10': { r5: inkEntry(20, 4) } } };
  recover(emptied, { now: NOW, force: true, needBytes: 10 * MiB, limit: { inkMonths: ['2026-07', '2026-10'], months: [] } });
  assert.deepEqual(emptied.ink['2026-07'], {}, 'emptied month table (store drops the key)');
  assert.ok(actions.every(a => a.type === 'evictInk'), 'limit keeps records untouched');
  const onlyJuly = tierFixture();
  recover(onlyJuly, { now: NOW, force: true, needBytes: 10 * MiB, limit: { inkMonths: ['2026-07'], months: [] } });
  assert.deepEqual(Object.keys(flatInk(onlyJuly.ink)).sort(), ['r1', 'r4', 'r5', 'r6', 'r7', 'r99'], 'limit.inkMonths restricts eviction to those month keys (July keeps r1, the first judgment, D27)');
});

test('recover (records over budget): folds oldest month first, keeps first + latest per char (D27), drops folded ink; current month never folded', () => {
  const draft = tierFixture();
  const { actions } = recover(draft, { now: NOW, budgets: { recordsBudgetBytes: 10 } });
  const folds = actions.filter(a => a.type === 'fold').map(a => a.month);
  assert.deepEqual(folds, ['2026-07', '2026-08'], 'oldest first, current month (2026-10) skipped');
  const july = draft.records['2026-07'];
  assert.equal(july.folded, true);
  assert.deepEqual(july.byDay, { '2026-07-01': ['人'], '2026-07-02': ['人'], '2026-07-03': ['人'] });
  assert.deepEqual(july.kept.map(r => r.id), ['r1'], '人 has a later record in October; D27 keeps its first-ever judgment r1 (was [] before P1-E3)');
  assert.deepEqual(draft.records['2026-08'].kept.map(r => r.id), ['r6'], '口 only record kept');
  const ink = flatInk(draft.ink);
  assert.ok(!ink.r2 && !ink.r3, 'ink of folded-away records dropped');
  assert.ok(ink.r1, 'D27: ink of the kept first judgment stays');
  assert.ok(ink.r6, 'ink of kept record stays');
  assert.ok(ink.r4 && ink.r5, 'current-month ink untouched by folding');
  assert.ok(Array.isArray(draft.records['2026-10']));
});

test('needsRecovery: aged months (> 400 days) trigger even under budget', () => {
  const records = { '2025-06': [record(1, '人', { day: '2025-06-01' })], '2026-10': [record(2, '口', { day: '2026-10-01' })] };
  const n = needsRecovery({ records, ink: {} }, { now: NOW });
  assert.equal(n.aged, true);
  assert.equal(n.any, true);
  const fresh = needsRecovery({ records: { '2025-09': [record(1, '人', { day: '2025-09-01' })] }, ink: {} }, { now: NOW });
  assert.equal(fresh.aged, false, '2025-09 ends 366 days before 2026-10-02');
  assert.equal(fresh.any, false);
});

// ---------------------------------------------------------------- D27 本人笔迹留存（阶段 1 P1-E3）
// 每字只留「第一次判断」+「最近一次判断」的墨迹（同一条则一份），其余回收；首次与最近永不回收（含撞配额）。

test('D27 retention: pruneInkOfCards keeps first + latest judged ink of each card, recycles the middle ones', () => {
  const { pruneInkOfCards } = budgetModule;
  const draft = tierFixture(); // 人：r1 首 r2 r3 r4 中 r5 最近（r7 跳过）；口：r6 唯一
  const before = draft.ink;
  const dropped = pruneInkOfCards(draft, ['base:人']);
  assert.deepEqual(dropped.map(d => d.id).sort(), ['r2', 'r3', 'r4', 'r7'], 'middle judged + non-judged ink of 人 recycled');
  const ink = flatInk(draft.ink);
  assert.ok(ink.r1, 'first judged ink of 人 kept');
  assert.ok(ink.r5, 'latest judged ink of 人 kept');
  assert.ok(ink.r6, 'other cards untouched');
  assert.ok(ink.r99, 'orphans are left to budget recovery');
  assert.equal(draft.ink['2026-08'], before['2026-08'], 'untouched month table keeps its identity');
  assert.notEqual(draft.ink, before, 'copy-on-write');
  assert.deepEqual(pruneInkOfCards(draft, ['base:人']), [], 'idempotent');
});

test('D27 retention: first === latest (only one judgment) keeps one copy; history without first ink stays without (no borrowing)', () => {
  const { pruneInkOfCards } = budgetModule;
  // 口：只有一条 → 首次即最近，一份
  const one = { records: { '2026-08': [record(6, '口', { day: '2026-08-01' })] }, ink: { '2026-08': { r6: inkEntry(8, 2) } } };
  assert.deepEqual(pruneInkOfCards(one, ['base:口']), []);
  assert.deepEqual(Object.keys(flatInk(one.ink)), ['r6']);
  // 历史：开启前的第一次没有墨迹（r1 无 ink），中间 r2 有，最近 r3 有 → 回收 r2，第一次如实为无，不拿 r2 顶替
  const hist = {
    records: { '2026-07': [record(1, '人', { day: '2026-07-01' }), record(2, '人', { day: '2026-07-02' })], '2026-10': [record(3, '人', { day: '2026-10-01' })] },
    ink: { '2026-07': { r2: inkEntry(8, 2) }, '2026-10': { r3: inkEntry(8, 2) } },
  };
  assert.deepEqual(pruneInkOfCards(hist, ['base:人']).map(d => d.id), ['r2']);
  assert.deepEqual(Object.keys(flatInk(hist.ink)), ['r3'], 'first (r1) stays inkless; nothing is moved onto it');
});

test('D27 retention: answer-seen / skipped are not judgments — they never become first or latest', () => {
  const { pruneInkOfCards } = budgetModule;
  const draft = {
    records: { '2026-10': [
      record(1, '永', { day: '2026-10-01', kind: 'answer-seen' }),
      record(2, '永', { day: '2026-10-01' }),
      record(3, '永', { day: '2026-10-02' }),
      record(4, '永', { day: '2026-10-02', kind: 'skipped' }),
    ] },
    ink: { '2026-10': { r2: inkEntry(8, 2), r3: inkEntry(8, 2) } },
  };
  assert.deepEqual(pruneInkOfCards(draft, ['base:永']), [], 'r2 is the first judgment, r3 the latest: both kept');
  assert.deepEqual(Object.keys(flatInk(draft.ink)).sort(), ['r2', 'r3']);
});

test('D27 retention: under quota pressure, middle ink goes first; first and latest of each card are never recycled', () => {
  const { records } = tierFixture();
  const index = indexRecords(records);
  assert.equal(inkTier('r1', index, '2026-10'), Infinity, 'first judged of 人 is never recycled (D27)');
  assert.equal(inkTier('r5', index, '2026-10'), Infinity, 'latest judged of 人');
  const draft = tierFixture();
  recover(draft, { now: NOW, force: true, needBytes: 10 * MiB, limit: { inkMonths: ['2026-07', '2026-08', '2026-10'], months: [] } });
  assert.deepEqual(Object.keys(flatInk(draft.ink)).sort(), ['r1', 'r5', 'r6'], 'only first + latest of every card survive a forced recovery');
  // 顺序：先回收既非首次也非最近的（孤儿 → 其他月份 → 本月 → 每月首末），最后也不碰首次 / 最近
  const order = tierFixture();
  const one = entryBytes('r1', JSON.stringify(inkEntry(20, 4))) + 8;
  const { actions } = recover(order, { now: NOW, budgets: { inkBudgetBytes: inkBytes(order.ink) - one * 4.5 } });
  assert.deepEqual(actions.filter(a => a.type === 'evictInk').map(a => a.id), ['r99', 'r2', 'r7', 'r3', 'r4']);
  assert.ok(flatInk(order.ink).r1 && flatInk(order.ink).r5);
});

test('D27 retention: folding an old month keeps the first-ever judgment too (with its ink), not only the latest', () => {
  const draft = tierFixture();
  recover(draft, { now: NOW, budgets: { recordsBudgetBytes: 10 } });
  assert.deepEqual(draft.records['2026-07'].kept.map(r => r.id), ['r1'], '人 first-ever judgment kept in the folded July');
  const ink = flatInk(draft.ink);
  assert.ok(ink.r1, 'its ink survives the fold');
  assert.ok(!ink.r2 && !ink.r3, 'middle ink of the folded month dropped');
});

// ---------------------------------------------------------------- Q1 看后自写的墨迹（QA simB D1；01 §3.5 / §9；03 P176）
// 看过答案后「自己写一遍」的本人墨存在那条 answer-seen 记录上。它不是判断，不占 D27 的「第一次 / 最近一次」；
// 所在的组还开着（槽里或 lastEnded：结果页与「这次的图片」可用）时永不回收；之后保留到下次同字有判断（写入那次判断时回收）
// 或超过 policy.afterSeenInkKeepDays 天后在预算回收里先于未过期的被回收；两者都排在判断墨迹的其余层之后。

const DAY = 86400000;

// 「人」：r1 首（7月）r2 中（7月）r3 最近（10-01）；r4 看过答案并自己写（10-02，s4，组已关，新于最近一次判断，1 天前）
// 「口」：r6 写对（8月）；r8 看过答案并自己写（10-02，s8，组还开着：lastEnded.A）
// 「大」：r9 看过答案并自己写（2026-07-01，93 天前，s9，组已关，从没判断过）
// 「中」：r10 看过答案并自己写（10-01，s10，组已关）→ r11 写对（10-02）：看后写的已有更晚的判断
function afterSeenFixture() {
  const records = {
    '2026-07': [record(1, '人', { day: '2026-07-01' }), record(2, '人', { day: '2026-07-02' }),
      record(9, '大', { day: '2026-07-01', kind: 'answer-seen', session: 9, at: NOW - 93 * DAY })],
    '2026-08': [record(6, '口', { day: '2026-08-01' })],
    '2026-10': [record(3, '人', { day: '2026-10-01' }),
      record(4, '人', { day: '2026-10-02', kind: 'answer-seen', session: 4, at: NOW - DAY }),
      record(8, '口', { day: '2026-10-02', kind: 'answer-seen', session: 8, at: NOW - DAY }),
      record(10, '中', { day: '2026-10-01', kind: 'answer-seen', session: 10, at: NOW - DAY }),
      record(11, '中', { day: '2026-10-02', session: 11, at: NOW - DAY / 2 })],
  };
  const monthOf = { r1: '2026-07', r2: '2026-07', r9: '2026-07', r6: '2026-08', r3: '2026-10', r4: '2026-10', r8: '2026-10', r10: '2026-10', r11: '2026-10' };
  const ink = {};
  for (const id of Object.keys(monthOf)) (ink[monthOf[id]] = ink[monthOf[id]] || {})[id] = inkEntry(20, 4);
  const sessions = { A: null, B: null, lastEnded: { A: { id: 's8', items: [] } } };
  return { records, ink, sessions };
}

test('Q1 tiers: after-seen ink is never recycled while its group is open; otherwise it ranks after every judged tier (expired 4, fresh 5)', () => {
  const { records, sessions } = afterSeenFixture();
  const index = indexRecords(records, { sessions, now: NOW, keepDays: 30 });
  assert.equal(inkTier('r8', index, '2026-10'), Infinity, 'open group (lastEnded.A): its result page / 这次的图片 still draw it');
  assert.equal(inkTier('r4', index, '2026-10'), 5, 'newer than the latest judgment of 人, 1 day old → kept as long as possible');
  assert.equal(inkTier('r9', index, '2026-10'), 4, 'older than keepDays (93 > 30) → expired');
  assert.equal(inkTier('r10', index, '2026-10'), 4, 'a later judgment of 中 exists → expired');
  assert.equal(inkTier('r2', index, '2026-10'), 3, 'judged tiers unchanged (r2 = last of 人 in July)');
  assert.equal(inkTier('r1', index, '2026-10'), Infinity, 'D27 first judged unchanged');
  assert.equal(inkTier('r11', index, '2026-10'), Infinity, 'D27 latest judged unchanged (the after-seen r10 is not a judgment)');
  // keepDays 来自 policy（P176）
  assert.equal(typeof policy.afterSeenInkKeepDays, 'number');
  const byPolicy = indexRecords(records, { sessions, now: NOW });
  assert.equal(inkTier('r9', byPolicy, '2026-10'), 93 > policy.afterSeenInkKeepDays ? 4 : 5);
});

test('Q1 recover: judged middle ink goes first, then expired after-seen, then fresh after-seen; open-group after-seen and D27 first / latest never', () => {
  const draft = afterSeenFixture();
  const { actions } = recover(draft, { now: NOW, force: true, needBytes: 10 * MiB, limit: { inkMonths: ['2026-07', '2026-08', '2026-10'], months: [] } });
  const order = actions.filter(a => a.type === 'evictInk').map(a => [a.id, a.tier]);
  assert.deepEqual(order, [['r2', 3], ['r9', 4], ['r10', 4], ['r4', 5]], 'judged rest → expired after-seen (oldest first) → fresh after-seen');
  assert.deepEqual(Object.keys(flatInk(draft.ink)).sort(), ['r1', 'r11', 'r3', 'r6', 'r8'], 'survivors: D27 first / latest + the open group\'s after-seen');
});

test('Q1 pruneInkOfCards: keeps after-seen ink newer than the latest judgment (only the latest one per card); drops it once a judgment follows, unless its group is open', () => {
  const { pruneInkOfCards } = budgetModule;
  const draft = afterSeenFixture();
  const dropped = pruneInkOfCards(draft, ['base:人', 'base:口', 'base:中', 'base:大']).map(d => d.id).sort();
  assert.deepEqual(dropped, ['r10', 'r2'], '人 middle judged r2 and 中 after-seen r10 (judged r11 came after) go');
  const ink = flatInk(draft.ink);
  assert.ok(ink.r4, '人 after-seen newer than its latest judgment stays (保留到下次同字有判断)');
  assert.ok(ink.r8, '口 after-seen of the open group stays');
  assert.ok(ink.r9, '大 never judged: its after-seen stays (age only matters to budget recovery)');
  // 两份看后写的（都在已关的组）：只留新的那份
  const two = {
    records: { '2026-10': [record(20, '永', { day: '2026-10-01', kind: 'answer-seen', session: 20 }), record(21, '永', { day: '2026-10-02', kind: 'answer-seen', session: 21 })] },
    ink: { '2026-10': { r20: inkEntry(8, 2), r21: inkEntry(8, 2) } },
    sessions: { A: null, B: null, lastEnded: {} },
  };
  assert.deepEqual(pruneInkOfCards(two, ['base:永']).map(d => d.id), ['r20']);
  // 旧那份的组还开着：两份都留
  const open = { ...two, ink: { '2026-10': { r20: inkEntry(8, 2), r21: inkEntry(8, 2) } }, sessions: { A: null, B: null, lastEnded: { B: { id: 's20', items: [] } } } };
  assert.deepEqual(pruneInkOfCards(open, ['base:永']), []);
});

test('Q1 fold: an old month keeps after-seen records of an open group (with ink); other after-seen records fold away with their ink', () => {
  const draft = afterSeenFixture();
  draft.sessions = { A: null, B: null, lastEnded: { A: { id: 's9', items: [] } } };
  recover(draft, { now: NOW, budgets: { recordsBudgetBytes: 10 } });
  assert.deepEqual(draft.records['2026-07'].kept.map(r => r.id), ['r1', 'r9'], '大 r9 is in the open group → kept with its ink');
  assert.ok(flatInk(draft.ink).r9);
  const closed = afterSeenFixture();
  recover(closed, { now: NOW, budgets: { recordsBudgetBytes: 10 } });
  assert.deepEqual(closed.records['2026-07'].kept.map(r => r.id), ['r1']);
  assert.ok(!flatInk(closed.ink).r9, 'folded-away after-seen ink dropped');
});

test('D66 ⑭ (P326): the ink budget follows 每组字数; storagePressureOf only speaks near the limit', () => {
  const MiB = 1024 * 1024;
  assert.equal(budgetModule.inkBudgetOf(null), 2 * MiB, 'never chosen → 20 → 2MiB');
  assert.equal(budgetModule.inkBudgetOf({ groupSize: 5 }), 1.5 * MiB);
  assert.equal(budgetModule.inkBudgetOf({ groupSize: 30 }), 2.5 * MiB);
  // 预算按 settings：每组 20 字 1.8MiB 不回收，每组 5 字就回收
  const big = { ink: { '2026-09': { r1: 'x'.repeat(0.9 * MiB) } }, records: {} };
  const now = Date.parse('2026-09-24T12:00:00');
  assert.equal(budgetModule.needsRecovery({ ...big, settings: { groupSize: 20 } }, { now }).ink, false);
  assert.equal(budgetModule.needsRecovery({ ...big, settings: { groupSize: 5 } }, { now }).ink, true);
  assert.equal(budgetModule.storagePressureOf(null), null);
  assert.equal(budgetModule.storagePressureOf({ level: 'ok', ratio: 0.5 }), null);
  assert.deepEqual(budgetModule.storagePressureOf({ level: 'warn', ratio: 0.8123 }), { level: 'warn', ratio: 0.812 });
  assert.deepEqual(budgetModule.storagePressureOf({ level: 'full', ratio: 1.01 }), { level: 'full', ratio: 1.01 });
  assert.equal(policy.storageWarnRatio, 0.8);
});
