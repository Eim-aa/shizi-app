// 每组复习与新字的配比（阶段 1 P1-E4：D41 规则 D、D28 热身字门控）：src/core/mix.js + sessions.selectDaily。
// 对照：docs/engineering/v10/phase1/tools/simulate-mix.mjs 的 RULES.D / planGroup（研究用参考实现），同一组输入必须得到同样的新 / 复 / 提前复习数量与人选。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFSRSGlobal, at, rec, ROOT, policyWith } from './helpers.mjs';
import * as policy from '../../src/config/policy.js';
import { CHAR_ORDER } from '../../src/config/char-order.js';
import {
  arrangeGroup, dueReviewsDoneOn, newTargetOf, planGroup, practiceStats, pressureOf, warmupAllowed,
} from '../../src/core/mix.js';
import { applyJudgment } from '../../src/core/fsrs.js';
import { selectDaily } from '../../src/core/sessions.js';
import { addDays } from '../../src/core/dates.js';
import * as sim from '../../docs/engineering/v10/phase1/tools/simulate-mix.mjs';

loadFSRSGlobal();
const TODAY = '2026-09-24';
const K = (s) => [...s].map((c) => 'base:' + c);
const mix = policy.groupMix;
const WARM = new Set(CHAR_ORDER.warmup);
const isWarmChar = (c) => WARM.has(c);
const isWarmKey = (k) => WARM.has(k.slice(5));
const sched = (due, stability = 5) => ({ fsrs: { stability }, due, lastJudgedAt: 0 });

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 与 simulate-mix.mjs 对照

test('mix vs simulate-mix: the sim and the app use the same warm-up list, group size and cap', () => {
  const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/engineering/v10/phase1/易忘度字表-1.0.json'), 'utf8'));
  assert.deepEqual([...CHAR_ORDER.warmup], table.warmup.order);
  assert.equal(typeof sim.planGroup, 'function');
  assert.equal(typeof sim.RULES.D.newTarget, 'function');
});

test('mix vs simulate-mix: newTarget of rule D agrees on a grid across every threshold (0.5 / 1.5 / 4, accuracy 0.6, lastHadNew)', () => {
  for (const backlog of [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 17, 20, 40]) {
    for (const G of [1, 1.5, 2, 3, 4, 6]) {
      for (const newAcc of [0, 0.3, 0.59, 0.6, 0.61, 1]) {
        for (const lastHadNew of [true, false]) {
          const a = sim.RULES.D.newTarget({ backlog, groupsPerDayEma: G, newAcc, lastHadNew }, {});
          const b = newTargetOf({ backlog, groupsPerDay: G, newAccuracy: newAcc, lastHadNew }, mix);
          assert.equal(b, a, `backlog ${backlog} G ${G} acc ${newAcc} lastHadNew ${lastHadNew}`);
        }
      }
    }
  }
});

test('mix vs simulate-mix: planGroup (3000 random states) gives the same new / review / early counts and the same characters', () => {
  const rnd = mulberry32(20261003);
  const pick = (n) => Math.floor(rnd() * n);
  const warmList = [...CHAR_ORDER.warmup];
  const plainPool = CHAR_ORDER.order.filter((c) => !WARM.has(c));
  const size = policy.groupSize;
  let withWarmNew = 0, withEarly = 0, allReview = 0, threeNew = 0, shortGroups = 0;
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
    const b = planGroup({
      size,
      budget,
      due: dueKeys.map((key) => ({ key })),
      early: earlyKeys,
      isWarm: isWarmChar,
      warmNext: warmPeek,
      warmOk: warmupAllowed({ dayIndex: state.day, allAccuracy: state.allAcc }, policy.warmup),
      state: { backlog: state.backlog, groupsPerDay: G, newAccuracy: state.newAcc, lastHadNew: state.lastHadNew },
      mix,
    });
    const where = JSON.stringify({ trial, state, budget, nDue: dueKeys.length, early: earlyKeys.length, warmPeek });
    assert.equal(b.newTarget, a.newTarget, 'newTarget ' + where);
    assert.deepEqual(b.revKeys, a.revKeys, 'revKeys ' + where);
    assert.deepEqual(b.earlyKeys, a.earlyKeys, 'earlyKeys ' + where);
    assert.equal(b.newSlots, a.newSlots, 'newSlots ' + where);
    assert.equal(b.warmNew, a.warmNew, 'warmNew ' + where);
    assert.equal(b.warmRev, a.warmRev, 'warmRev ' + where);
    assert.equal(b.revKeys.length + b.earlyKeys.length + b.newSlots, size, 'group is full when new chars are unlimited');
    if (b.warmNew) withWarmNew += 1;
    if (b.earlyKeys.length) withEarly += 1;
    if (b.newSlots - (b.warmNew ? 1 : 0) === 0 && b.revKeys.length + b.earlyKeys.length === size) allReview += 1;
    if (b.newSlots === 3) threeNew += 1;
    if (b.revKeys.length < Math.min(size - b.newTarget, budget)) shortGroups += 1;
  }
  // 抽样确实覆盖了各个分支（不是空转）
  assert.ok(withWarmNew > 100 && withEarly > 100 && allReview >= 3 && threeNew > 100 && shortGroups > 100, JSON.stringify({ withWarmNew, withEarly, allReview, threeNew, shortGroups }));
});

