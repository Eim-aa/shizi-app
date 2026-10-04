// 阶段 1 P1-E8「在纸上写，回来自判」（D46 ⑬ / D47；实现交接 §10；求助与判断 ⑤；03 P165–P169）。
//
//   1. 设置 › 写字方式：弹层二选（在屏幕上写 / 在纸上写 + 说明），选「在纸上写」写 settings.writeMode=paper，设置行显示「在纸上写」。
//   2. 纸上写一组：书写格换成同样大小的纸面格（格内「在纸上写」/ 说明 /「改回在屏幕上写」、格下「纸上」说明，不能落笔），
//      「写好了」不要求笔画；提示照常（画在纸面格里，格内文字收起）。
//   3. 判断页只有参考字形（书写格大小）+ 格下说明位「和你纸上的字对照」（D49：没有「参考字形 · 」旁注），读屏「你的书写：写在纸上」；判断后记录 source:'paper'、
//      不写墨迹、照常评级推进，之前留墨的那次墨迹不被回收（D27：纸上那次不占位）。
//   4. 写字页单字切换：纸上 →「改回在屏幕上写」只改这一个字（current.paper=false）；屏幕上还没落笔时格下右端「在纸上写」，落笔后换回撤销 / 清空；
//      下一字回到设置的写字方式。

import { bootTestHost, drawStroke, HORIZONTAL, PRESS_SETTLE_MS, makeSession, tid, topSel, waitNavIdle } from './helpers.mjs';

const SETTINGS_MOD = '/src/ui/screens/mine/settings.js';
const CHARS = ['永', '和', '春'];

async function facts(page) {
  return page.evaluate(() => {
    const st = window.__shiziTest.getState();
    const records = [];
    for (const v of Object.values(st.records || {})) for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    const ink = {};
    for (const table of Object.values(st.ink || {})) Object.assign(ink, table);
    return {
      records,
      inkIds: Object.keys(ink).sort(),
      settings: st.settings || {},
      session: st.sessions ? st.sessions.A || (st.sessions.lastEnded || {}).A || null : null,
      sched: st.sched || {},
    };
  });
}

async function waitWrite(page, { cursor, phase }) {
  await page.waitForFunction(({ c, p }) => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && Number(w.dataset.cursor) === c && w.dataset.phase === p;
  }, { c: cursor, p: phase });
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function present(page, id) {
  return (await page.locator(topSel(id)).count()) > 0;
}

async function text(page, id) {
  const el = page.locator(topSel(id));
  return (await el.count()) ? (await el.first().textContent()).trim() : null;
}

/** 造一条「永」的屏幕记录（3 天前，留墨）+ A 组（永 / 和 / 春）。 */
async function seedAll(page) {
  const session = makeSession({ id: 's9', slot: 'A', kind: 'daily', chars: CHARS, at: Date.now() });
  const res = await page.evaluate(async sess => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession } = await import('/src/core/sessions.js');
    window.__shiziTest.reset();
    const now = window.__shiziTest.now();
    const at = now - 3 * 86400000;
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = p => p + (n += 1);
    draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:永'], at });
    const stroke = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    judgeInDraft(draft, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes: stroke, at, nextId, perRecordInk: true });
    draft.sessions = { A: { ...sess, startedAt: now, updatedAt: now }, B: null, lastEnded: {} };
    const r = window.__shiziTest.seed(draft);
    return { ok: !!(r && r.ok), r };
  }, session);
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
}

async function openSettings(page) {
  const ok = await page.evaluate(async mod => (await import(mod)).openSettings(), SETTINGS_MOD);
  if (!ok) throw new Error('openSettings returned false');
  await page.waitForSelector(topSel('settings-screen'));
  await waitNavIdle(page);
}

async function goTab(page, name) {
  await page.evaluate(async n => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab(n);
  }, name);
  await page.waitForFunction(async n => {
    const { getRouter } = await import('/src/ui/router.js');
    const s = getRouter().getState();
    return s.depth === 0 && s.top && s.top.n === n;
  }, name);
  await waitNavIdle(page);
}

