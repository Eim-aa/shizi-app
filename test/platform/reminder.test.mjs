// M5-5：src/platform/reminder.js——提醒内容（P48 写错过优先、其次到期最久；只从到那天为止已到期的字里取；词语遮目标字）、
// syncReminder 消息体形状（与 WebViewController.syncReminder / ReminderQuestion 字段一致）、去重与强制同步、
// 冷启动深链（就绪前排队 → markReady 回放 → 以 B 开该字，P47）、权限回报转交设置页。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMINDER_DAYS, REMINDER_SOURCE_VIEW, affectsReminder, createReminder, maskedWord, normalizeTargetKey, remindOf,
  reminderCandidates, reminderPayload, reminderQuestions,
} from '../../src/platform/reminder.js';
import { createBridge } from '../../src/platform/bridge.js';
import { setDeckSource } from '../../src/data/deck.js';
import { makeRecord } from '../../src/core/records.js';
import * as policy from '../../src/config/policy.js';
import { t } from '../../src/config/copy/index.js';

const TODAY = '2026-09-24';
const AT = new Date(2026, 8, 24, 10).getTime();
const DAY_MS = 24 * 3600 * 1000;

function row(ans, ci, py, extra = {}) {
  const target = Array.from(ans)[ci];
  return { py, hint: '', ans, ci, target, rank: 1, strokes: 3, parts: 1, topic: 't', d: 50, band: '基础', edu: null, common: 1, norm: '一级', std: 0, ctx: 'dict', ...extra };
}

const SEED = [
  row('学习', 1, 'xí'),
  row('天空', 1, 'kōng'),
  row('明白', 1, 'bái'),
  row('人人', 0, 'rén'),
  row('氵', 0, 'shuǐ', { ctx: 'gloss', hint: '三点水' }), // 释义题：没有语境词，不进提醒
  row('大海', 1, 'hǎi'),
  row('山川', 1, 'chuān'),
];

test.before(() => setDeckSource({ seed: SEED, overrides: {} }));
test.after(() => setDeckSource(null));

let serial = 0;
function judged(char, judgment, at) {
  serial += 1;
  return makeRecord({ id: `r${serial}`, cardKey: `base:${char}`, sessionId: 's1', kind: 'judged', judgment, at, help: {} });
}

function stateWith({ records = [], sched = {}, settings = null, wordOff = null } = {}) {
  const months = {};
  for (const r of records) {
    const m = r.localDay.slice(0, 7);
    (months[m] = months[m] || []).push(r);
  }
  return { records: months, sched, settings, wordOff };
}

function entry(due, extra = {}) {
  return { due, fsrs: { stability: 1 }, lastJudgedAt: AT - DAY_MS, ...extra };
}

/** 习 写错过、明天到期；空 写对、4 天前到期（最久）；白 写对、今天到期；海 停练；川 后天之后才到期。 */
function baseState(settings = { remind: { enabled: true, hour: 21, minute: 5 } }) {
  return stateWith({
    records: [
      judged('空', 'correct', AT - 9 * DAY_MS),
      judged('白', 'correct', AT - 5 * DAY_MS),
      judged('习', 'wrong', AT - 2 * DAY_MS),
      judged('海', 'wrong', AT - 2 * DAY_MS),
      judged('川', 'correct', AT - 1 * DAY_MS),
    ],
    sched: {
      'base:习': entry('2026-09-25'),
      'base:空': entry('2026-09-20'),
      'base:白': entry('2026-09-24'),
      'base:海': entry('2026-09-01', { stoppedAt: AT - DAY_MS }),
      'base:川': entry('2026-10-10'),
      'base:鲜': entry('2026-09-01'), // 不在题库：不能练
    },
    settings,
  });
}

test('candidates follow P48: 写错过 first, then the longest overdue; stopped / unpracticable / no-context-word excluded', () => {
  const list = reminderCandidates(baseState());
  assert.deepEqual(list.map(c => [c.cardKey, c.wrong, c.due]), [
    ['base:习', true, '2026-09-25'],
    ['base:空', false, '2026-09-20'],
    ['base:白', false, '2026-09-24'],
    ['base:川', false, '2026-10-10'],
  ]);
  const withGloss = baseState();
  withGloss.sched['base:氵'] = entry('2026-09-01');
  assert.equal(reminderCandidates(withGloss).some(c => c.cardKey === 'base:氵'), false, 'gloss card has no word');
  const off = baseState();
  off.wordOff = { 'base:空': AT };
  assert.equal(reminderCandidates(off).some(c => c.cardKey === 'base:空'), false, '换掉这个词语 → no word left');
  assert.throws(() => reminderCandidates(baseState(), { policy: { ...policy, reminderPick: 'random' } }), /reminderPick/);
});

