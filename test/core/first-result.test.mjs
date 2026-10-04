// 阶段 1 P1-E5：首练结果页的复现预告（D41）、提醒邀请的次数与状态（D35 / D46 ③）、特别组顺延（D46 ④）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { MemoryStorage } from '../store/helpers.mjs';
import * as policy from '../../src/config/policy.js';
import { CHAR_ORDER } from '../../src/config/char-order.js';
import { t } from '../../src/config/copy/index.js';
import { addDays } from '../../src/core/dates.js';
import { selectDaily, specialPlan } from '../../src/core/sessions.js';
import { deferSpecial, planDaily, planSpecial, capitalDeferredDayOf } from '../../src/core/session-start.js';
import { capitalSpecial, isDeferred } from '../../src/core/special.js';
import {
  INVITE_MAX, commitInviteAnswer, commitInviteShown, inviteDecision, inviteOf, inviteTime, inviteTimeText, previewText, reviewPreview,
  tierOfDue,
} from '../../src/core/first-result.js';
import { at, rec } from './helpers.mjs';

const TODAY = '2026-09-24';
const K = (s) => [...s].map((c) => 'base:' + c);
const item = (c) => ({ char: c, cardKey: 'base:' + c });
const sched = (due) => ({ fsrs: { stability: 3 }, due, lastJudgedAt: 0 });

// ---------------------------------------------------------------- 复现预告

test('tierOfDue: ≤1 day = 明天, 2–3 = 过两天, ≥4 = 过几天 (already due counts as 明天)', () => {
  assert.equal(tierOfDue(addDays(TODAY, -2), TODAY), 'tomorrow');
  assert.equal(tierOfDue(TODAY, TODAY), 'tomorrow');
  assert.equal(tierOfDue(addDays(TODAY, 1), TODAY), 'tomorrow');
  assert.equal(tierOfDue(addDays(TODAY, 2), TODAY), 'soon');
  assert.equal(tierOfDue(addDays(TODAY, 3), TODAY), 'soon');
  assert.equal(tierOfDue(addDays(TODAY, 4), TODAY), 'later');
  assert.equal(tierOfDue(addDays(TODAY, 30), TODAY), 'later');
});

test('reviewPreview + previewText: tiers merge by due (near → far); the design-sheet sentences', () => {
  const mixed = reviewPreview({
    chars: [item('尴'), item('赢'), item('拾')],
    sched: { 'base:尴': sched(addDays(TODAY, 2)), 'base:赢': sched(addDays(TODAY, 1)), 'base:拾': sched(addDays(TODAY, 3)) },
    today: TODAY,
  });
  assert.deepEqual(mixed.groups, [{ tier: 'tomorrow', chars: ['赢'] }, { tier: 'soon', chars: ['尴', '拾'] }]);
  assert.equal(mixed.same, false);
  assert.equal(previewText(mixed, t), '「赢」明天再来找你，「尴」「拾」过两天。');

  const three = reviewPreview({
    chars: [item('尴'), item('赢'), item('拾')],
    sched: { 'base:尴': sched(addDays(TODAY, 5)), 'base:赢': sched(addDays(TODAY, 1)), 'base:拾': sched(addDays(TODAY, 2)) },
    today: TODAY,
  });
  assert.equal(previewText(three, t), '「赢」明天再来找你，「拾」过两天，「尴」过几天。');

  const same = reviewPreview({
    chars: [item('尴'), item('赢'), item('拾')],
    sched: { 'base:尴': sched(addDays(TODAY, 2)), 'base:赢': sched(addDays(TODAY, 2)), 'base:拾': sched(addDays(TODAY, 3)) },
    today: TODAY,
  });
  assert.equal(same.same, true);
  assert.equal(previewText(same, t), '过两天，它们再来找你。');
  const tomorrowAll = reviewPreview({
    chars: [item('尴'), item('赢')],
    sched: { 'base:尴': sched(addDays(TODAY, 1)), 'base:赢': sched(addDays(TODAY, 1)) },
    today: TODAY,
  });
  assert.equal(previewText(tomorrowAll, t), '明天，它们再来找你。');

  const one = reviewPreview({ chars: [item('赢')], sched: { 'base:赢': sched(addDays(TODAY, 1)) }, today: TODAY });
  assert.equal(one.same, false, 'a single char is not 「它们」');
  assert.equal(previewText(one, t), '「赢」明天再来找你。');
});

