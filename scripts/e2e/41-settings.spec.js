// M4-3 设置（02 M4-3；04 R-S01–R-S03；03 P07 / P13 删、P18、P51、P59（D29 删）、P132；01 §3 settings、§8.1 原生桥）。
//
// 场景：
//   1. 版式：四组「练习 / 提醒 / 显示 / 数据」、原型行序；没有「练字背景音」（P07）与「写完提示做成图片」（P13）；
//      每个 button 有可读名字、开关是 role=switch + aria-checked、行高 ≥ 44；393 / 320 宽无横向滚动；打开页面不写入。
//   2. 练习范围 → 推入 library-switch，返回回到设置。
//   3. 按键音：点一下 → settings.sound=false，只写 txn + settings；failNextWrite → 开关不动 + 组下三段式；先不保存 / 再试一次；
//      刷新后仍是关（持久化）。
//   4. 字号跟随系统（P1-E6 / D29，覆盖 P59）：没有「更大字体」开关（旧断言「点开 → data-large、--k 1.3」随开关删除，改测替代行为）；
//      模拟原生 shiziContentSize XXXL → --k 1.35、页头 17 → 22.95、data-text-large，L 复原；
//      v1 迁移带来的 settings.large=true → 启动后轻提示「文字大小跟随手机设置…」一次、settings 去掉 large，再启动不再显示（P132）。
//   5. 外观：点开底部弹层三选（浅色 / 深色 / 跟随系统，当前项打勾）；选深色 → data-theme=dark、底色变深；刷新后启动即 dark；
//      跟随系统 → 去掉属性，随 prefers-color-scheme；浅色在系统深色下强制浅；弹层里 failNextWrite → 就地三段式、data-theme 不变，
//      再试一次成功关弹层；点当前项直接关、不写；系统返回关弹层。
//   6. 数据：备份与恢复右侧「还没有备份」/「上次备份 9 月 1 日 ›」；点 → 'backup' 屏（M4-4 未注册时用占位屏）。
//   7. 提醒（假原生通道）：打开 → remind {enabled, 20:00}，postNative requestReminderPermission + syncReminder；
//      出现提醒时间行，改成 07:30 → 写入并 syncReminder；改时间写失败 → 输入框退回、提醒组三段式；
//      原生回报 denied（applyReminderStatus）→ 小字换 R-S02.title、组下 R-S02.body +「去手机设置 ›」→ postNative openAppSettings；
//      关掉 → syncReminder enabled:false。没有原生通道时照常可开关（前半段）。

import { bootTestHost, installNativeStub, nativeMessages, setTextSize, tid, topSel, waitNavIdle } from './helpers.mjs';

const SETTINGS_MOD = '/src/ui/screens/mine/settings.js';
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

async function openSettings(page) {
  const ok = await page.evaluate(async mod => (await import(mod)).openSettings(), SETTINGS_MOD);
  if (!ok) throw new Error('openSettings returned false');
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    const sw = id => (q(id) ? { checked: q(id).getAttribute('aria-checked'), role: q(id).getAttribute('role'), tag: q(id).tagName } : null);
    const txt = id => (q(id) ? q(id).textContent : null);
    return {
      groups: [...top.querySelectorAll('[data-testid="settings-group"]')].map(g => g.dataset.group),
      groupTitles: [...top.querySelectorAll('[data-testid="settings-group-title"]')].map(g => g.textContent),
      text: top.textContent,
      library: q('settings-library') ? q('settings-library').dataset.library : null,
      libraryValue: txt('settings-library-value'),
      sound: sw('settings-sound'),
      remind: sw('settings-remind'),
      remindSub: txt('settings-remind-sub'),
      time: q('settings-remind-time') ? q('settings-remind-time').value : null,
      denied: txt('settings-remind-denied'),
      large: sw('settings-large'),
      largeNote: q('settings-large-note') ? [...q('settings-large-note').children].map(c => c.textContent) : null,
      appearance: q('settings-appearance') ? q('settings-appearance').dataset.value : null,
      appearanceValue: txt('settings-appearance-value'),
      backup: txt('settings-backup'),
      backupValue: txt('settings-backup-value'),
      fail: q('settings-fail') ? { group: q('settings-fail').dataset.group, field: q('settings-fail').dataset.field, note: txt('settings-fail-note') } : null,
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
      p: cs.getPropertyValue('--p').trim(),
      bg: getComputedStyle(document.querySelector('.sz-app')).backgroundColor,
      titleSize: title ? parseFloat(getComputedStyle(title).fontSize) : null,
    };
  });
}

