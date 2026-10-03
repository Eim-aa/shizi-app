// core/session-start.js（M2-2）：开组的 store.commit 包装——首练 3 字（P09 / D38）、今天的练习选字（01 §5，D41 配比）、S02（R-H05 / P38）、
// 跨天过期（P37 / P61）、失败不发布（D07）。另测 data/deck.js 的题库访问与 S02 正文拼字。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { MemoryStorage } from '../store/helpers.mjs';
import { at, rec, policyWith } from './helpers.mjs';
import * as policy from '../../src/config/policy.js';
import {
  aStartInfo, endOldAndStartPicked, everPracticed, expireStale, planDaily, recordsOf, resumableSession, resumeSlot, s02Data,
  startDaily,
  startFirst, startNextA, startPicked,
} from '../../src/core/session-start.js';
import {
  allCards, cardForKey, currentLibraryId, deckAdapter, DEFAULT_LIBRARY_ID, getDeck, libraryIdsOfKey, libraryOf,
  loadDeck, setCardResolver, setDeckSource,
} from '../../src/data/deck.js';

const TODAY = '2026-09-24';
const YESTERDAY = '2026-09-23';

function makeEnv(nowMs = at(TODAY, 20)) {
  const clock = { t: nowMs };
  const backend = new MemoryStorage();
  const storage = createStorage(backend, { now: () => clock.t });
  const store = createStore({ storage, now: () => clock.t });
  store.load();
  const commits = [];
  store.subscribe((state, info) => {
    if (info && info.type === 'commit') commits.push(info.label);
  });
  return { store, storage, backend, clock, commits, now: () => clock.t };
}

function monthsOf(records) {
  const out = {};
  for (const r of records) (out[r.localDay.slice(0, 7)] || (out[r.localDay.slice(0, 7)] = [])).push(r);
  return out;
}

function sched(due, stability = 5) {
  return { fsrs: { stability, difficulty: 5, state: 2 }, due, lastJudgedAt: at('2026-09-01') };
}

function session({ id = 's90', slot = 'A', kind, chars, cursor = 0, day = TODAY, items = [] }) {
  const t = at(day, 9);
  return {
    id,
    slot,
    kind: kind || (slot === 'B' ? 'picked' : 'daily'),
    source: { view: 'home' },
    queue: chars.map(c => 'base:' + c),
    cursor,
    items,
    current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false },
    lastLine: null,
    startedAt: t,
    startedDay: day,
    updatedAt: t,
  };
}

