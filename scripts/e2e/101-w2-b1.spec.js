// W2（D57，P282–P284）：写字页进出动效 B1「按钮长成这张纸」+ B3 安静淡入兜底 + 减少动态效果 150ms 淡化（设计稿「写字页与我的.html」B 节）。
// 用 requestAnimationFrame 逐帧采样（写字页那一层 .sz-layer[data-paper] 的矩形与进度 data-paper-s），断言：
//   1. 点首页「开始写字」：进场第一帧纸是按钮的矩形（含墨色盖片和按钮的字），之后宽高 / 位置单调插值到整页，约 420ms，结束后图层回到普通状态（无内联样式）；
//   2. 点「‹」返回：同一条路径倒放（约 360ms），纸收回到首页按钮的矩形，盖片上是按钮的字；
//   3. 左缘右滑（真实触摸序列）：拖到 p ≈ 0.5 时纸处于中间态（s ≈ 0.5、宽高在按钮与整屏之间、向右偏）；松手回弹（s 回到 1、页面还在）；再拖过阈值松手 → 从当前位置收回按钮、回到首页；
//   4. 没有来源按钮的入口（测试入口 write-test-entry）：B3，写字页透明度 0 → 1、从 0.96 放大，约 220ms，没有矩形插值；
//   5. 减少动态效果：一律 150ms 淡化（只有透明度），不缩放、不位移；
//   6. 其他页面（设置）的 push 转场保持横推。
// 测试浏览器没有安全区；rAF 采样的时长允许 ± 一定误差（无头浏览器 60fps）。

import { bootTestHost, tid, topSel, waitNavIdle } from './helpers.mjs';

const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** 首练已完成：昨天一条判断，首页主按钮是「开始写字」。 */
async function seedFirstPracticeDone(page) {
  const r = await page.evaluate(() => {
    window.__shiziTest.reset();
    const now = window.__shiziTest.now();
    const at = now - 24 * 3600 * 1000;
    const d = new Date(at);
    const pad = n => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const rec = { id: 'r1', cardKey: 'base:永', char: '永', sessionId: 's1', kind: 'judged', judgment: 'correct', at, localDay: day, help: { hints: 0, answerSeen: false, traced: false } };
    return window.__shiziTest.seed({ records: { [day.slice(0, 7)]: [rec] } });
  });
  if (!r || !r.ok) throw new Error('seed failed');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

/* eslint-disable no-undef */
function startSampler() {
  window.__paperSamples = [];
  window.__paperSampling = true;
  const tick = () => {
    const l = document.querySelector('.sz-layer[data-paper]');
    const t = performance.now();
    if (l) {
      const r = l.getBoundingClientRect();
      const ink = l.querySelector('.sz-paper-ink');
      window.__paperSamples.push({
        t, mode: l.dataset.paper, s: parseFloat(l.dataset.paperS), x: r.left, y: r.top, w: r.width, h: r.height,
        op: l.style.opacity === '' ? 1 : parseFloat(l.style.opacity), transform: l.style.transform, radius: parseFloat(l.style.borderRadius) || 0,
        ink: ink ? parseFloat(ink.style.opacity) : null, label: ink ? ink.textContent : null, screen: l.dataset.screen,
      });
    }
    if (window.__paperSampling) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function stopSampler() {
  window.__paperSampling = false;
  return window.__paperSamples;
}
function layerState() {
  const app = document.querySelector('.sz-app');
  const layers = [...app.querySelectorAll(':scope > .sz-layer')];
  return {
    top: app.dataset.topScreen, navAnim: app.dataset.navAnim, depth: history.state.depth,
    papers: layers.filter(l => l.hasAttribute('data-paper')).length,
    dirty: layers.filter(l => l.style.left || l.style.width || l.style.borderRadius || l.style.opacity || l.style.transform).length,
    inks: app.querySelectorAll('.sz-paper-ink').length,
  };
}
function ctaRect() {
  const b = document.querySelector('[data-testid="home-start"]');
  const r = b.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, label: b.textContent.trim(), hidden: b.style.visibility === 'hidden' ? 'hidden' : 'visible' };
}
/* eslint-enable no-undef */

const span = a => (a.length ? a[a.length - 1].t - a[0].t : 0);
const monotone = (a, key, dir) => a.every((v, i) => i === 0 || (dir > 0 ? v[key] >= a[i - 1][key] - 0.6 : v[key] <= a[i - 1][key] + 0.6));

async function swipe(cdp, page, { x0 = 4, x1, y, steps = 12, dt = 40, hold = null, back = null }) {
  const pt = (x, yy) => ({ x, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(x0, y)] });
  for (let i = 1; i <= steps; i += 1) {
    await page.waitForTimeout(dt);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(x0 + ((x1 - x0) * i) / steps, y)] });
  }
  let held = null;
  if (hold) {
    await page.waitForTimeout(120);
    held = await hold(page);
  }
  if (back !== null) {
    for (let i = 1; i <= steps; i += 1) {
      await page.waitForTimeout(dt);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(x1 + ((back - x1) * i) / steps, y)] });
    }
  }
  await page.waitForTimeout(dt);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return held;
}

