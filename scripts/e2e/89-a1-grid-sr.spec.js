// R2-A1（A2-06；03 P231）：书写格读屏名称带笔数，抬笔 / 撤销 / 清空后经 aria-live=polite 区域播报；提示与描一遍播报给出了哪几笔；
// 书写过程中（pointermove）不播报。
//   - 书写格（role=img）的 aria-label：没写「书写格」，写 n 笔后「书写格，已写 n 笔」，撤销 / 清空后回落；
//   - write-sr-status（role=status aria-live=polite aria-atomic）：抬笔后「已写 n 笔」，撤销「撤销了一笔，还有 n 笔」，撤销到空「撤销了一笔，格子是空的」，清空「已清空」；
//   - 一笔从落笔到抬笔之间播报区的文字节点一次都不变（MutationObserver 计数）：抬笔后恰好变一次；
//   - 点「提示」：播报「提示画出了第 a 到第 b 笔」（范围与 core/hints 给的一致）；
//   - 进入描一遍：播报「描一遍：参考字形画出了第 1 到第 n 笔」（n = 笔顺数据的笔数）；
//   - 换字后基线重置（新字不播旧字的笔数）。
//   浅 / 深各跑一遍（读屏文案与配色无关，深色只核对播报区没有可见内容）。
// 新旧对照：旧实现下书写格名称恒为「书写格」，页面里没有 write-sr-status。
import {
  bootTestHost, drawStroke, HORIZONTAL, openWrite, seedSession, topSel, VERTICAL, waitNavIdle,
} from './helpers.mjs';

/* eslint-disable no-undef */
const STATUS = topSel('write-sr-status');
const GRID = '.sz-layer[data-top="true"] [data-testid="write-grid"]';

const status = page => page.evaluate(sel => {
  const el = document.querySelector(sel);
  return el ? { text: el.textContent.replace(/​/g, ''), role: el.getAttribute('role'), live: el.getAttribute('aria-live'), atomic: el.getAttribute('aria-atomic') } : null;
}, STATUS);
const gridName = page => page.evaluate(sel => document.querySelector(sel).getAttribute('aria-label'), GRID);

