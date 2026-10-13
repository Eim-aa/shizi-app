// 第三轮 C3-R（D53 ⑤；T2-14 / T2-20 / T2-21 / V3-08）：规格残留。
//   · 设置、我的的分组标题：黑体 13、ink3，不画线（标题下没有发丝线，不比页面标题大）；
//   · 图标线宽：走过的各页里所有图标 svg 的 stroke-width 只有 1.5（统一 icons.js）；
//   · 全部页面里没有下划线的文字；
//   · 词语里的目标格线宽 1pt（与格框同）。
// 浅 / 深各一遍，393×852 与 375×667。

import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

async function go(page, fn, arg) {
  await page.evaluate(fn, arg);
  await waitNavIdle(page);
  await page.waitForTimeout(150);
}

const probe = page => page.evaluate(() => {
  const top = document.querySelector('.sz-layer[data-top="true"]') || document.body;
  const rgb = v => { const e = document.createElement('i'); e.style.color = v; top.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; };
  const ink3 = rgb('var(--ink3)');
  const strokes = [...top.querySelectorAll('svg')].filter(s => !s.closest('.sz-pg') && !s.closest('.sz-inkgrid')).flatMap(s => {
    const own = [s, ...s.querySelectorAll('[stroke-width]')].filter(e => e.hasAttribute('stroke-width'));
    return own.map(e => e.getAttribute('stroke-width'));
  });
  const underlined = [...top.querySelectorAll('*')].filter(e => /underline/.test(getComputedStyle(e).textDecorationLine)).map(e => e.className || e.tagName);
  const titles = sel => [...top.querySelectorAll(sel)].map(e => {
    const cs = getComputedStyle(e);
    const list = e.nextElementSibling;
    return { text: e.textContent.trim(), size: cs.fontSize, family: cs.fontFamily, color: cs.color, weight: cs.fontWeight, nextTop: list ? getComputedStyle(list).borderTopWidth : null };
  });
  const tile = top.querySelector('.sz-dcard__tile[data-blank="true"]');
  return {
    ink3, strokes, underlined,
    settings: titles('[data-testid="settings-group-title"]'),
    mine: titles('[data-testid="mine-week-title"]'),
    pageTitle: (() => { const h = top.querySelector('.sz-page__title'); return h ? getComputedStyle(h).fontSize : null; })(),
    tileShadow: tile ? getComputedStyle(tile).boxShadow : null,
  };
});

export default async function c3rSpecs(page0, ctx) {
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
    await page.emulateMedia({ colorScheme: v.scheme, reducedMotion: 'reduce' });
    await bootTestHost(page, ctx.baseURL);
    await seedHomeSpec(page, { entries: [
      { char: '疆', at: '2026-08-04T20:00:00' }, { char: '疆', at: '2026-09-14T20:00:00' }, { char: '疆', at: '2026-10-04T20:00:00', judgment: 'wrong' },
      { char: '酱', at: '2026-10-03T20:00:00' }, { char: '永', at: '2026-10-04T20:30:00' },
    ], clock: '2026-10-05T19:30:00' });

    step(`${v.tag}: 「我的」（D63 起没有分组小标题）：图标线宽 1.5，没有下划线`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
    await page.waitForSelector(topSel('mine-overview'));
    let f = await probe(page);
    assert.equal(f.mine.length, 0, `${v.tag}: no small group headings on 我的`);
    assert.deepEqual(f.strokes.filter(s => s !== '1.5'), [], `${v.tag}: mine icons are 1.5`);
    assert.deepEqual(f.underlined, [], `${v.tag}: nothing underlined on mine`);

    step(`${v.tag}: 字库 / 详情 / 年报 / 月字帖的图标线宽 1.5，没有下划线；词语里的目标格线宽 1pt`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
    f = await probe(page);
    assert.deepEqual(f.strokes.filter(s => s !== '1.5'), [], `${v.tag}: library icons are 1.5 (${f.strokes.join(',')})`);
    assert.deepEqual(f.underlined, [], `${v.tag}: library has no underline`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.push('detail', { char: '疆' }));
    await page.waitForSelector(topSel('detail-screen'));
    f = await probe(page);
    assert.deepEqual(f.strokes.filter(s => s !== '1.5'), [], `${v.tag}: detail icons are 1.5`);
    assert.deepEqual(f.underlined, [], `${v.tag}: detail has no underline`);
    assert.ok(f.tileShadow && /0px 0px 0px 1px/.test(f.tileShadow), `${v.tag}: the target cell of the word is framed with 1pt (${f.tileShadow})`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.back());
    await go(page, async () => (await import('/src/ui/router.js')).nav.push('month', { month: '2026-10' }));
    f = await probe(page);
    assert.deepEqual(f.strokes.filter(s => s !== '1.5'), [], `${v.tag}: month page icons are 1.5`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.back());
    await go(page, async () => (await import('/src/ui/router.js')).nav.push('annual', {}));
    f = await probe(page);
    assert.deepEqual(f.strokes.filter(s => s !== '1.5'), [], `${v.tag}: annual icons are 1.5`);
    assert.deepEqual(f.underlined, [], `${v.tag}: annual has no underline`);
    await go(page, async () => (await import('/src/ui/router.js')).nav.back());
  }
  if (page !== page0) await page.close();
}
