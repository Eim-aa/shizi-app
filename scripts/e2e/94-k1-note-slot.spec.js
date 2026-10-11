// R3-K1（ADA A3-01 后半，P241）：AX 档格下说明位在首屏可见，不被底栏盖住。
// 说明位按量到的实际高度算进可用高度（格子缩，不低于 220）。R4-F1（P260 / P261）：底栏回到「写好了」+ 文字行，「⋯」菜单取消，说明始终在格下；
// 文字行折行放不下时先收起「在纸上写」。
// 375×667（SE 3）× AX3 / AX5：
//   - 读屏开启时第一次进写字页：格下「改为在纸上写 / 不用」建议整块可见（在格子之下、底栏之上）；
//   - 看答案页：后果说明整块可见；
//   - 判断「写错了」后的下一个字：结果行「修改」可见。
// 新旧对照：旧实现说明位固定 56，读屏建议（一句话 + 两个 44 高的按钮）下半截落到底栏下面。
import { bootTestHost, drawStroke, HORIZONTAL, seedSession, setTextSize, topSel, waitNavIdle } from './helpers.mjs';

const CHARS = ['根', '据', '永', '和', '春'];

async function open(page, ctx, { size, current, cursor = 1, voiceOver = false }) {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await setTextSize(page, size);
  if (voiceOver) await page.evaluate(() => window.shiziAccessibilityStatus({ voiceOver: true, switchControl: false }));
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor, current });
  ctx.assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('write', { slot: 'A' });
  });
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  await page.waitForTimeout(400);
}

/* eslint-disable no-undef */
function geometry() {
  const top = document.querySelector('.sz-layer[data-top="true"]');
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  const note = top.querySelector('[data-testid="write-note"]');
  const body = top.querySelector('.sz-page__body');
  return {
    note: rect(note),
    noteScroll: note ? [note.scrollHeight, note.clientHeight] : null,
    grid: rect(top.querySelector('[data-testid="write-grid"]')),
    foot: rect(top.querySelector('.sz-page__foot')),
    bodyScroll: [body.scrollHeight, body.clientHeight],
    menu: !!document.querySelector('[data-testid="write-more"], [data-testid="write-ax-menu"], [data-testid="write-menu-note"]'),
  };
}
/* eslint-enable no-undef */

async function noteVisible(page, ctx, tag, inside) {
  const { assert } = ctx;
  const g = await page.evaluate(geometry);
  assert.ok(g.grid.width >= 220 - 0.5 && Math.abs(g.grid.width - g.grid.height) <= 0.5, `${tag}: grid ${g.grid.width.toFixed(0)}² ≥ 220`);
  assert.ok(g.bodyScroll[0] <= g.bodyScroll[1] + 1, `${tag}: no scrolling (${g.bodyScroll})`);
  assert.ok(g.note.top >= g.grid.bottom - 0.5 && g.note.bottom <= g.foot.top + 0.5, `${tag}: note ${g.note.top.toFixed(0)}–${g.note.bottom.toFixed(0)} is under the grid (${g.grid.bottom.toFixed(0)}) and above the foot (${g.foot.top.toFixed(0)})`);
  assert.ok(g.noteScroll[0] <= g.noteScroll[1] + 1, `${tag}: note content is not clipped`);
  if (inside) {
    const el = await page.$(`${topSel('write-note')} ${inside}`);
    assert.ok(el, `${tag}: ${inside} is in the note slot`);
    const r = await el.boundingBox();
    assert.ok(r.y + r.height <= g.foot.top + 0.5, `${tag}: ${inside} ends above the foot`);
  }
  assert.equal(g.menu, false, `${tag}: there is no 「⋯」 menu to move the note into any more (R4-F1)`);
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const size of ['AX3', 'AX5']) {
    const tag = `375×667 ${size}`;
    step(`${tag}: screen-reader suggestion (text + 改为在纸上写 / 不用) is whole above the foot`);
    await open(page, ctx, { size, voiceOver: true });
    await page.waitForSelector(topSel('write-paper-suggest'));
    await noteVisible(page, ctx, tag, '[data-testid="write-paper-suggest-yes"]');

    step(`${tag}: the answer note is whole above the foot`);
    await open(page, ctx, { size, current: { phase: 'answer', answerSeen: true } });
    await noteVisible(page, ctx, tag, '');

    step(`${tag}: after judging 「写错了」, the result row with 修改 is visible on the next card`);
    await open(page, ctx, { size, cursor: 0 });
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(150);
    await page.click(topSel('write-done'));
    await page.waitForSelector(`${topSel('write-compare-ref')}[data-state="ready"]`);
    await waitNavIdle(page, { settleMs: 700 });
    await page.click(topSel('write-judge-wrong'));
    await page.waitForSelector('.sz-layer[data-top="true"] .sz-write[data-cursor="1"][data-phase="recall"]');
    await waitNavIdle(page, { settleMs: 700 });
    await noteVisible(page, ctx, tag, '[data-testid="write-line-slot"] button');
  }
}
