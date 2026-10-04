// 决定-D27（阶段 1 P1-E3）：本人笔迹留存「每字第一次 + 最近一次」，其余回收。
//
// 真实写字页流程（不注入 policy：perRecordInk 默认开启）把「永」写三次、跨三个月（3月 / 7月 / 10月，时钟平移）：
//   第一次在一次页面加载里写完；刷新后第二、三次在**同一次页面加载**里写（第二次写完时页面会话里记着它的笔画）。
// 断言：
//   1. 存储：三条 judged 记录；第一次（3月键）与最近一次（10月键）的墨迹在，中间那次（7月键）在写第三次的同一次
//      store.commit 里被回收；全部写入经 storage.js（getWriteLog 无 via=direct）。
//   2. 同一页面（没刷新）：详情页历次格子 [有墨, 没有笔迹, 有墨]——中间那次虽是本页面刚写过的，也不拿页面内笔画补（如实）；
//      data-first / data-latest 指向第一次与最近一次；字库墙「永」画本人笔迹；首页墨迹行画本人笔迹；墙说明是 D27 改写后的原槽。
//   3. 刷新后、以及取 storageState 开**全新浏览上下文**冷启动后：详情页同上，第一次与最近一次的格子真有墨（canvas 有像素）。
import { bootTestHost, drawStroke, HORIZONTAL, openWrite, seedSession, tid, topSel, VERTICAL, waitNavIdle } from './helpers.mjs';

const CHAR = '永';
const ROUNDS = [
  { clock: '2026-03-03T09:00:00', judgment: 'correct', month: '2026-03' },
  { clock: '2026-07-08T09:00:00', judgment: 'wrong', month: '2026-07' },
  { clock: '2026-10-02T20:00:00', judgment: 'correct', month: '2026-10' },
];

async function goHome(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await page.waitForFunction(async () => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === 'home';
  });
  await waitNavIdle(page);
}

async function setClock(page, iso) {
  await page.evaluate(c => window.__shiziTest.setClock(c), iso);
}

/** 当前数据 + 一个只有「永」的今天的练习（A），从首页测试入口打开写字页。 */
async function startRound(page, n) {
  await goHome(page);
  const state = await page.evaluate(() => {
    const s = window.__shiziTest.getState();
    delete s.sessions;
    return s;
  });
  const at = await page.evaluate(() => window.__shiziTest.now());
  const seeded = await seedSession(page, { reset: false, extraState: state, id: `s${900 + n}`, slot: 'A', kind: 'daily', chars: [CHAR], at });
  if (!seeded.ok) throw new Error('seed failed: ' + JSON.stringify(seeded.result));
  await openWrite(page, { slot: 'A' });
}

async function writeAndJudge(page, judgment, before) {
  for (const [pts, n] of [[HORIZONTAL, 1], [VERTICAL, 2]]) {
    await drawStroke(page, pts);
    await page.waitForFunction(k => {
      const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
      return !!g && Number(g.dataset.strokeCount) === k;
    }, n);
  }
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-compare'));
  await waitNavIdle(page);
  await page.click(topSel(judgment === 'wrong' ? 'write-judge-wrong' : 'write-judge-correct'));
  await page.waitForFunction(k => {
    const st = window.__shiziTest.getState();
    let n = 0;
    for (const list of Object.values(st.records || {})) for (const r of Array.isArray(list) ? list : list.kept || []) if (r.kind === 'judged') n += 1;
    return n === k;
  }, before + 1);
  await waitNavIdle(page);
}

async function facts(page) {
  return page.evaluate(c => {
    const T = window.__shiziTest;
    const st = T.getState();
    const judged = [];
    for (const list of Object.values(st.records || {})) for (const r of Array.isArray(list) ? list : list.kept || []) if (r.kind === 'judged' && r.char === c) judged.push(r);
    judged.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    return {
      judged: judged.map(r => ({ id: r.id, month: r.localDay.slice(0, 7), judgment: r.judgment, ink: !!T.getInk(r) })),
      inkKeys: Object.keys(T.getRawKeys('shizi.v2.ink.')).sort(),
      direct: T.getWriteLog().filter(w => w.via === 'direct').length,
    };
  }, CHAR);
}

