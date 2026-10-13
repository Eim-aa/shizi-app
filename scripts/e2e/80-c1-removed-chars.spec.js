// 卡 C1（D50 ①）：来源授权有问题的 76 个补充字已从题库与 data/ 移除。已有用户记录里有这些字时按现有「字不在题库」路径降级：
//   1. 字墙照常显示用户自己的记录，这些字用楷体回退（data-glyph-src=fallback），不去请求 data/<字>.json（没有 404）；
//   2. 单字详情能打开、显示记录，不抛错；
//   3. 今天的练习（到期复习 + 新字）不再出这些字；首页照常；全程没有 console.error / pageerror（运行器统一断言）。
import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';

const TODAY = '2026-10-04';
const CLOCK = `${TODAY}T09:00:00`;
const GONE = ['廆', '嚭', '㧐']; // strokeorder.cc / 台湾教育部 / 华文楷体 各一个
const KEPT = ['永', '鼎'];
const TOP = '.sz-layer[data-top="true"]';

function legacyState() {
  const records = {};
  const sched = {};
  [...GONE, ...KEPT].forEach((c, i) => {
    const day = '2026-09-30';
    const at = new Date(`${day}T08:00:00`).getTime() + i * 60000;
    (records['2026-09'] = records['2026-09'] || []).push({
      id: `r${i + 1}`, cardKey: `base:${c}`, char: c, sessionId: 's900', kind: 'judged', judgment: i % 2 ? 'correct' : 'wrong',
      at, localDay: day, help: { hints: 0, answerSeen: false, traced: false },
    });
    sched[`base:${c}`] = { due: '2026-10-02', fsrs: { stability: 1 }, lastJudgedAt: at };
  });
  return { records, sched, custom: { added: [{ char: '嚭', at: 1000 }] }, settings: { library: 'rare' } };
}

async function goTab(page, tab) {
  await page.evaluate(async t => (await import('/src/ui/router.js')).nav.switchTab(t), tab);
  await page.waitForFunction(async t => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === t;
  }, tab);
  await waitNavIdle(page, { settleMs: 200 });
}

export default async function (page, ctx) {
  const { assert } = ctx;
  const strokeRequests = [];
  page.on('request', req => {
    const m = /\/data\/([^/?]+)\.json/.exec(decodeURIComponent(req.url()));
    if (m) strokeRequests.push(m[1]);
  });
  await bootTestHost(page, ctx.baseURL);

  ctx.step('seeded legacy records with removed characters (廆 嚭 㧐): the store accepts them as they are');
  const seeded = await page.evaluate(({ iso, s }) => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(iso);
    const r = window.__shiziTest.seed(s);
    document.dispatchEvent(new Event('visibilitychange'));
    return r;
  }, { iso: CLOCK, s: legacyState() });
  assert.ok(seeded && seeded.ok, 'seed ok');

  ctx.step('library wall: the user\'s own records of removed characters stay, drawn with the ShiziKai fallback; no stroke-data request for them');
  await goTab(page, 'library');
  await page.evaluate(async () => { const { nav, getRouter } = await import('/src/ui/router.js'); if (getRouter().getState().top.n !== 'library-all') nav.push('library-all', { sort: 'age' }); }); // r7-L1（D60）：墨墙在「全部」页
  await page.waitForSelector(`${TOP} [data-testid="all-cell"]`);
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] [data-testid="all-cell"] .sz-pg[data-glyph-src="loading"]'), null, { timeout: 15000 });
  const wall = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="all-cell"]')]
    .map(cell => ({ char: cell.dataset.char, src: cell.querySelector('.sz-pg') && cell.querySelector('.sz-pg').dataset.glyphSrc })));
  const byChar = Object.fromEntries(wall.map(c => [c.char, c.src]));
  for (const ch of GONE) assert.equal(byChar[ch], 'fallback', `${ch} is on the wall with the ShiziKai fallback`);
  for (const ch of KEPT) assert.equal(byChar[ch], 'outline', `${ch} still has its outline`);

  assert.deepEqual(strokeRequests.filter(ch => GONE.includes(ch)), [], 'wall: no request for removed chars');
  ctx.step('detail of a removed character opens and shows the record');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('detail', { char: '廆' }));
  await page.waitForSelector(topSel('detail-screen'));
  await waitNavIdle(page);
  const detailText = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"]').textContent);
  assert.ok(detailText.includes('廆'), 'the detail page names the character');
  assert.deepEqual(strokeRequests.filter(ch => GONE.includes(ch)), [], 'detail: no request for removed chars');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);

  ctx.step('today\'s practice no longer offers removed characters (due reviews and new characters come from the deck only)');
  const plan = await page.evaluate(async today => {
    const { planDaily } = await import('/src/core/session-start.js');
    const { deckAdapter } = await import('/src/data/deck.js');
    return planDaily(window.__shiziTest.getState(), { today, deck: deckAdapter }).queue;
  }, TODAY);
  assert.ok(plan.length > 0, 'there is still something to write');
  for (const ch of GONE) assert.ok(!plan.includes(`base:${ch}`), `${ch} is not queued`);
  await goTab(page, 'home');
  await page.waitForSelector(topSel('home-start'));

  const removedRequested = strokeRequests.filter(ch => GONE.includes(ch));
  assert.deepEqual(removedRequested, [], 'no request for data/<removed>.json (no 404s)');
}
