// 偏好设置的读写（prefs.js，原「设置」页的逻辑部分）与提醒页 / 外观弹层视图（D63）：显示值补缺省（P18 / P51 / P73）、一次 commit 只改 settings 且保留其余字段
// （真 store + 内存 Storage + 故障注入）、提醒开关补缺省时间与权限回报、外观应用到 <html>（platform/appearance.js，假 document）。
// P1-E6（D29，覆盖 P59）：「更大字体」开关删除，settings.large 不再生效；v1 迁移带来的 large=true 静默去掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  settingsView, parseTime, timeText, defaultRemindTime, commitSettings, commitAppearance,
  commitRemindEnabled, commitRemindTime, applyReminderStatus, setReminderSync, LABELS,
  APPEARANCE_ORDER, textSizeNoticeDue, commitTextSizeNoticeShown, clearLegacyLargeFlag, commitGroupSize,
} from '../../src/ui/screens/mine/prefs.js';
import { planDaily, startNextA } from '../../src/core/session-start.js';
import { RemindBody, REMIND_SCREEN } from '../../src/ui/screens/mine/remind.js';
import { AppearanceSheetView } from '../../src/ui/screens/mine/appearance.js';
import { appearanceOf, applyAppearance, startAppearance } from '../../src/platform/appearance.js';
import { getScreen } from '../../src/ui/router.js';
import * as policy from '../../src/config/policy.js';
import { createStore } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { KEYS } from '../../src/core/schema.js';
import { t } from '../../src/config/copy/index.js';
import { MemoryStorage } from '../store/helpers.mjs';

const NOW = new Date(2026, 8, 24, 12).getTime();

function freshStore() {
  const backend = new MemoryStorage();
  const storage = createStorage(backend, { now: () => NOW });
  const store = createStore({ storage, now: () => NOW });
  store.load();
  return { store, storage, backend };
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(n => walk(n, visit));
    return;
  }
  visit(node);
  walk(node.props && node.props.children, visit);
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props && node.props.children);
}

/** 函数组件展开一层（SettingsBody 里 Group / SwitchRow 等是本地组件，视图测试要看到它们画出的东西）。 */
function expand(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expand);
  if (typeof node.type === 'function' && !/^(Button|Sheet)$/.test(node.type.name)) return expand(node.type(node.props));
  if (node.props && node.props.children !== undefined) {
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  return node;
}

function allByTestid(vnode) {
  const out = {};
  walk(vnode, n => {
    const id = n.props && n.props['data-testid'];
    if (id) (out[id] = out[id] || []).push(n);
  });
  return out;
}

class FakeRoot {
  constructor() {
    this.attrs = new Map();
    this.writes = 0;
  }
  hasAttribute(k) { return this.attrs.has(k); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.writes += 1; this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.writes += 1; this.attrs.delete(k); }
}
const fakeDoc = () => ({ documentElement: new FakeRoot() });

// ---------------------------------------------------------------- 纯函数

test('settingsView: defaults — P73 library, remind off at policy.remindDefault (P18), auto; no large field (D29)', () => {
  const v = settingsView(null);
  assert.equal(v.library, policy.defaultLibrary);
  assert.equal(v.libraryName, '常用字');
  assert.ok(!('sound' in v) && !('writeMode' in v), 'D63: no 声音 / 写字方式 in the view');
  assert.deepEqual(v.remind, { enabled: false, hour: 20, minute: 0, permission: 'unknown' });
  assert.equal(v.denied, false);
  assert.ok(!('large' in v), 'D29: the view no longer carries the in-app large switch');
  assert.equal(v.appearance, 'auto');
  assert.equal(v.appearanceSwitch, true, 'P51 features.appearanceSwitch');

  const w = settingsView({ library: 'curriculum2500', sound: false, writeMode: 'paper', remind: { enabled: true, hour: 7, minute: 5, permission: 'denied' }, large: true, appearance: 'dark' });
  assert.equal(w.libraryName, '课本字');
  assert.deepEqual(w.remind, { enabled: true, hour: 7, minute: 5, permission: 'denied' });
  assert.equal(w.denied, true);
  assert.equal(w.on, false, 'E3: denied by the phone → the switch shows off even though the stored choice is on');
  assert.equal(v.on, false);
  assert.equal(settingsView({ remind: { enabled: true, permission: 'granted' } }).on, true);
  assert.equal(settingsView({ remind: { enabled: true } }).on, true, 'unknown permission (not asked yet) → shows the choice');
  assert.equal(settingsView({ remind: { enabled: false, permission: 'granted' } }).on, false);
  assert.ok(!('large' in w), 'a stored large=true is read without error but has no effect (D29)');
  assert.equal(w.appearance, 'dark');
  assert.equal(settingsView({ library: 'nope' }).library, policy.defaultLibrary, 'unknown library → P73 default');
  const off = settingsView({ appearance: 'dark' }, { p: { ...policy, features: { ...policy.features, appearanceSwitch: false } } });
  assert.equal(off.appearance, 'auto', 'appearanceSwitch off → follow the system');
  assert.equal(off.appearanceSwitch, false);
});

