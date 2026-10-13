// M5-6 存储不可用阻断页（02 M5-6；04 R-B09；01 §4；03 P55）。
//
// 场景：
//   1. 新 context，页面加载前让 Storage.prototype 的读写方法抛 SecurityError（addInitScript）：
//      阻断页可见、文案与 R-B09 三槽一致；没有 tab 条、首页、写字测试入口；代码里 nav.push('write') 也画不出写字页；
//      「再试一次」在仍被禁时留在阻断页；解禁（cookie 开关）后「再试一次」→ 回到首页 tab；全程零 pageerror / console.error。
//   2. 预置坏键（shizi.v2.settings 不是 JSON）启动：顶部提示出现一次、坏值搬到 shizi.corrupt.shizi.v2.settings、正常进首页；
//      关闭提示后消失；刷新后不再出现，仍正常进首页。
//   3. 写失败且回滚也失败（页面内包一层 Storage.prototype.setItem 注入）→ 阻断变体：有判断过的字时给导出入口；「再试一次」整页重启 → repair 回滚、回到首页。
//   4. 迁移变体（reportMigrationFailure，供 M5-4 调用）：阻断页多一句迁移说明、无导出入口；清除后回到 tab。
//   5. 原生左缘返回门控（01 §7；M5 修复回合遗留、M6 问题 L6）：装假原生桥（installNativeStub）——
//      场景 1 的阻断页显示时 backGestureEnabled 最后一次为 false；子页上触发阻断 → 由 true 变 false，解除后交还 true。

import { bootTestHost, installNativeStub, nativeMessages, resetStore, tid, waitNavIdle } from './helpers.mjs';

const COPY_MOD = '/src/config/copy/index.js';

// cookie szok=1 时放行（用来模拟「解决之后再试一次」）；否则每次调用都抛 SecurityError。
const DENY_STORAGE = () => {
  const deny = () => !/(?:^|;\s*)szok=1/.test(document.cookie);
  const proto = Storage.prototype;
  for (const name of ['getItem', 'setItem', 'removeItem', 'key', 'clear']) {
    const orig = proto[name];
    proto[name] = function patched(...args) {
      if (deny()) throw new DOMException('The operation is insecure.', 'SecurityError');
      return orig.apply(this, args);
    };
  }
};

async function gateValues(page) {
  return (await nativeMessages(page, 'backGestureEnabled')).map(m => m.value);
}

async function copyOf(page, key) {
  return page.evaluate(async ({ mod, k }) => (await import(mod)).t(k), { mod: COPY_MOD, k: key });
}

async function blockSnapshot(page) {
  return page.evaluate(() => {
    const q = sel => document.querySelector(sel);
    const block = q('[data-testid="block-screen"]');
    return {
      block: !!block,
      kind: block ? block.dataset.blockKind : null,
      blocked: q('.sz-app') ? q('.sz-app').dataset.blocked || null : null,
      title: q('[data-testid="block-title"]') ? q('[data-testid="block-title"]').textContent.trim() : null,
      lines: [...document.querySelectorAll('[data-testid="block-body"] p')].map(p => p.textContent.trim()),
      retry: q('[data-testid="block-retry"]') ? q('[data-testid="block-retry"]').textContent.trim() : null,
      exportBtn: !!q('[data-testid="block-export"]'),
      tabs: !!q('[role="tablist"]'),
      home: !!q('[data-testid="screen-home"]'),
      writeEntry: !!q('[data-testid="write-test-entry"]') || !!q('[data-testid="home-start"]'),
      writeScreen: !!q('[data-testid="write-screen"]'),
      focusInBlock: !!(block && block.contains(document.activeElement)),
    };
  });
}

