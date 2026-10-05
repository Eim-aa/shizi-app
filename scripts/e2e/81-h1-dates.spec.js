// H1-10（V2-08、T2-04；03 P224）：界面日期写法统一一种，中文标点按设计系统处理。
//   页面上每一处看得见的日期都是「10月4日」「10月」「2025年12月」——单位字紧跟数字，没有「10 月 4 日」；
//   首页日期行、有记录的字的月分组、我的 / 字库、详情的头图与记录格（两行「日期 / 写对」）、清单页行；
//   清单页行第二行的间隔号「·」不在任何一段的开头；正文容器开了 text-spacing-trim: trim-start（浏览器认的话）。
//   393×852，浅色；375×667 查大字下清单行的分段。
import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

/* eslint-disable no-undef */
const SPACED = /\d ?(月|日|年) |\d (月|日|年)|(月|日|年) \d/; // 旧写法「10 月 4 日」「4 月 26 日 的」
async function go(page, fn, arg) {
  await page.evaluate(fn, arg);
  await waitNavIdle(page);
}
const text = page => page.evaluate(() => document.querySelector('.sz-layer[data-top="true"]').innerText);

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);
  await seedHomeSpec(page, { entries: [
    { char: '疆', at: '2026-08-04T20:00:00' }, { char: '疆', at: '2026-09-14T20:00:00' }, { char: '疆', at: '2026-10-04T20:00:00', judgment: 'wrong' },
    { char: '酱', at: '2026-10-03T20:00:00', judgment: 'wrong' }, { char: '肆', at: '2026-10-02T20:00:00' },
  ], clock: '2026-10-05T19:30:00' });

  step('首页日期行「10月5日 · 晚上」');
  const date = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="home-date"]').textContent);
  assert.equal(date, '10月5日 · 晚上', 'home date line');

  step('有记录的字：月分组「10月」「9月」「8月」，没有空格写法');
  await go(page, async () => (await import('/src/ui/router.js')).nav.push('library-all', {}));
  await page.waitForSelector(topSel('all-group'));
  const groups = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="all-group-name"]')].map(el => el.textContent.trim()));
  assert.ok(groups.length >= 1 && groups.every(g => /^\d+月$|^\d{4}年\d+月$/.test(g)), `group names (${groups.join(' | ')})`);
  assert.ok(!SPACED.test(await text(page)), 'no spaced date on the all page');

  step('详情：头图 + 记录格两行「9月14日 / 写对」');
  await go(page, async () => (await import('/src/ui/router.js')).nav.back());
  await go(page, async () => (await import('/src/ui/router.js')).nav.push('detail', { char: '疆' }));
  await page.waitForSelector(topSel('detail-cell'));
  const d = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const cells = [...top.querySelectorAll('[data-testid="detail-cell"]')].map(c => ({
      date: c.querySelector('[data-testid="detail-cell-date"]').textContent, cap: c.querySelector('[data-testid="detail-cell-caption"]').textContent,
      dateRect: c.querySelector('[data-testid="detail-cell-date"]').getBoundingClientRect(), capRect: c.querySelector('[data-testid="detail-cell-caption"]').getBoundingClientRect(),
    }));
    const body = top.querySelector('.sz-page__body');
    return { cells, hero: [...top.querySelectorAll('[data-testid="detail-hero-caption"]')].map(e => e.textContent), first: !!top.querySelector('[data-testid="detail-records-first"]'),
      next: (top.innerText.match(/大约[^\n]*/) || [''])[0], trim: getComputedStyle(body).textSpacingTrim, supported: CSS.supports('text-spacing-trim', 'trim-start') };
  });
  assert.deepEqual(d.cells.map(c => [c.date, c.cap]), [['9月14日', '写对']], 'two lines per record cell: date / judgment (the strip lists only what the hero does not show, C3-R)');
  assert.ok(d.cells.every(c => c.capRect.top >= c.dateRect.bottom - 0.5), 'the judgment line sits under the date line');
  assert.deepEqual(d.hero, ['第一次 · 8月4日', '最近一次 · 10月4日'], 'hero captions use the same date style');
  assert.equal(d.first, false, 'no 「首次记录」 line (C3-R / N3-09): the hero says 第一次 · 8月4日');
  assert.ok(!SPACED.test(d.next) && /大约 \d+月\d+日再练到/.test(d.next), `next review line (${d.next})`);
  if (d.supported) assert.equal(d.trim, 'trim-start', 'text-spacing-trim: trim-start on the body container');
  assert.ok(!SPACED.test(await text(page)), 'no spaced date on the detail page');

  step('清单页（写错过）：行第二行的间隔号不在段首；我的页月标题');
  await go(page, async () => (await import('/src/ui/router.js')).nav.back());
  await go(page, async () => (await import('/src/ui/router.js')).nav.push('library-list', { kind: 'wrong' }));
  await page.waitForSelector(topSel('list-row-meta'));
  const meta = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="list-row-meta"]')].map(el => [...el.querySelectorAll('span')].map(s => s.textContent)));
  assert.ok(meta.length >= 1 && meta.every(parts => parts.length === 2 && parts[0].endsWith(' ·') && !parts[1].startsWith('·')), `meta segments: ${JSON.stringify(meta)}`);
  assert.ok(!SPACED.test(await text(page)), 'no spaced date on the list page');
  await go(page, async () => (await import('/src/ui/router.js')).nav.back());
  await go(page, async () => (await import('/src/ui/router.js')).nav.switchTab('mine'));
  const mine = await text(page);
  assert.ok(/10月字帖/.test(mine), 'mine: 10月字帖');
  assert.ok(!SPACED.test(mine), 'no spaced date on the mine page');
}