test('questions: one per day from chars due by that day, 写错过 first, no repeats while others are left', () => {
  const qs = reminderQuestions(baseState(), { today: TODAY });
  assert.equal(REMINDER_DAYS, 8);
  assert.equal(qs.length, 8, 'every day of the window has a due char');
  assert.deepEqual(qs.slice(0, 4).map(q => [q.day, q.targetCardKey]), [
    ['2026-09-24', 'base:空'], // 今天：到期的只有 空（09-20）、白（09-24）；都写对 → 到期最久的 空
    ['2026-09-25', 'base:习'], // 明天：习 到期且写错过 → 排最前
    ['2026-09-26', 'base:白'], // 前两个用过了
    ['2026-09-27', 'base:习'], // 都用过：沿旧版取第一个
  ]);
  const tomorrow = qs[1];
  assert.deepEqual(Object.keys(tomorrow).sort(), ['body', 'day', 'targetCardKey', 'title']);
  assert.equal(tomorrow.title, '学□（xí）', 'word with the target masked + pinyin');
  assert.equal(tomorrow.title, t('X-REMIND.title', { word: '学□', pinyin: 'xí' }));
  assert.equal(tomorrow.body, t('X-REMIND.body'));
  for (const q of qs) for (const k of ['day', 'title', 'body', 'targetCardKey']) assert.ok(q[k], `${k} non-empty (native drops empty fields)`);
  assert.deepEqual(reminderQuestions(stateWith(), { today: TODAY }), [], 'nothing due → no questions');
  assert.throws(() => reminderQuestions(baseState(), { today: '2026-9-24' }), /invalid today/);
});

test('masked word: every position of the target is blanked; policy.reminderWord=word keeps the old whole word', () => {
  const rep = { chars: ['人', '人'], target: '人', word: '人人' };
  assert.equal(maskedWord(rep), '□□');
  assert.equal(maskedWord({ chars: ['学', '习'], target: '习' }, { ...policy, reminderWord: 'word' }), '学习');
  assert.equal(policy.reminderWord, 'blank', 'P48 transitional default');
});

test('payload shape = WebViewController.syncReminder fields; user time; practicedToday from today\'s judged records', () => {
  const st = baseState();
  const p = reminderPayload(st, { today: TODAY });
  assert.deepEqual(Object.keys(p), ['enabled', 'hour', 'minute', 'practicedToday', 'questions']);
  assert.equal(p.enabled, true);
  assert.deepEqual([p.hour, p.minute], [21, 5], 'user-picked time (P18)');
  assert.equal(p.practicedToday, false);
  assert.equal(p.questions[1].day, '2026-09-25');

  const practiced = baseState();
  practiced.records['2026-09'].push(judged('白', 'correct', AT));
  assert.equal(reminderPayload(practiced, { today: TODAY }).practicedToday, true, 'a judged record today');

  const off = reminderPayload(baseState({ remind: { enabled: false } }), { today: TODAY });
  assert.deepEqual(off, { enabled: false, hour: 20, minute: 0, practicedToday: false, questions: [] }, 'off: default time, no questions');
  assert.deepEqual(remindOf(null), { enabled: false, hour: 20, minute: 0, permission: 'unknown' });
});

test('normalizeTargetKey accepts base:/custom:/bare single chars only', () => {
  assert.equal(normalizeTargetKey('base:习'), 'base:习');
  assert.equal(normalizeTargetKey(' 习 '), 'base:习');
  assert.equal(normalizeTargetKey('custom:习'), 'custom:习');
  assert.equal(normalizeTargetKey('base:学习'), null);
  assert.equal(normalizeTargetKey(42), null);
  assert.equal(normalizeTargetKey(''), null);
});

