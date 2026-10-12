// 交互合规（交互与动效规范 §8b）—— 第 2 份：逐页断言（后半）IC-01 / 02 / 03 / 09 / 10 / 20，并在 AX5 + 375×667 上查 IC-21（无横向溢出、
// 按钮不省略号截断、写字页不滚动）。共用逻辑见 ic-pages.mjs / ic-lib.mjs；待修条目见 interaction-pending.mjs。

import { CATALOG, boot, enter, seedRich, TOP } from './ic-lib.mjs';
import { checkPages } from './ic-pages.mjs';
import { setTextSize } from './helpers.mjs';
import { longTextCatalog, seedLongText } from './fixtures/long-text.mjs';

export const PART2 = ['session-none', 'records', 'month', 'settings', 'backup', 'annual', 'about', 'about-privacy', 'about-credits', 'about-letter'];

export default async function interactionCompliancePages2(page, ctx) {
  const { assert, step, baseURL } = ctx;
  await boot(page, baseURL);
  const info = await seedRich(page);
  await checkPages(page, ctx, info, PART2);

  step('IC-21: AX5 + 375×667 — no horizontal overflow, no ellipsis on buttons, the write page never scrolls');
  await page.setViewportSize({ width: 375, height: 667 });
  await setTextSize(page, 'AX5');
  const catalog = await longTextCatalog(page);
  // 写字页放在最后：用长文本 fixture 的「题面最长」卡（提示行最长；10650a2 上 AX5 + SE 正文滚 68pt，R5M / P299 起题面按可用高度缩小、再不行格子让步，不滚动）
  for (const name of ['home', 'settings', 'backup', 'detail', 'library-list', 'write']) {
    if (name === 'write') {
      const seeded = await seedLongText(page, catalog);
      assert.ok(seeded.ok, `IC-21 write: seeded the longest prompt (${catalog.longest.char}, hint ${catalog.longest.hint.length} chars)`);
    }
    await enter(page, CATALOG.find(e => e.name === name), info);
    if (name === 'write') await page.waitForTimeout(400); // 量完题面高再排一次（useWriteLayout 的 ResizeObserver）
    const r = await page.evaluate(t => {
      const top = document.querySelector(t);
      const ell = [...top.querySelectorAll('button, [role="button"]')].filter(el => {
        const cs = getComputedStyle(el);
        return cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      }).map(el => el.getAttribute('data-testid') || el.className);
      const body = top.querySelector('.sz-page__body');
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        ell,
        writeScroll: top.querySelector('.sz-write') && body ? body.scrollHeight > body.clientHeight + 1 : false,
      };
    }, TOP);
    assert.equal(r.overflow, false, `IC-21 ${name}: no horizontal overflow at AX5 / 375×667`);
    assert.deepEqual(r.ell, [], `IC-21 ${name}: no ellipsis-truncated button`);
    if (name === 'write') assert.equal(r.writeScroll, false, 'IC-21 write: the write page does not scroll (D51 ⑦)');
  }
  await setTextSize(page, 'L');
}
