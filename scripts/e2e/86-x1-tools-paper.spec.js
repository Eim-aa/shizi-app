// R2-X1（D51 ⑦，P226；第二轮审查 I2-06）→ R3-C3W（D53 ②，P258）：写字页的控件位置稳定。
//
//   - 撤销 / 清空常驻页头右侧（计数左边）：没落笔时也在、ink4 且不可点；落第一笔后位置一个像素都不动，只是变成 ink2 可点（交接 §13.1「无墨 ink4 且不可点」）。
//   - 「在纸上写」是 X1 定下的常驻入口（读屏、手不稳用户的替代路径）：「⋯」菜单第一项，屏幕上写的回忆阶段始终在——不因结果行、首练提示、落笔、清空而消失；
//     点它仍切到纸上那一字。读屏开启或设置偏好纸上时，格下说明位另有一个看得见的「在纸上写」（73-p1e8-paper 覆盖偏好纸上；这里覆盖读屏）。
//   - 版式几何不变：格下说明位仍是 40 高、和书写格同宽。
// L 档与 XXXL（紧凑排布）各一遍，浅色。

import {
  bootTestHost, drawStroke, HORIZONTAL, footItems, seedSession, setTextSize, tokenRgb, topSel, waitNavIdle, tap,
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
  await page.waitForSelector(topSel('write-done'), { timeout: 15000 });
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
  const head = top.querySelector('.sz-page__head').getBoundingClientRect();
  const progress = top.querySelector('[data-testid="write-progress"]').getBoundingClientRect();
  return {
    grid: rect('write-grid'), undo: rect('write-undo'), clear: rect('write-clear'), toPaper: rect('write-to-paper'), tip: rect('write-first-tip'),
    vw: window.innerWidth, vh: window.innerHeight, headBottom: head.bottom, progressLeft: progress.left,
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
    step(`${tag}: before the first stroke undo / clear are already in the header, left of the counter (ink4, not tappable); 在纸上写 is in the text row under 「写好了」`);
    await open(page, ctx, { size });
    const a = await page.evaluate(geometry);
    assert.deepEqual([a.toolsShown, a.toolsVis], ['true', 'visible'], `${tag}: the tools are shown with no ink`);
    assert.deepEqual([a.undo.disabled, a.clear.disabled], [true, true], `${tag}: both disabled with no ink`);
    assert.deepEqual([a.undo.color, a.clear.color], [tokenRgb('light', 'ink4'), tokenRgb('light', 'ink4')], `${tag}: ink4`);
    assert.ok(a.undo.bottom <= a.headBottom + 0.5 && a.clear.bottom <= a.headBottom + 0.5, `${tag}: undo / clear are in the header row`);
    assert.ok(a.clear.right <= a.progressLeft + 4.5 && a.undo.left < a.clear.left, `${tag}: undo then clear, then the counter (clear right ${a.clear.right.toFixed(0)} ≤ counter left ${a.progressLeft.toFixed(0)})`);
    const items = await footItems(page);
    const paperItem = items.find(i => i.testid === 'write-to-paper');
    assert.ok(paperItem && a.toPaper, `${tag}: 在纸上写 is a visible text button in the row under 「写好了」 (the standing entry, X1)`);
    assert.equal(paperItem.text, '在纸上写');
    assert.deepEqual(items.map(i => i.testid).slice(0, 3), ['write-hint', 'write-show-answer', 'write-to-paper'], `${tag}: row order 提示 / 看答案 / 在纸上写`);
    assert.ok(near(a.below.height, 40, 1), `${tag}: the row under the grid is still 40 high (${a.below.height})`);

    step(`${tag}: after the first stroke the icons do not move, they turn live (ink2); 在纸上写 is still in the row; so after 清空`);
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(250);
    const b = await page.evaluate(geometry);
    assert.ok(near(b.undo.left, a.undo.left, 0.5) && near(b.undo.top, a.undo.top, 0.5) && near(b.clear.left, a.clear.left, 0.5), `${tag}: undo / clear are exactly where they were`);
    assert.deepEqual([b.undo.disabled, b.clear.disabled], [false, false], `${tag}: live`);
    assert.deepEqual([b.undo.color, b.clear.color], [tokenRgb('light', 'ink2'), tokenRgb('light', 'ink2')], `${tag}: ink2`);
    assert.ok((await footItems(page)).some(i => i.testid === 'write-to-paper'), `${tag}: 在纸上写 stays once there is ink`);
    await page.click(topSel('write-clear'));
    await page.waitForTimeout(250);
    const c = await page.evaluate(geometry);
    assert.ok(near(c.undo.left, a.undo.left, 0.5) && near(c.clear.left, a.clear.left, 0.5), `${tag}: undo / clear still in place after 清空`);
    assert.ok((await footItems(page)).some(i => i.testid === 'write-to-paper'), `${tag}: 在纸上写 still there after 清空`);
  }

  step('first session, first character: with the one-time tip showing, 在纸上写 is still in the row (nothing yields to anything)');
  await open(page, ctx, { kind: 'first' });
  const f = await page.evaluate(geometry);
  assert.ok(f.tip, 'the first tip is shown');
  assert.ok((await footItems(page)).some(i => i.testid === 'write-to-paper'), 'and 在纸上写 is still there');
  assert.deepEqual([f.toolsShown, f.undo.disabled], ['true', true], 'the icons are in place regardless');

  step('screen reader on (shiziAccessibilityStatus): a visible 在纸上写 sits under the grid (in the text row, D55)');
  await open(page, ctx, { size: 'L' });
  await page.evaluate(() => window.shiziAccessibilityStatus({ voiceOver: true, switchControl: false }));
  await page.waitForTimeout(300);
  await drawStroke(page, HORIZONTAL); // 触发一次重画
  await page.waitForTimeout(300);
  const vo = await page.evaluate(geometry);
  assert.ok(vo.toPaper && vo.toPaper.top >= vo.grid.bottom - 1 && vo.toPaper.height >= 44 - 0.5, `visible 在纸上写 below the grid, ≥ 44 hit (${vo.toPaper && vo.toPaper.top} vs grid bottom ${vo.grid.bottom})`);
  await page.evaluate(() => window.shiziAccessibilityStatus({ voiceOver: false, switchControl: false }));

  step('choosing 在纸上写 switches this character to paper (with a result line showing it is also there — covered in 73-p1e8-paper)');
  await open(page, ctx, { size: 'L' });
  await tap(page, 'write-to-paper');
  await page.waitForSelector(topSel('write-paper'));
  assert.equal(await page.$(topSel('write-grid')), null, 'the paper cell replaced the writing grid');
  assert.equal(await page.$eval(topSel('write-tools'), el => el.dataset.shown), 'false', 'a paper character has no undo / clear');
}
