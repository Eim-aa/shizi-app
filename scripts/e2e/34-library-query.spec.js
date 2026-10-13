// 字库首页查字框（02 M3-3；04 R-Q01–R-Q08、R-L04、R-H05；决定-D05 / D21 / D22；src/ui/screens/library/query-entry.js）。
//
//   1. 接入：library-query-slot 里是查字框按钮（<button>，名字「查字」），R-L04 说明句在它下面；点它 → 点击处理结束时
//      焦点已在代理输入框（同步 focus，R-Q08）→ 查字弹层（lookup：标题「查字」、没有勾选、没有底栏），打开不写存储。
//   2. 「查看记录」→ 单字详情（M3-6 openDetail），弹层留在栈里；返回回到弹层、输入与卡片不变（R-Q05）。
//   3. 「加入自选的字」→ 只写 custom（+ txn）→ 无成功提示（D58）→ 按钮变「已在自选的字里」。
//   4. 没有 B：「练这个字」→ 新 B（queue [字]、source {view:'library'}）→ 写字页；返回回到查字卡片、输入不变（R-Q07）。
//      写入失败（failNextWrite）→ 卡片 R-H06 三段式，B 仍为空；再试一次成功。
//   5. B 没写完：lookup 查字、看卡片、查看记录都不弹 S02、sessions.B 与全部存储键深相等；「练这个字」→ S02 三键；
//      取消 → 回到卡片、B 深相等、零写入；「接着写那组」→ B 原现场（原字、2 笔）、零写入，返回回到查字卡片；
//      「结束那组，开新的」→ 新 B 只有这个字、来源字库，旧 B 提前结束进 lastEnded.B。
//   6. 键盘（模拟 visualViewport 852 → 516，以及 360×640 紧凑版）：输入框与卡片底部「练这个字」都在可见区里、弹层底边贴键盘顶。
//   全程没有横向滚动；getWriteLog 无 via=direct。

import { bootTestHost, localDayOf, PRESS_SETTLE_MS, tid, waitNavIdle } from './helpers.mjs';

const COPY = {
  box: '搜索汉字或拼音', // r7-L1（D60）：占位改为「搜索汉字或拼音」，弹层标题仍是「查字」
  note: '查到的字可以直接练，也可以加入自选的字。',
  title: '查字',
  practice: '练这个字',
  add: '加入自选的字',
  inCustom: '已在自选的字里',
  viewRecords: '查看记录',
  saveFailed: '没保存上，输入的字还在。',
  s02Body: chars => `上一组还有${chars.map(c => `「${c}」`).join('')}没写。`,
  s02Continue: '接着写那组',
  s02EndStart: '结束那组，开新的',
  s02Cancel: '取消',
};

const SHEET = '[data-testid="query-sheet"]';
const inSheet = id => `${SHEET} ${tid(id)}`;
const B_CHARS = ['大', '中'];

function record(id, char, judgment, at, sessionId = 's1') {
  return {
    id, cardKey: `base:${char}`, char, sessionId, kind: 'judged', judgment, at, localDay: localDayOf(at),
    help: { hints: 0, answerSeen: false, traced: false },
  };
}

/** reset + seed：永 两条 judged 记录；withB 时 B（大、中）停在第一个字、格子里 2 笔。返回 seed 后的状态。 */
async function seed(page, { withB = false } = {}) {
  const t1 = new Date(2026, 8, 20, 10, 0).getTime();
  const t2 = new Date(2026, 8, 24, 10, 0).getTime();
  const res = await page.evaluate(async ({ recs, withB: b, chars }) => {
    const { encodeRawStrokes } = await import('/src/core/ink-math.js');
    const { createSession } = await import('/src/core/sessions.js');
    window.__shiziTest.reset();
    const now = window.__shiziTest.now();
    let B = null;
    if (b) {
      const s = createSession({ id: 's9', kind: 'picked', source: { view: 'home' }, queue: chars.map(c => 'base:' + c), at: now - 60000 });
      const raw = [
        [{ x: 60, y: 120, t: 0 }, { x: 170, y: 121, t: 60 }, { x: 280, y: 122, t: 120 }],
        [{ x: 172, y: 60, t: 400 }, { x: 173, y: 170, t: 460 }, { x: 174, y: 290, t: 520 }],
      ];
      B = { ...s, current: { ...s.current, strokes: encodeRawStrokes(raw), hints: 1, hintRange: null } };
    }
    const r = window.__shiziTest.seed({ records: { '2026-09': recs }, sessions: { A: null, B, lastEnded: {} } });
    return { ok: !!(r && r.ok), r, state: window.__shiziTest.getState() };
  }, { recs: [record('r1', '永', 'wrong', t1), record('r2', '永', 'correct', t2)], withB, chars: B_CHARS });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
  return res.state;
}