async function openWriteA(page) {
  await page.click(tid('write-test-entry'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
}

export default async function paperSpec(page, ctx) {
  const { assert } = ctx;

  ctx.step('seed: 「永」 has one inked screen record (3 days ago) + an A group 永 / 和 / 春');
  await bootTestHost(page, ctx.baseURL);
  await seedAll(page);
  let f = await facts(page);
  assert.equal(f.records.length, 1);
  const firstId = f.records[0].id;
  assert.deepEqual(f.inkIds, [firstId], 'the screen record left ink');

  // ------------------------------------------------------------------ 1. 设置
  ctx.step('P165: 设置 › 写字方式 — two radios with notes; pick 在纸上写 → settings.writeMode = paper');
  await openSettings(page);
  assert.equal(await text(page, 'settings-writemode-value'), '在屏幕上写', 'default: on screen');
  await page.click(topSel('settings-writemode'));
  await page.waitForSelector(topSel('settings-writemode-sheet'));
  await waitNavIdle(page);
  const sheet = await page.evaluate(() => {
    const s = document.querySelector('.sz-layer[data-top="true"] [data-testid="settings-writemode-sheet"]');
    const opts = [...s.querySelectorAll('[data-testid="settings-writemode-option"]')];
    return {
      values: opts.map(o => o.dataset.value),
      checked: opts.map(o => o.getAttribute('aria-checked')),
      texts: opts.map(o => o.textContent.trim()),
      note: s.querySelector('[data-testid="settings-writemode-note"]').textContent,
    };
  });
  assert.deepEqual(sheet.values, ['screen', 'paper']);
  assert.deepEqual(sheet.checked, ['true', 'false']);
  assert.deepEqual(sheet.texts, ['在屏幕上写用手指或 Apple Pencil 写在书写格里', '在纸上写题面、提示、看答案照常；写好后点「写好了」，自己对照']);
  assert.ok(/^选「在纸上写」时，判断照常记下、标注「纸上」，不留笔迹/.test(sheet.note), 'the note under the two options (§10.3)');
  await page.click(`${topSel('settings-writemode-option')}[data-value="paper"]`);
  await page.waitForSelector(topSel('settings-writemode-sheet'), { state: 'detached' });
  await waitNavIdle(page);
  assert.equal(await text(page, 'settings-writemode-value'), '在纸上写');
  f = await facts(page);
  assert.equal(f.settings.writeMode, 'paper', 'stored through store.commit');

  // ------------------------------------------------------------------ 2. 纸上写
  ctx.step('P167: write on paper — paper box the size of the grid, centered copy, note under it, no pen input; 写好了 enabled without strokes');
  await goTab(page, 'home');
  await openWriteA(page);
  await waitWrite(page, { cursor: 0, phase: 'recall' });
  const box = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    const r = el => (el ? el.getBoundingClientRect() : null);
    const done = q('write-done');
    return {
      grid: !!q('write-grid'),
      paper: r(q('write-paper')),
      paperGrid: q('write-paper-grid') ? q('write-paper-grid').dataset.drawable : null,
      title: q('write-paper-title').textContent,
      body: q('write-paper-body').textContent,
      back: q('write-paper-back').textContent.trim(),
      note: q('write-paper-note') ? q('write-paper-note').textContent : null,
      toPaper: !!q('write-to-paper'),
      done: { disabled: done.disabled, aria: done.getAttribute('aria-disabled') },
      hintBtn: !!q('write-hint'),
      answer: !!q('write-show-answer'),
      prompt: !!q('write-prompt'),
    };
  });
  assert.equal(box.grid, false, 'no drawable writing grid');
  assert.equal(box.paperGrid, 'false', 'the paper box takes no pen input');
  assert.ok(box.paper && box.paper.width > 250 && Math.abs(box.paper.width - box.paper.height) < 1, 'paper box is a square the size of the writing grid');
  assert.equal(box.title, '在纸上写');
  assert.equal(box.body, '写好了点「写好了」，再自己对照。');
  assert.equal(box.back, '改回在屏幕上写');
  assert.equal(box.note, '这个字记下时会标注「纸上」，不留笔迹。');
  assert.equal(box.toPaper, false);
  assert.ok(!box.done.disabled && box.done.aria !== 'true', '写好了 needs no strokes on paper');
  assert.ok(box.prompt && box.hintBtn && box.answer, 'prompt, hint and 看答案 as usual');

  ctx.step('P167: 提示 on paper → drawn inside the paper box; the copy folds away, 改回在屏幕上写 stays');
  await page.click(topSel('write-hint'));
  await page.waitForSelector(`${topSel('write-paper')}[data-hinted="true"]`);
  await page.waitForSelector(`${topSel('write-paper')} [data-testid="write-hint-layer"]`);
  assert.equal(await page.locator(topSel('write-paper-title')).isVisible(), false);
  assert.equal(await page.locator(topSel('write-paper-back')).isVisible(), true);

  // ------------------------------------------------------------------ 3. 判断页
  ctx.step('P167: 写好了 → judge page with only the reference glyph (grid size) + aside; screen reader hears 你的书写：写在纸上');
  await page.click(topSel('write-done'));
  await waitWrite(page, { cursor: 0, phase: 'compare' });
  const cmp = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    const ref = q('write-compare-ref');
    return {
      paper: q('write-compare').dataset.paper,
      mine: !!q('write-compare-mine'),
      refW: ref ? ref.getBoundingClientRect().width : 0,
      aside: q('write-compare-aside-ref').textContent,
      sr: q('write-compare-paper').textContent,
      srClass: q('write-compare-paper').className,
      stored: window.__shiziTest.getState().sessions.A.current,
    };
  });
  assert.equal(cmp.paper, 'true');
  assert.equal(cmp.mine, false, 'no learner card');
  assert.ok(Math.abs(cmp.refW - box.paper.width) < 1.5, `reference = writing-grid size (${cmp.refW} vs ${box.paper.width})`);
  assert.equal(cmp.aside, '和你纸上的字对照', 'D49: the slot under the reference reads 「和你纸上的字对照」, no 「参考字形 · 」 side note');
  assert.equal(cmp.sr, '你的书写：写在纸上');
  assert.equal(cmp.srClass, 'sr-only');
  assert.equal(cmp.stored.phase, 'compare');
  assert.equal(cmp.stored.paper, true, 'current.paper written with the compare phase');

  ctx.step('reload on the paper judge page → still the paper judge page (recover does not fall back to recall)');
  await page.reload();
  await page.waitForSelector(topSel('write-compare'));
  await waitNavIdle(page);
  assert.equal(await page.locator(`${topSel('write-compare')}[data-paper="true"]`).count(), 1);

  ctx.step('P166: 写对了 → judged record source:"paper", no ink, FSRS + advance as usual; the earlier ink of 永 is kept (D27)');
  await page.click(topSel('write-judge-correct'));
  await waitWrite(page, { cursor: 1, phase: 'recall' });
  f = await facts(page);
  const paperRec = f.records.find(r => r.char === '永' && r.id !== firstId);
  assert.ok(paperRec, 'a second record for 永');
  assert.equal(paperRec.kind, 'judged');
  assert.equal(paperRec.source, 'paper');
  assert.equal(paperRec.help.hints, 1, 'the hint is a help fact as usual');
  assert.ok(!('inkId' in paperRec));
  assert.deepEqual(f.inkIds, [firstId], 'no ink for the paper record; the earlier inked record is not recycled');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(f.sched['base:永'].due), 'FSRS scheduled the paper judgment');
  assert.ok(/「永」记为写对/.test(await text(page, 'write-line')), 'D19 result line as usual');

  ctx.step('P167: 修改 the paper judgment → the sheet shows 写在纸上 (screen reader: 你的书写：写在纸上) instead of an empty ink cell');
  await page.click(topSel('write-line-change'));
  await page.waitForSelector(tid('write-change-sheet'));
  await waitNavIdle(page);
  const sheetPaper = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="write-change-sheet"] [data-testid="write-change-paper"]');
    return el ? { text: el.textContent, label: el.getAttribute('aria-label'), noink: !!document.querySelector('[data-testid="write-change-noink"]') } : null;
  });
  assert.deepEqual(sheetPaper, { text: '写在纸上', label: '你的书写：写在纸上', noink: false });
  await page.click(tid('write-change-cancel'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-change-sheet"]'));
  await waitNavIdle(page);

  // ------------------------------------------------------------------ 4. 单字切换
  ctx.step('P165: next character follows the setting (paper); 改回在屏幕上写 switches only this character');
  assert.equal(await present(page, 'write-paper'), true, '和 starts on paper (setting)');
  await page.click(topSel('write-paper-back'));
  await page.waitForSelector(topSel('write-grid'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  f = await facts(page);
  assert.equal(f.session.current.paper, false, 'current.paper = false for this character only');
  assert.equal(f.settings.writeMode, 'paper', 'the setting is unchanged');
  assert.equal(await text(page, 'write-to-paper'), '在纸上写', 'empty grid: 在纸上写 at the right end of the row under the grid');

  ctx.step('pen down → 在纸上写 gives way to 撤销 / 清空');
  await drawStroke(page, HORIZONTAL);
  await page.waitForFunction(() => {
    const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
    return !!g && Number(g.dataset.strokeCount) === 1;
  });
  assert.equal(await present(page, 'write-to-paper'), false);
  assert.equal(await page.locator(topSel('write-tools')).getAttribute('data-shown'), 'true');

  ctx.step('judge 和 on screen → a normal record (no source) with ink');
  await page.click(topSel('write-done'));
  await waitWrite(page, { cursor: 1, phase: 'compare' });
  assert.equal(await present(page, 'write-compare-mine'), true, 'screen judge page has both cells');
  await page.click(topSel('write-judge-wrong'));
  await waitWrite(page, { cursor: 2, phase: 'recall' });
  f = await facts(page);
  const he = f.records.find(r => r.char === '和');
  assert.ok(he && !('source' in he), 'screen records carry no source (default screen)');
  assert.ok(f.inkIds.includes(he.id), 'screen record has ink');

  ctx.step('春 back on paper (setting); 改回 then 在纸上写 again — per-character toggle both ways');
  assert.equal(await present(page, 'write-paper'), true);
  await page.click(topSel('write-paper-back'));
  await page.waitForSelector(topSel('write-to-paper'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel('write-to-paper'));
  await page.waitForSelector(topSel('write-paper'));
  f = await facts(page);
  assert.equal(f.session.current.paper, true);

  // ------------------------------------------------------------------ 5. 标注：单字详情 / 字墙
  ctx.step('P169: 单字详情 of 永 — 记录了 2 次; one ink cell (the screen one); the paper record is a row 「{日期}　写对 · 纸上」');
  await page.evaluate(async () => {
    const { openDetail } = await import('/src/ui/screens/detail/index.js');
    openDetail('永');
  });
  await page.waitForFunction(() => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-screen"]');
    return !!el && el.dataset.char === '永';
  });
  await waitNavIdle(page);
  const det = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const rows = [...top.querySelectorAll('[data-testid="detail-paper-row"]')];
    const tag = top.querySelector('[data-testid="detail-paper-tag"]');
    const probe = document.createElement('span');
    probe.style.color = 'var(--ink3)';
    top.appendChild(probe);
    const ink3 = getComputedStyle(probe).color;
    probe.remove();
    return {
      count: top.querySelector('[data-testid="detail-records-count"]').textContent,
      cells: [...top.querySelectorAll('[data-testid="detail-cell"]')].map(c => ({ id: c.dataset.record, ink: c.dataset.ink, latest: c.dataset.latest || null })),
      rows: rows.map(r => ({ id: r.dataset.record, visible: [...r.querySelectorAll('[aria-hidden="true"]')].map(s => s.textContent).join('　'), label: r.querySelector('[data-testid="detail-paper-label"]').textContent })),
      tagColor: tag ? getComputedStyle(tag).color : null,
      ink3,
    };
  });
  assert.equal(det.count, '记录了 2 次');
  assert.deepEqual(det.cells, [{ id: firstId, ink: 'true', latest: 'true' }], 'the inked screen record is 你的笔迹 (latest inked); the paper one takes no cell');
  assert.equal(det.rows.length, 1);
  assert.equal(det.rows[0].id, paperRec.id);
  assert.ok(/^\d+月\d+日　写对· 纸上$/.test(det.rows[0].visible), `row text: ${det.rows[0].visible}`);
  assert.ok(/^\d+月\d+日，写对，纸上$/.test(det.rows[0].label), `screen-reader label: ${det.rows[0].label}`);
  assert.equal(det.tagColor, det.ink3, '「· 纸上」 is ink3');

  ctx.step('字墙 as usual — 永 is a normal cell (tone by date), no 「纸上」 mark');
  await goTab(page, 'library');
  await page.waitForSelector(`${topSel('library-wall-cell')}[data-char="永"]`);
  const wall = await page.evaluate(() => {
    const cell = document.querySelector('.sz-layer[data-top="true"] [data-testid="library-wall-cell"][data-char="永"]');
    const w = document.querySelector('.sz-layer[data-top="true"] [data-testid="library-wall"]');
    return { kind: cell.dataset.kind, tone: cell.dataset.tone, label: cell.getAttribute('aria-label'), wallText: w.textContent };
  });
  assert.equal(wall.kind, 'ink', 'paper correct → a normal (not wrong) cell');
  assert.equal(wall.tone, '0', 'newest tone: the paper judgment is today');
  assert.ok(!/纸上/.test(wall.label) && !/纸上/.test(wall.wallText), 'no paper mark on the wall');

  ctx.step('all writes through storage.js');
  let direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct'));
  assert.deepEqual(direct, []);

  // ------------------------------------------------------------------ 5. 读屏开启时的建议
  ctx.step('P168: no screen reader → no suggestion on the write page');
  await goTab(page, 'home');
  await seedAll(page);
  await openWriteA(page);
  await waitWrite(page, { cursor: 0, phase: 'recall' });
  assert.equal(await present(page, 'write-paper-suggest'), false);
  f = await facts(page);
  assert.ok(!('paperSuggested' in f.settings));

  ctx.step('P168: VoiceOver on (shiziAccessibilityStatus) → first visit to the write page shows the non-blocking suggestion, recorded once');
  await goTab(page, 'home');
  await page.evaluate(() => window.shiziAccessibilityStatus({ voiceOver: true, switchControl: false }));
  await openWriteA(page);
  await waitWrite(page, { cursor: 0, phase: 'recall' });
  assert.equal(await text(page, 'write-paper-suggest-text'), '读屏开启时，可以在纸上写好，回来自己对照。');
  assert.equal(await text(page, 'write-paper-suggest-no'), '不用');
  assert.equal(await text(page, 'write-paper-suggest-yes'), '改为在纸上写');
  assert.equal(await page.locator(topSel('write-paper-suggest')).getAttribute('role'), 'status', 'announced without taking focus');
  assert.equal(await present(page, 'write-grid'), true, 'still writing on screen (non-blocking)');
  f = await facts(page);
  assert.equal(f.settings.paperSuggested, true, 'shown → recorded in settings');

  ctx.step('不用 → folds away; next visit (still VoiceOver) → never again');
  await page.click(topSel('write-paper-suggest-no'));
  await page.waitForSelector(topSel('write-paper-suggest'), { state: 'detached' });
  await goTab(page, 'home');
  await openWriteA(page);
  await waitWrite(page, { cursor: 0, phase: 'recall' });
  assert.equal(await present(page, 'write-paper-suggest'), false, 'only once');

  ctx.step('改为在纸上写 (fresh settings) → settings.writeMode = paper, the paper box appears at once');
  await goTab(page, 'home');
  await seedAll(page);
  await openWriteA(page);
  await waitWrite(page, { cursor: 0, phase: 'recall' });
  await page.click(topSel('write-paper-suggest-yes'));
  await page.waitForSelector(topSel('write-paper'));
  assert.equal(await present(page, 'write-paper-suggest'), false);
  f = await facts(page);
  assert.equal(f.settings.writeMode, 'paper');
  assert.equal(f.settings.paperSuggested, true);
  await page.evaluate(() => window.shiziAccessibilityStatus({ voiceOver: false, switchControl: false }));

  direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct'));
  assert.deepEqual(direct, []);
}