// ---------------------------------------------------------------- 规则 D 各分支（经 selectDaily 的真实输入）

// 造字：从 CJK 区间取不含热身字 / 保留字的字，按 from 偏移取 n 个（互不重叠的偏移 = 互不相同的字）。
const RESERVED = new Set([...CHAR_ORDER.reserved.surnames, ...CHAR_ORDER.reserved.places, ...CHAR_ORDER.reserved.capitalNumerals, ...CHAR_ORDER.reserved.heavy]);
const plainChars = (n, from) => chars(n, from);
function chars(n, from) {
  const out = [];
  for (let cp = 0x4e00 + from; out.length < n; cp += 1) {
    const c = String.fromCodePoint(cp);
    if (!WARM.has(c) && !RESERVED.has(c)) out.push(c);
  }
  return out;
}

/**
 * 一个场景（全部来自 records / sched）：
 *   due 个到期字；G = 前 7 天每天几组；accuracy = 'high' | 'low' | null（最近 10 个新字首判断全对 / 全错 / 没有）；
 *   lastHadNew = 最近一组（昨天最后那组）有没有新字；away = 最近一次练习是 10 天前（整段历史后移）；early = 可提前复习的字数。
 */
function scenario({ due = 0, G = 1, accuracy = 'high', lastHadNew = true, away = false, early = 0, newCands = null } = {}) {
  const shift = away ? 9 : 0;
  const records = [];
  const schedTable = {};
  let id = 100;
  // 到期字：很久以前写过一次（第一次判断，属于 s0）
  chars(due, 0).forEach((c, i) => {
    records.push(rec(id++, c, 'judged', 'correct', addDays(TODAY, -40), { sessionId: 's0' }));
    schedTable['base:' + c] = sched(addDays(TODAY, -1 - (i % 3)), 3 + i);
  });
  // 复习用字：前 7 天（昨天起）每天 G 组，每组复习一个很久以前写过的字
  const revPool = chars(60, 200);
  for (const c of revPool) records.push(rec(id++, c, 'judged', 'correct', addDays(TODAY, -45), { sessionId: 's00' }));
  let k = 0;
  const lastGroupId = 's-last';
  for (let d = 1; d <= 7; d += 1) {
    for (let g = 0; g < G; g += 1) {
      const sid = d === 1 && g === G - 1 ? lastGroupId : `s-${d}-${g}`;
      if (d === 1 && g === G - 1) continue; // 最近一组放到最后（id 最大）
      records.push(rec(id++, revPool[k++ % revPool.length], 'judged', 'correct', addDays(TODAY, -d - shift), { sessionId: sid }));
    }
  }
  // 最近 10 个新字的首判断：放在前天的一组里（与上面的组共用会话号，不改变每天组数）
  if (accuracy) {
    chars(10, 400).forEach((c, i) => records.push(rec(id++, c, 'judged', accuracy === 'high' ? 'correct' : 'wrong', addDays(TODAY, -2 - shift), { sessionId: 's-2-0' })));
  }
  // 最近一组：id 最大。有新字 = 一个字的第一次判断；没有 = 一个老字的复习
  records.push(lastHadNew
    ? rec(9000, chars(1, 450)[0], 'judged', 'correct', addDays(TODAY, -1 - shift), { sessionId: lastGroupId })
    : rec(9000, revPool[59], 'judged', 'correct', addDays(TODAY, -1 - shift), { sessionId: lastGroupId }));
  chars(early, 600).forEach((c, i) => { schedTable['base:' + c] = sched(addDays(TODAY, 2 + i), 5); });
  return { sched: schedTable, records, candidates: newCands || K(chars(30, 800).join('')) };
}

// 这些场景历史很长（累计组数 ≥ 10）：关掉 D40 特别组（另有 special.test.mjs），只看日常配比。
const NO_CAPITAL = { ...policy, capitalNumerals: { ...policy.capitalNumerals, enabled: false } };

function run(w, extra = {}) {
  return selectDaily({ sched: w.sched, records: w.records, today: TODAY, newCandidates: w.candidates, isWarm: isWarmKey, policy: NO_CAPITAL, ...extra });
}

const counts = (r) => [r.newTarget, r.dueKeys.length, r.newKeys.length, r.earlyKeys.length];

