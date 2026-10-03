// P0-D / D36（G05）：首页主按钮「拾」不随字号缩小——大字（P1-E6 / D29 起 = 系统字号 XXXL，模拟原生 shiziContentSize）与短屏紧凑版都保持约 196×190。
// 只量主按钮尺寸与它在首屏里的位置；首页其余内容的断言在 22-home.spec.js。
//
// 视口：393×852、375×667、360×640、320×568，各自系统字号 L / XXXL；同一视口换字号前后尺寸不变。

import { bootTestHost, LARGE_TEXT, setTextSize, tid, waitNavIdle } from './helpers.mjs';

const VIEWS = [
  { width: 393, height: 852 },
  { width: 375, height: 667 },
  { width: 360, height: 640 },
  { width: 320, height: 568 },
];
const CTA_W = 196;
const CTA_H = 190;

async function cta(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="home-start"]');
    const r = el.getBoundingClientRect();
    const panel = document.querySelector('.sz-tabroot__panel').getBoundingClientRect();
    const pick = document.querySelector('[data-testid="home-pick"]').getBoundingClientRect();
    return {
      w: r.width, h: r.height, left: r.left, right: r.right, vw: document.documentElement.clientWidth,
      startInPanel: r.top >= panel.top && r.bottom <= panel.bottom, pickInPanel: pick.top >= panel.top && pick.bottom <= panel.bottom,
      compact: document.querySelector('[data-testid="screen-home"]').dataset.compact,
      large: document.documentElement.hasAttribute('data-text-large'),
      glyph: parseFloat(getComputedStyle(el.querySelector('.sz-home__glyph')).fontSize),
    };
  });
}

export default async function homeCta(page, ctx) {
  const { assert, step } = ctx;
  for (const view of VIEWS) {
    await page.setViewportSize(view);
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);
    await page.waitForSelector(tid('home-start'));
    await waitNavIdle(page, { settleMs: 200 });
    const tag = `${view.width}×${view.height}`;
    step(`${tag}: 主按钮在标准字号与大字下都是 ${CTA_W}×${CTA_H}（D36 / G05），开关大字前后不变`);
    const sizes = [];
    for (const large of [false, true]) {
      await setTextSize(page, large ? LARGE_TEXT : 'L');
      await page.waitForTimeout(250);
      const c = await cta(page);
      assert.equal(c.large, large, `${tag}: data-text-large ${large ? 'on' : 'off'}`);
      assert.ok(Math.abs(c.w - CTA_W) < 1 && Math.abs(c.h - CTA_H) < 1,
        `${tag} ${large ? 'large' : 'normal'} (compact=${c.compact}): main button ${CTA_W}×${CTA_H}, got ${c.w.toFixed(1)}×${c.h.toFixed(1)}`);
      assert.equal(c.glyph, 64, `${tag} ${large ? 'large' : 'normal'}: 「拾」 glyph stays 64px`);
      assert.ok(c.left >= 0 && c.right <= c.vw, `${tag}: button inside the viewport width`);
      assert.ok(c.startInPanel, `${tag} ${large ? 'large' : 'normal'}: 主按钮整个在首屏内`);
      // 320×568 这类最矮的屏放不下「自己选字」（标准 196×190 的主按钮比旧紧凑版高 70），可滚动到；其余视口仍在首屏。
      if (view.height >= 640) assert.ok(c.pickInPanel, `${tag} ${large ? 'large' : 'normal'}: 「自己选字」仍在首屏内`);
      sizes.push([c.w, c.h]);
    }
    assert.deepEqual(sizes[0], sizes[1], `${tag}: same size before and after switching 更大字体`);
  }
  await setTextSize(page, 'L');
}