async function routerStack(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    return getRouter().getState().stack.map(e => (e.k === 'o' ? `o:${e.n}` : e.n));
  });
}

async function waitStack(page, expected) {
  await page.waitForFunction(async exp => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return !s.pending && JSON.stringify(s.stack.map(e => (e.k === 'o' ? `o:${e.n}` : e.n))) === JSON.stringify(exp);
  }, expected);
  await waitNavIdle(page);
}

async function goLibrary(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('library');
  });
  await waitStack(page, ['library']);
}

async function back(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
}

async function logLen(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog().length);
}

async function writesSince(page, n) {
  return page.evaluate(k => window.__shiziTest.getWriteLog().slice(k).filter(e => e.op !== 'clear'), n);
}

async function rawKeys(page) {
  return page.evaluate(() => window.__shiziTest.getRawKeys('shizi.v2.'));
}

async function getState(page) {
  return page.evaluate(() => window.__shiziTest.getState());
}

async function toastText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="toast"]');
    return el ? el.textContent.trim() : null;
  });
}

async function entryInfo(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const slot = top && top.querySelector('[data-testid="library-query-slot"]');
    const btn = slot && slot.querySelector('[data-testid="library-query-open"]');
    const note = top && top.querySelector('[data-testid="library-query-note"]');
    const r = el => (el ? el.getBoundingClientRect() : null);
    const root = document.scrollingElement;
    return {
      tag: btn ? btn.tagName : null,
      name: btn ? (btn.getAttribute('aria-label') || btn.textContent).trim() : null,
      mode: btn ? btn.dataset.mode : null,
      haspopup: btn ? btn.getAttribute('aria-haspopup') : null,
      note: note ? note.textContent.trim() : null,
      noteBelow: btn && note ? r(note).top >= r(btn).bottom - 0.5 : false,
      height: btn ? r(btn).height : 0,
      width: btn ? r(btn).width : 0,
      hscroll: root.scrollWidth > root.clientWidth + 0.5 || [...document.querySelectorAll('.sz-layer[data-top="true"] *')]
        .some(el => el.scrollWidth > el.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)),
    };
  });
}

async function sheetInfo(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="query-sheet"]');
    if (!panel) return null;
    const q = id => panel.querySelector(`[data-testid="${id}"]`);
    const body = q('query-body');
    const btn = id => (q(id) ? { text: q(id).textContent.trim(), disabled: q(id).disabled } : null);
    return {
      title: panel.querySelector('.sz-sheet__title') ? panel.querySelector('.sz-sheet__title').textContent : null,
      mode: body ? body.dataset.mode : null,
      view: body ? body.dataset.view : null,
      cur: body ? body.dataset.cur || null : null,
      input: q('query-input') ? q('query-input').value : null,
      rows: [...panel.querySelectorAll('[data-testid="query-row"]')].map(r => r.dataset.char),
      selects: panel.querySelectorAll('[data-testid="query-row-select"]').length,
      bar: !!q('query-bar'),
      card: q('query-card') ? q('query-card').dataset.char : null,
      practice: btn('query-card-practice'),
      add: btn('query-card-add'),
      inCustom: btn('query-card-in-custom'),
      detail: btn('query-card-detail'),
      practiceFail: q('query-card-practice-fail') ? q('query-card-practice-fail').textContent : null,
    };
  });
}

