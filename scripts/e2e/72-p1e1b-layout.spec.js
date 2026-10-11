// 阶段 1 P1-E1b（D43 / D46）：按设计系统 v1 重排页面结构（首页 / 结果页 / 图片除外）的版式断言：
//   A 页边 20：写字页、字库 / 我的 tab 根页、设置页的正文左右内边距 = --gutter（20），书写格贴着同一条边；
//   B 判断页上下两格（D46 ⑪、D49）：本人书写在上、参考字形在下，与书写格同一顶边、同一中线；边长 S = min(W − 40, ⌊(主区高 − 书写格顶 − 16) ÷ 2⌋)（D49 去掉旁注后
//     宽度只受页边限制；测试浏览器无安全区：402×874 → 265、440×956 → 298、393×852 → 257、375×667 → 198（D53 ② 底栏一行后））；没有「你的书写 / 参考字形」旁注，读屏名称仍在两张卡的
//     aria-label 上；两键在主按钮的位置、同权重，没有说明句（更细的断言在 77-e9b-write-judge.spec.js）；
//   C 写字页结果行（D19）挪到格下说明位（D46 ⑭）；
//   D 字墙：取令牌 wall1–wall4 的独立色值（浅深各一套），写错格同样按新旧取档并多一颗朱点；8 列 / Pro Max 9 列 / 大字 6 列；
//   E 提示笔画的 1pt 墨三外廓（D46 ⑯ → W1 / A2-02：常驻，不再只在 prefers-contrast: more 时才有；描红 canvas 的 halo 仍随该偏好）；
//   F 危险操作（P142）：清空 / 替换的确认层里取消 = 主按钮、危险键 = 次按钮；危险入口行与常规项之间留组间距；
//   G Toast：最小高 48、没有圆点、有 2px 计时线。

import {
  bootTestHost, openWrite, seedSession, drawStroke, HORIZONTAL, topSel, tokenRgb, waitNavIdle, setTextSize, LARGE_TEXT, tap,
} from './helpers.mjs';

const TODAY = '2026-09-24';
const CHARS = '永和春大中国人天地山水火木金土日月星云风雨花草鸟鱼虫书画琴棋诗酒茶'.split('');
const TONE_AGO = [1, 15, 60, 120];

function pad2(n) { return n < 10 ? `0${n}` : String(n); }
function dayAgo(n) { const d = new Date(`${TODAY}T12:00:00`); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function seedLibrary() {
  const rows = CHARS.map((c, i) => {
    const day = dayAgo(TONE_AGO[i % 4] + (i >> 2));
    const at = new Date(`${day}T08:00:00`).getTime() + i * 60000;
    return { c, i, day, at, judgment: i % 5 === 0 ? 'wrong' : 'correct' };
  }).sort((a, b) => a.at - b.at);
  const records = {};
  rows.forEach((row, k) => {
    const r = { id: `r${k + 1}`, cardKey: `base:${row.c}`, char: row.c, sessionId: 's900', kind: 'judged', judgment: row.judgment, at: row.at, localDay: row.day, help: { hints: 0, answerSeen: false, traced: false } };
    (records[row.day.slice(0, 7)] || (records[row.day.slice(0, 7)] = [])).push(r);
  });
  return { records, custom: { added: [{ char: '馨', at: 1000 }, { char: '鼎', at: 1001 }] } };
}

const rectOf = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(`.sz-layer[data-top="true"] ${s}`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width / 2 };
}, sel);

async function openWriteAt(page, ctx, view, { scheme = 'light' } = {}) {
  await page.setViewportSize(view);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await seedSession(page, { slot: 'A', chars: ['永', '和', '春', '大', '中'], cursor: 0 });
  await openWrite(page, { slot: 'A' });
  await page.waitForTimeout(500);
}

async function toCompare(page) {
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(150);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-compare'));
  await page.waitForFunction(() => {
    const r = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-compare-ref"]');
    return !!r && r.dataset.state === 'ready';
  });
  await waitNavIdle(page, { settleMs: 450 });
}

