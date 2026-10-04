// H1-8（T2-11）：「有记录的字」页只留字墙——排序分段控件、筛选胶囊、图例、说明句都收进页头尾端一个「排序 · 筛选」菜单（底部弹层）。
//   - 页面本体（all-body）里没有 all-sorts / all-chips / library-legend / all-note；第一个字出现在屏高 30% 以内（旧版在约 55% 处）；
//   - 页头尾端有文字按钮 all-menu-open「排序 · 筛选」（文字按钮规格、右缘在 20pt 线上）；点开是弹层 all-menu，里面有排序三键、筛选四项、图例、说明句；
//   - 选一个排序 / 筛选后弹层关闭，页面照常变化（data-sort / data-filter），按钮在有筛选时标 data-active；
//   - 查字命中时（排序 / 筛选 / 图例都收起）按钮也收起。
//   393×852 浅 / 深，375×667。
import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

/* eslint-disable no-undef */
const BODY = '.sz-layer[data-top="true"] [data-testid="all-body"]';

async function pageFacts(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('.sz-layer[data-top="true"]');
    const body = layer.querySelector('[data-testid="all-body"]');
    const q = (root, id) => root.querySelector(`[data-testid="${id}"]`);
    const first = body.querySelector('[data-testid="all-cell"]');
    const btn = layer.querySelector('[data-testid="all-menu-open"]');
    const menu = layer.querySelector('[data-testid="all-menu"]');
    const rng = btn ? document.createRange() : null;
    if (btn) rng.selectNodeContents(btn);
    return {
      inBody: ['all-sorts', 'all-chips', 'library-legend', 'all-note'].filter(id => q(body, id)),
      firstTop: first ? first.getBoundingClientRect().top : null,
      vh: window.innerHeight,
      sort: body.dataset.sort,
      filter: body.dataset.filter,
      btn: btn ? { text: btn.textContent.trim(), active: btn.dataset.active || null, isText: btn.classList.contains('sz-btn--text'), inTrail: !!btn.closest('.sz-page__trail'), inkRight: rng.getBoundingClientRect().right, vw: window.innerWidth } : null,
      menu: menu ? {
        sorts: [...menu.querySelectorAll('[data-testid="all-sort"]')].map(b => [b.dataset.key, b.getAttribute('aria-pressed')]),
        chips: [...menu.querySelectorAll('[data-testid="all-chip"]')].map(b => b.dataset.key),
        legend: !!q(menu, 'library-legend'),
        note: q(menu, 'all-note') ? q(menu, 'all-note').textContent.trim() : null,
        title: (menu.querySelector('.sz-sheet__title') || {}).textContent,
      } : null,
    };
  });
}

export default async function run(page0, ctx) {
  const { assert, step } = ctx;
  const runs = [
    { tag: '393×852 light', width: 393, height: 852, scheme: 'light' },
    { tag: '393×852 dark', width: 393, height: 852, scheme: 'dark' },
    { tag: '375×667 light', width: 375, height: 667, scheme: 'light' },
  ];
  let page = page0;
  for (const [i, v] of runs.entries()) {
    if (i > 0) { await page.close(); page = await page0.context().newPage(); }
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.emulateMedia({ colorScheme: v.scheme });
    await bootTestHost(page, ctx.baseURL);
    await seedHomeSpec(page, { entries: [...'疆酱肆酝春嚷醋膝窗屉'].map((c, k) => ({ char: c, at: `2026-10-0${1 + (k % 4)}T20:0${k % 10}:00`, judgment: k < 2 ? 'wrong' : 'correct' })), clock: '2026-10-05T19:30:00' });
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('library-all', {}));
    await page.waitForSelector(`${BODY} [data-testid="all-cell"]`);
    await waitNavIdle(page);

    step(`${v.tag}: 页面本体只留字墙；第一个字在屏高 30% 内；页头尾端「排序 · 筛选」`);
    let f = await pageFacts(page);
    assert.deepEqual(f.inBody, [], `${v.tag}: no sort control / chips / legend / note in the page body`);
    assert.ok(f.firstTop < v.height * 0.3, `${v.tag}: the first character starts at ${Math.round(f.firstTop)} < 30% of ${v.height}`);
    assert.deepEqual([f.btn.text, f.btn.isText, f.btn.inTrail, f.btn.active], ['排序 · 筛选', true, true, null], `${v.tag}: the menu button is a header-trailing text button`);
    assert.ok(Math.abs(f.btn.inkRight - (v.width - 20)) <= 0.6, `${v.tag}: its text ends on the 20pt line (${f.btn.inkRight})`);

    step(`${v.tag}: 点开 → 弹层里有排序三键、筛选四项、图例、说明句；选排序后弹层关闭`);
    await page.click(topSel('all-menu-open'));
    await page.waitForSelector(topSel('all-menu'));
    await waitNavIdle(page);
    f = await pageFacts(page);
    assert.equal(f.menu.title, '排序 · 筛选', `${v.tag}: sheet title`);
    assert.deepEqual(f.menu.sorts, [['recent', 'true'], ['py', 'false'], ['age', 'false']], `${v.tag}: three sorts, recent pressed`);
    assert.deepEqual(f.menu.chips, ['wrong', 'forget', 'unw', 'custom'], `${v.tag}: four filters`);
    assert.equal(f.menu.legend, true, `${v.tag}: legend inside the menu`);
    assert.ok(f.menu.note && f.menu.note.length > 0, `${v.tag}: the explanation sentence is inside the menu`);
    await page.click(`${topSel('all-menu')} [data-testid="all-sort"][data-key="py"]`);
    await page.waitForFunction(() => !document.querySelector('[data-testid="all-menu"]'));
    await waitNavIdle(page);
    f = await pageFacts(page);
    assert.equal(f.sort, 'py', `${v.tag}: the page follows the choice`);
    assert.equal(f.menu, null, `${v.tag}: the menu closed`);
    assert.deepEqual(f.inBody, [], `${v.tag}: the body still has no controls`);

    step(`${v.tag}: 选筛选 → 弹层关闭、按钮标 data-active；再进去取消`);
    await page.click(topSel('all-menu-open'));
    await page.waitForSelector(topSel('all-menu'));
    await waitNavIdle(page);
    await page.click(`${topSel('all-menu')} [data-testid="all-chip"][data-key="wrong"]`);
    await page.waitForFunction(() => !document.querySelector('[data-testid="all-menu"]'));
    await waitNavIdle(page);
    f = await pageFacts(page);
    assert.deepEqual([f.filter, f.btn.active], ['wrong', 'true'], `${v.tag}: filter on, button marked`);
    await page.click(topSel('all-menu-open'));
    await page.waitForSelector(topSel('all-menu'));
    await waitNavIdle(page);
    f = await pageFacts(page);
    assert.equal(f.menu.sorts.length, 0, `${v.tag}: R-A04 sort collapsed while a filter is on (also inside the menu)`);
    await page.click(`${topSel('all-menu')} [data-testid="all-chip"][data-key="wrong"]`);
    await page.waitForFunction(() => !document.querySelector('[data-testid="all-menu"]'));
    await waitNavIdle(page);
    f = await pageFacts(page);
    assert.deepEqual([f.filter, f.btn.active], ['', null], `${v.tag}: filter off`);

    step(`${v.tag}: 查字命中时按钮收起`);
    await page.fill(`${BODY} [data-testid="all-find"]`, '疆');
    await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="all-body"]').dataset.found === 'true');
    f = await pageFacts(page);
    assert.equal(f.btn, null, `${v.tag}: no menu button while a found char is shown`);
  }
  if (page !== page0) await page.close();
}