test('rule D: p < 0.5 and recent new-char accuracy ≥ 0.6 → up to 3 new (reviews capped at 2); accuracy < 0.6 → only 2 new (reviews capped at 3)', () => {
  // 每天 4 组（G = 4）、7 个到期：p = 7 / 16 = 0.4375
  const high = run(scenario({ due: 7, G: 4, accuracy: 'high' }));
  assert.ok(high.pressure < 0.5 && high.pressure > 0.4, String(high.pressure));
  assert.deepEqual(counts(high), [3, 2, 3, 0], 'newTarget 3 → 2 reviews + 3 new');
  const low = run(scenario({ due: 7, G: 4, accuracy: 'low' }));
  assert.deepEqual(counts(low), [2, 3, 2, 0], 'accuracy < 0.6 → newTarget 2 → 3 reviews + 2 new');
  // 一个新字历史都没有：先验 0.5 < 0.6 → 也是 2 新档（不会因为「没数据」就给第 3 个新字）
  const none = practiceStats([], TODAY, { policy, isWarm: isWarmKey });
  assert.equal(none.newAccuracy, 0.5);
  assert.equal(newTargetOf({ backlog: 7, groupsPerDay: 4, newAccuracy: none.newAccuracy, lastHadNew: true }, mix), 2);
});

test('rule D: 0.5 ≤ p < 1.5 → 2 new; 1.5 ≤ p < 4 → 1 new', () => {
  // G = 1 → p = due / 4
  assert.deepEqual(counts(run(scenario({ due: 4 }))), [2, 3, 2, 0], 'p 1.0');
  assert.deepEqual(counts(run(scenario({ due: 5 }))), [2, 3, 2, 0], 'p 1.25');
  assert.deepEqual(counts(run(scenario({ due: 6 }))), [1, 4, 1, 0], 'p 1.5 → 1 new tier');
  assert.deepEqual(counts(run(scenario({ due: 15 }))), [1, 4, 1, 0], 'p 3.75');
});

test('rule D valve (p ≥ 4): the last group had new chars → this group is all reviews; otherwise 1 new + 4 reviews', () => {
  const full = run(scenario({ due: 16, lastHadNew: true }));
  assert.equal(full.pressure, 4);
  assert.deepEqual(counts(full), [0, 5, 0, 0], 'a whole group of reviews');
  const one = run(scenario({ due: 16, lastHadNew: false }));
  assert.deepEqual(counts(one), [1, 4, 1, 0]);
  const huge = run(scenario({ due: 40, lastHadNew: false }));
  assert.deepEqual(counts(huge), [1, 4, 1, 0], 'a bigger backlog never pushes new chars below one when the last group was all review');
});

test('rule D never makes two full-review groups in a row: a 30-due backlog alternates until it shrinks', () => {
  const w = scenario({ due: 30, lastHadNew: true });
  const records = [...w.records];
  const sch = { ...w.sched };
  const newsPerGroup = [];
  let serial = 20000;
  for (let g = 0; g < 8; g += 1) {
    const r = selectDaily({ sched: sch, records, today: TODAY, newCandidates: w.candidates, isWarm: isWarmKey, policy: NO_CAPITAL });
    assert.ok(r.queue.length > 0);
    newsPerGroup.push(r.newKeys.length);
    // 写完这一组：新 session，今天判断；复习字推到下个月，新字进调度（id 递增 → 它就是「最近一组」）
    for (const key of r.queue) {
      records.push(rec(serial++, key.slice(5), 'judged', 'correct', TODAY, { sessionId: 's-today-' + g }));
      sch[key] = sched(addDays(TODAY, 30));
    }
  }
  for (let i = 1; i < newsPerGroup.length; i += 1) {
    assert.ok(newsPerGroup[i] > 0 || newsPerGroup[i - 1] > 0, `groups ${i - 1} and ${i} are both all-review: ${newsPerGroup}`);
  }
  assert.equal(newsPerGroup[0], 0, 'p 7.5 and the last group had new chars → all review');
  assert.ok(newsPerGroup[1] >= 1, 'then at least one new char: ' + newsPerGroup);
  assert.ok(newsPerGroup.includes(0), 'the valve did close at least once: ' + newsPerGroup);
});

test('rule D: coming back after ≥ 7 days the first group still has 1 new char even though the last group had new chars', () => {
  const stayed = run(scenario({ due: 16, lastHadNew: true }));
  assert.deepEqual(counts(stayed), [0, 5, 0, 0], 'practiced yesterday → valve closes new chars');
  const away = scenario({ due: 16, lastHadNew: true, away: true });
  const st = practiceStats(away.records, TODAY, { policy, isWarm: isWarmKey });
  assert.equal(st.firstBack, true);
  assert.equal(st.lastDay, addDays(TODAY, -10));
  // Q2-15（D48 ⑧，P184）：离开 ≥ 7 天回来的第一组缩短为 3 字——配比规则不变（仍 1 新字），只是组小了：1 新 + 2 复习。旧断言 [1, 4, 1, 0]（5 字）改成 [1, 2, 1, 0]。
  const backGroup = run(away);
  assert.deepEqual(counts(backGroup), [1, 2, 1, 0], 'away 10 days → 1 new as usual, in a group of 3');
  assert.equal(backGroup.queue.length, 3, 'the first group back is 3 chars (D48 ⑧)');
  // 回来的第二组（今天已经有判断）不再享受「照常 1 新」
  const second = { ...away, records: [...away.records, rec(9500, chars(1, 460)[0], 'judged', 'correct', TODAY, { sessionId: 's-back-1' })] };
  assert.equal(practiceStats(second.records, TODAY, { policy, isWarm: isWarmKey }).firstBack, false);
  // 6 天不算离开
  const sixDays = scenario({ due: 16, lastHadNew: true });
  const shifted = sixDays.records.map((r) => (r.localDay === TODAY ? r : { ...r, localDay: addDays(r.localDay, -5), at: r.at - 5 * 86400000 }));
  assert.equal(practiceStats(shifted, TODAY, { policy, isWarm: isWarmKey }).firstBack, false, '6 days away is not "away"');
});

