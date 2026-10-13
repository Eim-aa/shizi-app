// 提醒页与「我的」页上的偏好（原 41-settings；D63 起没有「设置」页：提醒在提醒页 remind.js，外观与练习范围在「我的」页，「声音」「写字方式」两项已删）。
// 02 M4-3；04 R-S01–R-S03；03 P18、P51、P59（D29 删）、P132；01 §3 settings、§8.1 原生桥。
//
// 场景：
//   1. 提醒页：开关是 role=switch、行高 ≥ 44、每个 button 有可读名字；393 / 320 宽无横向滚动；打开页面不写入；「我的」页没有设置入口。
//   2. 练习范围（「我的」页一行）→ 推入 library-switch，返回回到「我的」；值与字库首页同一个。
//   3. 提醒开关写入失败：开关不动 + 就地三段式；先不保存 / 再试一次；刷新后持久化。
//   4. 字号跟随系统（P1-E6 / D29）：XXXL → --k 1.35、data-text-large，L 复原；v1 迁移带来的 settings.large=true 启动后静默去掉（P132 / D58）。
//   5. 外观（三段，一点即切）：夜间 → data-theme=dark、底色变深、刷新后启动即 dark；写入失败 → 行下就地三段式、data-theme 不变，再试一次成功；
//      日间在系统深色下强制浅；跟随系统随 prefers-color-scheme；旧数据里的 settings.sound / writeMode 不被改写。
//   6. 备份行右值「还没有备份」/「上次备份 9月1日」；点 → 'backup' 屏。
//   7. 提醒（假原生通道）：打开 → remind {enabled, 20:00}，postNative requestReminderPermission + syncReminder；改成 07:30 → 写入并 syncReminder；
//      改时间写失败 → 输入框退回、就地三段式；原生回报 denied（applyReminderStatus）→ 小字换 R-S02.title、R-S02.body +「手机设置 ›」→ postNative openAppSettings；
//      关掉 → syncReminder enabled:false。没有原生通道时照常可开关（前半段）。

import { bootTestHost, installNativeStub, nativeMessages, setTextSize, tid, tokenHex, topSel, waitNavIdle } from './helpers.mjs';

const PREFS_MOD = '/src/ui/screens/mine/prefs.js';
const FAILED = '没保存上，刚才的选择没记下。';
const TOP = '.sz-layer[data-top="true"]';

async function state(page) {
  return page.evaluate(() => window.__shiziTest.getState());
}

async function writeLog(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog());
}

async function routerTop(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return { depth: s.depth, top: s.top ? s.top.n : null, overlay: s.topIsOverlay };
  });
}

async function goTab(page, name) {
  await page.evaluate(async n => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab(n);
  }, name);
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page);
}

async function openRemind(page) {
  await page.click(`${TOP} ${tid('mine-remind')}`);
  await page.waitForSelector(topSel('remind-screen'));
  await waitNavIdle(page);
}

/** 提醒页现状。 */
async function snapshot(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    const sw = id => (q(id) ? { checked: q(id).getAttribute('aria-checked'), role: q(id).getAttribute('role'), tag: q(id).tagName } : null);
    const txt = id => (q(id) ? q(id).textContent : null);
    return {
      text: top.textContent,
      remind: sw('remind-switch'),
      remindSub: txt('remind-sub'),
      time: q('remind-time') ? q('remind-time').value : null,
      denied: txt('remind-denied'),
      fail: q('remind-fail') ? { field: q('remind-fail').dataset.field, note: txt('remind-fail-note') } : null,
    };
  });
}