async function scenarioDenied(page, ctx) {
  const { assert, baseURL } = ctx;
  ctx.step('新 context：Storage 抛 SecurityError → 阻断页');
  const context = await page.context().browser().newContext({ viewport: ctx.viewport, deviceScaleFactor: 2, locale: 'zh-CN' });
  const errors = [];
  try {
    await context.addInitScript(DENY_STORAGE);
    const p = await context.newPage();
    p.on('pageerror', error => errors.push(`pageerror: ${error && error.message}`));
    p.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await installNativeStub(p);
    await p.goto(`${baseURL}/`);
    await p.waitForSelector(tid('block-screen'));
    await p.waitForTimeout(200);
    const gate = await gateValues(p);
    assert.ok(gate.length > 0, 'native stub received backGestureEnabled while the block page is shown');
    assert.equal(gate[gate.length - 1], false, 'block page shown → last backGestureEnabled is false (01 §7)');

    const denied = await p.evaluate(() => {
      try {
        window.localStorage.getItem('x');
        return false;
      } catch (error) {
        return error && error.name === 'SecurityError';
      }
    });
    assert.ok(denied, 'init script makes Storage.prototype throw SecurityError');

    const snap = await blockSnapshot(p);
    assert.ok(snap.block, 'block page is visible');
    assert.equal(snap.kind, 'unavailable', 'block kind is unavailable');
    assert.equal(snap.blocked, 'unavailable', '.sz-app carries data-blocked=unavailable');
    assert.equal(snap.title, await copyOf(p, 'R-B09.title'), 'title matches R-B09.title');
    assert.equal(snap.title, '无法保存', 'title text is 无法保存');
    assert.deepEqual(snap.lines, await copyOf(p, 'R-B09.body'), 'body lines match R-B09.body');
    assert.equal(snap.retry, await copyOf(p, 'R-B09.retry'), 'retry button reads R-B09.retry');
    assert.equal(snap.retry, '再试一次', 'retry text is 再试一次');
    assert.equal(snap.exportBtn, false, 'no export entry when storage is unreadable');
    assert.equal(snap.tabs, false, 'no tab bar while blocked');
    assert.equal(snap.home, false, 'home screen is not rendered');
    assert.equal(snap.writeEntry, false, 'no write entry (home-start / write-test-entry) reachable');
    assert.ok(snap.focusInBlock, 'focus is on the block page');
    const role = await p.getAttribute(tid('block-screen'), 'role');
    assert.equal(role, 'alertdialog', 'block page is an alertdialog');

    const status = await p.evaluate(async () => {
      const { getStore } = await import('/src/store/store.js');
      const s = getStore().status;
      return { available: s.available, kind: s.unavailableKind };
    });
    assert.deepEqual(status, { available: false, kind: 'security' }, 'store.status: unavailable (security)');

    ctx.step('代码里推入写字页也画不出来');
    await p.evaluate(async () => {
      const { nav } = await import('/src/ui/router.js');
      nav.push('write', { slot: 'A' });
    });
    await p.waitForTimeout(500);
    const afterPush = await blockSnapshot(p);
    assert.equal(afterPush.writeScreen, false, 'write screen stays unreachable after nav.push');
    assert.ok(afterPush.block, 'block page still shown after nav.push');
    const gateAfterPush = await gateValues(p);
    assert.equal(gateAfterPush[gateAfterPush.length - 1], false, 'nav.push while blocked does not re-enable backGestureEnabled');
    const commit = await p.evaluate(async () => {
      const { getStore } = await import('/src/store/store.js');
      const r = getStore().commit('e2e-probe', d => {
        d.settings = { ...(d.settings || {}) };
      });
      return { ok: r.ok, kind: r.error ? r.error.kind : null };
    });
    assert.deepEqual(commit, { ok: false, kind: 'unavailable' }, 'store.commit refuses while unavailable');
    await p.evaluate(() => history.back());
    await p.waitForTimeout(500);

    ctx.step('仍被禁时「再试一次」留在阻断页');
    await p.click(tid('block-retry'));
    await p.waitForTimeout(300);
    const again = await blockSnapshot(p);
    assert.ok(again.block, 'block page remains after retry while storage still denied');
    assert.equal(again.tabs, false, 'still no tab bar');

    ctx.step('解禁后「再试一次」→ 回到首页');
    await context.addCookies([{ name: 'szok', value: '1', url: baseURL }]);
    await p.waitForTimeout(450);
    await p.click(tid('block-retry'));
    await p.waitForSelector(tid('screen-home'));
    await waitNavIdle(p);
    const recovered = await blockSnapshot(p);
    assert.equal(recovered.block, false, 'block page gone after storage is allowed and retry');
    assert.ok(recovered.tabs, 'tab bar is back');
    assert.ok(recovered.home, 'home screen is rendered');
    const status2 = await p.evaluate(async () => {
      const { getStore } = await import('/src/store/store.js');
      return getStore().status.available;
    });
    assert.equal(status2, true, 'store.status.available=true after retry');
    await p.close();
  } finally {
    await context.close();
  }
  assert.deepEqual(errors, [], 'blocked context: zero pageerror / console.error');
}

