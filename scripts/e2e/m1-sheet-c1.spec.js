// M1（D57）：「我的」页字帖改为方案 C1「字帖格 · 按字数排」。
//   · 只有一层框（阶梯形外框一条 path，格间只有 guide 线，没有框中框）；有几个字几格、没有空格；
//   · 3 字：一行三个大格（110pt）；72 字：8 列 × 9 行；
//   · 标题（宋 22）与「保存图片」同一行；AX5 下两者不叠；
//   · 日期骑在该格上边线上（纸色衬底），只标每天的第一个字，整页只有一天时不标；
//   · 屏上与「保存图片」导出图同一版式（列数 / 行数 / 字 / 日期 / 阶梯形）——月字帖页也一样。
// 浅 / 深 × 390×844 / 375×667。环境变量 M1_SHOTS_DIR 给了就顺手截图（自查用）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { bootTestHost, setTextSize, topSel, waitNavIdle } from './helpers.mjs';
import { seedMonthRecords } from './work-helpers.mjs';

const POOL = Array.from(new Set(Array.from('的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山无')));

function entriesFor(n) {
  if (n === 3) return [{ day: '2026-09-10', chars: POOL.slice(0, 3).join('') }];
  const days = [1, 2, 3, 5, 6, 8, 9, 10, 12, 13, 15, 16, 17, 19, 20, 22, 23, 24];
  const counts = [3, 5, 2, 4, 3, 5, 3, 2, 4, 3, 3, 5, 2, 3, 4, 3, 2, 4];
  const out = [];
  let k = 0;
  days.forEach((d, i) => {
    const take = i === days.length - 1 ? n - k : counts[i];
    out.push({ day: `2026-09-${String(d).padStart(2, '0')}`, chars: POOL.slice(k, k + take).join('') });
    k += take;
  });
  return out;
}

const expectCols = n => (n <= 4 ? n : n <= 12 ? 4 : n <= 24 ? 6 : 8);

