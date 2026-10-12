// R4-F1（D55，P260）：看答案 / 描一遍 / 自己写阶段的次要操作（自己写、下一个、再描一遍）是主按钮下文字行里直接可见的按钮，不进菜单；
// 375×667 / 390×844 / 430×932 × L / XXXL / AX3 / AX5：都在首屏、不与书写格相交、AX 档书写格 ≥ 220 且不滚动。（回忆阶段与一次点击见 99-f1-foot.spec.js）

import {
  bootTestHost, seedSession, setTextSize, topSel, waitNavIdle,
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

export default async function f1FootStages(page, ctx) {
  const { assert, step } = ctx;
  for (const view of VIEWS) {
    for (const size of SIZES) {
      const tag = `${view.width}×${view.height} ${size}`;
      const ax = size.startsWith('AX');
      step(`${tag} answer / trace / retrace: 自己写 / 下一个 / 再描一遍 are direct buttons under the main button, clear of the grid`);
      for (const [phase, ids] of [['answer', ['write-answer-trace', 'write-answer-self', 'write-answer-next']], ['trace', ['write-trace-done', 'write-answer-next']], ['retrace', ['write-answer-next', 'write-retrace-trace']]]) {
        await open(page, ctx, { view, size, current: { phase, answerSeen: true } });
        const a = await page.evaluate(geometry, ids);
        assert.ok(!a.more && !a.menu, `${tag} ${phase}: no menu`);
        ids.forEach((id, i) => {
          const r = a.items[id];
          assert.ok(r && r.tag === 'BUTTON', `${tag} ${phase}: ${id} is a button on the page`);
          assert.ok(r.bottom <= a.vh + 0.5 && r.right <= a.vw + 0.5 && r.left >= -0.5, `${tag} ${phase}: ${id} on the first screen`);
          assert.ok(i === 0 || r.hitH >= 44 - 0.5, `${tag} ${phase}: ${id} hit ≥ 44`);
          assert.ok(!overlaps(r, a.grid), `${tag} ${phase}: ${id} clear of the grid`);
        });
        assert.ok(a.grid.bottom <= a.foot.top + 0.5, `${tag} ${phase}: the grid ends above the foot`);
        if (ax) assert.ok(a.grid.width >= (view.height < 700 ? 180 : 220) - 0.5 && a.bodyScroll[0] <= a.bodyScroll[1] + 1, `${tag} ${phase}: AX grid ≥ 220, no scroll`);
      }
    }
  }
}