async function s02Info(page) {
  return page.evaluate(() => {
    const d = document.querySelector('[data-testid="s02-dialog"]');
    if (!d) return null;
    const txt = id => (d.querySelector(`[data-testid="${id}"]`) ? d.querySelector(`[data-testid="${id}"]`).textContent.trim() : null);
    return { state: d.dataset.state, body: txt('s02-body'), cont: txt('s02-continue'), end: txt('s02-end-start'), cancel: txt('s02-cancel') };
  });
}

async function writeInfo(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const grid = top && top.querySelector('[data-testid="write-grid"]');
    const wrap = top && top.querySelector('.sz-write');
    return {
      screen: document.querySelector('.sz-app').dataset.topScreen,
      strokes: grid ? Number(grid.dataset.strokeCount) : null,
      cursor: wrap ? Number(wrap.dataset.cursor) : null,
      phase: wrap ? wrap.dataset.phase : null,
    };
  });
}

/** 点字库首页的查字框：记录点击处理结束时的焦点（冒泡阶段的 document 监听在按钮自己的处理之后跑）。 */
async function openFromLibrary(page) {
  await page.evaluate(() => {
    window.__qFocus = null;
    document.addEventListener('click', () => {
      const el = document.activeElement;
      window.__qFocus = el ? { tag: el.tagName, proxy: el.hasAttribute('data-query-focus-proxy') } : null;
    }, { once: true });
  });
  await page.click(`.sz-layer[data-top="true"] ${tid('library-query-open')}`);
  await page.waitForSelector(inSheet('query-input'));
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.testid === 'query-input');
  await waitNavIdle(page);
  return page.evaluate(() => window.__qFocus);
}

async function typeInto(page, text) {
  const input = page.locator(inSheet('query-input'));
  await input.fill('');
  if (text) await input.fill(text);
  await page.waitForTimeout(80);
}

async function clickSheet(page, id) {
  await page.locator(inSheet(id)).click();
}

async function closeSheet(page) {
  await page.evaluate(() => history.back());
  await page.waitForSelector(SHEET, { state: 'detached' });
  await waitNavIdle(page);
}

async function installFakeViewport(page) {
  await page.evaluate(() => {
    class FakeVV extends EventTarget {}
    const vv = new FakeVV();
    vv.height = window.innerHeight;
    vv.width = window.innerWidth;
    vv.offsetTop = 0;
    vv.offsetLeft = 0;
    vv.scale = 1;
    window.__fakeVV = vv;
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  });
}

async function setKeyboard(page, h) {
  await page.evaluate(k => {
    window.__fakeVV.height = window.innerHeight - k;
    window.__fakeVV.dispatchEvent(new Event('resize'));
  }, h);
  await page.waitForFunction(on => {
    const s = document.querySelector('.sz-sheet');
    return !!s && s.dataset.keyboard === (on ? 'true' : 'false');
  }, h > 0);
  await page.waitForTimeout(60);
}

/** 键盘弹起时：输入框、卡片底部「练这个字」（滚进弹层可见处后）都在可见区里，弹层底边贴键盘顶。 */
async function keyboardGeometry(page) {
  return page.evaluate(() => {
    const vv = window.__fakeVV;
    const r = sel => document.querySelector(sel).getBoundingClientRect();
    const panelEl = document.querySelector('.sz-sheet');
    const input = r('[data-testid="query-input"]');
    const before = r('[data-testid="query-card-practice"]');
    const go = document.querySelector('[data-testid="query-card-practice"]');
    go.scrollIntoView({ block: 'nearest' });
    const after = go.getBoundingClientRect();
    const panel = panelEl.getBoundingClientRect();
    const inputStill = r('[data-testid="query-input"]');
    // 按钮中心点命中的是按钮本身（没有被别的层盖住）
    const hit = document.elementFromPoint(after.left + after.width / 2, after.top + after.height / 2);
    panelEl.scrollTop = 0;
    return {
      visTop: vv.offsetTop,
      visBottom: vv.offsetTop + vv.height,
      input: { top: input.top, bottom: input.bottom },
      inputAfterScroll: { top: inputStill.top, bottom: inputStill.bottom },
      goBefore: { top: before.top, bottom: before.bottom },
      go: { top: after.top, bottom: after.bottom },
      goHit: !!hit && (hit === go || go.contains(hit)),
      panel: { top: panel.top, bottom: panel.bottom },
      scrollable: panelEl.scrollHeight > panelEl.clientHeight,
    };
  });
}