test('D48 ⑧ (P184): the first group after ≥ 7 days away is 3 chars; the next group the same day, 6 days away and the special group are not shortened', () => {
  assert.equal(mix.returnGroupSize, 3);
  const away = scenario({ due: 16, lastHadNew: true, away: true });
  assert.equal(run(away).queue.length, 3, 'away 10 days → 3 chars');
  // 「第一组」= 今天还没有判断：写完一个字（今天已有判断）之后，下一组回到 5 字
  const second = { ...away, records: [...away.records, rec(9500, chars(1, 460)[0], 'judged', 'correct', TODAY, { sessionId: 's-back-1' })] };
  assert.equal(run(second).queue.length, 5, 'a judgment today → the next group is a full group of 5');
  // 正好 6 天不算离开
  const sixDays = scenario({ due: 16, lastHadNew: true });
  const shifted = sixDays.records.map((r) => (r.localDay === TODAY ? r : { ...r, localDay: addDays(r.localDay, -5), at: r.at - 5 * 86400000 }));
  assert.equal(run({ ...sixDays, records: shifted }).queue.length, 5, '6 days away is not "away"');
  // 没有那么多字可出时按实际数量（不为凑 3 个而硬补）
  const few = run({ sched: {}, records: away.records.filter((r) => r.localDay <= addDays(TODAY, -9)), candidates: K('酱') });
  assert.ok(few.queue.length <= 3, 'never more than 3 on the first group back');
});

test('new chars: at most 3 while the due + early pool can fill the group; the 4th / 5th new only appear when nothing else can fill', () => {
  // 2 个到期（p = 0.5，2 新档）→ 2 复习 + 3 新（新字最多 3）= 满 5，没有提前复习
  assert.deepEqual(counts(run(scenario({ due: 2, early: 6 }))), [2, 2, 3, 0]);
  // 1 个到期、新字最多 3 → 4 个，差 1：用最快到期的字提前复习补位，而不是第 4 个新字
  const r2 = run(scenario({ due: 1, early: 6 }));
  assert.deepEqual(counts(r2), [3, 1, 3, 1]);
  assert.deepEqual(r2.earlyKeys, K(chars(1, 600).join('')), 'the soonest-due char');
  // 没有到期、提前复习候选 6 个：3 新 + 2 提前复习
  assert.deepEqual(counts(run(scenario({ due: 0, early: 6 }))).slice(1), [0, 3, 2]);
  // 什么都补不上（没有到期、没有可提前复习的字，例如首练后的第一组）：才补到 5 个新字
  const empty = run({ sched: {}, records: [rec(1, chars(1, 0)[0], 'judged', 'correct', TODAY, { sessionId: 's1' })], candidates: K(chars(30, 800).join('')) });
  assert.equal(empty.newKeys.length, 5);
  // 提前复习候选不够（只有 1 个）：补满靠新字
  const short = run(scenario({ due: 0, early: 1 }));
  assert.deepEqual(counts(short).slice(1), [0, 4, 1]);
  // 新字也不够：组就短一点，不凑数
  const tiny = run(scenario({ due: 0, early: 1, newCands: K(chars(1, 900).join('')) }));
  assert.equal(tiny.queue.length, 2);
});

test('library exhausted and nothing due: no group is made of early reviews alone — the queue stays empty so R-H11 「现在没有要写的字」 still shows', () => {
  const only = { 'base:亦': sched(addDays(TODAY, 3)), 'base:鲜': sched(addDays(TODAY, 5)) };
  const none = selectDaily({ sched: only, records: [], today: TODAY, newCandidates: [], isWarm: isWarmKey, policy: NO_CAPITAL });
  assert.deepEqual(none.queue, []);
  // 有一个到期字就不同：到期字 + 提前复习补位
  const oneDue = selectDaily({ sched: { ...only, 'base:额': sched(addDays(TODAY, -1)) }, records: [], today: TODAY, newCandidates: [], isWarm: isWarmKey, policy: NO_CAPITAL });
  assert.deepEqual(oneDue.dueKeys, ['base:额']);
  assert.equal(oneDue.queue.length, 3, 'the due char plus the two early fillers');
  // 还有新字可出时照常用提前复习补位
  const withNew = selectDaily({ sched: only, records: [], today: TODAY, newCandidates: K('酱'), isWarm: isWarmKey, policy: NO_CAPITAL });
  assert.equal(withNew.queue.length, 3);
  assert.equal(withNew.earlyKeys.length, 2);
});

