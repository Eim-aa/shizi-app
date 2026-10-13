// R6-J1（交互与动效规范 T0-7 / §8b IC-24；产品负责人 2026-10-12：「点搜索框（查字）后，点其他区域弹窗会消失……但消失时有一个卡顿」）：
// 弹层退场 60fps、键盘与退场编排：
//   1. 每个弹层（查字、自己选字、全部字菜单、外观、写字方式、图片预览、清空确认）点遮罩关闭：退场期间 PerformanceObserver('longtask') 没有 > 50ms 的长任务，
//      rAF 帧间隔没有 > 50ms 的空档；
//   2. 查字弹层「键盘开着」（假的 visualViewport：可见区缩到 448，弹层被抬到键盘上沿）时关闭：余影落回屏底、上沿逐帧单调下移、最后一帧完全出屏（不停在半屏——
//      f0ce0a1 上余影带着 bottom = 键盘高播 translateY(100%)，停在 471 – 772 等计时到点才消失，模拟器逐帧见 .review/r6-J1）；输入框在余影出现的同一帧已失焦。

import { setTextSize } from './helpers.mjs';
import { CATALOG, PRESS_MS, TOP, boot, enter, seedRich, waitIdle } from './ic-lib.mjs';

const OVERLAYS = [
  { id: 'query (library)', page: 'library', open: '.sz-libq', sel: '[data-testid="query-sheet"]' },
  { id: 'pick (home)', page: 'home', open: '[data-testid="home-pick"]', sel: '[data-testid="query-sheet"]' },
  { id: 'all-menu', page: 'library-all', open: '[data-testid="all-menu-open"]', sel: '[data-testid="all-menu"]' },
  { id: 'appearance (AX5, D63)', page: 'mine', open: '[data-testid="mine-appearance"]', sel: '[data-testid="mine-appearance-sheet"]', ax: 'AX5' },
  { id: 'image-preview', page: 'month', open: '[data-testid="month-adjust"]', sel: '[data-testid="image-sheet"]' },
  { id: 'backup-clear (confirm)', page: 'backup', open: '[data-testid="backup-clear"]', sel: '[data-testid="backup-clear-sheet"]' },
];

