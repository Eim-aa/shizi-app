// R2-X1（D51 ⑦，P226；第二轮审查 I2-06）：格下一行的控件位置稳定。
//
//   - 撤销 / 清空始终在格下一行右端：没落笔时也在、ink4 且不可点；落第一笔后位置一个像素都不动，只是变成 ink2 可点（交接 §13.1「无墨 ink4 且不可点」）。
//   - 「在纸上写」不再与它们叠在同一位置，也不挂在说明位：它是底部文字行里的常驻文字按钮（和「提示 / 看答案 / 跳过」同一行，左组「看答案」之后），
//     屏幕上写的回忆阶段始终在——不因结果行、首练提示、落笔、清空而消失（读屏、手不稳用户的替代路径）；点它仍切到纸上那一字。
//   - 版式几何不变：格下一行仍是 40 高、和书写格同宽。
// L 档与 XXXL（紧凑排布）各一遍，浅色。

import {
  bootTestHost, drawStroke, HORIZONTAL, seedSession, setTextSize, tokenRgb, topSel, waitNavIdle,
} from './helpers.mjs';

const CHARS = ['根', '据', '永'];

async function open(page, ctx, { size = 'L', kind = 'daily', cursor = 1 } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  if (size !== 'L') await setTextSize(page, size);
  await page.evaluate(() => { window.__shiziTest.reset(); });
  const seeded = await seedSession(page, { reset: false, slot: 'A', kind, chars: CHARS, cursor: kind === 'first' ? 0 : cursor });
  ctx.assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('write', { slot: 'A' }));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  await page.waitForSelector(`${topSel('write-hint')}[data-state="available"]`, { timeout: 15000 });
  await page.waitForTimeout(450);
  await page.mouse.move(1, 1);
}

/* eslint-disable no-undef */
function geometry() {
  const top = document.querySelector('.sz-layer[data-top="true"]');
  const rect = id => {
    const el = top.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, disabled: el.disabled, color: getComputedStyle(el).color };
  };
  const below = top.querySelector('.sz-write__below').getBoundingClientRect();
  const tools = top.querySelector('[data-testid="write-tools"]');
  return {
    grid: rect('write-grid'), undo: rect('write-undo'), clear: rect('write-clear'), toPaper: rect('write-to-paper'), tip: rect('write-first-tip'),
    hint: rect('write-hint'), answer: rect('write-show-answer'), skip: rect('write-skip'), vw: window.innerWidth, vh: window.innerHeight,
    toPaperText: (() => { const e = top.querySelector('[data-testid="write-to-paper"]'); if (!e) return null; const cs = getComputedStyle(e); return { fs: parseFloat(cs.fontSize), color: cs.color, deco: cs.textDecorationLine }; })(),
    hintText: (() => { const e = top.querySelector('[data-testid="write-hint"]'); const cs = getComputedStyle(e); return { fs: parseFloat(cs.fontSize), color: cs.color, deco: cs.textDecorationLine }; })(),
    below: { left: below.left, top: below.top, right: below.right, bottom: below.bottom, height: below.height },
    toolsShown: tools.dataset.shown, toolsVis: getComputedStyle(tools).visibility,
  };
}
/* eslint-enable no-undef */

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