function seed(env, { records = [], schedTable = {}, sessions = null, custom = null, settings = null, backupMeta = null } = {}) {
  const r = env.store.seed({
    records: monthsOf(records),
    sched: schedTable,
    sessions: sessions || { A: null, B: null, lastEnded: {} },
    ...(custom ? { custom } : {}),
    ...(settings ? { settings } : {}),
    ...(backupMeta ? { backupMeta } : {}),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  env.commits.length = 0;
}

// 假题库：新字来源按给定顺序；可练 = base: 且在题库里。
const LIB = '甲乙丙丁戊己庚辛壬癸'.split('').map(c => 'base:' + c);
function fakeDeck(keys = LIB, extra = []) {
  const known = new Set([...keys, ...extra]);
  return { newCandidates: () => keys, practicable: k => known.has(k), currentLibraryId: () => 'core3500' };
}

test('planDaily: a deck without currentLibraryId falls back to settings.library, then policy.defaultLibrary (P73)', async () => {
  const asked = [];
  const deck = { newCandidates: id => { asked.push(id); return LIB; }, practicable: k => LIB.includes(k) };
  const empty = { records: {}, sched: {}, sessions: { A: null, B: null, lastEnded: {} } };
  assert.equal(planDaily(empty, { today: TODAY, deck }).libraryId, 'core3500');
  assert.equal(planDaily({ ...empty, settings: { library: 'adv3000' } }, { today: TODAY, deck }).libraryId, 'adv3000');
  assert.equal(planDaily(empty, { today: TODAY, deck, policy: await policyWith({ defaultLibrary: 'rare' }) }).libraryId, 'rare');
  assert.deepEqual(asked, ['core3500', 'adv3000', 'rare']);
});

// ---------------------------------------------------------------- 第一次练习

test('first practice: fixed 3 characters from policy.firstQueue (P09 / D38), slot A, one commit', () => {
  const env = makeEnv();
  seed(env);
  assert.deepEqual(aStartInfo(env.store.getState()), { kind: 'first', firstVisit: true });
  const r = startNextA(env.store, { now: env.now, deck: fakeDeck() });
  assert.equal(r.ok, true);
  assert.equal(r.started, true);
  assert.equal(r.kind, 'first');
  const s = env.store.getState().sessions.A;
  assert.deepEqual(s.queue, policy.firstQueue.map(c => 'base:' + c));
  assert.equal(s.queue.length, 3, 'D38: 首练 3 字（原 D17 / P09 的 5 字）');
  assert.deepEqual(s.queue, ['base:尴', 'base:赢', 'base:拾']);
  assert.equal(s.kind, 'first');
  assert.equal(s.slot, 'A');
  assert.equal(s.startedDay, TODAY);
  assert.deepEqual(env.commits, ['session:start-first']);
  assert.equal(env.store.getState().sessions.B, null);
});

test('after clearing all records: next A is first again (P46) but not a first visit (R-H09)', () => {
  const env = makeEnv();
  seed(env, { backupMeta: { lastExportAt: null, lastExportSig: null, lastConclusion: { kind: 'clear', date: YESTERDAY, count: 3 } } });
  assert.equal(everPracticed(env.store.getState()), true);
  assert.deepEqual(aStartInfo(env.store.getState()), { kind: 'first', firstVisit: false });
  const withRecords = makeEnv();
  seed(withRecords, { records: [rec(1, '甲', 'judged', 'correct', YESTERDAY)], schedTable: { 'base:甲': sched('2026-09-30') } });
  assert.deepEqual(aStartInfo(withRecords.store.getState()), { kind: 'daily', firstVisit: false });
});

test('startFirst ignores the deck and does not expire a first session across days (P61 never)', () => {
  const env = makeEnv();
  seed(env, { sessions: { A: session({ kind: 'first', chars: ['尴', '嚏'], day: YESTERDAY }), B: null, lastEnded: {} } });
  const r = startFirst(env.store, { now: env.now });
  assert.equal(r.ok, true);
  assert.equal(r.occupied, true, 'yesterday\'s unfinished first session is kept');
  assert.equal(env.commits.length, 0);
  const res = resumeSlot(env.store, 'A', { now: env.now });
  assert.equal(res.session.id, 's90');
  assert.deepEqual(res.expired, []);
});

// ---------------------------------------------------------------- 今天的练习

test('daily: due ordered overdue desc / stability asc, new characters in library order, interleaved review-new (D41); group size 5', () => {
  const env = makeEnv();
  seed(env, {
    records: [
      rec(1, '子', 'judged', 'correct', '2026-09-01'),
      rec(2, '丑', 'judged', 'wrong', '2026-09-01'),
      rec(3, '寅', 'judged', 'correct', '2026-09-01'),
      rec(4, '卯', 'judged', 'correct', '2026-09-01'),
    ],
    schedTable: {
      'base:子': sched('2026-09-20', 9), // 逾期 4 天
      'base:丑': sched('2026-09-22', 1), // 逾期 2 天
      'base:寅': sched('2026-09-22', 3), // 逾期 2 天，稳定度高 → 排在丑后
      'base:卯': sched('2026-10-10'), // 未到期
    },
  });
  const deck = fakeDeck(LIB, ['base:子', 'base:丑', 'base:寅', 'base:卯']);
  const r = startDaily(env.store, { now: env.now, deck });
  assert.equal(r.ok, true);
  assert.equal(r.started, true);
  const s = env.store.getState().sessions.A;
  assert.equal(s.kind, 'daily');
  // D41：3 个到期 → 积压天数 p = 3 / 4 = 0.75，落在「2 新」档；组内复、新交错（复 新 复 新 复），组尾是好写的复习字。
  // 旧断言 [子 丑 寅 甲 乙]（到期字全排在新字前）不再成立：到期字内部顺序（逾期降序、稳定度升序）与新字顺序不变，只是交错了。
  assert.deepEqual(s.queue, ['base:子', 'base:甲', 'base:丑', 'base:乙', 'base:寅']);
  assert.deepEqual(r.plan.dueKeys, ['base:子', 'base:丑', 'base:寅']);
  assert.deepEqual(r.plan.newKeys, ['base:甲', 'base:乙']);
  assert.equal(s.queue.length, policy.groupSize);
  assert.deepEqual(env.commits, ['session:start-daily']);
});

test('daily: characters judged today never come back; skipped today can; answer-seen follows policy.answerSeenScope (P36)', async () => {
  const records = [
    rec(1, '甲', 'judged', 'correct', TODAY),
    rec(2, '乙', 'skipped', undefined, TODAY),
    rec(3, '丙', 'answer-seen', undefined, TODAY),
  ];
  const schedTable = { 'base:甲': sched('2026-09-26') };
  const env = makeEnv();
  seed(env, { records, schedTable });
  let plan = planDaily(env.store.getState(), { today: TODAY, deck: fakeDeck() });
  assert.equal(plan.queue.includes('base:甲'), false, 'judged today → excluded');
  assert.equal(plan.queue.includes('base:乙'), true, 'skipped today → can come back');
  assert.equal(policy.answerSeenScope, 'none');
  assert.equal(plan.queue.includes('base:丙'), true, 'answer-seen today → can come back under answerSeenScope none');
  const strict = await policyWith({ answerSeenScope: 'today' });
  plan = planDaily(env.store.getState(), { today: TODAY, deck: fakeDeck(), policy: strict });
  assert.equal(plan.queue.includes('base:丙'), false, 'answerSeenScope today → excluded');

  // 同一天：今天判断过的字即使到期也不再出
  const env2 = makeEnv();
  seed(env2, {
    records: [rec(1, '子', 'judged', 'wrong', '2026-09-01'), rec(2, '子', 'judged', 'wrong', TODAY)],
    schedTable: { 'base:子': sched('2026-09-20') },
  });
  plan = planDaily(env2.store.getState(), { today: TODAY, deck: fakeDeck(LIB, ['base:子']) });
  assert.equal(plan.queue.includes('base:子'), false);
});

test('daily: custom characters not yet written do not enter the daily queue (P33 none)', () => {
  const env = makeEnv();
  seed(env, { custom: { added: [{ char: '甲', at: at(TODAY, 8) }, { char: '乙', at: at(TODAY, 8) }] } });
  const r = startDaily(env.store, { now: env.now, deck: fakeDeck() });
  const q = env.store.getState().sessions.A.queue;
  assert.equal(r.started, true);
  assert.equal(q.includes('base:甲') || q.includes('base:乙'), false);
  assert.deepEqual(q, ['base:丙', 'base:丁', 'base:戊', 'base:己', 'base:庚']);
});

test('daily: at most dailyReviewCap (30) reviews a day, counted on judged records (P03 / P60)', () => {
  const env = makeEnv();
  const records = [];
  const schedTable = {};
  const extra = [];
  // 28 个字今天已复习（以前写过）
  for (let i = 0; i < 28; i += 1) {
    const c = String.fromCodePoint(0x4e00 + 100 + i);
    records.push(rec(1 + i * 2, c, 'judged', 'correct', '2026-09-01'));
    records.push(rec(2 + i * 2, c, 'judged', 'correct', TODAY));
    schedTable['base:' + c] = sched('2026-09-30');
    extra.push('base:' + c);
  }
  // 另 6 个到期字
  for (let i = 0; i < 6; i += 1) {
    const c = String.fromCodePoint(0x4e00 + 300 + i);
    records.push(rec(100 + i, c, 'judged', 'correct', '2026-09-01'));
    schedTable['base:' + c] = sched('2026-09-2' + i);
    extra.push('base:' + c);
  }
  seed(env, { records, schedTable });
  const plan = planDaily(env.store.getState(), { today: TODAY, deck: fakeDeck(LIB, extra) });
  assert.equal(plan.reviewBudgetLeft, 2);
  assert.equal(plan.dueKeys.length, 2, 'only 2 reviews left under the cap of 30');
  assert.equal(plan.queue.length, 5, 'the rest of the group is new characters');
  assert.deepEqual(plan.newKeys, ['base:甲', 'base:乙', 'base:丙']);
});

test('daily: nothing to write → no commit, {empty}; libraryExhausted when every library character has a record', () => {
  const env = makeEnv();
  const records = LIB.map((k, i) => rec(i + 1, k.slice(5), 'judged', 'correct', TODAY));
  const schedTable = Object.fromEntries(LIB.map(k => [k, sched('2026-10-20')]));
  seed(env, { records, schedTable });
  const r = startDaily(env.store, { now: env.now, deck: fakeDeck() });
  assert.equal(r.ok, true);
  assert.equal(r.started, false);
  assert.equal(r.empty, true);
  assert.equal(r.libraryExhausted, true);
  assert.equal(env.commits.length, 0);
  assert.equal(env.store.getState().sessions.A, null);
});

test('daily: an unfinished A is not replaced (occupied); a finished-but-not-ended A is ended in the same commit', () => {
  const env = makeEnv();
  seed(env, { sessions: { A: session({ chars: ['甲', '乙'], cursor: 1 }), B: null, lastEnded: {} } });
  let r = startDaily(env.store, { now: env.now, deck: fakeDeck() });
  assert.equal(r.occupied, true);
  assert.equal(env.commits.length, 0);

  const env2 = makeEnv();
  seed(env2, {
    records: [rec(1, '甲', 'judged', 'correct', TODAY, { sessionId: 's90' })],
    schedTable: { 'base:甲': sched('2026-09-26') },
    sessions: { A: session({ chars: ['甲'], cursor: 1, items: [{ cardKey: 'base:甲', recordId: 'r1', kind: 'judged' }] }), B: null, lastEnded: {} },
  });
  r = startDaily(env2.store, { now: env2.now, deck: fakeDeck() });
  assert.equal(r.started, true);
  const st = env2.store.getState().sessions;
  assert.notEqual(st.A.id, 's90');
  assert.equal(st.A.queue.includes('base:甲'), false, '甲 judged today is not picked again');
  assert.equal(st.lastEnded.A, undefined, 'startInSlot clears lastEnded.A of the slot it opens');
  assert.equal(env2.commits.length, 1);
});

test('daily expires across days (P37 discard): judged records stay, the slot is cleared, a new daily starts in one commit', () => {
  const env = makeEnv();
  seed(env, {
    records: [rec(1, '甲', 'judged', 'correct', YESTERDAY, { sessionId: 's90' })],
    schedTable: { 'base:甲': sched('2026-09-25') },
    sessions: {
      A: session({ chars: ['甲', '乙', '丙'], cursor: 1, day: YESTERDAY, items: [{ cardKey: 'base:甲', recordId: 'r1', kind: 'judged' }] }),
      B: session({ id: 's91', slot: 'B', chars: ['丁'], day: YESTERDAY }),
      lastEnded: {},
    },
  });
  // 同一天不过期
  env.clock.t = at(YESTERDAY, 22);
  assert.deepEqual(expireStale(env.store, { now: env.now }), { ok: true, expired: [] });
  assert.equal(env.commits.length, 0);
  // 第二天
  env.clock.t = at(TODAY, 7);
  const res = resumeSlot(env.store, 'A', { now: env.now });
  assert.equal(res.ok, true);
  assert.equal(res.session, null);
  assert.deepEqual(res.expired.map(s => s.id), ['s90']);
  const st = env.store.getState();
  assert.equal(st.sessions.A, null);
  assert.equal(st.sessions.B.id, 's91', 'picked B does not expire (P61 never)');
  assert.equal(recordsOf(st).length, 1, 'the judged record stays');
  assert.deepEqual(env.commits, ['session:expire']);
  const r = startDaily(env.store, { now: env.now, deck: fakeDeck() });
  assert.equal(r.started, true);
  assert.equal(env.store.getState().sessions.A.startedDay, TODAY);
  assert.equal(resumableSession(env.store.getState(), 'A', { now: env.now }).id, env.store.getState().sessions.A.id);
  assert.equal(resumableSession(env.store.getState(), 'A', { now: at('2026-09-25', 7) }), null, 'would expire tomorrow');
  assert.equal(resumableSession(env.store.getState(), 'B', { now: at('2026-09-25', 7) }).id, 's91', 'B never expires');

  // 过期与开新组在一次 commit 里
  const env2 = makeEnv(at(TODAY, 7));
  seed(env2, { sessions: { A: session({ chars: ['甲', '乙'], day: YESTERDAY }), B: null, lastEnded: {} } });
  const r2 = startDaily(env2.store, { now: env2.now, deck: fakeDeck() });
  assert.equal(r2.started, true);
  assert.deepEqual(env2.commits, ['session:start-daily']);
  assert.equal(env2.store.getState().sessions.lastEnded.A, undefined, 'discard: not kept for a result page');
});

// ---------------------------------------------------------------- 这次选的字（B）与 S02

test('picked: free slot → one commit; source kept; duplicates and non-practicable characters dropped', () => {
  const env = makeEnv();
  seed(env);
  const r = startPicked(env.store, { keys: ['甲', '乙', '甲', 'base:丙', '鲜'], source: { view: 'library' }, deck: fakeDeck() });
  assert.equal(r.started, true);
  const b = env.store.getState().sessions.B;
  assert.deepEqual(b.queue, ['base:甲', 'base:乙', 'base:丙']);
  assert.deepEqual(b.source, { view: 'library' });
  assert.equal(b.kind, 'picked');
  assert.deepEqual(env.commits, ['session:start-picked']);
  assert.throws(() => startPicked(env.store, { keys: ['鲜'], deck: fakeDeck() }), /no practicable/);
});

test('picked while the old B is unfinished → no write, S02 data lists the unwritten characters (R-H05)', () => {
  const env = makeEnv();
  const old = session({ id: 's91', slot: 'B', chars: ['额', '鲜', '境'], cursor: 1, items: [{ cardKey: 'base:额', recordId: 'r1', kind: 'judged' }] });
  seed(env, {
    records: [rec(1, '额', 'judged', 'correct', TODAY, { sessionId: 's91' })],
    schedTable: { 'base:额': sched('2026-09-26') },
    sessions: { A: null, B: old, lastEnded: {} },
  });
  const r = startPicked(env.store, { keys: ['甲'], deck: fakeDeck() });
  assert.equal(r.ok, true);
  assert.equal(r.started, false);
  assert.deepEqual(r.s02.unwrittenChars, ['鲜', '境']);
  assert.equal(r.s02.judgedCount, 1);
  assert.deepEqual(s02Data(env.store.getState()), r.s02);
  assert.equal(env.commits.length, 0);
});

test('S02 end-and-start: single commit; old B endedEarly into lastEnded.B; toast only when the old B had judgments (P38)', () => {
  // 有判断
  const env = makeEnv();
  seed(env, {
    records: [rec(1, '额', 'judged', 'correct', TODAY, { sessionId: 's91' })],
    schedTable: { 'base:额': sched('2026-09-26') },
    sessions: {
      A: session({ chars: ['子'] }),
      B: session({ id: 's91', slot: 'B', chars: ['额', '鲜'], cursor: 1, items: [{ cardKey: 'base:额', recordId: 'r1', kind: 'judged' }] }),
      lastEnded: {},
    },
  });
  const beforeA = env.store.getState().sessions.A;
  let r = endOldAndStartPicked(env.store, { keys: ['甲', '乙'], source: { view: 'home' }, deck: fakeDeck() });
  assert.equal(r.ok, true);
  assert.deepEqual(env.commits, ['session:end-and-start-picked'], 'exactly one commit');
  let st = env.store.getState().sessions;
  assert.deepEqual(st.B.queue, ['base:甲', 'base:乙']);
  assert.equal(st.lastEnded.B.id, 's91');
  assert.equal(st.lastEnded.B.endedEarly, true);
  assert.equal(typeof st.lastEnded.B.endedAt, 'number');
  assert.deepEqual(r.notice, { kind: 'oldGroupSaved', judgedCount: 1 });
  assert.equal(r.showOldResult, false);
  assert.deepEqual(st.A, beforeA, 'slot A untouched (D05)');
  assert.equal(recordsOf(env.store.getState()).length, 1, 'judged record kept; unwritten 鲜 adds nothing');

  // 零判断
  const env2 = makeEnv();
  seed(env2, { sessions: { A: null, B: session({ id: 's91', slot: 'B', chars: ['额', '鲜'] }), lastEnded: {} } });
  r = endOldAndStartPicked(env2.store, { keys: ['甲'], deck: fakeDeck() });
  assert.equal(r.ok, true);
  assert.equal(r.notice, null);
  st = env2.store.getState().sessions;
  assert.equal(st.lastEnded.B.endedEarly, true);
  assert.equal(recordsOf(env2.store.getState()).length, 0);
});

test('S02 end-and-start: a failed write publishes nothing (D07) and a retry succeeds once', () => {
  const env = makeEnv();
  seed(env, { sessions: { A: null, B: session({ id: 's91', slot: 'B', chars: ['额', '鲜'] }), lastEnded: {} } });
  const before = JSON.stringify(env.store.getState().sessions);
  env.storage.failNextWrite(1, { kind: 'generic' });
  let r = endOldAndStartPicked(env.store, { keys: ['甲'], deck: fakeDeck() });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(env.store.getState().sessions), before, 'old B still in place, no new B');
  r = endOldAndStartPicked(env.store, { keys: ['甲'], deck: fakeDeck() });
  assert.equal(r.ok, true);
  assert.equal(env.store.getState().sessions.B.queue[0], 'base:甲');
  assert.equal(env.store.getState().sessions.lastEnded.B.id, 's91');
});

test('picked: a finished-but-not-ended B gives no S02 and is ended in the same commit', () => {
  const env = makeEnv();
  seed(env, {
    records: [rec(1, '额', 'judged', 'correct', TODAY, { sessionId: 's91' })],
    schedTable: { 'base:额': sched('2026-09-26') },
    sessions: { A: null, B: session({ id: 's91', slot: 'B', chars: ['额'], cursor: 1, items: [{ cardKey: 'base:额', recordId: 'r1', kind: 'judged' }] }), lastEnded: {} },
  });
  assert.equal(s02Data(env.store.getState()), null);
  const r = startPicked(env.store, { keys: ['甲'], deck: fakeDeck() });
  assert.equal(r.started, true);
  assert.deepEqual(env.commits, ['session:start-picked']);
});

// ---------------------------------------------------------------- data/deck.js

test('deck.js: cards from the injected SEED, library membership, SEED order as new-character order, default library', async () => {
  const row = (target, rank, norm, edu = null) => ({
    py: 'x', hint: '', ans: target, ci: 0, target, rank, strokes: 3, parts: 1, topic: 't', d: 50, band: '基础', edu, common: 1, norm, std: 0, ctx: 'dict',
  });
  setDeckSource({ seed: [row('的', 1, '一级', '表一'), row('尴', 2, '一级'), row('嚏', 3, '二级'), row('一', 4, '一级', '表一')], overrides: {} });
  try {
    const d = await loadDeck();
    assert.equal(d.cards.length, 4);
    assert.equal(getDeck(), d);
    assert.equal(allCards().length, 4);
    assert.equal(cardForKey('base:嚏').norm, '二级');
    assert.equal(cardForKey('custom:嚏'), null);
    assert.equal(cardForKey('base:鲜'), null);
    assert.equal(DEFAULT_LIBRARY_ID, 'core3500');
    assert.equal(DEFAULT_LIBRARY_ID, policy.defaultLibrary, 'DEFAULT_LIBRARY_ID comes from policy.defaultLibrary (P73)');
    assert.equal(currentLibraryId(null), 'core3500');
    assert.equal(currentLibraryId({ library: 'nope' }), 'core3500');
    assert.equal(currentLibraryId({ library: 'adv3000' }), 'adv3000');
    assert.deepEqual(libraryOf('core3500').keys, ['base:的', 'base:尴', 'base:一']);
    assert.deepEqual(libraryOf('curriculum2500').keys, ['base:的', 'base:一']);
    assert.equal(libraryOf('nope'), null);
    assert.deepEqual(libraryIdsOfKey('base:的'), ['core3500', 'curriculum2500']);
    assert.deepEqual(deckAdapter.newCandidates('adv3000'), ['base:嚏']);
    assert.equal(deckAdapter.practicable('base:一'), true);
    assert.equal(deckAdapter.practicable('base:鲜'), false);
    setCardResolver(key => (key === 'base:鲜' ? { target: '鲜', chars: ['鲜'] } : undefined));
    assert.equal(cardForKey('base:鲜').target, '鲜');
    assert.equal(cardForKey('base:的').target, '的', 'undefined from the resolver falls back to the deck');
  } finally {
    setCardResolver(null);
    setDeckSource(null);
  }
  assert.equal(getDeck(), null, 'no SEED global in node → not loaded');
  await assert.rejects(loadDeck(), /deck is not available/);
});

test('deck.js via prompt.js: the M1-8 import path re-exports the same cardForKey / setCardResolver', async () => {
  const prompt = await import('../../src/ui/screens/write/prompt.js');
  const deck = await import('../../src/data/deck.js');
  assert.equal(prompt.cardForKey, deck.cardForKey);
  assert.equal(prompt.setCardResolver, deck.setCardResolver);
  assert.equal(prompt.indexCards, deck.indexCards);
});

test('S02 body names the unwritten characters (R-H05)', async () => {
  const { s02Body, quoteChars } = await import('../../src/ui/screens/session/s02.js');
  assert.equal(quoteChars(['鲜', '境']), '「鲜」「境」');
  assert.equal(s02Body(['鲜', '境']), '上一组还有「鲜」「境」没写。');
  assert.equal(s02Body(['鲜']), '上一组还有「鲜」没写。');
});

// ---------------------------------------------------------------- 阶段 1 P1-E4：D38 首练之后的第一组、D41 热身字、D40 特别组

test('after the first practice (尴 赢 拾) the first daily group is 1 warm-up char at the head + 4 new chars, nothing to review yet (D28 / D41)', () => {
  const env = makeEnv();
  const day0 = TODAY;
  const records = ['尴', '赢', '拾'].map((c, i) => rec(i + 1, c, 'judged', i === 0 ? 'wrong' : 'correct', day0, { sessionId: 's1' }));
  seed(env, { records, schedTable: Object.fromEntries(['尴', '赢', '拾'].map(c => ['base:' + c, sched('2026-09-25')])) });
  const deck = {
    newCandidates: () => ['base:酱', 'base:酝', 'base:尴', 'base:嚷', 'base:痒', 'base:酿', 'base:罐'],
    warmupCandidates: () => ['base:春', 'base:窗'],
    practicable: () => true,
    currentLibraryId: () => 'core3500',
  };
  const plan = planDaily(env.store.getState(), { today: TODAY, deck });
  assert.deepEqual(plan.queue, ['base:春', 'base:酱', 'base:酝', 'base:嚷', 'base:痒'], 'warm-up first; 尴 is already written so it is not new');
  assert.deepEqual(plan.warmKeys, ['base:春']);
  assert.equal(plan.dueKeys.length, 0);
  assert.equal(plan.special, null);
  // 第 2 天：三个首练字到期（尴写错、赢拾写对 Good/Easy 都是明天起）→ 复习 + 新字混合，没有「的 一 是」
  const day2 = '2026-09-25';
  const env2 = makeEnv(at(day2, 20));
  seed(env2, { records, schedTable: Object.fromEntries(['尴', '赢', '拾'].map(c => ['base:' + c, sched('2026-09-25')])) });
  const plan2 = planDaily(env2.store.getState(), { today: day2, deck });
  assert.equal(plan2.dueKeys.length, 3);
  assert.ok(plan2.newKeys.length >= 1 && plan2.newKeys.length <= 3);
  assert.equal(plan2.queue.length, 5);
  assert.equal(plan2.queue.slice(0, 1)[0], 'base:春', 'the warm-up char is still allowed within 7 days');
});

test('startDaily opens the D40 special group as an ordinary daily session: one commit, queue 壹贰叁肆伍, then 陆柒捌玖拾 next', () => {
  const env = makeEnv();
  const records = [];
  for (let g = 1; g <= 10; g += 1) {
    records.push(rec(g, String.fromCodePoint(0x6200 + g), 'judged', 'correct', `2026-09-${String(13 + g).padStart(2, '0')}`, { sessionId: 's' + g }));
  }
  seed(env, { records });
  const deck = { newCandidates: () => ['base:亦', 'base:鲜'], practicable: () => true, currentLibraryId: () => 'core3500' };
  const r = startDaily(env.store, { now: env.now, deck });
  assert.equal(r.started, true);
  assert.equal(r.plan.special.kind, 'capital1');
  const s = env.store.getState().sessions.A;
  assert.equal(s.kind, 'daily');
  assert.deepEqual(s.queue, ['base:壹', 'base:贰', 'base:叁', 'base:肆', 'base:伍']);
  assert.deepEqual(env.commits, ['session:start-daily']);
});