async function open(page, ctx, chars, extra = {}, scheme = 'light') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars, cursor: 0, ...extra });
  ctx.assert.ok(seeded.ok, `seed [${chars.join('')}]`);
  await openWrite(page, { slot: 'A' });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const scheme of ['light', 'dark']) {
    step(`${scheme}: 书写格名称与抬笔 / 撤销 / 清空播报（大）`);
    await open(page, ctx, ['大', '聚'], {}, scheme);
    let s = await status(page);
    assert.ok(s, `${scheme}: status region exists`);
    assert.deepEqual([s.role, s.live, s.atomic], ['status', 'polite', 'true'], `${scheme}: polite live region`);
    assert.equal(s.text, '', `${scheme}: nothing announced on open`);
    assert.equal(await gridName(page), '书写格', `${scheme}: no strokes → plain name`);

    // 书写过程中不播报：观察播报区，落笔到抬笔之间一次变化都没有，抬笔后恰好一次
    await page.evaluate(sel => {
      const el = document.querySelector(sel);
      window.__srMut = 0;
      new MutationObserver(list => { window.__srMut += list.length; }).observe(el, { childList: true, characterData: true, subtree: true });
    }, STATUS);
    let during = -1;
    await drawStroke(page, HORIZONTAL, { steps: 30, beforeUp: async p => { during = await p.evaluate(() => window.__srMut); } });
    await page.waitForFunction(sel => document.querySelector(sel).textContent.includes('已写 1 笔'), STATUS);
    assert.equal(during, 0, `${scheme}: no live-region change between pen-down and pen-up (${during})`);
    assert.equal(await page.evaluate(() => window.__srMut), 1, `${scheme}: exactly one live-region update after the stroke`);
    assert.equal((await status(page)).text, '已写 1 笔', `${scheme}: stroke 1 announced`);
    assert.equal(await gridName(page), '书写格，已写 1 笔', `${scheme}: grid name carries the count`);

    await drawStroke(page, VERTICAL);
    await page.waitForFunction(sel => document.querySelector(sel).textContent.includes('已写 2 笔'), STATUS);
    assert.equal(await gridName(page), '书写格，已写 2 笔', `${scheme}: grid name 2`);

    await page.click(topSel('write-undo'));
    await page.waitForFunction(sel => document.querySelector(sel).textContent.includes('撤销了一笔，还有 1 笔'), STATUS);
    assert.equal(await gridName(page), '书写格，已写 1 笔', `${scheme}: undo → name 1`);
    await page.waitForTimeout(450);
    await page.click(topSel('write-undo'));
    await page.waitForFunction(sel => document.querySelector(sel).textContent.includes('撤销了一笔，格子是空的'), STATUS);
    assert.equal(await gridName(page), '书写格', `${scheme}: undo to empty → plain name`);

    // 再写 2 笔、清空
    await page.waitForTimeout(450);
    await drawStroke(page, HORIZONTAL);
    await page.waitForFunction(sel => document.querySelector(sel).textContent === '已写 1 笔' || document.querySelector(sel).textContent.startsWith('已写 1 笔'), STATUS);
    await drawStroke(page, VERTICAL);
    await page.waitForFunction(sel => document.querySelector(sel).textContent.includes('已写 2 笔'), STATUS);
    await page.waitForTimeout(450);
    await page.click(topSel('write-clear'));
    await page.waitForFunction(sel => document.querySelector(sel).textContent.includes('已清空'), STATUS);
    assert.equal(await gridName(page), '书写格', `${scheme}: clear → plain name`);

    await page.waitForTimeout(450);
    await page.click(topSel('write-undo')); // 撤销清空 → 一次恢复两笔
    await page.waitForFunction(sel => document.querySelector(sel).textContent.includes('恢复了，现在是 2 笔'), STATUS);
    assert.equal(await gridName(page), '书写格，已写 2 笔', `${scheme}: restore → name 2`);

    // 视觉隐藏：占 1px、不可见
    const box = await page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.width, r.height]; }, STATUS);
    assert.deepEqual(box, [1, 1], `${scheme}: the live region is visually hidden (1×1)`);

    step(`${scheme}: 提示给出了哪几笔（聚 14 画）`);
    await open(page, ctx, ['聚', '大'], {}, scheme);
    await page.waitForSelector(`${topSel('write-hint')}[data-state="available"]`, { timeout: 15000 });
    await page.click(topSel('write-hint'));
    await page.waitForFunction(sel => document.querySelector(sel).textContent.startsWith('提示画出了'), STATUS);
    const h1 = (await status(page)).text;
    const m1 = /^提示画出了第 (\d+)( 到第 (\d+))? 笔$/.exec(h1);
    assert.ok(m1, `${scheme}: hint announcement shape (${h1})`);
    assert.equal(m1[1], '1', `${scheme}: first hint starts at stroke 1`);
    const range = await page.evaluate(async () => {
      const t = window.__shiziTest.getState().sessions.A.current;
      return t.hintRange;
    });
    assert.deepEqual([Number(m1[1]) - 1, Number(m1[3] || m1[1])], [range.from, range.to], `${scheme}: announced range = stored hintRange`);

    step(`${scheme}: 进入描一遍播报全部笔序`);
    await open(page, ctx, ['大', '聚'], { current: { phase: 'trace', answerSeen: true } }, scheme);
    await page.waitForFunction(sel => document.querySelector(sel).textContent.startsWith('描一遍'), STATUS, { timeout: 15000 });
    assert.equal((await status(page)).text, '描一遍：参考字形画出了第 1 到第 3 笔', `${scheme}: trace announced (大 = 3 strokes)`);

    step(`${scheme}: 换字后基线重置：新字不播旧字的笔数`);
    await open(page, ctx, ['大', '聚'], {}, scheme);
    await drawStroke(page, HORIZONTAL);
    await page.waitForFunction(sel => document.querySelector(sel).textContent.includes('已写 1 笔'), STATUS);
    await page.click(topSel('write-skip'));
    await waitNavIdle(page);
    await page.waitForFunction(sel => document.querySelector('[data-testid="write-grid"]') && document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]').getAttribute('aria-label') === '书写格', GRID);
    assert.equal(await gridName(page), '书写格', `${scheme}: next char starts from the plain name`);
    assert.equal((await status(page)).text, '', `${scheme}: the previous announcement is cleared on a new character`);
  }
}
