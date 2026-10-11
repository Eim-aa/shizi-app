// R3-C3W（V3-02、T3-03 / T3-04，D53 ②，P257）：同一张卡的所有阶段，书写格（判断页是上格）的顶边 y 恒定（误差 ≤ 1pt）。
// 第三轮审查量到：回忆 250、看答案 230、描一遍 / 自己写 230、首次说明行出现时 265——格子随阶段上下跳 20–35pt。
// 原因是组顶按「各阶段实际量到的主区高」排，主区高又随页头 / 底栏 / 说明行的高度变；现在组顶只按名义版式 + 这张卡量到的题面高排（layout.js writeLayout），
// 页头在大字号下标题折成两行时再减去多出来的高度（headExtra）；看答案阶段撤销 / 清空不占页头宽度，标题不折行。
//
// 本文件：冷启动直接恢复到某一阶段（恢复现场：回忆 / 回忆已有墨 / 看答案 / 描一遍 / 自己写 / 判断）——每个阶段的格子顶边都等于回忆阶段的。
// 一路点过去、首次说明行与结果行不推动格子见 98-c3w-grid-walk.spec.js（拆成两个文件是因为单个 spec 有 90s 上限）。
// 393×852 / 402×874 / 375×667，常规字号与 XXXL（紧凑排布）。AX 档是例外（V3-02：「只有 AX 版式例外」），不在这里测。
import { encodeRawStrokes } from '../../src/core/ink-math.js';
import { bootTestHost, seedSession, setTextSize, topSel, waitNavIdle } from './helpers.mjs';

const CHARS = ['根', '据', '永', '和', '春'];
const line = (x0, y0, x1, y1) => Array.from({ length: 9 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8, t: i * 16 }));
const STROKES = encodeRawStrokes([line(80, 120, 260, 120), line(170, 60, 170, 290)]);
const COMBOS = [
  [{ width: 393, height: 852 }, 'L'], [{ width: 393, height: 852 }, 'XXXL'],
  [{ width: 375, height: 667 }, 'L'], [{ width: 375, height: 667 }, 'XXXL'],
  [{ width: 402, height: 874 }, 'L'],
];
const PHASES = [
  ['recall', {}],
  ['recall+ink', { strokes: STROKES }],
  ['answer', { phase: 'answer', answerSeen: true, strokes: STROKES }],
  ['trace', { phase: 'trace', answerSeen: true }],
  ['retrace', { phase: 'retrace', answerSeen: true }],
  ['compare', { phase: 'compare', strokes: STROKES }],
];

async function open(page, ctx, { view, size, current }) {
  await page.setViewportSize(view);
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
  await page.waitForSelector(`${topSel('write-screen')} .sz-page__foot`);
  await page.waitForTimeout(250);
}

/** 书写格（判断页是上格）的顶边 y。 */
function gridTop(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const el = top.querySelector('[data-testid="write-grid"]') || top.querySelector('[data-testid="write-compare-mine"]') || top.querySelector('[data-testid="write-paper"]');
    return el ? el.getBoundingClientRect().top : null;
  });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const [view, size] of COMBOS) {
    const tag = `${view.width}×${view.height} ${size}`;
    step(`${tag}: cold start straight into each phase — the grid top is the same y`);
    const tops = {};
    for (const [name, current] of PHASES) {
      await open(page, ctx, { view, size, current });
      if (name === 'compare') await page.waitForSelector(topSel('write-compare-mine'));
      tops[name] = await gridTop(page);
      assert.ok(tops[name] !== null, `${tag} ${name}: grid found`);
    }
    const base = tops.recall;
    for (const [name, y] of Object.entries(tops)) assert.ok(Math.abs(y - base) <= 1, `${tag} ${name}: grid top ${y.toFixed(1)} = recall ${base.toFixed(1)} (±1) ${JSON.stringify(tops)}`);
  }
}
