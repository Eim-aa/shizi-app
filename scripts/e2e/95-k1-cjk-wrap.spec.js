// R3-K1（ADA A3-02，P242）：中文折行。
// 上一轮给 AX 档按钮 / 详情说明加的 word-break:keep-all 让中文整句不能折行，WebKit 里「描好了，自己写」压到「⋯」下面、
// 详情空态「判断过的每一次书写都会留在这里」冲出页边（Chromium 会在「，」后断，所以截图对不上，这里断言计算样式与结构）：
//   - 写字页（描一遍 / 看答案 + 「⋯」菜单）与单字详情页，页面上没有任何元素的计算样式是 word-break:keep-all；
//   - 按钮文字按词包成 nowrap 的 span：「描好了，自己写」折行只发生在词边界（每个词只占一行），整块文字在按钮里、按钮不横向溢出；
//   - 详情空态说明在页边以内、不横向溢出。
// 新旧对照：旧实现下 AX 档主按钮 / 菜单项 / 详情说明的 word-break 是 keep-all，按钮里没有分词的 span。
import { bootTestHost, seedSession, setTextSize, topSel, waitNavIdle } from './helpers.mjs';

const CHARS = ['根', '据', '永', '和', '春'];

async function openWrite(page, ctx, { size, current }) {
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await setTextSize(page, size);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 1, current });
  ctx.assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('write', { slot: 'A' });
  });
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  await page.waitForTimeout(300);
}

/* eslint-disable no-undef */
const keepAll = () => [...document.querySelectorAll('.sz-app *')]
  .filter(el => getComputedStyle(el).wordBreak === 'keep-all')
  .map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')}`)
  .slice(0, 10);

const buttonText = id => {
  const btn = document.querySelector(`.sz-layer[data-top="true"] [data-testid="${id}"]`);
  const b = btn.getBoundingClientRect();
  const words = [...btn.querySelectorAll('.sz-words__w')];
  const range = document.createRange();
  range.selectNodeContents(btn);
  const rects = [...range.getClientRects()].filter(r => r.width > 0.5);
  return {
    words: words.map(w => w.textContent),
    split: words.filter(w => w.getClientRects().length > 1).map(w => w.textContent),
    lines: new Set(words.map(w => Math.round(w.getBoundingClientRect().top))).size,
    inside: rects.every(r => r.left >= b.left - 1 && r.right <= b.right + 1),
    overflow: btn.scrollWidth > btn.clientWidth + 1,
    vw: document.documentElement.clientWidth,
  };
};
/* eslint-enable no-undef */

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const [view, size] of [[{ width: 375, height: 667 }, 'AX5'], [{ width: 375, height: 667 }, 'AX3'], [{ width: 402, height: 874 }, 'AX5']]) {
    const tag = `${view.width}×${view.height} ${size}`;
    await page.setViewportSize(view);

    step(`${tag} 描一遍: the main button label (「自己写」 from AX3, P259; it used to be 「描好了，自己写」 in three lines) wraps only between words, stays inside its button; nothing on the page is keep-all`);
    await openWrite(page, ctx, { size, current: { phase: 'trace', answerSeen: true } });
    const b = await page.evaluate(buttonText, 'write-trace-done');
    assert.deepEqual(b.words, ['自己', '写'], `${tag}: the short label is segmented into words`);
    assert.equal(b.lines, 1, `${tag}: and fits on one line`);
    assert.deepEqual(b.split, [], `${tag}: no word is split across lines`);
    assert.ok(b.inside && !b.overflow, `${tag}: the text stays inside the button (${b.lines} line(s))`);
    assert.deepEqual(await page.evaluate(keepAll), [], `${tag}: no element on the write page computes word-break:keep-all`);

    step(`${tag} 看答案 + text row: no keep-all in the foot; the text buttons fold by word and stay inside the page`);
    await openWrite(page, ctx, { size, current: { phase: 'answer', answerSeen: true } });
    assert.deepEqual(await page.evaluate(keepAll), [], `${tag}: no keep-all on the answer page`);
    const items = await page.$$eval('.sz-layer[data-top="true"] .sz-page__foot .sz-write__links .sz-btn--text', els => els.map(e => ({ t: e.textContent, o: e.scrollWidth > e.clientWidth + 8, r: e.getBoundingClientRect().right })));
    assert.ok(items.length >= 2 && items.every(i => !i.o && i.r <= view.width + 0.5), `${tag}: the text row buttons do not overflow (${JSON.stringify(items)})`);

    step(`${tag} 单字详情（没写过的字）: the empty note wraps inside the page margins`);
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);
    await setTextSize(page, size);
    await page.evaluate(async () => {
      window.__shiziTest.reset();
      const { nav } = await import('/src/ui/router.js');
      nav.push('detail', { char: '完' });
    });
    await page.waitForSelector(topSel('detail-records-empty'));
    await waitNavIdle(page);
    const d = await page.$eval(topSel('detail-records-empty'), el => {
      const r = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const right = Math.max(...[...range.getClientRects()].map(x => x.right));
      return { right, wb: getComputedStyle(el).wordBreak, vw: document.documentElement.clientWidth, lines: range.getClientRects().length, w: r.width };
    });
    assert.ok(d.wb !== 'keep-all', `${tag}: detail note word-break is ${d.wb}`);
    assert.ok(d.right <= d.vw - 20 + 1, `${tag}: the note ends inside the right margin (${d.right.toFixed(0)} ≤ ${d.vw - 20})`);
    assert.deepEqual(await page.evaluate(keepAll), [], `${tag}: no element on the detail page computes word-break:keep-all`);
  }
}
