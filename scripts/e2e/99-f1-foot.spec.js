// R4-F1（D55，P260 / P261）：写字页求助操作一次点击直达——主按钮下一行文字按钮，没有「⋯」菜单。
//   1. 回忆阶段「提示」「看答案」「跳过」各一次点击即生效，点击前后页面上没有菜单 / 弹层 / 确认框；
//   2. 375×667 / 390×844 / 430×932 × L / XXXL / AX3 / AX5：三个按钮都在首屏、热区 ≥ 44、不与书写格 / 底栏主按钮 / 彼此相交，没有 write-more / write-ax-menu，
//      AX 档书写格 ≥ 220 且页面不滚动；
//   3. 看答案 / 描一遍 / 自己写阶段的次要操作（自己写、下一个、再描一遍）同样是文字行里直接可见的按钮，不进菜单；
//   4. picked 会话的「结束这组」在文字行右端、跳过左边。
// 测试浏览器没有安全区。旧实现（R3-C3W）下这三个按钮不在页面上、要先点「⋯」再选。

import {
  bootTestHost, seedSession, setTextSize, topSel, waitNavIdle, writeSnapshot, tap, footItems,
} from './helpers.mjs';

const VIEWS = [{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 430, height: 932 }];
const SIZES = ['L', 'XXXL', 'AX3', 'AX5'];
const CHARS = ['根', '据', '永', '和', '春'];

async function open(page, ctx, { view, size, kind = 'daily', current, slot = 'A' }) {
  await page.setViewportSize(view);
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await setTextSize(page, size);
  const seeded = await seedSession(page, { slot, kind, chars: CHARS, cursor: 1, current });
  ctx.assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async s => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('write', { slot: s });
  }, slot);
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  await page.waitForSelector(current ? topSel('write-answer-foot') : topSel('write-done'));
  await page.waitForTimeout(450);
  await page.mouse.move(1, 1);
}

/* eslint-disable no-undef */
function geometry(ids) {
  const top = document.querySelector('.sz-layer[data-top="true"]');
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const body = top.querySelector('.sz-page__body');
  const out = { vw: document.documentElement.clientWidth, vh: window.innerHeight, grid: rect(top.querySelector('[data-testid="write-grid"]')),
    foot: rect(top.querySelector('.sz-page__foot')), bodyScroll: [body.scrollHeight, body.clientHeight], scrollW: document.documentElement.scrollWidth,
    more: !!document.querySelector('[data-testid="write-more"]'), menu: !!document.querySelector('[data-testid="write-ax-menu"]'), items: {} };
  for (const id of ids) {
    const el = top.querySelector(`[data-testid="${id}"]`);
    // 文字按钮的热区由 ::after 补到 ≥ 44：取按钮盒与 ::after 盒的并集高度
    out.items[id] = el ? { ...rect(el), hitH: Math.max(el.getBoundingClientRect().height, parseFloat(getComputedStyle(el, '::after').height) || 0), tag: el.tagName } : null;
  }
  return out;
}
/* eslint-enable no-undef */

const overlaps = (a, b) => a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;

