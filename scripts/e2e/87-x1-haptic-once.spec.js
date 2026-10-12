// R2-X1（D51 ②，P227；第二轮审查 I2-03 的写字页部分）：每字一次触觉。
//
// 写字页里一次判断只发一次触觉（judge = soft 0.7，commit 'write:judge'；D58 起「写好了」另发一次 light，F1）：进判断页、接着写、换下一字、画一笔、点提示后淡出都不发；最后一字也一样——
// 判断到结果页出现之间只有那一次 judge，结果页落印着纸那一帧的 seal 由 R2-R1（P216）/ C3-R 管，不在这里叠加。
// 读 platform/haptics.js 的 hapticLog()（每发一次 push 一个种类）。

import { bootTestHost, drawStroke, HORIZONTAL, seedSession, topSel, waitNavIdle } from './helpers.mjs';

const CHARS = ['根', '据', '永'];

const logOf = page => page.evaluate(async () => (await import('/src/platform/haptics.js')).hapticLog());

export default async function x1HapticOnce(page, ctx) {
  const { assert, step } = ctx;
  await page.setViewportSize({ width: 390, height: 844 });
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok, 'seeded a 3-character daily session');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('write', { slot: 'A' }));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  await page.waitForSelector(topSel('write-done'), { timeout: 15000 });
  await page.waitForTimeout(450);

  for (let i = 0; i < CHARS.length; i += 1) {
    const last = i === CHARS.length - 1;
    step(`character ${i + 1}${last ? ' (the last one)' : ''}: drawing, 写好了 and 接着写 : 写好了 one light, the judgement exactly one judge (F1)`);
    const base = (await logOf(page)).length;
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(250);
    await page.click(topSel('write-done'));
    await page.waitForSelector(topSel('write-judge-correct'));
    await page.waitForTimeout(700);
    assert.deepEqual((await logOf(page)).slice(base), ['light'], `character ${i + 1}: 写好了 sends one light haptic (F1, D58), entering the judge page nothing more`);
    await page.click(topSel('write-judge-correct'));
    if (last) await page.waitForSelector(topSel('result-screen'), { timeout: 8000 });
    else await page.waitForFunction(n => document.querySelector('.sz-layer[data-top="true"] .sz-write')?.dataset.cursor === String(n), i + 1);
    const log = await logOf(page);
    const since = log.slice(base);
    const stamps = since.filter(k => k === 'judge');
    assert.equal(stamps.length, 1, `character ${i + 1}: exactly one judge haptic for the judgement (${JSON.stringify(since)})`);
    if (!last) {
      assert.deepEqual(since, ['light', 'judge'], `character ${i + 1}: 写好了 light + the judgement, nothing else from the write page`);
      await page.waitForTimeout(700);
    } else {
      assert.ok(!since.includes('action') && since.filter(k => k === 'light').length === 1, 'the last character: no finish haptic stacked on the judgement');
      assert.ok(!since.includes('seal') || since.indexOf('seal') > since.indexOf('judge'), 'any seal haptic is the result page’s landing moment, after the judgement (P216)');
      assert.deepEqual(since.slice(0, 2), ['light', 'judge'], '写好了 light, then the judgement');
    }
  }
}
