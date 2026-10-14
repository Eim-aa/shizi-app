// r7-M1（D63）：「我的」页按丙重做，删「在纸上写」「声音」与「设置」页。
//
//   1. 顺序：概览 → {月}字帖 → 提醒 / 练习范围 / 外观 → 备份 / 年度报告 / 关于拾字 → 版本号；页上没有「设置」「练习记录」「保存图片」字样与入口。
//   2. 概览数算法：连续 / 累计都含 v1 旧版练习日（legacy.days）；今天还没写不算断；已练汉字 = 字库「已练汉字」同一个数。
//   3. 字帖标题行整行进练习记录（本月）。
//   4. 提醒行进提醒页（L1）：开关 / 时间照旧写 settings.remind；左缘右滑返回「我的」；「我的」页提醒行显示时间或「关」。
//   5. 外观三段：一点即切、html data-theme 随之变化、没有提示条；AX5 放不下 → 同一行「外观 …… 当前值 ›」点开三选弹层。
//   6. 没有设置页：路由 'settings' 不存在；写字页没有纸上模式（旧数据 writeMode=paper 按屏幕上写、不被改写）。
//   7. 字库首页「已跳过」与三档之间空一段，单独成块：间距 = 块间距（26）。
// 控制台零错误由 run.mjs 统一断言。

import { bootTestHost, drawStroke, HORIZONTAL, openWrite, seedSession, setTextSize, tid, topSel, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-24';
const CLOCK = `${TODAY}T09:00:00`;
const TOP = '.sz-layer[data-top="true"]';
const pad2 = n => (n < 10 ? `0${n}` : String(n));

function judged(k, char, day, judgment = 'correct') {
  return { id: `r${k}`, cardKey: `base:${char}`, char, sessionId: 's900', kind: 'judged', judgment, at: new Date(`${day}T08:${pad2(k)}:00`).getTime(), localDay: day,
    help: { hints: 0, answerSeen: false, traced: false } };
}
function skipped(k, char, day) {
  return { id: `r${k}`, cardKey: `base:${char}`, char, sessionId: 's902', kind: 'skipped', at: new Date(`${day}T09:${pad2(k)}:00`).getTime(), localDay: day,
    help: { hints: 0, answerSeen: false, traced: false } };
}
function byMonth(list) {
  const out = {};
  for (const r of list) (out[r.localDay.slice(0, 7)] || (out[r.localDay.slice(0, 7)] = [])).push(r);
  return out;
}

async function seed(page, state) {
  const r = await page.evaluate(({ iso, s }) => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(iso);
    const res = window.__shiziTest.seed(s);
    document.dispatchEvent(new Event('visibilitychange'));
    return res;
  }, { iso: CLOCK, s: state });
  if (!r || !r.ok) throw new Error('seed failed ' + JSON.stringify(r));
}

async function toTab(page, name) {
  await page.evaluate(async n => (await import('/src/ui/router.js')).nav.switchTab(n), name);
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page);
}

async function routerTop(page) {
  return page.evaluate(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return { name: s.top && s.top.n, params: (s.top && s.top.p) || {}, depth: s.depth };
  });
}

async function waitTop(page, name) {
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page);
}

