// 图片（02 M4-5；01 §10；04 R-I01–R-I04、R-P03、R-D04、R-B10、A05；03 P02 / P25 / P50；T06-C；阶段 1 P1-E7 改按「作品」口径重写，交接 §4–§8）。
//
//   1. 结果页右上「分享」（setResultImageAction 已注册）→ 弹层：标题、默认比例 D47（1 字 → 1:1）、画布 1440 × 1440 与 dataset（成员 = 作品成员：写错的 永 不在默认里，
//      静 在；recordId = 本组那条记录；落款只有日期）、「也放进来」chip（永）、切 3:4 → 1440 × 1920。
//   2. 浏览器：「分享」走 navigator.share({files})（stub，JPEG）；「保存图片」= 下载 JPEG（文件名、JFIF 头、尺寸），保存键原地变「已存好」（无提示）。
//   3. 单字详情「把这个字做成图片」：有笔迹 → 手写字图片（A05：1080 × 1440、拼音 · 日期、落款「拾字」）；最近一次没有笔迹 → 置灰 + R-D04。
//   4. {月}字帖（我的「保存图片 ›」注册的去处 openMonthImage）：P02 本月第一次、骑线角标（只写日）、整月没墨的字画衬底（仍占一格、仍计字数）、有记录天数；
//      这天写的字（R-P03）。
//   5. > 80 字不再 pending（D39）：按日期分页、每页 ≤ 80 字、不截字。
//   6. 原生壳（假 webkit.messageHandlers）：「保存图片」发 savePracticeCard（Q2-6 起原生壳也收 JPEG，P162）→ shiziCardSaved({success:false})
//      → R-B10 失败说明 +「再试一次」→ 成功 → 保存键原地变「已存好」（无提示）；「分享」发 sharePracticeCard。
//   7. 全程不写存储（getWriteLog 无新增；「也放进来」是例外：它经 store.commit 写本组会话的 added，单独断言）。

import fs from 'node:fs';
import { bootTestHost, installNativeStub, nativeMessages, PRESS_SETTLE_MS, tid, topSel, waitNavIdle } from './helpers.mjs';

const CLOCK = '2026-09-24T20:00:00';
const COPY = {
  kindSession: '本次图片',
  kindGlyph: '单字图片',
  kindMonth: '9月字帖',
  sessionSign: '二〇二六年九月二十四日　一字',
  dayDoneSign: '二〇二六年九月二十四日　一字',
  monthSign: '二〇二六年九月　五字',
  share: '分享',
  save: '保存图片',
  retry: '再试一次',
  denied: '没存进相册。请在手机设置允许添加照片。',
  saved: '已存好',
  noInk: '最近一次没有笔迹，再写一次就能做图片。', // R-D04.noInkNote（D27 起 perRecordInk 默认开启：再写一次就存下墨迹；关闭态 A5 见 ink-copy 单测）
  brand: '拾字',
};

/**
 * 造数（真实 mutator judgeInDraft / endSlot）：
 *   s1（9-02 永 有墨）、s2（9-04 山 有墨）、s3（9-10 水 无墨）、s4（8-28 田 有墨，不在九月）——各一字一会话；
 *   本组 s9（daily，9-24）：永 写错 有墨 / 和 写对 无墨 / 静 写对 有墨，结束后在 lastEnded.A。
 *   extra81：再加 81 个九月有墨的字（> 80 → pending）。
 */
