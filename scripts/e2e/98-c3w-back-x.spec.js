// R3-C3W（I3-03）：写字页各阶段（回忆 / 看答案 / 描一遍 / 自己写）与判断页的左上「‹」落在同一个 x（图标描边外缘 = 20pt 页边线，
// 即第三轮审查里的 19.7）。旧实现下判断页的 ContinueButton 漏了 sz-page__ico--back，「‹」右移 18pt、每字横跳两次。
// 393×852 与 375×667 各一遍；也量 AX3，页头不应有另一个位置。
import { encodeRawStrokes } from '../../src/core/ink-math.js';
import { bootTestHost, seedSession, setTextSize, topSel, waitNavIdle } from './helpers.mjs';

const CHARS = ['根', '据', '永'];
const line = (x0, y0, x1, y1) => Array.from({ length: 9 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8, t: i * 16 }));
const STROKES = encodeRawStrokes([line(80, 120, 260, 120), line(170, 60, 170, 290)]);

const PHASES = [
  { name: 'recall', current: {}, back: 'page-back' },
  { name: 'answer', current: { phase: 'answer', answerSeen: true }, back: 'page-back' },
  { name: 'trace', current: { phase: 'trace', answerSeen: true }, back: 'page-back' },
  { name: 'retrace', current: { phase: 'retrace', answerSeen: true }, back: 'page-back' },
  { name: 'compare', current: { phase: 'compare', strokes: STROKES }, back: 'write-continue' },
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
  await page.waitForTimeout(350);
}

/** 返回图标描边外缘的 x（path 几何盒外扩描边半宽，与 81-h1-edges 同一口径）。 */
function inkLeft(page, testid) {
  return page.evaluate(id => {
    const el = document.querySelector(`.sz-layer[data-top="true"] [data-testid="${id}"]`);
    if (!el) return null;
    let left = Infinity;
    for (const p of el.querySelectorAll('svg path')) {
      const rc = p.getBoundingClientRect();
      const sw = parseFloat(getComputedStyle(p).strokeWidth) || 0;
      left = Math.min(left, rc.left - sw / 2);
    }
    return left;
  }, testid);
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const [view, size] of [[{ width: 393, height: 852 }, 'L'], [{ width: 375, height: 667 }, 'L'], [{ width: 390, height: 844 }, 'AX3']]) {
    const tag = `${view.width}×${view.height} ${size}`;
    step(`${tag}: the 「‹」 sits on the same x in recall / answer / trace / retrace / compare (I3-03)`);
    const xs = {};
    for (const ph of PHASES) {
      await open(page, ctx, { view, size, current: ph.current });
      if (ph.name === 'compare') await page.waitForSelector(topSel('write-compare'));
      xs[ph.name] = await inkLeft(page, ph.back);
      assert.ok(xs[ph.name] !== null && Number.isFinite(xs[ph.name]), `${tag} ${ph.name}: the back icon is there (${ph.back})`);
    }
    const all = Object.values(xs);
    assert.ok(Math.max(...all) - Math.min(...all) <= 0.3, `${tag}: back-icon x is the same in every phase ${JSON.stringify(xs)}`);
    assert.ok(Math.abs(xs.compare - 20) <= 0.6, `${tag}: on the compare page the 「‹」 ink edge is on the 20pt page-edge line (${xs.compare.toFixed(1)})`);
    assert.ok(Math.abs(xs.compare - xs.recall) <= 0.3, `${tag}: compare ${xs.compare.toFixed(1)} = recall ${xs.recall.toFixed(1)} (old: compare was 18pt to the right)`);
  }
}
