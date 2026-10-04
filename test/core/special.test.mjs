// D40「写写大写数字」特别组（阶段 1 P1-E4）：src/core/special.js + sessions.selectDaily / specialPlan + session-start.planSpecial。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import { CHAR_ORDER } from '../../src/config/char-order.js';
import { selectDaily, specialPlan } from '../../src/core/sessions.js';
import { capitalProgress, capitalSpecial, capitalAfterKeysFor } from '../../src/core/special.js';
import { planDaily, planSpecial } from '../../src/core/session-start.js';
import { addDays } from '../../src/core/dates.js';
import { rec } from './helpers.mjs';

const TODAY = '2026-09-24';
const K = (s) => [...s].map((c) => 'base:' + c);
const sched = (due, stability = 5) => ({ fsrs: { stability }, due, lastJudgedAt: 0 });
const WARM = new Set(CHAR_ORDER.warmup);
const isWarm = (k) => WARM.has(k.slice(5));

/** n 组历史（每组一个字，第 1 组是首练 尴 赢 拾 三字），到今天之前。 */
function history(groups, { first = true } = {}) {
  const out = [];
  let id = 1;
  if (first) for (const c of '尴赢拾') out.push(rec(id++, c, 'judged', 'correct', addDays(TODAY, -groups - 1), { sessionId: 's1' }));
  for (let g = 2; g <= groups; g += 1) {
    out.push(rec(id++, String.fromCodePoint(0x6000 + g), 'judged', 'correct', addDays(TODAY, -(groups - g) - 1), { sessionId: 's' + g }));
  }
  return out;
}

const run = (records, extra = {}) => selectDaily({ sched: {}, records, today: TODAY, newCandidates: K('亦鲜境额'), isWarm, ...extra });

test('special group: not before 10 groups; from the 10th group on (and p < 1.5) the daily group becomes 壹贰叁肆伍', () => {
  assert.equal(run(history(9)).special, null);
  assert.deepEqual(run(history(9)).queue.some((k) => '壹贰叁肆伍'.includes(k.slice(5))), false);
  const r = run(history(10));
  assert.equal(r.special.kind, 'capital1');
  assert.deepEqual(r.queue, K('壹贰叁肆伍'));
  assert.deepEqual(r.special.keys, K('壹贰叁肆伍'));
  assert.equal(r.queue.length, policy.groupSize);
  assert.equal(specialPlan({ sched: {}, records: history(10), today: TODAY }).kind, 'capital1');
  assert.equal(specialPlan({ sched: {}, records: history(9), today: TODAY }), null);
});

test('special group is a full group of 5 even as the first group after ≥ 7 days away (D48 ⑧ shortens only ordinary groups, P184)', () => {
  const away = history(10).map((r) => ({ ...r, localDay: addDays(r.localDay, -10) }));
  const r = run(away);
  assert.equal(r.special.kind, 'capital1');
  assert.deepEqual(r.queue, K('壹贰叁肆伍'), 'the capital-numeral set is never cut to 3');
});

test('special group: only when p < 1.5; a heavy backlog postpones it', () => {
  const records = history(10);
  const schedTable = {};
  // 6 个到期字 → p = 6 / 4 = 1.5：不触发；5 个 → 1.25：触发
  const dueChars = [...'子丑寅卯辰巳'];
  dueChars.forEach((c) => { schedTable['base:' + c] = sched(addDays(TODAY, -2)); });
  assert.equal(run(records, { sched: schedTable }).special, null, 'p = 1.5 → not yet');
  delete schedTable['base:巳'];
  assert.equal(run(records, { sched: schedTable }).special.kind, 'capital1', 'p = 1.25 → now');
  assert.equal(specialPlan({ sched: schedTable, records, today: TODAY }).kind, 'capital1');
});

test('special group: group 2 (陆柒捌玖拾) follows once group 1 has appeared; both appear once only; 拾 does not count as a marker', () => {
  const g1 = history(10);
  // 第 1 组写完（壹贰叁肆伍有了记录）
  const after1 = [...g1, ...[...'壹贰叁肆伍'].map((c, i) => rec(100 + i, c, 'judged', 'correct', TODAY, { sessionId: 's11' }))];
  const next = selectDaily({ sched: {}, records: after1, today: addDays(TODAY, 1), newCandidates: K('亦鲜境额'), isWarm });
  assert.equal(next.special.kind, 'capital2');
  assert.deepEqual(next.queue, K('陆柒捌玖拾'));
  // 第 2 组也写完：特别组不再出现
  const after2 = [...after1, ...[...'陆柒捌玖拾'].map((c, i) => rec(200 + i, c, 'judged', 'wrong', addDays(TODAY, 1), { sessionId: 's12' }))];
  const done = selectDaily({ sched: {}, records: after2, today: addDays(TODAY, 2), newCandidates: K('亦鲜境额'), isWarm });
  assert.equal(done.special, null);
  assert.equal(specialPlan({ sched: {}, records: after2, today: addDays(TODAY, 2) }), null);
  // 拾 在首练里写过（history 里就有），不能把「第 2 组」算成已出现
  const progress = capitalProgress(g1, policy);
  assert.deepEqual(progress.map((p) => p.done), [false, false]);
  assert.deepEqual(capitalProgress(after1, policy).map((p) => p.done), [true, false]);
  assert.deepEqual(capitalProgress(after2, policy).map((p) => p.done), [true, true]);
  // 任何一种记录都算「出现过」（看过答案 / 跳过也不再重来）
  const skipped = [...g1, rec(300, '陆', 'skipped', undefined, TODAY, { sessionId: 's11' })];
  assert.deepEqual(capitalProgress(skipped, policy).map((p) => p.done), [false, true]);
});

