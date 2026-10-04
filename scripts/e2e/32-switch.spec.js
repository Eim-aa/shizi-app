// M3-5 换库（02 M3-5；04 R-L06；01 §3 settings.library、§4「换库 · 就地重试」；03 P73）。
//
// 场景：
//   1. 列表：四行（LIBRARIES 顺序）库名 / 一句说明 / 「可以练 N 个字 · 有记录 M 个」——N 从数据算（3500 / 2974 / 744 / 2500，D50 ① 移除 76 字后），
//      M 按记录算（只算 judged，同字去重；看过答案不算）；没设过练习范围 → 规范常用字「正在用」（P73）；底注；
//      320 宽时数量行两段各自不折断（折行整段换行）。
//   2. 确认框：点别的库 → 「换成「规范次常用字」？」+ 两行正文 + 取消 / 换成这个库；取消 → 不写入。
//   3. 失败就地重试：failNextWrite(settings) → 确认框换成「没保存上，刚才的选择没记下。」+ 先不换 / 再试一次，settings 不变；
//      先不换 → 关框、仍是原来的库；再来一次失败 → 再试一次 → 成功：关框、回到设置页（E9c / D49 ④：入口在「我的 › 设置 › 练习范围」，字库页没有了）、轻提示，settings.library = adv3000；
//      整个过程只写 txn 与 settings 两个键，没有绕过 storage.js 的写。
//   4. 只影响新字来源：换库前后 records / sched / custom / sessions 深相等；换库后 startA 开的今天的练习，新字全部来自规范次常用字
//      （换库前同样的状态算出来的新字全部来自规范常用字）；换库后 records / sched 仍不变。
//   5. 再打开换库页：规范次常用字「正在用」，M 不变；点当前库 → 返回。

import { bootTestHost, tid, topSel, waitNavIdle } from './helpers.mjs';

const SWITCH_MOD = '/src/ui/screens/library/switch.js';
const SESSION_MOD = '/src/ui/screens/session/index.js';
const DAY = '2026-09-24';
const YDAY = '2026-09-23';
const LIBS = ['core3500', 'adv3000', 'rare', 'curriculum2500'];
const NAMES = ['规范常用字', '规范次常用字', '规范专门用字', '小学初中常用字'];
const DESCS = [
  '日常最常用的字。大多数人从这里开始。',
  '看书看报会碰到的字。常用字写熟了，可以换这个。',
  '人名、地名和古文里的少见字。目前能练的大约一半。',
  '小学到初中语文课要求会写的字。适合陪孩子一起练。',
];
const TOTALS = [3500, 2974, 744, 2500];
const SOURCE_NOTE = '字表参考教育部《通用规范汉字表》。有些字拾字还没收进来，暂时不能练，所以能练的字比原表少。';
const CONFIRM_BODY = '以后的新字从这个字库里来。\n已有的记录、自选的字和写错过的字都不变。';
const FAILED = '没保存上，刚才的选择没记下。';
const TOAST = '已换成「规范次常用字」。';

const row = lib => `${topSel('libswitch-row')}[data-lib="${lib}"]`;
const DIALOG = topSel('libswitch-confirm');

function msOf(day, hms) {
  return new Date(`${day}T${hms}`).getTime();
}

function rec(serial, char, { kind = 'judged', judgment = 'correct', day = YDAY } = {}) {
  const r = {
    id: `r${serial}`, cardKey: `base:${char}`, char, sessionId: 's900', kind, at: msOf(day, '08:00:00') + serial * 1000, localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false },
  };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

function seedState() {
  const at = msOf(YDAY, '08:00:00');
  const fsrs = { stability: 30, difficulty: 5, state: 2 };
  const records = [
    rec(1, '的'), rec(2, '一', { judgment: 'wrong' }), rec(3, '的', { judgment: 'wrong' }), rec(4, '耶'),
    rec(5, '是', { kind: 'answer-seen' }),
  ];
  return {
    records: { [YDAY.slice(0, 7)]: records },
    sched: {
      'base:的': { fsrs, due: '2026-10-20', lastJudgedAt: at },
      'base:一': { fsrs, due: '2026-10-20', lastJudgedAt: at },
      'base:耶': { fsrs, due: '2026-10-20', lastJudgedAt: at },
    },
    custom: { added: [{ char: '永', at }] },
    sessions: {
      A: null,
      B: {
        id: 's901', slot: 'B', kind: 'picked', source: { view: 'home' }, queue: ['base:鲜', 'base:境'], cursor: 0, items: [],
        current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false },
        lastLine: null, startedAt: at, startedDay: YDAY, updatedAt: at,
      },
      lastEnded: {},
    },
  };
}

