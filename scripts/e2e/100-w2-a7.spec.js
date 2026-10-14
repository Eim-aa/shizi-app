// W2（D57，P280 / P281）：写字页求助按钮方案 A7（设计稿「写字页与我的.html」A7）。
//   · 「提示」「看答案」是「写好了」正上方 20pt 的一行凹面按钮（高 48，AX 档 56；书写格放不下 220 的最矮屏 AX 档收紧为 间距 6 / 行高 48），等宽、间隔 12、热区 ≥ 44；
//   · 撤销 / 清空是书写格正下方一行（离格 4、高 44），撤销贴格左沿、清空贴格右沿，图标加文字；
//   · 「跳过」在页头右上，进度「n / 总数」在页头中间；
//   · 三尺寸（375×667 / 390×844 / 430×932）× L / XXXL / AX3 / AX5：全部在首屏、与书写格 / 主按钮 / 彼此不相交、一次点击生效；AX 档书写格 ≥ 220、页面不滚动；
//   · 其它阶段（描一遍 / 凭记忆写）的次要路径在同一位置（主按钮正上方）：下一个 / 再描一遍；picked 会话的「结束这组」在页头右上、跳过左边。
// 测试浏览器没有安全区。

import {
  bootTestHost, seedSession, setTextSize, topSel, waitNavIdle, writeSnapshot, tap, drawStroke, HORIZONTAL, VERTICAL,
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
    const after = parseFloat(getComputedStyle(el, '::after').height) || 0;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, hitH: Math.max(r.height, after), tag: el.tagName };
  };
  const body = top.querySelector('.sz-page__body');
  const out = {
    vw: document.documentElement.clientWidth, vh: window.innerHeight, grid: rect(top.querySelector('[data-testid="write-grid"]')),
    foot: rect(top.querySelector('.sz-page__foot')), head: rect(top.querySelector('.sz-page__head')), bodyScroll: [body.scrollHeight, body.clientHeight],
    scrollW: document.documentElement.scrollWidth, items: {},
    more: !!document.querySelector('[data-testid="write-more"]') || !!document.querySelector('[data-testid="write-ax-menu"]'),
    footCompact: !!top.querySelector('.sz-write__foot[data-compact="true"]'),
  };
  for (const id of ids) out.items[id] = rect(top.querySelector(`[data-testid="${id}"]`));
  return out;
}
/* eslint-enable no-undef */

const overlaps = (a, b) => a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