test('reviewPreview: chars without a schedule (skipped / answer-seen, D18) are left out; none at all → no sentence', () => {
  const p = reviewPreview({
    chars: [item('尴'), item('赢'), item('拾')],
    sched: { 'base:拾': sched(addDays(TODAY, 3)) },
    today: TODAY,
  });
  assert.deepEqual(p.groups, [{ tier: 'soon', chars: ['拾'] }]);
  assert.equal(previewText(p, t), '「拾」过两天再来找你。');
  const none = reviewPreview({ chars: [item('尴'), item('赢')], sched: {}, today: TODAY });
  assert.deepEqual(none.groups, []);
  assert.equal(previewText(none, t), '');
  const stopped = reviewPreview({ chars: [item('尴')], sched: { 'base:尴': { ...sched(addDays(TODAY, 3)), stoppedAt: 5 } }, today: TODAY });
  assert.deepEqual(stopped.groups, [], 'stopped cards never come back');
  const dup = reviewPreview({ chars: [item('尴'), item('尴')], sched: { 'base:尴': sched(addDays(TODAY, 1)) }, today: TODAY });
  assert.deepEqual(dup.groups, [{ tier: 'tomorrow', chars: ['尴'] }]);
});

// ---------------------------------------------------------------- 提醒邀请

test('inviteTime: now floored to the half hour; outside 7:00–22:00 → 20:30 (evening title)', () => {
  const at0 = (h, m) => new Date(2026, 8, 24, h, m).getTime();
  assert.deepEqual(inviteTime(at0(9, 41)), { hour: 9, minute: 30, evening: false });
  assert.deepEqual(inviteTime(at0(9, 29)), { hour: 9, minute: 0, evening: false });
  assert.deepEqual(inviteTime(at0(7, 0)), { hour: 7, minute: 0, evening: false });
  assert.deepEqual(inviteTime(at0(21, 59)), { hour: 21, minute: 30, evening: false });
  assert.deepEqual(inviteTime(at0(22, 0)), { hour: 20, minute: 30, evening: true });
  assert.deepEqual(inviteTime(at0(23, 40)), { hour: 20, minute: 30, evening: true });
  assert.deepEqual(inviteTime(at0(6, 50)), { hour: 20, minute: 30, evening: true }, '6:50 floors to 6:30, before 7:00');
  assert.deepEqual(inviteTime(at0(0, 5)), { hour: 20, minute: 30, evening: true });
  assert.equal(inviteTimeText(9, 30), '9:30');
  assert.equal(inviteTimeText(20, 0), '20:00');
  assert.equal(t('X-INVITE.accepted', { time: inviteTimeText(9, 30) }), '好，明天 9:30 给你一个词。');
});

