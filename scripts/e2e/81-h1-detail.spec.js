// H1-9（V2-03、T2-13、N2-10）：单字详情。
//   - 没有框中框：头部没有凹面卡（detail-card 没有底色 / 圆角），大字直接放在纸上；
//   - 头图 =「第一次 | 最近一次」两格本人墨（detail-hero-cell，data-kind first / latest，下面各一行日期）；只写过一次只有一格；没写过才是参考字形（detail-ref）；
//   - 拼音用黑体（不是宋体 / 衬线）；
//   - 没有「没有笔迹」占位：记录格里没墨的画衬底字，不写字；
//   - 记录格只画有内容的格：最后一行不满时后面不留空笺（容器没有笺面底色）。
//   393×852 浅 / 深，375×667。
import { bootTestHost, topSel, waitNavIdle } from './helpers.mjs';
import { seedHomeSpec } from './home-helpers.mjs';

/* eslint-disable no-undef */
async function open(page, char) {
  await page.evaluate(async c => (await import('/src/ui/router.js')).nav.push('detail', { char: c }), char);
  await page.waitForSelector(topSel('detail-screen'));
  await waitNavIdle(page);
  await page.waitForTimeout(250);
}
async function back(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);
}

async function facts(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-screen"]');
    const q = id => root.querySelector(`[data-testid="${id}"]`);
    const card = q('detail-card');
    const ccs = card ? getComputedStyle(card) : null;
    const py = q('detail-pinyin');
    const grid = q('detail-cells');
    const hero = [...root.querySelectorAll('[data-testid="detail-hero-cell"]')];
    const r = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
    return {
      card: card ? { bg: ccs.backgroundColor, radius: ccs.borderTopLeftRadius, pad: ccs.paddingTop } : null,
      hero: hero.map(el => ({ kind: el.dataset.kind, record: el.dataset.record, ink: el.querySelector('[data-testid="detail-hero-ink"]') ? 'ink' : 'none', cap: (el.querySelector('[data-testid="detail-hero-caption"]') || {}).textContent, rect: r(el) })),
      ref: !!q('detail-ref'),
      refW: q('detail-ref') ? q('detail-ref').getBoundingClientRect().width : 0,
      pinyin: py ? { text: py.textContent, font: getComputedStyle(py).fontFamily } : null,
      text: root.innerText,
      noinkNodes: root.querySelectorAll('[data-testid="detail-cell-noink"]').length,
      gridBg: grid ? getComputedStyle(grid).backgroundImage : null,
      gridBgColor: grid ? getComputedStyle(grid).backgroundColor : null,
      cells: [...root.querySelectorAll('[data-testid="detail-cell"]')].length,
      heroDots: hero.map(el => !!el.querySelector('[data-testid="detail-hero-dot"]')),
      cellRecords: [...root.querySelectorAll('[data-testid="detail-cell"]')].map(c => c.dataset.record),
      grid: !!grid,
      first: !!q('detail-records-first'),
      vw: window.innerWidth,
    };
  });
}