export default async function x1ToolsPaper(page, ctx) {
  const { assert, step } = ctx;
  for (const size of ['L', 'XXXL']) {
    const tag = `390×844 ${size}`;
    step(`${tag}: before the first stroke undo / clear are already at the right end of the row (ink4, not tappable); 在纸上写 is a permanent text button in the bottom row`);
    await open(page, ctx, { size });
    const a = await page.evaluate(geometry);
    assert.deepEqual([a.toolsShown, a.toolsVis], ['true', 'visible'], `${tag}: the tools are shown with no ink`);
    assert.deepEqual([a.undo.disabled, a.clear.disabled], [true, true], `${tag}: both disabled with no ink`);
    assert.deepEqual([a.undo.color, a.clear.color], [tokenRgb('light', 'ink4'), tokenRgb('light', 'ink4')], `${tag}: ink4`);
    assert.ok(a.clear.right >= a.grid.right - 12 && a.clear.right <= a.grid.right + 12, `${tag}: clear is at the right end of the row (${a.clear.right.toFixed(0)} vs grid right ${a.grid.right.toFixed(0)})`);
    assert.ok(a.undo.left < a.clear.left, `${tag}: undo then clear`);
    assert.ok(a.toPaper && a.below && a.toPaper.top >= a.grid.bottom, `${tag}: 在纸上写 is below the grid, not in the note slot`);
    assert.ok(a.toPaper.top >= a.hint.top - 1 && a.toPaper.bottom <= a.hint.bottom + 1 || near(a.toPaper.top, a.hint.top, 2), `${tag}: it is on the same row as 提示 / 看答案 / 跳过 (${a.toPaper.top.toFixed(0)} vs ${a.hint.top.toFixed(0)})`);
    assert.ok(a.toPaper.left > a.answer.left && a.toPaper.right < a.skip.left, `${tag}: after 看答案, before 跳过`);
    assert.equal(a.toPaperText.fs, 15 * (size === 'XXXL' ? 1.35 : 1), `${tag}: the same 15 text button as its neighbours (${a.toPaperText.fs})`);
    assert.deepEqual([a.toPaperText.color, a.toPaperText.deco], [a.hintText.color, a.hintText.deco], `${tag}: same colour and underline as 提示 (H1 text button)`);
    assert.ok(a.toPaper.height >= 44 - 0.5, `${tag}: 44 hit area`);
    assert.ok(a.vh >= a.toPaper.bottom && a.toPaper.right <= a.vw, `${tag}: on the first screen`);
    assert.ok(near(a.below.height, 40, 1), `${tag}: the row under the grid is still 40 high (${a.below.height})`);

    step(`${tag}: after the first stroke the icons do not move, they turn live (ink2); 在纸上写 is still there; so after 清空`);
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(250);
    const b = await page.evaluate(geometry);
    assert.ok(near(b.undo.left, a.undo.left, 0.5) && near(b.undo.top, a.undo.top, 0.5) && near(b.clear.left, a.clear.left, 0.5), `${tag}: undo / clear are exactly where they were`);
    assert.deepEqual([b.undo.disabled, b.clear.disabled], [false, false], `${tag}: live`);
    assert.deepEqual([b.undo.color, b.clear.color], [tokenRgb('light', 'ink2'), tokenRgb('light', 'ink2')], `${tag}: ink2`);
    assert.ok(b.toPaper && near(b.toPaper.left, a.toPaper.left, 0.5) && near(b.toPaper.top, a.toPaper.top, 0.5), `${tag}: 在纸上写 stays, in the same place, once there is ink`);
    await page.click(topSel('write-clear'));
    await page.waitForTimeout(250);
    const c = await page.evaluate(geometry);
    assert.ok(near(c.undo.left, a.undo.left, 0.5) && near(c.clear.left, a.clear.left, 0.5), `${tag}: undo / clear still in place after 清空`);
    assert.ok(c.toPaper && near(c.toPaper.left, a.toPaper.left, 0.5), `${tag}: 在纸上写 still there after 清空`);
  }

  step('first session, first character: with the one-time tip showing, 在纸上写 is still there (nothing yields to anything)');
  await open(page, ctx, { kind: 'first' });
  const f = await page.evaluate(geometry);
  assert.ok(f.tip, 'the first tip is shown');
  assert.ok(f.toPaper, 'and 在纸上写 is still in the bottom row');
  assert.deepEqual([f.toolsShown, f.undo.disabled], ['true', true], 'the icons are in place regardless');

  step('choosing 在纸上写 switches this character to paper (with a result line showing it is also there — covered in 73-p1e8-paper)');
  await open(page, ctx, { size: 'L' });
  await page.click(topSel('write-to-paper'));
  await page.waitForSelector(topSel('write-paper'));
  assert.equal(await page.$(topSel('write-grid')), null, 'the paper cell replaced the writing grid');
  assert.equal(await page.$eval(topSel('write-tools'), el => el.dataset.shown), 'false', 'a paper character has no undo / clear');
}
