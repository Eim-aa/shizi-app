// R2-X1（D51 ⑦，P226；第二轮审查 I2-06）→ R3-C3W（D53 ②，P258）→ W2（A7，D57，P280）：写字页的控件位置稳定。
//
//   - 撤销 / 清空常驻书写格正下方一行（A7 起不在页头）：没落笔时也在、ink4 且不可点；落第一笔后位置一个像素都不动，只是变成 ink2 可点（交接 §13.1「无墨 ink4 且不可点」）。
//   - 「在纸上写」不在写字页（D56，P275：移到设置 › 写字方式）：文字行 / 格下说明位在任何阶段、有墨无墨、清空后、首练提示在场、读屏开启时都没有它；
//     原来 X1 定下的「常驻入口」被这条决定取代。读屏开启时的建议（指向设置）见 94-k1-note-slot；偏好纸上时写字页直接是纸上写见 73-p1e8-paper。
//   - 版式几何：格下 = 撤销 / 清空行 48 + 说明位 40 = 88 高、和书写格同宽。
// L 档与 XXXL（紧凑排布）各一遍，浅色。

import {
  bootTestHost, drawStroke, HORIZONTAL, footItems, seedSession, setTextSize, tokenRgb, topSel, waitNavIdle,
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
    step(`${tag}: before the first stroke undo / clear are already under the grid (ink4, not tappable); no 在纸上写 anywhere (D56)`);
    await open(page, ctx, { size });
    const a = await page.evaluate(geometry);
    assert.deepEqual([a.toolsShown, a.toolsVis], ['true', 'visible'], `${tag}: the tools are shown with no ink`);
    assert.deepEqual([a.undo.disabled, a.clear.disabled], [true, true], `${tag}: both disabled with no ink`);
    assert.deepEqual([a.undo.color, a.clear.color], [tokenRgb('light', 'ink4'), tokenRgb('light', 'ink4')], `${tag}: ink4`);
    assert.ok(near(a.undo.top, a.grid.bottom + 4, 1) && near(a.clear.top, a.grid.bottom + 4, 1), `${tag}: undo / clear sit in the row 4pt under the grid (A7)`);
    assert.ok(a.undo.left < a.clear.left && a.clear.right <= a.grid.right + 6, `${tag}: undo on the left, clear on the right, inside the grid's width`);
    const items = await footItems(page);
    assert.equal(a.toPaper, null, `${tag}: no 在纸上写 on the write page`);
    assert.deepEqual(items.map(i => i.testid).slice(0, 2), ['write-hint', 'write-show-answer'], `${tag}: row order 提示 / 看答案`);
    assert.ok(!items.some(i => i.testid === 'write-to-paper'), `${tag}: the text row has no 在纸上写`);
    assert.ok(near(a.below.height, 88, 1), `${tag}: the area under the grid is 88 high: tools row 48 + note slot 40 (${a.below.height})`);

    step(`${tag}: after the first stroke the icons do not move, they turn live (ink2); still no 在纸上写; so after 清空`);
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(250);
    const b = await page.evaluate(geometry);
    assert.ok(near(b.undo.left, a.undo.left, 0.5) && near(b.undo.top, a.undo.top, 0.5) && near(b.clear.left, a.clear.left, 0.5), `${tag}: undo / clear are exactly where they were`);
    assert.deepEqual([b.undo.disabled, b.clear.disabled], [false, false], `${tag}: live`);
    assert.deepEqual([b.undo.color, b.clear.color], [tokenRgb('light', 'ink2'), tokenRgb('light', 'ink2')], `${tag}: ink2`);
    assert.ok(!(await footItems(page)).some(i => i.testid === 'write-to-paper'), `${tag}: no 在纸上写 once there is ink`);
    await page.click(topSel('write-clear'));
    await page.waitForTimeout(250);
    const c = await page.evaluate(geometry);
    assert.ok(near(c.undo.left, a.undo.left, 0.5) && near(c.clear.left, a.clear.left, 0.5), `${tag}: undo / clear still in place after 清空`);
    assert.ok(!(await footItems(page)).some(i => i.testid === 'write-to-paper'), `${tag}: no 在纸上写 after 清空`);
  }

  step('first session, first character: with the one-time tip showing there is still no 在纸上写');
  await open(page, ctx, { kind: 'first' });
  const f = await page.evaluate(geometry);
  assert.ok(f.tip, 'the first tip is shown');
  assert.ok(!(await footItems(page)).some(i => i.testid === 'write-to-paper'), 'no 在纸上写 in the row');
  assert.deepEqual([f.toolsShown, f.undo.disabled], ['true', true], 'the icons are in place regardless');

  step('screen reader on (shiziAccessibilityStatus): still no 在纸上写 on the write page (the suggestion points to settings: 94-k1-note-slot)');
  await open(page, ctx, { size: 'L' });
  await page.evaluate(() => window.shiziAccessibilityStatus({ voiceOver: true, switchControl: false }));
  await page.waitForTimeout(300);
  await drawStroke(page, HORIZONTAL); // 触发一次重画
  await page.waitForTimeout(300);
  const vo = await page.evaluate(geometry);
  assert.equal(vo.toPaper, null, 'no 在纸上写 under the grid either');
  assert.ok(!(await footItems(page)).some(i => i.testid === 'write-to-paper'), 'and none in the text row');
  await page.evaluate(() => window.shiziAccessibilityStatus({ voiceOver: false, switchControl: false }));
}
