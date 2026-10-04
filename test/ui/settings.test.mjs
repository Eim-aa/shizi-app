// M4-3 设置：显示值补缺省（P18 / P51 / P73 / 原型 SD）、一次 commit 只改 settings 且保留其余字段（真 store + 内存 Storage + 故障注入）、
// 提醒开关补缺省时间与权限回报、外观应用到 <html>（platform/appearance.js，假 document）、页面视图（P07 / P13 删行、R-S02 被拒态）。
// P1-E6（D29，覆盖 P59）：「更大字体」开关删除，settings.large 不再生效；v1 迁移带来的 large=true 显示一次说明（P132）后去掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  settingsView, backupValue, parseTime, timeText, defaultRemindTime, commitSettings, commitSound, commitAppearance,
  commitRemindEnabled, commitRemindTime, applyReminderStatus, setReminderSync, SettingsBody, AppearanceSheetView, LABELS,
  SETTINGS_SCREEN, APPEARANCE_ORDER, textSizeNoticeDue, commitTextSizeNoticeShown, showTextSizeNoticeOnce, TEXT_SIZE_NOTICE_MS,
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

test('settingsView: defaults — P73 library, sound on (prototype SD), remind off at policy.remindDefault (P18), auto; no large field (D29)', () => {
  const v = settingsView(null);
  assert.equal(v.library, policy.defaultLibrary);
  assert.equal(v.libraryName, '规范常用字');
  assert.equal(v.sound, true);
  assert.deepEqual(v.remind, { enabled: false, hour: 20, minute: 0, permission: 'unknown' });
  assert.equal(v.denied, false);
  assert.ok(!('large' in v), 'D29: the view no longer carries the in-app large switch');
  assert.equal(v.appearance, 'auto');
  assert.equal(v.appearanceSwitch, true, 'P51 features.appearanceSwitch');

  const w = settingsView({ library: 'curriculum2500', sound: false, remind: { enabled: true, hour: 7, minute: 5, permission: 'denied' }, large: true, appearance: 'dark' });
  assert.equal(w.libraryName, '小学初中常用字');
  assert.equal(w.sound, false);
  assert.deepEqual(w.remind, { enabled: true, hour: 7, minute: 5, permission: 'denied' });
  assert.equal(w.denied, true);
  assert.ok(!('large' in w), 'a stored large=true is read without error but has no effect (D29)');
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
  assert.deepEqual(backupValue({ lastExportAt: at }), { text: '上次备份 9月1日 ›', arrow: false, day: '2026-09-01' });
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

  assert.equal(commitAppearance(store, 'dark').ok, true);
  assert.deepEqual(store.getState().settings, { library: 'adv3000', sound: false, appearance: 'dark' });
  assert.throws(() => commitAppearance(store, 'sepia'), RangeError);
  assert.equal(LABELS.appearance, 'settings:appearance');
});

test('commitSettings on an empty store creates settings with the one field (schema-valid)', () => {
  const { store } = freshStore();
  assert.equal(store.getState().settings, null);
  const r = commitSound(store, true);
  assert.equal(r.ok, true, 'writes even when the value equals the default (settings was null)');
  assert.deepEqual(store.getState().settings, { sound: true });
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
  assert.equal(commitSound(store, false).ok, true);
  assert.equal(root.writes, writes, 'a sound write does not touch <html>');
  assert.equal(root.getAttribute('data-theme'), 'light');

  assert.equal(commitAppearance(store, 'auto').ok, true);
  assert.equal(root.hasAttribute('data-theme'), false, 'appearance change applied');
  off();
  assert.equal(commitAppearance(store, 'dark').ok, true);
  assert.equal(root.hasAttribute('data-theme'), false, 'unsubscribed');
  assert.doesNotThrow(() => startAppearance(null, { doc, getStore: () => { throw new Error('not booted'); } })());
});

// ---------------------------------------------------------------- 视图

function body(view, extra = {}) {
  const noop = () => {};
  const on = new Proxy({}, { get: () => noop });
  return expand(SettingsBody({ view, backup: backupValue(null), on, ...extra }));
}