async function state(page) {
  return page.evaluate(() => window.__shiziTest.getState());
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

/** 真实入口（D49 ④）：我的 › 设置 › 练习 › 练习范围。回到「我的」tab 根，推设置，点「练习范围」行，等换库页。 */
async function openSwitchFromSettings(page) {
  await goTab(page, 'mine');
  await page.click(topSel('mine-menu-settings'));
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);
  await page.click(topSel('settings-library'));
  await page.waitForSelector(topSel('libswitch-screen'));
  await waitNavIdle(page);
}

async function openSwitch(page) {
  await page.evaluate(async mod => {
    const m = await import(mod);
    m.openLibrarySwitch();
  }, SWITCH_MOD);
  await page.waitForSelector(topSel('libswitch-screen'));
  await waitNavIdle(page);
}

async function rows(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return [...top.querySelectorAll('[data-testid="libswitch-row"]')].map(el => {
      const q = id => el.querySelector(`[data-testid="${id}"]`);
      const count = q('libswitch-row-count');
      return {
        lib: el.dataset.lib,
        current: el.dataset.current,
        ariaCurrent: el.getAttribute('aria-current'),
        tag: el.tagName,
        name: q('libswitch-row-name').textContent,
        desc: q('libswitch-row-desc').textContent,
        count: count.textContent,
        total: Number(count.dataset.total),
        recorded: Number(count.dataset.recorded),
        mark: q('libswitch-row-mark').textContent,
        markHidden: q('libswitch-row-mark').getAttribute('aria-hidden'),
        weight: getComputedStyle(q('libswitch-row-name')).fontWeight,
        height: el.getBoundingClientRect().height,
      };
    });
  });
}

async function dialog(page) {
  return page.evaluate(() => {
    const d = document.querySelector('.sz-layer[data-top="true"] [data-testid="libswitch-confirm"]');
    if (!d) return null;
    const q = id => d.querySelector(`[data-testid="${id}"]`);
    const txt = id => (q(id) ? q(id).textContent : null);
    return {
      state: d.dataset.state,
      lib: d.dataset.lib,
      role: d.getAttribute('role'),
      title: txt('libswitch-confirm-title'),
      body: txt('libswitch-confirm-body'),
      cancel: txt('libswitch-cancel'),
      ok: txt('libswitch-ok'),
      stay: txt('libswitch-stay'),
      retry: txt('libswitch-retry'),
      focusInDialog: d.contains(document.activeElement),
      focusOnButton: document.activeElement && document.activeElement.tagName === 'BUTTON',
    };
  });
}

async function toastText(page) {
  const el = await page.$(tid('toast'));
  return el ? (await el.textContent()).trim() : null;
}

async function writeLog(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog());
}

const pick = (s, domains) => JSON.parse(JSON.stringify(Object.fromEntries(domains.map(d => [d, s[d]]))));
const KEPT = ['records', 'sched', 'custom', 'sessions', 'wordOff', 'ink'];