test('early reviews: soonest due first then least stable; not warm-up chars; not chars written today; stopped cards are skipped', () => {
  const far = chars(8, 600);
  const extra = {};
  extra['base:' + far[0]] = sched(addDays(TODAY, 5), 9);
  extra['base:' + far[1]] = sched(addDays(TODAY, 2), 9);
  extra['base:' + far[2]] = sched(addDays(TODAY, 2), 4); // 同日到期，稳定度低 → 排在 far[1] 前
  extra['base:' + far[3]] = { ...sched(addDays(TODAY, 1), 1), stoppedAt: 1 };
  extra['base:春'] = sched(addDays(TODAY, 1), 1); // 热身字：不提前复习
  extra['base:' + far[4]] = sched(addDays(TODAY, 1), 1); // 今天写过
  const w = scenario({ due: 0 });
  const r = run({ sched: { ...w.sched, ...extra }, records: [...w.records, rec(9600, far[4], 'judged', 'correct', TODAY, { sessionId: 's5' })], candidates: K('亦') });
  assert.deepEqual(r.earlyKeys, K([far[2], far[1], far[0]].join('')));
  assert.equal(r.earlyKeys.includes('base:春'), false);
  assert.equal(r.queue.length, 4, '3 early + 1 new (亦)');
});

// ---------------------------------------------------------------- 每日复习上限：提前复习不计入

test('dailyReviewCap: an early review done today is not counted, an on-time one is (P125 earlyCountsTowardCap=false)', () => {
  const day0 = '2026-09-01';
  // 亦：第一次写（Easy，约 8 天后到期）；今天（第 3 天）提前复习
  const r1 = rec(1, '亦', 'judged', 'correct', day0, { at: at(day0, 20), sessionId: 's1' });
  const e1 = applyJudgment(undefined, r1).entry;
  const earlyDay = addDays(day0, 3);
  assert.ok(e1.due > earlyDay, e1.due);
  const r2 = rec(2, '亦', 'judged', 'correct', earlyDay, { at: at(earlyDay, 20), sessionId: 's2' });
  const e2 = applyJudgment({ ...e1 }, r2).entry;
  assert.equal(dueReviewsDoneOn([r1, r2], earlyDay, { sched: { 'base:亦': e2 }, policy }), 0, 'early review: not counted');
  // 同一个字，到期当天才写：计入
  const r3 = rec(3, '亦', 'judged', 'correct', e1.due, { at: at(e1.due, 20), sessionId: 's3' });
  const e3 = applyJudgment({ ...e1 }, r3).entry;
  assert.equal(dueReviewsDoneOn([r1, r3], e1.due, { sched: { 'base:亦': e3 }, policy }), 1, 'on-time review: counted');
  // 重放对不上现在的调度（例如旧数据迁移来的 sched）→ 保守地计入
  assert.equal(dueReviewsDoneOn([r1, r2], earlyDay, { sched: { 'base:亦': { ...e2, due: '2030-01-01' } }, policy }), 1);
  // 新字今天第一次写不是复习
  assert.equal(dueReviewsDoneOn([r1], day0, { sched: { 'base:亦': e1 }, policy }), 0);
  // earlyCountsTowardCap=true 时按原口径
  const strict = { ...policy, groupMix: { ...policy.groupMix, earlyCountsTowardCap: true } };
  assert.equal(dueReviewsDoneOn([r1, r2], earlyDay, { sched: { 'base:亦': e2 }, policy: strict }), 1);
});

test('dailyReviewCap through selectDaily: 30 early reviews written today leave the whole budget for due chars', () => {
  const day0 = addDays(TODAY, -3);
  const records = [];
  const schedTable = {};
  let serial = 1;
  const old30 = chars(30, 1000);
  for (const c of old30) {
    const first = rec(serial++, c, 'judged', 'correct', day0, { at: at(day0, 20), sessionId: 's1' });
    const entry = applyJudgment(undefined, first).entry;
    const again = rec(serial++, c, 'judged', 'correct', TODAY, { at: at(TODAY, 8), sessionId: 's2' });
    records.push(first, again);
    schedTable['base:' + c] = applyJudgment(entry, again).entry;
  }
  // 另有 8 个到期字
  for (const c of chars(8, 1100)) {
    records.push(rec(serial++, c, 'judged', 'correct', day0, { at: at(day0, 20), sessionId: 's1' }));
    schedTable['base:' + c] = sched(addDays(TODAY, -1));
  }
  const r = selectDaily({ sched: schedTable, records, today: TODAY, newCandidates: K('亦'), isWarm: isWarmKey });
  assert.equal(r.reviewBudgetLeft, 30, 'all 30 of today\'s reviews were early → cap untouched');
  const counted = selectDaily({ sched: schedTable, records, today: TODAY, newCandidates: K('亦'), isWarm: isWarmKey, policy: { ...policy, groupMix: { ...policy.groupMix, earlyCountsTowardCap: true } } });
  assert.equal(counted.reviewBudgetLeft, 0, 'with the switch on they would exhaust the cap');
});

