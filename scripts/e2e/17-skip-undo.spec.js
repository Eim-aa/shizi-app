// 跳过撤销底栏的寿命（M1 验收 G3；走查-W16 / R-W20；skip.js 文件头）。
// 撤销机会 = 5 秒（D36 / P115；原 3 秒），或者下一字一开始操作就结束；手指按在撤销条上时暂停计时、松开继续；
// 读屏 / 切换控制运行时（原生经 shiziAccessibilityStatus 告知）不自动收起，到下一次操作才收起：
//   跳过 → 下一字落笔 → 底栏立即收起、撤销入口不在了，5 秒后也不会把字拉回来（下一字的笔画保留）；
//   跳过 → 点提示 → 底栏收起；跳过 → 点看答案 → 底栏收起（确认框取消后也不回来）；
//   最后一字跳过 → 直接换成结果页（M2-3，无空页），撤销机会交给结果页，5 秒内点撤销回到写字页那个字（跳过前的笔画写回）；
//   最后一字再跳过、不操作 → 结果页上底栏约 5 秒后收起，跳过记录保留。

import {
  bootTestHost, drawStroke, HORIZONTAL, PRESS_SETTLE_MS, seedSession, tid, topSel, waitNavIdle, writeSnapshot, openWrite,
} from './helpers.mjs';

const CHARS = ['永', '和', '春'];

async function present(page, id) {
  return (await page.locator(topSel(id)).count()) > 0;
}

async function waitCursor(page, n) {
  await page.waitForFunction(k => {
    const st = window.__shiziTest.getState();
    return st.sessions.A && st.sessions.A.cursor === k;
  }, n);
  await page.waitForTimeout(PRESS_SETTLE_MS); // 换字 = 新状态：0.4s 按钮不响应、0.3s 不接受落笔
}

async function skippedCount(page) {
  return page.evaluate(() => {
    const st = window.__shiziTest.getState();
    let n = 0;
    for (const v of Object.values(st.records || {})) {
      for (const r of Array.isArray(v) ? v : (v && v.kept) || []) if (r.kind === 'skipped') n += 1;
    }
    return n;
  });
}

async function fresh(page, ctx, cursor = 0) {
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor });
  ctx.assert.ok(seeded.ok, `seed A session [${CHARS.join('')}] at cursor ${cursor}`);
  await page.waitForFunction(k => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && w.dataset.cursor === String(k) && w.dataset.phase === 'recall';
  }, cursor);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

