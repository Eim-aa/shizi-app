// 阶段 1 P1-E7：作品出口（交接「实现交接.md」§4–§8；D31 / D39 / D42 / D46 ⑥⑦⑧⑨⑩ / D47）。
//
//   1. 结果页即作品：402 宽 1 / 2 / 3 / 4 / 5 字的作品格 181 / 165 / 110 / 144 / 110；列 × 行同 3:4 分享图；落款「二〇二六年十月五日　三字」+ 印
//      （末字在最右列 → 印在末格正下方、右沿对齐；否则印在末格右侧）；格下「看后写的」；页头右上分享、没有标题、没有「这次记录了 N 个字」。
//   2. 「没放进图里」的行与「放进去」：写错有墨可加入（作品里按组内原位置、带朱点）、无墨 / 看过答案 / 跳过没有「放进去」；状态存进会话，刷新后仍在；
//      整组没有任何墨 → 衬底一行 + 格下状态字、分享隐藏。
//   3. 分享弹层：预览 = 导出图本身（1440 × 1440 / 1440 × 1920，永远浅纸，深色主题下也是）、默认比例 D47（3 字 1:1、5 字 3:4）、「也放进来」chip（加入后重画并带朱点）、
//      「保存图片」下载 JPEG（尺寸 / 浅纸）+「存好了」、没有「存下来的是图片…」。
//   4. 超过 80 字分张（D39）：弹层 2 页 + 页点 + 说明句 + 「保存 2 张图片」、落款其一 / 其二、每页自己的字数；保存下载 2 个文件。
//   5. 月字帖页：6 列格 60、骑线日期角标只标每天第一个字、没墨的字画衬底（不写「没有笔迹」）、说明句只在有衬底字时出现、纸上记录不进。
//   6. 年报：卷首 / 每月一段 / 卷尾；点月段进月字帖；保存弹层册页张数与按钮「保存 N 张图片」；「存成一张长图」宽 1440；超高按月切。
//   7. 读屏名称（作品整体、逐格、「放进去」）。

import fs from 'node:fs';
import { bootTestHost, PRESS_SETTLE_MS, setTextSize, tid, topSel, waitNavIdle } from './helpers.mjs';
import { openResultPage, resultSnapshot, seedMonthRecords, seedWork } from './work-helpers.mjs';

const CLOCK = '2026-10-05T10:00:00';

/** JPEG 头里的尺寸（SOF0 / SOF2）。 */
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

/** 把 JPEG 字节解码后取左上角像素与整体平均亮度（在页面里解码，浅纸 = 亮）。 */
async function decodeStats(page, buf) {
  return page.evaluate(async b64 => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return { w: bmp.width, h: bmp.height, corner: [d[0], d[1], d[2]], mean: sum / (64 * 64) };
  }, buf.toString('base64'));
}

async function downloadFile(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(path) };
}

async function openShare(page, { state = 'ready' } = {}) {
  await page.click(`${topSel('result-share')}`);
  await page.waitForFunction(s => {
    const r = document.querySelector('[data-testid="image-preview"]');
    return !!r && r.dataset.state === s;
  }, state);
  await page.waitForTimeout(300);
}

async function preview(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="image-preview"]');
    if (!root) return null;
    const canvases = [...root.querySelectorAll('[data-testid="image-canvas"]')].map(c => ({
      w: c.width, h: c.height, ds: { ...c.dataset },
      corner: [...c.getContext('2d').getImageData(8, 8, 1, 1).data].slice(0, 3),
    }));
    const btn = id => {
      const el = root.querySelector(`[data-testid="${id}"]`);
      return el ? { text: el.textContent.trim(), disabled: el.disabled } : null;
    };
    return {
      state: root.dataset.state, ratio: root.dataset.ratio, pages: Number(root.dataset.pages), page: Number(root.dataset.page), save: root.dataset.save,
      canvases,
      ratios: [...root.querySelectorAll('[data-testid="image-ratio"]')].map(b => ({ r: b.dataset.ratio, pressed: b.getAttribute('aria-pressed') })),
      note: root.querySelector('[data-testid="image-note"]').textContent.trim(),
      dots: root.querySelectorAll('[data-testid="image-dot"]').length,
      chips: [...root.querySelectorAll('[data-testid="image-chip"]')].map(c => ({ ch: c.dataset.char, on: c.dataset.on, text: c.textContent.trim() })),
      share: btn('image-share'), saveBtn: btn('image-save') || btn('image-retry'), long: btn('image-long'), done: btn('image-done'),
      all: root.textContent,
    };
  });
}