test('inviteDecision: asked at most twice — first result page once, then the next daily result page once; never after an answer', () => {
  const S = (remindInvite, remind) => ({ ...(remindInvite ? { remindInvite } : {}), ...(remind ? { remind } : {}) });
  assert.equal(INVITE_MAX, 2);
  // 第一次：首练结果页显示；每日结果页不显示
  assert.equal(inviteDecision({ settings: null, variant: 'first', sessionId: 's1' }), 'show');
  assert.equal(inviteDecision({ settings: null, variant: 'daily', sessionId: 's2' }), 'hidden');
  assert.equal(inviteDecision({ settings: null, variant: 'picked', sessionId: 's3' }), 'hidden');
  // 首练页已邀请（shown 1，last s1）：同一页继续显示（刷新 / 回来）；未回应 → 下一次每日结果页再问一次
  const once = S({ shown: 1, last: 's1' });
  assert.equal(inviteDecision({ settings: once, variant: 'first', sessionId: 's1' }), 'show');
  assert.equal(inviteDecision({ settings: once, variant: 'daily', sessionId: 's2' }), 'show', 'second chance');
  assert.equal(inviteDecision({ settings: once, variant: 'picked', sessionId: 's2' }), 'hidden', 'picked result pages never invite');
  assert.equal(inviteDecision({ settings: once, variant: 'first', sessionId: 's9' }), 'hidden', 'a later first-variant page does not restart the count');
  // 第二次已问：再下一页不再问；但就是第二次那一页本身仍显示
  const twice = S({ shown: 2, last: 's2' });
  assert.equal(inviteDecision({ settings: twice, variant: 'daily', sessionId: 's2' }), 'show');
  assert.equal(inviteDecision({ settings: twice, variant: 'daily', sessionId: 's3' }), 'hidden');
  // 回应过：永不再问（好 / 不用了 / 系统拒绝）——连当前页也收起（回应的结果在邀请块里显示由页面自己管）
  for (const answered of ['yes', 'no', 'denied']) {
    assert.equal(inviteDecision({ settings: S({ shown: 1, last: 's1', answered }), variant: 'daily', sessionId: 's2' }), 'hidden', answered);
  }
  // 提醒已经开着：不问
  assert.equal(inviteDecision({ settings: S(null, { enabled: true }), variant: 'first', sessionId: 's1' }), 'hidden');
  assert.equal(inviteDecision({ settings: S(null, { enabled: false }), variant: 'first', sessionId: 's1' }), 'show');
});

function makeEnv() {
  const clock = { t: at(TODAY, 9) };
  const storage = createStorage(new MemoryStorage(), { now: () => clock.t });
  const store = createStore({ storage, now: () => clock.t });
  store.load();
  const commits = [];
  store.subscribe((state, info) => { if (info && info.type === 'commit') commits.push(info.label); });
  return { store, clock, commits };
}

test('commitInviteShown / commitInviteAnswer: counted once per session, capped at 2, answers stick; all through store.commit', () => {
  const { store, commits } = makeEnv();
  assert.deepEqual(inviteOf(store.getState().settings), { shown: 0, last: null, answered: null });
  assert.equal(commitInviteShown(store, { sessionId: 's1' }).ok, true);
  assert.deepEqual(inviteOf(store.getState().settings), { shown: 1, last: 's1', answered: null });
  assert.equal(commitInviteShown(store, { sessionId: 's1' }).skipped, true, 'same session (page refresh) is not counted again');
  assert.equal(commitInviteShown(store, { sessionId: 's2' }).ok, true);
  assert.equal(inviteOf(store.getState().settings).shown, 2);
  assert.equal(commitInviteShown(store, { sessionId: 's3' }).skipped, true, 'never more than two');
  assert.equal(inviteOf(store.getState().settings).last, 's2');
  assert.equal(commitInviteAnswer(store, 'no').ok, true);
  assert.equal(inviteOf(store.getState().settings).answered, 'no');
  assert.equal(commitInviteAnswer(store, 'no').skipped, true);
  assert.throws(() => commitInviteAnswer(store, 'maybe'), RangeError);
  assert.deepEqual(commits, ['invite:shown', 'invite:shown', 'invite:answer'], 'only these commits');
  // 其他 settings 字段不被抹掉
  store.commit('test', (draft) => { draft.settings = { ...draft.settings, sound: false }; });
  commitInviteAnswer(store, 'denied');
  assert.equal(store.getState().settings.sound, false);
  assert.equal(store.getState().settings.remindInvite.shown, 2);
  // 已经写进 localStorage 形状：重新 load 还在（schema 认这些字段）
  const reload = createStore({ storage: createStorage(new MemoryStorage({ initial: {} }), { now: () => 0 }), now: () => 0 });
  reload.load();
  assert.deepEqual(inviteOf(reload.getState().settings), { shown: 0, last: null, answered: null });
});