function fakeWin() {
  const sent = [];
  const timers = [];
  const win = {
    webkit: { messageHandlers: { shiziNative: { postMessage: msg => sent.push(JSON.parse(JSON.stringify(msg))) } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
  };
  return { win, sent, timers };
}

function fakeStore(state) {
  const store = { state, subs: [], getState: () => store.state, subscribe: fn => { store.subs.push(fn); return () => {}; } };
  return store;
}

test('controller: sync posts {type:syncReminder,…}; identical content is not re-sent unless forced; nothing outside the shell', () => {
  const { win, sent, timers } = fakeWin();
  const b = createBridge(win);
  const store = fakeStore(baseState());
  const c = createReminder({ getStore: () => store, bridge: b, win, now: () => AT });
  const p = c.sync();
  assert.ok(p, 'first sync sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'syncReminder');
  assert.deepEqual(Object.keys(sent[0]).sort(), ['enabled', 'hour', 'minute', 'practicedToday', 'questions', 'type']);
  assert.equal(sent[0].questions[1].title, '学□（xí）');
  assert.equal(c.sync(), null, 'same content → not re-sent');
  assert.ok(c.sync({ force: true }), 'forced (settings page) → sent');
  assert.equal(sent.length, 2);

  c.scheduleSync();
  assert.equal(timers.length, 1);
  store.state = baseState({ remind: { enabled: true, hour: 7, minute: 30 } });
  timers[0].fn();
  assert.deepEqual([sent.at(-1).hour, sent.at(-1).minute], [7, 30], 'debounced resync picks up the change');

  const offStore = fakeStore(baseState({ remind: { enabled: false } }));
  const c2 = createReminder({ getStore: () => offStore, bridge: createBridge(fakeWin().win), now: () => AT });
  assert.equal(c2.sync(), null, 'never sent + off → nothing to clear');

  const web = createBridge({});
  const c3 = createReminder({ getStore: () => store, bridge: web, win: {}, now: () => AT });
  assert.equal(c3.sync({ force: true }), null, 'not in the native shell → postNative false');
});

test('cold-start deep link: queued before ready, replayed once (last cardKey only) after markReady → startPicked as B (P47)', () => {
  const { win } = fakeWin();
  const b = createBridge(win);
  const opened = [];
  const store = fakeStore(baseState());
  const c = createReminder({
    getStore: () => store, bridge: b, win, now: () => AT,
    startPicked: (keys, o) => { opened.push({ keys, o }); return { ok: true, opened: 'new' }; },
  });
  // 原生在页面加载完就调用：此时 store / 界面还没好
  assert.equal(win.shiziOpenReminderTarget('base:空'), true, 'received (queued)');
  assert.equal(win.shiziOpenReminderTarget('base:习'), true);
  b.registerNativeHandler('shiziOpenReminderTarget', key => c.openTarget(key));
  assert.deepEqual(opened, [], 'not delivered before ready');
  assert.deepEqual(b.pending().map(p => p.args[0]), ['base:习'], 'only the last cardKey is kept');
  assert.equal(b.markReady(store), true);
  assert.deepEqual(opened, [{ keys: ['base:习'], o: { source: { view: REMINDER_SOURCE_VIEW, char: '习' } } }]);
  assert.equal(policy.reminderOpens, 'picked-s02');

  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(c.openTarget('base:鲜').ok, false, 'not in the deck → not opened');
    assert.equal(c.openTarget('base:学习').ok, false);
  } finally {
    console.warn = warn;
  }
  assert.equal(opened.length, 1);
});

test('permission report is handed to the settings page (applyReminderStatus) with the live store', () => {
  const { win } = fakeWin();
  const b = createBridge(win);
  const store = fakeStore(baseState());
  const got = [];
  const c = createReminder({ getStore: () => store, bridge: b, win, applyReminderStatus: (s, p) => { got.push([s, p]); return { ok: true }; } });
  b.registerNativeHandler('shiziReminderStatus', payload => c.receiveStatus(payload));
  win.shiziReminderStatus({ permission: 'denied' });
  assert.deepEqual(got, [], 'queued until ready');
  b.markReady(store);
  assert.equal(got.length, 1);
  assert.equal(got[0][0], store);
  assert.deepEqual(got[0][1], { permission: 'denied' });
  assert.equal(c.queryStatus(), true);
});

test('affectsReminder: records / sched / settings / wordOff writes and replacements; not session strokes or status', () => {
  assert.equal(affectsReminder({ type: 'commit', keys: ['shizi.v2.records.2026-09', 'shizi.v2.sessions'] }), true);
  assert.equal(affectsReminder({ type: 'commit', keys: ['shizi.v2.sched'] }), true);
  assert.equal(affectsReminder({ type: 'commit', keys: ['shizi.v2.settings'] }), true);
  assert.equal(affectsReminder({ type: 'commit', keys: ['shizi.v2.wordOff'] }), true);
  assert.equal(affectsReminder({ type: 'commit', keys: ['shizi.v2.sessions'] }), false);
  assert.equal(affectsReminder({ type: 'commit', keys: [], replace: true }), true);
  assert.equal(affectsReminder({ type: 'load' }), true);
  assert.equal(affectsReminder({ type: 'status' }), false);
  assert.equal(affectsReminder(null), false);
});
