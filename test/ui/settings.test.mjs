// M4-3 设置：显示值补缺省（P18 / P51 / P73 / 原型 SD）、一次 commit 只改 settings 且保留其余字段（真 store + 内存 Storage + 故障注入）、
// 提醒开关补缺省时间与权限回报、外观 / 大字应用到 <html>（platform/appearance.js，假 document）、页面视图（P07 / P13 删行、R-S02 被拒态）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  settingsView, backupValue, parseTime, timeText, defaultRemindTime, commitSettings, commitSound, commitLarge, commitAppearance,
  commitRemindEnabled, commitRemindTime, applyReminderStatus, setReminderSync, SettingsBody, AppearanceSheetView, LABELS,
  SETTINGS_SCREEN, APPEARANCE_ORDER,
} from '../../src/ui/screens/mine/settings.js';
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

test('settingsView: defaults — P73 library, sound on (prototype SD), remind off at policy.remindDefault (P18), auto, not large', () => {
  const v = settingsView(null);
  assert.equal(v.library, policy.defaultLibrary);
  assert.equal(v.libraryName, '规范常用字');
  assert.equal(v.sound, true);
  assert.deepEqual(v.remind, { enabled: false, hour: 20, minute: 0, permission: 'unknown' });
  assert.equal(v.denied, false);
  assert.equal(v.large, false);
  assert.equal(v.appearance, 'auto');
  assert.equal(v.appearanceSwitch, true, 'P51 features.appearanceSwitch');

  const w = settingsView({ library: 'curriculum2500', sound: false, remind: { enabled: true, hour: 7, minute: 5, permission: 'denied' }, large: true, appearance: 'dark' });
  assert.equal(w.libraryName, '小学初中常用字');
  assert.equal(w.sound, false);
  assert.deepEqual(w.remind, { enabled: true, hour: 7, minute: 5, permission: 'denied' });
  assert.equal(w.denied, true);
  assert.equal(w.large, true);
  assert.equal(w.appearance, 'dark');
  assert.equal(settingsView({ library: 'nope' }).library, policy.defaultLibrary, 'unknown library → P73 default');
  const off = settingsView({ appearance: 'dark' }, { p: { ...policy, features: { ...policy.features, appearanceSwitch: false } } });
  assert.equal(off.appearance, 'auto', 'appearanceSwitch off → follow the system');
  assert.equal(off.appearanceSwitch, false);
});

test('time helpers and backup row value (R-M03)', () => {
  assert.deepEqual(parseTime('20:00'), { hour: 20, minute: 0 });
  assert.deepEqual(parseTime('7:05'), { hour: 7, minute: 5 });
  assert.equal(parseTime('24:00'), null);
  assert.equal(parseTime(''), null);
  assert.equal(timeText(7, 5), '07:05');
  assert.deepEqual(defaultRemindTime({ remindDefault: 'bad' }), { hour: 20, minute: 0 });
  assert.deepEqual(defaultRemindTime(), { hour: 20, minute: 0 });
  assert.deepEqual(backupValue(null), { text: '还没有备份', arrow: true, day: null });
  assert.deepEqual(backupValue({ lastExportAt: null }), { text: '还没有备份', arrow: true, day: null });
  const at = new Date(2026, 8, 1, 21, 30).getTime();
  assert.deepEqual(backupValue({ lastExportAt: at }), { text: '上次备份 9 月 1 日 ›', arrow: false, day: '2026-09-01' });
});

// ---------------------------------------------------------------- 写入

test('commitSettings: one commit writes only settings; keeps other fields; failure publishes nothing; retry works; no-op skips the write', () => {
  const { store, storage, backend } = freshStore();
  assert.equal(store.seed({ settings: { library: 'adv3000' }, custom: { added: [{ char: '永', at: NOW }] } }).ok, true);
  const customRaw = JSON.stringify(store.getState().custom);

  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.settings });
  const fail = commitSound(store, false);
  assert.equal(fail.ok, false, 'failure reported');
  assert.deepEqual(store.getState().settings, { library: 'adv3000' }, 'nothing published');
  assert.deepEqual(JSON.parse(backend.getItem(KEYS.settings)), { library: 'adv3000' }, 'storage rolled back');

  const ok = commitSound(store, false);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.keys, [KEYS.settings], 'only the settings key');
  assert.deepEqual(store.getState().settings, { library: 'adv3000', sound: false });
  assert.equal(JSON.stringify(store.getState().custom), customRaw, 'custom untouched');

  const w = backend.writeCount;
  const same = commitSound(store, false);
  assert.equal(same.ok, true);
  assert.equal(same.skipped, true);
  assert.equal(backend.writeCount, w, 'unchanged value → no storage write');

  assert.equal(commitLarge(store, true).ok, true);
  assert.equal(commitAppearance(store, 'dark').ok, true);
  assert.deepEqual(store.getState().settings, { library: 'adv3000', sound: false, large: true, appearance: 'dark' });
  assert.throws(() => commitAppearance(store, 'sepia'), RangeError);
  assert.equal(LABELS.appearance, 'settings:appearance');
});