/* eslint-disable no-undef */
function armExitWatch() {
  window.__exitWatch = { long: [], frames: [], tops: [], blurredAtClone: null, done: false };
  const w = window.__exitWatch;
  try {
    w.po = new PerformanceObserver(list => { for (const e of list.getEntries()) w.long.push(Math.round(e.duration)); });
    w.po.observe({ type: 'longtask', buffered: false });
  } catch (error) {
    w.noLongtask = true;
  }
  let seen = false;
  let last = null;
  const mo = new MutationObserver(list => {
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList.contains('sz-exit') && w.blurredAtClone === null) {
          const a = document.activeElement;
          w.blurredAtClone = !(a && a.tagName === 'INPUT');
        }
      }
    }
  });
  mo.observe(document.querySelector('.sz-app'), { childList: true, subtree: true });
  const tick = t => {
    const exits = [...document.querySelectorAll('.sz-exit')];
    if (exits.length) {
      seen = true;
      if (last !== null) w.frames.push(Math.round(t - last));
      const panel = exits[0].querySelector('.sz-sheet, .sz-confirm');
      if (panel) w.tops.push(Math.round(panel.getBoundingClientRect().top));
    }
    last = t;
    if (seen && !exits.length) {
      w.done = true;
      mo.disconnect();
      if (w.po) w.po.disconnect();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function installFakeViewport() {
  class FakeVV extends EventTarget {}
  const vv = new FakeVV();
  vv.height = window.innerHeight;
  vv.width = window.innerWidth;
  vv.offsetTop = 0;
  vv.offsetLeft = 0;
  vv.scale = 1;
  window.__fakeVV = vv;
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
}
/* eslint-enable no-undef */

async function openAndClose(page, ctx, o, info, { keyboard = false } = {}) {
  const { assert } = ctx;
  await setTextSize(page, o.ax || 'L');
  await enter(page, CATALOG.find(e => e.name === o.page), info);
  await page.waitForTimeout(PRESS_MS);
  await page.locator(`${TOP} ${o.open}`).first().click();
  await page.waitForSelector(`${TOP} .sz-overlay:not(.sz-exit) ${o.sel}`, { timeout: 15000 });
  await page.waitForTimeout(PRESS_MS);
  let raised = 0;
  if (keyboard) {
    await page.evaluate(() => {
      window.__fakeVV.height = 448;
      window.__fakeVV.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => { const s = document.querySelector('.sz-sheet'); return !!s && s.dataset.keyboard === 'true'; });
    await page.waitForTimeout(120);
    raised = await page.evaluate(() => parseFloat(document.querySelector('.sz-sheet').style.bottom) || 0);
    assert.ok(raised > 300, `${o.id} + keyboard: the sheet sits on the keyboard (bottom ${raised})`);
  }
  await page.evaluate(armExitWatch);
  await page.mouse.click(8, 60); // 遮罩
  if (keyboard) {
    // 系统键盘随失焦收起：可见区回到整屏（与真机同序：先失焦，再 visualViewport resize）
    await page.evaluate(() => {
      window.__fakeVV.height = window.innerHeight;
      window.__fakeVV.dispatchEvent(new Event('resize'));
    });
  }
  await page.waitForFunction(() => window.__exitWatch && window.__exitWatch.done, null, { timeout: 5000 });
  await waitIdle(page, null, 60);
  const w = await page.evaluate(() => ({ ...window.__exitWatch, po: undefined }));
  assert.equal(await page.evaluate(([t, s]) => !!document.querySelector(`${t} .sz-overlay:not(.sz-exit) ${s}`), [TOP, o.sel]), false, `${o.id}: closed by the scrim`);
  if (!w.noLongtask) assert.deepEqual(w.long.filter(d => d > 50), [], `IC-24 ${o.id}${keyboard ? ' + keyboard' : ''}: no long task (> 50ms) during the exit (${w.long.join(', ') || 'none'})`);
  const gaps = w.frames.filter(d => d > 50);
  assert.deepEqual(gaps, [], `IC-24 ${o.id}${keyboard ? ' + keyboard' : ''}: no rAF gap > 50ms during the exit (${w.frames.length} frames, max ${Math.max(0, ...w.frames)}ms)`);
  return { w, raised };
}

export default async function j1SheetExit(page, ctx) {
  const { assert, step, baseURL } = ctx;
  await boot(page, baseURL);
  const info = await seedRich(page);

  for (const o of OVERLAYS) {
    step(`IC-24 ${o.id}: the exit runs at frame rate (no long task, no frame gap)`);
    await openAndClose(page, ctx, o, info);
  }

  step('IC-24 / T0-7 query sheet with the keyboard up: blur first, then one continuous slide off the screen (no stop half way)');
  await page.evaluate(installFakeViewport);
  const H = ctx.viewport.height;
  for (const o of OVERLAYS.slice(0, 2)) {
    const { w, raised } = await openAndClose(page, ctx, o, info, { keyboard: true });
    assert.equal(w.blurredAtClone, true, `${o.id}: the input lost focus before the exit copy appeared (keyboard and exit start together)`);
    const tops = w.tops;
    assert.ok(tops.length >= 4, `${o.id}: the exit copy was sampled on ${tops.length} frames`);
    assert.ok(tops[0] <= H - raised - 1 + 2 && tops[0] < H * 0.6, `${o.id}: the slide starts where the sheet was seen (top ${tops[0]}, raised ${raised})`);
    assert.ok(tops.every((v, i) => i === 0 || v >= tops[i - 1] - 0.5), `${o.id}: the top moves down monotonically (${tops.join(' ')})`);
    assert.ok(tops[tops.length - 1] >= H - 2, `${o.id}: the last frame is off the screen, not parked half way (${tops[tops.length - 1]} vs ${H})`);
  }
}