async function reloadToSettings(page) {
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);
}

async function clickSettle(page, id) {
  await page.click(topSel(id));
  await page.waitForTimeout(450); // 按钮 0.4s 防连点（01 §6.6）
}

async function openSheet(page) {
  await page.click(topSel('settings-appearance'));
  await page.waitForSelector(topSel('settings-appearance-sheet'));
  await waitNavIdle(page);
}

async function sheetState(page) {
  return page.evaluate(() => {
    const s = document.querySelector('.sz-layer[data-top="true"] [data-testid="settings-appearance-sheet"]');
    if (!s) return null;
    const opts = [...s.querySelectorAll('[data-testid="settings-appearance-option"]')];
    return {
      role: s.getAttribute('role'),
      title: s.querySelector('h2') ? s.querySelector('h2').textContent : null,
      state: s.querySelector('[data-testid="settings-appearance-options"]').dataset.state,
      values: opts.map(o => o.dataset.value),
      labels: opts.map(o => o.textContent.trim()),
      checked: opts.map(o => o.getAttribute('aria-checked')),
      roles: opts.map(o => o.getAttribute('role')),
      fail: s.querySelector('[data-testid="settings-appearance-fail-note"]')
        ? s.querySelector('[data-testid="settings-appearance-fail-note"]').textContent : null,
    };
  });
}

async function pickAppearance(page, value) {
  await page.click(`${topSel('settings-appearance-option')}[data-value="${value}"]`);
}

const DARK_P = '#221E1A'; // tokens.css 深色 --p

