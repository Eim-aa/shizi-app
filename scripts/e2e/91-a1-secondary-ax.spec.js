// R2-A1（A2-03；03 P233）：次级页在 AX 档不叠字。AX5 × 375×667（浅 / 深）+ AX3 × 390×844：
//   - 「我的」：周条换成一句话（mine-week-summary「写了 n 天」），7 格周条（mine-week-day）不画；「这一周」标题不被挤成一字一行；
//   - 练习记录：月历换成每天一行的列表（records-calendar[data-mode=list]，每个有记录的日子一行「10月3日 · 记了 n 个字」，行数 = 有记录的天数），
//     点一行把那天写的字展开在该行紧下面、再点收起；没有 7 列月历格；
//   - 字帖格的日期角标（我的 / 练习记录 / 月字帖页的 .sz-scell__tag / .sz-mcell__tag）不显示，日期进格的读屏名称（aria-label 含「10月3日」）；
//   - 单字详情：记录格两列，日期与「写对」落在格内；
//   - 四个页面的文字块两两不相交（取每个文字节点字框的中间一段，排除包含关系，相交面积 ≤ 4px²）；没有横向溢出。
//   标准档（L）的 7 列月历、周条、角标原样（回归断言）。
// 新旧对照：旧实现下 AX5 的周条日期挤成「1011」、周标题一字一行、月历数字行相互叠、字帖角标压在笔迹上、详情日期溢出格外。
import { bootTestHost, setTextSize, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

/* eslint-disable no-undef */
const CHARS = [...'疆酱肆酝春嚷醋膝窗屉鼎根据永和大聚思花男昌'];
const entries = CHARS.map((c, k) => ({ char: c, at: `2026-10-0${1 + (k % 5)}T20:${String(10 + k).padStart(2, '0')}:00`, judgment: k % 7 === 0 ? 'wrong' : 'correct' }));
['安', '爱', '白'].forEach((c, k) => entries.push({ char: c, at: `2026-09-2${k}T20:00:00` }));
const SPEC = { entries, clock: '2026-10-05T19:30:00' };

/** 顶层页面里文字块两两是否相交（文字节点行框；父子 / 祖先后代不算；相交面积 > 4px² 报出来）。 */
function overlapReport() {
  const layer = document.querySelector('.sz-layer[data-top="true"]');
  const body = layer.querySelector('.sz-page__body') || layer;
  const items = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      // 取字框中间的一段（竖向中间 70%、横向中间 90%）：字体的内容区比行高高一截，相邻两行字框会各伸进对方几像素，那不是叠字
      // 在视口内但被别的东西盖住（页面内容滚到固定的 Tab 栏下面）：不算叠字，跳过；视口外没法点测，照检
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit && !el.contains(hit) && !hit.contains(el)) continue;
      }
      const dy = r.height * 0.15;
      const dx = r.width * 0.05;
      items.push({ el, text: node.textContent.trim().slice(0, 12), left: r.left + dx, right: r.right - dx, top: r.top + dy, bottom: r.bottom - dy });
    }
  }
  const bad = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0 && h > 0 && w * h > 4) bad.push(`${a.text} × ${b.text} (${Math.round(w)}×${Math.round(h)})`);
    }
  }
  const root = document.documentElement;
  return { bad: bad.slice(0, 6), nTexts: items.length, hOverflow: root.scrollWidth > root.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1 };
}

async function pushScreen(page, name, params, ready) {
  await page.evaluate(async ([n, p]) => (await import('/src/ui/router.js')).nav.push(n, p), [name, params]);
  await page.waitForSelector(ready);
  await waitNavIdle(page);
}