export default async function w2B1(page, ctx) {
  const { assert, step } = ctx;
  const W = ctx.viewport.width;
  const H = ctx.viewport.height;

  step('boot, first practice done → the home button reads 「开始写字」');
  await bootTestHost(page, ctx.baseURL);
  await seedFirstPracticeDone(page);
  await page.waitForSelector(tid('home-start'));
  await waitNavIdle(page, { settleMs: 200 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // ------------------------------------------------------------ 1. 进场
  step('B1 open: the button grows into the whole paper (rAF samples: rect interpolates from the button to the full page, ~420ms)');
  const R = await page.evaluate(ctaRect);
  await page.evaluate(startSampler);
  await page.click(tid('home-start'));
  await page.waitForSelector(topSel('write-done'));
  await waitNavIdle(page);
  const open = (await page.evaluate(stopSampler)).filter(s => s.mode === 'B1' && s.screen === 'write');
  assert.ok(open.length >= 6, `B1 open sampled on ${open.length} frames (≥ 6)`);
  const f0 = open[0];
  assert.ok(f0.s < 0.25, `first frame is the start of the path (s ${f0.s})`);
  const startRect = open.reduce((best, f) => (f.s < best.s ? f : best), open[0]);
  assert.ok(near(startRect.x, R.x, 0.15 * R.w + 12) && near(startRect.y, R.y, 0.2 * R.h + 40) && startRect.w < W * 0.8,
    `the earliest frame sits on the button (button ${R.x.toFixed(0)},${R.y.toFixed(0)} ${R.w.toFixed(0)}×${R.h.toFixed(0)}; frame ${startRect.x.toFixed(0)},${startRect.y.toFixed(0)} ${startRect.w.toFixed(0)}×${startRect.h.toFixed(0)})`);
  assert.ok(open.some(f => f.ink !== null && f.ink > 0.5 && f.label === R.label), 'the ink cover carries the button label while the paper is small');
  assert.ok(monotone(open, 'w', 1) && monotone(open, 'h', 1) && monotone(open, 'x', -1) && monotone(open, 'y', -1), 'width / height grow and x / y shrink monotonically');
  const mid = open.filter(f => f.s > 0.15 && f.s < 0.85).sort((p, q) => Math.abs(p.s - 0.5) - Math.abs(q.s - 0.5))[0]; // 负载高时帧稀：取最接近一半的那一帧
  assert.ok(mid && mid.w > R.w + 20 && mid.w < W - 20 && mid.h > R.h + 20 && mid.h < H - 20, `a mid-way frame is strictly between the button and the page (${mid && `${mid.w.toFixed(0)}×${mid.h.toFixed(0)}`})`);
  assert.ok(mid && mid.radius > 0, `rounded corners while it grows (r ${mid && mid.radius.toFixed(1)})`);
  assert.ok(span(open) >= 300 && span(open) <= 700, `open lasts about 420ms (${span(open).toFixed(0)}ms sampled)`);
  const end = await page.evaluate(layerState);
  assert.deepEqual([end.top, end.papers, end.dirty, end.inks, end.navAnim], ['write', 0, 0, 0, 'idle'], 'after the open the layer is a plain layer again (no inline styles, no cover)');
  assert.equal((await page.evaluate(ctaRect)).hidden, 'visible', 'the home button has no leftover visibility:hidden under the page');

  // ------------------------------------------------------------ 2. 点「‹」退出
  step('B1 close (tap 「‹」): the same path backwards (~360ms), the paper shrinks onto the button');
  await page.evaluate(startSampler);
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  const close = (await page.evaluate(stopSampler)).filter(s => s.mode === 'B1');
  assert.ok(close.length >= 5, `B1 close sampled on ${close.length} frames`);
  assert.ok(monotone(close, 'w', -1) && monotone(close, 'h', -1), 'width / height shrink monotonically');
  const R2 = await page.evaluate(ctaRect);
  const last = close[close.length - 1];
  assert.ok(last.s < 0.2 && near(last.x, R2.x, 0.15 * R2.w + 12) && near(last.y, R2.y, 0.2 * R2.h + 40) && last.w < W * 0.8, `the last frame sits on the button (${last.x.toFixed(0)},${last.y.toFixed(0)} ${last.w.toFixed(0)}×${last.h.toFixed(0)} vs ${R2.x.toFixed(0)},${R2.y.toFixed(0)} ${R2.w.toFixed(0)}×${R2.h.toFixed(0)})`);
  assert.ok(span(close) >= 250 && span(close) <= 600, `close lasts about 360ms (${span(close).toFixed(0)}ms sampled)`);
  assert.equal(R2.hidden, 'visible', 'the home button is back');
  const afterClose = await page.evaluate(layerState);
  assert.deepEqual([afterClose.top, afterClose.papers, afterClose.dirty, afterClose.inks, afterClose.depth], ['home', 0, 0, 0, 0], 'home is clean after the close');

  // ------------------------------------------------------------ 3. 左缘右滑：进度联动
  step('edge swipe: at p ≈ 0.5 the paper is half way back (s ≈ 0.5, between the button and the page), then it springs back on release');
  await page.click(tid('home-start'));
  await page.waitForSelector(topSel('write-done'));
  await waitNavIdle(page);
  const held = await swipe(cdp, page, {
    x1: Math.round(W * 0.5), y: Math.round(H * 0.6), back: 6,
    hold: async pg => {
      const h = await pg.evaluate(() => {
        const l = document.querySelector('.sz-layer[data-paper]');
        if (!l) return null;
        const r = l.getBoundingClientRect();
        return { s: parseFloat(l.dataset.paperS), x: r.left, y: r.top, w: r.width, h: r.height, anim: document.querySelector('.sz-app').dataset.navAnim, mode: l.dataset.paper };
      });
      return h;
    },
  });
  assert.ok(held && held.mode === 'B1' && held.anim === 'drag', `dragging: the layer is a B1 paper (${held && held.mode} / ${held && held.anim})`);
  assert.ok(near(held.s, 0.5, 0.06), `progress p 0.5 → s ${held.s} ≈ 0.5`);
  assert.ok(held.w < W - 30 && held.w > 80 && held.h < H - 30 && held.h > 60, `the paper is half way (${held.w.toFixed(0)}×${held.h.toFixed(0)})`);
  assert.ok(held.x > 5 || held.y > 5, 'it moved off the top-left corner towards the button');
  await page.waitForTimeout(500);
  await waitNavIdle(page);
  const sprung = await page.evaluate(layerState);
  assert.deepEqual([sprung.top, sprung.papers, sprung.dirty, sprung.inks, sprung.depth], ['write', 0, 0, 0, 1], 'cancelled: the write page is whole again, nothing left over');

  step('edge swipe past the threshold: the paper finishes the way into the button (not a slide), home is clean');
  await page.evaluate(startSampler);
  await swipe(cdp, page, { x1: Math.round(W * 0.6), y: Math.round(H * 0.6) });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home', null, { timeout: 5000 });
  await waitNavIdle(page);
  const fin = (await page.evaluate(stopSampler)).filter(s => s.mode === 'B1');
  assert.ok(fin.length >= 3, `the drag + finish produced B1 frames (${fin.length})`);
  assert.ok(fin.some(f => f.s > 0.1 && f.s < 0.9), 'there are in-between frames');
  const R3 = await page.evaluate(ctaRect);
  const lastFin = fin[fin.length - 1];
  assert.ok(lastFin.s < 0.3 && lastFin.w < W * 0.8, `finished near the button (last s ${lastFin.s}, ${lastFin.w.toFixed(0)} wide, button ${R3.w.toFixed(0)})`);
  const clean = await page.evaluate(layerState);
  assert.deepEqual([clean.top, clean.papers, clean.dirty, clean.inks, clean.depth], ['home', 0, 0, 0, 0], 'home is clean after the gesture');

  // ------------------------------------------------------------ 4. 没有来源按钮：B3
  step('no source button (test entry): B3 quiet fade-in — opacity 0 → 1, scale .96 → 1, ~220ms, no rectangle interpolation');
  await page.evaluate(startSampler);
  await page.click(tid('write-test-entry'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  const quiet = (await page.evaluate(stopSampler)).filter(s => s.mode === 'B3');
  assert.ok(quiet.length >= 3, `B3 sampled on ${quiet.length} frames`);
  assert.ok(quiet.every(f => near(f.w, W, 1.5) && near(f.h, H, 1.5) || /scale/.test(f.transform)), 'the layer keeps the page size (a scale transform, not a growing rectangle)');
  assert.ok(monotone(quiet, 'op', 1) && quiet[0].op < 0.6, `opacity ramps up from ~0 (${quiet[0].op})`);
  assert.ok(quiet.some(f => { const m = /scale\(([\d.]+)\)/.exec(f.transform); return m && Number(m[1]) < 0.995 && Number(m[1]) >= 0.96 - 1e-6; }), 'scales up from 0.96');
  assert.ok(span(quiet) >= 120 && span(quiet) <= 450, `B3 open lasts about 220ms (${span(quiet).toFixed(0)}ms sampled)`);
  await page.evaluate(startSampler);
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  const quietBack = (await page.evaluate(stopSampler)).filter(s => s.mode === 'B3');
  assert.ok(quietBack.length >= 2 && monotone(quietBack, 'op', -1), 'B3 close fades back out');
  assert.ok(span(quietBack) <= 400, `B3 close lasts about 180ms (${span(quietBack).toFixed(0)}ms)`);
  assert.equal((await page.evaluate(layerState)).dirty, 0, 'clean after B3');

  // ------------------------------------------------------------ 5. 减少动态效果
  step('reduced motion: a 150ms cross-fade only — no rectangle, no scale');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(startSampler);
  await page.click(tid('home-start'));
  await page.waitForSelector(topSel('write-done'));
  await waitNavIdle(page);
  const rm = (await page.evaluate(stopSampler)).filter(s => s.mode === 'R');
  assert.ok(rm.length >= 2, `reduced-motion open sampled (${rm.length} frames)`);
  assert.ok(rm.every(f => near(f.w, W, 1.5) && near(f.h, H, 1.5) && f.transform === '' && f.radius === 0), 'full-size layer, no transform, no radius: only the opacity changes');
  assert.ok(monotone(rm, 'op', 1), 'opacity ramps up');
  assert.ok(span(rm) <= 350, `reduced-motion open takes ~150ms (${span(rm).toFixed(0)}ms)`);
  await page.evaluate(startSampler);
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  const rmBack = (await page.evaluate(stopSampler)).filter(s => s.mode === 'R');
  assert.ok(rmBack.length >= 1 && rmBack.every(f => f.transform === ''), 'reduced-motion close is also a fade');
  assert.equal((await page.evaluate(layerState)).dirty, 0, 'clean after the reduced-motion fade');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ------------------------------------------------------------ 6. 其他页面不变
  step('other pages keep the slide: pushing settings is not a paper');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('settings', {});
  });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'settings');
  const slideSeen = await page.evaluate(() => document.querySelectorAll('.sz-layer[data-paper]').length);
  assert.equal(slideSeen, 0, 'settings push is not a paper transition');
}
