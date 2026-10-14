// 审查整改 F1：进程被杀 / 冷启动后恢复到离开时的页面与阶段（真机 Q32 / Q34；需求 R-W13；03 P32 / P108；01 §3.6 / §7 / §9）。
//
// 「进程被杀」的模拟：页面切到后台（visibilitychange hidden，写字页与路由记忆都在这时写盘）→ 取 context.storageState()
// （只有 localStorage）→ 关掉整个 browser context（不跑 unload）→ 用这份 storageState 开一个**全新的 browser context**再打开
// /?test=1：没有 history.state、没有 sessionStorage、没有内存——与 App 进程被杀后 WKWebView 重新加载同形。
// 冷启动恢复按 route-memory.js 判定；这里的 bootTestHost 都带 {coldRoute:true}（不装 freshRoute）。
//
// 场景（A 会话 永 / 和 / 春 / 大 / 中）：
//   1. 回忆写了一半：两笔 → 杀 → 重开：直接回写字页（不经首页）、同一字、recall、两笔都在、固化层有墨；返回键退回首页
//      （history 条目按层重建）。
//   2. 判断页：写好了 → 杀 → 重开：仍在判断页，「你的书写」有墨、参考字形 ready。
//   3. 看答案后：接着写 → 看答案确认 → 杀 → 重开：看答案卡片 ready，answer-seen 只有一条。
//   4. 描一遍：描一笔 → 杀 → 重开：描一遍、一笔、描红层 ready；返回首页；answer-seen 仍一条。
//   5. 过期不恢复（P108）：同一份存档把离开时刻改到 7 小时前 → 落首页（getRoutePlan.reason='stale'），写字页现场仍在（首页可继续）。
//   6. 备份页撤销（P32 resume）：替换后撤销底栏在 → 杀 → 重开：回备份页、撤销底栏在 → 撤销 → 记录回到替换前。
//      同一份存档但从别处进入（离开时刻过期 → 落首页 → 再推入备份页）：不给撤销、遗留副本删掉。
//   7. 提醒深链优先：a. 深链在桥上排队（冷启动、就绪前）→ 不恢复，首页 + 「这次选的字」写字页；
//      b. 就绪后才到（iOS 等 pageReady 再派发）→ 先静默退回首页，再开 B；栈只有两层，返回到首页。
//   每个 context：零 pageerror / console.error；全部写入经 storage.js（getWriteLog / getRouteWriteLog 无 via=direct）。

import {
  bootTestHost, canvasInk, drawStroke, HORIZONTAL, openWrite, PRESS_SETTLE_MS, ROUTE_KEY, seedSession, tid, topSel, VERTICAL,
  waitNavIdle, writeSnapshot, tap,
} from './helpers.mjs';

const CHARS = ['永', '和', '春', '大', '中'];
const BACKUP_MOD = '/src/ui/screens/mine/backup.js';
const HOUR = 3600 * 1000;

// ------------------------------------------------------------------ 进程模型

async function newApp(ctx, browser, { storageState = undefined, init = null } = {}) {
  const context = await browser.newContext({ viewport: ctx.viewport, deviceScaleFactor: 2, locale: 'zh-CN', storageState });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(`pageerror: ${e && e.message}`));
  p.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  if (init) await p.addInitScript(init.fn, init.arg);
  return { context, p, errors };
}

/** 冷启动：全新 context + 存档，打开测试宿主首页 URL（不带 history.state）。 */
async function launch(ctx, browser, storageState, opts = {}) {
  const app = await newApp(ctx, browser, { storageState, init: opts.init || null });
  await bootTestHost(app.p, ctx.baseURL, { coldRoute: true });
  return app;
}

async function effects(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
}

async function hideDocument(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
  });
}

/** 切到主屏再结束进程：hidden → 存档 → 关 context（不跑 unload）。返回存档。 */
async function kill(app, ctx) {
  await hideDocument(app.p);
  await effects(app.p);
  const direct = await app.p.evaluate(() => window.__shiziTest.getWriteLog().concat(window.__shiziTest.getRouteWriteLog())
    .filter(e => e.via === 'direct').length);
  ctx.assert.equal(direct, 0, 'this process: every write went through storage.js');
  ctx.assert.deepEqual(app.errors, [], 'this process: no pageerror / console.error');
  const state = await app.context.storageState();
  await app.context.close();
  return state;
}

