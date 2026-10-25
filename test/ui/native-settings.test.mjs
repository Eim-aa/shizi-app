// B3.10 原生提醒页的契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4「网页路径 == API 路径」）：
//   1. view.remind = 网页提醒页渲染用的同一个模型函数（remindView），渲染出的字一字不差；
//   2. 写入 op（remind.enabled / remind.time / reminder.status）调的是网页同一批函数：同一组输入分别走两条路，
//      整份 store deepEqual、commit 序列相同；D07：写失败回 {ok:false, error:{kind}}、store 不动，重试只记一次；
//   3. reminder.plan = 网页 syncReminder 发的同一份提醒内容（题目、天数、时间），只是文案给引用而不是句子；
//   4. 提醒的写入函数本体在会话层（src/session/views/settings.js），网页 prefs.js 转出的是同一个函数对象。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../store/helpers.mjs';
import { bootStore } from '../../src/store/store.js';
import { setClockOverride } from '../../src/platform/env.js';
import { createAppApi } from '../../src/session/api/index.js';
import { remindView, commitRemindEnabled, commitRemindTime, applyReminderStatus, commitSettings, remindOf } from '../../src/session/views/settings.js';
import * as prefs from '../../src/ui/screens/mine/prefs.js';
import { t, tRef } from '../../src/config/copy/index.js';
import { reminderPayload } from '../../src/core/reminder.js';

const NOW = '2026-10-05T19:30:00';

// 两条路径（网页函数 / App API）各自 boot 一次；把 Date.now 冻在同一瞬间，两条路径的写入时刻逐字相同。
const REAL_NOW = Date.now;
const FROZEN_NOW = REAL_NOW.call(Date);
Date.now = () => FROZEN_NOW;

/** 一套干净的 store（每条路径各一套，同一时钟）。 */
function boot(seed) {
  setClockOverride(NOW);
  let storage = null;
  const { store } = bootStore({ backend: new MemoryStorage(), onStorage: s => { storage = s; } });
  if (seed) seed(store);
  const labels = [];
  store.subscribe((state, info) => { if (info && info.type === 'commit') labels.push(info.label); });
  const api = createAppApi({ getStore: () => store });
  return { store, storage, labels, api };
}

test('B3.10 the remind write functions live in the session layer; the web page re-exports the very same functions', () => {
  assert.equal(prefs.commitRemindEnabled, commitRemindEnabled, 'same function object');
  assert.equal(prefs.commitRemindTime, commitRemindTime, 'same function object');
  assert.equal(prefs.commitSettings, commitSettings, 'same function object');
  assert.equal(prefs.remindOf, remindOf, 'same function object');
});

test('B3.10 view.remind = the web remind model, rendered word for word', () => {
  const { api, store } = boot();
  const v = api.call('view.remind').view;
  assert.deepEqual(v, remindView(store.getState().settings), 'same function');
  // 开关关着：R-S01 的小字、没有时间行
  assert.equal(tRef(v.remindPage.sub.on), t('R-S01.remindNote'));
  assert.equal(tRef(v.remindPage.sub.denied), t('R-S02.title'));
  assert.equal(v.on, false);
  assert.equal(v.denied, false);
  assert.equal(v.remindPage.time, null);
  // 开着：多一行「提醒时间」，值是 'HH:MM'
  assert.equal(api.call('remind.enabled', { on: true }).ok, true);
  const v2 = api.call('view.remind').view;
  assert.equal(v2.on, true);
  assert.equal(v2.remindPage.time, '20:00', 'P18 缺省时间');
  assert.equal(tRef(v2.remindPage.timeLabel), t('X-SETTINGS.remindTime'));
  // 通知被手机关掉：R-S02 的小字与说明（网页同一口径）
  assert.equal(api.call('reminder.status', { permission: 'denied' }).ok, true);
  const v3 = api.call('view.remind').view;
  assert.equal(v3.denied, true);
  assert.equal(v3.on, false, 'E3：开关如实显示「现在收不收得到」');
  assert.equal(tRef(v3.remindPage.note.body), t('R-S02.body'));
  assert.equal(tRef(v3.remindPage.note.link), t('R-S02.link'));
  // 三段式的文案
  assert.equal(tRef(v3.remindPage.fail.text), t('X-SETTINGS.saveFailed'));
  assert.equal(tRef(v3.remindPage.fail.cancel), t('X-SETTINGS.cancel'));
  assert.equal(tRef(v3.remindPage.fail.retry), t('X-SETTINGS.retry'));
});