export default async function w2A7(page, ctx) {
  const { assert, step } = ctx;

  for (const view of VIEWS) {
    for (const size of SIZES) {
      const tag = `${view.width}×${view.height} ${size}`;
      const ax = size.startsWith('AX');
      step(`${tag} recall: A7 layout — 提示 / 看答案 right above 「写好了」, 撤销 / 清空 under the grid, 跳过 top right, progress in the middle`);
      await open(page, ctx, { view, size });
      const g = await page.evaluate(geometry, ['write-done', 'write-hint', 'write-show-answer', 'write-skip', 'write-undo', 'write-clear', 'write-progress', 'write-to-paper']);
      const it = g.items;
      assert.ok(!g.more, `${tag}: no 「⋯」 menu`);
      assert.ok(!it['write-to-paper'], `${tag}: 在纸上写 is not on the write page (D56 / P275)`);
      for (const id of ['write-hint', 'write-show-answer', 'write-skip', 'write-undo', 'write-clear']) {
        const r = it[id];
        assert.ok(r && r.tag === 'BUTTON', `${tag}: ${id} is a button`);
        assert.ok(r.top >= -0.5 && r.bottom <= g.vh + 0.5 && r.left >= -0.5 && r.right <= g.vw + 0.5, `${tag}: ${id} is on the first screen`);
        assert.ok(r.hitH >= 44 - 0.5, `${tag}: ${id} hit height ${r.hitH.toFixed(1)} ≥ 44 (D55)`);
        assert.ok(!overlaps(r, g.grid) && !overlaps(r, it['write-done']), `${tag}: ${id} does not touch the grid or the main button`);
      }
      // 求助行：主按钮正上方（间距 20；收紧的 AX 档 8）、等宽、间隔 12、高 48 / 56（收紧 52）
      const h = it['write-hint'];
      const a = it['write-show-answer'];
      const d = it['write-done'];
      const gap = d.top - h.bottom;
      assert.ok(near(h.bottom, a.bottom) && near(h.top, a.top), `${tag}: 提示 and 看答案 share a row`);
      assert.ok(near(gap, 20) || (g.footCompact && near(gap, 6)), `${tag}: help row ${gap.toFixed(1)}pt above 「写好了」 (20; 6 when the AX foot is compacted)`);
      const wantH = ax ? (g.footCompact ? 48 : 56) : 48;
      assert.ok(near(h.height, wantH) && near(a.height, wantH), `${tag}: help buttons ${h.height.toFixed(1)}pt high (${wantH})`);
      assert.ok(near(h.width, a.width) && near(a.left - h.right, 12), `${tag}: equal widths (${h.width.toFixed(1)} / ${a.width.toFixed(1)}), gap 12 (${(a.left - h.right).toFixed(1)})`);
      assert.ok(near(h.left, 20, 1.5) && near(a.right, g.vw - 20, 1.5), `${tag}: the row spans the 20pt page margins`);
      // 格下工具行：离格 4、撤销贴格左沿、清空贴格右沿
      const u = it['write-undo'];
      const c = it['write-clear'];
      const toolGap = g.footCompact ? 0 : 4; // 书写格放不下 220 时（data-tight）工具行贴格
      assert.ok(near(u.top, g.grid.bottom + toolGap, 1) && near(c.top, g.grid.bottom + toolGap, 1), `${tag}: 撤销 / 清空 start ${toolGap}pt under the grid (${(u.top - g.grid.bottom).toFixed(1)})`);
      assert.ok(near(u.height, 44, 1) && near(c.height, 44, 1), `${tag}: tools row 44 high`);
      assert.ok(near(u.left, g.grid.left, 6) && near(c.right, g.grid.right, 6), `${tag}: 撤销 at the grid's left edge, 清空 at its right edge`);
      assert.ok(u.right < c.left, `${tag}: 撤销 left of 清空`);
      // 页头：跳过右上、进度中间
      const sk = it['write-skip'];
      const pr = it['write-progress'];
      assert.ok(sk.bottom <= g.head.bottom + 0.5 && sk.right >= g.vw - 20 - 8, `${tag}: 跳过 sits in the page head, right end (${sk.right.toFixed(1)})`);
      assert.ok(pr.bottom <= g.head.bottom + 0.5 && Math.abs((pr.left + pr.right) / 2 - g.vw / 2) <= 30, `${tag}: progress in the middle of the head (${((pr.left + pr.right) / 2).toFixed(1)} of ${g.vw})`);
      assert.ok(!overlaps(sk, pr), `${tag}: 跳过 and the progress do not overlap`);
      assert.ok(g.grid.bottom <= u.top + 0.5 && u.bottom <= h.top + 0.5, `${tag}: grid → tools row → help row → main button, top to bottom`);
      assert.ok(g.scrollW <= g.vw, `${tag}: no horizontal overflow`);
      if (ax) {
        assert.ok(g.grid.width >= (page.viewportSize().height < 700 ? 180 : 220) - 0.5, `${tag}: AX grid ${g.grid.width.toFixed(0)} ≥ 220 (SE ≥ 180, P299)`);
        assert.ok(g.bodyScroll[0] <= g.bodyScroll[1] + 1, `${tag}: AX page does not scroll (${g.bodyScroll})`);
      }
    }
  }

  // ---------------------------------------------------------------- 一次点击即生效
  const view = VIEWS[1];
  step('one tap: 提示 shows the hint');
  await open(page, ctx, { view, size: 'L' });
  await page.waitForFunction(() => { const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-hint"]'); return b && !b.disabled; }, null, { timeout: 15000 });
  await page.click(topSel('write-hint'));
  await page.waitForSelector(`${topSel('write-glyph-layer')} [data-testid="write-hint-fill"]`, { timeout: 5000 });

  step('one tap: 看答案 goes straight into 描一遍 (D64 ②)');
  await open(page, ctx, { view, size: 'L' });
  await page.click(topSel('write-show-answer'));
  await page.waitForSelector('.sz-layer[data-top="true"] .sz-write[data-phase="trace"]', { timeout: 5000 });

  step('one tap: 跳过 (top right) skips the character');
  await open(page, ctx, { view, size: 'L' });
  const before = (await writeSnapshot(page)).cursor;
  await page.click(topSel('write-skip'));
  await page.waitForFunction(c => Number(document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor) === c + 1, before, { timeout: 5000 });
  await page.waitForSelector('[data-testid="write-skip-undo"]', { timeout: 5000 });

  step('one tap: 撤销 / 清空 (under the grid) act on the ink');
  await open(page, ctx, { view, size: 'L' });
  await drawStroke(page, HORIZONTAL);
  await drawStroke(page, VERTICAL);
  assert.equal((await writeSnapshot(page)).strokes, 2, 'two strokes written');
  await page.click(topSel('write-undo'));
  await page.waitForFunction(() => document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="write-grid-ink"]').length >= 0);
  assert.equal((await writeSnapshot(page)).strokes, 1, '撤销 removes one stroke in one tap');
  await page.click(topSel('write-clear'));
  assert.equal((await writeSnapshot(page)).strokes, 0, '清空 clears the grid in one tap');

  step('AX5 on the smallest phone: one tap 看答案 works from the help row');
  await open(page, ctx, { view: VIEWS[0], size: 'AX5' });
  await tap(page, 'write-show-answer');
  await page.waitForSelector('.sz-layer[data-top="true"] .sz-write[data-phase="trace"]', { timeout: 5000 });

  // ---------------------------------------------------------------- 其它阶段：同一位置换内容
  const stageCase = async (name, current, ids, primary, size = 'L') => {
    step(`${name} (${size}): ${ids.join(' / ')} in the help row, ${primary} below it`);
    await open(page, ctx, { view, size, current });
    const s = await page.evaluate(geometry, [...ids, primary]);
    const p = s.items[primary];
    for (const id of ids) {
      const r = s.items[id];
      assert.ok(r && r.tag === 'BUTTON', `${name}: ${id} is a button`);
      assert.ok(near(p.top - r.bottom, 20), `${name}: ${id} ${(p.top - r.bottom).toFixed(1)}pt above the main button (20)`);
      assert.ok(r.hitH >= 44 - 0.5 && near(r.height, size.startsWith('AX') ? 56 : 48), `${name}: ${id} ${r.height.toFixed(1)}pt high, hit ≥ 44`);
    }
    if (ids.length === 1) assert.ok(near(s.items[ids[0]].width, s.vw - 40, 1.5), `${name}: a single button takes the whole row (${s.items[ids[0]].width.toFixed(1)})`);
    return s;
  };
  await stageCase('trace', { phase: 'trace', answerSeen: true }, ['write-answer-next'], 'write-trace-done');
  await stageCase('retrace', { phase: 'retrace', answerSeen: true }, ['write-retrace-trace'], 'write-answer-next');
  await stageCase('trace AX5', { phase: 'trace', answerSeen: true }, ['write-answer-next'], 'write-trace-done', 'AX5');

  step('picked session: 结束这组 is in the page head, left of 跳过');
  await open(page, ctx, { view, size: 'L', kind: 'picked', slot: 'B' });
  const pk = await page.evaluate(geometry, ['write-end', 'write-skip', 'write-progress']);
  assert.ok(pk.items['write-end'] && pk.items['write-end'].right <= pk.items['write-skip'].left + 8.5, '结束这组 sits left of 跳过');
  assert.ok(near(pk.items['write-end'].top, pk.items['write-skip'].top, 4) && pk.items['write-end'].bottom <= pk.head.bottom + 0.5, 'both in the page head, same row');
  assert.ok(!overlaps(pk.items['write-progress'], pk.items['write-end']), 'the progress does not collide with 结束这组');
}
