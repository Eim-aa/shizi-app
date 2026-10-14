// R3-C3W（P259，第三轮审查）：SE 3 的 AX5 下描一遍阶段主按钮曾折成三行；AX3 起用短文案（D64 ② 起长短两版同为「凭记忆写」）（一行），
// AX1–AX2 与常规字号仍是「描好了，自己写」。读屏名称随按钮文字。
import { bootTestHost, seedSession, setTextSize, topSel, waitNavIdle } from './helpers.mjs';

const CHARS = ['根', '据', '永'];

async function open(page, ctx, { view, size }) {
  await page.setViewportSize(view);
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await setTextSize(page, size);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 1, current: { phase: 'trace', answerSeen: true } });
  ctx.assert.ok(seeded.ok, 'seeded');
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('write', { slot: 'A' });
  });
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  await page.waitForSelector(topSel('write-trace-done'));
  await page.waitForTimeout(350);
}

/** 主按钮的文字、读屏名称、文字占几行（Range 行盒的不同 top 数）。 */
function labelFacts(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-trace-done"]');
    const tops = new Set();
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const rc of r.getClientRects()) tops.add(Math.round(rc.top));
    }
    const rect = el.getBoundingClientRect();
    return { text: el.textContent.trim(), aria: el.getAttribute('aria-label'), lines: tops.size, h: rect.height, w: rect.width };
  });
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const [view, size, want, lines] of [
    [{ width: 375, height: 667 }, 'AX5', '凭记忆写', 1],
    [{ width: 375, height: 667 }, 'AX3', '凭记忆写', 1],
    [{ width: 390, height: 844 }, 'AX5', '凭记忆写', 1],
    [{ width: 390, height: 844 }, 'AX2', '凭记忆写', 0],
    [{ width: 390, height: 844 }, 'L', '凭记忆写', 0],
  ]) {
    const tag = `${view.width}×${view.height} ${size}`;
    step(`${tag}: trace-phase main button reads 「${want}」`);
    await open(page, ctx, { view, size });
    const f = await labelFacts(page);
    assert.equal(f.text, want, `${tag}: main button text (got 「${f.text}」)`);
    assert.ok(!f.aria || f.aria === want, `${tag}: no stale aria-label (${f.aria})`);
    if (lines) assert.equal(f.lines, lines, `${tag}: the label is one line (was three at SE 3 AX5), got ${f.lines}`);
  }
}
