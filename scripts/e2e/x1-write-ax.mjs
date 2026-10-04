// R2-X1（D51 ⑦，P225；第二轮审查 A2-01 / A2-04 / A2-09 / A2-11、V2-06）：写字页 AX 专属版式。
//
// AX1 / AX3 / AX5 × 375×667（SE 3）/ 390×844 / 430×932（Pro Max）下，写字、看答案、判断三页：
//   - 书写格（判断页是两格）完整落在首屏：不被底栏盖住、页面正文不滚动、书写格边长 ≥ 220；
//   - 撤销 / 清空常驻页头右侧（28pt 图标、热区 ≥ 44）、「⋯」在底栏，都在首屏、都不与底栏 / 书写格相交；
//   - 底栏只有一行：「写好了」主按钮 + 「⋯」；「⋯」打开现有底部弹层，菜单里有 提示 / 看答案 / 跳过 / 在纸上写（picked 会话再多一个「结束这组」），选了就生效；
//   - 题面汉字随档放大（格边 = 52 × min(k, 1.6)），拼音与进度封顶 17pt；进度读屏名称是「第 n 个字，共 m 个」；
//   - 看答案页：主按钮「描一遍」、答案说明在格下说明位、答案字不被说明盖住。
// 测试浏览器没有安全区（状态栏 0、底栏下内边距 8）。新旧对照：旧实现下 AX5 的 375×667 写字页书写格有约 37% 在底栏下面、页面正文可滚动。

import {
  bootTestHost, drawStroke, HORIZONTAL, seedSession, setTextSize, topSel, waitNavIdle,
} from './helpers.mjs';

const CHARS = ['根', '据', '永', '和', '春'];
const LEVELS = [{ size: 'AX1', k: 1.6 }, { size: 'AX3', k: 2 }, { size: 'AX5', k: 2.4 }];

async function open(page, ctx, { view, size, slot = 'A', kind = 'daily', current, scheme = 'light' }) {
  await page.setViewportSize(view);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await setTextSize(page, size);
  const seeded = await seedSession(page, { slot, kind, chars: CHARS, cursor: 1, current });
  ctx.assert.ok(seeded.ok, `${view.width}×${view.height} ${size}: seeded`);
  await page.evaluate(async s => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('write', { slot: s });
  }, slot);
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  await page.waitForSelector(current ? topSel('write-answer-foot') : topSel('write-more'));
  await page.waitForTimeout(450);
  await page.mouse.move(1, 1);
}

/* eslint-disable no-undef */
function geometry() {
  const top = document.querySelector('.sz-layer[data-top="true"]');
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const q = id => top.querySelector(`[data-testid="${id}"]`);
  const body = top.querySelector('.sz-page__body');
  const cs = el => (el ? getComputedStyle(el) : null);
  const cell = top.querySelector('[data-testid="write-prompt-cell"][data-kind="blank"]');
  return {
    vw: document.documentElement.clientWidth,
    vh: window.innerHeight,
    scrollW: document.documentElement.scrollWidth,
    head: rect(top.querySelector('.sz-page__head')),
    body: rect(body),
    bodyScroll: [body.scrollHeight, body.clientHeight],
    foot: rect(top.querySelector('.sz-page__foot')),
    grid: rect(q('write-grid')),
    mine: rect(q('write-compare-mine')),
    ref: rect(q('write-compare-ref')),
    undo: rect(q('write-undo')),
    clear: rect(q('write-clear')),
    more: rect(q('write-more')),
    done: rect(q('write-done')),
    primary: rect(top.querySelector('.sz-page__foot .sz-btn--primary')),
    wrong: rect(q('write-judge-wrong')),
    correct: rect(q('write-judge-correct')),
    note: rect(q('write-note')),
    promptCell: rect(cell),
    pinyinFs: cs(q('write-prompt-py')) ? parseFloat(cs(q('write-prompt-py')).fontSize) : null,
    progressFs: parseFloat(cs(q('write-progress')).fontSize),
    progressLabel: q('write-progress').getAttribute('aria-label'),
    progressText: q('write-progress').textContent,
    ibtnSvg: q('write-undo') ? rect(q('write-undo').querySelector('svg')) : null,
    undoShown: q('write-tools') ? q('write-tools').dataset.shown : null,
  };
}
/* eslint-enable no-undef */