// ---------------------------------------------------------------- 特别组顺延

/** n 组历史（每组一个字，第 1 组是首练 尴 赢 拾 三字），到今天之前。 */
function history(groups) {
  const out = [];
  let id = 1;
  for (const c of '尴赢拾') out.push(rec(id++, c, 'judged', 'correct', addDays(TODAY, -groups - 1), { sessionId: 's1' }));
  for (let g = 2; g <= groups; g += 1) {
    out.push(rec(id++, String.fromCodePoint(0x6000 + g), 'judged', 'correct', addDays(TODAY, -(groups - g) - 1), { sessionId: 's' + g }));
  }
  return out;
}
const WARM = new Set(CHAR_ORDER.warmup);
const isWarm = (k) => WARM.has(k.slice(5));

test('special deferral (D46 ④): only the deferred day skips the special group; the next day it is back if the conditions hold', () => {
  const records = history(10);
  const run = (today, deferred) => selectDaily({ sched: {}, records, today, newCandidates: K('亦鲜境额'), isWarm, capitalDeferredDay: deferred });
  assert.equal(run(TODAY, null).special.kind, 'capital1');
  const deferredToday = run(TODAY, TODAY);
  assert.equal(deferredToday.special, null, 'deferred today → the ordinary mix');
  assert.equal(deferredToday.queue.some((k) => '壹贰叁肆伍'.includes(k.slice(5))), false);
  assert.equal(deferredToday.queue.length > 0, true);
  assert.equal(specialPlan({ sched: {}, records, today: TODAY, capitalDeferredDay: TODAY }), null);
  const tomorrow = addDays(TODAY, 1);
  assert.equal(run(tomorrow, TODAY).special.kind, 'capital1', 'the day after, the deferral is over');
  assert.equal(specialPlan({ sched: {}, records, today: tomorrow, capitalDeferredDay: TODAY }).kind, 'capital1');
  // 顺延不改「出现过」的口径：这一组没有记录，仍然是第 1 组
  assert.equal(isDeferred(TODAY, TODAY), true);
  assert.equal(isDeferred(addDays(TODAY, -1), TODAY), false);
  assert.equal(isDeferred(null, TODAY), false);
  assert.equal(capitalSpecial({ records, stats: { groupsTotal: 99 }, pressure: 0, practicable: () => true, excluded: new Set(), policy, today: TODAY, deferredDay: TODAY }), null);
});

test('deferSpecial writes settings.capitalDeferredDay once through store.commit; planDaily / planSpecial read it', () => {
  const { store, clock, commits } = makeEnv();
  store.commit('seed', (draft) => {
    const records = history(10);
    const months = {};
    for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
    draft.records = months;
  }, { replace: false });
  const deck = { newCandidates: () => K('亦鲜境额'), practicable: (k) => k.startsWith('base:'), currentLibraryId: () => 'core3500' };
  assert.equal(capitalDeferredDayOf(store.getState()), null);
  assert.equal(planSpecial(store.getState(), { today: TODAY, deck }).kind, 'capital1');
  assert.equal(planDaily(store.getState(), { today: TODAY, deck }).special.kind, 'capital1');
  const r = deferSpecial(store, { now: () => clock.t });
  assert.equal(r.ok, true);
  assert.equal(capitalDeferredDayOf(store.getState()), TODAY);
  assert.equal(planSpecial(store.getState(), { today: TODAY, deck }), null);
  assert.equal(planDaily(store.getState(), { today: TODAY, deck }).special, null);
  assert.equal(deferSpecial(store, { now: () => clock.t }).skipped, true, 'second tap the same day writes nothing');
  assert.deepEqual(commits.filter((l) => l === 'session:defer-special').length, 1);
  clock.t = at(addDays(TODAY, 1), 9);
  assert.equal(planSpecial(store.getState(), { today: addDays(TODAY, 1), deck }).kind, 'capital1');
});