async function scenarioCorrupt(page, ctx) {
  const { assert, baseURL } = ctx;
  ctx.step('预置坏键启动 → 顶部提示一次');
  await bootTestHost(page, baseURL);
  await resetStore(page);
  await page.evaluate(() => window.localStorage.setItem('shizi.v2.settings', '{not json'));
  await page.goto(`${baseURL}/?test=1`);
  await page.waitForSelector('.sz-app');
  await page.waitForSelector(tid('corrupt-notice'));
  await page.waitForSelector(tid('screen-home'));
  await waitNavIdle(page);

  const shown = await page.evaluate(async () => {
    const { getStore } = await import('/src/store/store.js');
    const el = document.querySelector('[data-testid="corrupt-notice"]');
    return {
      text: el.querySelector('p').textContent.trim(),
      keys: el.dataset.keys,
      role: el.getAttribute('role'),
      pending: getStore().status.corruptNotice,
      raw: window.localStorage.getItem('shizi.v2.settings'),
      quarantined: window.localStorage.getItem('shizi.corrupt.shizi.v2.settings'),
      block: !!document.querySelector('[data-testid="block-screen"]'),
      tabs: !!document.querySelector('[role="tablist"]'),
    };
  });
  assert.equal(shown.text, await copyOf(page, 'X-SYS.corruptNotice'), 'notice text matches X-SYS.corruptNotice');
  assert.equal(shown.keys, 'shizi.v2.settings', 'notice lists the quarantined key');
  assert.equal(shown.role, 'status', 'notice is a status region');
  assert.equal(shown.pending, null, 'store notice acked once shown');
  assert.equal(shown.raw, null, 'bad key removed from its v2 slot');
  assert.equal(shown.quarantined, '{not json', 'bad value moved to shizi.corrupt.shizi.v2.settings');
  assert.equal(shown.block, false, 'bad key does not block');
  assert.ok(shown.tabs, 'home tab root rendered normally');

  ctx.step('关闭提示');
  await page.click(tid('corrupt-notice-close'));
  await page.waitForSelector(tid('corrupt-notice'), { state: 'detached' });
  assert.ok(true, 'notice closes');

  ctx.step('刷新：不再提示，正常进首页');
  await page.reload();
  await page.waitForSelector(tid('screen-home'));
  await waitNavIdle(page);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    notice: !!document.querySelector('[data-testid="corrupt-notice"]'),
    block: !!document.querySelector('[data-testid="block-screen"]'),
    tabs: !!document.querySelector('[role="tablist"]'),
    quarantined: window.localStorage.getItem('shizi.corrupt.shizi.v2.settings'),
  }));
  assert.equal(after.notice, false, 'notice does not reappear after reload');
  assert.equal(after.block, false, 'no block page after reload');
  assert.ok(after.tabs, 'home tab root after reload');
  assert.equal(after.quarantined, '{not json', 'quarantined copy kept');
  await resetStore(page);
}

async function scenarioBlockedAndMigration(page, ctx) {
  const { assert, baseURL } = ctx;
  ctx.step('写失败且回滚也失败 → 阻断变体（可导出）；「再试一次」重启后按 txn 回滚、回到首页');
  await bootTestHost(page, baseURL);
  await resetStore(page);
  const seeded = await page.evaluate(async () => {
    const { makeRecord } = await import('/src/core/records.js');
    const at = window.__shiziTest.now();
    const record = makeRecord({ id: 'r1', cardKey: 'base:永', sessionId: 's1', kind: 'judged', judgment: 'correct', at,
      help: { hints: 0, answerSeen: false, traced: false } });
    const r = window.__shiziTest.seed({ records: { [record.localDay.slice(0, 7)]: [record] } });
    return !!(r && r.ok);
  });
  assert.ok(seeded, 'seeded one judged record');
  const before = await page.evaluate(() => window.__shiziTest.getRawKeys('shizi.v2.'));
  const result = await page.evaluate(async () => {
    const { makeRecord } = await import('/src/core/records.js');
    const at = window.__shiziTest.now();
    const extra = makeRecord({ id: 'r2', cardKey: 'base:水', sessionId: 's1', kind: 'judged', judgment: 'wrong', at,
      help: { hints: 0, answerSeen: false, traced: false } });
    const month = extra.localDay.slice(0, 7);
    // 第一次写 records 放行，之后对 shizi.v2.*（txn 除外）的 setItem 一律抛错：后面的键写失败 → 回滚 records 也失败 → 阻断。
    const orig = Storage.prototype.setItem;
    let recordsWritten = false;
    Storage.prototype.setItem = function failing(key, value) {
      if (typeof key === 'string' && key.indexOf('shizi.v2.') === 0 && key !== 'shizi.v2.txn') {
        if (!recordsWritten && key.indexOf('shizi.v2.records') === 0) recordsWritten = true;
        else throw new Error('e2e injected write failure');
      }
      return orig.call(this, key, value);
    };
    window.__e2eRestoreSetItem = () => {
      Storage.prototype.setItem = orig;
    };
    const { getStore } = await import('/src/store/store.js');
    const r = getStore().commit('e2e-block', d => {
      d.records[month] = [...(d.records[month] || []), extra];
      d.settings = { ...(d.settings || {}), sound: false }; // settings 排在 records 之后写：它失败 → 回滚 records
    });
    window.__e2eRestoreSetItem();
    return { ok: r.ok, kind: r.error ? r.error.kind : null, blocked: !!getStore().status.blocked };
  });
  assert.deepEqual(result, { ok: false, kind: 'blocked', blocked: true }, 'commit fails with blocked and store.status.blocked is set');
  await page.waitForSelector(tid('block-screen'));
  const snap = await blockSnapshot(page);
  assert.equal(snap.kind, 'blocked', 'block page kind is blocked');
  assert.equal(snap.title, '无法保存', 'blocked variant uses R-B09 title');
  assert.ok(snap.exportBtn, 'export entry offered when storage is readable and there are judged characters');
  assert.equal(await page.textContent(tid('block-export')), await copyOf(page, 'R-B02.export'), 'export button reads R-B02.export');
  assert.equal(snap.tabs, false, 'no tab bar while blocked');
  await page.waitForTimeout(450);
  await Promise.all([page.waitForEvent('load'), page.click(tid('block-retry'))]);
  await page.waitForSelector(tid('screen-home'));
  await waitNavIdle(page);
  const after = await page.evaluate(() => ({
    block: !!document.querySelector('[data-testid="block-screen"]'),
    status: window.__shiziTest.getStatus(),
    raw: window.__shiziTest.getRawKeys('shizi.v2.'),
  }));
  assert.equal(after.block, false, 'after restart the block page is gone');
  assert.equal(after.status.blocked, null, 'store not blocked after restart');
  assert.deepEqual(after.raw, before, 'v2 keys rolled back to their pre-commit values');
  await page.evaluate(() => {
    for (const k of Object.keys(window.__shiziTest.getRawKeys('shizi.corrupt.'))) window.localStorage.removeItem(k);
  });

  ctx.step('迁移变体：reportMigrationFailure → 阻断页带迁移说明；清除后回到 tab');
  await page.evaluate(async () => (await import('/src/ui/screens/block/index.js')).reportMigrationFailure({ reason: 'quota' }));
  await page.waitForSelector(tid('block-migration'));
  const mig = await blockSnapshot(page);
  assert.equal(mig.kind, 'migration', 'block page kind is migration');
  assert.equal(mig.lines[mig.lines.length - 1], await copyOf(page, 'X-SYS.blockMigration'), 'migration line matches X-SYS.blockMigration');
  assert.equal(mig.exportBtn, false, 'no export entry in the migration variant');
  assert.equal(mig.tabs, false, 'no tab bar in the migration variant');
  await page.evaluate(async () => (await import('/src/ui/screens/block/index.js')).clearMigrationFailure());
  await page.waitForSelector(tid('screen-home'));
  assert.ok(true, 'tabs return after clearMigrationFailure');
  await resetStore(page);
}

