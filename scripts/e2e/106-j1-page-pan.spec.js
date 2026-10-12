// R6-J1（交互与动效规范 N7 / §8b IC-22；产品负责人 2026-10-12：「『我的』页打开年度报告是可滑动的动态页面，像 web app……可以用手指移动整个页面」）：
// 每个页面都是「固定页头 + 一个竖向内容滚动容器」，整页不能被拖动、不能横移、根文档不滚：
//   1. 根文档：html / body 不滚（overflow hidden）、overscroll-behavior none、scrollWidth = 视口宽；scrollTo(40, 40) 之后仍在 (0, 0)；
//   2. 页面里每个 overflow-y auto / scroll 的元素都是 SCROLL_Y 写法：overflow-x hidden、overscroll-behavior-x none（图片预览翻页区除外），写 scrollLeft 也横不动；
//   3. 模拟触摸拖动（CDP touch：内容区横向、竖向、斜向，页头上起手）之后，页头 / 底栏 / Tab 栏的矩形不变、根文档滚动位置为 0。
// 页面目录与进入方式取 ic-lib.mjs 的 CATALOG（注册表里的每个页面，新页面自动入列）。

import { CATALOG, TOP, boot, enter, seedRich, waitIdle } from './ic-lib.mjs';

/* eslint-disable no-undef */
function frameFacts(top) {
  const layer = document.querySelector(top);
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
  };
  const de = document.documentElement;
  const cs = getComputedStyle(de);
  const bcs = getComputedStyle(document.body);
  const scrollers = [...layer.querySelectorAll('*')].filter(el => /(auto|scroll)/.test(getComputedStyle(el).overflowY) || /(auto|scroll)/.test(getComputedStyle(el).overflowX));
  const bad = scrollers.filter(el => !el.closest('.sz-img__scroll')).filter(el => {
    const s = getComputedStyle(el);
    return s.overflowX !== 'hidden' || s.overscrollBehaviorX !== 'none';
  }).map(el => `${el.className || el.tagName} (x ${getComputedStyle(el).overflowX}, osb-x ${getComputedStyle(el).overscrollBehaviorX})`);
  const body = layer.querySelector('.sz-page__body') || layer.querySelector('.sz-tabroot__panel');
  return {
    head: rect(layer.querySelector('.sz-page__head') || layer.querySelector('.sz-tabpage__title') || layer.querySelector('.sz-home__head')),
    foot: rect(layer.querySelector('.sz-page__foot')),
    tabs: rect(document.querySelector('[role="tablist"]')),
    layer: rect(layer),
    app: rect(document.querySelector('.sz-app')),
    docW: de.scrollWidth, docH: de.scrollHeight, vw: window.innerWidth, vh: window.innerHeight, sx: window.scrollX, sy: window.scrollY,
    root: [cs.overflowX, cs.overflowY, cs.overscrollBehaviorX, cs.overscrollBehaviorY, bcs.overflowX, bcs.overflowY, bcs.overscrollBehaviorY].join(' '),
    bad,
    bodyLeft: body ? body.scrollLeft : 0,
    scrollerCount: scrollers.length,
  };
}
/* eslint-enable no-undef */

async function drag(cdp, page, [x0, y0], [x1, y1], steps = 8) {
  const pt = (x, y) => ({ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(x0, y0)] });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps)] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export default async function j1PagePan(page, ctx) {
  const { assert, step, baseURL } = ctx;
  const W = ctx.viewport.width;
  const H = ctx.viewport.height;
  await boot(page, baseURL);
  const info = await seedRich(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  for (const entry of CATALOG) {
    step(`IC-22 ${entry.name}: the page is fixed — only its content scroller moves, and only vertically`);
    await enter(page, entry, info);
    const before = await page.evaluate(frameFacts, TOP);
    assert.equal(before.root, 'hidden hidden none none hidden hidden none', `${entry.name}: html / body do not scroll and do not rubber-band (${before.root})`);
    assert.ok(before.docW <= before.vw && before.docH <= before.vh && before.sx === 0 && before.sy === 0, `${entry.name}: the root document is exactly one screen (${before.docW}×${before.docH} in ${before.vw}×${before.vh}, at ${before.sx},${before.sy})`);
    assert.deepEqual(before.bad, [], `${entry.name}: every scroller is vertical-only (SCROLL_Y: overflow-x hidden, overscroll-behavior-x none)`);
    // 横向 / 斜向 / 竖向 / 页头上起手的拖动（不从左缘 20pt 起手：那是左缘右滑）
    await drag(cdp, page, [W - 40, Math.round(H * 0.55)], [60, Math.round(H * 0.55) + 6]);
    await drag(cdp, page, [80, Math.round(H * 0.7)], [W - 60, Math.round(H * 0.4)]);
    await drag(cdp, page, [Math.round(W / 2), Math.round(H * 0.3)], [Math.round(W / 2), Math.round(H * 0.75)]);
    await drag(cdp, page, [Math.round(W / 2), 22], [Math.round(W / 2) + 80, 300]);
    await page.evaluate(() => {
      window.scrollTo(40, 40);
      document.documentElement.scrollLeft = 40;
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const body = top.querySelector('.sz-page__body') || top.querySelector('.sz-tabroot__panel');
      if (body) body.scrollLeft = 40;
    });
    await page.waitForTimeout(120);
    await waitIdle(page, null, 60);
    const after = await page.evaluate(frameFacts, TOP);
    assert.equal(after.sx === 0 && after.sy === 0, true, `${entry.name}: the root document is still at 0,0 after the drags and scrollTo(40, 40) (${after.sx},${after.sy})`);
    assert.deepEqual([after.head, after.foot, after.tabs, after.layer, after.app], [before.head, before.foot, before.tabs, before.layer, before.app], `${entry.name}: page head, foot, tab bar and the page layer did not move`);
    assert.equal(after.bodyLeft, 0, `${entry.name}: the content scroller cannot be scrolled sideways`);
  }
}