test('SettingsBody: four groups, rows in prototype order; no 背景音 (P07) / 写完提示做成图片 (P13) / 更大字体 (D29); copy R-S01–R-S03', () => {
  const vnode = body(settingsView(null));
  const ids = allByTestid(vnode);
  assert.deepEqual(ids['settings-group'].map(g => g.props['data-group']), ['practice', 'remind', 'display', 'data']);
  assert.deepEqual(ids['settings-group-title'].map(textOf), ['练习', '提醒', '显示', '数据']);
  const all = textOf(vnode);
  assert.ok(!all.includes('背景音'), 'P07: no soundscape row');
  assert.ok(!all.includes('写完提示做成图片'), 'P13: no photoHint row');
  assert.match(textOf(ids['settings-library'][0]), /^练习范围规范常用字$/, 'the trailing › is an svg chevron since P1-E1b (components/Chevron.js)');
  assert.equal(ids['settings-sound'][0].props.role, 'switch');
  assert.equal(ids['settings-sound'][0].props['aria-checked'], 'true', 'sound defaults on');
  assert.equal(textOf(ids['settings-sound'][0]), '按键音');
  assert.equal(ids['settings-remind'][0].props['aria-checked'], 'false');
  assert.equal(textOf(ids['settings-remind-sub'][0]), t('R-S01.remindNote'));
  assert.ok(!ids['settings-remind-time'], 'no time row while reminders are off');
  assert.ok(!ids['settings-remind-denied']);
  assert.ok(!ids['settings-large'] && !ids['settings-large-note'], 'D29: no 更大字体 switch');
  assert.ok(!all.includes('更大字体'), 'D29: the row title is gone too');
  assert.equal(allByTestid(ids['settings-group'][2])['settings-appearance'].length, 1, 'the 显示 group holds 外观');
  assert.equal(textOf(ids['settings-appearance-value'][0]), '跟随系统');
  assert.equal(ids['settings-appearance'][0].props['aria-haspopup'], 'dialog');
  assert.equal(textOf(ids['settings-backup'][0]), '备份与恢复还没有备份', 'svg chevron, not text (P1-E1b)');
  assert.ok(!ids['settings-fail']);
});

test('D29: the R-S04 large-text copy is gone; the one-time notice says text size follows the phone settings (P132)', () => {
  assert.throws(() => t('R-S04.largeNote'), 'slot removed');
  assert.throws(() => t('R-S04.largeLabel'), 'slot removed');
  assert.equal(t('X-SETTINGS.textSizeNotice'), '文字大小跟随手机设置，可以在手机的设置里调整。');
  assert.equal(policy.largeTextScale, undefined);
});

test('P132: v1 large=true → notice shown once, then large is removed from settings; nothing else changes; no large → nothing', () => {
  assert.equal(textSizeNoticeDue(null), false);
  assert.equal(textSizeNoticeDue({ large: false }), false);
  assert.equal(textSizeNoticeDue({ large: true }), true);

  const { store } = freshStore();
  assert.equal(store.seed({ settings: { library: 'adv3000', sound: false, large: true } }).ok, true);
  const shown = [];
  const show = (text, opts) => shown.push({ text, opts });
  assert.equal(showTextSizeNoticeOnce({ getStore: () => store, show }), true);
  assert.deepEqual(shown, [{ text: t('X-SETTINGS.textSizeNotice'), opts: { duration: TEXT_SIZE_NOTICE_MS } }]);
  assert.deepEqual(store.getState().settings, { library: 'adv3000', sound: false }, 'large removed = recorded as shown; other fields kept');
  assert.equal(showTextSizeNoticeOnce({ getStore: () => store, show }), false, 'second start: not shown again');
  assert.equal(shown.length, 1);

  const fresh = freshStore().store;
  assert.equal(showTextSizeNoticeOnce({ getStore: () => fresh, show }), false, 'no settings → nothing');
  assert.equal(showTextSizeNoticeOnce({ getStore: () => { throw new Error('not booted'); }, show }), false);
  assert.equal(shown.length, 1);
});

test('P132: if recording fails the notice comes back once more next start (shown, not lost)', () => {
  const { store, storage } = freshStore();
  assert.equal(store.seed({ settings: { large: true } }).ok, true);
  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.settings });
  const shown = [];
  assert.equal(showTextSizeNoticeOnce({ getStore: () => store, show: text => shown.push(text) }), true);
  assert.deepEqual(store.getState().settings, { large: true }, 'write failed → still due');
  assert.equal(showTextSizeNoticeOnce({ getStore: () => store, show: text => shown.push(text) }), true);
  assert.equal(shown.length, 2);
  assert.equal(textSizeNoticeDue(store.getState().settings), false, 'the second start recorded it');
  assert.equal(commitTextSizeNoticeShown(store).ok, true, 'recording again is harmless');
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
  assert.ok(!ids['settings-large'], 'large=true in storage draws no switch (D29)');
  const noSwitch = settingsView(null, { p: { ...policy, features: { ...policy.features, appearanceSwitch: false } } });
  const noIds = allByTestid(body(noSwitch));
  assert.ok(!noIds['settings-appearance'], 'P51 switch off → no 外观 row');
  assert.deepEqual(noIds['settings-group'].map(g => g.props['data-group']), ['practice', 'remind', 'data'], 'empty 显示 group is not drawn');
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

