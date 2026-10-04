// P0-D / D36（G05，覆盖 X08）：书写格边长与字号脱钩，只缩放显示，内部坐标仍是 345 单位、存储不变。
//
// 公式（policy.writeGrid，P118；P1-E1b 起页边 20）：边长 = min(屏宽 − 40, 视口高 − 预算) 夹在 [258, 400]；视口高 ≤ 760 用紧凑排布那份预算（350），否则 422；
// 预算与字号无关（P1-E6 / D29 起「大字」= 系统字号 XXXL，经模拟的原生 shiziContentSize 设 --k 1.35 与 :root[data-text-large]，
// 原来手动设的 :root[data-large] 已删除）。本文件用**写死的期望值**（不引用实现里的函数）：
//   393×852 → 353（屏宽 − 40 先到）    375×812 → 335（屏宽 − 40）    375×667 → 317（667 − 350）
//   360×640 → 290（640 − 350）         320×568 → 258（预算不够，取下限） 440×956 → 400（上限）
//
// ① 各视口、大字关 / 开：边长等于期望值、方形、距屏幕左右 ≥ 20（页边）、同一视口开关大字前后不变（同一页面内切换，不重载）；
//    边长大于下限的视口里整个格子在页头与底栏之间；底栏按钮在首屏。
// ② 同一个字走完 recall →（点提示）→ 看答案 → 描一遍 → 自己写：各阶段书写格边长一致，点提示前后不变；看答案卡片不大于格子；
//    描红层 / 提示层铺满格子。
// ③ 缩放后的格子里按格子相对坐标画一笔：存下的点坐标按 345 单位（不是屏幕像素），固化层笔迹落点在相对位置上；
//    切到更小的视口 / 开关大字后存储的笔画逐字节不变、笔迹仍落在同样的相对位置。

import {
  bootTestHost, canvasInk, drawStroke, HORIZONTAL, PRESS_SETTLE_MS, seedSession, tid, topSel, VERTICAL, waitNavIdle, openWrite,
  setTextSize, LARGE_TEXT,
} from './helpers.mjs';

const CHARS = ['越', '大', '永'];
const FIRST_SCREEN = ['page-back', 'write-hint', 'write-done', 'write-show-answer', 'write-skip'];

const CASES = [
  { view: { width: 393, height: 852 }, grid: 353 },
  { view: { width: 375, height: 812 }, grid: 335 },
  { view: { width: 375, height: 667 }, grid: 317 },
  { view: { width: 360, height: 640 }, grid: 290 },
  { view: { width: 320, height: 568 }, grid: 258 },
  { view: { width: 440, height: 956 }, grid: 400 },
];

async function setLarge(page, on) {
  await setTextSize(page, on ? LARGE_TEXT : 'L');
  await page.waitForTimeout(250);
}

async function boot(page, ctx, view, { large = false, chars = CHARS } = {}) {
  await page.setViewportSize(view);
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await setLarge(page, large);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars, cursor: 0 });
  ctx.assert.ok(seeded.ok, `${view.width}×${view.height}: seed A session`);
  await openWrite(page, { slot: 'A' });
  await page.waitForSelector(`${topSel('write-hint')}[data-state="available"]`, { timeout: 15000 });
  await page.mouse.move(1, 1);
}

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && w.dataset.phase === p;
  }, phase);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function waitStrokes(page, n) {
  await page.waitForFunction(k => {
    const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
    return !!g && Number(g.dataset.strokeCount) === k;
  }, n);
}

/** 书写格几何：格子、页头、底栏、视口，以及一组控件是否在首屏。 */
async function geo(page, ids = FIRST_SCREEN) {
  return page.evaluate(ids => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    const foot = rect(top.querySelector('.sz-page__foot'));
    const vh = window.innerHeight;
    const off = ids.filter(id => {
      const r = rect(q(id));
      return !r || r.top < -0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.right > window.innerWidth + 0.5;
    });
    return {
      vw: document.documentElement.clientWidth, vh, large: document.documentElement.hasAttribute('data-text-large'),
      compact: top.querySelector('.sz-write').dataset.compact, phase: top.querySelector('.sz-write').dataset.phase,
      grid: rect(q('write-grid')), card: rect(q('write-answer-card')), trace: rect(q('write-trace-layer')),
      hint: rect(q('write-hint-layer')), head: rect(top.querySelector('.sz-page__head')), foot, off,
      scrollW: document.documentElement.scrollWidth,
    };
  }, ids);
}

function square(b, size, tol = 1) {
  return !!b && Math.abs(b.width - size) <= tol && Math.abs(b.height - size) <= tol;
}

/** 存下的当前字笔画按 345 单位解码（core/ink-math decodeRawStrokes）。 */
async function storedStrokes(page, slot = 'A') {
  return page.evaluate(async s => {
    const { decodeRawStrokes, GRID } = await import('/src/core/ink-math.js');
    const cur = window.__shiziTest.getState().sessions[s].current;
    return { grid: GRID, rows: JSON.stringify(cur.strokes), strokes: decodeRawStrokes(cur.strokes) };
  }, slot);
}