async function close(app, ctx) {
  ctx.assert.deepEqual(app.errors, [], 'this process: no pageerror / console.error');
  await app.context.close();
}

/** 存档里某个 localStorage 键（同源）。 */
function storedItem(storageState, key) {
  for (const o of storageState.origins || []) for (const e of o.localStorage || []) if (e.name === key) return e.value;
  return null;
}

/** 改存档里的路由提示（例如把离开时刻往前挪）。 */
function withRoute(storageState, edit) {
  const copy = JSON.parse(JSON.stringify(storageState));
  for (const o of copy.origins || []) {
    for (const e of o.localStorage || []) if (e.name === ROUTE_KEY) e.value = JSON.stringify(edit(JSON.parse(e.value)));
  }
  return copy;
}

// ------------------------------------------------------------------ 页面读数

async function app(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.sz-app');
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return {
      top: el.dataset.topScreen,
      depth: Number(el.dataset.depth),
      slot: top ? top.dataset.slot : null,
      historyDepth: window.history.state ? window.history.state.depth : null,
    };
  });
}

async function plan(page) {
  return page.evaluate(() => window.__shiziTest.getRoutePlan());
}

async function facts(page) {
  return page.evaluate(() => {
    const st = window.__shiziTest.getState();
    const records = [];
    for (const m of Object.keys(st.records || {})) {
      const v = st.records[m];
      for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    }
    const s = st.sessions ? st.sessions.A : null;
    return {
      answerSeen: records.filter(r => r.kind === 'answer-seen').length,
      judged: records.filter(r => r.kind === 'judged').length,
      phase: s && s.current ? s.current.phase : null,
      strokes: s && s.current ? s.current.strokes.length : null,
      cursor: s ? s.cursor : null,
    };
  });
}

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!top && top.dataset.phase === p;
  }, phase);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function waitAttr(page, id, attr, values, timeout = 15000) {
  await page.waitForFunction(({ id: i, attr: a, values: vs }) => {
    const el = document.querySelector(`.sz-layer[data-top="true"] [data-testid="${i}"]`);
    return !!el && vs.includes(el.getAttribute(a));
  }, { id, attr, values }, { timeout });
  return page.getAttribute(topSel(id), attr);
}

async function write(page, pts, expectCount) {
  await drawStroke(page, pts);
  await page.waitForFunction(n => {
    const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
    return !!g && Number(g.dataset.strokeCount) === n;
  }, expectCount);
  await effects(page);
}

async function pixelsIn(page, testid) {
  return page.evaluate(id => {
    const host = document.querySelector(`.sz-layer[data-top="true"] [data-testid="${id}"]`);
    if (!host) return -1;
    let n = 0;
    for (const c of host.querySelectorAll('canvas')) {
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n += 1;
    }
    return n;
  }, testid);
}

async function present(page, id) {
  return (await page.locator(topSel(id)).count()) > 0;
}

async function backToHome(page) {
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
}

/** 模拟 Swift 冷启动深链：bridge.js 一把全局装上就立刻调用（store / 界面都还没好，进队列）。同 55-reminder。 */
function queuedDeepLink(cardKey) {
  Object.defineProperty(window, 'shiziOpenReminderTarget', {
    configurable: true,
    get() { return undefined; },
    set(fn) {
      Object.defineProperty(window, 'shiziOpenReminderTarget', { value: fn, writable: true, configurable: true });
      window.__coldLink = fn(cardKey);
    },
  });
}

async function waitWriteB(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.sz-app');
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return el.dataset.topScreen === 'write' && !!top && top.dataset.slot === 'B' && el.dataset.navAnim === 'idle';
  });
  await waitNavIdle(page);
}

// ------------------------------------------------------------------ spec

