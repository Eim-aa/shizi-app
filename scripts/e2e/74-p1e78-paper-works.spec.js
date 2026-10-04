// 阶段 1 P1-E78：纸上记录不进作品（D46 ⑬ / D47；实现交接 §4.2 / §5 / §10.2）。
//
//   一组 4 字：屏幕上写 2 字（疆、酱）+ 纸上写 2 字（纸写对、笔写错；走真实 mutator judgeInDraft({paper:true})，记录 source:'paper'、没有墨）。
//   1. 结果页：作品只有屏幕上的 2 字（落款「两字」）；作品下 2 条纸上行「「纸」写对 · 纸上」「「笔」写错 · 纸上」，「· 纸上」墨三，没有「放进去」；
//      读屏「纸，写对，纸上」；点行照常进对照 / 修改；分享仍在。
//   2. 分享图：成员只有 2 字、没有朱点、「也放进来」里没有纸上那个写错的字。
//   3. 月字帖与年报：只有屏幕上的 2 字，月落款「两字」、年字数 2、月段 2 字；记录页日历那天仍有点、那天的字只有 2 个。
//   4. 整组都在纸上（3 字，1 写错）：「没有墨」变体——衬底一行、格下状态字「纸上」、没有分享；行都是纸上行；
//      月字帖空、年报空态；日历那天仍有点（纸上那天仍算写过），那天没有字帖。

import { bootTestHost, tid, tokenRgb, topSel, waitNavIdle } from './helpers.mjs';
import { openResultPage, resultSnapshot, seedWork } from './work-helpers.mjs';

const CLOCK = '2026-10-05T10:00:00';

async function openShare(page) {
  await page.click(topSel('result-share'));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
  await page.waitForTimeout(300);
}