/** 「我的」页现状（外观 / 练习范围 / 备份行）。 */
async function mineRows(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    const txt = id => (q(id) ? q(id).textContent.replace(/\s+/g, ' ').trim() : null);
    const opts = [...top.querySelectorAll('[data-testid="mine-appearance-option"]')];
    return {
      library: q('mine-library') ? q('mine-library').dataset.library : null,
      libraryValue: txt('mine-library-value'),
      appearance: opts.length ? opts.find(o => o.getAttribute('aria-checked') === 'true').dataset.value : null,
      appearanceLabels: opts.map(o => o.textContent.trim()),
      backupValue: txt('mine-backup-value'),
      fail: q('mine-appearance-fail') ? { field: q('mine-appearance-fail').dataset.field, note: txt('mine-appearance-fail-note') } : null,
    };
  });
}

async function html(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const title = document.querySelector('.sz-layer[data-top="true"] [data-page-title]');
    return {
      theme: root.getAttribute('data-theme'),
      large: root.hasAttribute('data-text-large'),
      oldLarge: root.hasAttribute('data-large'),
      k: cs.getPropertyValue('--k').trim(),
      p: cs.getPropertyValue('--paper').trim(),
      bg: getComputedStyle(document.querySelector('.sz-app')).backgroundColor,
      titleSize: title ? parseFloat(getComputedStyle(title).fontSize) : null,
    };
  });
}

async function reloadToRemind(page) {
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await page.waitForSelector(topSel('remind-screen'));
  await waitNavIdle(page);
}

async function clickSettle(page, id) {
  await page.click(topSel(id));
  await page.waitForTimeout(450); // 按钮 0.4s 防连点（01 §6.6）
}

async function pickAppearance(page, value) {
  await page.click(`${topSel('mine-appearance-option')}[data-value="${value}"]`);
  await page.waitForTimeout(450);
}

const DARK_P = tokenHex('dark', 'paper'); // 设计令牌：深色 --paper（D43，原 --p #221E1A）

