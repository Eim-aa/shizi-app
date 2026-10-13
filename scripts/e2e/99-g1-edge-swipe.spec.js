// R4-G1（P270 / P271）：左缘右滑返回——网页兜底手势（浏览器 / 主屏 PWA，ui/edge-swipe.js）在 Chromium 里用真实触摸序列
// （CDP Input.dispatchTouchEvent → pointerType 'touch'）验收：
//   1. 设置 / 单字详情 / 练习记录 / 演示子页：左缘上、中、下三处起手慢拖过三分之一宽 → 返回一层；拖动中页面跟手（顶层 translateX > 0、data-nav-anim=drag）；
//   2. 写字页：从左缘、书写格的高度起手横穿书写格 → 返回首页、不产生笔画；书写格内起手照常写一笔、不返回；
//   3. 短拖慢放 → 回弹，页面状态不变（栈、笔画、图层样式复原）；中途拖回 → 回弹；
//   4. 起手带上轻点 → 点击转给下面的「‹」（不吞点击）；竖向拖动不触发返回；
//   5. 判断阶段（左上是「‹ 接着写」）滑动 = 点「‹」：回到写字状态、页面不出栈（R5-I2 / D58 ①，推翻 P270 的门控）；tab 根没有起手带；
//   6. 减少动态效果：拖动中页面不动，松手淡化 150ms 返回；
//   7. 原生壳（假原生通道）：不画起手带（原生识别器是唯一所有者），写字页门控 backGestureEnabled = true、判断阶段仍是 true。
// 控制台零错误由 run.mjs 统一断言。

import {
  bootTestHost, drawStroke, HORIZONTAL, installNativeStub, nativeMessages, openWrite, seedSession, tap, tid, topSel, waitNavIdle, writeSnapshot,
} from './helpers.mjs';

const CHARS = ['永', '和', '春'];

async function state(page) {
  return page.evaluate(() => {
    const app = document.querySelector('.sz-app');
    const top = app.querySelector(':scope > .sz-layer[data-top="true"]');
    return {
      depth: history.state.depth,
      names: history.state.stack.map(e => e.n),
      screen: app.dataset.topScreen,
      navAnim: app.dataset.navAnim,
      topTransform: top ? top.style.transform : null,
      inline: [...app.querySelectorAll(':scope > .sz-layer')].map(el => el.style.transform).filter(Boolean),
      strip: !!app.querySelector(':scope > .sz-edge'),
    };
  });
}

async function push(page, name, params = {}) {
  await page.evaluate(async ([n, p]) => {
    const { nav } = await import('/src/ui/router.js');
    nav.push(n, p);
  }, [name, params]);
  await page.waitForFunction(n => document.querySelector('.sz-app').dataset.topScreen === n, name);
  await waitNavIdle(page);
}

/**
 * 一根手指的触摸序列：从 (x0, y) 拖到 (x1, y + dy)，steps 步、每步 dt ms。midway(page) 在过半时调用（读跟手状态）。
 * 返回 midway 的结果。
 */
async function swipe(cdp, page, { x0 = 4, x1, y, dy = 0, steps = 12, dt = 40, midway = null, back = null }) {
  const pt = (x, yy) => ({ x, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(x0, y)] });
  let mid = null;
  let x = x0;
  let yy = y;
  for (let i = 1; i <= steps; i += 1) {
    await page.waitForTimeout(dt);
    x = x0 + ((x1 - x0) * i) / steps;
    yy = y + (dy * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(x, yy)] });
    if (i === Math.ceil(steps / 2) && midway) mid = await midway(page);
  }
  if (back !== null) {
    for (let i = 1; i <= steps; i += 1) {
      await page.waitForTimeout(dt);
      x = x1 + ((back - x1) * i) / steps;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(x, yy)] });
    }
  }
  await page.waitForTimeout(dt);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return mid;
}