export default async function librarySwitch(page, ctx) {
  const { assert } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // ------------------------------------------------------------ 0. 数据
  await goTab(page, 'library');
  const seeded = await page.evaluate(({ iso, s }) => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(iso);
    return window.__shiziTest.seed(s);
  }, { iso: `${DAY}T09:00:00`, s: seedState() });
  assert.equal(seeded.ok, true, 'seed ok');
  const before = await state(page);
  assert.equal(before.settings, null, 'no practice range chosen yet');

  // 库成员（题库数据）：用来核对 M 与新字来源
  const members = await page.evaluate(async libs => {
    const { libraryOf } = await import('/src/data/deck.js');
    return Object.fromEntries(libs.map(id => [id, libraryOf(id).keys]));
  }, LIBS);
  const inLib = (id, char) => members[id].includes(`base:${char}`);
  const expectRecorded = LIBS.map(id => ['的', '一', '耶'].filter(c => inLib(id, c)).length);

  // ------------------------------------------------------------ 1. 列表
  ctx.step('list: four libraries, counts from data, M from judged records, P73 default is current, source note');
  // 真实入口（D49 ④）：我的 › 设置 › 练习 › 练习范围（字库首页不再有「练习范围 / 更换字库 ›」，30-library 断言）
  assert.equal(await page.locator(tid('library-switch')).count(), 0, 'the library home has no practice-range entry any more');
  await goTab(page, 'mine');
  await page.click(topSel('mine-menu-settings'));
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);
  const entry = topSel('settings-library');
  assert.equal(await page.getAttribute(entry, 'data-library'), 'core3500', 'settings shows the P73 default range');
  assert.equal(await page.textContent(topSel('settings-library-value')), '规范常用字', 'with its library name');
  await page.click(entry);
  await page.waitForSelector(topSel('libswitch-screen'));
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'library-switch', 'the settings row pushes library-switch');
  const title = await page.locator(`${topSel('libswitch-screen')} [data-page-title]`).textContent();
  assert.equal(title, '更换字库', 'page title');
  let list = await rows(page);
  assert.deepEqual(list.map(r => r.lib), LIBS, 'four rows in LIBRARIES order');
  assert.deepEqual(list.map(r => r.tag), ['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON'], 'each row is a button');
  assert.deepEqual(list.map(r => r.name), NAMES, 'names');
  assert.deepEqual(list.map(r => r.desc), DESCS, 'one-line descriptions');
  assert.deepEqual(list.map(r => r.total), TOTALS, 'N from data: 3500 / 2974 / 744 / 2500');
  assert.deepEqual(list.map(r => r.recorded), expectRecorded, 'M = judged chars in the library (的 一 耶; answer-seen 是 not counted)');
  assert.equal(expectRecorded[0], 2, 'core3500 has 的 一');
  assert.equal(expectRecorded[1], 1, 'adv3000 has 耶');
  assert.equal(expectRecorded[2], 0, 'rare has none');
  assert.deepEqual(list.map(r => r.count), LIBS.map((_, i) => `可以练 ${TOTALS[i]} 个字 · 有记录 ${expectRecorded[i]} 个`), 'count lines');
  assert.deepEqual(list.map(r => r.current), ['true', 'false', 'false', 'false'], 'core3500 is current (P73)');
  assert.equal(list[0].ariaCurrent, 'true', 'aria-current on the current row');
  assert.deepEqual(list.map(r => r.mark), ['正在用', '›', '›', '›'], 'marks');
  assert.deepEqual(list.map(r => r.markHidden), [null, 'true', 'true', 'true'], '› is decorative');
  assert.equal(list[0].weight, '500', 'current name weight 500');
  assert.equal(list[1].weight, '400', 'other names weight 400');
  assert.ok(list.every(r => r.height >= 62), 'rows at least 62px tall');
  assert.equal(await page.locator(topSel('libswitch-source')).textContent(), SOURCE_NOTE, 'source note');

  ctx.step('narrow width: each count segment stays on one line (折行整段换行)');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(100);
  const segs = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] .sz-libsw__seg')]
    .map(el => ({ text: el.textContent, lines: el.getClientRects().length, nowrap: getComputedStyle(el).whiteSpace })));
  assert.equal(segs.length, 8, 'two segments per row');
  assert.ok(segs.every(s => s.lines === 1 && s.nowrap === 'nowrap'), 'no segment breaks inside');
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.ok(hScroll, 'no horizontal page scroll at 320');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.waitForTimeout(100);

  // ------------------------------------------------------------ 2. 确认框 · 取消
  ctx.step('confirm: title, two-line body, 取消 / 换成这个库; cancel writes nothing');
  const log0 = (await writeLog(page)).length;
  await page.click(row('adv3000'));
  await page.waitForSelector(DIALOG);
  await waitNavIdle(page);
  let d = await dialog(page);
  assert.equal(d.state, 'ask', 'ask state');
  assert.equal(d.lib, 'adv3000', 'target library');
  assert.equal(d.role, 'alertdialog', 'alertdialog role');
  assert.equal(d.title, '换成「规范次常用字」？', 'title');
  assert.equal(d.body, CONFIRM_BODY, 'body');
  assert.equal(d.cancel, '取消', '取消 button');
  assert.equal(d.ok, '换成这个库', '换成这个库 button');
  assert.ok(d.focusInDialog && !d.focusOnButton, 'focus on the dialog, no button preselected');
  await page.click(topSel('libswitch-cancel'));
  await page.waitForSelector(DIALOG, { state: 'detached' });
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'library-switch', 'still on the switch page');
  assert.equal((await state(page)).settings, null, 'settings untouched after cancel');
  assert.equal((await writeLog(page)).length, log0, 'no storage write on cancel');

  // ------------------------------------------------------------ 3. 失败 · 先不换
  ctx.step('failure: in-place retry state, settings unchanged; 先不换 closes and keeps the old library');
  await page.click(row('adv3000'));
  await page.waitForSelector(DIALOG);
  await waitNavIdle(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.settings' }));
  await page.click(topSel('libswitch-ok'));
  await page.waitForSelector(`${DIALOG}[data-state="failed"]`);
  await page.waitForTimeout(450);
  d = await dialog(page);
  assert.equal(d.title, '换成「规范次常用字」？', 'title kept');
  assert.equal(d.body, FAILED, 'save-failed sentence');
  assert.equal(d.stay, '先不换', '先不换 button');
  assert.equal(d.retry, '再试一次', '再试一次 button');
  assert.equal(d.ok, null, 'ask buttons replaced');
  assert.equal((await state(page)).settings, null, 'settings not changed by the failed write');
  assert.equal((await routerTop(page)).top, 'library-switch', 'stays on the page (就地)');
  await page.click(topSel('libswitch-stay'));
  await page.waitForSelector(DIALOG, { state: 'detached' });
  await waitNavIdle(page);
  list = await rows(page);
  assert.deepEqual(list.map(r => r.current), ['true', 'false', 'false', 'false'], 'still core3500 after 先不换');
  assert.equal((await state(page)).settings, null, 'settings still null');

  // ------------------------------------------------------------ 3b. 失败 · 再试一次 → 成功
  ctx.step('failure → 再试一次 succeeds: dialog closes, back to the library page, toast, settings.library = adv3000');
  const logStart = (await writeLog(page)).length;
  await page.click(row('adv3000'));
  await page.waitForSelector(DIALOG);
  await waitNavIdle(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.settings' }));
  await page.click(topSel('libswitch-ok'));
  await page.waitForSelector(`${DIALOG}[data-state="failed"]`);
  await page.waitForTimeout(450);
  await page.click(topSel('libswitch-retry'));
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.top && s.top.n === 'settings';
  });
  assert.equal(await toastText(page), TOAST, 'toast after switching');
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel);
    return !!el && el.dataset.library === 'adv3000';
  }, entry);
  assert.equal(await page.textContent(topSel('settings-library-value')), '规范次常用字', 'the settings row follows settings.library');
  await waitNavIdle(page);
  const after = await state(page);
  assert.deepEqual(after.settings, { library: 'adv3000' }, 'settings.library = adv3000');
  assert.deepEqual(pick(after, KEPT), pick(before, KEPT), 'records / sched / custom / sessions / wordOff / ink unchanged');
  const log = (await writeLog(page)).slice(logStart);
  const keys = [...new Set(log.map(e => e.key))].sort();
  assert.deepEqual(keys, ['shizi.v2.settings', 'shizi.v2.txn'], 'only txn and settings were written');
  assert.ok(log.every(e => e.via === 'storage'), 'no direct localStorage writes');

  // ------------------------------------------------------------ 4. 只影响新字来源
  ctx.step('new chars come from the new library: startA after the switch picks adv3000 chars; records / sched unchanged');
  const control = await page.evaluate(async ({ s, today }) => {
    const { planDaily } = await import('/src/core/session-start.js');
    const { deckAdapter } = await import('/src/data/deck.js');
    const p = planDaily({ ...s, settings: null }, { today, deck: deckAdapter });
    return { newKeys: p.newKeys, libraryId: p.libraryId };
  }, { s: before, today: DAY });
  assert.equal(control.libraryId, 'core3500', 'control: without the switch the range is core3500');
  assert.ok(control.newKeys.length > 0 && control.newKeys.every(k => members.core3500.includes(k)), 'control: new chars from core3500');

  const started = await page.evaluate(async mod => {
    const m = await import(mod);
    const r = m.startA({ source: { view: 'library' } });
    return JSON.parse(JSON.stringify({ ok: r.ok, opened: r.opened }));
  }, SESSION_MOD);
  assert.deepEqual(started, { ok: true, opened: 'new' }, 'startA opened a new group');
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  const st = await state(page);
  const queue = st.sessions.A.queue;
  assert.equal(st.sessions.A.kind, 'daily', 'daily group');
  // D41：组里除了新字，到期不够时还有「提前复习」补位的已写过的字（它们是复习，不是新字，可以来自任何字库）；这里只看新字。
  const newInQueue = queue.filter(k => !before.sched[k]);
  // 新字顺序 = 易忘度清单里属于该库的字在前、其余按 SEED 字频序（D28；src/data/deck.js deckAdapter.newCandidates）
  const adv = await page.evaluate(async () => (await import('/src/data/deck.js')).deckAdapter.newCandidates('adv3000'));
  const expected = adv.filter(k => !before.sched[k]).slice(0, newInQueue.length);
  assert.ok(queue.length > 0 && newInQueue.length > 0, 'queue not empty, has new chars');
  assert.ok(newInQueue.every(k => members.adv3000.includes(k)), 'every new char is in 规范次常用字');
  assert.ok(newInQueue.every(k => !members.core3500.includes(k)), 'no new char from 规范常用字');
  assert.deepEqual(newInQueue, expected, 'new chars follow the adv3000 order (易忘度 list first, then SEED), skipping chars already scheduled (耶)');
  assert.ok(!queue.includes('base:耶') || before.sched['base:耶'], '耶 already has a schedule → never counted as a new char');
  assert.deepEqual(pick(st, ['records', 'sched', 'custom']), pick(before, ['records', 'sched', 'custom']), 'records / sched / custom unchanged after startA');
  assert.deepEqual(st.sessions.B, before.sessions.B, 'the picked group B is untouched');

  // ------------------------------------------------------------ 5. 再打开
  ctx.step('reopen: 规范次常用字 is current, M unchanged; tapping the current library goes back');
  await goTab(page, 'home');
  await openSwitchFromSettings(page);
  list = await rows(page);
  assert.deepEqual(list.map(r => r.current), ['false', 'true', 'false', 'false'], 'adv3000 current');
  assert.deepEqual(list.map(r => r.mark), ['›', '正在用', '›', '›'], 'marks after the switch');
  assert.deepEqual(list.map(r => r.recorded), expectRecorded, 'M still from records');
  const logBefore = (await writeLog(page)).length;
  await page.click(row('adv3000'));
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.top && s.top.n === 'settings';
  });
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'settings', 'current library → back to settings');
  assert.equal((await writeLog(page)).length, logBefore, 'no write');
  assert.equal(await page.$(DIALOG), null, 'no dialog');

  // ------------------------------------------------------------ 6. 系统返回关确认框
  ctx.step('system back closes the confirm dialog without writing');
  await openSwitch(page);
  await page.click(row('rare'));
  await page.waitForSelector(DIALOG);
  await waitNavIdle(page);
  await page.goBack();
  await page.waitForSelector(DIALOG, { state: 'detached' });
  await waitNavIdle(page);
  assert.equal((await routerTop(page)).top, 'library-switch', 'back on the list');
  assert.deepEqual((await state(page)).settings, { library: 'adv3000' }, 'unchanged');
  await goTab(page, 'home');
}
