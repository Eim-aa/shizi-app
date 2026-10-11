// R3-C3W（V3-02、T3-03，D53 ②，P257）：书写格顶边恒定——在同一页里一路点过去（回忆 → 提示 → 落笔 → 看答案 → 描一遍 → 自己写 → 下一字 → 判断 → 接着写）格子一动不动；
// 首练第 1 字的一次性提示行、上一字的结果行出现 / 收起也不推动格子。冷启动恢复到各阶段见 98-c3w-grid-top.spec.js。AX 档是例外。
import { bootTestHost, drawStroke, HORIZONTAL, seedSession, setTextSize, tap, topSel, waitNavIdle } from './helpers.mjs';

const CHARS = ['根', '据', '永', '和', '春'];
const COMBOS = [[{ width: 393, height: 852 }, 'L'], [{ width: 393, height: 852 }, 'XXXL'], [{ width: 375, height: 667 }, 'L'], [{ width: 375, height: 667 }, 'XXXL']];

async function open(page, ctx, { view, size, kind = 'daily', cursor = 1 }) {
  await page.setViewportSize(view);
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await setTextSize(page, size);
  const seeded = await seedSession(page, { slot: 'A', kind, chars: CHARS, cursor });
  ctx.assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('write', { slot: 'A' });
  });
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  await page.waitForSelector(topSel('write-more'));
  await page.waitForTimeout(300);
}

function gridTop(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const el = top.querySelector('[data-testid="write-grid"]') || top.querySelector('[data-testid="write-compare-mine"]') || top.querySelector('[data-testid="write-paper"]');
    return el ? el.getBoundingClientRect().top : null;
  });
}

const waitPhase = (page, p) => page.waitForFunction(ph => {
  const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
  return !!w && w.dataset.phase === ph;
}, p).then(() => page.waitForTimeout(500));

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const [view, size] of COMBOS) {
    const tag = `${view.width}×${view.height} ${size}`;
    step(`${tag}: walking through the phases in one page (hint → ink → answer → trace → retrace → next card → judge → back) the grid never moves`);
    await open(page, ctx, { view, size });
    const seen = [await gridTop(page)];
    await tap(page, 'write-hint');
    await page.waitForSelector(`${topSel('write-hint-layer')}[data-state="shown"]`);
    seen.push(await gridTop(page));
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(300);
    seen.push(await gridTop(page));
    await tap(page, 'write-show-answer');
    await waitPhase(page, 'answer');
    seen.push(await gridTop(page));
    await page.click(topSel('write-answer-trace'));
    await waitPhase(page, 'trace');
    seen.push(await gridTop(page));
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(500);
    await page.click(topSel('write-trace-done'));
    await waitPhase(page, 'retrace');
    seen.push(await gridTop(page));
    assert.ok(seen.every(y => Math.abs(y - seen[0]) <= 1), `${tag}: one card, six moments: ${seen.map(y => y.toFixed(1)).join(' / ')}`);
    await tap(page, 'write-answer-next');
    await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor === '2');
    await waitNavIdle(page);
    const next = await gridTop(page); // 下一个字：另一张卡（题面高可以不同），只和它自己的各阶段比
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(300);
    await page.click(topSel('write-done'));
    await page.waitForSelector(topSel('write-compare-mine'));
    await waitNavIdle(page, { settleMs: 500 });
    const judge = await gridTop(page);
    assert.ok(Math.abs(judge - next) <= 1, `${tag}: next card recall ${next.toFixed(1)} = its judge page ${judge.toFixed(1)}`);
    await page.click(topSel('write-continue'));
    await waitPhase(page, 'recall');
    assert.ok(Math.abs((await gridTop(page)) - next) <= 1, `${tag}: 接着写 comes back to the same top`);
  }

  step('393×852: the one-time first-tip line, and the previous character\'s result row, do not push the grid');
  {
    const view = { width: 393, height: 852 };
    await open(page, ctx, { view, size: 'L', kind: 'first', cursor: 0 });
    const withTip = await gridTop(page);
    assert.ok(await page.$(topSel('write-first-tip')), 'the first tip is showing');
    await drawStroke(page, HORIZONTAL); // 落笔：一次性提示收起
    await page.waitForTimeout(400);
    assert.ok(!(await page.$(topSel('write-first-tip'))), 'the first tip is gone after the first stroke');
    const withoutTip = await gridTop(page);
    assert.ok(Math.abs(withTip - withoutTip) <= 1, `first tip shown ${withTip.toFixed(1)} = hidden ${withoutTip.toFixed(1)}`);

    await open(page, ctx, { view, size: 'L', cursor: 0 });
    const fresh = await gridTop(page);
    await drawStroke(page, HORIZONTAL);
    await page.waitForTimeout(200);
    await page.click(topSel('write-done'));
    await page.waitForSelector(topSel('write-judge-wrong'));
    await waitNavIdle(page, { settleMs: 700 });
    await page.click(topSel('write-judge-wrong'));
    await page.waitForSelector(topSel('write-line-change'));
    await waitNavIdle(page, { settleMs: 500 });
    const withRow = await gridTop(page);
    await drawStroke(page, HORIZONTAL); // 落笔：结果行收起
    await page.waitForTimeout(400);
    const withoutRow = await gridTop(page);
    assert.ok(Math.abs(withRow - withoutRow) <= 1, `result row shown ${withRow.toFixed(1)} = collapsed ${withoutRow.toFixed(1)}`);
    assert.ok(Math.abs(withRow - fresh) <= 1, `…and equal to the first card (${fresh.toFixed(1)}): the same prompt height`);
  }
}