async function scenarioGestureGateFromSubPage(page, ctx) {
  const { assert, baseURL } = ctx;
  ctx.step('假原生桥：子页上触发阻断 → backGestureEnabled true→false；解除后交还 true');
  const context = await page.context().browser().newContext({ viewport: ctx.viewport, deviceScaleFactor: 2, locale: 'zh-CN' });
  const errors = [];
  try {
    const p = await context.newPage();
    p.on('pageerror', error => errors.push(`pageerror: ${error && error.message}`));
    p.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await installNativeStub(p);
    await bootTestHost(p, baseURL);
    await resetStore(p);
    let gate = await gateValues(p);
    assert.equal(gate[gate.length - 1], false, 'tab root → last backGestureEnabled is false');

    await p.evaluate(async () => {
      const { nav } = await import('/src/ui/router.js');
      nav.push('backup');
    });
    await waitNavIdle(p);
    gate = await gateValues(p);
    assert.equal(gate[gate.length - 1], true, 'sub page (backup) → last backGestureEnabled is true');

    await p.evaluate(async () => (await import('/src/ui/screens/block/index.js')).reportMigrationFailure({ reason: 'quota' }));
    await p.waitForSelector(tid('block-screen'));
    await p.waitForTimeout(200);
    gate = await gateValues(p);
    assert.equal(gate[gate.length - 1], false, 'block page over a sub page → last backGestureEnabled is false');

    await p.evaluate(async () => (await import('/src/ui/screens/block/index.js')).clearMigrationFailure());
    await p.waitForSelector(tid('block-screen'), { state: 'detached' });
    await waitNavIdle(p);
    gate = await gateValues(p);
    assert.equal(gate[gate.length - 1], true, 'block cleared back on the sub page → backGestureEnabled handed back as true');
    await resetStore(p);
    await p.close();
  } finally {
    await context.close();
  }
  assert.deepEqual(errors, [], 'gesture-gate context: zero pageerror / console.error');
}

export default async function run(page, ctx) {
  await scenarioDenied(page, ctx);
  await scenarioCorrupt(page, ctx);
  await scenarioBlockedAndMigration(page, ctx);
  await scenarioGestureGateFromSubPage(page, ctx);
}
