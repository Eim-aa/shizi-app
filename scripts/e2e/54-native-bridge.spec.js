// M5-3 原生桥时序（02 M5-3；01 §2 启动顺序、§8.1、§8.2；04 R-B06）。用假的 window.webkit.messageHandlers.shiziNative 代替 iOS 壳。
//
//   1. pageReady 时机：app.js 在挂好 UI、bridge.markReady(store) 之后才 postMessage pageReady，每次页面加载恰好一次
//      （M5-5 的 startReminder 也会 markReady，幂等）；发出那一刻桥已就绪、积压队列为空、界面已挂载，除 shiziCardSaved（图片预览
//      第一次保存时注册）外五个全局都有实现。
//      刷新是新文档：再发一次（原生在 didCommit 把 pageReady 复位，等新页面的这一条）。
//   2. 队列回放：bridge.js 模块顶层一定义全局（setter 陷阱捕获那一刻），就在 markReady 之前调用原生全局——
//      提醒深链连点两次只留最后一个 cardKey，就绪后以 B 组开这个字（P47，M5-5 实现）；返回值都是 true
//      （Swift 只在 evaluate 返回 true 后清 key）。
//   3. R-B06（原生预检的拒绝原因在页内显示，原生不弹 alert、不 reload）：就绪前到达的 shiziBackupRejected({reason:'tooLarge'})
//      回放后推入备份页并显示「这个文件不是拾字的备份…」；就绪后「从备份文件恢复」只发 pickBackup（不开网页文件选择），
//      shiziBackupRejected invalid / tooLarge / cancelled 与 shiziBackupPicked(非备份文本) 各显示对应 R-B06 句；
//      全程 shizi.* 键一个字节都没变，页面没有 reload。
//   4. 不在原生壳：markReady 照常（桥就绪），postNative 返回 false，不报错。

import { tid, topSel, waitNavIdle } from './helpers.mjs';

const COPY_MOD = '/src/config/copy/index.js';
const NATIVE_GLOBALS = [
  'shiziOpenReminderTarget', 'shiziBackupPicked', 'shiziBackupRejected', 'markBackupExported', 'shiziCardSaved', 'shiziReminderStatus',
  'shiziAccessibilityStatus', 'shiziContentSize',
];

// 页面加载前：假原生通道（记录每条消息；pageReady 那一刻给桥拍快照），并在 bridge.js 定义最后一个全局时安排「就绪前」的原生调用。
// 调用哪些由 URL 参数 e2eEarly 决定：reminder（深链连点两次）| tooLarge | invalid（备份拒绝）。
function installFakeNative() {
  const globals = [
    'shiziOpenReminderTarget', 'shiziBackupPicked', 'shiziBackupRejected', 'markBackupExported', 'shiziCardSaved', 'shiziReminderStatus',
    'shiziAccessibilityStatus', 'shiziContentSize',
  ];
  window.__nativeMsgs = [];
  window.__early = null;
  const snapshot = () => {
    const b = window.__shiziBridge;
    const app = document.querySelector('.sz-app');
    return {
      ready: !!(b && b.isReady()),
      pending: b ? b.pending().map(p => p.name) : null,
      handlers: b && typeof b.hasHandler === 'function' ? globals.filter(n => b.hasHandler(n)) : null,
      mounted: !!app,
      topScreen: app ? app.dataset.topScreen || null : null,
      testHooks: typeof window.__shiziTest === 'object',
    };
  };
  window.webkit = {
    messageHandlers: {
      shiziNative: {
        postMessage(msg) {
          const m = JSON.parse(JSON.stringify(msg));
          if (m.type === 'pageReady') m.at = snapshot();
          window.__nativeMsgs.push(m);
        },
      },
    },
  };
  const early = new URLSearchParams(location.search).get('e2eEarly');
  if (!early) return;
  let impl;
  Object.defineProperty(window, 'shiziReminderStatus', {
    configurable: true,
    enumerable: true,
    get() { return impl; },
    set(fn) {
      impl = fn;
      // bridge.js 模块顶层刚定义完全部全局；app.js 还在等 store / 界面的动态 import，桥未就绪。
      setTimeout(() => {
        const b = window.__shiziBridge;
        const out = { readyBefore: !!(b && b.isReady()), returns: [] };
        if (early === 'reminder') {
          out.returns.push(window.shiziOpenReminderTarget('base:永'));
          out.returns.push(window.shiziOpenReminderTarget('base:和'));
        } else if (early === 'tooLarge' || early === 'invalid') {
          out.returns.push(window.shiziBackupRejected({ reason: early }));
        } else if (early === 'a11y') {
          // P116：读屏状态在就绪前到达两次，队列只留最后一次
          out.returns.push(window.shiziAccessibilityStatus({ voiceOver: false, switchControl: false }));
          out.returns.push(window.shiziAccessibilityStatus({ voiceOver: true, switchControl: false }));
        } else if (early === 'contentSize') {
          // P130：系统字号在就绪前到达两次，队列只留最后一次
          out.returns.push(window.shiziContentSize({ category: 'XXXL', scale: 1.3529 }));
          out.returns.push(window.shiziContentSize({ category: 'AX3', scale: 2.3529 }));
          out.kBefore = getComputedStyle(document.documentElement).getPropertyValue('--k').trim();
        }
        out.pending = b ? b.pending().map(p => ({ name: p.name, args: p.args })) : null;
        window.__early = out;
      }, 0);
    },
  });
}

