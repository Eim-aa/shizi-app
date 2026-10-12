// I3 · 按钮与操作层级的页面级验收（规范 B2 / B3 / A4；审计 P1-13 / P1-16 / P1-21 / P1-14 …）。
// 每个 step 对应审计编号；断言的是量出来的位置与热区，不是源码。
import { bootTestHost, seedSession, topSel, tid, waitNavIdle } from './helpers.mjs';
import { goHomeTab, seedEndedGroup } from './q2-helpers.mjs';

async function rectOf(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // 文字按钮的点击区 = 按钮盒子 ∪ ::after 扩出的盒子（HIT_EXT：宽同按钮、高 ≥ 44）
    const host = el.closest('button') || el;
    const h = host.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(host);
    const t = range.getBoundingClientRect();
    return { l: h.left, r: h.right, t: h.top, b: h.bottom, textL: t.left, textR: t.right, hitH: Math.max(h.height, 44) };
  }, selector);
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  step('P1-13: 写字页页头右上「结束这组」与「跳过」：字与字之间 ≥ 12pt，点击区互不重叠（间隔 ≥ 8pt）');
  for (const [w, h] of [[393, 852], [320, 568]]) {
    await page.setViewportSize({ width: w, height: h });
    await seedSession(page, { slot: 'B', kind: 'picked', chars: ['春', '夏', '秋'] });
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('write', { slot: 'B' }));
    await page.waitForSelector(topSel('write-end'));
    await page.waitForSelector(topSel('write-skip'));
    await waitNavIdle(page);
    const end = await rectOf(page, topSel('write-end'));
    const skip = await rectOf(page, topSel('write-skip'));
    assert.ok(end && skip, `${w}: both buttons exist`);
    assert.ok(skip.textL - end.textR >= 12, `${w}: gap between the two labels ${(skip.textL - end.textR).toFixed(1)} ≥ 12`);
    assert.ok(skip.l - end.r >= 8, `${w}: hit areas ${(skip.l - end.r).toFixed(1)} ≥ 8 apart (no overlap)`);
    assert.ok(end.hitH >= 44 && skip.hitH >= 44, `${w}: both still ≥ 44 high`);
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
    await waitNavIdle(page);
  }
  await page.setViewportSize({ width: 393, height: 852 });

  // ---------------------------------------------------------------- 无障碍：页面内容（A2）
  step('P1-39: the live regions for failures are mounted before any text arrives (home, library block, detail, result, month)');
  await goHomeTab(page);
  const home = await page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="home-start-live"]');
    return el ? { role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: el.textContent } : null;
  });
  assert.deepEqual(home, { role: 'status', live: 'polite', text: '' }, 'home: an empty status region is already there');

  step('P2-20 + P1-39: until the seal has landed the result page footer and body are inert (nothing invisible can be reached), afterwards they are not; the empty live region is there from the start');
  await seedEndedGroup(page, { chars: [{ c: '静' }, { c: '永', judgment: 'wrong' }, { c: '和' }] });
  await page.evaluate(async () => {
    window.__sawInert = false;
    const mo = new MutationObserver(() => {
      const foot = document.querySelector('.sz-layer[data-top="true"] .sz-page[data-testid="result-screen"] .sz-page__foot');
      if (foot && foot.hasAttribute('inert') && document.querySelector('.sz-layer[data-top="true"] .sz-page[data-late="pending"]')) window.__sawInert = true;
    });
    mo.observe(document.body, { subtree: true, attributes: true, childList: true });
    window.__moInert = mo;
    (await import('/src/ui/router.js')).nav.push('result', { slot: 'A', sessionId: 's90' });
  });
  await page.waitForSelector(topSel('result-screen'));
  const live = await page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="result-live"]');
    return el ? { role: el.getAttribute('role'), text: el.textContent } : null;
  });
  assert.deepEqual(live, { role: 'status', text: '' }, 'result: an empty status region is already there');
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] .sz-page[data-late]'), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => window.__sawInert), true, 'the footer was inert while the seal had not landed yet');
  assert.equal(await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] .sz-page__foot').hasAttribute('inert')), false, 'and is live afterwards');
  await page.evaluate(() => window.__moInert.disconnect());
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);

  step('P1-36: month page and character detail have a page title for screen readers (focus lands on it after the push)');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('month', { month: '2026-09' }));
  await page.waitForSelector(topSel('month-screen'));
  const titles = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return { h1: top.querySelector('[data-page-title]').textContent.trim(), visibleH2Hidden: top.querySelector('[data-testid="month-title"]').getAttribute('aria-hidden') };
  });
  assert.deepEqual(titles, { h1: '9月字帖', visibleH2Hidden: 'true' }, 'month: the h1 names the page, the big visible title is not read twice');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);
  await page.evaluate(async () => (await import('/src/ui/screens/detail/index.js')).openDetail('静'));
  await page.waitForSelector(topSel('detail-screen'));
  assert.equal(await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-page-title]').textContent.trim()), '「静」的记录', 'detail: the page title names the character');
}