const overlaps = (a, b) => a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

export async function runWriteAx(page, ctx, views) {
  const { assert, step } = ctx;

  for (const view of views) {
    for (const { size, k } of LEVELS) {
      const tag = `${view.width}×${view.height} ${size}`;
      // ---------------------------------------------------------------- 写字页（回忆）
      step(`${tag} write: the whole grid, undo / clear and 「⋯」 are on the first screen; nothing scrolls; the foot is one row`);
      await open(page, ctx, { view, size });
      const g = await page.evaluate(geometry);
      assert.ok(g.grid.width >= 220 - 0.5 && near(g.grid.width, g.grid.height, 0.5), `${tag}: grid ${g.grid.width.toFixed(0)}×${g.grid.height.toFixed(0)} ≥ 220, square`);
      assert.ok(g.grid.left >= 0 && g.grid.right <= g.vw && g.grid.top >= g.head.bottom - 0.5, `${tag}: the grid is inside the page, under the header`);
      assert.ok(g.grid.bottom <= g.foot.top + 0.5, `${tag}: the grid ends above the foot (${g.grid.bottom.toFixed(0)} ≤ ${g.foot.top.toFixed(0)}) — nothing is covered`);
      assert.ok(g.bodyScroll[0] <= g.bodyScroll[1] + 1, `${tag}: the page body does not scroll (${g.bodyScroll[0]} ≤ ${g.bodyScroll[1]})`);
      assert.ok(g.scrollW <= g.vw, `${tag}: no horizontal overflow`);
      for (const [name, r] of [['undo', g.undo], ['clear', g.clear], ['more', g.more], ['done', g.done]]) {
        assert.ok(r && r.top >= -0.5 && r.bottom <= g.vh + 0.5 && r.left >= -0.5 && r.right <= g.vw + 0.5, `${tag}: ${name} is on the first screen`);
        assert.ok(!overlaps(r, g.grid), `${tag}: ${name} does not touch the grid`);
      }
      assert.ok(g.undo.bottom <= g.head.bottom + 0.5 && g.clear.bottom <= g.head.bottom + 0.5, `${tag}: undo and clear sit in the header (right side), above the grid`);
      assert.ok(g.undo.width >= 44 - 0.5 && g.undo.height >= 44 - 0.5 && g.clear.width >= 44 - 0.5, `${tag}: undo / clear hit areas ≥ 44`);
      assert.ok(near(g.ibtnSvg.width, 28, 0.5), `${tag}: the icons are 28pt (${g.ibtnSvg.width})`);
      assert.equal(g.undoShown, 'true', `${tag}: undo / clear are in place before the first stroke (always there)`);
      assert.ok(g.undo.left > g.vw / 2 && g.clear.left > g.vw / 2, `${tag}: undo and clear are on the right of the header`);
      assert.ok(!overlaps(g.done, g.more) && g.more.left >= g.done.right - 0.5, `${tag}: 「写好了」 then 「⋯」 on one row (done ${g.done.left.toFixed(0)}–${g.done.right.toFixed(0)}, more ${g.more.left.toFixed(0)}–${g.more.right.toFixed(0)})`);
      assert.ok(near(g.done.top, g.more.top, 1.5) || near(g.done.height, g.more.height, 1.5), `${tag}: the foot is one row`);
      const links = await page.evaluate(() => ['write-hint', 'write-show-answer', 'write-skip', 'write-to-paper'].filter(id => document.querySelector(`.sz-layer[data-top="true"] [data-testid="${id}"]`)));
      assert.deepEqual(links, [], `${tag}: hint / answer / skip / to-paper are not on the page, they are in the menu`);
      // 题面：汉字随档放大，拼音与进度封顶 17pt
      assert.ok(near(g.promptCell.width, Math.round(52 * Math.min(k, 1.6) * 10) / 10, 1.2), `${tag}: prompt cell ${g.promptCell.width.toFixed(1)} = 52 × min(${k}, 1.6)`);
      assert.equal(g.pinyinFs, 17, `${tag}: pinyin is capped at 17pt (it was ${size === 'AX5' ? 49 : 'the Subhead step'} before)`);
      assert.equal(g.progressFs, 17, `${tag}: the counter is capped at 17pt`);
      assert.equal(g.progressText, '2 / 5');
      assert.equal(g.progressLabel, '第 2 个字，共 5 个', `${tag}: the counter reads 「第 2 个字，共 5 个」 for screen readers`);

      // 画一笔后：撤销 / 清空可点、位置不动、格子不变
      await drawStroke(page, HORIZONTAL);
      await page.waitForTimeout(200);
      const g2 = await page.evaluate(geometry);
      assert.ok(near(g2.grid.top, g.grid.top, 0.5) && near(g2.grid.width, g.grid.width, 0.5), `${tag}: writing a stroke does not move or resize the grid`);
      assert.ok(near(g2.undo.left, g.undo.left, 0.5) && near(g2.clear.left, g.clear.left, 0.5), `${tag}: undo / clear stay where they were`);
      assert.equal(await page.$eval(topSel('write-undo'), el => el.disabled), false, `${tag}: undo is live after a stroke`);

      // ---------------------------------------------------------------- 「⋯」菜单
      if (size === 'AX3' || (size === 'AX5' && view.width === 375)) {
        step(`${tag} menu: 「⋯」 opens the sheet with 提示 / 看答案 / 跳过 / 在纸上写 (stacked); choosing 提示 closes it and shows the hint`);
        await open(page, ctx, { view, size, slot: 'B', kind: 'picked' });
        await page.click(topSel('write-more'));
        await page.waitForSelector(`[data-testid="write-ax-menu"]`);
        await waitNavIdle(page);
        const menu = await page.evaluate(() => {
          const panel = document.querySelector('[data-testid="write-ax-menu"]');
          const items = [...panel.querySelectorAll('[data-testid^="write-"]')].filter(e => e.closest('.sz-axmenu'));
          return { ids: items.map(e => e.dataset.testid), texts: items.map(e => e.textContent.trim()), tops: items.map(e => e.getBoundingClientRect().top), panelBottom: panel.getBoundingClientRect().bottom, vh: window.innerHeight, role: panel.getAttribute('role') };
        });
        assert.deepEqual(menu.ids, ['write-hint', 'write-show-answer', 'write-skip', 'write-to-paper', 'write-end'], `${tag}: menu items (picked session adds 结束这组)`);
        assert.deepEqual(menu.texts, ['提示', '看答案', '跳过', '在纸上写', '结束这组']);
        assert.ok(menu.tops.every((v, i) => i === 0 || v > menu.tops[i - 1] + 20), `${tag}: items are stacked vertically`);
        assert.equal(menu.role, 'dialog', `${tag}: the menu is the existing sheet (role=dialog)`);
        await page.click(topSel('write-hint'));
        await waitNavIdle(page);
        await page.waitForSelector(`${topSel('write-glyph-layer')} [data-testid="write-hint-fill"]`, { timeout: 5000 });
        assert.equal(await page.$('[data-testid="write-ax-menu"]'), null, `${tag}: the menu closed after choosing`);
      }

      // ---------------------------------------------------------------- 看答案页
      step(`${tag} answer: primary 「描一遍」 + 「⋯」, the note is in the note slot, the answer glyph (the grid) is whole and uncovered`);
      await open(page, ctx, { view, size, current: { phase: 'answer', answerSeen: true } });
      const a = await page.evaluate(geometry);
      assert.ok(a.grid.width >= 220 - 0.5 && a.grid.bottom <= a.foot.top + 0.5 && a.grid.top >= a.head.bottom - 0.5, `${tag}: the answer grid ${a.grid.width.toFixed(0)}pt is whole and above the foot`);
      assert.ok(a.bodyScroll[0] <= a.bodyScroll[1] + 1, `${tag}: no scrolling on the answer page`);
      assert.ok(a.note && a.note.top >= a.grid.bottom - 0.5 && !overlaps(a.note, a.grid), `${tag}: the note sits under the grid, not over the answer glyph`);
      assert.ok(a.note.bottom <= a.foot.top + 0.5, `${tag}: the note ends above the foot`);
      assert.ok(a.more && a.more.bottom <= a.vh + 0.5 && a.primary && a.primary.bottom <= a.vh + 0.5, `${tag}: foot buttons on the first screen`);
      const ans = await page.evaluate(() => ({
        primary: document.querySelector('.sz-layer[data-top="true"] .sz-page__foot .sz-btn--primary').textContent.trim(),
        id: document.querySelector('.sz-layer[data-top="true"] .sz-page__foot .sz-btn--primary').dataset.testid,
        dup: document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="write-answer-next"]').length,
      }));
      assert.deepEqual([ans.primary, ans.id], ['描一遍', 'write-answer-trace'], `${tag}: the primary button is 描一遍`);
      assert.equal(ans.dup, 0, `${tag}: 「下一个」 is not shown twice (A2-11) — it is in the menu`);
      await page.click(topSel('write-more'));
      await page.waitForSelector(`[data-testid="write-ax-menu"]`);
      await waitNavIdle(page);
      const items = await page.$$eval('[data-testid="write-ax-menu"] .sz-axmenu__item', els => els.map(e => e.dataset.testid));
      assert.deepEqual(items, ['write-answer-self', 'write-answer-next'], `${tag}: answer menu = 自己写 / 下一个`);
      await page.click(topSel('write-answer-self'));
      await waitNavIdle(page);
      await page.waitForSelector(`${topSel('write-screen')} .sz-write[data-phase="retrace"]`, { timeout: 5000 });
      assert.equal(await page.$('[data-testid="write-ax-menu"]'), null, `${tag}: menu closed; the page moved to 自己写`);

      // ---------------------------------------------------------------- 判断页
      step(`${tag} judge: both cells and both buttons are on the first screen, no scrolling`);
      await open(page, ctx, { view, size });
      await drawStroke(page, HORIZONTAL);
      await page.waitForTimeout(150);
      await page.click(topSel('write-done'));
      await page.waitForSelector(topSel('write-compare'));
      await page.waitForFunction(() => {
        const r = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-compare-ref"]');
        return !!r && r.dataset.state === 'ready';
      });
      await waitNavIdle(page, { settleMs: 700 });
      const j = await page.evaluate(geometry);
      for (const [name, r] of [['mine', j.mine], ['ref', j.ref]]) {
        assert.ok(r.top >= j.body.top - 0.5 && r.bottom <= j.body.bottom + 0.5 && r.left >= 0 && r.right <= j.vw, `${tag}: ${name} cell is whole inside the main area`);
        assert.ok(r.width >= 120 - 0.5, `${tag}: ${name} cell ${r.width.toFixed(0)}pt`);
      }
      assert.ok(j.bodyScroll[0] <= j.bodyScroll[1] + 1, `${tag}: the judge page does not scroll`);
      for (const [name, r] of [['wrong', j.wrong], ['correct', j.correct]]) {
        assert.ok(r.bottom <= j.vh + 0.5 && r.top >= j.foot.top - 0.5, `${tag}: ${name} button is on the first screen, in the foot`);
      }
      assert.equal(j.undoShown, 'false', `${tag}: undo / clear are not shown on the judge page`);
    }
  }
}
