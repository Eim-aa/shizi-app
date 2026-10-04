// R2-X1（D51 ⑦，P226；第二轮审查 I2-06）：格下一行的控件位置稳定。
//
//   - 撤销 / 清空始终在格下一行右端：没落笔时也在、ink4 且不可点；落第一笔后位置一个像素都不动，只是变成 ink2 可点（交接 §13.1「无墨 ink4 且不可点」）。
//   - 「在纸上写」不再与它们叠在同一位置：移到格下说明位的左侧，只在没有别的说明时出现（首练第 1 字的一次性提示在时让位）；落第一笔后收起。
//   - 点「在纸上写」仍切到纸上那一字（73-p1e8-paper 另有完整流程）。
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
    step(`${tag}: before the first stroke undo / clear are already at the right end of the row (ink4, not tappable); 在纸上写 sits on the left`);
    await open(page, ctx, { size });
    const a = await page.evaluate(geometry);
    assert.deepEqual([a.toolsShown, a.toolsVis], ['true', 'visible'], `${tag}: the tools are shown with no ink`);
    assert.deepEqual([a.undo.disabled, a.clear.disabled], [true, true], `${tag}: both disabled with no ink`);
    assert.deepEqual([a.undo.color, a.clear.color], [tokenRgb('light', 'ink4'), tokenRgb('light', 'ink4')], `${tag}: ink4`);
    assert.ok(a.clear.right >= a.grid.right - 12 && a.clear.right <= a.grid.right + 12, `${tag}: clear is at the right end of the row (${a.clear.right.toFixed(0)} vs grid right ${a.grid.right.toFixed(0)})`);
    assert.ok(a.undo.left < a.clear.left, `${tag}: undo then clear`);
    assert.ok(a.toPaper, `${tag}: 在纸上写 is there`);
    assert.ok(a.toPaper.left <= a.grid.left + 12, `${tag}: and on the left (${a.toPaper.left.toFixed(0)} ≤ grid left ${a.grid.left.toFixed(0)} + 12)`);
    assert.ok(a.toPaper.right <= a.undo.left, `${tag}: it does not sit on the undo / clear icons (${a.toPaper.right.toFixed(0)} ≤ ${a.undo.left.toFixed(0)})`);
    assert.ok(near(a.below.height, 40, 1), `${tag}: the row is still 40 high (${a.below.height})`);
    assert.ok(a.toPaper.height >= 44 - 0.5, `${tag}: the paper button keeps a 44 hit area`);

    step(`${tag}: after the first stroke the icons do not move, they turn live (ink2); 在纸上写 is gone`);
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(250);
    const b = await page.evaluate(geometry);
    assert.ok(near(b.undo.left, a.undo.left, 0.5) && near(b.undo.top, a.undo.top, 0.5) && near(b.clear.left, a.clear.left, 0.5), `${tag}: undo / clear are exactly where they were`);
    assert.deepEqual([b.undo.disabled, b.clear.disabled], [false, false], `${tag}: live`);
    assert.deepEqual([b.undo.color, b.clear.color], [tokenRgb('light', 'ink2'), tokenRgb('light', 'ink2')], `${tag}: ink2`);
    assert.equal(b.toPaper, null, `${tag}: 在纸上写 is gone once there is ink`);
    assert.ok(near(b.below.height, 40, 1), `${tag}: the row is still 40 high`);

    step(`${tag}: clearing back to an empty grid keeps the icons where they are (no jump) and does not bring 在纸上写 back over them`);
    await page.click(topSel('write-clear'));
    await page.waitForTimeout(250);
    const c = await page.evaluate(geometry);
    assert.ok(near(c.undo.left, a.undo.left, 0.5) && near(c.clear.left, a.clear.left, 0.5), `${tag}: still in place after 清空`);
    assert.equal(c.toPaper, null, `${tag}: after 清空 (an undo is available) the row holds no paper button`);
  }

  step('first session, first character: the one-time tip is on the left, 在纸上写 gives way to it (no two things fighting for the slot)');
  await open(page, ctx, { kind: 'first' });
  const f = await page.evaluate(geometry);
  assert.ok(f.tip, 'the first tip is shown');
  assert.equal(f.toPaper, null, 'so 在纸上写 yields');
  assert.deepEqual([f.toolsShown, f.undo.disabled], ['true', true], 'the icons are in place regardless');

  step('choosing 在纸上写 still switches this character to paper');
  await open(page, ctx, { size: 'L' });
  await page.click(topSel('write-to-paper'));
  await page.waitForSelector(topSel('write-paper'));
  assert.equal(await page.$(topSel('write-grid')), null, 'the paper cell replaced the writing grid');
  assert.equal(await page.$eval(topSel('write-tools'), el => el.dataset.shown), 'false', 'a paper character has no undo / clear');
}