async function closeShare(page) {
  await page.waitForTimeout(PRESS_SETTLE_MS); // 新状态后 0.4s 内按钮不响应（01 §6.6）
  await page.click('[data-testid="image-done"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await waitNavIdle(page);
}

export default async function (page, ctx) {
  const { assert } = ctx;
  await page.setViewportSize({ width: 402, height: 874 });
  await bootTestHost(page, ctx.baseURL);

  // ---------------------------------------------------------------- 1. 结果页即作品
  ctx.step('result page: work cells 181 / 165 / 110 / 144 / 110 at 402 wide, 3:4 shape, no title and no 「N 个字」 line, share icon in the header');
  const expectCells = { 1: 181, 2: 165, 3: 110, 4: 144, 5: 110 };
  const expectShape = { 1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [2, 2], 5: [3, 2] };
  const chars = [...'疆酱酝痒嚷'];
  for (const n of [1, 2, 3, 4, 5]) {
    const g = await seedWork(page, { chars: chars.slice(0, n), steps: Array(n).fill('correct'), clock: CLOCK });
    await openResultPage(page, g);
    const v = await resultSnapshot(page);
    assert.equal(v.work.n, n, `${n} chars: work has ${n} cells`);
    assert.equal(v.work.cell, expectCells[n], `${n} chars: cell ${expectCells[n]}`);
    assert.deepEqual([v.work.cols, v.work.rows], expectShape[n], `${n} chars: columns × rows = the default 3:4 image`);
    assert.deepEqual(v.cells.map(c => Math.round(c.rect.w)), Array(n).fill(expectCells[n]), `${n} chars: every cell is ${expectCells[n]} wide`);
    assert.equal(v.title, null, 'daily: no title');
    assert.equal(v.share, true, 'share icon in the header');
    const pageText = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="result-body"]').innerText);
    assert.ok(!/这次记录了|没算在内|点一个格子/.test(pageText), 'no count title / 没算在内 / grid hint');
    if (n === 3) {
      assert.equal(v.kuan, '二〇二六年十月五日　三字', '落款: 汉字日期 + 全角空格 + 汉字字数');
      assert.equal(v.sign.below, 'true', 'last cell in the rightmost column → seal below it');
      const last = v.cells[2].rect;
      assert.ok(Math.abs(v.seal.x + v.seal.w - (last.x + last.w)) <= 3, 'seal right edge = last cell right edge');
      assert.ok(v.seal.y > last.y + last.h, 'seal under the grid');
      assert.ok(Math.abs(v.seal.w - 24) <= 1.5, 'seal 24pt');
    }
    if (n === 2) assert.equal(v.kuan, '二〇二六年十月五日　两字', '2 is written 两');
    if (n === 1) {
      assert.equal(v.kuan, '二〇二六年十月五日', 'a single char has no count');
      assert.ok(Math.abs(v.seal.w - 40) <= 2, 'single char: 40pt seal');
    }
    if (n === 5) {
      assert.equal(v.sign.below, 'false', '3 + 2: the last char is not in the rightmost column → seal beside it');
      const last = v.cells[4].rect;
      assert.ok(v.seal.x >= last.x + last.w - 1, 'seal to the right of the last cell');
      assert.ok(Math.abs(v.seal.y + v.seal.w - (last.y + last.h - Math.round(last.w * 0.06))) <= 3, 'seal bottom raised 0.06c');
    }
    await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
    await waitNavIdle(page);
  }

  // ---------------------------------------------------------------- 2. 没放进图里 · 放进去 · 刷新仍在
  ctx.step('rows: wrong+ink → 「放进去」; seen / skipped / no-ink have no action; 看后写的 caption; the 放进去 state persists across a reload and brings the red dot');
  const g2 = await seedWork(page, { chars: [...'疆酱痒酝嚷醋'], steps: ['correct', 'correct', 'wrong', 'seen-ink', 'skip', 'seen'], clock: CLOCK });
  await openResultPage(page, g2);
  let v = await resultSnapshot(page);
  assert.deepEqual(v.cells.map(c => c.ch), ['疆', '酱', '酝'], 'default members: right + 看后写的');
  assert.deepEqual(v.caps, ['看后写的'], 'caption under the 看后写的 cell (App only)');
  assert.deepEqual(v.rows.map(r => [r.ch, r.state, !!r.add]), [['痒', 'addable', true], ['嚷', 'skipped', false], ['醋', 'seen', false]], 'rows: only the wrong char with ink has 「放进去」');
  assert.equal(v.rows[0].text, '「痒」写错了，没放进图里', 'row text');
  assert.equal(v.rows[0].add.text, '放进去', 'row action');
  assert.ok(v.cells.every(c => !c.hasDot), 'no red dot yet');
  assert.ok(v.preview && v.preview.includes('再来找你'), 'recurrence sentence');
  await page.click(`${topSel('result-add')}`);
  await page.waitForFunction(() => document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-cell"]').length === 4);
  v = await resultSnapshot(page);
  assert.deepEqual(v.cells.map(c => [c.ch, c.hasDot]), [['疆', false], ['酱', false], ['痒', true], ['酝', false]], 'back in its original position, with the red dot (D46 ⑥)');
  assert.equal(v.rows[0].added, 'true', 'row is in the added state');
  assert.equal(v.rows[0].add.text, '拿出来', 'row action flips to 拿出来');
  assert.equal(v.work.cell, 144, '4 chars → 2 × 2, cell 144 (the work re-flowed)');
  const stored = await page.evaluate(() => window.__shiziTest.getState().sessions.lastEnded.A.added);
  assert.deepEqual(stored, [g2.ids[2]], 'stored on the session via store.commit');
  await page.reload();
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  await page.waitForFunction(() => document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-dot"]').length === 1);
  v = await resultSnapshot(page);
  assert.deepEqual(v.cells.map(c => [c.ch, c.hasDot]), [['疆', false], ['酱', false], ['痒', true], ['酝', false]], 'after a reload the added char is still in the work with its dot');
  ctx.step('读屏: the work is one element with its chars / count / date; cells are named by result; 放进去 reads 把「痒」加入图片');
  assert.equal(v.work.label, '作品：疆、酱、痒、酝，4 个字，10 月 5 日', 'the work reads as one element');
  assert.deepEqual(v.cells.map(c => c.label), ['疆，写对，点两下对照和修改', '酱，写对，点两下对照和修改', '痒，写错，点两下对照和修改', '酝，看后写的，点两下对照和修改'], 'cells are named by result');
  assert.equal(await page.getAttribute(`${topSel('result-add')}`, 'aria-label'), '把「痒」从图片里拿出来', 'added → 拿出来 name');
  await page.click(`${topSel('result-add')}`);
  await page.waitForFunction(() => document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-cell"]').length === 3);
  assert.equal(await page.getAttribute(`${topSel('result-add')}`, 'aria-label'), '把「痒」加入图片', 'back out → 加入图片');
  ctx.step('tapping a cell or a row opens the compare / change sheet (D19)');
  await page.click(`${topSel('work-cell')}`);
  await page.waitForSelector(tid('result-sheet'));
  await waitNavIdle(page);
  await page.click(tid('result-sheet-close'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  await waitNavIdle(page);
  await page.click(`${topSel('result-exrow-open')}`);
  await page.waitForSelector(tid('result-sheet'));
  await waitNavIdle(page);
  await page.click(tid('result-sheet-close'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  await waitNavIdle(page);

  ctx.step('no ink at all → plain row of under glyphs with a status word under each, share hidden');
  const g3 = await seedWork(page, { chars: [...'疆酱嚷'], steps: ['seen', 'skip', 'correct-noink'], clock: CLOCK });
  await openResultPage(page, g3);
  v = await resultSnapshot(page);
  assert.equal(v.work.variant, 'plain');
  assert.equal(v.share, false, 'share hidden');
  assert.deepEqual(v.cells.map(c => c.mode), ['under', 'under', 'under']);
  const statuses = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-status"]')].map(e => e.textContent.trim()));
  assert.deepEqual(statuses, ['看过答案', '跳过', '写对']);
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);

  // ---------------------------------------------------------------- 2b. 紧凑高度 / AX（§4.1）
  ctx.step('compact height (SE 375 × 667): the work keeps its size (5 chars → 101), the content scrolls under a fixed button row');
  await page.setViewportSize({ width: 375, height: 667 });
  const gse = await seedWork(page, { chars: [...'疆酱痒酝嚷醋'], steps: ['correct', 'correct', 'wrong', 'seen-ink', 'skip', 'seen'], clock: CLOCK });
  await openResultPage(page, gse);
  v = await resultSnapshot(page);
  assert.equal(v.work.cell, 101, 'SE: cell 101 for 3 chars — the work does not shrink to fit the first screen');
  assert.deepEqual(v.cells.map(c => Math.round(c.rect.w)), [101, 101, 101]);
  assert.ok(v.bodyScroll.sh > v.bodyScroll.ch, `the content is taller than the scroll area (${v.bodyScroll.sh} > ${v.bodyScroll.ch}) → it scrolls`);
  assert.ok(Math.abs(v.foot.y + v.foot.h - 667) <= 1, 'the button row is fixed at the bottom');
  await page.evaluate(() => { const b = document.querySelector('.sz-layer[data-top="true"] .sz-page__body'); b.scrollTop = b.scrollHeight; });
  const v2 = await resultSnapshot(page);
  assert.equal(v2.foot.y, v.foot.y, 'scrolling the content does not move the button row');
  await page.setViewportSize({ width: 402, height: 874 });

  ctx.step('AX3: the work cells do not grow with the text size (the glyph is a picture), buttons stack, 「放进去」 moves under the sentence');
  await openResultPage(page, g2).catch(() => {});
  await setTextSize(page, 'AX3');
  await page.waitForTimeout(200);
  const ax = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const row = top.querySelector('[data-testid="result-exrow"][data-state="addable"]');
    const foot = [...top.querySelectorAll('.sz-page__foot button')].map(rect);
    return {
      cells: [...top.querySelectorAll('[data-testid="work-cell"]')].map(c => Math.round(c.getBoundingClientRect().width)),
      open: row ? rect(row.querySelector('[data-testid="result-exrow-open"]')) : null,
      add: row ? rect(row.querySelector('[data-testid="result-add"]')) : null,
      foot,
      scrolls: (() => { const b = top.querySelector('.sz-page__body'); return b.scrollHeight > b.clientHeight; })(),
      h: document.scrollingElement.scrollWidth > window.innerWidth + 1,
    };
  });
  assert.ok(ax.cells.length >= 3 && ax.cells.every(c => c === ax.cells[0]) && ax.cells[0] >= 100 && ax.cells[0] <= 150, `AX3: work cells keep their size (${ax.cells})`);
  assert.ok(ax.add.y >= ax.open.y + ax.open.h - 1, 'AX: 「放进去」 sits under the sentence');
  assert.ok(ax.foot.length === 2 && ax.foot[1].y > ax.foot[0].y, 'AX: buttons stacked, primary on top');
  assert.equal(ax.scrolls, true, 'AX: the content scrolls');
  assert.equal(ax.h, false, 'AX: no horizontal overflow');
  await setTextSize(page, 'L');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);

  // ---------------------------------------------------------------- 3. 分享弹层
  ctx.step('share sheet: default ratio D47 (3 chars → 1:1, 5 chars → 3:4); preview is the export; chips; 存好了; no 「存下来的是图片」');
  const g5 = await seedWork(page, { chars: [...'疆酱痒酝嚷'], steps: ['correct', 'correct', 'wrong', 'seen-ink', 'correct'], clock: CLOCK });
  await openResultPage(page, g5);
  await openShare(page);
  let p = await preview(page);
  assert.equal(p.ratio, '3:4', '4 chars in the work (痒 not added) → 4 and more → 3:4');
  assert.deepEqual(p.canvases.map(c => [c.w, c.h]), [[1440, 1920]], 'the preview canvas is the 1440 × 1920 export');
  assert.equal(p.canvases[0].ds.members, '疆酱酝嚷');
  assert.deepEqual(p.ratios, [{ r: '3:4', pressed: 'true' }, { r: '1:1', pressed: 'false' }]);
  assert.deepEqual(p.chips, [{ ch: '痒', on: 'false', text: '痒 · 写错' }], '「也放进来」 lists the wrong char with ink');
  assert.ok(!p.all.includes('存下来的是图片'), 'the 「存下来的是图片，不能用来恢复记录」 line is gone (DQ6)');
  assert.deepEqual([p.share.text, p.saveBtn.text], ['分享', '保存图片']);
  assert.equal(p.note, '', 'a single page has no note');
  await page.click('[data-testid="image-chip"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="image-canvas"]').dataset.members === '疆酱痒酝嚷');
  p = await preview(page);
  assert.equal(p.canvases[0].ds.dots, '00100', 'the added char carries the dot in the image');
  assert.equal(p.chips[0].on, 'true');
  const stored2 = await page.evaluate(() => window.__shiziTest.getState().sessions.lastEnded.A.added);
  assert.deepEqual(stored2, [g5.ids[2]], 'the chip writes the same session state as the row');
  await page.click('[data-testid="image-ratio"][data-ratio="1:1"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]').dataset.ratio === '1:1' && document.querySelector('[data-testid="image-canvas"]').height === 1440);
  p = await preview(page);
  assert.deepEqual(p.canvases.map(c => [c.w, c.h]), [[1440, 1440]], '1:1 → 1440 × 1440');
  await page.click('[data-testid="image-ratio"][data-ratio="3:4"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="image-canvas"]').height === 1920);
  // 深色主题下导出图仍是浅纸
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.click('[data-testid="image-chip"]'); // 拿出来 → 重画
  await page.waitForFunction(() => document.querySelector('[data-testid="image-canvas"]').dataset.members === '疆酱酝嚷');
  p = await preview(page);
  const sheetBright = Math.min(...p.canvases[0].corner);
  assert.ok(sheetBright > 200, `dark system theme: the exported image is still light paper (corner ${p.canvases[0].corner})`);
  const dl = await downloadFile(page, () => page.click('[data-testid="image-save"]'));
  assert.ok(/\.jpg$/.test(dl.name), `file name ${dl.name} is a .jpg`);
  assert.deepEqual(jpegSize(dl.buf), { w: 1440, h: 1920 }, 'the saved file is a 1440 × 1920 JPEG');
  const stats = await decodeStats(page, dl.buf);
  assert.ok(Math.min(...stats.corner) > 200 && stats.mean > 190, `saved image is light paper under a dark system theme (corner ${stats.corner}, mean ${Math.round(stats.mean)})`);
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]').dataset.save === 'saved');
  assert.equal(await page.textContent('[data-testid="toast"]'), '存好了', 'success toast');
  await page.emulateMedia({ colorScheme: 'light' });
  await closeShare(page);

  ctx.step('share sheet default: 3 chars → 1:1 (1440 × 1440 file)');
  const g33 = await seedWork(page, { chars: [...'疆酱酝'], steps: ['correct', 'correct', 'correct'], clock: CLOCK });
  await openResultPage(page, g33);
  await openShare(page);
  p = await preview(page);
  assert.equal(p.ratio, '1:1');
  assert.deepEqual(p.canvases.map(c => [c.w, c.h]), [[1440, 1440]]);
  assert.deepEqual(p.chips, [], 'nothing to add → no 「也放进来」');
  const dl2 = await downloadFile(page, () => page.click('[data-testid="image-save"]'));
  assert.deepEqual(jpegSize(dl2.buf), { w: 1440, h: 1440 });
  await closeShare(page);

  // ---------------------------------------------------------------- 5. 月字帖页
  ctx.step('month page: 6 columns of 60, riding day tags only on each day\'s first char, under glyphs for chars with no ink (no 「没有笔迹」 inside), note only when there are some, 纸上 not in');
  await seedMonthRecords(page, {
    clock: '2026-09-24T20:00:00',
    entries: [
      { day: '2026-09-02', chars: '永山水田和静' },
      { day: '2026-09-04', chars: '日月星' },
      { day: '2026-09-10', chars: '风云雨雪', ink: false },
    ],
  });
  await page.evaluate(async () => {
    const st = window.__shiziTest.getState();
    const month = st.records['2026-09'];
    // 再加一条纸上记录（source: 'paper'，无墨）：不该出现
    const rec = { id: 'r900', cardKey: 'base:纸', char: '纸', sessionId: 's900', kind: 'judged', judgment: 'correct', at: Date.now(), localDay: '2026-09-11', source: 'paper', help: { hints: 0, answerSeen: false, traced: false } };
    window.__shiziTest.seed({ records: { '2026-09': [...month, rec] } });
    (await import('/src/ui/router.js')).nav.push('month', { month: '2026-09' });
  });
  await page.waitForSelector(topSel('month-screen'));
  await waitNavIdle(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="month-cell-canvas"]')].every(c => c.dataset.painted === 'true'));
  const m = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const cells = [...top.querySelectorAll('[data-testid="month-cell"]')];
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    return {
      title: top.querySelector('[data-testid="month-title"]').textContent.trim(),
      sub: top.querySelector('[data-testid="month-sub"]').textContent.trim(),
      cols: Number(top.querySelector('[data-testid="month-paper"]').dataset.cols),
      cell: Number(top.querySelector('[data-testid="month-paper"]').dataset.cell),
      firstRowN: cells.filter(c => Math.abs(c.getBoundingClientRect().y - cells[0].getBoundingClientRect().y) < 2).length,
      widths: [...new Set(cells.map(c => Math.round(c.getBoundingClientRect().width)))],
      chars: cells.map(c => c.dataset.char).join(''),
      modes: cells.map(c => c.dataset.mode[0]).join(''),
      tags: cells.map(c => c.dataset.tag).join('|'),
      tagEls: [...top.querySelectorAll('[data-testid="month-tag"]')].map(t => ({ text: t.textContent.trim(), size: getComputedStyle(t).fontSize, weight: getComputedStyle(t).fontWeight, top: Math.round(t.getBoundingClientRect().y - t.parentElement.getBoundingClientRect().y) })),
      note: top.querySelector('[data-testid="month-note"]') ? top.querySelector('[data-testid="month-note"]').textContent.trim() : null,
      kuan: top.querySelector('[data-testid="month-kuan"]').textContent.trim(),
      text: top.querySelector('[data-testid="month-paper"]').innerText,
      noInkLabel: top.querySelectorAll('.sz-scell__noink').length,
      underAria: cells.filter(c => c.dataset.mode === 'under').map(c => c.getAttribute('aria-label')),
      foot: [...top.querySelectorAll('.sz-page__foot button')].map(b => b.textContent.trim()),
    };
  });
  assert.equal(m.title, '9月字帖');
  assert.equal(m.sub, '按第一次写下的先后排列');
  assert.deepEqual([m.cols, m.cell, m.firstRowN, m.widths], [6, 60, 6, [60]], '6 columns of ⌊(402 − 40) / 6⌋ = 60');
  assert.equal(m.chars, '永山水田和静日月星风云雨雪', 'the 纸上 char 纸 is not on the page');
  assert.equal(m.modes, 'hhhhhhhhhuuuu', 'chars with no ink all month are under cells');
  assert.equal(m.tags, '2||||||4|||10|||', 'a day tag on the first char of each day only (day number, no month)');
  assert.ok(m.tagEls.every(t => t.size === '11px' && Number(t.weight) >= 500), 'tag 11pt / 500');
  assert.ok(m.tagEls.every(t => t.top <= 0 && t.top >= -10), 'the tag rides on the cell\'s top line');
  assert.equal(m.note, '浅色的字，这个月没有留下笔迹。点一个字看详情。');
  assert.equal(m.kuan, '二〇二六年九月　十三字', '纸上 not counted');
  assert.ok(!m.text.includes('没有笔迹') && m.noInkLabel === 0, 'no 「没有笔迹」 written inside the cells');
  assert.deepEqual(m.underAria, ['风，这个月没有留下笔迹', '云，这个月没有留下笔迹', '雨，这个月没有留下笔迹', '雪，这个月没有留下笔迹']);
  assert.deepEqual(m.foot, ['分享', '保存图片']);
  ctx.step('month page: all chars have ink → the note is not there');
  await seedMonthRecords(page, { clock: '2026-09-24T20:00:00', entries: [{ day: '2026-09-02', chars: '永山水' }] });
  await page.evaluate(async () => { (await import('/src/ui/router.js')).nav.replace('month', { month: '2026-09' }); });
  await page.waitForFunction(() => document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="month-cell"]').length === 3);
  assert.equal(await page.locator(topSel('month-note')).count(), 0, 'no note when every char has ink');
  ctx.step('month page share: ratio defaults by count (3 chars → 1:1); month kuan');
  await waitNavIdle(page);
  await page.click(topSel('month-share-btn'));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
  p = await preview(page);
  assert.equal(p.ratio, '1:1');
  assert.equal(p.canvases[0].ds.signature, '二〇二六年九月　三字');
  await closeShare(page);

  // ---------------------------------------------------------------- 4. 超过 80 字分张
  ctx.step('> 80 chars: split by date into pages ≤ 80, 其一 / 其二, each page its own count and layout; the sheet pages horizontally with dots; 保存 2 张图片 downloads two files');
  const many = [{ day: '2026-09-10', chars: '' }];
  const pool = [...'酱疆酝嚷痒酿罐履尬醋嗽贷膝颤截屉鼎嚼鲍撤蹭嘱憋馒阁龄戴趟馅腐囊遣梳厦馨痪祥橡燥舔痕寓躁搓碗赡琢逢鬓嘀症撕鹰毯凌谨赠碱峻澈籍旗匙榴噪颜渊翠腻鹿塌燕酪瘩辫彰陵翼辖剪魅蟹樱浆鉴辨褥疲馍壤锋疤滥瓢竣疹寨辙憔啸痰膏饺瘫阐瘤檬蜂痘雕骏嗦癣隧焰蹋憎袍裳灌馋桨裙臀禄峰'];
  many[0].chars = pool.slice(0, 96).join('');
  many.push({ day: '2026-09-12', chars: pool.slice(96, 100).join('') });
  assert.ok(pool.length >= 100, `pool has ${pool.length}`);
  await seedMonthRecords(page, { clock: '2026-09-24T20:00:00', entries: many });
  await page.evaluate(async () => { (await import('/src/ui/router.js')).nav.replace('month', { month: '2026-09' }); });
  await page.waitForFunction(() => document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="month-cell"]').length === 100);
  await waitNavIdle(page);
  await page.click(topSel('month-share-btn'));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
  await page.waitForTimeout(500);
  p = await preview(page);
  assert.equal(p.pages, 2, '100 chars → two pages');
  assert.equal(p.ratio, '3:4');
  assert.deepEqual(p.canvases.map(c => c.ds.n), ['80', '20'], 'each page ≤ 80; the last page has its own count');
  assert.deepEqual(p.canvases.map(c => c.ds.signature), ['二〇二六年九月　八十字　其一', '二〇二六年九月　二十字　其二']);
  assert.deepEqual(p.canvases.map(c => [c.ds.columns, c.ds.rows]), [['8', '10'], ['4', '5']], 'the last page is laid out for 20 chars, not a big grid with a corner filled');
  assert.equal(p.canvases[1].ds.tags.split('|')[0], '10', 'a new page starts with the day tag');
  assert.equal(p.dots, 2, 'page dots');
  assert.equal(p.note, '100 个字，存成 2 张，每张不超过 80 字。');
  assert.equal(p.saveBtn.text, '保存 2 张图片');
  assert.equal(p.canvases.length, 2);
  const files = [];
  page.on('download', async d => { files.push(d); });
  await page.click('[data-testid="image-save"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]').dataset.save === 'saved');
  assert.equal(files.length, 2, 'two files saved');
  assert.deepEqual(files.map(f => f.suggestedFilename().replace(/^.*-(\d)of2\.jpg$/, '$1of2')), ['1of2', '2of2']);
  for (const f of files) assert.deepEqual(jpegSize(fs.readFileSync(await f.path())), { w: 1440, h: 1920 });
  page.removeAllListeners('download');
  await closeShare(page);

  // ---------------------------------------------------------------- 6. 年报
  ctx.step('annual report: 卷首 → monthly sections → 卷尾; tapping a month opens that month\'s page; saving shows the album page count and the long-image text button');
  await seedMonthRecords(page, {
    clock: '2026-10-04T20:00:00',
    entries: [
      { day: '2026-04-26', chars: '春窗茶' },
      { day: '2026-04-27', chars: '疆酱' },
      { day: '2026-05-10', chars: '笔笑朋夏灯饭纸梦亲' },
      { day: '2026-05-11', chars: '秋床酒念冬桌米写爱', ink: false },
      { day: '2026-09-10', chars: pool.slice(2, 98).join('') },
      { day: '2026-10-02', chars: '疆' },
    ],
  });
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.push('annual', {}));
  await page.waitForSelector(topSel('annual-screen'));
  await waitNavIdle(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.sz-layer[data-top="true"] canvas')].every(c => c.dataset.painted === 'true'));
  const a = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    return {
      year: q('annual-year').textContent.trim(),
      head: q('annual-head').textContent.trim(),
      first: { char: q('annual-first').dataset.char, day: q('annual-first').dataset.day, ink: q('annual-first').dataset.ink, label: q('annual-first-label').textContent.trim(), date: q('annual-first-date').textContent.trim(), size: q('annual-first-cell').getBoundingClientRect().width },
      months: [...top.querySelectorAll('[data-testid="annual-month"]')].map(b => ({
        month: b.dataset.month, n: Number(b.dataset.n), name: b.querySelector('[data-testid="annual-month-name"]').textContent.trim(),
        count: b.querySelector('[data-testid="annual-month-count"]').textContent.trim(),
        cell: b.querySelector('[data-testid="annual-month-cell"]').getBoundingClientRect().width,
        cols: getComputedStyle(b.querySelector('[data-testid="annual-month-grid"]')).gridTemplateColumns.split(' ').length,
        under: b.querySelectorAll('[data-testid="annual-month-cell"][data-mode="under"]').length,
      })),
      twice: q('annual-twice') ? { char: q('annual-twice').dataset.char, dates: [...top.querySelectorAll('[data-testid="annual-twice-date"]')].map(e => e.textContent.trim()), size: q('annual-twice-first').getBoundingClientRect().width } : null,
      pageTitle: top.querySelector('[data-page-title]').textContent.trim(),
      stats: /最忙|较少见|有记录天数/.test(top.innerText),
      share: !!q('annual-share'),
    };
  });
  assert.equal(a.year, '二〇二六');
  assert.equal(a.head, '这一年，你写过 119 个字。');
  assert.deepEqual([a.first.char, a.first.ink, a.first.label, a.first.date, Math.round(a.first.size)], ['春', 'true', '今年第一个字', '4 月 26 日 的笔迹', 132]);
  assert.deepEqual(a.months.map(x => [x.month, x.n, x.name, x.count]), [['2026-04', 5, '4月', '5 字'], ['2026-05', 18, '5月', '18 字'], ['2026-09', 96, '9月', '96 字'], ['2026-10', 1, '10月', '1 字']]);
  assert.ok(a.months.every(x => x.cols === 8 && Math.round(x.cell) === 45), 'month sections: 8 columns of 45');
  assert.equal(a.months[1].under, 9, 'chars without ink are under cells');
  assert.deepEqual([a.twice.char, a.twice.dates, Math.round(a.twice.size)], ['疆', ['4 月 27 日', '10 月 2 日'], 140], '卷尾: the same char, first and latest ink');
  assert.equal(a.pageTitle, '年报');
  assert.equal(a.stats, false, 'no statistics sections');
  assert.equal(a.share, true);
  await page.click(`${topSel('annual-month')}[data-month="2026-05"]`);
  await page.waitForSelector(topSel('month-screen'));
  await waitNavIdle(page);
  assert.equal(await page.textContent(topSel('month-title')), '5月字帖', 'the month section opens the month page');
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.back());
  await waitNavIdle(page);
  await page.click(topSel('annual-share'));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]')?.dataset.state === 'ready');
  await page.waitForTimeout(800);
  p = await preview(page);
  // 卷首 1 + 四月 1 + 五月 1 + 九月 2（96 字 → 80 + 16）+ 十月 1 + 卷尾 1 = 7
  assert.equal(p.pages, 7, 'album: cover + 4 months (9月 split in two) + tail');
  assert.equal(p.saveBtn.text, '保存 7 张图片');
  assert.deepEqual(p.canvases.map(c => c.ds.kind), ['annual-cover', 'annual-month', 'annual-month', 'annual-month', 'annual-month', 'annual-month', 'annual-tail']);
  assert.deepEqual(p.ratios, [], 'the album is always 3:4: no ratio segment');
  assert.equal(p.long.text, '存成一张长图');
  assert.ok(p.all.includes('存成册页：卷首、每个月、卷尾，每张 3:4。'));
  assert.ok(!p.all.includes('这一页不能保存成图片'));
  const long = await downloadFile(page, () => page.click('[data-testid="image-long"]'));
  const lsz = jpegSize(long.buf);
  assert.equal(lsz.w, 1440, 'the long image is 1440 wide');
  assert.ok(lsz.h > 1920 && lsz.h <= 11650, `height by content (${lsz.h})`);
  assert.ok(/long/.test(long.name));
  await closeShare(page);
  ctx.step('annual long image over the height limit is cut by month, no char dropped');
  const split = await page.evaluate(async () => {
    const { annualPlan } = await import('/src/ui/screens/mine/annual-model.js');
    const { renderAnnualLong } = await import('/src/core/images/annual-render.js');
    const { requireCanvasFont } = await import('/src/data/font-loader.js');
    const { loadStrokes } = await import('/src/data/strokes.js');
    const { paintBrushStroke } = await import('/src/ui/canvas/brush.js');
    const pts = [[{ x: 60, y: 170, w: 11.5 }, { x: 280, y: 172, w: 11.5 }]];
    const plan = annualPlan(window.__shiziTest.getState(), { today: '2026-10-04', inkOf: () => pts, hasInk: () => true });
    const out = await renderAnnualLong({
      yearText: 'x', line: 'y', first: plan.first, firstLabel: 'a', firstDate: 'b', kuan: 'k', sealText: '字',
      months: plan.months.map(mm => ({ name: String(mm.monthNum), count: String(mm.cells.length), cells: mm.cells })), tail: null,
      maxExportHeight: 3000, paintStroke: paintBrushStroke, requireFont: requireCanvasFont, loadGlyph: loadStrokes,
    });
    return { parts: out.canvases.length, heights: out.heights, n: out.canvases.reduce((s, c) => s + Number(c.dataset.n), 0) };
  });
  assert.ok(split.parts >= 2 && split.heights.every(h => h <= 3000), `cut into ${split.parts} parts ≤ 3000px: ${split.heights}`);
  assert.equal(split.n, 5 + 18 + 96 + 1, 'every char of every month is in some part');
}