export default async function run(page0, ctx) {
  const { assert, step } = ctx;
  const runs = [
    { tag: 'AX5 375×667 light', width: 375, height: 667, scheme: 'light', size: 'AX5' },
    { tag: 'AX5 375×667 dark', width: 375, height: 667, scheme: 'dark', size: 'AX5' },
    { tag: 'AX3 390×844 light', width: 390, height: 844, scheme: 'light', size: 'AX3' },
    { tag: 'L 390×844 light', width: 390, height: 844, scheme: 'light', size: 'L' },
  ];
  let page = page0;
  for (const [i, v] of runs.entries()) {
    const ax = v.size !== 'L';
    if (i > 0) { await page.close(); page = await page0.context().newPage(); }
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.emulateMedia({ colorScheme: v.scheme });
    await bootTestHost(page, ctx.baseURL);
    await seedHomeSpec(page, SPEC);
    if (ax) await setTextSize(page, v.size);

    step(`${v.tag}: 「我的」周条`);
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
    await page.waitForSelector('[data-testid="mine-week-title"]');
    await waitNavIdle(page);
    const mine = await page.evaluate(() => {
      const q = id => document.querySelector(`[data-testid="${id}"]`);
      const title = q('mine-week-title');
      const lh = parseFloat(getComputedStyle(title).lineHeight);
      return {
        summary: q('mine-week-summary') ? { text: q('mine-week-summary').textContent.trim(), n: q('mine-week-summary').dataset.n } : null,
        days: document.querySelectorAll('[data-testid="mine-week-day"]').length,
        titleLines: Math.round(title.getBoundingClientRect().height / lh),
      };
    });
    if (ax) {
      assert.ok(mine.summary && /^写了 \d+ 天$/.test(mine.summary.text), `${v.tag}: the week strip is one sentence (${mine.summary && mine.summary.text})`);
      assert.equal(mine.days, 0, `${v.tag}: no 7-cell week strip in AX`);
      assert.equal(mine.titleLines, 1, `${v.tag}: 「这一周」 is one line, not one character per line (${mine.titleLines})`);
    } else {
      assert.equal(mine.summary, null, `${v.tag}: no sentence at standard size`);
      assert.equal(mine.days, 7, `${v.tag}: the 7-cell week strip is unchanged at standard size`);
    }
    let rep = await page.evaluate(overlapReport);
    assert.deepEqual(rep.bad, [], `${v.tag}: mine page has no overlapping text (${rep.nTexts} text boxes)`);
    assert.equal(rep.hOverflow, false, `${v.tag}: mine page has no horizontal overflow`);

    step(`${v.tag}: 练习记录`);
    await pushScreen(page, 'records', { month: '2026-10' }, '[data-testid="records-calendar"]');
    const days = await page.evaluate(() => ({
      mode: document.querySelector('[data-testid="records-calendar"]').dataset.mode || null,
      rows: [...document.querySelectorAll('[data-testid="records-day"][data-has="true"]')].map(b => ({ day: b.dataset.day, text: b.textContent.trim().replace(/\s+/g, ' ') })),
      cells: document.querySelectorAll('.sz-rec__cal .sz-rec__day').length,
      recordDays: Number(document.querySelector('[data-testid="records-body"]').dataset.recordDays),
    }));
    assert.equal(days.rows.length, days.recordDays, `${v.tag}: one row / dot per day with a record (${days.rows.length} vs ${days.recordDays})`);
    if (ax) {
      assert.equal(days.mode, 'list', `${v.tag}: the month is a list in AX`);
      assert.equal(days.cells, 0, `${v.tag}: no 7-column calendar cells in AX`);
      for (const r of days.rows) assert.ok(/^10月\d+日 · 记了 \d+ 个字$/.test(r.text), `${v.tag}: row text 「${r.text}」`);
      const first = page.locator('[data-testid="records-day"][data-has="true"]').first();
      await first.scrollIntoViewIfNeeded();
      const vis = await first.evaluate(el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: document.documentElement.clientWidth, vh: window.innerHeight }; });
      assert.ok(vis.l >= 0 && vis.r <= vis.vw && vis.t >= 0 && vis.b <= vis.vh, `${v.tag}: the first day row is visible in the viewport ${JSON.stringify(vis)}`);
      // 点第二行：那天写的字紧跟在该行下面；再点收起
      const second = page.locator('[data-testid="records-day"][data-has="true"]').nth(1);
      const dayKey = await second.getAttribute('data-day');
      await second.click();
      await page.waitForSelector('[data-testid="records-daylist"], [data-testid="records-daylist-paper"]');
      const placed = await page.evaluate(day => {
        const row = document.querySelector(`[data-testid="records-day"][data-day="${day}"]`);
        const list = document.querySelector('[data-testid="records-daylist"]');
        return { sameItem: !!(list && row.closest('.sz-rec__axitem').contains(list)), below: list ? list.getBoundingClientRect().top >= row.getBoundingClientRect().bottom - 1 : false, pressed: row.getAttribute('aria-pressed') };
      }, dayKey);
      assert.deepEqual(placed, { sameItem: true, below: true, pressed: 'true' }, `${v.tag}: the day's characters open right under its row`);
      rep = await page.evaluate(overlapReport);
      assert.deepEqual(rep.bad, [], `${v.tag}: records page (list + day characters) has no overlapping text (${rep.nTexts} text boxes)`);
      await page.waitForTimeout(450);
      await second.click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="records-daylist"]'));
    } else {
      assert.equal(days.mode, null, `${v.tag}: the 7-column calendar is unchanged at standard size`);
      assert.equal(days.cells > 28, true, `${v.tag}: calendar cells (${days.cells})`);
    }
    // 字帖格的日期角标：AX 不画，日期在格的读屏名称里；标准档照旧
    const tags = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-testid="records-sheet-cell"]')];
      const tag = el => el.querySelector('.sz-mcell__tag, .sz-scell__tag');
      return {
        n: cells.length,
        shown: cells.filter(c => { const t = tag(c); return t && getComputedStyle(t).display !== 'none'; }).length,
        dated: cells.filter(c => /10月\d+日|9月\d+日/.test(c.getAttribute('aria-label') || '')).length,
        hasTagNode: cells.filter(c => !!tag(c)).length,
      };
    });
    assert.ok(tags.n > 0, `${v.tag}: month sheet on the records page has cells`);
    assert.equal(tags.dated, tags.n, `${v.tag}: every sheet cell's screen-reader name carries its date`);
    if (ax) assert.equal(tags.shown, 0, `${v.tag}: no corner day tags in AX (${tags.shown})`);
    else assert.ok(tags.shown > 0, `${v.tag}: corner day tags unchanged at standard size`);
    rep = await page.evaluate(overlapReport);
    assert.equal(rep.hOverflow, false, `${v.tag}: records page has no horizontal overflow`);

    step(`${v.tag}: 月字帖页`);
    await pushScreen(page, 'month', { month: '2026-10' }, '[data-testid="month-paper"]');
    const month = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-testid="month-cell"]')];
      return {
        n: cells.length,
        shown: cells.filter(c => { const t = c.querySelector('.sz-mcell__tag'); return t && getComputedStyle(t).display !== 'none'; }).length,
        dated: cells.filter(c => /10月\d+日/.test(c.getAttribute('aria-label') || '')).length,
      };
    });
    assert.equal(month.dated, month.n, `${v.tag}: month page cells carry their date in the name`);
    if (ax) assert.equal(month.shown, 0, `${v.tag}: month page has no corner tags in AX`);
    else assert.ok(month.shown > 0, `${v.tag}: month page tags unchanged at standard size`);
    rep = await page.evaluate(overlapReport);
    assert.deepEqual(rep.bad, [], `${v.tag}: month page has no overlapping text`);
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
    await waitNavIdle(page);

    step(`${v.tag}: 单字详情记录格`);
    await page.evaluate(async () => (await import('/src/ui/screens/detail/index.js')).openDetail('醋'));
    await page.waitForSelector('[data-testid="detail-cell"], [data-testid="detail-hero-first"], .sz-drec');
    await waitNavIdle(page);
    await page.waitForTimeout(400);
    const det = await page.evaluate(() => {
      const grid = document.querySelector('.sz-drec__grid');
      const cells = [...document.querySelectorAll('[data-testid="detail-cell"]')];
      const out = cells.map(c => {
        const cr = c.getBoundingClientRect();
        const t = c.querySelector('.sz-dcell__meta');
        const rng = document.createRange();
        rng.selectNodeContents(t);
        const tr = rng.getBoundingClientRect();
        return { inside: tr.left >= cr.left - 0.5 && tr.right <= cr.right + 0.5 && tr.bottom <= cr.bottom + 0.5 };
      });
      return { cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0, n: cells.length, allInside: out.every(o => o.inside) };
    });
    if (det.n) {
      assert.equal(det.allInside, true, `${v.tag}: detail record text stays inside its cell`);
      assert.equal(det.cols, ax ? 2 : 4, `${v.tag}: detail grid columns`);
    }
    rep = await page.evaluate(overlapReport);
    assert.deepEqual(rep.bad, [], `${v.tag}: detail page has no overlapping text`);
    assert.equal(rep.hOverflow, false, `${v.tag}: detail page has no horizontal overflow`);
  }
  assert.ok(topSel('x'));
}
