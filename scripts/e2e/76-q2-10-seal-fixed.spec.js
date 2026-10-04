// 阶段 1 Q2-10（复测 simC D7）：印章是图形，固定尺寸（seal16 / 24 / 40，设计系统 v1）——印框和里面的「字」都不随系统字号（--k）放大，
// AX3 / AX5 下「字」不再溢出红框。首页题记的印、结果页作品落款印、我的页字帖落款印、关于页的印。
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
  await seedEndedGroup(page, { chars: [{ c: '静' }, { c: '永' }] });

  for (const category of ['L', 'AX3', 'AX5']) {
    await setTextSize(page, category);
    step(`系统字号 ${category}：各处印章的印框与「字」固定尺寸`);

    await goHomeTab(page);
    await page.waitForSelector(`${topSel('screen-home')} .sz-home__seal`);
    let f = await sealFacts(page, '[data-testid="screen-home"] .sz-home__seal');
    assert.deepEqual([f.box, f.font], [16, 11], `${category} home epigraph seal: box 16, glyph 11px`);
    assert.ok(f.glyphW <= f.box && f.glyphH <= f.box, `${category} home seal: glyph (${f.glyphW}×${f.glyphH}) inside the box`);

    await openResultOf(page);
    f = await sealFacts(page, '.sz-wseal');
    assert.deepEqual([f.box, f.font], [24, 17], `${category} result work seal: box 24, glyph 17px`);
    assert.ok(f.glyphW <= f.box && f.glyphH <= f.box, `${category} work seal: glyph inside the box`);

    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'mine');
    await waitNavIdle(page);
    f = await sealFacts(page, '[data-testid="mine-sheet-seal"]');
    assert.deepEqual([f.box, f.font], [16, 11], `${category} mine month-sheet seal (small): box 16, glyph 11px`);

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