// ---------------------------------------------------------------- 热身字门控

test('warm-up gate (P126): only within 7 days of the first practice or when recent accuracy < 0.6; at most 1, at the head', () => {
  const warmList = K(CHAR_ORDER.warmup.slice(0, 4).join(''));
  const cands = K(plainChars(20, 300).join(''));
  const old = addDays(TODAY, -20);
  const history = (okEach) => Array.from({ length: 10 }, (_, i) => rec(200 + i, plainChars(1, 500 + i)[0], 'judged', okEach ? 'correct' : 'wrong', addDays(TODAY, -1), { sessionId: 's4' }));
  const base = (records) => selectDaily({ sched: {}, records, today: TODAY, newCandidates: cands, warmupCandidates: warmList, isWarm: isWarmKey });
  // 第 3 天（首练后 7 天内）：放 1 个，在组首
  const early = base([rec(1, plainChars(1, 10)[0], 'judged', 'correct', addDays(TODAY, -2), { sessionId: 's1' }), ...history(true)]);
  assert.equal(early.warmKeys.length, 1);
  assert.equal(early.queue[0], warmList[0], 'at the head of the group');
  assert.equal(early.queue.filter(isWarmKey).length, 1, 'at most one warm-up char');
  // 第 21 天、最近全对：不放
  const calm = base([rec(1, plainChars(1, 10)[0], 'judged', 'correct', old, { sessionId: 's1' }), ...history(true)]);
  assert.deepEqual(calm.warmKeys, []);
  assert.equal(calm.queue.some(isWarmKey), false);
  // 第 21 天、最近 10 次全错（写对率 < 0.6）：放
  const struggling = base([rec(1, plainChars(1, 10)[0], 'judged', 'correct', old, { sessionId: 's1' }), ...history(false)]);
  assert.equal(struggling.warmKeys.length, 1);
  assert.equal(struggling.queue[0], warmList[0]);
  // 第 7 天还放、第 8 天不放（首练当天算第 1 天）
  const day7 = selectDaily({ sched: {}, records: [rec(1, plainChars(1, 10)[0], 'judged', 'correct', addDays(TODAY, -6), { sessionId: 's1' }), ...history(true)], today: TODAY, newCandidates: cands, warmupCandidates: warmList, isWarm: isWarmKey });
  const day8 = selectDaily({ sched: {}, records: [rec(1, plainChars(1, 10)[0], 'judged', 'correct', addDays(TODAY, -7), { sessionId: 's1' }), ...history(true)], today: TODAY, newCandidates: cands, warmupCandidates: warmList, isWarm: isWarmKey });
  assert.equal(day7.warmKeys.length, 1, 'day 7 of practice');
  assert.equal(day8.warmKeys.length, 0, 'day 8 of practice');
  // 门控值来自 policy.warmup（换一个 policy 就变）
  const wide = selectDaily({ sched: {}, records: [rec(1, plainChars(1, 10)[0], 'judged', 'correct', old, { sessionId: 's1' }), ...history(true)], today: TODAY, newCandidates: cands, warmupCandidates: warmList, isWarm: isWarmKey, policy: { ...policy, warmup: { ...policy.warmup, firstDays: 30 } } });
  assert.equal(wide.warmKeys.length, 1);
  assert.throws(() => warmupAllowed({ dayIndex: 1, allAccuracy: 1 }, { ...policy.warmup, mode: 'always' }), /warmup\.mode/);
});

test('warm-up chars also sit in the frequency-ordered new-char tail (real deck): the warm-up slot still works and the char is never in the group twice', () => {
  const warmList = K(CHAR_ORDER.warmup.slice(0, 3).join(''));
  const cands = [...K(chars(6, 800).join('')), ...warmList, ...K(chars(10, 900).join(''))]; // 热身字夹在候选里（字频尾部）
  const records = [rec(1, chars(1, 10)[0], 'judged', 'correct', addDays(TODAY, -1), { sessionId: 's1' })];
  const r = selectDaily({ sched: {}, records, today: TODAY, newCandidates: cands, warmupCandidates: warmList, isWarm: isWarmKey, policy: NO_CAPITAL });
  assert.deepEqual(r.warmKeys, [warmList[0]]);
  assert.equal(r.queue[0], warmList[0], 'warm-up char first');
  assert.equal(new Set(r.queue).size, r.queue.length, 'no duplicates');
  assert.equal(r.queue.length, 5);
  // 热身字门控关着（第 21 天、写得好）时，候选尾部的热身字不会提前出来
  const old = [rec(1, chars(1, 10)[0], 'judged', 'correct', addDays(TODAY, -20), { sessionId: 's1' })];
  const calm = selectDaily({ sched: {}, records: old, today: TODAY, newCandidates: cands, warmupCandidates: warmList, isWarm: isWarmKey, policy: NO_CAPITAL });
  assert.deepEqual(calm.warmKeys, []);
  assert.equal(calm.queue.some((k) => warmList.includes(k)), false, 'the warm-up chars stay at the tail of the order');
});