async function closeShare(page) {
  await page.waitForTimeout(450);
  await page.click('[data-testid="image-done"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await waitNavIdle(page);
}

async function push(page, id, params) {
  await page.evaluate(async o => (await import('/src/ui/router.js')).nav.push(o.id, o.params), { id, params });
  await page.waitForSelector(topSel(`${id === 'annual' ? 'annual' : id}-screen`));
  await waitNavIdle(page);
}

export default async function (page, ctx) {
  const { assert } = ctx;
  await page.setViewportSize({ width: 402, height: 874 });
  await bootTestHost(page, ctx.baseURL);

  // ---------------------------------------------------------------- 1. 结果页
  ctx.step('result page: the work has the 2 screen chars only; the 2 paper chars are rows 「…」写对 · 纸上 with no 「放进去」');
  const g = await seedWork(page, { chars: [...'疆纸笔酱'], steps: ['correct', 'paper-correct', 'paper-wrong', 'correct'], clock: CLOCK });
  assert.deepEqual(g.records.map(r => r.source || 'screen'), ['screen', 'paper', 'paper', 'screen'], 'the paper chars were judged with source paper');
  await openResultPage(page, g);
  let v = await resultSnapshot(page);
  assert.equal(v.work.n, 2, 'the work has the 2 screen chars');
  assert.deepEqual(v.cells.map(c => [c.index, c.ch]), [[0, '疆'], [3, '酱']], 'in group order; the paper chars are not cells');
  assert.equal(v.kuan, '二〇二六年十月五日　两字', 'the count in the kuan is 2');
  assert.equal(v.share, true, 'the share icon stays (the work has ink)');
  assert.deepEqual(v.rows.map(r => [r.ch, r.state, r.add]), [['纸', 'paper', null], ['笔', 'paper', null]], 'two paper rows, no 「放进去」');
  assert.deepEqual(v.rows.map(r => r.text), ['「纸」写对 · 纸上', '「笔」写错 · 纸上']);
  assert.equal(await page.locator(topSel('result-add')).count(), 0, 'no 「放进去」 button anywhere');
  const rowFacts = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return [...top.querySelectorAll('[data-testid="result-exrow"]')].map(row => ({
      tag: getComputedStyle(row.querySelector('[data-testid="result-exrow-tag"]')).color,
      tagText: row.querySelector('[data-testid="result-exrow-tag"]').textContent.trim(),
      text: getComputedStyle(row.querySelector('.sz-exrow__t')).color,
      aria: row.querySelector('[data-testid="result-exrow-open"]').getAttribute('aria-label'),
      under: row.querySelector('[data-testid="result-exrow-canvas"]').dataset.mode || null,
    }));
  });
  assert.deepEqual(rowFacts.map(r => r.tag), Array(2).fill(tokenRgb('light', 'ink3')), '「· 纸上」is ink3');
  assert.deepEqual(rowFacts.map(r => r.text), Array(2).fill(tokenRgb('light', 'ink2')), 'the row text itself stays ink2');
  assert.deepEqual(rowFacts.map(r => r.tagText), ['· 纸上', '· 纸上']);
  assert.deepEqual(rowFacts.map(r => r.aria), ['纸，写对，纸上', '笔，写错，纸上'], 'screen reader: 「{字}，写对，纸上」');
  ctx.step('tapping a paper row opens the compare / change sheet as usual (D19)');
  await page.click(`${topSel('result-exrow')}[data-char="笔"] [data-testid="result-exrow-open"]`);
  await page.waitForSelector(tid('result-sheet'));
  await waitNavIdle(page);
  await page.click(tid('result-sheet-close'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  await waitNavIdle(page);

  // ---------------------------------------------------------------- 2. 分享图
  ctx.step('share image: members are the 2 screen chars; no red dot; 「也放进来」 does not list the paper char that was wrong');
  await openShare(page);
  const p = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="image-preview"]');
    return {
      canvases: [...root.querySelectorAll('[data-testid="image-canvas"]')].map(c => ({ ...c.dataset })),
      chips: [...root.querySelectorAll('[data-testid="image-chip"]')].map(c => c.dataset.char),
    };
  });
  assert.equal(p.canvases.length, 1);
  assert.equal(p.canvases[0].members, '疆酱', 'the image has the 2 screen chars only');
  assert.equal(p.canvases[0].n, '2');
  assert.equal(p.canvases[0].dots, '00', 'no red dot');
  assert.equal(p.canvases[0].signature, '二〇二六年十月五日　两字');
  assert.deepEqual(p.chips, [], 'a paper char is never offered in 「也放进来」');
  await closeShare(page);

  // ---------------------------------------------------------------- 3. 月字帖 · 年报 · 日历
  ctx.step('month sheet / annual report: the 2 screen chars only, counts 2; the calendar still marks the day and the day lists 2 chars');
  await push(page, 'month', { month: '2026-10' });
  await page.waitForFunction(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="month-cell-canvas"]')].every(c => c.dataset.painted === 'true'));
  const m = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return {
      chars: [...top.querySelectorAll('[data-testid="month-cell"]')].map(c => c.dataset.char).join(''),
      kuan: top.querySelector('[data-testid="month-kuan"]').textContent.trim(),
      n: top.querySelector('[data-testid="month-body"]').dataset.n,
    };
  });
  assert.deepEqual(m, { chars: '疆酱', kuan: '二〇二六年十月　两字', n: '2' }, 'month sheet: no paper chars, count 2');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);

  await push(page, 'annual', {});
  await page.waitForFunction(() => [...document.querySelectorAll('.sz-layer[data-top="true"] canvas')].every(c => c.dataset.painted === 'true'));
  const a = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return {
      head: top.querySelector('[data-testid="annual-head"]').textContent.trim(),
      first: top.querySelector('[data-testid="annual-first"]').dataset.char,
      months: [...top.querySelectorAll('[data-testid="annual-month"]')].map(b => [b.dataset.month, b.dataset.n, b.querySelector('[data-testid="annual-month-count"]').textContent.trim(),
        [...b.querySelectorAll('[data-testid="annual-month-cell"]')].map(c => c.dataset.char).join('')]),
    };
  });
  assert.equal(a.head, '这一年，你写过 2 个字。', 'the year count does not count the paper chars');
  assert.equal(a.first, '疆', 'the first char of the year is a screen char');
  assert.deepEqual(a.months, [['2026-10', '2', '2 字', '疆酱']], 'the month section: 2 chars, no paper chars');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);

  await push(page, 'records', { month: '2026-10', day: '2026-10-05' });
  const r = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const day = top.querySelector('[data-testid="records-day"][data-day="2026-10-05"]');
    const list = top.querySelector('[data-testid="records-daylist"]');
    return { has: day ? day.dataset.has : null, count: list ? list.dataset.count : null, chars: list ? [...list.querySelectorAll('[data-testid="records-daylist-cell"]')].map(c => c.dataset.char).join('') : null };
  });
  assert.deepEqual(r, { has: 'true', count: '2', chars: '疆酱' }, 'calendar dot stays; the day list has the screen chars only');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);

  // ---------------------------------------------------------------- 4. 整组都在纸上
  ctx.step('whole group on paper → the no-ink variant: under row, status 「纸上」 under each cell, share hidden, all rows are paper rows');
  const g2 = await seedWork(page, { chars: [...'疆纸笔'], steps: ['paper-correct', 'paper-wrong', 'paper-correct'], clock: CLOCK });
  await openResultPage(page, g2);
  v = await resultSnapshot(page);
  assert.equal(v.work.variant, 'plain', 'under-glyph row');
  assert.equal(v.work.n, 3);
  assert.equal(v.share, false, 'no share when nothing is on the paper');
  assert.deepEqual(v.rows.map(x => [x.ch, x.state, x.add]), [['疆', 'paper', null], ['纸', 'paper', null], ['笔', 'paper', null]]);
  assert.deepEqual(v.rows.map(x => x.text), ['「疆」写对 · 纸上', '「纸」写错 · 纸上', '「笔」写对 · 纸上']);
  const plain = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return {
      status: [...top.querySelectorAll('[data-testid="work-status"]')].map(s => [s.textContent.trim(), s.dataset.wrong]),
      aria: [...top.querySelectorAll('[data-testid="work-cell"]')].map(c => c.getAttribute('aria-label')),
      modes: [...top.querySelectorAll('[data-testid="work-cell"]')].map(c => c.dataset.mode),
    };
  });
  assert.deepEqual(plain.status, [['纸上', 'false'], ['纸上', 'false'], ['纸上', 'false']], 'status under each under-glyph: 纸上 (a wrong one is not marked)');
  assert.deepEqual(plain.aria, ['疆，写对，纸上，点两下对照和修改', '纸，写错，纸上，点两下对照和修改', '笔，写对，纸上，点两下对照和修改']);
  assert.deepEqual(plain.modes, ['under', 'under', 'under']);
  await page.click(`${topSel('work-cell')}[data-index="1"]`);
  await page.waitForSelector(tid('result-sheet'));
  await waitNavIdle(page);
  await page.click(tid('result-sheet-close'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  await waitNavIdle(page);

  ctx.step('only paper: month sheet is empty, annual report is the empty state, the calendar still marks the day (the day was written)');
  await push(page, 'month', { month: '2026-10' });
  const mm = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return { n: top.querySelector('[data-testid="month-body"]').dataset.n, cells: top.querySelectorAll('[data-testid="month-cell"]').length, empty: !!top.querySelector('[data-testid="month-empty"]') };
  });
  assert.deepEqual(mm, { n: '0', cells: 0, empty: true });
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);
  await push(page, 'annual', {});
  assert.equal(await page.getAttribute(topSel('annual-body'), 'data-state'), 'empty', 'only paper → the annual report has nothing yet');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);
  await push(page, 'records', { month: '2026-10', day: '2026-10-05' });
  const r2 = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const day = top.querySelector('[data-testid="records-day"][data-day="2026-10-05"]');
    return { has: day ? day.dataset.has : null, list: !!top.querySelector('[data-testid="records-daylist"]'), today: !!top.querySelector('[data-testid="records-today"]'), body: top.querySelector('[data-testid="records-body"]').dataset.recordDays };
  });
  assert.deepEqual(r2, { has: 'true', list: false, today: false, body: '1' }, 'calendar dot stays (written), but there is no sheet to show');
}
