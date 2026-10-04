// M1-1 写字页骨架与书写格（02 §3 M1-1；01 §6.1–6.3；走查-W17 / V01；M0-7 手势门控）。
// seed 一个 A 会话（3 个字）→ 首页测试入口打开写字页 → 鼠标画一笔「写好了」变可用 → 撤销后 disabled →
// 清空后一次撤销恢复 → 原生返回 began / pointercancel 中断当前笔不计 → 换字 0.3s 内落笔不计 → 返回 tab 根手势仍关（K1）。
// 控制台零错误由 run.mjs 统一断言。后续卡（M1-2…M1-8）在本文件后面追加各自的段落。

import {
  bootTestHost, canvasInk, drawStroke, HORIZONTAL, installNativeStub, makeSession, nativeMessages, openWrite,
  seedSession, tid, topSel, VERTICAL, waitNavIdle, writeSnapshot,
} from './helpers.mjs';

const CHARS = ['永', '和', '春'];

export default async function write(page, ctx) {
  const { assert } = ctx;
  await installNativeStub(page);

  ctx.step('seed an A session with three characters and open the write screen from the test entry');
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok, 'seed accepted (shape check + writeAll)');
  assert.ok(await page.isVisible(tid('write-test-entry')), 'home shows the test-host-only write entry');
  await openWrite(page, { slot: 'A' });
  let s = await writeSnapshot(page);
  assert.equal(s.screen, 'write', 'write screen is on top');
  assert.equal(s.title, '凭记忆写出这个字', 'title R-W03.titleRecall');
  assert.equal(s.progress, '1 / 3', 'progress R-W01 = cursor + 1 / queue length');
  assert.equal(s.strokes, 0, 'no strokes yet');
  assert.deepEqual(s.done, { disabled: true, ariaDisabled: 'true' }, '「写好了」 disabled + aria-disabled with an empty grid');
  assert.equal(s.toolsShown, true, 'undo / clear are in place with an empty grid (R2-X1 / P226): ink4 and not tappable, not hidden');
  assert.equal(await page.locator(topSel('write-undo')).isDisabled(), true, 'but not tappable while there is nothing to undo');
  const grid = await page.locator(topSel('write-grid')).boundingBox();
  // D36（覆盖 X08）：书写格 = min(屏宽 − 40, 视口高 − 预算) 夹在 258–400（P1-E1b：页边 20，原为屏宽 − 32）；393×852 取 353（内部坐标仍是 345 单位，见 16-grid.spec.js）。
  assert.equal(Math.round(grid.width), 353, 'grid at 393×852 is 353 wide (screen width − 40, gutter 20)');
  assert.equal(Math.round(grid.height), 353, 'grid is square');
  const leak = await page.evaluate(chars => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return chars.filter(c => top.outerHTML.includes(c));
  }, CHARS);
  assert.deepEqual(leak, [], 'no answer character anywhere in the write screen DOM (D16)');
  const touchAction = await page.evaluate(() => getComputedStyle(document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid-live"]')).touchAction);
  assert.equal(touchAction, 'none', 'live canvas has touch-action:none');
  let gate = await nativeMessages(page, 'backGestureEnabled');
  assert.deepEqual(gate.map(m => m.value), [false], 'tab root false at boot; write mount keeps false — sent once (01 §7)');

  ctx.step('draw one stroke with the mouse → 「写好了」 becomes available');
  await drawStroke(page, HORIZONTAL);
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 1, 'one stroke committed to the grid');
  assert.deepEqual(s.done, { disabled: false, ariaDisabled: null }, '「写好了」 enabled');
  assert.equal(s.toolsShown, true, 'undo / clear shown');
  assert.deepEqual([s.undo.disabled, s.clear.disabled], [false, false], 'undo and clear enabled');
  assert.ok(await canvasInk(page, 'write-grid-ink') > 500, 'stroke is painted on the solid layer');
  assert.equal(await canvasInk(page, 'write-grid-live'), 0, 'current-stroke layer is cleared after lift');

  ctx.step('undo → back to empty, 「写好了」 disabled again');
  await page.click(topSel('write-undo'));
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 0, 'undo removed the stroke');
  assert.deepEqual(s.done, { disabled: true, ariaDisabled: 'true' }, '「写好了」 disabled after undo');
  assert.equal(await canvasInk(page, 'write-grid-ink'), 0, 'solid layer repainted empty');

  ctx.step('clear, then one undo restores everything (走查-W17)');
  await drawStroke(page, HORIZONTAL);
  await drawStroke(page, VERTICAL);
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 2, 'two strokes');
  const inkTwo = await canvasInk(page, 'write-grid-ink');
  await page.click(topSel('write-clear'));
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 0, 'clear empties the grid');
  assert.deepEqual(s.done, { disabled: true, ariaDisabled: 'true' }, '「写好了」 disabled after clear');
  assert.equal(s.undo.disabled, false, 'undo still available right after clear');
  assert.equal(s.clear.disabled, true, 'clear disabled on an empty grid');
  await page.click(topSel('write-undo')); // 撤销 / 清空不受「同一按钮 0.4s」节流（G2），不用等
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 2, 'one undo after clear restores both strokes');
  assert.deepEqual(s.done, { disabled: false, ariaDisabled: null }, '「写好了」 enabled again');
  assert.equal(await canvasInk(page, 'write-grid-ink'), inkTwo, 'restored strokes repaint identically');
  await page.click(topSel('write-undo'));
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 1, 'after the restore, undo removes strokes one by one again');

  ctx.step('interrupted strokes are discarded: native back gesture began / pointercancel');
  await drawStroke(page, VERTICAL, {
    beforeUp: p => p.evaluate(() => window.dispatchEvent(new CustomEvent('shizi-native-back-progress', {
      detail: { phase: 'began', translationX: 4, progress: 0.01, velocityX: 50 },
    }))),
  });
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 1, 'shizi-native-back-progress {phase:"began"} drops the current stroke (M0-7)');
  assert.equal(await canvasInk(page, 'write-grid-live'), 0, 'current-stroke layer cleared after the interruption');
  await page.evaluate(() => {
    const c = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid-live"]');
    c.addEventListener('pointerdown', e => { window.__lastPointerId = e.pointerId; }, { once: true });
  });
  await drawStroke(page, VERTICAL, {
    beforeUp: p => p.evaluate(() => {
      const c = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid-live"]');
      c.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__lastPointerId, isPrimary: true, bubbles: true }));
    }),
  });
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 1, 'pointercancel drops the current stroke, solid strokes untouched');
  assert.equal(s.done.disabled, false, '「写好了」 still enabled (one committed stroke remains)');

  ctx.step('G2: two strokes, then 撤销 twice within 150ms → 0 strokes (no same-button 0.4s throttle on undo)');
  await drawStroke(page, HORIZONTAL);
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 2, 'two strokes before the rapid undo');
  const undoBox = await page.locator(topSel('write-undo')).boundingBox();
  const rapid = await page.evaluate(() => {
    const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-undo"]');
    window.__undoClicks = [];
    b.addEventListener('click', e => window.__undoClicks.push(e.timeStamp), { capture: true });
    return true;
  });
  assert.ok(rapid, 'undo click probe installed');
  await page.mouse.click(undoBox.x + undoBox.width / 2, undoBox.y + undoBox.height / 2);
  await page.waitForTimeout(100);
  await page.mouse.click(undoBox.x + undoBox.width / 2, undoBox.y + undoBox.height / 2);
  const gap = await page.evaluate(() => window.__undoClicks[1] - window.__undoClicks[0]);
  assert.ok(gap > 0 && gap < 150, `the two undo presses were ${Math.round(gap)}ms apart (< 150ms)`);
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 0, 'both presses counted: 0 strokes left');
  assert.deepEqual(s.done, { disabled: true, ariaDisabled: 'true' }, '「写好了」 disabled again');
  assert.equal(await canvasInk(page, 'write-grid-ink'), 0, 'solid layer repainted empty');

  ctx.step('changing the character: pen-down within 0.3s is ignored, after 0.3s it counts (走查-V01)');
  const next = makeSession({ slot: 'A', kind: 'daily', chars: CHARS, cursor: 1 });
  const timing = await page.evaluate(sess => {
    // seed 是整体替换：写字页本体按 store 替换代数重挂（M6-6），书写格 canvas 会换新，监听挂在 document 上（捕获阶段）。
    window.__penDowns = [];
    document.addEventListener('pointerdown', e => {
      const hit = e.target && e.target.closest && e.target.closest('.sz-layer[data-top="true"] [data-testid="write-grid-live"]');
      if (hit) window.__penDowns.push(e.timeStamp);
    }, true);
    window.__seedAt = performance.now();
    const r = window.__shiziTest.seed({ sessions: { A: sess, B: null, lastEnded: {} } });
    return { ok: !!r.ok, at: window.__seedAt };
  }, next);
  assert.ok(timing.ok, 'seed moved cursor to the second character');
  await drawStroke(page, HORIZONTAL, { steps: 2 });
  const earlyDown = await page.evaluate(() => window.__penDowns[0] - window.__seedAt);
  assert.ok(earlyDown < 300, `the early pen-down really landed inside the 0.3s window (${Math.round(earlyDown)}ms after the change)`);
  s = await writeSnapshot(page);
  assert.equal(s.cursor, 1, 'screen follows sessions.A.cursor');
  assert.equal(s.progress, '2 / 3', 'progress updated');
  assert.equal(s.strokes, 0, 'strokes of the previous character are gone and the early stroke was not accepted');
  assert.deepEqual(s.done, { disabled: true, ariaDisabled: 'true' }, '「写好了」 stays disabled');
  assert.equal(await canvasInk(page, 'write-grid-ink'), 0, 'nothing painted for the ignored stroke');
  await page.waitForTimeout(350);
  await drawStroke(page, HORIZONTAL);
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 1, 'a pen-down after 0.3s is accepted');
  assert.equal(s.done.disabled, false, '「写好了」 enabled');

  ctx.step('back to home: the tab root keeps the native back gesture off (K1, 01 §7); no direct localStorage writes');
  await page.click(topSel('page-back'));
  await waitNavIdle(page);
  s = await writeSnapshot(page);
  assert.equal(s.screen, 'home', 'back returns to the home tab');
  await page.waitForTimeout(400); // 写字页图层在返回动画结束后才卸载（卸载时交还按栈的值）
  gate = await nativeMessages(page, 'backGestureEnabled');
  assert.deepEqual(gate.map(m => m.value), [false], 'write screen → tab root: stays false, no transient true (tab root is not back-able)');
  assert.equal(await page.evaluate(() => window.__shiziBridge.lastBackGestureSent()), false, 'last value sent is false at the tab root');
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct'));
  assert.deepEqual(direct, [], 'every localStorage write went through storage.js');

  ctx.step('reduced motion: strokes still draw (brush detail off, no animation)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 2 });
  await openWrite(page, { slot: 'A' });
  s = await writeSnapshot(page);
  assert.equal(s.progress, '3 / 3', 'third character');
  await drawStroke(page, HORIZONTAL);
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 1, 'stroke accepted with prefers-reduced-motion: reduce');
  assert.ok(await canvasInk(page, 'write-grid-ink') > 500, 'stroke painted');
}
