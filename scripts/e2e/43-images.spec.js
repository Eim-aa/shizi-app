// 图片（02 M4-5；01 §10；04 R-I01–R-I04、R-R07、R-P03、R-D04、R-B10、A05；03 P02 / P25 / P50；T06-C）。
//
//   1. 结果页「这次的图片」（setResultImageAction 已注册）→ 预览弹层：标题、3:4 画布 1080×1440 与 dataset（成员 = 本组有笔迹的字、
//      recordId = 本组每字最后一次判断、落款「二〇二六年九月二十四日 · 两个字」）、缺墨说明（P50）；切 1:1 → 1080×1080；
//      toDataURL 是 PNG 且 IHDR 尺寸一致。
//   2. 浏览器：「分享」走 navigator.share({files})（stub）；「保存图片」= 下载 PNG（文件名、PNG 头、尺寸）。
//   3. 单字详情「把这个字做成图片」：有笔迹 → 手写字图片（A05：1080×1440、拼音 · 日期、落款「拾字」）；最近一次没有笔迹 → 置灰 + R-D04。
//   4. {月}字帖（我的「保存图片 ›」注册的去处 openMonthImage）：P02 本月第一次、角标、有记录天数、缺墨去掉并说明；
//      > 80 字 → pending（P25）：不生成画布、说明 R-I01.overLimit、两键真禁用。
//   5. 原生壳（假 webkit.messageHandlers）：「保存图片」发 savePracticeCard（PNG dataURL）→ shiziCardSaved({success:false})
//      → R-B10 失败说明 +「再试一次」→ 成功 → 轻提示「已保存到相册。」；「分享」发 sharePracticeCard。
//   6. 全程不写存储（getWriteLog 无新增）。

import fs from 'node:fs';
import { bootTestHost, installNativeStub, nativeMessages, PRESS_SETTLE_MS, tid, topSel, waitNavIdle } from './helpers.mjs';