export default async function run(page, { baseURL, assert, step }) {
  await bootTestHost(page, baseURL);
  await seed(page);
  await goLibrary(page);

  // ---------------------------------------------------------------- 1. 接入
  step('entry: library-query-slot holds the 查字 box (<button>), no note under it (D49); no horizontal scroll');
  let e = await entryInfo(page);
  assert.equal(e.tag, 'BUTTON', 'the 查字 box is a <button>');
  assert.equal(e.name, COPY.box, 'accessible name 「搜索汉字或拼音」');
  assert.equal(e.mode, 'lookup', 'data-mode=lookup');
  assert.equal(e.haspopup, 'dialog', 'aria-haspopup=dialog');
  assert.equal(e.note, null, 'D49: the sentence under the box (R-L04 「查到的字可以直接练，也可以加入自选的字。」) is gone');
  assert.ok(e.height >= 44 && e.height <= 56, `box is 48-ish tall (sz-input, ${Math.round(e.height)})`);
  assert.equal(e.hscroll, false, 'no horizontal scroll on the library page');

  step('tap → lookup sheet; focus is on the proxy input when the click handler ends (R-Q08); opening writes nothing');
  let base = await logLen(page);
  let keys0 = await rawKeys(page);
  let focus = await openFromLibrary(page);
  assert.deepEqual(focus, { tag: 'INPUT', proxy: true }, 'focus proxy focused synchronously inside the tap');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.testid), 'query-input', 'then the query input has focus');
  let info = await sheetInfo(page);
  assert.equal(info.title, COPY.title, 'sheet title 「查字」');
  assert.equal(info.mode, 'lookup', 'mode lookup');
  assert.equal(info.view, 'hint', 'empty input → hint');
  assert.equal(info.bar, false, 'lookup has no pick bar');
  assert.deepEqual(await routerStack(page), ['library', 'o:query'], 'sheet is an overlay on the library tab root');

  step('lookup: rows without checkboxes; tapping a row shows the card; nothing auto-added, nothing written');
  await typeInto(page, '永和');
  info = await sheetInfo(page);
  assert.deepEqual(info.rows, ['永', '和'], 'two rows');
  assert.equal(info.selects, 0, 'no checkboxes in lookup');
  assert.equal(info.bar, false, 'still no bottom bar');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="永"] [data-testid="query-row-open"]`).click();
  await page.waitForSelector(`${inSheet('query-card')}[data-char="永"]`);
  info = await sheetInfo(page);
  assert.equal(info.view, 'card', 'card view');
  assert.deepEqual(info.practice, { text: COPY.practice, disabled: false }, '「练这个字」 enabled');
  assert.deepEqual(info.add, { text: COPY.add, disabled: false }, '「加入自选的字」 enabled (not auto-added)');
  assert.deepEqual(info.detail, { text: COPY.viewRecords, disabled: false }, '「查看记录」 enabled (onDetail wired)');
  assert.deepEqual(await writesSince(page, base), [], 'open / type / rows / card: zero writes');
  assert.deepEqual(await rawKeys(page), keys0, 'storage keys deep-equal');

  // ---------------------------------------------------------------- 2. 查看记录 → 详情
  step('「查看记录」→ single-character detail (M3-6); sheet stays underneath; back returns to the same card');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await clickSheet(page, 'query-card-detail');
  await page.waitForFunction(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-screen"]');
    return !!el && el.dataset.char === '永';
  });
  await waitNavIdle(page);
  assert.deepEqual(await routerStack(page), ['library', 'o:query', 'detail'], 'detail pushed on top of the sheet');
  assert.equal(await page.evaluate(() => document.querySelector('.sz-app').dataset.topScreen), 'detail', 'top screen is detail');
  assert.deepEqual(await writesSince(page, base), [], 'opening detail writes nothing');
  await back(page);
  await waitStack(page, ['library', 'o:query']);
  info = await sheetInfo(page);
  assert.equal(info.input, '永和', 'back → input unchanged');
  assert.equal(info.card, '永', 'back → same card');

  // ---------------------------------------------------------------- 3. 加入自选 + 轻提示
  step('加入自选的字 (和) → one commit (custom + txn only) → 无提示，按钮原地变 已在自选的字里');
  await clickSheet(page, 'query-back');
  await page.waitForSelector(inSheet('query-rows'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="和"] [data-testid="query-row-open"]`).click();
  await page.waitForSelector(`${inSheet('query-card')}[data-char="和"]`);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  info = await sheetInfo(page);
  assert.equal(info.detail, null, '和 has no records → no 查看记录');
  base = await logLen(page);
  const before = await getState(page);
  await clickSheet(page, 'query-card-add');
  await page.waitForSelector(inSheet('query-card-in-custom'));
  assert.equal(await toastText(page), null, 'I3 P0-14: no success toast');
  info = await sheetInfo(page);
  assert.deepEqual(info.inCustom, { text: COPY.inCustom, disabled: true }, 'button becomes disabled 「已在自选的字里」');
  let w = await writesSince(page, base);
  assert.ok(w.length > 0 && w.every(x => x.key === 'shizi.v2.custom' || x.key === 'shizi.v2.txn'),
    `only custom (+ txn journal) written: ${[...new Set(w.map(x => x.key))].join(', ')}`);
  assert.ok(w.every(x => x.via === 'storage'), 'all writes via storage.js');
  let after = await getState(page);
  assert.deepEqual(after.custom.added.map(a => a.char), ['和'], 'custom.added = [和]');
  assert.deepEqual(after.sessions, before.sessions, 'sessions untouched');
  assert.deepEqual(after.records, before.records, 'records untouched');

  // ---------------------------------------------------------------- 4. 没有 B：练这个字
  step('no B: 「练这个字」 write failure (failNextWrite) → card 三段式, B stays empty; retry → new B → write page');
  await clickSheet(page, 'query-back');
  await page.waitForSelector(inSheet('query-rows'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="永"] [data-testid="query-row-open"]`).click();
  await page.waitForSelector(`${inSheet('query-card')}[data-char="永"]`);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.sessions' }));
  await clickSheet(page, 'query-card-practice');
  await page.waitForSelector(inSheet('query-card-practice-fail'));
  info = await sheetInfo(page);
  assert.ok(info.practiceFail && info.practiceFail.includes(COPY.saveFailed), 'R-H06 「没保存上，输入的字还在。」');
  assert.equal(info.input, '永和', 'input kept');
  assert.equal((await getState(page)).sessions.B, null, 'B still empty after the failed write');
  assert.deepEqual(await routerStack(page), ['library', 'o:query'], 'no write page pushed');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await clickSheet(page, 'query-card-practice-fail-retry');
  await waitStack(page, ['library', 'o:query', 'write']);
  let st = await getState(page);
  assert.ok(st.sessions.B, 'B created');
  assert.deepEqual(st.sessions.B.queue, ['base:永'], 'B queue = [永]');
  assert.equal(st.sessions.B.kind, 'picked', 'B kind picked');
  assert.deepEqual(st.sessions.B.source, { view: 'library' }, 'B source {view:library} (result page 「回到字库」)');
  assert.deepEqual(st.custom.added.map(a => a.char), ['和'], 'practising 永 did not add it to custom (D21)');
  let wr = await writeInfo(page);
  assert.equal(wr.screen, 'write', 'write page on top');
  assert.equal(wr.cursor, 0, 'at the first (only) character');

  step('R-Q07: back from the unfinished write page → the lookup card, input unchanged');
  await back(page);
  await waitStack(page, ['library', 'o:query']);
  info = await sheetInfo(page);
  assert.equal(info.input, '永和', 'input unchanged');
  assert.equal(info.card, '永', 'card 永 still shown');
  await closeSheet(page);
  assert.deepEqual(await routerStack(page), ['library'], 'sheet closed → library root');

  // ---------------------------------------------------------------- 5. B 没写完
  step('B unfinished: lookup / card / 查看记录 → no S02, sessions.B and all keys deep-equal, zero writes');
  let seeded = await seed(page, { withB: true });
  assert.equal(seeded.sessions.B.current.strokes.length, 2, 'seeded B has 2 strokes on its first character');
  await page.reload();
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitNavIdle(page);
  await goLibrary(page);
  const B0 = (await getState(page)).sessions.B;
  keys0 = await rawKeys(page);
  base = await logLen(page);
  focus = await openFromLibrary(page);
  assert.deepEqual(focus, { tag: 'INPUT', proxy: true }, 'sync focus again');
  await typeInto(page, '永');
  await page.waitForSelector(`${inSheet('query-card')}[data-char="永"]`);
  assert.equal(await s02Info(page), null, 'lookup + card: no S02');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await clickSheet(page, 'query-card-detail');
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'detail');
  await waitNavIdle(page);
  assert.equal(await s02Info(page), null, 'opening detail from the card: no S02');
  await back(page);
  await waitStack(page, ['library', 'o:query']);
  assert.deepEqual((await getState(page)).sessions.B, B0, 'sessions.B deep-equal');
  assert.deepEqual(await writesSince(page, base), [], 'zero writes');
  assert.deepEqual(await rawKeys(page), keys0, 'all v2 keys deep-equal');

  step('「练这个字」 → S02 three buttons; 取消 → back on the card, B deep-equal, zero writes');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await clickSheet(page, 'query-card-practice');
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  let s02 = await s02Info(page);
  assert.deepEqual(s02, { state: 'ask', body: COPY.s02Body(B_CHARS), cont: COPY.s02Continue, end: COPY.s02EndStart, cancel: COPY.s02Cancel },
    'S02: 「上一组还有「大」「中」没写。」 + 接着写那组 / 结束那组，开新的 / 取消');
  assert.deepEqual(await routerStack(page), ['library', 'o:query', 'o:s02'], 'S02 on top of the sheet');
  await page.click(tid('s02-cancel'));
  await waitStack(page, ['library', 'o:query']);
  info = await sheetInfo(page);
  assert.equal(info.card, '永', 'cancel → back on the 永 card');
  assert.equal(info.input, '永', 'input unchanged');
  assert.deepEqual((await getState(page)).sessions.B, B0, 'after cancel sessions.B deep-equal');
  assert.deepEqual(await writesSince(page, base), [], 'cancel: zero writes');
  assert.deepEqual(await rawKeys(page), keys0, 'cancel: all v2 keys deep-equal');

  step('「接着写那组」 → B original scene (大, 2 strokes, recall), zero writes; back → the lookup card');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await clickSheet(page, 'query-card-practice');
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  await page.click(tid('s02-continue'));
  await waitStack(page, ['library', 'o:query', 'write']);
  await page.waitForFunction(() => {
    const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
    return !!g && Number(g.dataset.strokeCount) === 2;
  });
  wr = await writeInfo(page);
  assert.deepEqual(wr, { screen: 'write', strokes: 2, cursor: 0, phase: 'recall' }, 'B write page: first character, 2 strokes, recall');
  const params = await page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    return getRouter().getState().top.p;
  });
  assert.equal(params && params.slot, 'B', 'write page slot B');
  assert.deepEqual((await getState(page)).sessions.B, B0, 'continue: sessions.B deep-equal');
  assert.deepEqual(await writesSince(page, base), [], 'continue: zero writes');
  await back(page);
  await waitStack(page, ['library', 'o:query']);
  info = await sheetInfo(page);
  assert.equal(info.card, '永', 'back from B → the lookup card (R-Q07)');
  assert.deepEqual((await getState(page)).sessions.B, B0, 'B still deep-equal');

  step('「结束那组，开新的」 → new B = [永] from the library, old B ended early into lastEnded.B');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await clickSheet(page, 'query-card-practice');
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  await page.click(tid('s02-end-start'));
  await waitStack(page, ['library', 'o:query', 'write']);
  st = await getState(page);
  assert.deepEqual(st.sessions.B.queue, ['base:永'], 'new B queue [永]');
  assert.deepEqual(st.sessions.B.source, { view: 'library' }, 'new B source library');
  assert.equal(st.sessions.lastEnded.B && st.sessions.lastEnded.B.id, B0.id, 'old B moved to lastEnded.B');
  assert.equal(st.sessions.lastEnded.B && st.sessions.lastEnded.B.endedEarly, true, 'old B endedEarly');
  w = await writesSince(page, base);
  assert.ok(w.every(x => x.via === 'storage'), 'all writes via storage.js');
  assert.ok(w.every(x => ['shizi.v2.sessions', 'shizi.v2.txn'].includes(x.key)),
    `only sessions (+ txn) written: ${[...new Set(w.map(x => x.key))].join(', ')}`);
  await back(page);
  await waitStack(page, ['library', 'o:query']);
  await closeSheet(page);

  // ---------------------------------------------------------------- 6. 键盘避让
  for (const vp of [{ width: 393, height: 852, kb: 336, label: '393×852' }, { width: 360, height: 640, kb: 290, label: '360×640' }]) {
    step(`keyboard (${vp.label}, fake visualViewport −${vp.kb}px): input and the card's 「练这个字」 stay visible`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await seed(page);
    await page.reload();
    await page.waitForFunction(() => typeof window.__shiziTest === 'object');
    await waitNavIdle(page);
    await goLibrary(page);
    await installFakeViewport(page);
    e = await entryInfo(page);
    assert.equal(e.hscroll, false, `${vp.label}: no horizontal scroll`);
    await openFromLibrary(page);
    await typeInto(page, '永');
    await page.waitForSelector(`${inSheet('query-card')}[data-char="永"]`);
    await setKeyboard(page, vp.kb);
    const g = await keyboardGeometry(page);
    assert.ok(Math.abs(g.panel.bottom - g.visBottom) <= 1, `${vp.label}: sheet bottom sits on the keyboard top (${Math.round(g.panel.bottom)} vs ${g.visBottom})`);
    assert.ok(g.input.top >= g.visTop && g.input.bottom <= g.visBottom + 0.5,
      `${vp.label}: input inside the visible area (${Math.round(g.input.top)}–${Math.round(g.input.bottom)} within 0–${g.visBottom})`);
    assert.ok(g.go.top >= g.visTop && g.go.bottom <= g.visBottom + 0.5,
      `${vp.label}: 「练这个字」 inside the visible area (${Math.round(g.go.top)}–${Math.round(g.go.bottom)}; before scroll ${Math.round(g.goBefore.top)}–${Math.round(g.goBefore.bottom)}, sheet scrolls: ${g.scrollable})`);
    assert.ok(g.goHit, `${vp.label}: 「练这个字」 is not covered (hit test)`);
    await setKeyboard(page, 0);
    const panelBottom = await page.evaluate(() => document.querySelector('.sz-sheet').getBoundingClientRect().bottom);
    assert.ok(Math.abs(panelBottom - vp.height) <= 1, `${vp.label}: keyboard closed → sheet back at the bottom`);
    await closeSheet(page);
  }
  await page.setViewportSize({ width: 393, height: 852 });

  step('no write bypassed storage.js');
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(x => x.via === 'direct'));
  assert.deepEqual(direct, [], 'getWriteLog: no via=direct');
}