async function seed(page, { extra81 = false } = {}) {
  const res = await page.evaluate(async ({ extra }) => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession, endSlot } = await import('/src/core/sessions.js');
    const { allCards } = await import('/src/data/deck.js');
    window.__shiziTest.reset();
    window.__shiziTest.setClock('2026-09-24T20:00:00');
    const now = window.__shiziTest.now();
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = p => p + (n += 1);
    const stroke = [
      [{ x: 60, y: 120, t: 0 }, { x: 170, y: 121, t: 60 }, { x: 280, y: 122, t: 120 }],
      [{ x: 172, y: 60, t: 400 }, { x: 173, y: 170, t: 460 }, { x: 174, y: 290, t: 520 }],
    ];
    const day = d => new Date(`${d}T09:00:00`).getTime();
    const one = (char, at, ink) => {
      draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + char], at });
      judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + char, judgment: 'correct', strokes: stroke, at, nextId, perRecordInk: ink });
      draft.sessions.A = null;
    };
    one('永', day('2026-09-02'), true);
    one('山', day('2026-09-04'), true);
    one('水', day('2026-09-10'), false);
    one('田', day('2026-08-28'), true);
    if (extra) {
      const chars = allCards().map(c => c.target || c.char).filter(c => c && !'永山水田和静'.includes(c)).slice(0, 81);
      chars.forEach((c, i) => one(c, day('2026-09-15') + i * 1000, true));
    }
    const t0 = now - 3600000;
    draft.sessions.A = createSession({ id: 's90', kind: 'daily', source: { view: 'home' }, queue: ['base:永', 'base:和', 'base:静'], at: t0 });
    judgeInDraft(draft, { slot: 'A', cardKey: 'base:永', judgment: 'wrong', strokes: stroke, at: t0 + 1000, nextId, perRecordInk: true });
    judgeInDraft(draft, { slot: 'A', cardKey: 'base:和', judgment: 'correct', strokes: stroke, at: t0 + 2000, nextId, perRecordInk: false });
    judgeInDraft(draft, { slot: 'A', cardKey: 'base:静', judgment: 'correct', strokes: stroke, at: t0 + 3000, nextId, perRecordInk: true });
    draft.sessions = endSlot(draft.sessions, 'A', { at: t0 + 4000 });
    const r = window.__shiziTest.seed(draft);
    const st = window.__shiziTest.getState();
    const flat = [];
    for (const v of Object.values(st.records || {})) for (const x of Array.isArray(v) ? v : (v && v.kept) || []) flat.push(x);
    return { ok: !!(r && r.ok), r, flat };
  }, { extra: extra81 });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
  return res.flat;
}

const idOf = (flat, char, sessionId = null) => {
  const rows = flat.filter(r => r.char === char && r.kind === 'judged' && (!sessionId || r.sessionId === sessionId));
  return rows.length ? rows[rows.length - 1].id : null;
};

async function writeCount(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog().length);
}

async function preview(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="image-preview"]');
    if (!root) return null;
    const c = root.querySelector('[data-testid="image-canvas"]');
    const btn = id => {
      const el = root.querySelector(`[data-testid="${id}"]`);
      return el ? { text: el.textContent.trim(), disabled: el.disabled, aria: el.getAttribute('aria-disabled') } : null;
    };
    const sheet = document.querySelector('[data-testid="image-sheet"]');
    return {
      kind: root.dataset.kind,
      state: root.dataset.state,
      ratio: root.dataset.ratio,
      saveState: root.dataset.save,
      pages: Number(root.dataset.pages),
      title: sheet && sheet.querySelector('.sz-sheet__title') ? sheet.querySelector('.sz-sheet__title').textContent.trim() : null,
      dialog: sheet ? { role: sheet.getAttribute('role'), modal: sheet.getAttribute('aria-modal'), label: !!sheet.getAttribute('aria-labelledby') } : null,
      note: root.querySelector('[data-testid="image-note"]').textContent.trim(),
      boardNote: root.querySelector('[data-testid="image-board-note"]') ? root.querySelector('[data-testid="image-board-note"]').textContent.trim() : null,
      canvas: c ? { ...c.dataset, width: c.width, height: c.height } : null,
      canvases: [...root.querySelectorAll('[data-testid="image-canvas"]')].map(x => ({ ...x.dataset, width: x.width, height: x.height })),
      ratios: [...root.querySelectorAll('[data-testid="image-ratio"]')].map(b => ({ r: b.dataset.ratio, pressed: b.getAttribute('aria-pressed'), text: b.textContent.trim() })),
      chips: [...root.querySelectorAll('[data-testid="image-chip"]')].map(b => ({ ch: b.dataset.char, on: b.dataset.on })),
      share: btn('image-share'),
      save: btn('image-save'),
      retry: btn('image-retry'),
    };
  });
}

async function waitPreview(page, state = 'ready') {
  await page.waitForFunction(s => {
    const r = document.querySelector('[data-testid="image-preview"]');
    return !!r && r.dataset.state === s;
  }, state);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function closeOverlay(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await waitNavIdle(page);
}

async function openResult(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('result', { slot: 'A', sessionId: 's90' });
  });
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
}