export default async function skipUndo(page, ctx) {
  const { assert } = ctx;
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok, 'seed accepted');
  await openWrite(page, { slot: 'A' });

  ctx.step('跳过 永 → undo bar; first pen-down on 和 → bar gone at once, the undo entry is gone');
  await page.click(topSel('write-skip'));
  await waitCursor(page, 1);
  assert.equal(await present(page, 'write-skip-undo'), true, 'undo bar shown after the skip');
  let pendingDown = null;
  await drawStroke(page, HORIZONTAL, {
    beforeUp: async p => {
      pendingDown = { bar: await present(p, 'write-skip-undo'), btn: await present(p, 'write-skip-undo-btn') };
    },
  });
  assert.deepEqual(pendingDown, { bar: false, btn: false }, 'bar and 撤销 button gone already while the pen is down');
  let s = await writeSnapshot(page);
  assert.equal(s.strokes, 1, 'the stroke on 和 counts');
  assert.equal(s.cursor, 1, 'still on 和');
  await page.waitForTimeout(5300);
  s = await writeSnapshot(page);
  assert.equal(await present(page, 'write-skip-undo'), false, 'bar does not come back');
  assert.deepEqual([s.cursor, s.strokes], [1, 1], '5s later: still on 和 with its stroke (nothing undone)');
  assert.equal(await skippedCount(page), 1, 'the skipped record stays');
  const stored = await page.evaluate(() => window.__shiziTest.getState().sessions.A.current.strokes.length);
  assert.equal(stored, 1, 'the stroke on 和 is saved to the session (not lost to an undo)');

  ctx.step('跳过 → 提示 on the next character → bar gone');
  await fresh(page, ctx, 0);
  await page.click(topSel('write-skip'));
  await waitCursor(page, 1);
  assert.equal(await present(page, 'write-skip-undo'), true, 'undo bar shown');
  await page.waitForSelector(`${topSel('write-hint')}[data-state="available"]`, { timeout: 15000 });
  await page.click(topSel('write-hint'));
  await page.waitForSelector(`${topSel('write-hint-layer')}[data-state="shown"]`);
  assert.equal(await present(page, 'write-skip-undo'), false, 'bar gone after 提示');
  const hints = await page.evaluate(() => window.__shiziTest.getState().sessions.A.current.hints);
  assert.equal(hints, 1, 'the hint on 和 is recorded (not taken back by an undo)');

  ctx.step('跳过 → 看答案 on the next character → bar gone, and stays gone after cancelling the confirm');
  await fresh(page, ctx, 0);
  await page.click(topSel('write-skip'));
  await waitCursor(page, 1);
  assert.equal(await present(page, 'write-skip-undo'), true, 'undo bar shown');
  await page.click(topSel('write-show-answer'));
  await page.waitForSelector(tid('write-answer-confirm'));
  assert.equal(await present(page, 'write-skip-undo'), false, 'bar gone after 看答案');
  await waitNavIdle(page);
  await page.click(tid('confirm-cancel'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-answer-confirm"]'));
  await waitNavIdle(page);
  assert.equal(await present(page, 'write-skip-undo'), false, 'bar stays gone after 再想想');
  assert.equal((await writeSnapshot(page)).cursor, 1, 'still on 和');

  ctx.step('D36 / P115: a finger held on the bar pauses the clock, releasing lets the rest run out');
  await fresh(page, ctx, 0);
  await page.click(topSel('write-skip'));
  await waitCursor(page, 1);
  assert.equal(await present(page, 'write-skip-undo'), true, 'undo bar shown');
  const textBox = await page.locator(topSel('write-skip-undo-text')).boundingBox();
  const px = textBox.x + textBox.width / 2;
  const py = textBox.y + textBox.height / 2;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.waitForTimeout(5600); // 远超 5 秒：按住期间不收起
  assert.equal(await present(page, 'write-skip-undo'), true, 'bar is still up after 5.6s of holding it');
  await page.mouse.up();
  await page.waitForTimeout(800);
  assert.equal(await present(page, 'write-skip-undo'), true, 'released: the time that was left (about 4s) keeps running, the bar is still up');
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] [data-testid="write-skip-undo"]'), null, { timeout: 6000 });
  assert.equal((await writeSnapshot(page)).cursor, 1, 'the bar left on its own; still on 和, skip kept');

  ctx.step('D36 / P115: VoiceOver on (shiziAccessibilityStatus) → the bar does not collapse by itself; the next pen-down collapses it');
  await page.evaluate(() => window.shiziAccessibilityStatus({ voiceOver: true, switchControl: false }));
  await fresh(page, ctx, 0);
  await page.click(topSel('write-skip'));
  await waitCursor(page, 1);
  assert.equal(await present(page, 'write-skip-undo'), true, 'undo bar shown');
  await page.waitForTimeout(5800);
  assert.equal(await present(page, 'write-skip-undo'), true, 'still there after 5.8s with VoiceOver running');
  await drawStroke(page, HORIZONTAL);
  assert.equal(await present(page, 'write-skip-undo'), false, 'the next action (pen-down) collapses it');
  await page.evaluate(() => window.shiziAccessibilityStatus({ voiceOver: false, switchControl: true }));
  await fresh(page, ctx, 0);
  await page.click(topSel('write-skip'));
  await waitCursor(page, 1);
  await page.waitForTimeout(5800);
  assert.equal(await present(page, 'write-skip-undo'), true, 'Switch Control alone keeps it up as well');
  await page.click(topSel('write-skip-undo-btn'));
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.cursor === 0);
  await page.evaluate(() => window.shiziAccessibilityStatus({ voiceOver: false, switchControl: false }));

  ctx.step('last character (M2-3): write one stroke on 春, 跳过 → result page straight away (no empty page), undo bar carried over; 撤销 → back to 春 with its stroke');
  await fresh(page, ctx, 2);
  await drawStroke(page, HORIZONTAL);
  assert.equal((await writeSnapshot(page)).strokes, 1, 'one stroke on 春 before the skip');
  await page.click(topSel('write-skip'));
  await page.waitForSelector(topSel('result-screen'));
  assert.equal(await present(page, 'write-empty'), false, 'no write-empty placeholder on top: the write page was replaced by the result page');
  assert.equal(await present(page, 'write-skip-undo'), true, 'undo bar rendered on the result page');
  const barText = (await page.locator(topSel('write-skip-undo-text')).textContent()).trim();
  assert.equal(barText, `已跳过「${CHARS[2]}」`, 'bar text 已跳过「春」');
  const barBox = await page.locator(topSel('write-skip-undo')).boundingBox();
  const vp = page.viewportSize();
  assert.ok(!!barBox && barBox.y >= 0 && barBox.y + barBox.height <= vp.height, `bar inside the viewport ${JSON.stringify(barBox)}`);
  await waitNavIdle(page); // 新页面 0.4s 按钮不响应（走查-W08）
  await page.click(topSel('write-skip-undo-btn'));
  await page.waitForSelector(topSel('write-screen'));
  await waitCursor(page, 2);
  s = await writeSnapshot(page);
  assert.deepEqual([s.screen, s.cursor, s.phase], ['write', 2, 'recall'], '春 back at the cursor in recall on a write page');
  assert.equal(s.strokes, 1, 'the stroke written on 春 before the skip is back (written back to current.strokes)');
  assert.equal(await present(page, 'write-skip-undo'), false, 'bar gone after the undo');
  assert.equal(await skippedCount(page), 0, 'the skipped record was removed');
  const back = await page.evaluate(() => {
    const st = window.__shiziTest.getState();
    return { a: !!st.sessions.A, ended: !!(st.sessions.lastEnded || {}).A, rows: st.sessions.A ? st.sessions.A.current.strokes.length : -1 };
  });
  assert.deepEqual(back, { a: true, ended: false, rows: 1 }, 'session back in slot A (not in lastEnded), current.strokes has the stroke');

  ctx.step('last character again, no action → the bar on the result page leaves after ~5s, the skip stays');
  await waitNavIdle(page);
  await page.click(topSel('write-skip'));
  const t0 = Date.now();
  await page.waitForSelector(topSel('result-screen'));
  await page.waitForTimeout(Math.max(0, 4300 - (Date.now() - t0)));
  assert.equal(await present(page, 'write-skip-undo'), true, 'bar still there at 4.3s (it used to be gone after 3s)');
  await page.waitForTimeout(1500);
  assert.equal(await present(page, 'write-skip-undo'), false, 'bar gone after 5s');
  assert.equal(await present(page, 'result-screen'), true, 'still the result page');
  assert.equal(await skippedCount(page), 1, 'the skipped record stays');
}