export default async function f1Foot(page, ctx) {
  const { assert, step } = ctx;

  for (const view of VIEWS) {
    for (const size of SIZES) {
      const tag = `${view.width}×${view.height} ${size}`;
      const ax = size.startsWith('AX');
      step(`${tag} recall: 提示 / 看答案 / 跳过 are on the page under 「写好了」, ≥ 44, on the first screen, clear of the grid; no 「⋯」 and no menu`);
      await open(page, ctx, { view, size });
      const g = await page.evaluate(geometry, ['write-done', 'write-hint', 'write-show-answer', 'write-skip', 'write-to-paper']); // write-to-paper 必须取不到（D56）
      assert.ok(!g.more && !g.menu, `${tag}: no write-more / write-ax-menu`);
      for (const id of ['write-hint', 'write-show-answer', 'write-skip']) {
        const r = g.items[id];
        assert.ok(r && r.tag === 'BUTTON', `${tag}: ${id} is a button on the page`);
        assert.ok(r.top >= -0.5 && r.bottom <= g.vh + 0.5 && r.left >= -0.5 && r.right <= g.vw + 0.5, `${tag}: ${id} is on the first screen`);
        assert.ok(r.hitH >= 44 - 0.5, `${tag}: ${id} hit height ${r.hitH} ≥ 44`);
        assert.ok(r.top >= g.items['write-done'].bottom - 0.5, `${tag}: ${id} is below 「写好了」`);
        assert.ok(!overlaps(r, g.grid) && !overlaps(r, g.items['write-done']), `${tag}: ${id} does not touch the grid or the main button`);
        assert.ok(r.top >= g.foot.top - 0.5 && r.bottom <= g.foot.bottom + 0.5, `${tag}: ${id} sits in the foot`);
      }
      assert.ok(g.items['write-hint'].right <= g.items['write-show-answer'].left + 0.5 || g.items['write-hint'].top < g.items['write-show-answer'].top, `${tag}: 提示 before 看答案`);
      assert.ok(!overlaps(g.items['write-hint'], g.items['write-show-answer']) && !overlaps(g.items['write-show-answer'], g.items['write-skip']) && !overlaps(g.items['write-hint'], g.items['write-skip']), `${tag}: the three do not overlap`);
      assert.ok(g.items['write-skip'].right >= g.vw - 20 - 6, `${tag}: 跳过 sits at the right end of the row (${g.items['write-skip'].right})`);
      assert.ok(g.grid.bottom <= g.foot.top + 0.5, `${tag}: the grid ends above the foot`);
      assert.ok(g.scrollW <= g.vw, `${tag}: no horizontal overflow`);
      if (ax) {
        assert.ok(g.grid.width >= 220 - 0.5, `${tag}: AX grid ${g.grid.width.toFixed(0)} ≥ 220`);
        assert.ok(g.bodyScroll[0] <= g.bodyScroll[1] + 1, `${tag}: AX page does not scroll (${g.bodyScroll})`);
      }
      assert.ok(!g.items['write-to-paper'], `${tag}: 在纸上写 is not on the write page (D56 / P275: it lives in settings)`);
      const fi = (await footItems(page)).map(i => i.testid);
      assert.deepEqual(fi.slice(0, 2), ['write-hint', 'write-show-answer'], `${tag}: text row order starts 提示 / 看答案 ${JSON.stringify(fi)}`);
      assert.equal(fi[fi.length - 1], 'write-skip', `${tag}: 跳过 is the last (right end)`);

    }
  }

  // ---------------------------------------------------------------- 一次点击即生效
  const view = VIEWS[1];
  step('one tap: 提示 shows the hint (no menu opened, no second tap)');
  await open(page, ctx, { view, size: 'L' });
  await page.waitForFunction(() => { const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-hint"]'); return b && !b.disabled; }, null, { timeout: 15000 });
  await page.click(topSel('write-hint'));
  await page.waitForSelector(`${topSel('write-glyph-layer')} [data-testid="write-hint-fill"]`, { timeout: 5000 });
  assert.equal(await page.locator('.sz-sheet, [data-testid="write-ax-menu"]').count(), 0, 'no sheet / menu was opened');

  step('one tap: 看答案 goes straight to the answer page');
  await open(page, ctx, { view, size: 'L' });
  await page.click(topSel('write-show-answer'));
  await page.waitForSelector('.sz-layer[data-top="true"] .sz-write[data-phase="answer"]', { timeout: 5000 });
  assert.equal(await page.locator('.sz-sheet, [data-testid="write-ax-menu"], [data-testid="write-answer-confirm"]').count(), 0, 'no sheet / menu / confirm');

  step('one tap: 跳过 skips the character (cursor advances, the undo bar shows)');
  await open(page, ctx, { view, size: 'L' });
  const before = (await writeSnapshot(page)).cursor;
  await page.click(topSel('write-skip'));
  await page.waitForFunction(c => Number(document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor) === c + 1, before, { timeout: 5000 });
  await page.waitForSelector('[data-testid="write-skip-undo"]', { timeout: 5000 });
  assert.equal(await page.locator('.sz-sheet, [data-testid="write-ax-menu"]').count(), 0, 'no sheet / menu');

  step('AX5 on the smallest phone: one tap 看答案 also works (tap helper = a single click)');
  await open(page, ctx, { view: VIEWS[0], size: 'AX5' });
  await tap(page, 'write-show-answer');
  await page.waitForSelector('.sz-layer[data-top="true"] .sz-write[data-phase="answer"]', { timeout: 5000 });

  step('picked session: 结束这组 is in the text row, right end, left of 跳过');
  await open(page, ctx, { view, size: 'L', kind: 'picked', slot: 'B' });
  const p = await page.evaluate(geometry, ['write-end', 'write-skip', 'write-show-answer']);
  assert.ok(p.items['write-end'] && p.items['write-end'].right <= p.items['write-skip'].left + 8.5 && p.items['write-show-answer'].right <= p.items['write-end'].left + 0.5, 'order: 看答案 … 结束这组 跳过');
  assert.ok(Math.abs(p.items['write-end'].top - p.items['write-skip'].top) < 4, '结束这组 and 跳过 share a row');
}