export default async function p1e1bLayout(page, ctx) {
  const { assert, step } = ctx;
  const near = (a, b, tol = 0.75) => Math.abs(a - b) <= tol;

  // ------------------------------------------------------------------ A 页边 20
  step('A: page gutter is 20 (write, library, mine, settings) and the grid sits on the same edge');
  await openWriteAt(page, ctx, { width: 393, height: 852 });
  const pad = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.sz-layer[data-top="true"] .sz-page__body'));
    const fs = getComputedStyle(document.querySelector('.sz-layer[data-top="true"] .sz-page__foot'));
    return { l: cs.paddingLeft, r: cs.paddingRight, fl: fs.paddingLeft, fr: fs.paddingRight };
  });
  assert.deepEqual([pad.l, pad.r, pad.fl, pad.fr], ['20px', '20px', '20px', '20px'], 'write page body and footer: left / right padding 20 (--gutter)');
  const g0 = await rectOf(page, '[data-testid="write-grid"]');
  assert.ok(near(g0.left, 20) && near(393 - g0.right, 20), `the writing grid sits on the 20pt edges (${g0.left}, ${393 - g0.right})`);
  const done = await rectOf(page, '[data-testid="write-done"]');
  const more = await rectOf(page, '[data-testid="write-more"]');
  assert.ok(near(done.left, 20) && near(393 - more.right, 20), 'the footer row shares the same edges: 写好了 starts on 20, 「⋯」 ends on 393 − 20 (D53 ②)');
  const below = await rectOf(page, '.sz-write__below');
  assert.ok(near(below.left, g0.left) && near(below.right, g0.right), 'the row under the grid is as wide as the grid (note left, tools right)');
  const prompt = await rectOf(page, '[data-testid="write-prompt"]');
  assert.ok(near(g0.top - prompt.bottom, 16), `prompt → grid gap is 16 (D49: was 24) (${g0.top - prompt.bottom})`);

  await page.evaluate(async () => { const { nav } = await import('/src/ui/router.js'); nav.back(); });
  await page.waitForTimeout(500);
  await page.evaluate(({ iso, s }) => { window.__shiziTest.reset(); window.__shiziTest.setClock(iso); const r = window.__shiziTest.seed(s); if (!r.ok) throw new Error(JSON.stringify(r)); }, { iso: `${TODAY}T09:00:00`, s: seedLibrary() });
  await page.waitForTimeout(300);
  for (const name of ['library', 'mine']) {
    await page.evaluate(async n => { const { nav } = await import('/src/ui/router.js'); nav.switchTab(n); }, name);
    await page.waitForTimeout(500);
    await waitNavIdle(page, { settleMs: 250 });
    const tp = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.sz-layer[data-top="true"] .sz-tabpage, .sz-tabpage'));
      return [cs.paddingLeft, cs.paddingRight];
    });
    assert.deepEqual(tp, ['20px', '20px'], `${name} tab page: left / right padding 20`);
  }
  await page.evaluate(async () => { (await import('/src/ui/screens/mine/settings.js')).openSettings(); });
  await page.waitForTimeout(700);
  await waitNavIdle(page, { settleMs: 250 });
  const sp = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.sz-layer[data-top="true"] .sz-page__body'));
    return [cs.paddingLeft, cs.paddingRight];
  });
  assert.deepEqual(sp, ['20px', '20px'], 'settings page: left / right padding 20');

  // ------------------------------------------------------------------ B 判断页上下两格
  for (const [w, h, expected] of [[402, 874, 265], [440, 956, 298], [393, 852, 257]]) {
    step(`B: judge page ${w}×${h}: two stacked cards, same top edge and midline as the writing grid, S = ${expected}`);
    await openWriteAt(page, ctx, { width: w, height: h });
    const grid = await rectOf(page, '[data-testid="write-grid"]');
    await toCompare(page);
    const mine = await rectOf(page, '[data-testid="write-compare-mine"]');
    const ref = await rectOf(page, '[data-testid="write-compare-ref"]');
    assert.ok(near(mine.top, grid.top), `${w}×${h}: the upper card has the writing grid's top edge (${mine.top} vs ${grid.top})`);
    assert.ok(near(mine.cx, grid.cx) && near(ref.cx, grid.cx), `${w}×${h}: both cards are on the writing grid's midline (${mine.cx}, ${ref.cx} vs ${grid.cx})`);
    assert.ok(near(ref.top, mine.bottom - 1, 1), `${w}×${h}: the lower card hangs under the upper one on a shared line (${ref.top} vs ${mine.bottom})`);
    assert.ok(near(mine.width, mine.height) && near(ref.width, ref.height) && near(mine.width, ref.width), `${w}×${h}: both cards are the same square (${mine.width}×${mine.height}, ${ref.width}×${ref.height})`);
    assert.ok(near(mine.width, expected, 1), `${w}×${h}: S = min(W − 40, ⌊(main − grid top − 16) ÷ 2⌋) = ${expected} (got ${mine.width})`);
    const foot = await rectOf(page, '.sz-page__foot');
    assert.ok(ref.bottom <= foot.top - 11, `${w}×${h}: the cards end ≥ 12 above the footer (${ref.bottom} vs ${foot.top})`);
    const aside = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const mineCard = top.querySelector('[data-testid="write-compare-mine"]');
      const refCard = top.querySelector('[data-testid="write-compare-ref"]');
      return { asides: top.querySelectorAll('.sz-compare__aside, [data-testid="write-compare-aside-mine"], [data-testid="write-compare-aside-ref"]').length, text: top.innerText,
        mAria: mineCard.getAttribute('aria-label'), rAria: refCard.getAttribute('aria-label'), mRole: mineCard.getAttribute('role'), rRole: refCard.getAttribute('role'), note: !!top.querySelector('[data-testid="write-judge-note"]') };
    });
    assert.equal(aside.asides, 0, `${w}×${h}: no side notes (D49)`);
    assert.ok(!aside.text.includes('你的书写') && !aside.text.includes('参考字形') && !aside.text.includes('你来判断'), `${w}×${h}: neither the notes nor the instruction sentence is on the page`);
    assert.equal(aside.note, false, `${w}×${h}: no sentence above the buttons`);
    assert.deepEqual([aside.mRole, aside.rRole], ['img', 'img'], `${w}×${h}: the cards keep role=img`);
    assert.equal(aside.mAria, '你的书写，1 笔', `${w}×${h}: screen-reader name of my card unchanged`);
    assert.ok(/^参考字形：永，yǒng，\d+ 画(，[^，]+)?$/.test(aside.rAria), `${w}×${h}: screen-reader name of the reference card unchanged (${aside.rAria})`);
    const btns = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const a = top.querySelector('[data-testid="write-judge-wrong"]').getBoundingClientRect();
      const b = top.querySelector('[data-testid="write-judge-correct"]').getBoundingClientRect();
      return { a: { w: a.width, h: a.height, top: a.top, left: a.left }, b: { w: b.width, h: b.height, top: b.top, left: b.left } };
    });
    assert.ok(near(btns.a.w, btns.b.w) && near(btns.a.h, btns.b.h) && btns.a.h >= 54 - 0.5, `${w}×${h}: the two judge buttons are the same size, ≥ 54 tall (${btns.a.w}×${btns.a.h})`);
    assert.ok(near(btns.a.top, btns.b.top) && btns.a.left < btns.b.left, `${w}×${h}: 写错了 left, 写对了 right, one row`);
  }

  step('B: short screen 375×667 — the pair shrinks to fit between the grid top and the footer');
  await openWriteAt(page, ctx, { width: 375, height: 667 });
  const gridSE = await rectOf(page, '[data-testid="write-grid"]');
  await toCompare(page);
  const mSE = await rectOf(page, '[data-testid="write-compare-mine"]');
  const rSE = await rectOf(page, '[data-testid="write-compare-ref"]');
  const fSE = await rectOf(page, '.sz-page__foot');
  assert.ok(near(mSE.width, 198, 1), `375×667: S = ⌊(main 533 − grid top 121 − 16) ÷ 2⌋ = 198 (${mSE.width})`);
  assert.ok(rSE.bottom <= fSE.top - 11, `375×667: the pair fits above the footer with ≥ 12 to spare (${rSE.bottom} vs ${fSE.top})`);
  assert.ok(near(mSE.top, gridSE.top) && near(mSE.cx, gridSE.cx), '375×667: still the grid\'s top edge and midline');
  const bodyScroll = await page.evaluate(() => { const b = document.querySelector('.sz-layer[data-top="true"] .sz-page__body'); return [b.scrollHeight, b.clientHeight]; });
  assert.ok(bodyScroll[0] <= bodyScroll[1] + 1, `375×667: the judge page does not scroll (${bodyScroll[0]} ≤ ${bodyScroll[1]})`);

  step('B: judge page in the dark paper — same geometry');
  await openWriteAt(page, ctx, { width: 402, height: 874 }, { scheme: 'dark' });
  const gridD = await rectOf(page, '[data-testid="write-grid"]');
  await toCompare(page);
  const mD = await rectOf(page, '[data-testid="write-compare-mine"]');
  assert.ok(near(mD.top, gridD.top) && near(mD.cx, gridD.cx) && near(mD.width, 265, 1), 'dark 402×874: 265pt, grid top edge and midline');

  // ------------------------------------------------------------------ C 结果行在格下说明位
  step('C: the D19 result row of the previous character sits in the note slot under the grid');
  await openWriteAt(page, ctx, { width: 393, height: 852 });
  await toCompare(page);
  await page.click(topSel('write-judge-correct'));
  await page.waitForFunction(() => Number(document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor) === 1);
  await page.waitForSelector(topSel('write-line'));
  await page.waitForTimeout(500);
  const rowPos = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const line = top.querySelector('[data-testid="write-line"]').getBoundingClientRect();
    const grid = top.querySelector('[data-testid="write-grid"]').getBoundingClientRect();
    const prompt = top.querySelector('[data-testid="write-prompt"]').getBoundingClientRect();
    const note = top.querySelector('[data-testid="write-note"]');
    const change = top.querySelector('[data-testid="write-line-change"]').getBoundingClientRect();
    const cs = getComputedStyle(top.querySelector('[data-testid="write-line"]'));
    return { lineTop: line.top, lineLeft: line.left, gridBottom: grid.bottom, gridLeft: grid.left, promptBottom: prompt.bottom, inNote: note.contains(top.querySelector('[data-testid="write-line"]')), fs: parseFloat(cs.fontSize), justify: cs.justifyContent, changeH: change.height };
  });
  assert.ok(rowPos.lineTop >= rowPos.gridBottom - 0.5, `the result row is below the grid, not above it (${rowPos.lineTop} ≥ ${rowPos.gridBottom})`);
  assert.ok(rowPos.lineTop > rowPos.promptBottom, 'and no longer between the header and the prompt');
  assert.ok(rowPos.inNote, 'the row lives inside the note slot (write-note)');
  assert.ok(near(rowPos.lineLeft, rowPos.gridLeft, 1), `the row is left-aligned with the grid (${rowPos.lineLeft} vs ${rowPos.gridLeft})`);
  assert.equal(rowPos.fs, 13, 'the row is 13pt like the other notes');
  assert.ok(rowPos.changeH >= 44 - 0.5, `「修改」 stays a 44pt-high button (${rowPos.changeH})`);

  // ------------------------------------------------------------------ D 字墙
  for (const scheme of ['light', 'dark']) {
    step(`D: ${scheme}: wall cells take wall1–wall4, wrong cells are toned and carry the zhu dot, 8 columns`);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('about:blank');
    await bootTestHost(page, ctx.baseURL);
    await page.evaluate(({ iso, s }) => { window.__shiziTest.reset(); window.__shiziTest.setClock(iso); const r = window.__shiziTest.seed(s); if (!r.ok) throw new Error(JSON.stringify(r)); }, { iso: `${TODAY}T09:00:00`, s: seedLibrary() });
    await page.waitForTimeout(300);
    await page.evaluate(async () => { const { nav } = await import('/src/ui/router.js'); nav.switchTab('library'); });
    await page.waitForTimeout(600);
    await waitNavIdle(page, { settleMs: 250 });
    const wall = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]') || document;
      const w = top.querySelector('[data-testid="library-wall"]');
      const cells = [...w.querySelectorAll('[data-testid="library-wall-cell"]')].map(el => {
        const ch = el.querySelector('.sz-lib__char');
        const mark = el.querySelector('.sz-lib__mark');
        return { kind: el.dataset.kind, tone: el.dataset.tone, color: ch ? getComputedStyle(ch).color : null, stroke: ch ? getComputedStyle(ch).webkitTextStrokeColor : null, mark: !!mark, scale: ch ? getComputedStyle(ch).transform : null, opacity: el.querySelector('.sz-lib__g') ? getComputedStyle(el.querySelector('.sz-lib__g')).opacity : null };
      });
      const legend = top.querySelectorAll('[data-testid="library-legend"], [data-testid="library-legend-tone"]').length;
      return { cols: w.dataset.cols, cells, legend, tpl: getComputedStyle(w).gridTemplateColumns.split(' ').length };
    });
    assert.equal(wall.cols, '8', `${scheme}: 8 columns at 393 wide`);
    assert.equal(wall.tpl, 8, `${scheme}: the grid really has 8 tracks`);
    const toneColors = [0, 1, 2, 3].map(i => tokenRgb(scheme, `wall${i + 1}`));
    const inkCells = wall.cells.filter(c => c.kind === 'ink' || c.kind === 'wrong');
    assert.ok(inkCells.length >= 30, `${scheme}: enough toned cells on the wall (${inkCells.length})`);
    assert.ok(inkCells.every(c => c.color === toneColors[Number(c.tone)]), `${scheme}: every ink / wrong cell's glyph colour = wall1–4 by its tone`);
    assert.deepEqual([...new Set(inkCells.map(c => c.tone))].sort(), ['0', '1', '2', '3'], `${scheme}: all four tones are in use`);
    assert.ok(wall.cells.every(c => c.opacity === '1'), `${scheme}: no cell is dimmed by opacity any more`);
    const wrongCells = wall.cells.filter(c => c.kind === 'wrong');
    assert.ok(wrongCells.length > 0 && wrongCells.every(c => c.mark), `${scheme}: wrong cells carry the zhu dot`);
    assert.ok(wrongCells.every(c => c.scale === 'none'), `${scheme}: wrong cells are not shrunk`);
    assert.equal(wall.legend, 0, `${scheme}: no legend on the library page (D49: the tones and marks explain themselves)`);
    const hollow = wall.cells.filter(c => c.kind === 'hollow');
    assert.ok(hollow.length === 2 && hollow.every(c => c.stroke === tokenRgb(scheme, 'ink4')), `${scheme}: unwritten custom chars are outlined in ink4 (D49 ⑤: vermilion only means wrong)`);
  }

  step('D: Pro Max width → 9 columns; system large text → 6 columns');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 440, height: 956 });
  await page.waitForTimeout(500);
  const cols9 = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="library-wall"], [data-testid="library-wall"]').dataset.cols);
  assert.equal(cols9, '9', '440 wide: 9 columns');
  await setTextSize(page, LARGE_TEXT);
  await page.waitForTimeout(500);
  const cols6 = await page.evaluate(() => document.querySelector('[data-testid="library-wall"]').dataset.cols);
  assert.equal(cols6, '6', 'XXXL system text: 6 columns');
  await setTextSize(page, 'L');
  await page.setViewportSize({ width: 393, height: 852 });

  // ------------------------------------------------------------------ E 提示的画法（D46 ⑯ → W1 → D53 ①：与描一遍同一种画法——淡朱不透明实填，没有灰外廓，不随增强对比度变化）
  for (const [contrast, scheme] of [['more', 'light'], ['more', 'dark'], ['no-preference', 'light'], ['no-preference', 'dark']]) {
    step(`E: prefers-contrast ${contrast} (${scheme}): the hint is an opaque danzhu wash, no ring`);
    await page.emulateMedia({ colorScheme: scheme, contrast });
    await openWriteAt(page, ctx, { width: 393, height: 852 }, { scheme });
    await page.emulateMedia({ colorScheme: scheme, contrast });
    await tap(page, 'write-hint');
    await page.waitForSelector(topSel('write-hint-fill'));
    await page.waitForTimeout(900);
    const f = await page.evaluate(() => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const fill = top.querySelector('[data-testid="write-hint-fill"]');
      const ring = top.querySelector('[data-testid="write-hint-ring"]');
      const first = cv => {
        if (!cv) return null;
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) return `rgb(${d[i]}, ${d[i + 1]}, ${d[i + 2]})`;
        return null;
      };
      return { fill: first(fill), ring: first(ring), opacity: getComputedStyle(fill).opacity, mq: matchMedia('(prefers-contrast: more)').matches };
    });
    assert.equal(f.mq, contrast === 'more', `the media query reports ${contrast}`);
    assert.equal(f.fill, tokenRgb(scheme, 'danzhu'), `the wash fill stays danzhu (tokens untouched)`);
    assert.equal(f.ring, null, 'no ink3 ring canvas whatever the contrast preference (D53 ①)');
    assert.equal(f.opacity, '1', 'the fill layer is opaque');
  }
  await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });

  // ------------------------------------------------------------------ F 危险操作
  step('F: backup page — the clear row is its own group; confirm layers: cancel = primary, danger = secondary');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  await page.evaluate(({ iso, s }) => { window.__shiziTest.reset(); window.__shiziTest.setClock(iso); const r = window.__shiziTest.seed(s); if (!r.ok) throw new Error(JSON.stringify(r)); }, { iso: `${TODAY}T09:00:00`, s: seedLibrary() });
  await page.evaluate(async () => { const { nav } = await import('/src/ui/router.js'); nav.push('backup', {}); });
  await page.waitForSelector(topSel('backup-screen'));
  await waitNavIdle(page);
  const gap = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const a = top.querySelector('[data-testid="backup-restore"]').getBoundingClientRect();
    const b = top.querySelector('[data-testid="backup-clear"]').getBoundingClientRect();
    const cs = getComputedStyle(top.querySelector('[data-testid="backup-clear"]'));
    return { gap: b.top - a.bottom, color: cs.color, h: b.height };
  });
  assert.ok(gap.gap >= 32 - 0.5, `the clear row is set apart from the restore row by the group gap (${gap.gap} ≥ 32)`);
  await page.click(topSel('backup-clear'));
  await page.waitForSelector('[data-testid="backup-clear-sheet"]');
  await page.waitForTimeout(500);
  const sheet = await page.evaluate(() => ({
    cancel: document.querySelector('[data-testid="backup-clear-cancel"]').className,
    ok: document.querySelector('[data-testid="backup-clear-ok"]').className,
    okBg: getComputedStyle(document.querySelector('[data-testid="backup-clear-ok"]')).backgroundColor,
    cancelBg: getComputedStyle(document.querySelector('[data-testid="backup-clear-cancel"]')).backgroundColor,
    body: getComputedStyle(document.querySelector('[data-testid="backup-clear-body"]')).color,
    active: document.activeElement && document.activeElement.getAttribute('data-testid'),
  }));
  assert.ok(sheet.cancel.includes('sz-btn--primary'), 'clear sheet: 取消 is the primary (ink) button');
  assert.ok(sheet.ok.includes('sz-btn--secondary') && !sheet.ok.includes('sz-btn--primary'), 'clear sheet: 清空 is the outlined secondary button');
  assert.equal(sheet.cancelBg, tokenRgb('light', 'btnBg'), 'the cancel button is solid ink');
  assert.equal(sheet.body, tokenRgb('light', 'ink1'), 'the consequence sentence is ink1, not the faded note colour');
  assert.ok(sheet.active !== 'backup-clear-ok' && sheet.active !== 'backup-clear-cancel', `no button is preselected (${sheet.active})`);
  await page.click('[data-testid="backup-clear-cancel"]');
  await page.waitForTimeout(500);

  // ------------------------------------------------------------------ G Toast
  step('G: toast — min height 48, no dot, 2px timer line, gutter 20');
  await page.evaluate(async () => { (await import('/src/ui/components/Toast.js')).showToast('测试一条提示'); });
  await page.waitForSelector('[data-testid="toast"]');
  const toast = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="toast"]');
    const r = el.getBoundingClientRect();
    const t = el.querySelector('[data-testid="toast-timer"]');
    return { h: r.height, left: r.left, right: window.innerWidth - r.right, dot: !!el.querySelector('.sz-toast__dot'), timerH: t ? t.getBoundingClientRect().height : null, radius: getComputedStyle(el).borderTopLeftRadius };
  });
  assert.ok(toast.h >= 48 - 0.5, `toast ≥ 48 high (${toast.h})`);
  assert.ok(near(toast.left, 20) && near(toast.right, 20), `toast edges are the 20pt gutter (${toast.left}, ${toast.right})`);
  assert.equal(toast.dot, false, 'no leading dot in the toast');
  assert.equal(toast.timerH, 2, 'a 2px timer line runs along the bottom edge');
  assert.equal(toast.radius, '12px', 'toast radius = control (12)');
}
