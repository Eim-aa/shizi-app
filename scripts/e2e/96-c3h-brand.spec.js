// C3-H ④（T3-09、V3-06 组件部分、D53 ⑦；P247）：品牌「拾」只有两种用途——墨「拾」（首次打开、交接、没有可显示本人墨的首页占位）与印「拾」（作品与关于页的印）。
//   关于页顶部 logo 是 App 图标图像（不是印）；印在题跋末句后（seal16）；字库空状态不再放双钩「拾」，是一个空格（不画字、不画线）；
//   字库空状态与关于页里，品牌墨「拾」（brand-shi-mark）一个都没有，关于页只有印那一个。
import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';
import { markFirstPracticeDone } from './home-helpers.mjs';

/* eslint-disable no-undef */
export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);

    step(`${scheme}: 关于页：顶部 logo 是 App 图标图像，印在题跋末句后`);
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('about', {}));
    await page.waitForSelector(topSel('about-logo'));
    await waitNavIdle(page);
    await page.waitForFunction(() => { const i = document.querySelector('.sz-layer[data-top="true"] [data-testid="about-logo"]'); return i && i.complete && i.naturalWidth > 0; });
    const a = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const q = id => top.querySelector(`[data-testid="${id}"]`);
      const logo = q('about-logo');
      const head = q('about-head');
      const seal = q('about-seal');
      const motto = q('about-motto');
      return {
        logoTag: logo.tagName,
        logoSrc: logo.getAttribute('src'),
        logoNatural: [logo.naturalWidth, logo.naturalHeight],
        logoBox: [logo.getBoundingClientRect().width, logo.getBoundingClientRect().height],
        logoHidden: logo.getAttribute('aria-hidden'),
        logoInHead: head.contains(logo) && head.firstElementChild === logo,
        sealInHead: head.contains(seal),
        sealInMotto: motto.contains(seal),
        sealBox: [seal.getBoundingClientRect().width, seal.getBoundingClientRect().height],
        sealAfterText: motto.lastElementChild === seal,
        brandMarks: top.querySelectorAll('[data-testid="brand-shi-mark"]').length,
      };
    });
    assert.equal(a.logoTag, 'IMG', 'the logo is an image');
    assert.equal(a.logoSrc, 'icon-192.png', 'it is the exported app icon (assets/branding → icon-192.png)');
    assert.deepEqual(a.logoNatural, [192, 192], 'the PNG loads at its native 192 × 192');
    assert.deepEqual(a.logoBox.map(Math.round), [64, 64], 'drawn at 64pt');
    assert.equal(a.logoHidden, 'true', 'decorative');
    assert.equal(a.logoInHead, true, 'the first thing in the head');
    assert.equal(a.sealInHead, false, 'the seal is no longer the logo');
    assert.deepEqual([a.sealInMotto, a.sealAfterText], [true, true], 'the seal follows the last line of the motto');
    assert.deepEqual(a.sealBox.map(Math.round), [16, 16], 'seal16');
    assert.equal(a.brandMarks, 0, 'no ink 拾 on the about page');
    await page.evaluate(() => history.back());
    await waitNavIdle(page);

    step(`${scheme}: 字库空状态：一个空格，没有字、没有双钩「拾」`);
    await page.evaluate(() => window.__shiziTest.reset());
    await markFirstPracticeDone(page);
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
    await page.waitForSelector(topSel('library-empty'));
    await waitNavIdle(page);
    const e = await page.evaluate(() => {
      const root = document.querySelector('.sz-layer[data-top="true"]');
      const empty = root.querySelector('[data-testid="library-empty"]');
      const cell = empty.querySelector('[data-testid="library-empty-cell"]');
      const cs = cell ? getComputedStyle(cell) : null;
      return {
        cell: !!cell,
        cellBox: cell ? [Math.round(cell.getBoundingClientRect().width), Math.round(cell.getBoundingClientRect().height)] : null,
        cellText: cell ? cell.textContent : null,
        cellChildren: cell ? cell.children.length : null,
        frame: cs ? cs.boxShadow !== 'none' : false,
        glyphs: empty.querySelectorAll('svg, canvas').length,
        hasShiChar: /拾/.test(empty.textContent),
        brandMarks: root.querySelectorAll('[data-testid="brand-shi-mark"]').length,
      };
    });
    assert.equal(e.cell, true, 'the empty state has the empty cell');
    assert.deepEqual(e.cellBox, [72, 72], 'a 72pt cell');
    assert.deepEqual([e.cellText, e.cellChildren], ['', 0], 'nothing drawn inside — an empty cell');
    assert.equal(e.frame, true, 'the cell has its frame');
    assert.equal(e.glyphs, 0, 'no glyph, no hollow 拾');
    assert.equal(e.hasShiChar, false, 'no 拾 anywhere in the empty state');
    assert.equal(e.brandMarks, 0, 'the brand ink 拾 is not used as the empty placeholder');
  }
  await page.emulateMedia({ colorScheme: 'light' });
}