test('B3.10 remind.enabled = web commitRemindEnabled: same store, commits and route', () => {
  const a = boot();
  const web = commitRemindEnabled(a.store, true);
  const b = boot();
  const api = b.api.call('remind.enabled', { on: true });
  assert.equal(api.ok, true);
  assert.equal(web.ok, true);
  assert.deepEqual(b.store.getState(), a.store.getState(), 'whole store deepEqual');
  assert.deepEqual(b.labels, a.labels, 'same commit sequence');
  assert.deepEqual(b.store.getState().settings.remind, { enabled: true, hour: 20, minute: 0 });
});

test('B3.10 remind.time = web commitRemindTime: same store, commits and route', () => {
  const seed = store => store.commit('test-seed', draft => {
    draft.settings = { remind: { enabled: true, hour: 20, minute: 30, permission: 'granted' } };
  });
  const a = boot(seed);
  const web = commitRemindTime(a.store, 7, 5);
  const b = boot(seed);
  const api = b.api.call('remind.time', { hour: 7, minute: 5 });
  assert.equal(api.ok, true);
  assert.equal(web.ok, true);
  assert.deepEqual(b.store.getState(), a.store.getState(), 'whole store deepEqual');
  assert.deepEqual(b.labels, a.labels, 'same commit sequence');
  assert.deepEqual(b.store.getState().settings.remind, { enabled: true, hour: 7, minute: 5, permission: 'granted' });
});

test('B3.10 reminder.status = the web applyReminderStatus write: same store, commits and route', () => {
  const seed = store => store.commit('test-seed', draft => {
    draft.settings = { remind: { enabled: true, hour: 20, minute: 30 } };
  });
  const a = boot(seed);
  const web = applyReminderStatus(a.store, { permission: 'denied' });
  const b = boot(seed);
  const api = b.api.call('reminder.status', { permission: 'denied' });
  assert.equal(api.ok, true);
  assert.equal(web.ok, true);
  assert.deepEqual(b.store.getState(), a.store.getState(), 'whole store deepEqual');
  assert.deepEqual(b.labels, a.labels, 'same commit sequence');
  assert.equal(b.store.getState().settings.remind.permission, 'denied');
});

test('B3.10 D07: a failed write returns {ok:false, error:{kind}}, the store does not move, the retry commits once', () => {
  const { api, store, storage, labels } = boot();
  const before = store.getState();
  storage.failNextWrite(1, { kind: 'generic' });
  const r = api.call('remind.enabled', { on: true });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error.kind, 'string');
  assert.deepEqual(store.getState(), before, 'nothing written');
  assert.deepEqual(labels, []);
  const again = api.call('remind.enabled', { on: true });
  assert.equal(again.ok, true);
  assert.equal(labels.length, 1, 'one commit for the retry');
  assert.equal(store.getState().settings.remind.enabled, true);
});

test('B3.10 reminder.plan = the web syncReminder content (same questions, days and time), given as copy refs', () => {
  const { api, store } = boot();
  const plan = api.call('reminder.plan').plan;
  const web = reminderPayload(store.getState(), { today: '2026-10-05', now: Date.now() });
  assert.equal(plan.enabled, web.enabled);
  assert.equal(plan.hour, web.hour);
  assert.equal(plan.minute, web.minute);
  assert.equal(plan.practicedToday, web.practicedToday);
  assert.equal(plan.questions.length, web.questions.length);
  for (let i = 0; i < plan.questions.length; i += 1) {
    assert.equal(plan.questions[i].day, web.questions[i].day);
    assert.equal(plan.questions[i].targetCardKey, web.questions[i].targetCardKey);
    assert.equal(tRef(plan.questions[i].title), web.questions[i].title, 'same title');
    assert.equal(tRef(plan.questions[i].body), web.questions[i].body, 'same body');
  }
});
