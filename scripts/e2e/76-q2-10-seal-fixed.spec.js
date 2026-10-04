// 阶段 1 Q2-10（复测 simC D7）：印章是图形，固定尺寸（seal16 / 24 / 40，设计系统 v1）——印框和里面的「字」都不随系统字号（--k）放大，
// AX3 / AX5 下「字」不再溢出红框。首次打开首页的题跋印、结果页作品落款印、我的页字帖落款印、关于页的印。
// 阶段 1 E9a（D49）：日常首页题记不再带印（首页没有朱色），首页上唯一的印是首次打开品牌时刻的那一枚（seal16）——旧断言量的「首页题记印」改在首次打开页量，
// 此时还没有任何记录（先量首页，再造记录去量别的页）。
import { bootTestHost, setTextSize, tid, topSel, waitNavIdle } from './helpers.mjs';
import { goHomeTab, openResultOf, seedEndedGroup } from './q2-helpers.mjs';

async function sealFacts(page, selector) {
  return page.evaluate(sel => {
    const root = document.querySelector('.sz-layer[data-top="true"]') || document;
    const box = root.querySelector(sel);
    if (!box) return null;
    const text = box.matches('.sz-home__seal') ? box.querySelector('span') : box;
    const cs = getComputedStyle(text);
    // 字形占的宽高（行盒）不超过印框：用一个 Range 量文字
    const range = document.createRange();
    range.selectNodeContents(text);
    const r = range.getBoundingClientRect();
    return { box: box.offsetWidth, font: parseFloat(cs.fontSize), glyphW: Math.round(r.width), glyphH: Math.round(r.height), h: box.offsetHeight };
  }, selector);
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  for (const category of ['L', 'AX3', 'AX5']) {
    await setTextSize(page, category);
    step(`系统字号 ${category}：首次打开首页的题跋印固定尺寸（日常首页没有印，D49）`);
    await goHomeTab(page);
    await page.waitForSelector(`${topSel('screen-home')} .sz-home__seal`);
    const f0 = await sealFacts(page, '[data-testid="screen-home"] .sz-home__seal');
    assert.deepEqual([f0.box, f0.font], [16, 11], `${category} first-open motto seal: box 16, glyph 11px`);
    assert.ok(f0.glyphW <= f0.box && f0.glyphH <= f0.box, `${category} first-open seal: glyph (${f0.glyphW}×${f0.glyphH}) inside the box`);
  }
  await setTextSize(page, 'L');
  await seedEndedGroup(page, { chars: [{ c: '静' }, { c: '永' }] });
  await goHomeTab(page);
  assert.equal(await page.locator(`${topSel('screen-home')} .sz-home__seal`).count(), 0, 'D49: the everyday home has no seal (no red on the home page)');

  for (const category of ['L', 'AX3', 'AX5']) {
    await setTextSize(page, category);
    step(`系统字号 ${category}：各处印章的印框与「字」固定尺寸`);

    await openResultOf(page);
    let f = await sealFacts(page, '.sz-seal');
    assert.deepEqual([f.box, f.font], [24, 17], `${category} result work seal: box 24, glyph 17px`);
    assert.ok(f.glyphW <= f.box && f.glyphH <= f.box, `${category} work seal: glyph inside the box`);

    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'mine');
    await waitNavIdle(page);
    f = await sealFacts(page, '[data-testid="mine-sheet-seal"]');
    assert.deepEqual([f.box, f.font], [24, 17], `${category} mine month-sheet seal: the same single work seal, box 24, glyph 17px (R2-R1)`);

    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('about', {}));
    await page.waitForSelector(topSel('about-seal'));
    await waitNavIdle(page);
    f = await sealFacts(page, '[data-testid="about-seal"]');
    assert.deepEqual([f.box, f.font], [40, 28], `${category} about seal: box 40, glyph 28px`);
    assert.ok(f.glyphW <= f.box && f.glyphH <= f.box, `${category} about seal: glyph inside the box`);
    await goHomeTab(page);
  }
  await setTextSize(page, 'L');
}