/** 固化层笔迹的外接框，按画布宽高归一化（0–1）。 */
async function inkBox(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid-ink"]');
    const ctx = c.getContext('2d');
    const { width: w, height: h } = c;
    const data = ctx.getImageData(0, 0, w, h).data;
    let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (data[(y * w + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x0: x0 / w, x1: (x1 + 1) / w, y0: y0 / h, y1: (y1 + 1) / h, w, h };
  });
}

export default async function grid(page, ctx) {
  const { assert } = ctx;
  if (process.env.SHIZI_E2E_SCHEME) await page.emulateMedia({ colorScheme: process.env.SHIZI_E2E_SCHEME });

  // ------------------------------------------------------------------ ① 各视口 × 大字开 / 关
  for (const c of CASES) {
    const tag = `${c.view.width}×${c.view.height}`;
    ctx.step(`${tag}: grid ${c.grid} with system text L and XXXL — same size before and after the change (D36 / D29)`);
    await boot(page, ctx, c.view, { large: false });
    const sizes = [];
    for (const large of [false, true]) {
      await setLarge(page, large);
      const g = await geo(page);
      const t = `${tag}${large ? ' large' : ''}`;
      assert.equal(g.large, large, `${t}: data-text-large ${large ? 'on' : 'off'} (system text ${large ? LARGE_TEXT : 'L'})`);
      assert.equal(g.compact, large || c.view.height <= 760 ? 'true' : 'false', `${t}: compact layout only changes the arrangement`);
      assert.ok(square(g.grid, c.grid), `${t}: grid is ${c.grid}×${c.grid} ${JSON.stringify(g.grid)}`);
      assert.ok(g.grid.width >= 258 - 0.5 && g.grid.width <= 400 + 0.5, `${t}: grid within [258, 400]`);
      assert.ok(g.grid.left >= 20 - 0.5 && g.grid.right <= g.vw - 20 + 0.5, `${t}: ≥20pt from the screen edges (${g.grid.left}, ${g.vw - g.grid.right})`);
      assert.ok(g.scrollW <= g.vw, `${t}: no horizontal overflow`);
      assert.deepEqual(g.off, [], `${t}: buttons on the first screen`);
      if (c.grid > 258) assert.ok(g.grid.top >= g.head.bottom - 0.5 && g.grid.bottom <= g.foot.top + 0.5, `${t}: whole grid between header and footer`);
      sizes.push(g.grid.width);
    }
    assert.equal(sizes[0], sizes[1], `${tag}: grid edge unchanged by the system text size (${sizes[0]} → ${sizes[1]})`);
  }

  // ------------------------------------------------------------------ ② 各阶段同一边长
  for (const [view, large, size] of [[{ width: 375, height: 667 }, false, 317], [{ width: 393, height: 852 }, true, 353]]) {
    const tag = `${view.width}×${view.height}${large ? ' large' : ''}`;
    ctx.step(`${tag}: recall → 提示 → 写一笔 → 看答案 → 描一遍 → 自己写 all use grid ${size}`);
    await boot(page, ctx, view, { large });
    let g = await geo(page);
    assert.ok(square(g.grid, size), `${tag}: recall grid ${size}`);
    await page.click(topSel('write-hint'));
    await page.waitForSelector(`${topSel('write-hint-layer')}[data-state="shown"]`);
    await page.waitForTimeout(300);
    g = await geo(page);
    assert.ok(square(g.grid, size), `${tag}: grid unchanged after 提示 (${g.grid.width})`);
    assert.ok(!!g.hint && Math.abs(g.hint.width - size) <= 2.5 && Math.abs(g.hint.height - size) <= 2.5, `${tag}: hint layer fills the grid ${JSON.stringify(g.hint)}`);
    await drawStroke(page, HORIZONTAL);
    await waitStrokes(page, 1);
    await page.waitForTimeout(300);
    await page.mouse.move(1, 1);
    g = await geo(page);
    assert.ok(square(g.grid, size), `${tag}: grid unchanged after the first stroke`);

    await page.click(topSel('write-show-answer'));
    await page.waitForSelector(tid('write-answer-confirm'));
    await waitNavIdle(page);
    await page.click(tid('confirm-ok'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="write-answer-confirm"]'));
    await waitPhase(page, 'answer');
    await page.waitForSelector(`${topSel('write-answer-card')}[data-state="ready"]`);
    await page.waitForTimeout(300);
    g = await geo(page);
    assert.ok(g.card && Math.abs(g.card.width - g.card.height) < 1 && g.card.width <= size + 0.5 && g.card.width >= 200 - 0.5,
      `${tag}: answer card is square, 200 ≤ card ≤ grid ${size} (${g.card && g.card.width})`);
    if (!large && view.height > 760) assert.ok(square(g.card, size), `${tag}: standard layout: answer card = grid ${size}`);

    await page.click(topSel('write-answer-trace'));
    await waitPhase(page, 'trace');
    g = await geo(page);
    assert.ok(square(g.grid, size), `${tag}: trace grid ${size}`);
    assert.deepEqual((await geo(page, ['write-trace-done', 'write-answer-next'])).off, [], `${tag} trace: buttons on the first screen`);
    assert.ok(!!g.trace && Math.abs(g.trace.width - size) <= 2.5 && Math.abs(g.trace.height - size) <= 2.5, `${tag}: trace layer fills the grid ${JSON.stringify(g.trace)}`);
    await drawStroke(page, HORIZONTAL);
    await waitStrokes(page, 1);
    await page.waitForTimeout(PRESS_SETTLE_MS);
    await page.click(topSel('write-trace-done'));
    await waitPhase(page, 'retrace');
    g = await geo(page, ['write-retrace-trace', 'write-answer-next']);
    assert.ok(square(g.grid, size), `${tag}: retrace grid ${size}`);
    assert.deepEqual(g.off, [], `${tag} retrace: buttons on the first screen`);
  }

  // ------------------------------------------------------------------ ③ 落点：345 单位存储，只缩放显示
  ctx.step('375×667 (grid 317): a stroke drawn at grid-relative (0.2,0.5)→(0.8,0.5) is stored in 345 units and painted at the same relative place');
  await boot(page, ctx, { width: 375, height: 667 }, { large: false });
  let g = await geo(page);
  assert.ok(square(g.grid, 317), '317 grid (not 345)');
  await drawStroke(page, HORIZONTAL);
  await waitStrokes(page, 1);
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.strokes.length === 1);
  const st = await storedStrokes(page);
  assert.equal(st.grid, 345, 'internal grid is 345 units');
  const pts = st.strokes[0];
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  assert.ok(near(Math.min(...xs), 0.2 * 345, 2) && near(Math.max(...xs), 0.8 * 345, 2),
    `stored x spans 0.2–0.8 of 345 units (${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)} vs ${(0.2 * 345).toFixed(1)}–${(0.8 * 345).toFixed(1)}), not screen pixels`);
  assert.ok(ys.every(y => near(y, 0.5 * 345, 2)), `stored y stays at 0.5 of 345 units (${Math.min(...ys).toFixed(1)}–${Math.max(...ys).toFixed(1)})`);
  assert.ok(Math.max(...xs) <= 345 && Math.min(...xs) >= 0, 'stored points inside 0–345');
  assert.ok(await canvasInk(page, 'write-grid-ink') > 200, 'stroke painted on the solid layer');
  let box = await inkBox(page);
  assert.ok(box && near(box.x0, 0.2, 0.04) && near(box.x1, 0.8, 0.04) && near(box.y0 + box.y1, 1, 0.08),
    `painted stroke sits at the same relative place on the 317 grid ${JSON.stringify(box)}`);
  const stored0 = st.rows;

  ctx.step('same page: shrink to 360×640 (grid 290), system text XXXL and back, grow to 440×956 (grid 400) — stored strokes byte-identical, ink repainted at the same relative place');
  for (const [view, large, size] of [[{ width: 360, height: 640 }, false, 290], [{ width: 360, height: 640 }, true, 290], [{ width: 440, height: 956 }, true, 400],
    [{ width: 440, height: 956 }, false, 400], [{ width: 393, height: 852 }, false, 353]]) {
    await page.setViewportSize(view);
    await setLarge(page, large);
    await page.waitForTimeout(250);
    g = await geo(page);
    const t = `${view.width}×${view.height}${large ? ' large' : ''}`;
    assert.ok(square(g.grid, size), `${t}: grid ${size} (${g.grid && g.grid.width})`);
    assert.equal((await storedStrokes(page)).rows, stored0, `${t}: stored strokes unchanged (345 units)`);
    box = await inkBox(page);
    assert.ok(box && near(box.x0, 0.2, 0.04) && near(box.x1, 0.8, 0.04) && near(box.y0 + box.y1, 1, 0.08),
      `${t}: ink repainted at the same relative place ${JSON.stringify(box)}`);
    assert.ok(box.w >= size * 1 - 2, `${t}: ink canvas resolution follows the grid (${box.w}px for ${size}pt)`);
  }

  ctx.step('440×956 (grid 400): a vertical stroke at (0.5,0.2)→(0.5,0.8) is stored at 0.5 / 0.2–0.8 of 345 units');
  await boot(page, ctx, { width: 440, height: 956 }, { large: true });
  g = await geo(page);
  assert.ok(square(g.grid, 400), '400 grid at the cap');
  await drawStroke(page, VERTICAL);
  await waitStrokes(page, 1);
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.strokes.length === 1);
  const v = (await storedStrokes(page)).strokes[0];
  assert.ok(v.every(p => near(p.x, 0.5 * 345, 2)) && near(Math.min(...v.map(p => p.y)), 0.2 * 345, 2) && near(Math.max(...v.map(p => p.y)), 0.8 * 345, 2),
    `vertical stroke stored in 345 units (x≈172.5, y 69–276): ${v[0].x.toFixed(1)}, ${Math.min(...v.map(p => p.y)).toFixed(1)}–${Math.max(...v.map(p => p.y)).toFixed(1)}`);

  await setLarge(page, false);
  await page.setViewportSize({ width: 393, height: 852 });
}
