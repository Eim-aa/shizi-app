// 第三轮 C3-R（D53 ⑤；V3-03 / T3-06 / N3-04 预览部分、V3-05 月帖笺底）：分享预览成一张「图」。
//   · 预览图放在比弹层深一档的底（field）上，图自己保留笺色；0.5pt 外缘 + 很轻的投影（0 2 12）；深色同样有 0.5pt 边；
//   · 1:1 与 3:4 切换时图的外框真的变形（270×270 ↔ 225×300），桌面高度不变（弹层不跳）；
//   · 没有虚线框；AX 档比例两项上下排；
//   · 月字帖：笺底只铺在格框里面——.sz-month 与格框同宽，月帖页版心不再两侧多出 4pt，笺底下方没有多出来的一条。

import { bootTestHost, setTextSize, topSel, waitNavIdle } from './helpers.mjs';
import { openResultPage, seedMonthRecords, seedWork } from './work-helpers.mjs';

const lum = rgb => {
  const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

async function openPreview(page) {
  await page.click(topSel('result-share'));
  await page.waitForFunction(() => {
    const r = document.querySelector('[data-testid="image-preview"]');
    return !!r && r.dataset.state === 'ready';
  });
  await page.waitForTimeout(450);
}

const previewGeometry = page => page.evaluate(() => {
  const q = id => document.querySelector(`[data-testid="${id}"]`);
  const rect = el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  const stage = q('image-stage');
  const board = q('image-board');
  const sheet = q('image-sheet');
  const cs = el => getComputedStyle(el);
  return {
    stage: { ...rect(stage), bg: cs(stage).backgroundColor },
    board: { ...rect(board), bg: cs(board.querySelector('canvas') ? board : board).backgroundColor, shadow: cs(board).boxShadow, canvasW: board.querySelector('canvas') && board.querySelector('canvas').width },
    sheet: { bg: cs(sheet).backgroundColor, ...rect(sheet) },
    field: cs(document.documentElement).getPropertyValue('--field').trim(),
    dashed: [...document.querySelectorAll('[data-testid="image-preview"] *')].filter(e => cs(e).borderStyle.includes('dashed')).length,
    ratio: q('image-preview').dataset.ratio,
    boardSheet: (() => { const t = document.createElement('div'); t.className = 't-light'; t.style.cssText = 'position:absolute;background:var(--sheet)'; document.body.appendChild(t); const c = cs(t).backgroundColor; t.remove(); return c; })(),
  };
});

export default async function c3rPreview(page, ctx) {
  const { assert, step } = ctx;
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await bootTestHost(page, ctx.baseURL);

  step('light: the preview image sits on a field-coloured desk inside the sheet, with a 0.5pt edge and a light drop shadow; no dashed boxes');
  const g = await seedWork(page, { id: 's951', chars: ['永', '和', '春'], steps: ['correct', 'correct', 'correct'] });
  await openResultPage(page, g);
  await openPreview(page);
  const a = await previewGeometry(page);
  assert.equal(a.ratio, '1:1', '3 chars default to 1:1');
  assert.ok(Math.abs(a.board.w - 270) <= 1 && Math.abs(a.board.h - 270) <= 1, `1:1 board is 270 × 270 (${a.board.w} × ${a.board.h})`);
  assert.ok(a.stage.bg !== a.sheet.bg, `the desk is not the sheet colour (${a.stage.bg} vs ${a.sheet.bg})`);
  assert.ok(ratio(a.stage.bg, a.boardSheet) >= 1.1, `desk vs paper: a visible step (${ratio(a.stage.bg, a.boardSheet).toFixed(2)}:1)`);
  assert.ok(/0px 0px 0px 0\.5px/.test(a.board.shadow), `0.5pt edge (${a.board.shadow})`);
  assert.ok(/0px 2px 12px/.test(a.board.shadow), `light drop shadow 0 2 12 (${a.board.shadow})`);
  assert.equal(a.dashed, 0, 'no dashed boxes in the preview');
  assert.ok(a.board.x > a.stage.x + 20 && a.board.x + a.board.w < a.stage.x + a.stage.w - 20, 'the board floats inside the desk with margin on both sides');

  step('switching 1:1 → 3:4 visibly reshapes the board; the desk height does not change');
  await page.click(`${'[data-testid="image-ratio"]'}[data-ratio="3:4"]`);
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]').dataset.ratio === '3:4' && !!document.querySelector('[data-testid="image-board"] canvas'));
  await page.waitForTimeout(450);
  const b = await previewGeometry(page);
  assert.ok(Math.abs(b.board.w - 225) <= 1 && Math.abs(b.board.h - 300) <= 1, `3:4 board is 225 × 300 (${b.board.w} × ${b.board.h})`);
  assert.ok(Math.abs(b.board.h - a.board.h) >= 25 && Math.abs(b.board.w - a.board.w) >= 40, 'the two ratios differ by at least 25pt tall and 40pt wide: the change can be seen');
  assert.ok(Math.abs(b.stage.h - a.stage.h) <= 1, `the desk keeps its height (${a.stage.h} → ${b.stage.h}), the sheet does not jump`);
  await page.click('[data-testid="image-done"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await waitNavIdle(page);

  step('dark: the same desk and the same 0.5pt edge');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  await page.click(topSel('result-share'));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
  await page.waitForTimeout(450);
  const d = await previewGeometry(page);
  assert.ok(/0px 0px 0px 0\.5px/.test(d.board.shadow), 'dark: 0.5pt edge too');
  assert.ok(d.stage.bg !== a.stage.bg, 'dark: the desk takes the dark field colour');
  assert.ok(ratio(d.stage.bg, d.boardSheet) >= 3, `dark: the light paper stands off the desk (${ratio(d.stage.bg, d.boardSheet).toFixed(1)}:1)`);
  await page.click('[data-testid="image-done"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await waitNavIdle(page);

  step('AX: the ratio control stacks its two options vertically (no 「3:41:1」)');
  await setTextSize(page, 'AX3');
  await page.waitForTimeout(500);
  await page.click(topSel('result-share'));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
  const ax = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('[data-testid="image-ratio"]')].map(b => b.getBoundingClientRect());
    return { n: bs.length, overlap: bs.length > 1 && !(bs[0].bottom <= bs[1].top + 0.5 || bs[0].right <= bs[1].left + 0.5), stacked: bs.length > 1 && bs[1].top >= bs[0].bottom - 0.5 };
  });
  assert.equal(ax.n, 2, 'two ratio options');
  assert.ok(ax.stacked && !ax.overlap, 'AX: stacked, not overlapping');
  await page.waitForTimeout(500);
  await page.click('[data-testid="image-done"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await setTextSize(page, 'L');

  step('month page: the sheet colour stays inside the frame — the paper is as wide as the grid, no strip around or below it');
  await seedMonthRecords(page, { entries: [{ day: '2026-09-02', chars: '永和春' }, { day: '2026-09-04', chars: '大中' }] });
  await page.evaluate(async () => { (await import('/src/ui/router.js')).nav.push('month', { month: '2026-09' }); });
  await page.waitForSelector(topSel('month-screen'));
  await waitNavIdle(page);
  const m = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const paper = top.querySelector('[data-testid="month-paper"]');
    const grid = paper.querySelector('.sz-month__grid');
    const sheets = [...paper.querySelectorAll('[data-testid="month-sheet"]')];
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const page0 = top.querySelector('[data-testid="month-body"]');
    const title = top.querySelector('[data-testid="month-title"]');
    const kuan = top.querySelector('[data-testid="month-kuan"]');
    return {
      paper: rect(paper), grid: rect(grid), sheets: sheets.map(rect), paperBg: getComputedStyle(paper).backgroundImage + getComputedStyle(paper).backgroundColor,
      body: rect(page0), title: rect(title), kuan: rect(kuan), vw: document.documentElement.clientWidth,
      sheetBgs: sheets.map(s => getComputedStyle(s).backgroundColor),
    };
  });
  assert.ok(Math.abs(m.paper.w - m.grid.w) <= 0.5, `the paper is exactly as wide as the grid (${m.paper.w} vs ${m.grid.w})`);
  assert.ok(m.sheets.length >= 1 && m.sheets.every(s => s.x >= m.grid.x - 0.5 && s.r <= m.grid.r + 0.5 && s.y >= m.grid.y - 0.5 && s.b <= m.grid.b + 0.5), 'the sheet colour lies inside the frame');
  assert.ok(/rgba\(0, 0, 0, 0\)$/.test(m.paperBg) && !/url\(/.test(m.paperBg), `the paper element itself paints nothing (${m.paperBg})`);
  assert.ok(m.body.w >= m.vw - 41 && m.body.w <= m.vw - 39, `the month page content is the plain 20pt page width, not widened by 4pt a side (${m.body.w})`);
  assert.ok(Math.abs(m.title.x - 20) <= 0.5, 'the title sits on the 20pt line');
  assert.ok(m.kuan.y >= m.grid.b, 'the 落款 is below the frame, on the page paper');
}