async function openDetail(page) {
  await page.evaluate(async c => (await import('/src/ui/screens/detail/index.js')).openDetail(c), CHAR);
  await page.waitForSelector(topSel('detail-screen'));
  await waitNavIdle(page);
  // 格子笔迹画在 canvas 上（视口附近才画）：等首末两格的 canvas 有像素
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return [...top.querySelectorAll('[data-testid="detail-cell"]')].map(cell => {
      const canvas = cell.querySelector('[data-testid="detail-cell-ink"] canvas') || cell.querySelector('canvas');
      let px = 0;
      if (canvas && canvas.width) {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) px += 1;
      }
      return {
        record: cell.dataset.record,
        ink: cell.dataset.ink,
        first: cell.dataset.first || null,
        latest: cell.dataset.latest || null,
        noink: !cell.querySelector('[data-testid="detail-cell-noink"]') && !!cell.querySelector('[data-testid="detail-cell-glyph"]') && cell.getAttribute('aria-label').includes('没有笔迹') && !cell.textContent.includes('没有笔迹'),
        px,
      };
    });
  });
}

async function goBack(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);
}

function checkDetail(assert, cells, ids, where) {
  assert.deepEqual(cells.map(c => c.record), ids, `${where}: three cells in record order`);
  assert.deepEqual(cells.map(c => c.ink), ['true', 'false', 'true'], `${where}: first + latest draw the learner's ink, the middle one has none`);
  assert.equal(cells[1].noink, true, `${where}: the middle cell draws the under glyph, writes no 「没有笔迹」 in the cell, and says it in its accessible name (V16 / R-D07)`);
  assert.deepEqual(cells.map(c => [c.first, c.latest]), [['true', null], [null, null], [null, 'true']], `${where}: data-first / data-latest`);
  assert.ok(cells[0].px > 0 && cells[2].px > 0, `${where}: first / latest canvases really have ink (${cells[0].px} / ${cells[2].px} px)`);
}

