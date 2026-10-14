// R2-A1（A2-09 / D45；03 P232）：判断页与看答案页的参考字形读屏名称补上结构 / 部件数。
//   判断页参考卡（write-compare-ref，role=img）与看答案页底栏里视觉隐藏的答案字（write-answer-char，role=img）读同一句：
//   「参考字形：的，dì，8 画，左右结构」「参考字形：思，sī，9 画，上下结构」；镶嵌的「大」只报部件数；数据没到时不说笔画与结构。
//   进度读屏名称仍是「第 n 个字，共 m 个」（判断页 / 看答案页同一个页头进度）。
//   标准档与 AX5（AX 底栏的答案字在 lead 里）；浅 / 深各一遍。
// 新旧对照：旧实现下判断页只读「参考字形：的，dì，8 画」，看答案页只读「的」。
import {
  bootTestHost, drawStroke, HORIZONTAL, seedSession, setTextSize, topSel, waitNavIdle,
} from './helpers.mjs';

/* eslint-disable no-undef */
const aria = (page, id) => page.getAttribute(topSel(id), 'aria-label');

async function openWritePage(page, ctx, { chars, current, size, scheme }) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  if (size && size !== 'L') await setTextSize(page, size);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars, cursor: 0, current });
  ctx.assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('write', { slot: 'A' }));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  const cases = [
    { char: '的', label: '标准写法：的，dì，8 画，左右结构' },
    { char: '思', label: '标准写法：思，sī，9 画，上下结构' },
    { char: '大', label: '标准写法：大，dà，3 画，2 个部件' },
  ];
  for (const scheme of ['light', 'dark']) {
    for (const size of ['L', 'AX5']) {
      step(`${scheme} ${size}: 看答案页的隐藏答案字 = 标准写法名称（含结构 / 部件）`);
      for (const c of cases) {
        await openWritePage(page, ctx, { chars: [c.char, '和'], current: { phase: 'trace', answerSeen: true }, size, scheme });
        await page.waitForSelector(topSel('write-answer-char'));
        // 笔顺数据到了才有笔画数与结构：等名称带上「画」
        await page.waitForFunction(() => /画/.test(document.querySelector('.sz-layer[data-top="true"] [data-testid="write-answer-char"]').getAttribute('aria-label')), null, { timeout: 15000 });
        assert.equal(await aria(page, 'write-answer-char'), c.label, `${scheme} ${size}: answer page label for ${c.char}`);
        const progress = await aria(page, 'write-progress');
        assert.equal(progress, '第 1 个字，共 2 个', `${scheme} ${size}: progress read as Chinese on the answer page`);
      }
    }
    step(`${scheme}: 判断页参考卡的名称（含结构 / 部件）与进度`);
    for (const c of cases) {
      await openWritePage(page, ctx, { chars: [c.char, '和'], size: 'L', scheme });
      await page.waitForSelector(topSel('write-done'), { timeout: 15000 });
      await drawStroke(page, HORIZONTAL);
      await page.click(topSel('write-done'));
      await page.waitForSelector(topSel('write-compare-ref'));
      await page.waitForFunction(() => /画/.test(document.querySelector('.sz-layer[data-top="true"] [data-testid="write-compare-ref"]').getAttribute('aria-label')), null, { timeout: 15000 });
      assert.equal(await aria(page, 'write-compare-ref'), c.label, `${scheme}: compare page label for ${c.char}`);
      assert.equal(await aria(page, 'write-compare-mine'), '你写的，1 笔', `${scheme}: my card still reads the stroke count`);
      assert.equal(await aria(page, 'write-progress'), '第 1 个字，共 2 个', `${scheme}: progress read as Chinese on the compare page`);
    }
    step(`${scheme} AX5: 判断页（AX 档）参考卡名称`);
    await openWritePage(page, ctx, { chars: ['的', '和'], size: 'AX5', scheme });
    await page.waitForSelector(topSel('write-done'));
    await page.waitForTimeout(450);
    await drawStroke(page, HORIZONTAL);
    await page.click(topSel('write-done'));
    await page.waitForSelector(topSel('write-compare-ref'));
    await page.waitForFunction(() => /画/.test(document.querySelector('.sz-layer[data-top="true"] [data-testid="write-compare-ref"]').getAttribute('aria-label')), null, { timeout: 15000 });
    assert.equal(await aria(page, 'write-compare-ref'), '标准写法：的，dì，8 画，左右结构', `${scheme} AX5: compare page label`);
  }
}