// ---------------------------------------------------------------- 写字方式（阶段 1 P1-E8，D46 ⑬；03 P165）

test('P165: settingsView.writeMode 缺省 screen；commitWriteMode 一次 commit 只改 settings.writeMode（其余字段保留）', async () => {
  const { commitWriteMode, WRITE_MODE_ORDER } = await import('../../src/ui/screens/mine/settings.js');
  assert.deepEqual(WRITE_MODE_ORDER, ['screen', 'paper']);
  assert.equal(settingsView(null).writeMode, 'screen');
  assert.equal(settingsView({ writeMode: 'paper' }).writeMode, 'paper');
  assert.equal(settingsView({ writeMode: 'x' }).writeMode, 'screen');
  const { store, backend } = freshStore();
  assert.equal(commitSound(store, false).ok, true);
  const res = commitWriteMode(store, 'paper');
  assert.equal(res.ok, true);
  assert.deepEqual(res.keys, [KEYS.settings]);
  assert.deepEqual(JSON.parse(backend.getItem(KEYS.settings)), { sound: false, writeMode: 'paper' });
  assert.equal(commitWriteMode(store, 'paper').skipped, true, 'same value → no write');
  assert.throws(() => commitWriteMode(store, 'pencil'), /write mode/);
});

test('P165: SettingsBody 练习组「练习范围 · 写字方式 · 按键音」，写字方式行右侧显示当前方式、点开弹层', () => {
  const ids = allByTestid(body(settingsView({ writeMode: 'paper' })));
  const practice = allByTestid(ids['settings-group'][0]);
  assert.ok(practice['settings-writemode'], 'the 练习 group holds 写字方式');
  const order = [];
  walk(ids['settings-group'][0], n => { const id = n.props && n.props['data-testid']; if (['settings-library', 'settings-writemode', 'settings-sound'].includes(id)) order.push(id); });
  assert.deepEqual(order, ['settings-library', 'settings-writemode', 'settings-sound']);
  const row = ids['settings-writemode'][0];
  assert.equal(row.props['data-value'], 'paper');
  assert.equal(row.props['aria-haspopup'], 'dialog');
  assert.equal(textOf(row), '写字方式在纸上写');
  assert.equal(textOf(allByTestid(body(settingsView(null)))['settings-writemode-value'][0]), '在屏幕上写');
});

test('P165: WriteModeSheetView——两个单选（在屏幕上写 / 在纸上写，各带说明），当前项勾上，下面一段说明（§10.3）', async () => {
  const { WriteModeSheetView, WRITE_MODE_ORDER } = await import('../../src/ui/screens/mine/settings.js');
  const picked = [];
  const vnode = WriteModeSheetView({ current: 'screen', onPick: v => picked.push(v), close: () => {} });
  assert.equal(vnode.props.title, '写字方式');
  assert.equal(vnode.props.testid, 'settings-writemode-sheet');
  const ids = allByTestid(vnode);
  const opts = ids['settings-writemode-option'];
  assert.deepEqual(opts.map(o => o.props['data-value']), WRITE_MODE_ORDER);
  assert.deepEqual(opts.map(o => o.props['aria-checked']), ['true', 'false']);
  assert.ok(opts.every(o => o.props.role === 'radio'));
  assert.deepEqual(opts.map(textOf), [t('X-SETTINGS.writeScreen') + t('X-SETTINGS.writeScreenSub'), t('X-SETTINGS.writePaper') + t('X-SETTINGS.writePaperSub')]);
  assert.equal(textOf(ids['settings-writemode-note'][0]), t('X-SETTINGS.writeModeNote'));
  opts[1].props.onClick({ timeStamp: 1e9 });
  assert.deepEqual(picked, ['paper']);
  const failed = allByTestid(expand(WriteModeSheetView({ current: 'screen', failed: true, pending: 'paper', onPick: () => {}, close: () => {} })));
  assert.equal(failed['settings-writemode-fail'].length, 1);
});