export default async function inkRetention(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  assert.equal(await page.evaluate(async () => (await import('/src/config/policy.js')).features.perRecordInk), true, 'perRecordInk is on by default (D27)');
  await page.evaluate(() => window.__shiziTest.reset());

  step('round 1 (March): write 永 through the real write screen and judge');
  await setClock(page, ROUNDS[0].clock);
  await startRound(page, 1);
  await writeAndJudge(page, ROUNDS[0].judgment, 0);
  let f = await facts(page);
  assert.deepEqual(f.judged.map(r => [r.month, r.ink]), [['2026-03', true]], 'first judgment stored with ink');

  step('reload; rounds 2 (July) and 3 (October) in the same page load');
  await bootTestHost(page, ctx.baseURL);
  await setClock(page, ROUNDS[1].clock);
  await startRound(page, 2);
  await writeAndJudge(page, ROUNDS[1].judgment, 1);
  f = await facts(page);
  assert.deepEqual(f.judged.map(r => [r.month, r.ink]), [['2026-03', true], ['2026-07', true]], 'two judgments: first + latest both kept');
  await setClock(page, ROUNDS[2].clock);
  await startRound(page, 3);
  await writeAndJudge(page, ROUNDS[2].judgment, 2);
  f = await facts(page);
  assert.deepEqual(f.judged.map(r => [r.month, r.judgment, r.ink]), [['2026-03', 'correct', true], ['2026-07', 'wrong', false], ['2026-10', 'correct', true]],
    'D27: the middle (July) ink is recycled when the third judgment is written; first (March) and latest (October) stay');
  assert.deepEqual(f.inkKeys, ['shizi.v2.ink.2026-03', 'shizi.v2.ink.2026-10'], 'the July ink month key is gone (emptied → removed)');
  assert.equal(f.direct, 0, 'every write went through storage.js (store.commit)');
  const ids = f.judged.map(r => r.id);

  step('same page (no reload): detail cells — the middle one was written on this page but still shows 没有笔迹');
  await goHome(page);
  checkDetail(assert, await openDetail(page), ids, 'same page');
  await goBack(page);

  step('library wall: 永 is drawn with the learner\'s latest ink; legend promises first + latest only');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
  const wall = await page.evaluate(c => {
    const cell = document.querySelector(`[data-testid="library-wall-cell"][data-char="${c}"]`);
    return {
      ink: cell && cell.querySelector('[data-ink]') ? cell.querySelector('[data-ink]').dataset.ink : null,
      canvas: !!(cell && cell.querySelector('[data-testid="library-cell-ink"]')),
      note: document.querySelector('[data-theme-variant="light"]').textContent.trim(),
    };
  }, CHAR);
  assert.equal(wall.ink, 'ink', 'wall cell draws persisted ink (not the standard glyph)');
  assert.ok(wall.canvas, 'wall cell renders InkMini');
  assert.equal(wall.note, await page.evaluate(async () => (await import('/src/config/copy/index.js')).t('R-L03.legend')), 'legend = R-L03.legend (D27 wording)');
  assert.ok(/第一次和最近一次的笔迹/.test(wall.note), 'legend says 第一次和最近一次的笔迹');

  step('home ink row: today\'s 永 is drawn with stored ink');
  await goHome(page);
  const row = await page.evaluate(() => [...document.querySelectorAll('[data-testid="home-ink-item"]')].map(i => i.dataset.ink));
  assert.ok(row.length >= 1 && row.every(k => k && k !== 'none'), `home ink row draws ink (${row.join(',')})`);

  step('refresh: detail still shows first + latest ink, middle 没有笔迹');
  await bootTestHost(page, ctx.baseURL);
  await setClock(page, ROUNDS[2].clock);
  checkDetail(assert, await openDetail(page), ids, 'after reload');

  step('cold start in a brand-new browser context (storageState only): same');
  const storageState = await page.context().storageState();
  const context = await page.context().browser().newContext({ viewport: ctx.viewport, deviceScaleFactor: 2, locale: 'zh-CN', storageState });
  const cold = await context.newPage();
  const errors = [];
  cold.on('pageerror', e => errors.push(`pageerror: ${e && e.message}`));
  cold.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  try {
    await bootTestHost(cold, ctx.baseURL);
    await setClock(cold, ROUNDS[2].clock);
    const fc = await facts(cold);
    assert.deepEqual(fc.judged.map(r => r.ink), [true, false, true], 'cold start: stored ink = first + latest');
    checkDetail(assert, await openDetail(cold), ids, 'cold start');
    assert.ok(await cold.$(tid('detail-screen')), 'detail opened in the new context');

    step('cold context, round 4 (same October day): result page draws stored ink and keeps it after a reload; the 3rd judgment is now the middle one');
    await startRound(cold, 4);
    await writeAndJudge(cold, 'correct', 3);
    await cold.waitForSelector(topSel('result-screen'));
    await waitNavIdle(cold);
    // P1-E7：结果页是作品——有墨的字在作品里（work-cell，画的是存下的墨迹），分享入口 = 页头右上 result-share；没墨时是衬底一行、没有分享
    const resultView = () => cold.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      return {
        inkCells: [...top.querySelectorAll('[data-testid="work-cell"]')].map(c => c.dataset.mode === 'hand' && !!c.querySelector('canvas[data-painted="true"]')),
        imageEntry: !!top.querySelector('[data-testid="result-share"]'),
        plain: !!top.querySelector('[data-testid="work"][data-variant="plain"]'),
      };
    });
    assert.deepEqual(await resultView(), { inkCells: [true], imageEntry: true, plain: false }, 'result page: the work cell draws stored ink, share icon shown');
    await cold.reload();
    await cold.waitForSelector(topSel('result-screen'));
    await waitNavIdle(cold);
    await cold.waitForFunction(() => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="work-cell"] canvas[data-painted="true"]'));
    assert.deepEqual(await resultView(), { inkCells: [true], imageEntry: true, plain: false }, 'after reload the stored ink is still there (not the no-ink variant)');
    const f4 = await facts(cold);
    assert.deepEqual(f4.judged.map(r => r.ink), [true, false, false, true], 'D27 again: first + new latest kept, the former latest recycled');
  } finally {
    await context.close();
  }
  assert.deepEqual(errors, [], 'no errors in the cold-start context');
}