test('time helpers', () => {
  assert.deepEqual(parseTime('20:00'), { hour: 20, minute: 0 });
  assert.deepEqual(parseTime('7:05'), { hour: 7, minute: 5 });
  assert.equal(parseTime('24:00'), null);
  assert.equal(parseTime(''), null);
  assert.equal(timeText(7, 5), '07:05');
  assert.deepEqual(defaultRemindTime({ remindDefault: 'bad' }), { hour: 20, minute: 0 });
  assert.deepEqual(defaultRemindTime(), { hour: 20, minute: 0 });
});

// ---------------------------------------------------------------- 写入

test('commitSettings: one commit writes only settings; keeps other fields; failure publishes nothing; retry works; no-op skips the write', () => {
  const { store, storage, backend } = freshStore();
  assert.equal(store.seed({ settings: { library: 'adv3000' }, custom: { added: [{ char: '永', at: NOW }] } }).ok, true);
  const customRaw = JSON.stringify(store.getState().custom);

  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.settings });
  const fail = commitSettings(store, 'settings:t', { appearance: 'light' });
  assert.equal(fail.ok, false, 'failure reported');
  assert.deepEqual(store.getState().settings, { library: 'adv3000' }, 'nothing published');
  assert.deepEqual(JSON.parse(backend.getItem(KEYS.settings)), { library: 'adv3000' }, 'storage rolled back');

  const ok = commitSettings(store, 'settings:t', { appearance: 'light' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.keys, [KEYS.settings], 'only the settings key');
  assert.deepEqual(store.getState().settings, { library: 'adv3000', appearance: 'light' });
  assert.equal(JSON.stringify(store.getState().custom), customRaw, 'custom untouched');

  const w = backend.writeCount;
  const same = commitSettings(store, 'settings:t', { appearance: 'light' });
  assert.equal(same.ok, true);
  assert.equal(same.skipped, true);
  assert.equal(backend.writeCount, w, 'unchanged value → no storage write');

  assert.equal(commitAppearance(store, 'dark').ok, true);
  assert.deepEqual(store.getState().settings, { library: 'adv3000', appearance: 'dark' });
  assert.throws(() => commitAppearance(store, 'sepia'), RangeError);
  assert.equal(LABELS.appearance, 'settings:appearance');
});