test('commitSettings on an empty store creates settings with the one field (schema-valid)', () => {
  const { store } = freshStore();
  assert.equal(store.getState().settings, null);
  const r = commitLarge(store, false);
  assert.equal(r.ok, true, 'writes even when the value equals the default (settings was null)');
  assert.deepEqual(store.getState().settings, { large: false });
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

test('appearance: auto removes data-theme, light / dark force it; large toggles data-large; switch off → auto', () => {
  const doc = fakeDoc();
  const root = doc.documentElement;
  applyAppearance({ appearance: 'dark', large: true }, { doc });
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(root.hasAttribute('data-large'), true);
  applyAppearance({ appearance: 'light' }, { doc });
  assert.equal(root.getAttribute('data-theme'), 'light');
  assert.equal(root.hasAttribute('data-large'), false);
  applyAppearance(null, { doc });
  assert.equal(root.hasAttribute('data-theme'), false, 'auto → attribute removed (tokens.css follows prefers-color-scheme)');
  assert.deepEqual(appearanceOf({ appearance: 'dark' }, { features: { appearanceSwitch: false } }), { theme: 'auto', large: false });
  assert.deepEqual(appearanceOf({ appearance: 'bogus', large: 'yes' }), { theme: 'auto', large: false });
});

test('startAppearance: applies stored settings at start; re-applies only when appearance / large change', () => {
  const { store } = freshStore();
  assert.equal(store.seed({ settings: { appearance: 'dark', large: true } }).ok, true);
  const doc = fakeDoc();
  const root = doc.documentElement;
  const off = startAppearance(store, { doc });
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(root.hasAttribute('data-large'), true);

  // 别处手动改的属性：不相关的写入不碰 <html>
  root.setAttribute('data-theme', 'light');
  const writes = root.writes;
  assert.equal(commitSound(store, false).ok, true);
  assert.equal(root.writes, writes, 'a sound write does not touch <html>');
  assert.equal(root.getAttribute('data-theme'), 'light');

  assert.equal(commitAppearance(store, 'auto').ok, true);
  assert.equal(root.hasAttribute('data-theme'), false, 'appearance change applied');
  assert.equal(commitLarge(store, false).ok, true);
  assert.equal(root.hasAttribute('data-large'), false, 'large change applied');
  off();
  assert.equal(commitLarge(store, true).ok, true);
  assert.equal(root.hasAttribute('data-large'), false, 'unsubscribed');
  assert.doesNotThrow(() => startAppearance(null, { doc, getStore: () => { throw new Error('not booted'); } })());
});

// ---------------------------------------------------------------- 视图

function body(view, extra = {}) {
  const noop = () => {};
  const on = new Proxy({}, { get: () => noop });
  return expand(SettingsBody({ view, backup: backupValue(null), on, ...extra }));
}

test('SettingsBody: four groups, rows in prototype order; no 背景音 (P07) / 写完提示做成图片 (P13); copy R-S01–R-S04', () => {
  const vnode = body(settingsView(null));
  const ids = allByTestid(vnode);
  assert.deepEqual(ids['settings-group'].map(g => g.props['data-group']), ['practice', 'remind', 'display', 'data']);
  assert.deepEqual(ids['settings-group-title'].map(textOf), ['练习', '提醒', '显示', '数据']);
  const all = textOf(vnode);
  assert.ok(!all.includes('背景音'), 'P07: no soundscape row');
  assert.ok(!all.includes('写完提示做成图片'), 'P13: no photoHint row');
  assert.match(textOf(ids['settings-library'][0]), /^练习范围规范常用字›$/);
  assert.equal(ids['settings-sound'][0].props.role, 'switch');
  assert.equal(ids['settings-sound'][0].props['aria-checked'], 'true', 'sound defaults on');
  assert.equal(textOf(ids['settings-sound'][0]), '按键音');
  assert.equal(ids['settings-remind'][0].props['aria-checked'], 'false');
  assert.equal(textOf(ids['settings-remind-sub'][0]), t('R-S01.remindNote'));
  assert.ok(!ids['settings-remind-time'], 'no time row while reminders are off');
  assert.ok(!ids['settings-remind-denied']);
  assert.equal(textOf(ids['settings-large-note'][0]), t('R-S04.largeNote').join(''));
  assert.equal(ids['settings-large'][0].props['aria-checked'], 'false');
  assert.equal(textOf(ids['settings-appearance-value'][0]), '跟随系统');
  assert.equal(ids['settings-appearance'][0].props['aria-haspopup'], 'dialog');
  assert.equal(textOf(ids['settings-backup'][0]), '备份与恢复还没有备份›');
  assert.ok(!ids['settings-fail']);
});

test('F3: 更大字体说明只承诺真实行为——文字放大、与手机字号分开；不提写字格，也不说跟着手机字号变', () => {
  const lines = t('R-S04.largeNote');
  const all = lines.join('');
  assert.ok(!all.includes('写字格'), 'the write grid shrinks to compact in large mode (P59 / 另案), so the note must not mention it');
  assert.match(all, /文字/, 'promises text enlargement');
  assert.match(all, /分开/, 'says it is separate from the phone font size');
  assert.ok(!/跟着手机|手机字号调大/.test(all), 'does not claim to follow Dynamic Type (largeTextScale is independent, P59)');
  assert.equal(policy.largeTextScale, 1.3);
});

test('SettingsBody: reminders on → time row; denied → R-S02 subtext, body and 去手机设置; failure block under its group', () => {
  const v = settingsView({ remind: { enabled: true, hour: 7, minute: 5, permission: 'denied' }, appearance: 'dark', large: true });
  const ids = allByTestid(body(v, { fail: { group: 'remind', field: 'time' } }));
  assert.equal(ids['settings-remind-time'][0].props.value, '07:05');
  assert.equal(ids['settings-remind-time'][0].props.type, 'time');
  assert.equal(textOf(ids['settings-remind-sub'][0]), '手机关了拾字的通知，收不到提醒');
  assert.match(textOf(ids['settings-remind-denied'][0]), /想收到提醒，请到手机设置里打开拾字的通知。去手机设置 ›/);
  assert.equal(textOf(ids['settings-open-system'][0]), '去手机设置 ›');
  assert.equal(ids['settings-fail'].length, 1);
  assert.equal(ids['settings-fail'][0].props['data-group'], 'remind');
  assert.equal(textOf(ids['settings-fail-note'][0]), '没保存上，刚才的选择没记下。');
  assert.equal(textOf(ids['settings-fail-cancel'][0]), '先不保存');
  assert.equal(textOf(ids['settings-fail-retry'][0]), '再试一次');
  assert.equal(textOf(ids['settings-appearance-value'][0]), '深色');
  assert.equal(ids['settings-large'][0].props['aria-checked'], 'true');
  const noSwitch = settingsView(null, { p: { ...policy, features: { ...policy.features, appearanceSwitch: false } } });
  assert.ok(!allByTestid(body(noSwitch))['settings-appearance'], 'P51 switch off → no 外观 row');
});

test('AppearanceSheetView: three radios in R-S03 order, current checked; failed state shows the three-part block', () => {
  const picked = [];
  const vnode = AppearanceSheetView({ current: 'dark', onPick: v => picked.push(v), close: () => {} });
  const sheet = vnode.props; // <Sheet> props
  assert.equal(sheet.testid, 'settings-appearance-sheet');
  assert.equal(sheet.title, '外观');
  const ids = allByTestid(vnode);
  const opts = ids['settings-appearance-option'];
  assert.deepEqual(opts.map(o => o.props['data-value']), APPEARANCE_ORDER);
  assert.deepEqual(opts.map(textOf), ['浅色', '深色', '跟随系统']);
  assert.deepEqual(opts.map(o => o.props['aria-checked']), ['false', 'true', 'false']);
  assert.ok(opts.every(o => o.props.role === 'radio'));
  opts[0].props.onClick({ timeStamp: 1e9 });
  assert.deepEqual(picked, ['light']);
  assert.ok(!ids['settings-appearance-fail']);
  const failed = allByTestid(expand(AppearanceSheetView({ current: 'auto', failed: true, pending: 'light', onPick: () => {}, close: () => {} })));
  assert.equal(failed['settings-appearance-fail'].length, 1);
  assert.equal(textOf(failed['settings-appearance-fail-note'][0]), '没保存上，刚才的选择没记下。');
});

test('screen registered as settings', () => {
  assert.equal(SETTINGS_SCREEN, 'settings');
  assert.ok(getScreen('settings'));
  assert.equal(getScreen('settings').label, '设置');
});