const probe = (page, { grid, cell, save, title }) => page.evaluate(({ grid, cell, save, title }) => {
  const top = document.querySelector('.sz-layer[data-top="true"]');
  const q = id => top.querySelector(`[data-testid="${id}"]`);
  const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const g = q(grid);
  const cells = [...top.querySelectorAll(`[data-testid="${cell}"]`)];
  const stage = g.querySelector('[data-testid="month-stage"]');
  const bordered = [...g.querySelectorAll('*')].filter(e => !e.matches('canvas') && ['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(getComputedStyle(e)[`border${s}Width`]) > 0 && getComputedStyle(e)[`border${s}Style`] !== 'none'));
  const shadowed = [...g.querySelectorAll('*')].filter(e => getComputedStyle(e).boxShadow !== 'none');
  const tags = [...g.querySelectorAll('[data-testid="month-tag"]')].map(e => {
    const c = e.closest(`[data-testid="${cell}"]`);
    const er = e.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    return { text: e.textContent.trim(), mid: er.top + er.height / 2 - cr.top, bg: getComputedStyle(e).backgroundColor, ch: c.dataset.char, size: getComputedStyle(e).fontSize };
  });
  const paper = (() => { const t = document.createElement('i'); t.style.backgroundColor = 'var(--paper)'; document.body.appendChild(t); const c = getComputedStyle(t).backgroundColor; t.remove(); return c; })();
  const out = {
    n: Number(g.dataset.n), cols: Number(g.dataset.cols), rows: Number(g.dataset.rows), c: Number(g.dataset.cell), full: g.dataset.full,
    cellRects: cells.map(rect), chars: cells.map(c => c.dataset.char).join(''), cellTags: cells.map(c => c.dataset.tag),
    stage: rect(stage), frames: g.querySelectorAll('[data-testid="month-frame"]').length, legacyFrames: g.querySelectorAll('.sz-work__frame').length,
    bordered: bordered.length, shadowed: shadowed.length, tags, paper,
    seal: q(g.dataset.testid === 'mine-sheet-grid' ? 'mine-sheet-seal' : 'month-seal') ? rect(q(g.dataset.testid === 'mine-sheet-grid' ? 'mine-sheet-seal' : 'month-seal')) : null,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
  if (save) {
    const s = q(save);
    const t = q(title);
    out.head = { save: s ? rect(s) : null, title: t ? rect(t) : null, titleFont: t ? getComputedStyle(t).fontFamily : '', titleSize: t ? getComputedStyle(t).fontSize : '', saveSize: s ? getComputedStyle(s).fontSize : '' };
  }
  return out;
}, { grid, cell, save, title });

async function exportOf(page, month, wantImages = false) {
  return page.evaluate(async ([m, images]) => {
    const { buildImageJob } = await import('/src/ui/images-entry.js');
    const job = buildImageJob({ kind: 'month', month: m });
    const out = {};
    for (const ratio of ['3:4', '1:1']) {
      const r = await job.renderPage(0, ratio, { scale: images ? 1 : 0.5 });
      const d = r.canvas.dataset;
      out[ratio] = { layout: d.layout, columns: Number(d.columns), rows: Number(d.rows), n: Number(d.n), members: d.members, tags: d.tags, cell: Number(d.cell), w: Number(d.logicalWidth), h: Number(d.logicalHeight), top: Number(d.top) };
      if (images) out[ratio].url = r.canvas.toDataURL('image/png');
    }
    return out;
  }, [month, wantImages]);
}

export default async function m1SheetC1(page0, ctx) {
  const { assert, step } = ctx;
  const shots = process.env.M1_SHOTS_DIR || '';
  if (shots) mkdirSync(shots, { recursive: true });
  let page = page0;
  let first = true;
  for (const n of [3, 72]) {
    for (const scheme of ['light', 'dark']) {
      for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
        const tag = `${n} 字 ${scheme} ${vp.width}×${vp.height}`;
        if (!first) { await page.close(); page = await page0.context().newPage(); }
        first = false;
        await page.setViewportSize(vp);
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await bootTestHost(page, ctx.baseURL);
        await seedMonthRecords(page, { entries: entriesFor(n) });
        await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
        await page.waitForSelector(topSel('mine-sheet-grid'));
        await waitNavIdle(page);
        await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="mine-sheet-cell-canvas"]')].every(c => c.dataset.painted === 'true' || c.dataset.glyph));
        await page.waitForTimeout(200);

        step(`${tag}: 「我的」页字帖 = C1`);
        const mine = await probe(page, { grid: 'mine-sheet-grid', cell: 'mine-sheet-cell', save: 'mine-sheet-save', title: 'mine-sheet-title' });
        const cols = expectCols(n);
        const rows = Math.ceil(n / cols);
        assert.equal(mine.n, n, `${tag}: n`);
        assert.equal(mine.cellRects.length, n, `${tag}: 有几个字几格`);
        assert.equal(mine.cols, cols, `${tag}: 列数`);
        assert.equal(mine.rows, rows, `${tag}: 行数`);
        const uniq = new Set(mine.cellRects.map(r => `${Math.round(r.x)},${Math.round(r.y)}`));
        assert.equal(uniq.size, n, `${tag}: 格子位置互不重叠`);
        assert.ok(mine.cellRects.every(r => Math.abs(r.w - mine.c) < 0.6 && Math.abs(r.h - mine.c) < 0.6), `${tag}: 格子等大 (${mine.c}; ${JSON.stringify(mine.cellRects.find(r => Math.abs(r.w - mine.c) >= 0.6))})`);
        assert.ok(Math.abs(mine.stage.h - rows * mine.c) < 0.6 && Math.abs(mine.stage.w - cols * mine.c) < 0.6, `${tag}: 网格正好是 列×行 个格，没有空格`);
        assert.equal(mine.frames, 1, `${tag}: 只有一层框`);
        assert.equal(mine.legacyFrames, 0, `${tag}: 没有第二层框`);
        assert.equal(mine.bordered, 0, `${tag}: 字帖里没有任何 CSS 边框（框中框）`);
        if (n === 3) assert.ok(mine.c >= 108 && mine.c <= 110, `${tag}: 3 字约 110pt 一行 (${mine.c})`);
        else assert.ok(mine.c >= 40 && mine.c <= 44, `${tag}: 72 字 8 列 (${mine.c})`);
        const lastN = n - (rows - 1) * cols;
        assert.equal(mine.full, lastN === cols ? 'true' : 'false', `${tag}: 末行满否`);
        // 落款与印紧跟末字
        const last = mine.cellRects[n - 1];
        if (lastN === cols) assert.ok(mine.seal.y >= last.b - 1 && mine.seal.y - last.b <= 14 && Math.abs(mine.seal.r - last.r) < 1.5, `${tag}: 印在末格正下方、右沿对齐`);
        else assert.ok(Math.abs(mine.seal.b - last.b) < 1.5 && mine.seal.x - last.r <= 10 && mine.seal.x >= last.r, `${tag}: 印在末格右侧、底边齐`);
        // 标题与保存图片同一行
        assert.ok(mine.head.save && mine.head.title, `${tag}: 有标题与保存图片`);
        assert.ok(Math.abs((mine.head.save.y + mine.head.save.h / 2) - (mine.head.title.y + mine.head.title.h / 2)) <= 4, `${tag}: 标题与保存图片同一行`);
        assert.ok(mine.head.title.r <= mine.head.save.x + 1, `${tag}: 标题在左、保存图片在右，不叠`);
        assert.ok(/Songti|STSong|Noto Serif|Serif/i.test(mine.head.titleFont) && mine.head.titleSize === '22px', `${tag}: 标题宋 22 (${mine.head.titleFont} ${mine.head.titleSize})`);
        assert.equal(mine.head.saveSize, '15px', `${tag}: 保存图片 15`);
        // 日期
        if (n === 3) assert.equal(mine.tags.length, 0, `${tag}: 整页只有一天，不标日期`);
        else {
          const days = mine.cellTags.filter(Boolean);
          assert.equal(days.length, 18, `${tag}: 18 天各标第一个字`);
          assert.ok(mine.tags.every(t => Math.abs(t.mid) <= 1.5), `${tag}: 日期骑在格的上边线上 (${mine.tags.map(t => t.mid.toFixed(1))})`);
          assert.ok(mine.tags.every(t => t.bg === mine.paper), `${tag}: 日期用纸色衬底断开格线`);
        }
        assert.equal(mine.hScroll, false, `${tag}: 不横向溢出`);
        if (shots) await page.screenshot({ path: `${shots}/mine-${n}-${scheme}-${vp.width}x${vp.height}.png`, fullPage: false });

        step(`${tag}: 屏上与「保存图片」导出图同一版式`);
        const ex = await exportOf(page, '2026-09', !!shots && scheme === 'light' && vp.width === 390);
        if (shots && ex['3:4'].url) for (const ratio of ['3:4', '1:1']) writeFileSync(`${shots}/export-${n}-${ratio.replace(':', 'x')}.png`, Buffer.from(ex[ratio].url.split(',')[1], 'base64'));
        for (const ratio of ['3:4', '1:1']) {
          const e = ex[ratio];
          assert.equal(e.layout, 'sheet', `${tag} ${ratio}: 字帖格版式`);
          assert.equal(e.n, n, `${tag} ${ratio}: 字数`);
          assert.equal(e.members, mine.chars, `${tag} ${ratio}: 成员与顺序和屏上一致`);
          assert.equal(e.columns, mine.cols, `${tag} ${ratio}: 列数和屏上一致`);
          assert.equal(e.rows, mine.rows, `${tag} ${ratio}: 行数和屏上一致`);
          assert.equal(e.tags.split('|').map(x => x || '').join('|'), mine.cellTags.join('|'), `${tag} ${ratio}: 日期位置和屏上一致`);
        }
        if (n === 3) assert.ok(Math.abs(ex['3:4'].cell / 2.69 - 110) <= 1.5, `${tag}: 导出图 3 字格宽约 110pt 当量`);

        step(`${tag}: 月字帖页同一版式`);
        await page.evaluate(async () => (await import('/src/ui/screens/mine/month.js')).openMonth({ month: '2026-09' }));
        await page.waitForSelector(topSel('month-paper'));
        await waitNavIdle(page);
        await page.waitForTimeout(200);
        const month = await probe(page, { grid: 'month-paper', cell: 'month-cell' });
        assert.equal(month.cols, mine.cols, `${tag}: 月字帖页列数和「我的」页一致`);
        assert.equal(month.c, mine.c, `${tag}: 月字帖页格宽和「我的」页一致`);
        assert.equal(month.chars, mine.chars, `${tag}: 月字帖页成员一致`);
        assert.equal(month.frames, 1, `${tag}: 月字帖页只有一层框`);
        assert.equal(month.bordered, 0, `${tag}: 月字帖页没有框中框`);
        assert.equal(month.cellTags.join('|'), mine.cellTags.join('|'), `${tag}: 月字帖页日期一致`);
        if (shots) await page.screenshot({ path: `${shots}/month-${n}-${scheme}-${vp.width}x${vp.height}.png`, fullPage: false });
      }
    }
  }

  // AX5：标题与保存图片不叠、格内不叠字、不横向溢出
  for (const n of [3, 72]) {
    const tag = `AX5 ${n} 字 375×667`;
    await page.close();
    page = await page0.context().newPage();
    await page.setViewportSize({ width: 375, height: 667 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await bootTestHost(page, ctx.baseURL);
    await seedMonthRecords(page, { entries: entriesFor(n) });
    await setTextSize(page, 'AX5');
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
    await page.waitForSelector(topSel('mine-sheet-grid'));
    await waitNavIdle(page);
    await page.waitForTimeout(300);
    step(`${tag}: 不叠字`);
    const a = await probe(page, { grid: 'mine-sheet-grid', cell: 'mine-sheet-cell', save: 'mine-sheet-save', title: 'mine-sheet-title' });
    const t = a.head.title;
    const s = a.head.save;
    const overlap = !(t.r <= s.x + 0.5 || s.r <= t.x + 0.5 || t.b <= s.y + 0.5 || s.b <= t.y + 0.5);
    assert.equal(overlap, false, `${tag}: 标题与保存图片不重叠`);
    assert.equal(a.hScroll, false, `${tag}: 不横向溢出`);
    assert.equal(a.cellRects.length, n, `${tag}: 格数仍等于字数`);
    assert.equal(a.bordered, 0, `${tag}: 没有框中框`);
    // 日期角标之间不叠、不压到别的格的字（角标在上边线，只与邻格角标比）
    const tagRects = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="month-tag"]')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.right, r.bottom]; }));
    let clash = 0;
    for (let i = 0; i < tagRects.length; i += 1) for (let j = i + 1; j < tagRects.length; j += 1) {
      const A = tagRects[i]; const B = tagRects[j];
      if (!(A[2] <= B[0] || B[2] <= A[0] || A[3] <= B[1] || B[3] <= A[1])) clash += 1;
    }
    assert.equal(clash, 0, `${tag}: 日期角标互不重叠`);
    if (shots) await page.screenshot({ path: `${shots}/mine-${n}-ax5-375x667.png`, fullPage: false });
  }
}