test('每组字数（D65 ②）：settingsView 缺省 20；commitGroupSize 经 store.commit 只改 settings.groupSize；不认识的值拒绝；下一组按新值、开着的组不变', () => {
  const { store } = freshStore();
  assert.equal(settingsView(null).groupSize, 20);
  assert.equal(settingsView({ groupSize: 7 }).groupSize, 20);
  assert.equal(commitGroupSize(store, 10).ok, true);
  assert.deepEqual(store.getState().settings, { groupSize: 10 });
  assert.equal(settingsView(store.getState().settings).groupSize, 10);
  assert.equal(commitGroupSize(store, 10).skipped, true, 'same value → no write');
  assert.throws(() => commitGroupSize(store, 15), RangeError);
  assert.throws(() => commitGroupSize(store, '20'), RangeError);
  assert.equal(LABELS.groupSize, 'settings:group-size');
  // 开组：字库里取字的假题库（够 40 个新字）
  const keys = [...'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往'].map(c => 'base:' + c);
  const deck = { newCandidates: () => keys, practicable: k => keys.includes(k) };
  const today = '2026-09-24';
  // 先有一次判断（不是首练）
  const seeded = store.commit('t:seed', d => {
    d.records = { '2026-09': [{ id: 'r1', cardKey: 'base:尴', char: '尴', sessionId: 's9', kind: 'judged', judgment: 'correct', at: NOW - 86400000, localDay: '2026-09-23', help: { hints: 0, answerSeen: false, traced: false } }] };
  });
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  assert.equal(planDaily(store.getState(), { today, deck }).queue.length, 10);
  const opened = startNextA(store, { now: () => NOW, deck });
  assert.equal(opened.ok, true);
  assert.equal(store.getState().sessions.A.kind, 'daily', JSON.stringify(opened).slice(0, 300));
  assert.equal(store.getState().sessions.A.queue.length, 10);
  assert.equal(commitGroupSize(store, 30).ok, true);
  assert.equal(store.getState().sessions.A.queue.length, 10, 'the open group keeps its size');
  assert.equal(planDaily(store.getState(), { today, deck }).queue.length, 30, 'the next group uses the new size');
});

test('commitSettings on an empty store creates settings with the one field (schema-valid)', () => {
  const { store } = freshStore();
  assert.equal(store.getState().settings, null);
  const r = commitSettings(store, 'settings:t', { appearance: 'auto' });
  assert.equal(r.ok, true, 'writes even when the value equals the default (settings was null)');
  assert.deepEqual(store.getState().settings, { appearance: 'auto' });
});

test('remind: enabling fills the P18 default time once; time change and permission keep the other remind fields; sync hook called', () => {
  const { store } = freshStore();
  const synced = [];
  setReminderSync(remind => synced.push(remind));
  try {
    assert.equal(commitRemindEnabled(store, true).ok, true);
    assert.deepEqual(store.getState().settings.remind, { enabled: true, hour: 20, minute: 0 });
    assert.equal(commitRemindTime(store, 7, 30).ok, true);
    assert.deepEqual(store.getState().settings.remind, { enabled: true, hour: 7, minute: 30 });
    assert.equal(commitRemindEnabled(store, false).ok, true);
    assert.equal(commitRemindEnabled(store, true).ok, true);
    assert.deepEqual(store.getState().settings.remind, { enabled: true, hour: 7, minute: 30 }, 'the chosen time is kept');

    const r = applyReminderStatus(store, { permission: 'denied' });
    assert.equal(r.ok, true);
    assert.deepEqual(store.getState().settings.remind, { enabled: true, hour: 7, minute: 30, permission: 'denied' });
    assert.equal(settingsView(store.getState().settings).denied, true);
    assert.deepEqual(synced, [{ enabled: true, hour: 7, minute: 30, permission: 'denied' }], 'permission change re-syncs');
    applyReminderStatus(store, { permission: 'denied' });
    assert.equal(synced.length, 1, 'same permission → no write, no sync');
    applyReminderStatus(store, { permission: 'weird' });
    assert.equal(store.getState().settings.remind.permission, 'unknown', 'unknown values normalise to unknown');
  } finally {
    setReminderSync(null);
  }
});

// ---------------------------------------------------------------- 外观（platform/appearance.js）

test('appearance: auto removes data-theme, light / dark force it; large=true no longer sets data-large (D29); switch off → auto', () => {
  const doc = fakeDoc();
  const root = doc.documentElement;
  applyAppearance({ appearance: 'dark', large: true }, { doc });
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(root.hasAttribute('data-large'), false, 'settings.large has no effect: text size follows the system (P130)');
  applyAppearance({ appearance: 'light' }, { doc });
  assert.equal(root.getAttribute('data-theme'), 'light');
  applyAppearance(null, { doc });
  assert.equal(root.hasAttribute('data-theme'), false, 'auto → attribute removed (tokens.css follows prefers-color-scheme)');
  assert.deepEqual(appearanceOf({ appearance: 'dark' }, { features: { appearanceSwitch: false } }), { theme: 'auto' });
  assert.deepEqual(appearanceOf({ appearance: 'bogus', large: true }), { theme: 'auto' });
});

