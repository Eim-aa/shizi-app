// R2-S2（D51 ③）：印文改为白文「拾」（svg），断言改量 svg：铺满印框、墨框在内缩细线之内、光学居中、颜色 = --on-seal。
// 阶段 1 Q2-10（复测 simC D7）：印章是图形，固定尺寸（seal16 / 24 / 40，设计系统 v1）——印框和里面的字形都不随系统字号（--k）放大，
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
    const svg = box.querySelector('svg');
    const g = svg.querySelector('g');
    const b = box.getBoundingClientRect();
    const ink = g.getBoundingClientRect();
    // R2-S2：印文是白文「拾」的 svg（不是字体字）：svg 铺满印框，字的墨框在印框内缩 7% 的细线之内，光学居中（墨框中心与印心差 ≤ 6% 边长）
    return {
      box: box.offsetWidth, h: box.offsetHeight, svgW: Math.round(svg.getBoundingClientRect().width), paths: svg.querySelectorAll('path').length,
      text: box.textContent.trim(), color: getComputedStyle(box).color, fill: getComputedStyle(svg).fill,
      insetL: (ink.left - b.left) / b.width, insetR: (b.right - ink.right) / b.width, insetT: (ink.top - b.top) / b.height, insetB: (b.bottom - ink.bottom) / b.height,
      offX: ((ink.left + ink.right) / 2 - (b.left + b.right) / 2) / b.width, offY: ((ink.top + ink.bottom) / 2 - (b.top + b.bottom) / 2) / b.height,
    };
  }, selector);
}

function checkFace(assert, f, size, what) {
  assert.deepEqual([f.box, f.h, f.svgW, f.paths, f.text], [size, size, size, 9, ''], `${what}: box ${size}, svg fills it, nine strokes, no text`);
  assert.equal(f.fill, f.color, `${what}: the 拾 is drawn in the seal's ink colour (--on-seal)`);
  for (const k of ['insetL', 'insetR', 'insetT', 'insetB']) assert.ok(f[k] > 0.1, `${what}: ink clear of the inset line (${k} = ${f[k].toFixed(3)})`);
  assert.ok(Math.abs(f.offX) < 0.06 && Math.abs(f.offY) < 0.06, `${what}: optically centred (off ${f.offX.toFixed(3)}, ${f.offY.toFixed(3)})`);
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
    checkFace(assert, f0, 16, `${category} first-open motto seal`);
  }
  await setTextSize(page, 'L');
  await seedEndedGroup(page, { chars: [{ c: '静' }, { c: '永' }] });
  await goHomeTab(page);
  assert.equal(await page.locator(`${topSel('screen-home')} .sz-home__seal`).count(), 0, 'D49: the everyday home has no seal (no red on the home page)');

  for (const category of ['L', 'AX3', 'AX5']) {
    await setTextSize(page, category);
    step(`系统字号 ${category}：各处印章的印框与「拾」固定尺寸`);

    await openResultOf(page);
    let f = await sealFacts(page, '.sz-seal');
    checkFace(assert, f, 24, `${category} result work seal`);

    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'mine');
    await waitNavIdle(page);
    f = await sealFacts(page, '[data-testid="mine-sheet-seal"]');
    checkFace(assert, f, 24, `${category} mine month-sheet seal (the same single work seal, R2-R1)`);

    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('about', {}));
    await page.waitForSelector(topSel('about-seal'));
    await waitNavIdle(page);
    f = await sealFacts(page, '[data-testid="about-seal"]');
    checkFace(assert, f, 40, `${category} about seal`);
    await goHomeTab(page);
  }
  await setTextSize(page, 'L');
}