test('special group: chars written today are left out; a group with nothing left falls through to the next / the daily mix', () => {
  const g1 = history(10);
  const partial = run([...g1, rec(400, '壹', 'judged', 'correct', TODAY, { sessionId: 's11' })]);
  assert.equal(partial.special.kind, 'capital2', 'group 1 already appeared (壹 has a record, even if the rest were never written) → never again; group 2 is next');
  assert.equal(partial.queue.includes('base:壹'), false);
  const noDeck = run(g1, { practicable: (k) => !'壹贰叁肆伍'.includes(k.slice(5)) && k.startsWith('base:') });
  assert.equal(noDeck.special.kind, 'capital2', 'group 1 not practicable → group 2');
  const none = run(g1, { practicable: (k) => !'壹贰叁肆伍陆柒捌玖拾'.includes(k.slice(5)) && k.startsWith('base:') });
  assert.equal(none.special, null);
  assert.equal(none.queue.length > 0, true);
});

test('special group can be switched off (policy.capitalNumerals.enabled) and its thresholds come from policy (P128)', () => {
  const off = { ...policy, capitalNumerals: { ...policy.capitalNumerals, enabled: false } };
  assert.equal(run(history(12), { policy: off }).special, null);
  assert.equal(specialPlan({ sched: {}, records: history(12), today: TODAY, policy: off }), null);
  const later = { ...policy, capitalNumerals: { ...policy.capitalNumerals, afterGroups: 20 } };
  assert.equal(run(history(12), { policy: later }).special, null);
  assert.equal(run(history(20), { policy: later }).special.kind, 'capital1');
  const strictP = { ...policy, capitalNumerals: { ...policy.capitalNumerals, belowDays: 0.1 } };
  assert.equal(run(history(12), { policy: strictP, sched: { 'base:子': sched(addDays(TODAY, -1)) } }).special, null);
});

test('佰 仟 are not in the two groups: after both groups appeared they lead the ordinary new-char queue, once', () => {
  const g1 = history(10);
  assert.deepEqual(capitalAfterKeysFor(g1, policy), [], 'before the groups: nothing');
  const both = [
    ...g1,
    ...[...'壹贰叁肆伍'].map((c, i) => rec(100 + i, c, 'judged', 'correct', TODAY, { sessionId: 's11' })),
    ...[...'陆柒捌玖拾'].map((c, i) => rec(200 + i, c, 'judged', 'correct', TODAY, { sessionId: 's12' })),
  ];
  assert.deepEqual(capitalAfterKeysFor(both, policy), K('佰仟'));
  const day = addDays(TODAY, 1);
  const r = selectDaily({ sched: {}, records: both, today: day, newCandidates: K('亦鲜境额慢'), isWarm });
  assert.deepEqual(r.newKeys.slice(0, 2), K('佰仟'), 'then the usual order');
  assert.equal(r.special, null);
  // 写过之后（进了调度）就不再排前面
  const r2 = selectDaily({ sched: { 'base:佰': sched(addDays(day, 5)), 'base:仟': sched(addDays(day, 5)) }, records: both, today: day, newCandidates: K('亦鲜境额慢'), isWarm });
  assert.equal(r2.newKeys.includes('base:佰') || r2.newKeys.includes('base:仟'), false);
  assert.deepEqual(capitalSpecial({ records: both, stats: { groupsTotal: 99 }, pressure: 0, practicable: () => true, excluded: new Set(), policy }), null);
});

test('planDaily / planSpecial expose the special group to the session start and the home page', () => {
  const state = { records: { '2026-09': history(10) }, sched: {}, sessions: { A: null, B: null, lastEnded: {} }, settings: {} };
  const deck = { newCandidates: () => K('亦鲜境额'), practicable: (k) => k.startsWith('base:'), currentLibraryId: () => 'core3500' };
  const plan = planDaily(state, { today: TODAY, deck });
  assert.equal(plan.special.kind, 'capital1');
  assert.deepEqual(plan.queue, K('壹贰叁肆伍'));
  assert.equal(planSpecial(state, { today: TODAY, deck }).kind, 'capital1');
  assert.equal(planSpecial({ ...state, records: {} }, { today: TODAY, deck }), null, 'no records yet → first practice, never special');
  // 题库里没有这些字（不可练）→ 没有特别组
  assert.equal(planSpecial(state, { today: TODAY, deck: { ...deck, practicable: (k) => k.startsWith('base:') && !'壹贰叁肆伍陆柒捌玖拾'.includes(k.slice(5)) } }), null);
});

test('policy D40: capitalNumerals (P128) = 10 groups, p < 1.5, switchable', () => {
  assert.deepEqual({ ...policy.capitalNumerals }, { enabled: true, afterGroups: 10, belowDays: 1.5 });
  assert.ok(Object.isFrozen(policy.capitalNumerals));
});