test('startAppearance: applies stored settings at start; re-applies only when appearance changes', () => {
  const { store } = freshStore();
  assert.equal(store.seed({ settings: { appearance: 'dark', large: true } }).ok, true);
  const doc = fakeDoc();
  const root = doc.documentElement;
  const off = startAppearance(store, { doc });
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(root.hasAttribute('data-large'), false, 'a stored large=true is not applied (D29)');

  // 别处手动改的属性：不相关的写入不碰 <html>
  root.setAttribute('data-theme', 'light');
  const writes = root.writes;
  assert.equal(commitSettings(store, 'settings:t', { library: 'adv3000' }).ok, true);
  assert.equal(root.writes, writes, 'an unrelated write does not touch <html>');
  assert.equal(root.getAttribute('data-theme'), 'light');

  assert.equal(commitAppearance(store, 'auto').ok, true);
  assert.equal(root.hasAttribute('data-theme'), false, 'appearance change applied');
  off();
  assert.equal(commitAppearance(store, 'dark').ok, true);
  assert.equal(root.hasAttribute('data-theme'), false, 'unsubscribed');
  assert.doesNotThrow(() => startAppearance(null, { doc, getStore: () => { throw new Error('not booted'); } })());
});

// ---------------------------------------------------------------- 视图

function remindBody(view, extra = {}) {
  const noop = () => {};
  const on = new Proxy({}, { get: () => noop });
  return expand(RemindBody({ view, on, ...extra }));
}

test('RemindBody: switch row with R-S01 note; time row only when on; copy', () => {
  const ids = allByTestid(remindBody(settingsView(null)));
  assert.equal(ids['remind-switch'][0].props.role, 'switch');
  assert.equal(ids['remind-switch'][0].props['aria-checked'], 'false');
  assert.equal(textOf(ids['remind-sub'][0]), t('R-S01.remindNote'));
  assert.ok(!ids['remind-time'], 'no time row while reminders are off');
  assert.ok(!ids['remind-denied'] && !ids['remind-fail']);
  assert.equal(REMIND_SCREEN, 'remind');
  assert.ok(getScreen('remind'));
  assert.equal(getScreen('remind').label, '提醒');
  assert.ok(!getScreen('settings'), 'D63: there is no settings page any more');
});

test('D29 / D58: the R-S04 large-text copy is gone and the one-time text-size notice is gone too (P132, I3 P0-13)', () => {
  assert.throws(() => t('R-S04.largeNote'), 'slot removed');
  assert.throws(() => t('R-S04.largeLabel'), 'slot removed');
  assert.throws(() => t('X-SETTINGS.textSizeNotice'), 'slot removed (D58: an unactionable notice is not shown)');
  assert.equal(policy.largeTextScale, undefined);
});

test('P132 / D58: v1 large=true is removed silently at start-up (nothing is shown); nothing else changes; no large → nothing', () => {
  assert.equal(textSizeNoticeDue(null), false);
  assert.equal(textSizeNoticeDue({ large: false }), false);
  assert.equal(textSizeNoticeDue({ large: true }), true);

  const { store } = freshStore();
  assert.equal(store.seed({ settings: { library: 'adv3000', sound: false, writeMode: 'paper', large: true } }).ok, true);
  assert.equal(clearLegacyLargeFlag({ getStore: () => store }), true);
  assert.deepEqual(store.getState().settings, { library: 'adv3000', sound: false, writeMode: 'paper' }, 'large removed; other fields kept (old sound / writeMode are left alone, D63)');
  assert.equal(clearLegacyLargeFlag({ getStore: () => store }), false, 'second start: nothing to do');

  const fresh = freshStore().store;
  assert.equal(clearLegacyLargeFlag({ getStore: () => fresh }), false, 'no settings → nothing');
  assert.equal(clearLegacyLargeFlag({ getStore: () => { throw new Error('not booted'); } }), false);
});