async function openDetail(page, char) {
  await page.evaluate(async c => {
    const { openDetail: open } = await import('/src/ui/screens/detail/index.js');
    open(c);
  }, char);
  await page.waitForSelector(topSel('detail-screen'));
  await waitNavIdle(page);
}

async function goHome(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('home');
  });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
}

export default async function run(page, ctx) {
  const { assert } = ctx;
  await bootTestHost(page, ctx.baseURL);
  let flat = await seed(page);
  const writes = [];

  // ------------------------------------------------------------------ 1. 结果页右上「分享」
  ctx.step('result page share icon → session image (D47 default 1:1 for one char, work members, record ids, 落款, chips)');
  await openResult(page);
  let w0 = await writeCount(page);
  const entry = await page.$(topSel('result-share'));
  assert.ok(!!entry, 'result page shows the share icon once M4-5 registers it (the work has ink)');
  assert.equal(await entry.getAttribute('aria-label'), '分享这次的图片', 'share icon accessible name');
  await entry.click();
  await waitPreview(page);
  let v = await preview(page);
  assert.equal(v.kind, 'session', 'preview kind');
  assert.equal(v.title, COPY.kindSession, 'title R-I01.kindSession');
  assert.deepEqual(v.dialog, { role: 'dialog', modal: 'true', label: true }, 'sheet is a labelled modal dialog');
  assert.equal(v.ratio, '1:1', 'D47: one char defaults to 1:1');
  assert.deepEqual(v.ratios, [{ r: '3:4', pressed: 'false', text: '3:4' }, { r: '1:1', pressed: 'true', text: '1:1' }], 'ratio buttons');
  assert.deepEqual([v.canvas.width, v.canvas.height], [1440, 1440], '1:1 canvas 1440×1440');
  assert.equal(v.canvas.members, '静', 'members = the work: 静 (right, ink); 永 is wrong → not in by default; 和 has no ink → never');
  assert.equal(v.canvas.recordIds, idOf(flat, '静', 's90'), 'the cell ink = this session\'s record (D11)');
  assert.equal(v.canvas.signature, COPY.sessionSign, 'a single char: 落款 = date + 「一字」 (汉字数字; the count is always written, V2-05)');
  assert.equal(v.canvas.n, '1', 'n');
  assert.equal(v.note, '', 'no note on a single page (「存下来的是图片…」 is gone, DQ6)');
  assert.deepEqual(v.chips, [{ ch: '永', on: 'false' }], '「也放进来」: 永 (wrong, with ink)');
  assert.deepEqual([v.share.text, v.save.text, v.share.disabled, v.save.disabled], [COPY.share, COPY.save, false, false], 'two buttons enabled');
  await page.click(`${tid('image-ratio')}[data-ratio="3:4"]`);
  await page.waitForFunction(() => document.querySelector('[data-testid="image-canvas"]').height === 1920);
  v = await preview(page);
  assert.equal(v.ratio, '3:4', '3:4 selected');
  assert.deepEqual([v.canvas.width, v.canvas.height], [1440, 1920], '3:4 canvas 1440×1920');
  assert.equal(v.canvas.members, '静', 'same members in 3:4');

  // ------------------------------------------------------------------ 2. 浏览器分享 / 保存
  ctx.step('browser: 分享 → navigator.share({files}) JPEG; 保存图片 → JPEG download + 「存好了」');
  await page.evaluate(() => {
    window.__shared = [];
    navigator.canShare = d => !!(d && d.files && d.files.length);
    navigator.share = async d => { window.__shared.push(d.files.map(f => ({ name: f.name, type: f.type, size: f.size }))); };
  });
  await page.click(tid('image-share'));
  await page.waitForFunction(() => window.__shared.length === 1);
  const shared = await page.evaluate(() => window.__shared[0]);
  assert.equal(shared.length, 1, 'one file shared');
  assert.equal(shared[0].type, 'image/jpeg', 'shared file is a JPEG (§6.5)');
  assert.equal(shared[0].name, 'shizi-session-s90-3x4.jpg', 'shared file name');
  assert.ok(shared[0].size > 1000, 'shared file has content');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(tid('image-save'))]);
  assert.equal(dl.suggestedFilename(), 'shizi-session-s90-3x4.jpg', 'download file name');
  const buf = fs.readFileSync(await dl.path());
  assert.deepEqual([buf[0], buf[1]], [0xff, 0xd8], 'downloaded file is a JPEG');
  let sof = null;
  for (let i = 2; i < buf.length - 9 && !sof;) {
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) sof = { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    else i += 2 + buf.readUInt16BE(i + 2);
  }
  assert.deepEqual(sof, { w: 1440, h: 1920 }, 'downloaded JPEG is 1440×1920');
  // Q2-6：JPEG 0.92 比同一张画布的 PNG 小得多（复测 simB：PNG 约 2.2MB/张）
  const pngBytes = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="image-canvas"]');
    const b64 = c.toDataURL('image/png').split(',')[1];
    return Math.floor(b64.length * 3 / 4);
  });
  assert.ok(buf.length < pngBytes * 0.6, `JPEG ${buf.length} B is well under the PNG ${pngBytes} B of the same canvas`);
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]').dataset.save === 'saved');
  assert.equal(await page.locator(tid('toast')).count(), 0, 'I3 P0-07: success shows no toast');
  assert.equal((await page.textContent(tid('image-save'))).trim(), COPY.saved, 'the save button changes in place to 「已存好」');
  // 「也放进来」：永 加入 → 重画，成员 永静，永带朱点；写进本组会话（这是本 spec 里唯一的存储写入）
  const wBefore = await writeCount(page);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(tid('image-chip'));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-canvas"]').dataset.members === '永静');
  v = await preview(page);
  assert.equal(v.canvas.dots, '10', '永 carries the red dot (D46 ⑥)');
  assert.equal(v.canvas.recordIds, [idOf(flat, '永', 's90'), idOf(flat, '静', 's90')].join(','), 'record ids in group order');
  assert.ok((await writeCount(page)) > wBefore, 'the chip is a store.commit (session.added)');
  await closeOverlay(page);
  assert.equal(await page.evaluate(() => document.querySelector('.sz-app').dataset.topScreen), 'result', 'closing returns to the result page');
  assert.equal(await page.locator(`${topSel('work-cell')}[data-char="永"] [data-testid="work-dot"]`).count(), 1, 'the result page shows 永 in the work with its dot');

  // ------------------------------------------------------------------ 3. 单字详情 → 手写字图片
  ctx.step('detail 「做成图片」: ink → 单字图片 (A05); latest without ink → greyed + R-D04');
  await goHome(page);
  await openDetail(page, '静');
  w0 = await writeCount(page);
  let row = await page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-image"]');
    return el ? { state: el.dataset.state, tag: el.tagName, text: el.textContent.trim() } : null;
  });
  assert.equal(row && row.state, 'ok', 'detail image row registered and active for 静');
  assert.equal(row.tag, 'BUTTON', 'active row is a button');
  await page.click(topSel('detail-image'));
  await waitPreview(page);
  v = await preview(page);
  const py = await page.evaluate(async () => (await import('/src/data/deck.js')).cardForKey('base:静').py);
  assert.ok(!!py, 'deck pinyin for 静');
  assert.equal(v.kind, 'glyph', 'glyph preview');
  assert.equal(v.title, COPY.kindGlyph, 'title R-I01.kindGlyph');
  assert.equal(v.ratio, '3:4', 'the single-char hand-written image keeps 3:4 (D47 is about works)');
  assert.deepEqual([v.canvas.width, v.canvas.height], [1080, 1440], 'A05 3:4 1080×1440');
  assert.equal(v.canvas.caption, `${py} · 9月24日`, 'caption 「拼音 · 日期」 (R-I02)');
  assert.equal(v.canvas.signature, COPY.brand, 'bottom-right 「拾字」');
  assert.equal(v.canvas.recordIds, idOf(flat, '静'), 'ink = latest judged record of 静');
  assert.ok(Number(v.canvas.glyphWidth) <= 648, 'ink box ≤ 60% of the width');
  await page.click(`${tid('image-ratio')}[data-ratio="1:1"]`);
  await page.waitForFunction(() => document.querySelector('[data-testid="image-canvas"]').height === 1080);
  v = await preview(page);
  assert.deepEqual([v.canvas.width, v.canvas.height], [1080, 1080], 'A05 1:1 1080×1080');
  await closeOverlay(page);
  writes.push((await writeCount(page)) - w0);

  await openDetail(page, '和');
  row = await page.evaluate(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-image"]');
    return el ? { state: el.dataset.state, tag: el.tagName, aria: el.getAttribute('aria-disabled'), text: el.textContent.trim() } : null;
  });
  assert.equal(row && row.state, 'noInk', '和: latest judged has no ink → greyed');
  assert.ok(row.tag !== 'BUTTON' || row.aria === 'true', 'greyed row is not an active button');
  assert.ok(row.text.includes(COPY.noInk), 'R-D04.noInkNote (perRecordInk on, D27)');
  assert.ok(row.text.includes('再写一次就能做图片'), 'D27: writing again stores the ink, so the promise holds');
  const noInkPlan = await page.evaluate(async () => {
    const { buildImageJob } = await import('/src/ui/images-entry.js');
    const job = buildImageJob({ kind: 'glyph', char: '和' });
    return { status: job.plan.status, emptyNote: job.emptyNote };
  });
  assert.deepEqual(noInkPlan, { status: 'noInk', emptyNote: COPY.noInk }, 'glyph image for a no-ink latest is not generated');

  // ------------------------------------------------------------------ 4. 月字帖
  ctx.step('{月}字帖 (openMonthImage, mine 「保存图片 ›」): P02 first of month, day tags, under cells for no-ink chars, days, 落款');
  w0 = await writeCount(page);
  const mineHook = await page.evaluate(async () => {
    const m = await import('/src/ui/screens/mine/records.js');
    return typeof m.getMineImageActions === 'function'
      ? { month: typeof m.getMineImageActions().month, today: typeof m.getMineImageActions().today }
      : null;
  });
  assert.deepEqual(mineHook, { month: 'function', today: 'function' }, 'mine image actions registered (setMineImageActions)');
  await page.evaluate(async () => {
    const m = await import('/src/ui/screens/mine/records.js');
    m.getMineImageActions().month({ month: '2026-09' });
  });
  await waitPreview(page);
  v = await preview(page);
  assert.equal(v.kind, 'month', 'month preview');
  assert.equal(v.title, COPY.kindMonth, 'title 「9月字帖」');
  assert.equal(v.ratio, '3:4', '5 chars → 3:4 (D47)');
  assert.equal(v.canvas.members, '永山水和静', 'first-appearance order; 水 and 和 had no ink all month → still on the page as under cells (§7)');
  assert.equal(v.canvas.modes, 'hhuuh', 'ink / under per cell');
  assert.equal(v.canvas.recordIds, [idOf(flat.filter(r => r.localDay === '2026-09-02'), '永'), idOf(flat, '山'), idOf(flat.filter(r => r.localDay === '2026-09-10'), '水'),
    idOf(flat, '和'), idOf(flat, '静')].join(','), '永 uses its FIRST September record (9-02, P02 first), not the 9-24 one');
  assert.equal(v.canvas.tags, '2|4|10|24|', 'day tag (day only) on the first char of each day');
  assert.equal(v.canvas.days, '4', 'days with judged records (9-02, 9-04, 9-10, 9-24)');
  assert.equal(v.canvas.signature, COPY.monthSign, 'month 落款 counts the under cells too');
  assert.equal(v.note, '', 'no note');
  await closeOverlay(page);

  ctx.step('day image (「本次图片 · 保存图片 ›」 on 练习记录): that day\'s chars with ink, latest each');
  await page.evaluate(async () => {
    const m = await import('/src/ui/screens/mine/records.js');
    m.getMineImageActions().today({ day: '2026-09-24' });
  });
  await waitPreview(page);
  v = await preview(page);
  assert.equal(v.kind, 'day', 'day preview');
  assert.equal(v.canvas.members, '静', 'that day\'s work members with ink: 永 was written wrong (not a member, D51 ⑤), 和 has no ink → not drawn');
  assert.equal(v.canvas.signature, COPY.dayDoneSign, 'day 落款');
  await closeOverlay(page);

  writes.push((await writeCount(page)) - w0);
  assert.deepEqual(writes, [0, 0], 'opening / rendering images writes nothing to storage (detail, mine)');

  ctx.step('> 80 chars → pages (D39): no pending any more, each page ≤ 80, nothing truncated, sheet pages with dots');
  flat = await seed(page, { extra81: true });
  await page.evaluate(async () => {
    const { openMonthImage } = await import('/src/ui/images-entry.js');
    openMonthImage({ month: '2026-09' });
  });
  await waitPreview(page);
  await page.waitForTimeout(600);
  v = await preview(page);
  assert.ok(v.pages >= 2, `${v.pages} pages`);
  assert.ok(v.canvases.every(c => Number(c.n) <= 80), 'every page ≤ 80 chars');
  assert.equal(v.canvases.reduce((n, c) => n + Number(c.n), 0), 86, 'nothing truncated (81 + 永 山 水 和 静)');
  assert.ok(v.canvases.every(c => /其[一二三四五六七八九十]$/.test(c.signature)), 'each page 落款 ends with 其几');
  assert.equal(v.share.disabled, false, 'share enabled (the old pending state is gone)');
  await closeOverlay(page);

  // ------------------------------------------------------------------ 5. 原生壳
  ctx.step('native shell: savePracticeCard (JPEG since Q2-6, P162) → shiziCardSaved false → R-B10 + 再试一次 → true → 保存键原地变已存好; sharePracticeCard');
  await installNativeStub(page);
  await bootTestHost(page, ctx.baseURL);
  flat = await seed(page);
  await openResult(page);
  await page.click(topSel('result-share'));
  await waitPreview(page);
  await page.click(tid('image-save'));
  await page.waitForFunction(() => (window.__nativeMsgs || []).some(m => m.type === 'savePracticeCard'));
  let msgs = await nativeMessages(page, 'savePracticeCard');
  assert.equal(msgs.length, 1, 'one savePracticeCard message');
  assert.ok(msgs[0].dataURL.startsWith('data:image/jpeg;base64,'), 'dataURL is a JPEG (Q2-6: WebViewController.imageData accepts JPEG, NATIVE_ACCEPTS_JPEG = true)');
  assert.deepEqual([msgs[0].kind, msgs[0].name], ['session', 'shizi-session-s90-1x1.jpg'], 'kind and file name (extension follows the real format)');
  v = await preview(page);
  assert.equal(v.saveState, 'busy', 'waiting for the native callback');
  await page.evaluate(() => window.shiziCardSaved({ success: false }));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]').dataset.save === 'failed');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  v = await preview(page);
  // 三段式（S1，审计 P1-29）：说明按原因写（原生没写进相册 → R-B10.albumDenied），[先不保存 | 再试一次] 就地换掉两键
  assert.equal((await page.textContent(tid('image-fail-note'))).trim(), COPY.denied, 'failure sentence R-B10.albumDenied (native album write failed)');
  assert.equal(v.save, null, '保存图片 replaced');
  assert.deepEqual([v.retry.text, v.retry.disabled], [COPY.retry, false], '再试一次');
  assert.equal((await page.textContent(tid('image-fail-cancel'))).trim(), '先不保存', '先不保存');
  await page.click(tid('image-retry'));
  await page.waitForFunction(() => (window.__nativeMsgs || []).filter(m => m.type === 'savePracticeCard').length === 2);
  await page.evaluate(() => window.shiziCardSaved({ success: true }));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]').dataset.save === 'saved');
  assert.equal(await page.locator(tid('toast')).count(), 0, 'I3 P0-07: success shows no toast');
  assert.equal((await page.textContent(tid('image-save'))).trim(), COPY.saved, 'the save button changes in place to 「已存好」');
  v = await preview(page);
  assert.equal(v.note, '', 'note back to normal after success');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(tid('image-share'));
  await page.waitForFunction(() => (window.__nativeMsgs || []).some(m => m.type === 'sharePracticeCard'));
  msgs = await nativeMessages(page, 'sharePracticeCard');
  assert.equal(msgs.length, 1, 'one sharePracticeCard message');
  assert.ok(msgs[0].dataURL.startsWith('data:image/jpeg;base64,') && msgs[0].name === 'shizi-session-s90-1x1.jpg', 'share payload (JPEG)');
  await closeOverlay(page);
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct').length);
  assert.equal(direct, 0, 'no write bypasses storage.js');
}
