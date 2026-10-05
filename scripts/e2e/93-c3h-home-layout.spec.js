// C3-H ①（T3-01、D53 ③）：首页字帖行满版心、主按钮回到统一底线。
//   字帖行格边长 = min(版心宽 / n, 160)，n ≤ 5 一行（撑满 20pt 页边之间的版心，取整后最多差 n px；1–2 字封顶 160），左缘与标题同在 20 的线上；
//   主按钮底边固定在 Tab 栏上沿上方 24（五态 + 首次打开 + 品牌占位同一个 y，次按钮 / 首次说明在它上面）；
//   标题贴近字帖（20）；标题 + 字帖这一组在页头与主按钮区之间光学居中（42 : 58）；AX5 字帖格不小于 44、主按钮满宽。
//   390×844、375×667、430×932，浅色；深色抽 390。
import { bootTestHost, waitNavIdle } from './helpers.mjs';
import { markFirstPracticeDone, seedHomeState } from './home-helpers.mjs';

/* eslint-disable no-undef */
async function facts(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]');
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; };
    const panel = document.querySelector('.sz-tabroot__panel').getBoundingClientRect();
    const tie = root.querySelector('.sz-htie') || root.querySelector('.sz-hshi');
    const cell = root.querySelector('.sz-hcell') || root.querySelector('.sz-hshi');
    return {
      view: root.dataset.view,
      width: root.clientWidth,
      n: root.querySelectorAll('.sz-hcell').length || (root.querySelector('.sz-hshi') ? 1 : 0),
      tie: rect(tie),
      cell: rect(cell),
      title: rect(q('home-title')),
      cta: rect(q('home-start')),
      panelBottom: panel.bottom,
      zone: rect(root.querySelector('.sz-home__zone')),
      head: rect(root.querySelector('.sz-home__head')),
      foot: rect(root.querySelector('.sz-home__foot')),
    };
  });
}

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

export default async function run(page0, ctx) {
  const { assert, step } = ctx;
  let page = page0;
  const runs = [
    { tag: '390×844 light', width: 390, height: 844, scheme: 'light' },
    { tag: '390×844 dark', width: 390, height: 844, scheme: 'dark' },
    { tag: '375×667 light', width: 375, height: 667, scheme: 'light' },
    { tag: '430×932 light', width: 430, height: 932, scheme: 'light' },
  ];
  for (const [i, v] of runs.entries()) {
    if (i > 0) { await page.close(); page = await page0.context().newPage(); }
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.emulateMedia({ colorScheme: v.scheme });
    await bootTestHost(page, ctx.baseURL);
    const b = v.width - 40;
    const ctaBottoms = [];
    step(`${v.tag}: 五态字帖行满版心（格 = min(版心 / n, 160)），左缘在 20，标题贴字帖，主按钮在同一条底线`);
    for (const name of ['fresh', 'today', 'progress', 'special', 'back']) {
      await seedHomeState(page, name);
      const f = await facts(page);
      const t = `${v.tag} ${name}`;
      const want = Math.min(160, Math.floor(b / Math.min(f.n, f.n <= 5 ? f.n : 4)));
      assert.equal(Math.round(f.cell.w), want, `${t}: cell = min(${b} / ${f.n}, 160) = ${want} (${f.cell.w})`);
      assert.ok(near(f.tie.left, 20, 0.6), `${t}: the copybook's left edge is on the 20 line (${f.tie.left})`);
      if (f.n >= 3) assert.ok(near(f.tie.w, b, f.n + 0.5), `${t}: the row fills the content width ${b} (${f.tie.w})`);
      assert.ok(near(f.zone.top - f.title.bottom, 20, 1), `${t}: the title sits 20 above the copybook (${f.zone.top - f.title.bottom})`);
      assert.ok(near(f.panelBottom - f.cta.bottom, 24, 0.6), `${t}: the main button's bottom is 24 above the tab bar (${f.panelBottom - f.cta.bottom})`);
      ctaBottoms.push(f.cta.bottom);
    }
    step(`${v.tag}: 首次打开 / 品牌占位也在同一条底线上`);
    await seedHomeState(page, 'first');
    let f = await facts(page);
    ctaBottoms.push(f.cta.bottom);
    assert.ok(near(f.panelBottom - f.cta.bottom, 24, 0.6), `${v.tag} first: the main button's bottom is 24 above the tab bar`);
    await page.evaluate(() => window.__shiziTest.reset());
    await markFirstPracticeDone(page);
    await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="screen-home"]').dataset.view === 'fresh');
    await waitNavIdle(page);
    f = await facts(page);
    ctaBottoms.push(f.cta.bottom);
    assert.equal(Math.round(f.cell.w), Math.min(160, b), `${v.tag} brand placeholder: the single 拾 cell = min(content, 160) (${f.cell.w})`);
    assert.ok(near(f.panelBottom - f.cta.bottom, 24, 0.6), `${v.tag} brand placeholder: the main button's bottom is 24 above the tab bar`);
    assert.ok(ctaBottoms.every(y => near(y, ctaBottoms[0], 0.6)), `${v.tag}: the main button's y is the same in all seven states (${ctaBottoms.map(Math.round).join(' / ')})`);
  }
  await page.close();
}