export default async function run(page0, ctx) {
  const { assert, step } = ctx;
  const runs = [
    { tag: '393×852 light', width: 393, height: 852, scheme: 'light' },
    { tag: '393×852 dark', width: 393, height: 852, scheme: 'dark' },
    { tag: '375×667 light', width: 375, height: 667, scheme: 'light' },
  ];
  let page = page0;
  for (const [i, v] of runs.entries()) {
    if (i > 0) { await page.close(); page = await page0.context().newPage(); }
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.emulateMedia({ colorScheme: v.scheme });
    await bootTestHost(page, ctx.baseURL);
    await seedHomeSpec(page, { entries: [
      { char: '疆', at: '2026-08-04T20:00:00' }, { char: '疆', at: '2026-09-14T20:00:00' }, { char: '疆', at: '2026-10-04T20:00:00', judgment: 'wrong' },
      { char: '酱', at: '2026-10-03T20:00:00' },
    ], clock: '2026-10-05T19:30:00' });

    step(`${v.tag}: 写过 3 次——第一次 | 最近一次两格本人墨，没有凹面卡，拼音黑体，没有「没有笔迹」`);
    await open(page, '疆');
    let f = await facts(page);
    assert.deepEqual(f.hero.map(h => h.kind), ['first', 'latest'], `${v.tag}: two hero cells, first then latest`);
    assert.deepEqual(f.hero.map(h => h.ink), ['ink', 'ink'], `${v.tag}: both are the user's own ink`);
    assert.ok(f.hero[0].rect.r <= f.hero[1].rect.l + 0.5, `${v.tag}: side by side`);
    assert.ok(Math.abs(f.hero[0].rect.w - f.hero[1].rect.w) < 1, `${v.tag}: same size`);
    assert.ok(f.hero[0].rect.l >= 19.5 && f.hero[1].rect.r <= f.vw - 19.5, `${v.tag}: inside the 20pt margins`);
    assert.ok(f.hero[0].cap.startsWith('第一次') && f.hero[1].cap.startsWith('最近一次'), `${v.tag}: captions (${f.hero.map(h => h.cap).join(' | ')})`);
    assert.ok(f.ref && f.refW <= 46, `${v.tag}: the reference glyph drops to a small cell beside the pinyin once the user has written it (${f.refW})`);
    assert.ok(f.card && (f.card.bg === 'rgba(0, 0, 0, 0)' || f.card.bg === 'transparent') && f.card.radius === '0px', `${v.tag}: no recessed card around the head (${JSON.stringify(f.card)})`);
    assert.ok(f.pinyin && !/Serif|Songti|STSong|Song|宋/.test(f.pinyin.font) && /apple-system|PingFang|sans/i.test(f.pinyin.font), `${v.tag}: pinyin in the 黑体 stack (${f.pinyin && f.pinyin.font})`);
    assert.ok(!f.text.includes('没有笔迹'), `${v.tag}: no 「没有笔迹」 placeholder`);
    assert.equal(f.noinkNodes, 0, `${v.tag}: no no-ink labels in the record cells`);
    assert.equal(f.cells, 1, `${v.tag}: the strip holds only the record the hero does not show (3 records − first − latest)`);
    assert.ok(!f.cellRecords.some(id => f.hero.map(h => h.record).includes(id)), `${v.tag}: no record is drawn twice`);
    assert.deepEqual(f.heroDots, [false, true], `${v.tag}: the latest was 写错 → a red dot after its date; the first was 写对 → none`);
    assert.equal(f.first, false, `${v.tag}: no 「首次记录」 line`);
    assert.ok(f.gridBg === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(f.gridBgColor), `${v.tag}: the record grid draws only its cells — no paper behind the empty rest of the row (${f.gridBg} ${f.gridBgColor})`);
    await back(page);

    step(`${v.tag}: 只写过 1 次——一格`);
    await open(page, '酱');
    f = await facts(page);
    assert.deepEqual(f.hero.map(h => h.kind), ['first'], `${v.tag}: a single cell`);
    assert.equal(f.cells, 0, `${v.tag}: one record → the hero already shows it all; no history strip`);
    assert.equal(f.grid, false, `${v.tag}: no empty strip container`);
    assert.ok(Math.abs((f.hero[0].rect.l + f.hero[0].rect.r) / 2 - v.width / 2) <= 1, `${v.tag}: the single cell is centred on the content column`);
    assert.ok(f.hero[0].rect.w <= (v.width - 40 - 12) / 2 + 1, `${v.tag}: same cell size as in the two-cell case`);
    await back(page);

    step(`${v.tag}: 没写过——标准写法当头图，没有两格`);
    await open(page, '春');
    f = await facts(page);
    assert.deepEqual([f.hero.length, f.ref], [0, true], `${v.tag}: reference glyph as the head`);
    assert.ok(f.refW >= (v.width - 40 - 12) / 2 - 1, `${v.tag}: it is the big head cell (${f.refW})`);
    assert.ok(!f.text.includes('没有笔迹'), `${v.tag}: no placeholder here either`);
    await back(page);
  }
  if (page !== page0) await page.close();
}