async function boot(page, baseURL, early) {
  await page.goto(`${baseURL}/?test=1${early ? `&e2eEarly=${early}` : ''}`);
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await page.waitForFunction(() => (window.__nativeMsgs || []).some(m => m.type === 'pageReady'));
  await waitNavIdle(page);
}

const msgs = (page, type) => page.evaluate(t => window.__nativeMsgs.filter(m => !t || m.type === t), type || null);

async function note(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="backup-note"]');
    return el ? { kind: el.dataset.kind, text: el.textContent.trim() } : null;
  });
}

async function waitNote(page, kind) {
  await page.waitForFunction(k => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="backup-note"]');
    return !!el && el.dataset.kind === k;
  }, kind);
  return note(page);
}

export default async function nativeBridge(page, ctx) {
  const { assert, baseURL } = ctx;
  await page.addInitScript(installFakeNative);
  const copy = await (async () => {
    await page.goto(`${baseURL}/?test=1`);
    await page.waitForSelector('.sz-app');
    return page.evaluate(async mod => {
      const { t } = await import(mod);
      return { notBackup: t('R-B06.notBackup'), cancelled: t('R-B06.cancelled') };
    }, COPY_MOD);
  })();

  // ------------------------------------------------------------ 1
  ctx.step('pageReady is posted once, after markReady, with the UI mounted and the queue empty');
  await boot(page, baseURL, null);
  let ready = await msgs(page, 'pageReady');
  assert.equal(ready.length, 1, 'exactly one pageReady per page load');
  const at = ready[0].at;
  assert.equal(at.ready, true, 'bridge was ready when pageReady was posted');
  assert.deepEqual(at.pending, [], 'no native call still queued at pageReady');
  assert.equal(at.mounted, true, 'UI mounted before pageReady');
  assert.ok(typeof at.topScreen === 'string' && at.topScreen.length > 0, `a screen is on top at pageReady (${at.topScreen})`);
  assert.equal(at.testHooks, true, 'store booted (test hooks mounted) before pageReady');
  // shiziCardSaved 由图片预览在第一次「保存图片」时注册（之前到达的调用照常排队）；其余五个在 pageReady 前已有实现。
  assert.deepEqual(at.handlers, NATIVE_GLOBALS.filter(n => n !== 'shiziCardSaved'), 'every other native global has an implementation at pageReady');
  const order = await page.evaluate(() => window.__nativeMsgs.map(m => m.type));
  assert.equal(order.filter(t => t === 'pageReady').length, 1, `message order: ${order.join(', ')}`);
  await page.waitForTimeout(600);
  assert.equal((await msgs(page, 'pageReady')).length, 1, 'no late second pageReady (markReady is idempotent)');

  ctx.step('reload = new document → pageReady again (native resets pageReady on didCommit)');
  await page.evaluate(() => { window.__e2eAlive = true; });
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => (window.__nativeMsgs || []).some(m => m.type === 'pageReady'));
  ready = await msgs(page, 'pageReady');
  assert.equal(ready.length, 1, 'one pageReady on the reloaded page');
  assert.equal(ready[0].at.ready, true, 'ready again after reload');
  assert.equal(await page.evaluate(() => window.__e2eAlive === true), false, 'it really was a new document');

  // ------------------------------------------------------------ 2
  ctx.step('deep link before ready: only the last cardKey is kept, replayed after markReady (P47 → B group)');
  await page.evaluate(() => window.__shiziTest.reset());
  await boot(page, baseURL, 'reminder');
  let early = await page.evaluate(() => window.__early);
  assert.ok(early, 'early calls ran');
  assert.equal(early.readyBefore, false, 'the calls really arrived before bridge.markReady');
  assert.deepEqual(early.returns, [true, true], 'globals return true (= page accepted) even before ready');
  assert.deepEqual(early.pending, [{ name: 'shiziOpenReminderTarget', args: ['base:和'] }], 'queue keeps only the last deep link');
  ready = await msgs(page, 'pageReady');
  assert.equal(ready.length, 1, 'one pageReady');
  assert.deepEqual(ready[0].at.pending, [], 'deep link replayed before pageReady');
  await page.waitForFunction(() => {
    const st = window.__shiziTest.getState();
    return !!(st.sessions && st.sessions.B);
  });
  const b = await page.evaluate(() => window.__shiziTest.getState().sessions.B);
  assert.deepEqual(b.queue, ['base:和'], 'B group opened with the last target only');
  assert.equal(b.queue.indexOf('base:永'), -1, 'the superseded target was dropped');

  ctx.step('accessibility status before ready (P116): only the last one is kept, replayed before pageReady → the page reads it');
  await page.evaluate(() => window.__shiziTest.reset());
  await boot(page, baseURL, 'a11y');
  early = await page.evaluate(() => window.__early);
  assert.equal(early.readyBefore, false, 'the status arrived before bridge.markReady');
  assert.deepEqual(early.returns, [true, true], 'global returns true (= page accepted) even before ready');
  assert.deepEqual(early.pending, [{ name: 'shiziAccessibilityStatus', args: [{ voiceOver: true, switchControl: false }] }], 'queue keeps only the last status');
  ready = await msgs(page, 'pageReady');
  assert.deepEqual(ready[0].at.pending, [], 'status replayed before pageReady');
  assert.ok(ready[0].at.handlers.includes('shiziAccessibilityStatus'), 'implementation registered before pageReady');
  const status = await page.evaluate(async () => {
    const m = await import('/src/platform/accessibility.js');
    return { status: m.getAccessibilityStatus(), active: m.assistiveTechActive() };
  });
  assert.deepEqual(status, { status: { voiceOver: true, switchControl: false }, active: true }, 'the page sees VoiceOver on');

  ctx.step('system text size before ready (P130 / D29): only the last one is kept, replayed before pageReady → --k and data-ax applied');
  await page.evaluate(() => window.__shiziTest.reset());
  await boot(page, baseURL, 'contentSize');
  early = await page.evaluate(() => window.__early);
  assert.equal(early.readyBefore, false, 'the size arrived before bridge.markReady');
  assert.deepEqual(early.returns, [true, true], 'global returns true (= page accepted) even before ready');
  assert.deepEqual(early.pending, [{ name: 'shiziContentSize', args: [{ category: 'AX3', scale: 2.3529 }] }], 'queue keeps only the last size');
  assert.equal(early.kBefore, '1', '--k is still the tokens.css default before ready');
  ready = await msgs(page, 'pageReady');
  assert.deepEqual(ready[0].at.pending, [], 'size replayed before pageReady');
  assert.ok(ready[0].at.handlers.includes('shiziContentSize'), 'implementation registered before pageReady');
  const sized = await page.evaluate(() => {
    const root = document.documentElement;
    return { k: getComputedStyle(root).getPropertyValue('--k').trim(), ax: root.getAttribute('data-ax'), size: root.getAttribute('data-text-size') };
  });
  assert.deepEqual(sized, { k: '2', ax: '3', size: 'AX3' }, 'AX3 → --k 2 (policy.contentSizeScale.AX3), data-ax="3"');
  await page.evaluate(() => window.shiziContentSize({ category: 'L', scale: 1 }));

  // ------------------------------------------------------------ 3
  ctx.step('backup rejection before ready (tooLarge) → replayed → backup page shows R-B06');
  await page.evaluate(() => window.__shiziTest.reset());
  await boot(page, baseURL, 'tooLarge');
  early = await page.evaluate(() => window.__early);
  assert.equal(early.readyBefore, false, 'rejection arrived before ready');
  assert.deepEqual(early.pending.map(p => p.name), ['shiziBackupRejected'], 'queued');
  await page.waitForSelector(topSel('backup-screen'));
  let n = await waitNote(page, 'notBackup');
  assert.equal(n.text, copy.notBackup, 'tooLarge (> 10 MB) → R-B06「不是拾字的备份」');

  ctx.step('backup rejection before ready (invalid) → R-B06');
  await boot(page, baseURL, 'invalid');
  await page.waitForSelector(topSel('backup-screen'));
  n = await waitNote(page, 'notBackup');
  assert.equal(n.text, copy.notBackup, 'invalid → R-B06「不是拾字的备份」');

  ctx.step('ready: 从备份文件恢复 → pickBackup only; each rejection / non-backup text shows R-B06 and writes nothing');
  await boot(page, baseURL, null);
  const rawBefore = await page.evaluate(() => JSON.stringify(window.__shiziTest.getRawKeys('shizi.')));
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('backup', {});
  });
  await page.waitForSelector(topSel('backup-screen'));
  await waitNavIdle(page);
  await page.evaluate(() => { window.__e2eAlive = true; });
  const chooser = [];
  page.on('filechooser', fc => chooser.push(fc));
  const cases = [
    { run: () => page.evaluate(() => window.shiziBackupRejected({ reason: 'invalid' })), kind: 'notBackup', text: copy.notBackup, label: 'invalid' },
    { run: () => page.evaluate(() => window.shiziBackupRejected({ reason: 'tooLarge' })), kind: 'notBackup', text: copy.notBackup, label: 'tooLarge' },
    { run: () => page.evaluate(() => window.shiziBackupPicked('this is not json')), kind: 'notBackup', text: copy.notBackup, label: 'picked non-backup text' },
    { run: () => page.evaluate(() => window.shiziBackupRejected({ reason: 'cancelled' })), kind: 'cancelled', text: copy.cancelled, label: 'cancelled' },
  ];
  for (const c of cases) {
    const picks = (await msgs(page, 'pickBackup')).length;
    await page.click(topSel('backup-restore'));
    assert.equal((await msgs(page, 'pickBackup')).length, picks + 1, `${c.label}: posted pickBackup`);
    assert.equal(await note(page), null, `${c.label}: note cleared while the native picker is up`);
    assert.equal(await c.run(), true, `${c.label}: global returned true`);
    n = await waitNote(page, c.kind);
    assert.equal(n.text, c.text, `${c.label} → ${c.kind}`);
    await waitNavIdle(page);
  }
  assert.equal(chooser.length, 0, 'no web file chooser inside the native shell');
  assert.equal(await page.evaluate(() => JSON.stringify(window.__shiziTest.getRawKeys('shizi.'))), rawBefore, 'no shizi.* key changed');
  assert.equal(await page.evaluate(() => window.__e2eAlive === true), true, 'no page reload');
  assert.deepEqual(await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct')), [], 'no write bypassed storage.js');
  assert.equal(await page.locator(tid('backup-restore-confirm')).count(), 0, 'no restore confirm for rejected files');

  // ------------------------------------------------------------ 4
  ctx.step('outside the native shell: bridge still becomes ready, postNative returns false');
  const plain = await page.context().browser().newContext({ viewport: ctx.viewport, locale: 'zh-CN' });
  try {
    const p2 = await plain.newPage();
    const errors = [];
    p2.on('pageerror', e => errors.push(String(e)));
    await p2.goto(`${baseURL}/?test=1`);
    await p2.waitForSelector('.sz-app');
    await p2.waitForFunction(() => window.__shiziBridge && window.__shiziBridge.isReady());
    const r = await p2.evaluate(async () => {
      const m = await import('/src/platform/bridge.js');
      return { native: m.bridge.isNative(), post: m.postNative('pageReady', {}), pending: m.bridge.pending().length };
    });
    assert.deepEqual(r, { native: false, post: false, pending: 0 }, 'plain browser: ready, not native, postNative false');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await plain.close();
  }
}