test('P132 / D58: if clearing fails the flag stays and is cleared at the next start', () => {
  const { store, storage } = freshStore();
  assert.equal(store.seed({ settings: { large: true } }).ok, true);
  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.settings });
  assert.equal(clearLegacyLargeFlag({ getStore: () => store }), false);
  assert.deepEqual(store.getState().settings, { large: true }, 'write failed → still due');
  assert.equal(clearLegacyLargeFlag({ getStore: () => store }), true);
  assert.equal(textSizeNoticeDue(store.getState().settings), false, 'the second start cleared it');
  assert.equal(commitTextSizeNoticeShown(store).ok, true, 'clearing again is harmless');
});

test('RemindBody (E3): denied → switch shows off and no time row, with R-S02 subtext, body and 手机设置', () => {
  const v = settingsView({ remind: { enabled: true, hour: 7, minute: 5, permission: 'denied' } });
  const ids = allByTestid(remindBody(v));
  assert.equal(ids['remind-switch'][0].props['aria-checked'], 'false');
  assert.ok(!ids['remind-time'], 'no time row while the switch shows off');
  assert.equal(textOf(ids['remind-sub'][0]), '通知没开');
  assert.equal(textOf(ids['remind-open-system'][0]), '手机设置 ›');
  const granted = allByTestid(remindBody(settingsView({ remind: { enabled: true, hour: 7, minute: 5, permission: 'granted' } })));
  assert.equal(granted['remind-switch'][0].props['aria-checked'], 'true');
});

test('RemindBody: reminders on → time row; denied → R-S02 subtext, body and 手机设置; failure block under the rows', () => {
  const v = settingsView({ remind: { enabled: true, hour: 7, minute: 5, permission: 'unknown' }, appearance: 'dark', large: true });
  const ids = allByTestid(remindBody({ ...v, denied: true }, { fail: { field: 'time' } }));
  assert.equal(ids['remind-time'][0].props.value, '07:05');
  assert.equal(ids['remind-time'][0].props.type, 'time');
  assert.equal(textOf(ids['remind-sub'][0]), '通知没开');
  assert.match(textOf(ids['remind-denied'][0]), /要收提醒，请到手机设置打开通知。手机设置 ›/);
  assert.equal(textOf(ids['remind-open-system'][0]), '手机设置 ›');
  assert.equal(ids['remind-fail'].length, 1);
  assert.equal(ids['remind-fail'][0].props['data-field'], 'time');
  assert.equal(textOf(ids['remind-fail-note'][0]), '没保存上，刚才的选择没记下。');
  assert.equal(textOf(ids['remind-fail-cancel'][0]), '先不保存');
  assert.equal(textOf(ids['remind-fail-retry'][0]), '再试一次');
});

test('AppearanceSheetView: three radios in D63 order（跟随系统 / 日间 / 夜间）, current checked; failed state shows the three-part block', () => {
  const picked = [];
  const vnode = AppearanceSheetView({ current: 'dark', onPick: v => picked.push(v), close: () => {} });
  const sheet = vnode.props; // <Sheet> props
  assert.equal(sheet.testid, 'mine-appearance-sheet');
  assert.equal(sheet.title, '外观');
  const ids = allByTestid(vnode);
  const opts = ids['mine-appearance-sheet-option'];
  assert.deepEqual(opts.map(o => o.props['data-value']), APPEARANCE_ORDER);
  assert.deepEqual(opts.map(textOf), ['跟随系统', '日间', '夜间']);
  assert.deepEqual(opts.map(o => o.props['aria-checked']), ['false', 'false', 'true']);
  assert.ok(opts.every(o => o.props.role === 'radio'));
  opts[1].props.onClick({ timeStamp: 1e9 });
  assert.deepEqual(picked, ['light']);
  assert.ok(!ids['mine-appearance-sheet-fail']);
  const failed = allByTestid(expand(AppearanceSheetView({ current: 'auto', failed: true, pending: 'light', onPick: () => {}, close: () => {} })));
  assert.equal(failed['mine-appearance-sheet-fail'].length, 1);
  assert.equal(textOf(failed['mine-appearance-sheet-fail-note'][0]), '没保存上，刚才的选择没记下。');
});
