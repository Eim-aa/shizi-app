// r7-S2（D65 ②）：「我的」页「每组字数」。
//
//   1. 常用设置组里外观之后一行「每组字数」：标准字号行内四段 5｜10｜20｜30（radiogroup，每段 ≥ 44 × 44），没选过 = 20（老用户同样）。
//   2. 点一下即生效：写 settings.groupSize（经 store.commit），没有提示条；首页主按钮 / 字库「今日练习」的数按新值；
//      写到一半的一组不变，下一组按新值开。
//   3. AX5：四段改成一行「每组字数 …… 20 个 ›」，点开选择弹层（与外观同一种），选一项即关、行上的值随之变。
// 控制台零错误由 run.mjs 统一断言。

import { bootTestHost, setTextSize, tid, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-09-24';
const CLOCK = `${TODAY}T09:00:00`;
const TOP = '.sz-layer[data-top="true"]';

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

const plannedSize = page => page.evaluate(async () => {
  const { planDaily } = await import('/src/core/session-start.js');
  const { deckAdapter } = await import('/src/data/deck.js');
  const st = window.__shiziTest.getState();
  return planDaily(st, { today: '2026-09-24', deck: deckAdapter }).queue.length;
});

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  // 写过一次（不是首练），没有到期字：今天的练习全是新字，组大小 = 每组字数
  const rec = { id: 'r1', cardKey: 'base:数', char: '数', sessionId: 's900', kind: 'judged', judgment: 'correct', at: new Date('2026-09-21T08:00:00').getTime(), localDay: '2026-09-21', // 三天前（新用户前 3 天的新字封顶 D66 ⑫ 不在这里测）
    help: { hints: 0, answerSeen: false, traced: false } };
  await seed(page, { records: { '2026-09': [rec] } });
  await toTab(page, 'mine');
  await page.waitForSelector(`${TOP} ${tid('mine-group-size')}`);

  step('每组字数: one row after 外观, four segments 5 | 10 | 20 | 30, default 20');
  const seg = await page.evaluate(sel => {
    const root = document.querySelector(sel);
    const row = root.querySelector('[data-testid="mine-group-size"]');
    const app = root.querySelector('[data-testid="mine-appearance"]');
    const g = row.querySelector('[data-testid="mine-group-size-seg"]');
    return {
      after: !!(app.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING),
      name: row.querySelector('.sz-rrow__nm').innerText.trim(), role: g.getAttribute('role'),
      opts: [...g.querySelectorAll('[role="radio"]')].map(o => { const b = o.getBoundingClientRect(); return { v: o.dataset.value, t: o.innerText.trim(), c: o.getAttribute('aria-checked'), a: o.getAttribute('aria-label'), w: b.width, h: b.height }; }),
      overflow: row.scrollWidth > row.clientWidth + 1 || g.getBoundingClientRect().right > row.getBoundingClientRect().right + 0.5,
    };
  }, TOP);
  assert.equal(seg.after, true, 'right after 外观 in the same block');
  assert.equal(seg.name, '每组字数');
  assert.equal(seg.role, 'radiogroup');
  assert.deepEqual(seg.opts.map(o => [o.v, o.t, o.c]), [['5', '5', 'false'], ['10', '10', 'false'], ['20', '20', 'true'], ['30', '30', 'false']], 'options; 20 when never chosen');
  assert.deepEqual(seg.opts.map(o => o.a), ['5 个', '10 个', '20 个', '30 个'], 'screen-reader names');
  assert.ok(seg.opts.every(o => o.h >= 44 && o.w >= 44), 'each segment ≥ 44 × 44');
  assert.equal(seg.overflow, false, 'fits on one row');
  assert.equal(await plannedSize(page), 20, "today's group is 20 by default");

  step('one tap: 10 is written to settings.groupSize, no toast; the next group is 10');
  await page.click(`${TOP} ${tid('mine-group-size-option')}[data-value="10"]`);
  await page.waitForFunction(() => (window.__shiziTest.getState().settings || {}).groupSize === 10);
  assert.equal(await page.evaluate(sel => document.querySelector(`${sel} [data-testid="mine-group-size-option"][aria-checked="true"]`).dataset.value, TOP), '10');
  assert.equal(await page.locator('[data-testid="toast"]').count(), 0, 'no toast (F5)');
  assert.equal(await plannedSize(page), 10);

  step('home: starting writes a group of 10; changing to 30 mid-group keeps that group at 10, the next one is 30');
  await toTab(page, 'home');
  await page.click(`${TOP} ${tid('home-start')}`);
  await page.waitForFunction(() => { const s = window.__shiziTest.getState().sessions; return s && s.A && s.A.queue.length === 10; });
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
  await page.evaluate(async () => { const { commitGroupSize } = await import('/src/ui/screens/mine/prefs.js'); const { getStore } = await import('/src/store/store.js'); commitGroupSize(getStore(), 30); });
  assert.equal(await page.evaluate(() => window.__shiziTest.getState().sessions.A.queue.length), 10, 'the open group is unchanged');
  await page.evaluate(() => {
    const st = window.__shiziTest.getState();
    window.__shiziTest.seed({ ...st, sessions: { A: null, B: null, lastEnded: {} } });
  });
  assert.equal(await plannedSize(page), 30, 'the next group follows the new size');

  step('AX5: one row 「每组字数 …… 30 个 ›」 that opens the same kind of sheet as 外观');
  await toTab(page, 'mine');
  await setTextSize(page, 'AX5');
  await page.waitForFunction(sel => document.querySelector(`${sel} [data-testid="mine-group-size"]`).dataset.mode === 'pick', TOP);
  const axRow = await page.evaluate(sel => {
    const el = document.querySelector(`${sel} [data-testid="mine-group-size"]`);
    return { tag: el.tagName, text: el.innerText.replace(/\s+/g, ' ').trim(), seg: !!document.querySelector(`${sel} [data-testid="mine-group-size-seg"]`), hScroll: document.scrollingElement.scrollWidth > window.innerWidth };
  }, TOP);
  assert.equal(axRow.tag, 'BUTTON');
  assert.equal(axRow.text, '每组字数 30 个');
  assert.equal(axRow.seg, false);
  assert.equal(axRow.hScroll, false);
  await page.click(`${TOP} ${tid('mine-group-size')}`);
  await page.waitForSelector(tid('mine-group-size-sheet'));
  const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid="mine-group-size-sheet-option"]')].map(o => [o.dataset.value, o.innerText.trim(), o.getAttribute('aria-checked')]));
  assert.deepEqual(opts, [['5', '5 个', 'false'], ['10', '10 个', 'false'], ['20', '20 个', 'false'], ['30', '30 个', 'true']]);
  await page.waitForTimeout(450); // 弹层刚出现：防连点窗口
  await page.click(`${tid('mine-group-size-sheet-option')}[data-value="5"]`);
  await page.waitForFunction(() => !document.querySelector('[data-testid="mine-group-size-sheet"]'));
  await waitNavIdle(page);
  assert.equal((await page.evaluate(() => window.__shiziTest.getState().settings)).groupSize, 5);
  assert.equal(await page.evaluate(sel => document.querySelector(`${sel} [data-testid="mine-group-size-value"]`).innerText.trim(), TOP), '5 个');
  await setTextSize(page, 'L');
}