const CLOCK = '2026-09-24T20:00:00';
const COPY = {
  kindSession: '这次的图片',
  kindGlyph: '手写字图片',
  kindMonth: '9 月字帖',
  imageNote: '存下来的是图片，不能用来恢复记录。',
  glyphNote: '用的是你最近一次写的这个字。存下来的是图片，不能用来恢复记录。',
  missingSession: '「和」这一次没有留下笔迹，不在图里。',
  missingMonth: '「水」「和」最近一次没有留下笔迹，不在图里。',
  sessionSign: '二〇二六年九月二十四日 · 两个字',
  monthSign: '二〇二六年九月 · 有记录四天 · 三个字',
  share: '分享',
  save: '保存图片',
  retry: '再试一次',
  denied: '没能存进相册。请到手机设置里允许拾字添加照片。',
  saved: '已保存到相册。',
  noInk: '这一次的笔迹没有存下来。在结果页可以把刚写完的字做成图片。', // R-D04.noInkNoteGlyph（perRecordInk 关闭，A5）
  overLimit: '一张图最多放 80 个字，现在的字超过了，暂时做不成图片。记录都还在，没有受影响。',
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
    let png = null;
    if (c) {
      const url = c.toDataURL('image/png');
      const bin = atob(url.slice(url.indexOf(',') + 1, url.indexOf(',') + 1 + 44));
      const u32 = o => ((bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16) | (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)) >>> 0;
      png = { sig: bin.slice(1, 4), w: u32(16), h: u32(20), bytes: url.length };
    }
    const board = root.querySelector('[data-testid="image-board"]').getBoundingClientRect();
    return {
      kind: root.dataset.kind,
      state: root.dataset.state,
      ratio: root.dataset.ratio,
      saveState: root.dataset.save,
      title: sheet && sheet.querySelector('.sz-sheet__title') ? sheet.querySelector('.sz-sheet__title').textContent.trim() : null,
      dialog: sheet ? { role: sheet.getAttribute('role'), modal: sheet.getAttribute('aria-modal'), label: !!sheet.getAttribute('aria-labelledby') } : null,
      note: root.querySelector('[data-testid="image-note"]').textContent.trim(),
      boardNote: root.querySelector('[data-testid="image-board-note"]') ? root.querySelector('[data-testid="image-board-note"]').textContent.trim() : null,
      board: { w: Math.round(board.width), h: Math.round(board.height) },
      canvas: c ? { ...c.dataset, width: c.width, height: c.height } : null,
      png,
      ratios: [...root.querySelectorAll('[data-testid="image-ratio"]')].map(b => ({ r: b.dataset.ratio, pressed: b.getAttribute('aria-pressed'), text: b.textContent.trim() })),
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

  // ------------------------------------------------------------------ 1. 结果页「这次的图片」
  ctx.step('result page 「这次的图片」 → session image (3:4 / 1:1, members, record ids, signature, P50 note)');
  await openResult(page);
  let w0 = await writeCount(page);
  const entry = await page.$(topSel('result-image'));
  assert.ok(!!entry, 'result page shows the 「这次的图片」 entry once M4-5 registers it');
  assert.equal((await entry.textContent()).trim(), COPY.kindSession, 'entry label R-R07.title');
  await entry.click();
  await waitPreview(page);
  let v = await preview(page);
  assert.equal(v.kind, 'session', 'preview kind');
  assert.equal(v.title, COPY.kindSession, 'title R-I01.kindSession');
  assert.deepEqual(v.dialog, { role: 'dialog', modal: 'true', label: true }, 'sheet is a labelled modal dialog');
  assert.equal(v.ratio, 'portrait', 'defaults to 3:4');
  assert.deepEqual(v.ratios, [{ r: 'portrait', pressed: 'true', text: '3:4' }, { r: 'square', pressed: 'false', text: '1:1' }], 'ratio buttons');
  assert.deepEqual([v.canvas.width, v.canvas.height], [1080, 1440], '3:4 canvas 1080×1440');
  assert.deepEqual({ sig: v.png.sig, w: v.png.w, h: v.png.h }, { sig: 'PNG', w: 1080, h: 1440 }, 'PNG header 1080×1440');
  assert.equal(v.canvas.members, '永静', 'members = session chars with ink, session order (和 has no ink → omitted, P50)');
  assert.equal(v.canvas.missing, '和', 'missing-ink char recorded');
  assert.equal(v.canvas.recordIds, [idOf(flat, '永', 's90'), idOf(flat, '静', 's90')].join(','), 'each cell ink = this session\'s record (D11), not the 9-02 永');
  assert.equal(v.canvas.signature, COPY.sessionSign, 'signature 汉字数字 date · count follows drawn chars (R-P03 / R-I04)');
  assert.equal(v.canvas.n, '2', 'n = drawn');
  assert.equal(v.canvas.tags, '|', 'session image has no date tags');
  assert.equal(v.canvas.top, '72', 'T06-C: 3:4 grid starts at the top of the inner area');
  assert.equal(v.note, COPY.missingSession + COPY.imageNote, 'note = missing-ink sentence + R-I01.imageNote');
  assert.deepEqual(v.board, { w: 228, h: 304 }, 'preview board 228×304 (prototype)');
  assert.deepEqual([v.share.text, v.save.text, v.share.disabled, v.save.disabled], [COPY.share, COPY.save, false, false], 'two buttons enabled');

  await page.click(`${tid('image-ratio')}[data-ratio="square"]`);
  await waitPreview(page);
  v = await preview(page);
  assert.equal(v.ratio, 'square', '1:1 selected');
  assert.deepEqual([v.canvas.width, v.canvas.height, v.png.w, v.png.h], [1080, 1080, 1080, 1080], '1:1 canvas and PNG 1080×1080');
  assert.equal(v.canvas.members, '永静', 'same members in 1:1');
  assert.deepEqual(v.board, { w: 250, h: 250 }, 'preview board 250×250');
  assert.ok(Number(v.canvas.top) > 72, '1:1 grid is vertically centered (T06-C: 1:1 unchanged)');

  // ------------------------------------------------------------------ 2. 浏览器分享 / 保存
  ctx.step('browser: 分享 → navigator.share({files}); 保存图片 → PNG download');
  await page.evaluate(() => {
    window.__shared = [];
    navigator.canShare = d => !!(d && d.files && d.files.length);
    navigator.share = async d => { window.__shared.push(d.files.map(f => ({ name: f.name, type: f.type, size: f.size }))); };
  });
  await page.click(tid('image-share'));
  await page.waitForFunction(() => window.__shared.length === 1);
  const shared = await page.evaluate(() => window.__shared[0]);
  assert.equal(shared.length, 1, 'one file shared');
  assert.equal(shared[0].type, 'image/png', 'shared file is a PNG');
  assert.equal(shared[0].name, 'shizi-session-s90-1x1.png', 'shared file name');
  assert.ok(shared[0].size > 1000, 'shared file has content');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(tid('image-save'))]);
  assert.equal(dl.suggestedFilename(), 'shizi-session-s90-1x1.png', 'download file name');
  const buf = fs.readFileSync(await dl.path());
  assert.equal(buf.slice(1, 4).toString('latin1'), 'PNG', 'downloaded file is a PNG');
  assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [1080, 1080], 'downloaded PNG is 1080×1080');
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]').dataset.save === 'saved');
  v = await preview(page);
  assert.equal(v.note, COPY.missingSession + COPY.imageNote, 'browser download: no album wording, note unchanged');
  assert.equal(await page.$(tid('toast')), null, 'no 「已保存到相册。」 toast for a browser download');
  await closeOverlay(page);
  assert.equal(await page.evaluate(() => document.querySelector('.sz-app').dataset.topScreen), 'result', 'closing returns to the result page');
  writes.push((await writeCount(page)) - w0);

  // ------------------------------------------------------------------ 3. 单字详情 → 手写字图片
  ctx.step('detail 「把这个字做成图片」: ink → 手写字图片 (A05); latest without ink → greyed + R-D04');
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
  assert.deepEqual([v.canvas.width, v.canvas.height, v.png.w, v.png.h], [1080, 1440, 1080, 1440], 'A05 3:4 1080×1440');
  assert.equal(v.canvas.caption, `${py} · 9 月 24 日`, 'caption 「拼音 · 日期」 (R-I02)');
  assert.equal(v.canvas.signature, COPY.brand, 'bottom-right 「拾字」');
  assert.equal(v.canvas.recordIds, idOf(flat, '静'), 'ink = latest judged record of 静');
  assert.ok(Number(v.canvas.glyphWidth) <= 648, 'ink box ≤ 60% of the width');
  assert.equal(v.note, COPY.glyphNote, 'note R-I01.glyphNote');
  await page.click(`${tid('image-ratio')}[data-ratio="square"]`);
  await waitPreview(page);
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
  assert.ok(row.text.includes(COPY.noInk), 'R-D04.noInkNoteGlyph');
  assert.ok(!row.text.includes('再写一次就能做图片'), 'A5: no promise that writing again makes the image');
  const noInkPlan = await page.evaluate(async () => {
    const { buildImageJob } = await import('/src/ui/images-entry.js');
    const job = buildImageJob({ kind: 'glyph', char: '和' });
    return { status: job.plan.status, emptyNote: job.emptyNote };
  });
  assert.deepEqual(noInkPlan, { status: 'noInk', emptyNote: COPY.noInk }, 'glyph image for a no-ink latest is not generated');

  // ------------------------------------------------------------------ 4. 月字帖
  ctx.step('{月}字帖 (openMonthImage, mine 「保存图片 ›」): P02 first of month, tags, days, missing, signature');
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
  assert.equal(v.title, COPY.kindMonth, 'title 「9 月字帖」');
  assert.equal(v.canvas.members, '永山静', 'first-appearance order, missing-ink 水 / 和 omitted');
  assert.equal(v.canvas.recordIds, [idOf(flat.filter(r => r.localDay === '2026-09-02'), '永'), idOf(flat, '山'), idOf(flat, '静')].join(','),
    '永 uses its FIRST September record (9-02, P02 first), not the 9-24 one');
  assert.equal(v.canvas.tags, '9·2|9·4|9·24', 'date tags per cell day');
  assert.equal(v.canvas.days, '4', 'days with judged records (9-02, 9-04, 9-10, 9-24)');
  assert.equal(v.canvas.signature, COPY.monthSign, 'month signature, char count follows drawn chars');
  assert.equal(v.canvas.pick, 'first', 'policy.monthSheetPick');
  assert.equal(v.note, COPY.missingMonth + COPY.imageNote, 'missing-ink sentence (month) + imageNote');
  await closeOverlay(page);

  ctx.step('day image (「这次的图片 · 保存图片 ›」 on 练习记录): that day\'s chars, latest each');
  await page.evaluate(async () => {
    const m = await import('/src/ui/screens/mine/records.js');
    m.getMineImageActions().today({ day: '2026-09-24' });
  });
  await waitPreview(page);
  v = await preview(page);
  assert.equal(v.kind, 'day', 'day preview');
  assert.equal(v.canvas.members, '永静', 'that day\'s chars with ink');
  assert.equal(v.canvas.signature, COPY.sessionSign, 'day signature');
  await closeOverlay(page);

  writes.push((await writeCount(page)) - w0);
  assert.deepEqual(writes, [0, 0, 0], 'opening / rendering / sharing / saving images writes nothing to storage (result, detail, mine)');

  ctx.step('> 80 chars → pending (P25): no canvas, R-I01.overLimit, buttons truly disabled');
  flat = await seed(page, { extra81: true });
  await page.evaluate(async () => {
    const { openMonthImage } = await import('/src/ui/images-entry.js');
    openMonthImage({ month: '2026-09' });
  });
  await waitPreview(page, 'pending');
  v = await preview(page);
  assert.equal(v.canvas, null, 'no canvas for pending');
  assert.equal(v.boardNote, COPY.overLimit, 'board note R-I01.overLimit (待文案)');
  assert.equal(v.note, COPY.overLimit, 'note R-I01.overLimit');
  assert.deepEqual([v.share.disabled, v.share.aria, v.save.disabled, v.save.aria], [true, 'true', true, 'true'], 'share / save disabled + aria-disabled');
  const planN = await page.evaluate(async () => (await import('/src/ui/images-entry.js')).buildImageJob({ kind: 'month', month: '2026-09' }).plan.n);
  assert.equal(planN, 84, 'nothing truncated (84 drawn: 81 + 永 山 静)');
  await closeOverlay(page);

  // ------------------------------------------------------------------ 5. 原生壳
  ctx.step('native shell: savePracticeCard → shiziCardSaved false → R-B10 + 再试一次 → true → toast; sharePracticeCard');
  await installNativeStub(page);
  await bootTestHost(page, ctx.baseURL);
  flat = await seed(page);
  await openResult(page);
  await page.click(topSel('result-image'));
  await waitPreview(page);
  await page.click(tid('image-save'));
  await page.waitForFunction(() => (window.__nativeMsgs || []).some(m => m.type === 'savePracticeCard'));
  let msgs = await nativeMessages(page, 'savePracticeCard');
  assert.equal(msgs.length, 1, 'one savePracticeCard message');
  assert.ok(msgs[0].dataURL.startsWith('data:image/png;base64,'), 'dataURL is a PNG');
  assert.deepEqual([msgs[0].kind, msgs[0].name], ['session', 'shizi-session-s90-3x4.png'], 'kind and file name');
  v = await preview(page);
  assert.equal(v.saveState, 'busy', 'waiting for the native callback');
  await page.evaluate(() => window.shiziCardSaved({ success: false }));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]').dataset.save === 'failed');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  v = await preview(page);
  assert.equal(v.note, COPY.denied, 'failure note R-B10.albumDenied');
  assert.equal(v.save, null, '保存图片 replaced');
  assert.deepEqual([v.share.text, v.retry.text, v.retry.disabled], [COPY.share, COPY.retry, false], '分享 / 再试一次');
  await page.click(tid('image-retry'));
  await page.waitForFunction(() => (window.__nativeMsgs || []).filter(m => m.type === 'savePracticeCard').length === 2);
  await page.evaluate(() => window.shiziCardSaved({ success: true }));
  await page.waitForFunction(() => document.querySelector('[data-testid="image-preview"]').dataset.save === 'saved');
  await page.waitForSelector(tid('toast'));
  assert.equal((await page.textContent(tid('toast'))).trim(), COPY.saved, 'toast 「已保存到相册。」 (R-B10)');
  v = await preview(page);
  assert.equal(v.note, COPY.missingSession + COPY.imageNote, 'note back to normal after success');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(tid('image-share'));
  await page.waitForFunction(() => (window.__nativeMsgs || []).some(m => m.type === 'sharePracticeCard'));
  msgs = await nativeMessages(page, 'sharePracticeCard');
  assert.equal(msgs.length, 1, 'one sharePracticeCard message');
  assert.ok(msgs[0].dataURL.startsWith('data:image/png;base64,') && msgs[0].name === 'shizi-session-s90-3x4.png', 'share payload');
  await closeOverlay(page);
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct').length);
  assert.equal(direct, 0, 'no write bypasses storage.js');
}