export default async function coldStart(page, ctx) {
  const { assert, step } = ctx;
  const browser = page.context().browser();

  // ---------------------------------------------------------------- 1. recall
  step('recall half-written: two strokes → home screen → kill → relaunch lands on the write page, same char, both strokes');
  let a = await newApp(ctx, browser);
  await bootTestHost(a.p, ctx.baseURL, { coldRoute: true });
  const seeded = await seedSession(a.p, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok, 'seeded an A group');
  await openWrite(a.p, { slot: 'A' });
  await write(a.p, HORIZONTAL, 1);
  await write(a.p, VERTICAL, 2);
  const S1 = await kill(a, ctx);
  const saved1 = JSON.parse(storedItem(S1, ROUTE_KEY));
  assert.deepEqual(saved1.stack.map(e => e.n), ['home', 'write'], 'route hint on disk: home → write');
  assert.deepEqual(saved1.stack[1].p, { slot: 'A' }, 'route hint keeps the params');

  a = await launch(ctx, browser, S1);
  await waitPhase(a.p, 'recall');
  let v = await app(a.p);
  assert.deepEqual([v.top, v.depth, v.slot, v.historyDepth], ['write', 1, 'A', 1], 'cold start: write page restored at depth 1 (history entry rebuilt)');
  assert.deepEqual(await plan(a.p), { reason: 'ok', restored: true }, 'route plan: ok');
  let s = await writeSnapshot(a.p);
  assert.deepEqual([s.cursor, s.phase, s.strokes], [0, 'recall', 2], 'same character, recall, both strokes');
  assert.ok((await canvasInk(a.p, 'write-grid-ink')) > 0, 'the solid ink layer is painted');
  assert.equal(s.done.disabled, false, '「写好了」 enabled');

  // ---------------------------------------------------------------- 2. compare
  step('judge page: 写好了 → kill → relaunch stays on the judge page with my ink and the reference glyph');
  await a.p.click(topSel('write-done'));
  await a.p.waitForSelector(topSel('write-compare'));
  await waitPhase(a.p, 'compare');
  const S2 = await kill(a, ctx);
  a = await launch(ctx, browser, S2);
  await waitPhase(a.p, 'compare');
  v = await app(a.p);
  assert.deepEqual([v.top, v.depth], ['write', 1], 'cold start: write page');
  assert.ok(await present(a.p, 'write-compare'), 'judge page shown');
  assert.ok((await pixelsIn(a.p, 'write-compare-mine')) > 0, '你写的 card has my ink');
  assert.equal(await waitAttr(a.p, 'write-compare-ref', 'data-state', ['ready', 'missing']), 'ready', '标准写法 ready');
  assert.ok((await pixelsIn(a.p, 'write-compare-ref')) > 0, '标准写法 painted');
  assert.equal((await facts(a.p)).judged, 0, 'nothing judged by restoring');

  // ---------------------------------------------------------------- 3. answer
  step('after seeing the answer (straight into trace, D64 ②): kill → relaunch shows the trace page; still one answer-seen record');
  await a.p.click(topSel('write-continue'));
  await waitPhase(a.p, 'recall');
  await tap(a.p, 'write-show-answer');
  await waitPhase(a.p, 'trace');
  const S3 = await kill(a, ctx);
  a = await launch(ctx, browser, S3);
  await waitPhase(a.p, 'trace');
  assert.ok(await present(a.p, 'write-trace-layer'), 'trace layer shown');
  assert.equal(await waitAttr(a.p, 'write-trace-layer', 'data-state', ['ready', 'missing']), 'ready', 'answer glyph ready');
  assert.equal((await facts(a.p)).answerSeen, 1, 'one answer-seen record');

  // ---------------------------------------------------------------- 4. trace
  step('trace: one stroke → kill → relaunch keeps trace, the stroke and the outline; back returns home');
  await write(a.p, HORIZONTAL, 1);
  const S4 = await kill(a, ctx);
  a = await launch(ctx, browser, S4);
  await waitPhase(a.p, 'trace');
  s = await writeSnapshot(a.p);
  assert.deepEqual([s.phase, s.strokes], ['trace', 1], 'trace with 1 stroke');
  assert.ok((await canvasInk(a.p, 'write-grid-ink')) > 0, 'trace ink painted');
  assert.equal(await waitAttr(a.p, 'write-trace-layer', 'data-state', ['ready', 'missing']), 'ready', 'trace outline (reference) present');
  let f = await facts(a.p);
  assert.deepEqual([f.answerSeen, f.judged], [1, 0], 'still one answer-seen, no judged');
  await backToHome(a.p);
  v = await app(a.p);
  assert.deepEqual([v.top, v.depth, v.historyDepth], ['home', 0, 0], 'back from the restored page → home (real history entry)');
  await close(a, ctx);

  // ---------------------------------------------------------------- 5. expiry
  step('P108: left more than maxAgeMinutes ago → no restore, home; the write-page state is still there to continue');
  const stale = withRoute(S4, r => ({ ...r, at: r.at - 7 * HOUR }));
  a = await launch(ctx, browser, stale);
  v = await app(a.p);
  assert.deepEqual([v.top, v.depth, v.historyDepth], ['home', 0, 0], 'stale: home');
  assert.deepEqual(await plan(a.p), { reason: 'stale', restored: false }, 'route plan: stale');
  f = await facts(a.p);
  assert.deepEqual([f.phase, f.strokes], ['trace', 1], 'session state untouched (home can continue it)');
  const rewritten = await a.p.evaluate(k => JSON.parse(window.__shiziTest.getRawKeys('shizi.v2.', { includeRoute: true })[k]).stack.map(e => e.n), ROUTE_KEY);
  assert.deepEqual(rewritten, ['home'], 'the stale hint is replaced by the current page');
  await close(a, ctx);

  // ---------------------------------------------------------------- 6. backup undo (P32 resume)
  step('backup page: replace → undo bar → kill → relaunch on the backup page with the undo bar; undo restores the old records');
  a = await newApp(ctx, browser);
  await bootTestHost(a.p, ctx.baseURL, { coldRoute: true });
  const built = await a.p.evaluate(async () => {
    const { makeRecord } = await import('/src/core/records.js');
    const { buildBackupV2, serializeBackup } = await import('/src/core/backup.js');
    window.__shiziTest.reset();
    const at = window.__shiziTest.now() - 2 * 24 * 3600 * 1000;
    const rec = (id, char, judgment, t) => makeRecord({ id, cardKey: `base:${char}`, sessionId: 's9', kind: 'judged', judgment, at: t,
      help: { hints: 0, answerSeen: false, traced: false } });
    const backupRec = rec('r1', '永', 'correct', at);
    const group = m => ({ [m.localDay.slice(0, 7)]: [m] });
    let r = window.__shiziTest.seed({ records: group(backupRec) });
    if (!r.ok) return { ok: false, r };
    const text = serializeBackup(buildBackupV2(window.__shiziTest.getState(), { now: window.__shiziTest.now(), serial: 1 }));
    const mine = [rec('r1', '和', 'wrong', at), rec('r2', '春', 'correct', at + 1000)];
    r = window.__shiziTest.seed({ records: { [mine[0].localDay.slice(0, 7)]: mine } });
    return { ok: r.ok, text };
  });
  assert.ok(built.ok, 'seeded: backup of 永, current records 和 / 春');
  const before = await a.p.evaluate(() => window.__shiziTest.getState().records);
  await a.p.evaluate(async mod => (await import(mod)).openBackup(), BACKUP_MOD);
  await a.p.waitForSelector(topSel('backup-screen'));
  await waitNavIdle(a.p);
  await a.p.evaluate(async ({ mod, text }) => (await import(mod)).receivePickedText(text), { mod: BACKUP_MOD, text: built.text });
  await a.p.waitForSelector(topSel('backup-restore-confirm'));
  await waitNavIdle(a.p);
  await a.p.click(topSel('backup-restore-ok'));
  await a.p.waitForSelector(topSel('backup-undo'));
  await waitNavIdle(a.p);
  const S6 = await kill(a, ctx);
  assert.ok(storedItem(S6, 'shizi.v2.safety'), 'the safety copy is on disk');

  a = await launch(ctx, browser, S6);
  await a.p.waitForSelector(topSel('backup-undo'));
  await waitNavIdle(a.p);
  v = await app(a.p);
  assert.deepEqual([v.top, v.depth, v.historyDepth], ['backup', 1, 1], 'cold start: backup page restored');
  assert.deepEqual(await a.p.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="backup-undo"]');
    return [el.dataset.kind, el.dataset.state];
  }), ['restore', 'on'], 'undo bar resumed (P32 undoAfterReload=resume)');
  await a.p.click(topSel('undo-button'));
  await a.p.waitForFunction(() => {
    const el = document.querySelector('[data-testid="backup-undo"]');
    return el && el.dataset.state === 'done';
  });
  assert.equal(JSON.stringify(await a.p.evaluate(() => window.__shiziTest.getState().records)), JSON.stringify(before),
    'undo after the cold start: records back to 和 / 春');
  assert.equal(await a.p.evaluate(() => 'shizi.v2.safety' in window.__shiziTest.getRawKeys('shizi.v2.')), false, 'safety copy removed by the undo');
  await close(a, ctx);

  step('same snapshot, but the backup page is entered from elsewhere → no undo, the leftover copy is treated as stale');
  a = await launch(ctx, browser, withRoute(S6, r => ({ ...r, at: r.at - 7 * HOUR })));
  v = await app(a.p);
  assert.equal(v.top, 'home', 'stale route: home');
  assert.equal(await a.p.evaluate(() => 'shizi.v2.safety' in window.__shiziTest.getRawKeys('shizi.v2.')), true, 'copy still on disk before entering');
  await a.p.evaluate(async mod => (await import(mod)).openBackup(), BACKUP_MOD);
  await a.p.waitForSelector(topSel('backup-screen'));
  await waitNavIdle(a.p);
  assert.equal(await present(a.p, 'backup-undo'), false, 'no undo bar when pushed from elsewhere');
  await a.p.waitForFunction(() => !('shizi.v2.safety' in window.__shiziTest.getRawKeys('shizi.v2.')));
  assert.ok(true, 'leftover safety copy dropped');
  await close(a, ctx);

  // ---------------------------------------------------------------- 7. deep link priority
  step('reminder deep link queued at cold start beats the saved route: home + the picked (B) write page');
  a = await launch(ctx, browser, S1, { init: { fn: queuedDeepLink, arg: 'base:鲜' } });
  await waitWriteB(a.p);
  v = await app(a.p);
  assert.deepEqual([v.top, v.depth, v.slot, v.historyDepth], ['write', 1, 'B', 1], 'B write page on top of home');
  assert.deepEqual(await plan(a.p), { reason: 'deep-link', restored: false }, 'route plan: deep-link');
  let st = await a.p.evaluate(() => window.__shiziTest.getState().sessions);
  assert.deepEqual(st.B.queue, ['base:鲜'], 'B = 鲜');
  assert.equal(st.A.current.strokes.length, 2, 'A keeps its strokes');
  await backToHome(a.p);
  await close(a, ctx);

  step('deep link that arrives after pageReady (iOS) unwinds the pristine restore first: [home, write A] → [home, write B]');
  a = await launch(ctx, browser, S1);
  await waitPhase(a.p, 'recall');
  assert.deepEqual((await app(a.p)).slot, 'A', 'restored A write page first');
  assert.equal(await a.p.evaluate(() => window.shiziOpenReminderTarget('base:鲜')), true, 'link received');
  await waitWriteB(a.p);
  v = await app(a.p);
  assert.deepEqual([v.top, v.depth, v.slot, v.historyDepth], ['write', 1, 'B', 1], 'B write page replaces the restored stack (depth 1, not 2)');
  st = await a.p.evaluate(() => window.__shiziTest.getState().sessions);
  assert.deepEqual([st.B.queue, st.A.current.strokes.length], [['base:鲜'], 2], 'B opened, A untouched');
  await backToHome(a.p);
  v = await app(a.p);
  assert.deepEqual([v.top, v.depth], ['home', 0], 'back → home');
  await close(a, ctx);
}