async function mineFacts(page) {
  return page.evaluate(sel => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const txt = el => (el ? el.innerText.replace(/\s+/g, ' ').trim() : null);
    const order = ['mine-overview', 'mine-sheet', 'mine-remind', 'mine-library', 'mine-appearance', 'mine-group-size', 'mine-menu-backup', 'mine-menu-annual', 'mine-menu-about', 'mine-version']
      .filter(id => q(id)).sort((a, b) => (q(a).compareDocumentPosition(q(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const ov = q('mine-overview');
    return {
      title: txt(root.querySelector('[data-page-title]')),
      order,
      overview: ov ? { streak: Number(ov.dataset.streak), total: Number(ov.dataset.total), chars: Number(ov.dataset.chars), text: txt(ov),
        clickable: !!ov.querySelector('button, a, [role="button"]') } : null,
      sheetHead: txt(q('mine-sheet-head')),
      remind: txt(q('mine-remind')),
      library: txt(q('mine-library')),
      backup: txt(q('mine-menu-backup')),
      annual: txt(q('mine-menu-annual')),
      about: txt(q('mine-menu-about')),
      version: txt(q('mine-version')),
      text: root.innerText,
      testids: [...root.querySelectorAll('[data-testid]')].map(el => el.dataset.testid),
      hasSeg: !!q('mine-appearance-seg'),
      appearanceMode: q('mine-appearance') ? q('mine-appearance').dataset.mode || 'seg' : null,
      hScroll: document.scrollingElement.scrollWidth > window.innerWidth + 1,
    };
  }, `${TOP} [data-testid="screen-mine"]`);
}

/** 左缘右滑（CDP 真实触摸序列，同 99-g1-edge-swipe）。 */
async function edgeBack(cdp, page, { y, W }) {
  const pt = (x, yy) => ({ x, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(4, y)] });
  const x1 = Math.round(W * 0.45);
  for (let i = 1; i <= 12; i += 1) {
    await page.waitForTimeout(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(4 + ((x1 - 4) * i) / 12, y)] });
  }
  await page.waitForTimeout(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  const W = ctx.viewport.width;
  const H = ctx.viewport.height;
  await bootTestHost(page, ctx.baseURL);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // ------------------------------------------------------------------ 1–2. 顺序与概览
  // 练习日：记录 9-24 / 9-22 / 9-10；旧版练习日 9-23 / 9-21 / 9-20 / 8-30（legacy.days）→ 累计 7 天；连续 9-24 … 9-20 = 5 天；已练汉字 3
  const records = [judged(1, '数', TODAY), judged(2, '静', '2026-09-22'), judged(3, '谁', '2026-09-10')];
  const legacy = { importedAt: new Date('2026-07-01T08:00:00').getTime(), fromKeys: ['shizi.memory.v1'], days: ['2026-09-23', '2026-09-21', '2026-09-20', '2026-08-30'], report: {} };
  await seed(page, { records: byMonth(records), legacy });
  await toTab(page, 'mine');
  await page.waitForSelector(`${TOP} ${tid('mine-sheet')}`);

  step('order: 概览 → 字帖 → 提醒 / 练习范围 / 外观 → 备份 / 年度报告 / 关于 → 版本；没有「设置」「练习记录」「保存图片」');
  let m = await mineFacts(page);
  assert.equal(m.title, '我的', 'big title only');
  assert.deepEqual(m.order, ['mine-overview', 'mine-sheet', 'mine-remind', 'mine-library', 'mine-appearance', 'mine-group-size', 'mine-menu-backup', 'mine-menu-annual', 'mine-menu-about', 'mine-version'],
    'D63 order');
  assert.equal(m.remind, '提醒 关', '提醒 …… 关');
  assert.equal(m.library, '练习范围 常用字', '练习范围 …… 常用字（与字库首页同一个值）');
  assert.equal(m.backup, '备份 还没有备份');
  assert.equal(m.annual, '年度报告 2026');
  assert.equal(m.about, '关于拾字');
  assert.ok(/^版本 \d+\.\d+\.\d+（\d{8}）$/.test(m.version), 'version line from build-info');
  assert.ok(!/设置|保存图片/.test(m.text.replace('手机设置', '')), 'no 设置 / 保存图片 on the page: ' + m.text);
  assert.ok(!m.testids.some(id => /settings|week|records$|mine-records/.test(id)), 'no settings / week / separate records entry: ' + m.testids.join(','));
  assert.equal(m.text.includes('练习记录'), false, 'no separate 练习记录 entry anywhere on the page (the title row is the entry)');
  assert.equal(m.sheetHead, '9月字帖 全部 3 字', 'title row: 「9月字帖」 + 「全部 3 字」');
  assert.equal(m.hScroll, false, 'no horizontal overflow');

  step('overview algorithm: legacy.days counted in both 连续 and 累计; 已练汉字 = the library number');
  assert.deepEqual([m.overview.streak, m.overview.total, m.overview.chars], [5, 7, 3], 'streak 5 (9-20…9-24 across legacy days), total 7, chars 3');
  assert.equal(m.overview.text, '5 天 连续练习 7 天 累计练习 3 字 已练汉字');
  assert.equal(m.overview.clickable, false, 'the overview is not clickable');
  const records0 = await page.evaluate(() => Object.values(window.__shiziTest.getState().records).flat().length);
  assert.equal(records0, 3, 'oracle: only 3 record days — the legacy days are what lift the numbers');
  await toTab(page, 'library');
  const libWritten = await page.evaluate(sel => Number(document.querySelector(`${sel} [data-testid="library-written"]`).dataset.n), TOP);
  assert.equal(libWritten, m.overview.chars, 'library 已练汉字 N = the overview number (same function)');
  await toTab(page, 'mine');

  step('today not written yet: the streak counts from yesterday (not broken); no legacy → plain records');
  await seed(page, { records: byMonth(records.slice(1)), legacy });
  await page.waitForFunction(sel => document.querySelector(`${sel} [data-testid="mine-overview"]`).dataset.chars === '2', TOP);
  m = await mineFacts(page);
  assert.deepEqual([m.overview.streak, m.overview.total, m.overview.chars], [4, 6, 2], '9-23 … 9-20 = 4; 6 days; 2 chars');
  await seed(page, { records: byMonth(records) });
  await page.waitForFunction(sel => document.querySelector(`${sel} [data-testid="mine-overview"]`).dataset.chars === '3', TOP);
  m = await mineFacts(page);
  assert.deepEqual([m.overview.streak, m.overview.total, m.overview.chars], [1, 3, 3], 'without legacy: 3 record days, streak 1');
  await seed(page, {});
  await page.waitForFunction(sel => document.querySelector(`${sel} [data-testid="mine-home"]`).dataset.state === 'empty', TOP);
  m = await mineFacts(page);
  assert.deepEqual([m.overview.streak, m.overview.total, m.overview.chars], [0, 0, 0], 'no records: three zeros');
  assert.equal(m.order.includes('mine-sheet'), false, 'no sheet block when there are no records (existing empty state, no illustration stack)');

  // ------------------------------------------------------------------ 3. 字帖标题行
  step('the whole title row of 「{月}字帖」 opens the practice log on this month');
  await seed(page, { records: byMonth(records), legacy });
  await page.waitForSelector(`${TOP} ${tid('mine-sheet-head')}`);
  const head = await page.evaluate(sel => {
    const el = document.querySelector(`${sel} [data-testid="mine-sheet-head"]`);
    const r = el.getBoundingClientRect();
    const root = document.querySelector(`${sel} [data-testid="screen-mine"]`) || document;
    const title = el.querySelector('[data-testid="mine-sheet-title"]').getBoundingClientRect();
    const all = el.querySelector('[data-testid="mine-sheet-all"]').getBoundingClientRect();
    return { tag: el.tagName, w: r.width, h: r.height, titleInside: title.left >= r.left && title.right <= r.right, allInside: all.right <= r.right + 0.5 && all.left >= r.left, root: !!root };
  }, TOP);
  assert.equal(head.tag, 'BUTTON', 'title row is one button');
  assert.ok(head.h >= 44, 'hit area ≥ 44');
  assert.ok(head.titleInside && head.allInside, 'both the title and 「全部 N 字 ›」 are inside the one button');
  await page.click(`${TOP} ${tid('mine-sheet-head')}`);
  await waitTop(page, 'records');
  let rt = await routerTop(page);
  assert.equal(rt.params.month, '2026-09', 'practice log of this month');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitTop(page, 'mine');

  // ------------------------------------------------------------------ 4. 提醒页
  step('提醒 row → 提醒页 (L1): 开关写 settings.remind, 时间行出现；左缘右滑回「我的」，行里显示时间');
  await page.click(`${TOP} ${tid('mine-remind')}`);
  await waitTop(page, 'remind');
  rt = await routerTop(page);
  assert.equal(rt.depth, 1, 'L1 push');
  assert.equal(await page.locator(`${TOP} ${tid('remind-screen')}`).count(), 1, 'remind page');
  assert.equal(await page.locator(`${TOP} ${tid('page-back')}`).count(), 1, 'top-left back');
  assert.equal(await page.locator(`${TOP} ${tid('remind-time')}`).count(), 0, 'no time row while off');
  await page.click(`${TOP} ${tid('remind-switch')}`);
  await page.waitForSelector(`${TOP} ${tid('remind-time')}`);
  let st = await page.evaluate(() => window.__shiziTest.getState().settings);
  assert.deepEqual([st.remind.enabled, st.remind.hour, st.remind.minute], [true, 20, 0], 'written to settings.remind with the default time (logic unchanged)');
  assert.equal(await page.getAttribute(`${TOP} ${tid('remind-switch')}`, 'aria-checked'), 'true');
  await page.fill(`${TOP} ${tid('remind-time')}`, '07:30');
  await page.waitForFunction(() => {
    const r = window.__shiziTest.getState().settings.remind;
    return r.hour === 7 && r.minute === 30;
  });
  await edgeBack(cdp, page, { y: Math.round(H / 2), W });
  await waitTop(page, 'mine');
  await waitNavIdle(page);
  rt = await routerTop(page);
  assert.equal(rt.depth, 0, 'left-edge swipe went back to 我的');
  m = await mineFacts(page);
  assert.equal(m.remind, '提醒 07:30', 'row shows the time');
  await page.click(`${TOP} ${tid('mine-remind')}`);
  await waitTop(page, 'remind');
  await page.click(`${TOP} ${tid('remind-switch')}`);
  await page.waitForFunction(() => window.__shiziTest.getState().settings.remind.enabled === false);
  await page.click(`${TOP} ${tid('page-back')}`);
  await waitTop(page, 'mine');
  m = await mineFacts(page);
  assert.equal(m.remind, '提醒 关', 'off again → 关');

  // ------------------------------------------------------------------ 5. 外观三段
  step('外观: 三段「跟随系统｜日间｜夜间」，一点即切，data-theme 随之变化，没有提示条');
  const seg = await page.evaluate(sel => {
    const g = document.querySelector(`${sel} [data-testid="mine-appearance-seg"]`);
    return { role: g.getAttribute('role'), opts: [...g.querySelectorAll('[role="radio"]')].map(o => ({ v: o.dataset.value, t: o.innerText.trim(), c: o.getAttribute('aria-checked'), h: o.getBoundingClientRect().height })) };
  }, TOP);
  assert.equal(seg.role, 'radiogroup');
  assert.deepEqual(seg.opts.map(o => [o.v, o.t, o.c]), [['auto', '跟随系统', 'true'], ['light', '日间', 'false'], ['dark', '夜间', 'false']], 'order and labels (D63), 跟随系统 current');
  assert.ok(seg.opts.every(o => o.h >= 44), 'each segment ≥ 44 high');
  const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const checked = () => page.evaluate(sel => [...document.querySelectorAll(`${sel} [data-testid="mine-appearance-option"]`)].find(o => o.getAttribute('aria-checked') === 'true').dataset.value, TOP);
  assert.equal(await theme(), null, 'auto: no data-theme');
  await page.click(`${TOP} ${tid('mine-appearance-option')}[data-value="dark"]`);
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  assert.equal(await checked(), 'dark', '夜间 selected after ONE tap');
  assert.equal((await page.evaluate(() => window.__shiziTest.getState().settings)).appearance, 'dark', 'written to settings.appearance');
  assert.equal(await page.locator('[data-testid="toast"]').count(), 0, 'no toast for a successful switch (F5)');
  await page.waitForTimeout(450);
  await page.click(`${TOP} ${tid('mine-appearance-option')}[data-value="light"]`);
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
  assert.equal(await checked(), 'light', '日间');
  await page.waitForTimeout(450);
  await page.click(`${TOP} ${tid('mine-appearance-option')}[data-value="auto"]`);
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));
  assert.equal(await checked(), 'auto', '跟随系统 again');
  assert.equal(await page.evaluate(sel => /浅色|深色/.test(document.querySelector(`${sel} [data-testid="mine-appearance"]`).innerText), TOP), false, 'no 浅色 / 深色 wording on the appearance row (the pale-glyph note 「浅色的字…」 is about glyphs, not the theme)');

  step('外观 AX5: the three segments cannot fit → one row 「外观 …… 当前值 ›」 that opens a three-way sheet');
  await setTextSize(page, 'AX5');
  await page.waitForFunction(sel => document.querySelector(`${sel} [data-testid="mine-appearance"]`).dataset.mode === 'pick', TOP);
  m = await mineFacts(page);
  assert.equal(m.hasSeg, false, 'no segmented control at AX5');
  assert.equal(m.appearanceMode, 'pick');
  const axRow = await page.evaluate(sel => {
    const el = document.querySelector(`${sel} [data-testid="mine-appearance"]`);
    return { tag: el.tagName, text: el.innerText.replace(/\s+/g, ' ').trim(), h: el.getBoundingClientRect().height };
  }, TOP);
  assert.equal(axRow.tag, 'BUTTON');
  assert.equal(axRow.text, '外观 跟随系统', 'one row: 外观 + current value');
  assert.equal(m.hScroll, false, 'AX5: no horizontal overflow');
  const noPan = await page.evaluate(() => { window.scrollTo(40, 40); return [window.scrollX, window.scrollY, document.scrollingElement.scrollWidth <= window.innerWidth]; });
  assert.deepEqual(noPan, [0, 0, true], 'N7: the page itself does not pan');
  await page.click(`${TOP} ${tid('mine-appearance')}`);
  await page.waitForSelector(tid('mine-appearance-sheet'));
  const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid="mine-appearance-sheet-option"]')].map(o => [o.dataset.value, o.innerText.trim(), o.getAttribute('aria-checked')]));
  assert.deepEqual(opts, [['auto', '跟随系统', 'true'], ['light', '日间', 'false'], ['dark', '夜间', 'false']], 'sheet options');
  await page.waitForTimeout(450); // 弹层刚出现：防连点窗口
  await page.click(`${tid('mine-appearance-sheet-option')}[data-value="dark"]`);
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await page.waitForFunction(() => !document.querySelector('[data-testid="mine-appearance-sheet"]'));
  await waitNavIdle(page);
  assert.equal((await mineFacts(page)).text.includes('夜间'), true, 'the row now shows 夜间');
  await setTextSize(page, 'L');
  await page.waitForFunction(sel => document.querySelector(`${sel} [data-testid="mine-appearance"]`).dataset.mode !== 'pick', TOP);
  assert.equal(await checked(), 'dark', 'back to the segmented control, 夜间 selected');
  await page.click(`${TOP} ${tid('mine-appearance-option')}[data-value="auto"]`);
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));

  // ------------------------------------------------------------------ 6. 没有设置页、没有纸上模式
  step('no settings page: route gone, no entry anywhere; 声音 / 写字方式 gone with it');
  const gone = await page.evaluate(async () => {
    const { getScreen, nav } = await import('/src/ui/router.js');
    let threw = null;
    try {
      nav.push('settings', {});
    } catch (error) {
      threw = String(error && error.message);
    }
    return { reg: !!getScreen('settings'), threw, remind: !!getScreen('remind') };
  });
  assert.equal(gone.reg, false, "screen 'settings' is not registered");
  assert.ok(/unknown screen/.test(gone.threw || ''), 'pushing it is an error, nothing renders');
  assert.equal(gone.remind, true, 'the reminder page is registered');
  assert.equal(await page.locator('[data-testid^="settings-"]').count(), 0, 'no settings-* elements');

  step('write page: no 在纸上写; settings.writeMode=paper (old data) behaves as writing on screen and is left untouched');
  const res = await seedSession(page, { chars: ['永', '和', '春'], kind: 'daily', extraState: { settings: { writeMode: 'paper', sound: false, paperSuggested: true } } });
  assert.ok(res.ok, 'seeded');
  await toTab(page, 'home');
  await openWrite(page);
  const w = await page.evaluate(sel => ({
    paper: document.querySelectorAll(`${sel} [data-testid^="write-paper"]`).length,
    live: document.querySelectorAll(`${sel} [data-testid="write-grid-live"]`).length,
    donesDisabled: document.querySelector(`${sel} [data-testid="write-done"]`).disabled,
    text: document.querySelector(`${sel} [data-testid="write-screen"]`).innerText,
  }), TOP);
  assert.equal(w.paper, 0, 'no paper surface');
  assert.equal(w.live, 1, 'the live writing grid is there');
  assert.equal(w.donesDisabled, true, '「写好了」 needs strokes again (it did not in paper mode)');
  assert.ok(!/在纸上写|纸上/.test(w.text), 'no 在纸上写 wording on the write page');
  await drawStroke(page, HORIZONTAL);
  await page.waitForFunction(sel => !document.querySelector(`${sel} [data-testid="write-done"]`).disabled, TOP);
  st = await page.evaluate(() => window.__shiziTest.getState().settings);
  assert.equal(st.writeMode, 'paper', 'the old value is not rewritten (read as screen)');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);

  // ------------------------------------------------------------------ 7. 字库「已跳过」分块
  step('字库首页：「已跳过」与三档之间空一段，单独成块——与「已熟悉」的间距 = 块间距（26）');
  const lib = [judged(1, '永', '2026-09-23', 'wrong'), judged(2, '春', '2026-09-18'), judged(3, '中', '2026-09-01'), skipped(4, '水', '2026-09-21')];
  await seed(page, { records: byMonth(lib) });
  await toTab(page, 'library');
  await page.waitForSelector(`${TOP} ${tid('library-skipped')}`);
  const gaps = await page.evaluate(sel => {
    const root = document.querySelector(`${sel} [data-testid="screen-library"]`);
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const zones = [...root.querySelectorAll('[data-testid="library-zone"]')];
    const known = zones[zones.length - 1];
    const skippedRow = q('library-skipped');
    const skippedBlock = skippedRow.closest('.sz-libr__blk');
    const todayBlock = q('library-today').closest('.sz-libr__blk');
    const rangeRow = q('library-range');
    const zonesBlock = known.closest('.sz-libr__blk');
    return {
      knownKind: known.dataset.kind,
      sep: skippedBlock !== zonesBlock,
      skippedGap: Math.round((skippedBlock.getBoundingClientRect().top - known.getBoundingClientRect().bottom) * 10) / 10,
      blockGap: Math.round((todayBlock.getBoundingClientRect().top - rangeRow.getBoundingClientRect().bottom) * 10) / 10,
      zoneGap: Math.round((zones[1].getBoundingClientRect().top - zones[0].getBoundingClientRect().bottom) * 10) / 10,
      hair: getComputedStyle(skippedBlock).borderTopWidth,
    };
  }, TOP);
  assert.equal(gaps.knownKind, 'known');
  assert.equal(gaps.sep, true, '已跳过 is its own block (not inside the three-zone block)');
  assert.equal(gaps.blockGap, 26, 'block gap = 26');
  assert.equal(gaps.skippedGap, gaps.blockGap, '已跳过 ↔ 已熟悉 gap equals the block gap');
  assert.equal(gaps.zoneGap, 0, 'the three zones stay flush with each other');
}