test('warm-up: a due warm-up review replaces the new warm-up char (one warm-up char per group) and goes first; at most one warm-up review per group', () => {
  const warmDue = K(CHAR_ORDER.warmup.slice(0, 3).join(''));
  const schedTable = Object.fromEntries(warmDue.map((k, i) => [k, sched(addDays(TODAY, -1 - i))]));
  const records = [
    rec(1, plainChars(1, 10)[0], 'judged', 'correct', addDays(TODAY, -2), { sessionId: 's1' }),
    ...warmDue.map((k, i) => rec(2 + i, k.slice(5), 'judged', 'correct', addDays(TODAY, -5), { sessionId: 's1' })),
  ];
  const r = selectDaily({ sched: schedTable, records, today: TODAY, newCandidates: K(plainChars(10, 300).join('')), warmupCandidates: K(CHAR_ORDER.warmup.slice(10, 14).join('')), isWarm: isWarmKey });
  assert.equal(r.queue.filter(isWarmKey).length, 1);
  assert.equal(r.queue[0], warmDue[2], 'the most overdue warm-up review (茶, 3 days late), at the head');
  assert.deepEqual(r.warmKeys, [], 'no NEW warm-up char when a warm-up review is in the group');
});

// ---------------------------------------------------------------- 输入都从 records 推出

test('practiceStats: groups per day over the 7 days before today (today excluded, min 1), group total counts sessions', () => {
  const rs = [];
  let n = 1;
  const add = (day, sid) => rs.push(rec(n++, '字' + n, 'judged', 'correct', day, { sessionId: sid }));
  // 昨天 3 组、3 天前 2 组、10 天前 5 组（窗口外）、今天 1 组（不算进 G）
  for (const sid of ['s1', 's2', 's3']) add(addDays(TODAY, -1), sid);
  for (const sid of ['s4', 's5']) add(addDays(TODAY, -3), sid);
  for (const sid of ['s6', 's7', 's8', 's9', 's10']) add(addDays(TODAY, -10), sid);
  add(TODAY, 's11');
  add(TODAY, 's11'); // 同一组的第二个字
  const st = practiceStats(rs, TODAY, { policy, isWarm: isWarmKey });
  assert.equal(st.groupsTotal, 11);
  assert.equal(st.groupsPerDay, Math.max(1, 5 / 7), 'at least one group a day');
  const heavy = [];
  for (let d = 1; d <= 7; d += 1) for (const sid of ['a', 'b', 'c', 'd']) heavy.push(rec(heavy.length + 1, '字' + heavy.length, 'judged', 'correct', addDays(TODAY, -d), { sessionId: 's' + d + sid }));
  assert.equal(practiceStats(heavy, TODAY, { policy, isWarm: isWarmKey }).groupsPerDay, 4);
  assert.equal(st.dayIndex, 11, 'first practice 10 days ago → today is day 11');
  assert.equal(st.hadToday, true);
});

test('practiceStats: legacy records (no session) count as one group per day; recent-new accuracy uses first judgments of non-warm chars only', () => {
  const legacy = [
    { ...rec(1, '甲', 'judged', 'correct', addDays(TODAY, -2)), sessionId: undefined, legacy: true },
    { ...rec(2, '乙', 'judged', 'correct', addDays(TODAY, -2)), sessionId: undefined, legacy: true },
    { ...rec(3, '丙', 'judged', 'wrong', addDays(TODAY, -1)), sessionId: undefined, legacy: true },
  ];
  assert.equal(practiceStats(legacy, TODAY, { policy, isWarm: isWarmKey }).groupsTotal, 2);
  const rs = [
    rec(1, '亦', 'judged', 'wrong', addDays(TODAY, -9), { sessionId: 's1' }), // 第一次判断：写错
    rec(2, '亦', 'judged', 'correct', addDays(TODAY, -5), { sessionId: 's2' }), // 第二次：不算新字
    rec(3, '春', 'judged', 'correct', addDays(TODAY, -5), { sessionId: 's2' }), // 热身字：不算
    rec(4, '慢', 'judged', 'correct', addDays(TODAY, -5), { sessionId: 's2' }), // 热身字：不算
  ];
  const st = practiceStats(rs, TODAY, { policy, isWarm: isWarmKey });
  assert.equal(st.newAccuracy, (0 + 0.5 * 2) / (1 + 2), 'one first-judgment (wrong) smoothed with prior 0.5 × weight 2');
  assert.equal(st.allAccuracy, (3 + 0.7 * 2) / (4 + 2));
  // 窗口只取最近 10 个
  const many = Array.from({ length: 14 }, (_, i) => rec(i + 1, '字' + i, 'judged', i < 4 ? 'wrong' : 'correct', addDays(TODAY, -2), { sessionId: 's1' }));
  assert.equal(practiceStats(many, TODAY, { policy, isWarm: isWarmKey }).newAccuracy, (10 + 1) / 12, 'the 4 old wrong ones fell out of the 10-window');
});