async function tapAt(cdp, page, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 2 }] });
  await page.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export default async function edgeSwipe(page, ctx) {
  const { assert, step } = ctx;
  const W = ctx.viewport.width;
  const H = ctx.viewport.height;
  const HEIGHTS = { top: 120, middle: Math.round(H / 2), bottom: H - 90 };
  const far = Math.round(W * 0.45); // 慢拖过三分之一宽（速度 ≈ 360px/s < 500，靠位移完成）

  step('boot (test host) with touch input');
  await bootTestHost(page, ctx.baseURL);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  let s = await state(page);
  assert.equal(s.depth, 0);
  assert.equal(s.strip, false, 'tab root: no edge strip (root pages never go back)');

  for (const [screen, params] of [['remind', {}], ['detail', { char: '完' }], ['records', {}]]) {
    for (const [where, y] of Object.entries(HEIGHTS)) {
      step(`${screen}: left-edge swipe from the ${where} (y=${y}) follows the finger and goes back`);
      await push(page, screen, params);
      s = await state(page);
      assert.equal(s.strip, true, `${screen}: edge strip present on a sub page`);
      const mid = await swipe(cdp, page, { x1: far, y, midway: state });
      assert.equal(mid.navAnim, 'drag', `${screen}/${where}: dragging mid-way`);
      const mx = Number(/translateX\(([-\d.]+)px\)/.exec(mid.topTransform || '')?.[1]);
      assert.ok(mx > 40 && mx < far, `${screen}/${where}: top page follows the finger (translateX ${mx})`);
      await waitNavIdle(page);
      s = await state(page);
      assert.equal(s.depth, 0, `${screen}/${where}: popped back to the tab root`);
      assert.deepEqual(s.inline, [], `${screen}/${where}: no leftover transforms`);
    }
  }

  step('demo sub pages: bottom-edge swipe pops exactly one level each time');
  await page.click(tid('demo-push'));
  await waitNavIdle(page);
  await page.click(topSel('demo-push-next'));
  await waitNavIdle(page);
  assert.equal((await state(page)).depth, 2);
  await swipe(cdp, page, { x1: far, y: HEIGHTS.bottom });
  await waitNavIdle(page);
  assert.equal((await state(page)).depth, 1, 'one level popped');

  step('short slow drag springs back: stack and layers unchanged');
  await swipe(cdp, page, { x1: Math.round(W * 0.2), y: HEIGHTS.middle, dt: 60 });
  await page.waitForTimeout(400);
  await waitNavIdle(page);
  s = await state(page);
  assert.equal(s.depth, 1, 'still on the sub page');
  assert.deepEqual(s.inline, [], 'layers restored after the spring-back');

  step('mid-way reversal (drag far, then back to the edge) cancels');
  await swipe(cdp, page, { x1: Math.round(W * 0.7), y: HEIGHTS.top, back: 10 });
  await page.waitForTimeout(400);
  await waitNavIdle(page);
  assert.equal((await state(page)).depth, 1, 'pulled back → stays');

  step('vertical drag on the strip does not go back; the strip starts below the header, so 「‹」 is never covered');
  await swipe(cdp, page, { x1: 8, y: HEIGHTS.middle, dy: 200, steps: 8 });
  await page.waitForTimeout(300);
  assert.equal((await state(page)).depth, 1, 'vertical drag: no back');
  const backBox = await page.locator(topSel('page-back')).boundingBox();
  const strip = await page.locator('.sz-app > .sz-edge').boundingBox();
  assert.ok(strip.y >= backBox.y + backBox.height - 0.5 && strip.width === 12, `strip ${JSON.stringify(strip)} below the 「‹」 ${JSON.stringify(backBox)}, 12px wide`);
  const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y).closest('[data-testid="page-back"]'), [6, backBox.y + backBox.height / 2]);
  assert.ok(hit, '「‹」 is hit-testable at its left edge (x=6)');
  await page.waitForTimeout(450);
  await tapAt(cdp, page, 6, backBox.y + backBox.height / 2);
  await waitNavIdle(page);
  assert.equal((await state(page)).depth, 0, 'tap on 「‹」 at x=6 → back');

  step('write page: an edge swipe at the grid height crosses the grid without drawing and goes back home');
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok);
  await openWrite(page, { slot: 'A' });
  let grid = await page.locator(topSel('write-grid-live')).boundingBox();
  assert.ok(grid.x >= 20, `grid keeps the 20px gutter (x=${grid.x})`);
  const gy = Math.round(grid.y + grid.height / 2);
  const wmid = await swipe(cdp, page, { x1: Math.round(grid.x + grid.width * 0.6), y: gy, midway: state });
  assert.equal(wmid.navAnim, 'drag', 'write page follows the finger');
  await waitNavIdle(page);
  s = await state(page);
  assert.equal(s.screen, 'home', 'write page → home');
  let st = await page.evaluate(() => window.__shiziTest.getState().sessions.A);
  assert.equal(st.current.strokes.length, 0, 'no stroke was drawn by the edge swipe');

  for (const [where, y] of Object.entries(HEIGHTS)) {
    step(`write page: swipe from the ${where} edge goes back`);
    await openWrite(page, { slot: 'A' });
    await swipe(cdp, page, { x1: far, y });
    await waitNavIdle(page);
    assert.equal((await state(page)).screen, 'home', `write/${where}: back home`);
  }

  step('write page: touch writing inside the grid draws a stroke and does not go back');
  await openWrite(page, { slot: 'A' });
  grid = await page.locator(topSel('write-grid-live')).boundingBox();
  await swipe(cdp, page, { x0: grid.x + 30, x1: grid.x + grid.width - 30, y: gy, dt: 16 });
  await page.waitForTimeout(300);
  let w = await writeSnapshot(page);
  assert.equal(w.screen, 'write', 'still on the write page');
  assert.equal(w.strokes, 1, 'one stroke drawn');

  step('write page: a cancelled edge swipe leaves the stroke and the page as they were');
  await swipe(cdp, page, { x1: 70, y: gy, dt: 70, steps: 6 });
  await page.waitForTimeout(400);
  await waitNavIdle(page);
  w = await writeSnapshot(page);
  assert.equal(w.screen, 'write');
  assert.equal(w.strokes, 1, 'stroke kept');
  assert.deepEqual((await state(page)).inline, [], 'layers restored');

  step('compare phase (top-left is 「‹ 接着写」): the edge swipe does what 「‹」 does — back to writing, page stays (R5-I2 / D58 ①)');
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-wrong'));
  await waitNavIdle(page);
  s = await state(page);
  assert.equal(s.strip, true, 'edge strip present in the compare phase');
  for (const [where, y] of Object.entries(HEIGHTS)) {
    if (where !== 'top') {
      await page.click(topSel('write-done'));
      await page.waitForSelector(topSel('write-judge-wrong'));
      await waitNavIdle(page);
    }
    await swipe(cdp, page, { x1: far, y });
    await page.waitForTimeout(300);
    await waitNavIdle(page);
    w = await writeSnapshot(page);
    assert.equal(w.screen, 'write', `compare/${where}: stays on the write page`);
    assert.equal(await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.phase), 'recall', `compare/${where}: back to writing`);
    assert.equal(w.strokes, 1, `compare/${where}: the stroke is still there`);
  }
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
  await waitNavIdle(page);

  step('result page (top-left 「×」): swipe does what 「×」 does — back to home from the finger position (no jump)');
  await seedSession(page, { slot: 'A', kind: 'daily', chars: ['永'], cursor: 0 });
  await openWrite(page, { slot: 'A' });
  await drawStroke(page, HORIZONTAL);
  await tap(page, 'write-done');
  await tap(page, 'write-judge-correct');
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  s = await state(page);
  assert.deepEqual(s.names, ['home', 'result'], 'result replaced the write page');
  await page.evaluate(() => {
    window.__anims = [];
    const app = document.querySelector('.sz-app');
    new MutationObserver(() => window.__anims.push(app.dataset.navAnim)).observe(app, { attributes: true, attributeFilter: ['data-nav-anim'] });
  });
  await swipe(cdp, page, { x1: far, y: HEIGHTS.middle });
  await waitNavIdle(page);
  s = await state(page);
  assert.equal(s.screen, 'home', 'result → home');
  const anims = await page.evaluate(() => window.__anims);
  // 写字页是点首页测试入口进来的：R6-J1 起点按进入一律从被点元素 B1，结果页离开同样沿 B1 缩回那个按钮（R5-I2 P1-02「怎么进来就怎么离开」）
  assert.ok(anims.includes('drag') && anims.includes('pop-paper'), `followed, then left the same way the write page came in (B1 from the tapped entry, R6-J1 / R5-I2 P1-02) (${anims.join(' → ')})`);
  st = await page.evaluate(() => window.__shiziTest.getState().sessions);
  assert.equal(st.lastEnded.A, undefined, 'same as 「×」: the finished group is cleared from lastEnded');

  step('reduced motion: no follow while dragging; release goes back with a 150ms cross-fade');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await push(page, 'remind');
  await page.evaluate(() => {
    window.__fade = null;
    const app = document.querySelector('.sz-app');
    const mo = new MutationObserver(() => {
      if (!/^pop-/.test(app.dataset.navAnim) || window.__fade) return;
      mo.disconnect();
      window.__fade = { anim: app.dataset.navAnim, durations: [...app.querySelectorAll(':scope > .sz-layer')].flatMap(el => el.getAnimations().map(a => a.effect.getTiming().duration)) };
    });
    mo.observe(app, { attributes: true, attributeFilter: ['data-nav-anim'] });
  });
  const rmid = await swipe(cdp, page, { x1: far, y: HEIGHTS.middle, midway: state });
  assert.deepEqual(rmid.inline, [], 'reduced motion: the page does not move with the finger');
  await waitNavIdle(page);
  assert.equal((await state(page)).depth, 0, 'still goes back');
  const fade = await page.evaluate(() => window.__fade);
  assert.equal(fade && fade.anim, 'pop-fade', 'cross-fade');
  assert.deepEqual(fade.durations, [150], 'fade lasts 150ms (P270)');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  step('native shell (stub): no web edge strip; the write page enables the native gesture, the compare phase keeps it on');
  const p2 = await page.context().newPage();
  await installNativeStub(p2);
  await bootTestHost(p2, ctx.baseURL);
  await seedSession(p2, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  await openWrite(p2, { slot: 'A' });
  assert.equal((await state(p2)).strip, false, 'native shell: no web strip');
  let gate = (await nativeMessages(p2, 'backGestureEnabled')).map(m => m.value);
  assert.deepEqual(gate, [false, true], 'tab root false → write page true (P270: no longer disabled on the write page)');
  await drawStroke(p2, HORIZONTAL);
  await p2.click(topSel('write-done'));
  await p2.waitForSelector(topSel('write-judge-wrong'));
  await waitNavIdle(p2);
  gate = (await nativeMessages(p2, 'backGestureEnabled')).map(m => m.value);
  assert.deepEqual(gate, [false, true], 'compare phase (「‹ 接着写」) keeps the gesture on (R5-I2 / D58 ①)');
  await p2.close();
}