export default async function prefsSpec(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  await page.evaluate(() => window.__shiziTest.reset());
  await goTab(page, 'mine');

  // ------------------------------------------------------------ 1. 提醒页版式
  step('remind page: one switch row, accessible names, rows ≥ 44, opening writes nothing; 我的 has no settings entry');
  assert.equal(await page.locator(`${TOP} [data-testid*="settings"]`).count(), 0, 'no settings entry on 我的 (D63)');
  const log0 = (await writeLog(page)).length;
  await openRemind(page);
  assert.equal((await routerTop(page)).top, 'remind', 'remind pushed');
  assert.equal(await page.locator(`${topSel('remind-screen')} [data-page-title]`).textContent(), '提醒', 'title 提醒');
  let s = await snapshot(page);
  assert.deepEqual(s.remind, { checked: 'false', role: 'switch', tag: 'BUTTON' }, '练习提醒 switch off');
  assert.equal(s.remindSub, '通知给一个词和拼音，想想是哪个字。', 'R-S01.remindNote');
  assert.equal(s.time, null, 'no time row while off');
  assert.equal(s.denied, null, 'no denied note');
  assert.ok(!s.text.includes('更大字体') && !s.text.includes('声音') && !s.text.includes('写字方式'), 'no 更大字体 / 声音 / 写字方式');
  assert.equal(s.fail, null, 'no failure block');
  const a11y = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const buttons = [...top.querySelectorAll('button')];
    const nameOf = b => {
      if (b.getAttribute('aria-label')) return b.getAttribute('aria-label');
      const by = b.getAttribute('aria-labelledby');
      if (by) return by.split(/\s+/).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
      return b.textContent.trim();
    };
    const row = top.querySelector('[data-testid="remind-switch"]');
    return {
      unnamed: buttons.filter(b => !nameOf(b)).map(b => b.outerHTML.slice(0, 80)),
      noTestid: buttons.filter(b => !b.dataset.testid).map(b => b.outerHTML.slice(0, 80)),
      name: nameOf(row),
      described: row.getAttribute('aria-describedby'),
      rowH: row.getBoundingClientRect().height,
      hScroll: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  assert.deepEqual(a11y.unnamed, [], 'every button has an accessible name');
  assert.deepEqual(a11y.noTestid, [], 'every button has a data-testid');
  assert.equal(a11y.name, '练习提醒', 'switch name = row title');
  assert.ok(a11y.described, 'the switch is described by its note');
  assert.ok(a11y.rowH >= 44, `row ≥ 44px (${a11y.rowH})`);
  assert.equal(a11y.hScroll, false, 'no horizontal scroll at 393');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'no horizontal scroll at 320');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.waitForTimeout(100);
  assert.equal((await writeLog(page)).length, log0, 'opening the reminder page wrote nothing');
  await page.goBack();
  await page.waitForSelector(topSel('screen-mine'));
  await waitNavIdle(page);

  // ------------------------------------------------------------ 2. 练习范围
  step('practice range row on 我的 → library-switch; back returns to 我的');
  let rows = await mineRows(page);
  assert.equal(rows.library, 'core3500', 'practice range = P73 default');
  assert.equal(rows.libraryValue, '常用字', 'library name');
  await page.click(topSel('mine-library'));
  await page.waitForSelector(topSel('libswitch-screen'));
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'library-switch', 'library-switch pushed');
  await page.goBack();
  await page.waitForSelector(topSel('screen-mine'));
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'mine', 'back on 我的');

  // ------------------------------------------------------------ 3. 提醒开关写入失败
  step('remind switch: failNextWrite → switch stays, three-part block; 先不保存 / 再试一次; persists across reload');
  await openRemind(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.settings' }));
  await clickSettle(page, 'remind-switch');
  s = await snapshot(page);
  assert.equal(s.remind.checked, 'false', 'switch unchanged after the failed write');
  assert.deepEqual(s.fail, { field: 'remind', note: FAILED }, 'failure block under the rows');
  assert.equal((await state(page)).settings, null, 'settings not changed');
  assert.equal(await page.locator(topSel('remind-fail-cancel')).textContent(), '先不保存', '先不保存');
  assert.equal(await page.locator(topSel('remind-fail-retry')).textContent(), '再试一次', '再试一次');
  await clickSettle(page, 'remind-fail-cancel');
  s = await snapshot(page);
  assert.equal(s.fail, null, '先不保存 dismisses');
  assert.equal(s.remind.checked, 'false', 'still off');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.settings' }));
  await clickSettle(page, 'remind-switch');
  assert.equal((await snapshot(page)).fail.field, 'remind', 'failed again');
  const logRemind = (await writeLog(page)).length;
  await clickSettle(page, 'remind-fail-retry');
  s = await snapshot(page);
  assert.equal(s.fail, null, 'retry succeeded → block gone');
  assert.equal(s.remind.checked, 'true', 'switch on');
  assert.deepEqual((await state(page)).settings.remind, { enabled: true, hour: 20, minute: 0 }, 'settings.remind written');
  const keys = [...new Set((await writeLog(page)).slice(logRemind).map(e => e.key))].sort();
  assert.deepEqual(keys, ['shizi.v2.settings', 'shizi.v2.txn'], 'only txn + settings written');
  assert.ok((await writeLog(page)).every(e => e.via === 'storage'), 'no direct localStorage writes');
  await reloadToRemind(page);
  assert.equal((await snapshot(page)).remind.checked, 'true', 'reminder on after reload');
  await clickSettle(page, 'remind-switch');
  assert.equal((await snapshot(page)).remind.checked, 'false', 'off again (no native shell: still works)');
  await page.goBack();
  await page.waitForSelector(topSel('screen-mine'));
  await waitNavIdle(page);

  // ------------------------------------------------------------ 4. 字号跟随系统（D29）
  step('text size follows the system (D29): XXXL → --k 1.35, data-text-large; L restores; nothing written');
  let h = await html(page);
  assert.equal(h.large, false, 'no data-text-large at the system default');
  assert.equal(h.k, '1', '--k = 1');
  const logSize = (await writeLog(page)).length;
  await setTextSize(page, 'XXXL');
  h = await html(page);
  assert.equal(h.large, true, 'data-text-large set (--k ≥ policy.compactTextScale, P131)');
  assert.equal(h.oldLarge, false, 'no data-large any more');
  assert.equal(h.k, '1.35', '--k = 1.35 (policy.contentSizeScale.XXXL, P130)');
  await setTextSize(page, 'L');
  h = await html(page);
  assert.equal(h.large, false, 'data-text-large removed');
  assert.equal(h.k, '1', '--k back to 1');
  assert.equal((await writeLog(page)).length, logSize, 'a system text size change writes nothing');

  step('P132: v1 large=true → large silently dropped from settings after start (no notice, D58 P0-13); old sound / writeMode left alone (D63)');
  await page.evaluate(() => window.__shiziTest.seed({ settings: { sound: false, writeMode: 'paper', large: true } }));
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => !('large' in (window.__shiziTest.getState().settings || {})));
  assert.equal(await page.locator(tid('toast')).count(), 0, 'I3 P0-13: no text-size notice any more');
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-large')), false, 'large=true no longer enlarges anything');
  assert.deepEqual((await state(page)).settings, { sound: false, writeMode: 'paper' }, 'large removed; the old 声音 / 写字方式 values stay as they were (not read, not rewritten)');
  await page.waitForTimeout(400);
  assert.equal(await page.locator(tid('toast')).count(), 0, 'not shown again');

  // ------------------------------------------------------------ 5. 外观
  step('appearance (segmented): 夜间 → data-theme=dark; persists; 跟随系统 follows the system; 日间 forces light');
  await goTab(page, 'mine');
  const lightBg = (await html(page)).bg;
  rows = await mineRows(page);
  assert.deepEqual(rows.appearanceLabels, ['跟随系统', '日间', '夜间'], 'three segments (D63)');
  assert.equal(rows.appearance, 'auto', 'current = 跟随系统');
  const logAuto = (await writeLog(page)).length;
  await pickAppearance(page, 'auto');
  assert.equal((await writeLog(page)).length, logAuto, 'tapping the current segment writes nothing');
  await pickAppearance(page, 'dark');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  h = await html(page);
  assert.equal(h.p.toUpperCase(), DARK_P, 'dark paper token');
  assert.ok(h.bg !== lightBg, 'background changed');
  assert.equal((await mineRows(page)).appearance, 'dark', 'segment 夜间 selected');
  assert.equal((await state(page)).settings.appearance, 'dark', 'settings.appearance = dark');
  await page.reload();
  await page.waitForSelector('.sz-app');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', 'dark applied at startup');
  await page.waitForSelector(topSel('screen-mine'));
  await waitNavIdle(page);

  step('appearance failure: three-part block under the row, theme unchanged; 再试一次 succeeds');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.settings' }));
  await pickAppearance(page, 'light');
  await page.waitForSelector(topSel('mine-appearance-fail'));
  rows = await mineRows(page);
  assert.deepEqual(rows.fail, { field: 'appearance:light', note: FAILED }, 'failure sentence under the row');
  assert.equal(rows.appearance, 'dark', 'still 夜间 selected');
  assert.equal((await html(page)).theme, 'dark', 'theme unchanged');
  assert.equal((await state(page)).settings.appearance, 'dark', 'settings unchanged');
  await page.click(topSel('mine-appearance-fail-retry'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
  assert.equal((await mineRows(page)).fail, null, 'block gone after the retry');

  step('appearance: forced light under a dark system; 跟随系统 follows prefers-color-scheme');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(50);
  h = await html(page);
  assert.equal(h.theme, 'light', 'light forced');
  assert.ok(h.p.toUpperCase() !== DARK_P, 'light paper under a dark system');
  await pickAppearance(page, 'auto');
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));
  h = await html(page);
  assert.equal(h.p.toUpperCase(), DARK_P, 'follows the dark system');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(50);
  assert.ok((await html(page)).p.toUpperCase() !== DARK_P, 'follows the light system');
  await page.emulateMedia({ colorScheme: null });

  // ------------------------------------------------------------ 6. 备份行
  step('backup row: value from backupMeta; tap goes to the backup screen');
  assert.equal((await mineRows(page)).backupValue, '还没有备份', 'R-M03.noBackup');
  const at = new Date(2026, 8, 1, 21, 30).getTime();
  await page.evaluate(meta => {
    const st = window.__shiziTest.getState();
    window.__shiziTest.seed({ settings: st.settings, backupMeta: meta });
  }, { lastExportAt: at, lastExportSig: null, lastConclusion: null });
  await page.waitForFunction(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="mine-backup-value"]');
    return el && el.textContent.startsWith('上次备份');
  });
  assert.equal((await mineRows(page)).backupValue, '上次备份 9月1日', 'R-M03.lastBackup');
  await page.click(topSel('mine-menu-backup'));
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    return getRouter().getState().top.n === 'backup';
  });
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'backup', 'backup screen pushed');
  await page.goBack();
  await page.waitForSelector(topSel('screen-mine'));
  await waitNavIdle(page);

  // ------------------------------------------------------------ 7. 提醒 · 假原生
  step('reminder with the native stub: request permission + sync on enable; time change syncs; failure reverts the input');
  await page.evaluate(() => window.__shiziTest.seed({ settings: { appearance: 'auto' } }));
  await installNativeStub(page);
  await openRemind(page);
  await reloadToRemind(page);
  await clickSettle(page, 'remind-switch');
  assert.deepEqual((await state(page)).settings.remind, { enabled: true, hour: 20, minute: 0 }, 'enabled at 20:00');
  let msgs = await nativeMessages(page);
  const types = msgs.map(m => m.type).filter(x => x !== 'backGestureEnabled' && x !== 'pageReady'); // pageReady：每次页面加载一条（M5-3）
  assert.deepEqual(types, ['requestReminderPermission', 'syncReminder'], 'permission requested, then synced');
  const sync0 = msgs.filter(m => m.type === 'syncReminder').pop();
  assert.deepEqual({ enabled: sync0.enabled, hour: sync0.hour, minute: sync0.minute }, { enabled: true, hour: 20, minute: 0 }, 'sync payload');

  await page.fill(topSel('remind-time'), '07:30');
  await page.waitForFunction(() => {
    const s = window.__shiziTest.getState().settings;
    return s && s.remind && s.remind.hour === 7;
  });
  assert.deepEqual((await state(page)).settings.remind, { enabled: true, hour: 7, minute: 30 }, 'time stored');
  msgs = await nativeMessages(page, 'syncReminder');
  assert.deepEqual([msgs[msgs.length - 1].hour, msgs[msgs.length - 1].minute], [7, 30], 'synced with the new time');
  assert.equal((await snapshot(page)).time, '07:30', 'input shows 07:30');

  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.settings' }));
  const syncCount = (await nativeMessages(page, 'syncReminder')).length;
  await page.fill(topSel('remind-time'), '09:15');
  await page.waitForSelector(topSel('remind-fail'));
  s = await snapshot(page);
  assert.equal(s.time, '07:30', 'input reverted after the failed write');
  assert.deepEqual(s.fail, { field: 'time', note: FAILED }, 'failure block');
  assert.deepEqual((await state(page)).settings.remind, { enabled: true, hour: 7, minute: 30 }, 'remind unchanged');
  assert.equal((await nativeMessages(page, 'syncReminder')).length, syncCount, 'no sync after a failed write');
  await page.waitForTimeout(450);
  await clickSettle(page, 'remind-fail-retry');
  assert.deepEqual((await state(page)).settings.remind, { enabled: true, hour: 9, minute: 15 }, 'retry wrote 09:15');
  s = await snapshot(page);
  assert.equal(s.time, '09:15', 'input shows 09:15');
  assert.equal(s.fail, null, 'block gone');

  step('permission denied (native shiziReminderStatus → applyReminderStatus): R-S02 texts; 手机设置 posts openAppSettings');
  await page.evaluate(async mod => {
    const m = await import(mod);
    const { getStore } = await import('/src/store/store.js');
    m.applyReminderStatus(getStore(), { permission: 'denied' });
  }, PREFS_MOD);
  await page.waitForSelector(topSel('remind-denied'));
  s = await snapshot(page);
  assert.equal(s.remindSub, '通知没开', 'subtext R-S02.title');
  assert.equal(s.denied, '要收提醒，请到手机设置打开通知。手机设置 ›', 'note R-S02.body + link');
  assert.equal((await state(page)).settings.remind.permission, 'denied', 'permission stored');
  await clickSettle(page, 'remind-open-system');
  assert.equal((await nativeMessages(page, 'openAppSettings')).length, 1, 'openAppSettings posted');
  await reloadToRemind(page);
  assert.equal((await snapshot(page)).remindSub, '通知没开', 'denied state persists');

  step('E3: notifications denied by the phone → the switch shows OFF (stored choice kept), no time row; tapping it re-requests + opens phone settings');
  s = await snapshot(page);
  assert.equal(s.remind.checked, 'false', 'E3: denied → switch shows off, consistent with 「通知没开」');
  assert.equal(s.time, null, 'E3: no time row while the switch shows off');
  assert.ok(s.denied && s.denied.includes('手机设置 ›'), 'E3: the explanation and 「手机设置 ›」 stay');
  assert.equal((await state(page)).settings.remind.enabled, true, 'E3: the user\'s stored choice is kept');
  const reqBefore = (await nativeMessages(page, 'requestReminderPermission')).length;
  const openBefore = (await nativeMessages(page, 'openAppSettings')).length;
  await clickSettle(page, 'remind-switch');
  assert.equal((await nativeMessages(page, 'requestReminderPermission')).length, reqBefore + 1, 'E3: tapping asks the system again');
  assert.equal((await nativeMessages(page, 'openAppSettings')).length, openBefore + 1, 'E3: … and leads to the phone settings');
  s = await snapshot(page);
  assert.equal(s.remind.checked, 'false', 'E3: still off until the phone allows notifications');
  assert.equal((await state(page)).settings.remind.enabled, true, 'E3: choice recorded as on');
  await page.evaluate(async mod => {
    const m = await import(mod);
    const { getStore } = await import('/src/store/store.js');
    m.applyReminderStatus(getStore(), { permission: 'granted' });
  }, PREFS_MOD);
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="remind-switch"]').getAttribute('aria-checked') === 'true');
  s = await snapshot(page);
  assert.equal(s.time, '09:15', 'E3: allowed in phone settings → switch back on with the time row');
  assert.equal(s.denied, null, 'E3: explanation gone');

  step('turning reminders off syncs enabled:false; settings survive a reload');
  const reqMid = (await nativeMessages(page, 'requestReminderPermission')).length;
  await clickSettle(page, 'remind-switch');
  msgs = await nativeMessages(page, 'syncReminder');
  assert.equal(msgs[msgs.length - 1].enabled, false, 'sync enabled:false');
  assert.equal((await nativeMessages(page, 'requestReminderPermission')).length, reqMid, 'no permission request when turning off');
  const final = (await state(page)).settings;
  assert.deepEqual(final, { appearance: 'auto', remind: { enabled: false, hour: 9, minute: 15, permission: 'granted' } }, 'final settings');
  await reloadToRemind(page);
  s = await snapshot(page);
  assert.equal(s.remind.checked, 'false', 'remind off after reload');
  await page.evaluate(() => window.__shiziTest.reset());
  await goTab(page, 'home');
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), false, 'no theme left behind');
}
