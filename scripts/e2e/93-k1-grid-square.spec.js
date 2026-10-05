// R3-K1（ADA A3-01，P240）：书写格永远正方形，笔迹不因容器变形而失真。
// WKWebView 在 SE3 AX3 / AX5 下把书写格拉成 304×334 / 286×334（flex 拉伸压过了 aspect-ratio），Chromium 本身不复现。
// 这里在 Chromium 里用 CSSOM 人为造出同样的拉伸（书写格外层 / 判断页每一行给一个更高的 flex 交叉轴），断言：
//   - 书写格、看答案格、判断页两格的宽高仍相等（格子宽高由版式算出的 g 写死成 px，不依赖 aspect-ratio 与 flex 拉伸）；
//   - 再把书写格强行压成长方形：屏幕上 dx = dy 的一笔，存进会话的笔画 dy / dx 仍是 1（ink-canvas 以较短边为单位居中映射）。
// 新旧对照：旧实现下拉伸后书写格是 g × (g + 120)，强制长方形时存下的笔画 dy / dx = g / (g + 80)。
import { bootTestHost, seedSession, setTextSize, topSel, waitNavIdle } from './helpers.mjs';

const CHARS = ['根', '据', '永', '和', '春'];

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
  await page.waitForTimeout(300);
}

/** CSP 只许 'self'：测试样式经 CSSOM（adoptedStyleSheets）加，不插 <style>。 */
async function addCss(page, css) {
  await page.evaluate(text => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, css);
  await page.waitForTimeout(250);
}

const rectOf = (page, id) => page.$eval(topSel(id), el => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  for (const [view, size] of [[{ width: 375, height: 667 }, 'AX5'], [{ width: 390, height: 844 }, 'AX3'], [{ width: 390, height: 844 }, 'L']]) {
    const tag = `${view.width}×${view.height} ${size}`;

    step(`${tag}: the write grid stays square when its flex line is taller than the grid (the WebKit AX stretch)`);
    await open(page, ctx, { view, size });
    const g0 = await rectOf(page, 'write-grid');
    assert.ok(Math.abs(g0.w - g0.h) <= 0.5, `${tag}: grid ${g0.w}×${g0.h} before the stretch`);
    await addCss(page, `.sz-write__gridwrap{height:${Math.round(g0.w + 120)}px;align-items:stretch}`);
    const g1 = await rectOf(page, 'write-grid');
    assert.ok(Math.abs(g1.w - g1.h) <= 0.5 && Math.abs(g1.w - g0.w) <= 0.5, `${tag}: grid stays ${g0.w.toFixed(0)}² under a ${Math.round(g0.w + 120)}px flex line (got ${g1.w.toFixed(1)}×${g1.h.toFixed(1)})`);

    step(`${tag}: a stroke drawn with equal on-screen dx / dy is stored with equal dx / dy even when the grid box is forced out of square`);
    await addCss(page, `.sz-layer[data-top="true"] [data-testid="write-grid"]{height:${Math.round(g0.w + 80)}px !important}`);
    const g2 = await rectOf(page, 'write-grid-live');
    assert.ok(g2.h > g2.w + 40, `${tag}: the box is now ${g2.w.toFixed(0)}×${g2.h.toFixed(0)} (forced)`);
    const cx = g2.x + g2.w / 2;
    const cy = g2.y + g2.h / 2;
    const d = Math.min(g2.w, g2.h) * 0.3;
    await page.mouse.move(cx - d, cy - d);
    await page.mouse.down();
    await page.mouse.move(cx, cy, { steps: 6 });
    await page.mouse.move(cx + d, cy + d, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]').dataset.strokeCount === '1');
    await page.waitForTimeout(300);
    const r = await page.evaluate(async () => {
      const { decodeRawStrokes } = await import('/src/core/ink-math.js');
      const raw = decodeRawStrokes(window.__shiziTest.getState().sessions.A.current.strokes)[0];
      const a = raw[0];
      const b = raw[raw.length - 1];
      return { ratio: (b.y - a.y) / (b.x - a.x), mid: raw[Math.floor(raw.length / 2)] };
    });
    assert.ok(Math.abs(r.ratio - 1) <= 0.02, `${tag}: stored dy/dx = ${r.ratio.toFixed(3)} (old: ${(g2.w / g2.h).toFixed(3)})`);
    assert.ok(Math.abs(r.mid.x - 172.5) <= 8 && Math.abs(r.mid.y - 172.5) <= 8, `${tag}: the centre of the box is the centre of the 345 grid (${r.mid.x.toFixed(1)}, ${r.mid.y.toFixed(1)})`);

    step(`${tag}: the answer grid stays square under the same stretch`);
    await open(page, ctx, { view, size, current: { phase: 'answer', answerSeen: true } });
    const a0 = await rectOf(page, 'write-grid');
    await addCss(page, `.sz-write__gridwrap{height:${Math.round(a0.w + 120)}px;align-items:stretch}`);
    const a1 = await rectOf(page, 'write-grid');
    assert.ok(Math.abs(a1.w - a1.h) <= 0.5, `${tag}: answer grid ${a1.w.toFixed(1)}×${a1.h.toFixed(1)}`);

    step(`${tag}: both judge cells stay square when each row is a taller flex line`);
    const { encodeRawStrokes } = await import('../../src/core/ink-math.js');
    const line = (x0, y0, x1, y1) => Array.from({ length: 9 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8, t: i * 16 }));
    await open(page, ctx, { view, size, current: { phase: 'compare', strokes: encodeRawStrokes([line(80, 120, 260, 120), line(170, 60, 170, 290)]) } });
    await page.waitForSelector(`${topSel('write-compare-ref')}[data-state="ready"]`);
    await waitNavIdle(page, { settleMs: 600 });
    const m0 = await rectOf(page, 'write-compare-mine');
    await addCss(page, `.sz-compare__row{display:flex;align-items:stretch;min-height:${Math.round(m0.w + 100)}px}`);
    for (const id of ['write-compare-mine', 'write-compare-ref']) {
      const c = await rectOf(page, id);
      assert.ok(Math.abs(c.w - c.h) <= 0.5 && Math.abs(c.w - m0.w) <= 0.5, `${tag}: ${id} ${c.w.toFixed(1)}×${c.h.toFixed(1)} (side ${m0.w.toFixed(1)})`);
    }
  }
}