test('practiceStats: lastHadNew looks at the most recent group; ≥ 7 days away flips it to false for the first group back', () => {
  const rs = [
    rec(1, '甲', 'judged', 'correct', addDays(TODAY, -2), { sessionId: 's1' }),
    rec(2, '甲', 'judged', 'correct', addDays(TODAY, -1), { sessionId: 's2' }), // 最近一组 s2：只有复习
  ];
  assert.equal(practiceStats(rs, TODAY, { policy, isWarm: isWarmKey }).lastHadNew, false);
  const rs2 = [...rs, rec(3, '乙', 'judged', 'correct', addDays(TODAY, -1), { sessionId: 's2' })];
  assert.equal(practiceStats(rs2, TODAY, { policy, isWarm: isWarmKey }).lastHadNew, true, 's2 now has a first judgment');
  const away = [rec(1, '甲', 'judged', 'correct', addDays(TODAY, -9), { sessionId: 's1' }), rec(2, '乙', 'judged', 'correct', addDays(TODAY, -9), { sessionId: 's1' })];
  const st = practiceStats(away, TODAY, { policy, isWarm: isWarmKey });
  assert.equal(st.firstBack, true);
  assert.equal(st.lastHadNew, false, 'last group had new chars but 9 days away → treated as no');
  const six = practiceStats([rec(1, '甲', 'judged', 'correct', addDays(TODAY, -6), { sessionId: 's1' })], TODAY, { policy, isWarm: isWarmKey });
  assert.equal(six.firstBack, false);
  assert.equal(six.lastHadNew, true);
  assert.equal(practiceStats([], TODAY, { policy, isWarm: isWarmKey }).lastHadNew, true, 'no records: nothing to avoid');
});

// ---------------------------------------------------------------- 组内顺序

test('group order: warm-up first, then review/new interleaved, early reviews last; a new char is never last when a review can take its place', () => {
  const isW = (k) => k === 'W' || k === 'w1';
  assert.deepEqual(arrangeGroup({ warmNew: 'W', revKeys: ['r1', 'r2'], earlyKeys: [], newKeys: ['n1', 'n2'], isWarm: isW }), ['W', 'r1', 'n1', 'n2', 'r2'], 'interleaved r1 n1 r2 n2 would end on a new char → r2 moves to the end');
  assert.deepEqual(arrangeGroup({ warmNew: null, revKeys: ['r1', 'r2', 'r3'], earlyKeys: [], newKeys: ['n1', 'n2'], isWarm: isW }), ['r1', 'n1', 'r2', 'n2', 'r3'], 'review new review new review');
  // 3 新 2 复：交错后末位是新字 → 把最后一个复习字挪到末位
  assert.deepEqual(arrangeGroup({ warmNew: null, revKeys: ['r1', 'r2'], earlyKeys: [], newKeys: ['n1', 'n2', 'n3'], isWarm: isW }), ['r1', 'n1', 'n2', 'n3', 'r2']);
  // 提前复习放最后
  assert.deepEqual(arrangeGroup({ warmNew: null, revKeys: ['r1'], earlyKeys: ['e1', 'e2'], newKeys: ['n1', 'n2'], isWarm: isW }), ['r1', 'n1', 'n2', 'e1', 'e2']);
  // 热身字复习在组首
  assert.deepEqual(arrangeGroup({ warmNew: null, revKeys: ['r1', 'w1', 'r2'], earlyKeys: [], newKeys: ['n1'], isWarm: isW }), ['w1', 'r1', 'n1', 'r2']);
  // 全新字：没有复习可换，保持原序；单个字
  assert.deepEqual(arrangeGroup({ warmNew: 'W', revKeys: [], earlyKeys: [], newKeys: ['n1', 'n2'], isWarm: isW }), ['W', 'n1', 'n2']);
  assert.deepEqual(arrangeGroup({ warmNew: null, revKeys: ['r1'], earlyKeys: [], newKeys: [], isWarm: isW }), ['r1']);
  // 通过 selectDaily：3 新 + 2 复习，末位是复习字
  const r = run(scenario({ due: 7, G: 4, accuracy: 'high' }));
  assert.equal(r.newKeys.length, 3);
  assert.ok(r.dueKeys.includes(r.queue[r.queue.length - 1]), 'the group ends on a review char');
});

test('selectDaily keeps working with the legacy call shape (no warm-up list, no isWarm): reviews and new chars fill the group', async () => {
  const r = selectDaily({ sched: { 'base:亦': sched('2026-09-20') }, records: [], today: TODAY, newCandidates: K('鲜境额慢') });
  assert.equal(r.queue.length, 5);
  assert.ok(r.dueKeys.includes('base:亦'));
  assert.equal(r.special, null);
  assert.equal((await policyWith({})).groupSize, 5);
});