export default async function settingsSpec(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  await page.evaluate(() => window.__shiziTest.reset());
  await goTab(page, 'mine');

  // ------------------------------------------------------------ 1. 版式
  step('layout: four groups in prototype order; P07 / P13 rows removed; switches; accessible names; opening writes nothing');
  const log0 = (await writeLog(page)).length;
  // 真实入口：「我的」菜单「设置」（M4-1 的 mine-menu-settings）；该卡未合入时退回 openSettings()
  const menuEntry = `${TOP} ${tid('mine-menu-settings')}`;
  if (await page.$(menuEntry)) {
    await page.click(menuEntry);
    await page.waitForSelector(topSel('settings-screen'));
    await waitNavIdle(page);
  } else {
    await openSettings(page);
  }
  assert.equal((await routerTop(page)).top, 'settings', 'settings pushed');
  assert.equal(await page.locator(`${topSel('settings-screen')} [data-page-title]`).textContent(), '设置', 'title 设置 (R-S01)');
  let s = await snapshot(page);
  assert.deepEqual(s.groups, ['practice', 'remind', 'display', 'data'], 'four groups');
  assert.deepEqual(s.groupTitles, ['练习', '提醒', '显示', '数据'], 'group titles');
  assert.ok(!s.text.includes('背景音'), 'no 练字背景音 row (P07)');
  assert.ok(!s.text.includes('写完提示做成图片'), 'no 写完提示做成图片 row (P13)');
  assert.equal(s.library, 'core3500', 'practice range = P73 default');
  assert.equal(s.libraryValue, '规范常用字', 'library name');
  assert.deepEqual(s.sound, { checked: 'true', role: 'switch', tag: 'BUTTON' }, '按键音 switch on by default');
  assert.deepEqual(s.remind, { checked: 'false', role: 'switch', tag: 'BUTTON' }, '练习提醒 switch off');
  assert.equal(s.remindSub, '通知会给一个词语和拼音，让你想想是哪个字。', 'R-S01.remindNote');
  assert.equal(s.time, null, 'no time row while off');
  assert.equal(s.denied, null, 'no denied note');
  assert.equal(s.large, null, 'no 更大字体 switch (D29: text size follows the phone, P130)');
  assert.equal(s.largeNote, null, 'no R-S04 note');
  assert.ok(!s.text.includes('更大字体'), 'no 更大字体 text anywhere on the page');
  assert.equal(s.appearance, 'auto', 'appearance auto');
  assert.equal(s.appearanceValue, '跟随系统', 'R-S03 value');
  assert.equal(s.backupValue, '还没有备份', 'R-M03.noBackup');
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
    const body = top.querySelector('[data-testid="settings-screen"]');
    const rows = [...body.querySelectorAll('.sz-set__row')];
    return {
      unnamed: buttons.filter(b => !nameOf(b)).map(b => b.outerHTML.slice(0, 80)),
      noTestid: buttons.filter(b => !b.dataset.testid).map(b => b.outerHTML.slice(0, 80)),
      names: Object.fromEntries(['settings-sound', 'settings-remind'].map(id => [id, nameOf(top.querySelector(`[data-testid="${id}"]`))])),
      described: top.querySelector('[data-testid="settings-remind"]').getAttribute('aria-describedby'),
      minRow: Math.min(...rows.map(r => r.getBoundingClientRect().height)),
      hScroll: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  assert.deepEqual(a11y.unnamed, [], 'every button has an accessible name');
  assert.deepEqual(a11y.noTestid, [], 'every button has a data-testid');
  assert.deepEqual(a11y.names, { 'settings-sound': '按键音', 'settings-remind': '练习提醒' }, 'switch names = row titles');
  assert.ok(a11y.described, 'remind switch is described by its note (the large switch it used to check is gone, D29)');
  assert.ok(a11y.minRow >= 44, `rows ≥ 44px (min ${a11y.minRow})`);
  assert.equal(a11y.hScroll, false, 'no horizontal scroll at 393');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'no horizontal scroll at 320');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.waitForTimeout(100);
  assert.equal((await writeLog(page)).length, log0, 'opening settings wrote nothing');

  // ------------------------------------------------------------ 2. 练习范围
  step('practice range → library-switch; back returns to settings');
  await page.click(topSel('settings-library'));
  await page.waitForSelector(topSel('libswitch-screen'));
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'library-switch', 'library-switch pushed');
  await page.goBack();
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'settings', 'back on settings');

  // ------------------------------------------------------------ 3. 按键音
  step('key sound: failNextWrite → switch stays, three-part block under 练习; 先不保存 / 再试一次; persists across reload');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.settings' }));
  await clickSettle(page, 'settings-sound');
  s = await snapshot(page);
  assert.equal(s.sound.checked, 'true', 'switch unchanged after the failed write');
  assert.deepEqual(s.fail, { group: 'practice', field: 'sound', note: FAILED }, 'failure block under 练习');
  assert.equal((await state(page)).settings, null, 'settings not changed');
  assert.equal(await page.locator(topSel('settings-fail-cancel')).textContent(), '先不保存', '先不保存');
  assert.equal(await page.locator(topSel('settings-fail-retry')).textContent(), '再试一次', '再试一次');
  await clickSettle(page, 'settings-fail-cancel');
  s = await snapshot(page);
  assert.equal(s.fail, null, '先不保存 dismisses');
  assert.equal(s.sound.checked, 'true', 'still on');

  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.settings' }));
  await clickSettle(page, 'settings-sound');
  assert.equal((await snapshot(page)).fail.field, 'sound', 'failed again');
  const logSound = (await writeLog(page)).length;
  await clickSettle(page, 'settings-fail-retry');
  s = await snapshot(page);
  assert.equal(s.fail, null, 'retry succeeded → block gone');
  assert.equal(s.sound.checked, 'false', 'switch off');
  assert.deepEqual((await state(page)).settings, { sound: false }, 'settings.sound = false');
  const soundKeys = [...new Set((await writeLog(page)).slice(logSound).map(e => e.key))].sort();
  assert.deepEqual(soundKeys, ['shizi.v2.settings', 'shizi.v2.txn'], 'only txn + settings written');
  assert.ok((await writeLog(page)).every(e => e.via === 'storage'), 'no direct localStorage writes');
  await reloadToSettings(page);
  assert.equal((await snapshot(page)).sound.checked, 'false', 'key sound off after reload');

  // ------------------------------------------------------------ 4. 字号跟随系统（D29）
  step('text size follows the system (D29): XXXL → --k 1.35, title 17 → 22.95px, data-text-large; L restores; nothing written');
  let h = await html(page);
  assert.equal(h.large, false, 'no data-text-large at the system default');
  assert.equal(h.k, '1', '--k = 1');
  assert.equal(h.titleSize, 17, 'title 17px');
  const logSize = (await writeLog(page)).length;
  await setTextSize(page, 'XXXL');
  h = await html(page);
  assert.equal(h.large, true, 'data-text-large set (--k ≥ policy.compactTextScale, P131)');
  assert.equal(h.oldLarge, false, 'no data-large any more');
  assert.equal(h.k, '1.35', '--k = 1.35 (policy.contentSizeScale.XXXL, P130)');
  assert.ok(Math.abs(h.titleSize - 22.95) < 0.05, `title 17 × 1.35 = 22.95px (got ${h.titleSize})`);
  await setTextSize(page, 'L');
  h = await html(page);
  assert.equal(h.large, false, 'data-text-large removed');
  assert.equal(h.k, '1', '--k back to 1');
  assert.equal((await writeLog(page)).length, logSize, 'a system text size change writes nothing');

  step('P132: v1 large=true → one notice after start, large dropped from settings; the next start shows nothing');
  await page.evaluate(() => window.__shiziTest.seed({ settings: { sound: false, large: true } }));
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="toast"]');
    return !!el && el.textContent.includes('文字大小跟随手机设置');
  });
  assert.equal(await page.locator(tid('toast')).textContent(), '文字大小跟随手机设置，可以在手机的设置里调整。', 'X-SETTINGS.textSizeNotice shown');
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-large')), false, 'large=true no longer enlarges anything');
  await page.waitForFunction(() => !('large' in (window.__shiziTest.getState().settings || {})));
  assert.deepEqual((await state(page)).settings, { sound: false }, 'large removed (= recorded as shown); sound kept');
  await reloadToSettings(page);
  await page.waitForTimeout(400);
  assert.equal(await page.locator(tid('toast')).count(), 0, 'not shown again on the next start');
  assert.equal((await snapshot(page)).large, null, 'still no 更大字体 switch');

  // ------------------------------------------------------------ 5. 外观
  step('appearance: sheet with three choices; 深色 → data-theme=dark; persists; 跟随系统 follows the system; 浅色 forces light');
  const lightBg = (await html(page)).bg;
  await openSheet(page);
  let sh = await sheetState(page);
  assert.equal(sh.role, 'dialog', 'bottom sheet dialog');
  assert.equal(sh.title, '外观', 'sheet title');
  assert.deepEqual(sh.values, ['light', 'dark', 'auto'], 'order 浅色 / 深色 / 跟随系统 (R-S03)');
  assert.deepEqual(sh.labels, ['浅色', '深色', '跟随系统'], 'labels');
  assert.deepEqual(sh.checked, ['false', 'false', 'true'], 'current = 跟随系统');
  assert.deepEqual(sh.roles, ['radio', 'radio', 'radio'], 'radios');
  const logAuto = (await writeLog(page)).length;
  await pickAppearance(page, 'auto');
  await page.waitForSelector(topSel('settings-appearance-sheet'), { state: 'detached' });
  await waitNavIdle(page);
  assert.equal((await writeLog(page)).length, logAuto, 'picking the current choice closes without writing');

  await openSheet(page);
  await pickAppearance(page, 'dark');
  await page.waitForSelector(topSel('settings-appearance-sheet'), { state: 'detached' });
  await waitNavIdle(page);
  h = await html(page);
  assert.equal(h.theme, 'dark', 'data-theme=dark');
  assert.equal(h.p.toUpperCase(), DARK_P, 'dark paper token');
  assert.ok(h.bg !== lightBg, 'background changed');
  s = await snapshot(page);
  assert.equal(s.appearanceValue, '深色', 'row value 深色');
  assert.equal((await state(page)).settings.appearance, 'dark', 'settings.appearance = dark');
  await page.reload();
  await page.waitForSelector('.sz-app');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', 'dark applied at startup');
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);

  step('appearance failure: in-sheet three-part block, theme unchanged; 再试一次 succeeds and closes');
  await openSheet(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.settings' }));
  await pickAppearance(page, 'light');
  await page.waitForSelector(`${topSel('settings-appearance-options')}[data-state="failed"]`);
  await page.waitForTimeout(450);
  sh = await sheetState(page);
  assert.equal(sh.fail, FAILED, 'failure sentence in the sheet');
  assert.deepEqual(sh.checked, ['false', 'true', 'false'], 'still 深色 checked');
  assert.equal((await html(page)).theme, 'dark', 'theme unchanged');
  assert.equal((await state(page)).settings.appearance, 'dark', 'settings unchanged');
  await page.click(topSel('settings-appearance-fail-retry'));
  await page.waitForSelector(topSel('settings-appearance-sheet'), { state: 'detached' });
  await waitNavIdle(page);
  assert.equal((await html(page)).theme, 'light', 'retry → data-theme=light');

  step('appearance: forced light under a dark system; 跟随系统 follows prefers-color-scheme; system back closes the sheet');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(50);
  h = await html(page);
  assert.equal(h.theme, 'light', 'light forced');
  assert.ok(h.p.toUpperCase() !== DARK_P, 'light paper under a dark system');
  await openSheet(page);
  await pickAppearance(page, 'auto');
  await page.waitForSelector(topSel('settings-appearance-sheet'), { state: 'detached' });
  await waitNavIdle(page);
  h = await html(page);
  assert.equal(h.theme, null, '跟随系统 → no data-theme');
  assert.equal(h.p.toUpperCase(), DARK_P, 'follows the dark system');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(50);
  assert.ok((await html(page)).p.toUpperCase() !== DARK_P, 'follows the light system');
  await page.emulateMedia({ colorScheme: null });
  await openSheet(page);
  const logBack = (await writeLog(page)).length;
  await page.goBack();
  await page.waitForSelector(topSel('settings-appearance-sheet'), { state: 'detached' });
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'settings', 'system back closes the sheet only');
  assert.equal((await writeLog(page)).length, logBack, 'no write');

  // ------------------------------------------------------------ 6. 备份与恢复
  step('data: backup row value from backupMeta; tap goes to the backup screen');
  const at = new Date(2026, 8, 1, 21, 30).getTime();
  await page.evaluate(meta => {
    const st = window.__shiziTest.getState();
    window.__shiziTest.seed({ settings: st.settings, backupMeta: meta });
  }, { lastExportAt: at, lastExportSig: null, lastConclusion: null });
  await page.waitForFunction(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="settings-backup-value"]');
    return el && el.textContent.startsWith('上次备份');
  });
  s = await snapshot(page);
  assert.equal(s.backupValue, '上次备份 9 月 1 日 ›', 'R-M03.lastBackup');
  const stubbed = await page.evaluate(async () => {
    const r = await import('/src/ui/router.js');
    if (r.getScreen('backup')) return false;
    const { html: h } = await import('/vendor/ui.js');
    r.registerScreen('backup', () => h`<div data-testid="backup-stub">backup</div>`, { label: 'backup' });
    return true;
  });
  await page.click(topSel('settings-backup'));
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    return getRouter().getState().top.n === 'backup';
  });
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'backup', `backup screen pushed${stubbed ? ' (stub: M4-4 not registered yet)' : ''}`);
  await page.goBack();
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);

  // ------------------------------------------------------------ 7a. 提醒 · 无原生
  step('reminder without a native shell: the switch still works (postNative returns false)');
  await clickSettle(page, 'settings-remind');
  s = await snapshot(page);
  assert.equal(s.remind.checked, 'true', 'on');
  assert.equal(s.time, '20:00', 'time row at the P18 default');
  assert.deepEqual((await state(page)).settings.remind, { enabled: true, hour: 20, minute: 0 }, 'remind stored with the default time');
  await clickSettle(page, 'settings-remind');
  assert.equal((await snapshot(page)).time, null, 'off → time row hidden');
  await page.evaluate(() => {
    const st = window.__shiziTest.getState();
    window.__shiziTest.seed({ settings: { ...st.settings, remind: undefined } });
  });

  // ------------------------------------------------------------ 7b. 提醒 · 假原生
  step('reminder with the native stub: request permission + sync on enable; time change syncs; failure reverts the input');
  await installNativeStub(page);
  await reloadToSettings(page);
  await clickSettle(page, 'settings-remind');
  assert.deepEqual((await state(page)).settings.remind, { enabled: true, hour: 20, minute: 0 }, 'enabled at 20:00');
  let msgs = await nativeMessages(page);
  const types = msgs.map(m => m.type).filter(x => x !== 'backGestureEnabled' && x !== 'pageReady'); // pageReady：每次页面加载一条（M5-3）
  assert.deepEqual(types, ['requestReminderPermission', 'syncReminder'], 'permission requested, then synced');
  const sync0 = msgs.filter(m => m.type === 'syncReminder').pop();
  assert.deepEqual({ enabled: sync0.enabled, hour: sync0.hour, minute: sync0.minute }, { enabled: true, hour: 20, minute: 0 }, 'sync payload');

  await page.fill(topSel('settings-remind-time'), '07:30');
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
  await page.fill(topSel('settings-remind-time'), '09:15');
  await page.waitForSelector(`${topSel('settings-fail')}[data-group="remind"]`);
  s = await snapshot(page);
  assert.equal(s.time, '07:30', 'input reverted after the failed write');
  assert.deepEqual(s.fail, { group: 'remind', field: 'time', note: FAILED }, 'failure block under 提醒');
  assert.deepEqual((await state(page)).settings.remind, { enabled: true, hour: 7, minute: 30 }, 'remind unchanged');
  assert.equal((await nativeMessages(page, 'syncReminder')).length, syncCount, 'no sync after a failed write');
  await page.waitForTimeout(450);
  await clickSettle(page, 'settings-fail-retry');
  assert.deepEqual((await state(page)).settings.remind, { enabled: true, hour: 9, minute: 15 }, 'retry wrote 09:15');
  s = await snapshot(page);
  assert.equal(s.time, '09:15', 'input shows 09:15');
  assert.equal(s.fail, null, 'block gone');

  step('permission denied (native shiziReminderStatus → applyReminderStatus): R-S02 texts; 去手机设置 posts openAppSettings');
  await page.evaluate(async mod => {
    const m = await import(mod);
    const { getStore } = await import('/src/store/store.js');
    m.applyReminderStatus(getStore(), { permission: 'denied' });
  }, SETTINGS_MOD);
  await page.waitForSelector(topSel('settings-remind-denied'));
  s = await snapshot(page);
  assert.equal(s.remindSub, '手机关了拾字的通知，收不到提醒', 'subtext R-S02.title');
  assert.equal(s.denied, '想收到提醒，请到手机设置里打开拾字的通知。去手机设置 ›', 'note R-S02.body + link');
  assert.equal((await state(page)).settings.remind.permission, 'denied', 'permission stored');
  await clickSettle(page, 'settings-open-system');
  assert.equal((await nativeMessages(page, 'openAppSettings')).length, 1, 'openAppSettings posted');
  await reloadToSettings(page);
  assert.equal((await snapshot(page)).remindSub, '手机关了拾字的通知，收不到提醒', 'denied state persists');

  step('turning reminders off syncs enabled:false; settings survive a reload');
  await clickSettle(page, 'settings-remind');
  msgs = await nativeMessages(page, 'syncReminder');
  assert.equal(msgs[msgs.length - 1].enabled, false, 'sync enabled:false');
  assert.equal((await nativeMessages(page, 'requestReminderPermission')).length, 0, 'no permission request when turning off');
  const final = (await state(page)).settings;
  assert.deepEqual(final, { sound: false, appearance: 'auto', remind: { enabled: false, hour: 9, minute: 15, permission: 'denied' } }, 'final settings (no large: the switch is gone and the v1 flag was dropped after its notice, D29)');
  await reloadToSettings(page);
  s = await snapshot(page);
  assert.equal(s.remind.checked, 'false', 'remind off after reload');
  assert.equal(s.sound.checked, 'false', 'sound still off');
  assert.equal(s.appearanceValue, '跟随系统', 'appearance auto');
  await page.evaluate(() => window.__shiziTest.reset());
  await goTab(page, 'home');
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), false, 'no theme left behind');
}
