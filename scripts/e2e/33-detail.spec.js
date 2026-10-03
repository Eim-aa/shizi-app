// 单字详情（02 M3-6；04 R-D01–R-D10；决定-D21 / D23 / D24；03 P10b / P12；01 §3.5 / §4）。
//
//   1. 无记录：「还没有记录」+ 说明、不画空格子；字卡（拼音 / 画数 / 词语词块、目标字位红框）、字源行；没有下次练习 / 清单行；
//      做图片入口没注册时不显示，注册后无记录置灰 + 说明（R-D04）；打开详情不写任何东西。
//   2. 有记录：「记录了 N 次 / 首次记录」、历次格子按记录先后（没有空的「下一次」格）、有笔迹 / 没有笔迹（R-D07）、点格子放大；
//      下次练习按 sched.due（P12）；最近一次没有笔迹时做图片置灰 + 说明。
//   3. 写错过（红点，点进清单）→ 修改判断后实时离开；快忘了（到期）；没有字源的字整块不显示（R-D09）。
//   4. 自选未写：从自选移除（确认 → 底栏撤销 → 已撤销，放回原位与原时间）；撤销寿命：返回离开 / 推入写字页即失效；
//      移除失败留在确认框三段式、撤销失败底栏换说明且可再点（failNextWrite）。
//   5. 有旧照片：不算有记录（P10b）；「旧版本的记录」→「「字」的旧记录」只读页（照片、说明、没有做图片）。
//   6. 换掉这个词语：横幅 + 撤销；失败三段式 / 撤销失败；生效后写字页题面改只按拼音写（deck.js withWordOff + prompt.js
//      promptCells 同一口径断言）；从本页开 B → 写完 → 结果页「回到「静」」→ 回到本页（横幅已失效）。
//   7. B 没写完时打开详情不弹 S02、sessions.B 不变；点「练这个字」才弹 S02，取消后 B 深相等；开组写入失败三段式。

import { bootTestHost, drawStroke, HORIZONTAL, PRESS_SETTLE_MS, tid, topSel, waitNavIdle } from './helpers.mjs';

const DAY = 86400000;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * 造数（真实 mutator judgeInDraft，一条记录一个会话）并 seed。
 * spec: {steps:[{char, judgment, daysAgo, ink}], custom:[char], photos:[char], wordOff:[char], dueBack:{char: daysAgo},
 *        B:{chars:[…]}}
 */
async function seed(page, spec) {
  const res = await page.evaluate(async s => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession } = await import('/src/core/sessions.js');
    const { localDay, addDays } = await import('/src/core/dates.js');
    window.__shiziTest.reset();
    const now = window.__shiziTest.now();
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = p => p + (n += 1);
    const stroke = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    (s.steps || []).forEach((st, i) => {
      const at = now - st.daysAgo * 86400000 + i;
      draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + st.char], at });
      judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + st.char, judgment: st.judgment, strokes: stroke, at, nextId, perRecordInk: !!st.ink });
      draft.sessions.A = null;
    });
    for (const [char, back] of Object.entries(s.dueBack || {})) {
      const key = 'base:' + char;
      draft.sched[key] = { ...draft.sched[key], due: addDays(localDay(now), -back) };
    }
    if (s.custom) draft.custom = { added: s.custom.map((c, i) => ({ char: c, at: now - (10 - i) * 1000 })) };
    if (s.photos) {
      draft.photos = {};
      for (const c of s.photos) draft.photos[c] = { day: '2025-05-01', at: now - 400 * 86400000, dataURL: s.png };
    }
    if (s.wordOff) draft.wordOff = Object.fromEntries(s.wordOff.map(c => ['base:' + c, now - 1000]));
    if (s.B) {
      draft.sessions.B = createSession({ id: nextId('s'), kind: 'picked', source: { view: 'home' }, queue: s.B.chars.map(c => 'base:' + c), at: now });
    }
    const r = window.__shiziTest.seed(draft);
    return { ok: !!(r && r.ok), r };
  }, { ...spec, png: PNG });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
}

async function state(page) {
  return page.evaluate(() => {
    const st = window.__shiziTest.getState();
    const records = [];
    for (const v of Object.values(st.records || {})) for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    return { ...st, flat: records };
  });
}

async function goHome(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('home');
  });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
}

async function openDetailPage(page, char) {
  await page.evaluate(async c => {
    const { openDetail } = await import('/src/ui/screens/detail/index.js');
    openDetail(c);
  }, char);
  await page.waitForFunction(c => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-screen"]');
    return !!el && el.dataset.char === c;
  }, char);
  await waitNavIdle(page);
}

async function waitTop(page, screen) {
  await page.waitForFunction(s => document.querySelector('.sz-app').dataset.topScreen === s, screen);
  await waitNavIdle(page);
}

async function back(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
}

async function view(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => (top ? top.querySelector(`[data-testid="${id}"]`) : null);
    const qa = id => (top ? [...top.querySelectorAll(`[data-testid="${id}"]`)] : []);
    const txt = id => (q(id) ? q(id).textContent.replace(/\s+/g, ' ').trim() : null);
    const screen = q('detail-screen');
    const list = q('detail-list-row');
    const image = q('detail-image');
    const banner = q('detail-word-banner');
    const undo = q('detail-undo');
    const practice = q('detail-practice');
    return {
      char: screen ? screen.dataset.char : null,
      dataCount: screen ? screen.dataset.count : null,
      pinyin: txt('detail-pinyin'),
      strokes: txt('detail-strokes'),
      wordLabel: txt('detail-word-label'),
      word: q('detail-word') ? q('detail-word').dataset.word : null,
      tiles: qa('detail-word-tile').map(el => ({ ch: el.textContent, blank: el.dataset.blank === 'true' })),
      gloss: txt('detail-gloss'),
      count: txt('detail-records-count'),
      first: txt('detail-records-first'),
      empty: txt('detail-records-empty'),
      cells: qa('detail-cell').map(el => ({
        record: el.dataset.record, judgment: el.dataset.judgment, ink: el.dataset.ink,
        caption: el.querySelector('[data-testid="detail-cell-caption"]').textContent, aria: el.getAttribute('aria-label'),
        noink: !!el.querySelector('[data-testid="detail-cell-noink"]'), tag: el.tagName,
      })),
      source: txt('detail-source-text'),
      sourceFrom: txt('detail-source-from'),
      list: list ? { kind: list.dataset.list, dot: !!list.querySelector('[data-testid="detail-list-dot"]'), text: list.textContent.replace(/\s+/g, ' ').trim(), tag: list.tagName } : null,
      next: txt('detail-next'),
      image: image ? { state: image.dataset.state, text: image.textContent.replace(/\s+/g, ' ').trim(), tag: image.tagName } : null,
      legacy: txt('detail-legacy'),
      swap: txt('detail-swap'),
      swapFail: !!q('detail-swap-fail'),
      remove: txt('detail-remove'),
      banner: banner ? { state: banner.dataset.state, text: txt('detail-word-banner-text'), undo: !!q('detail-word-undo') } : null,
      undo: undo ? { state: undo.dataset.state, text: undo.textContent.replace(/\s+/g, ' ').trim(), button: !!undo.querySelector('[data-testid="undo-button"]') } : null,
      practice: practice ? { disabled: practice.disabled, text: practice.textContent.trim() } : null,
      practiceFail: !!q('detail-practice-fail'),
      rowTestids: q('detail-rows') ? [...q('detail-rows').children].map(el => el.dataset.testid) : [],
    };
  });
}

async function copy(page, key, vars) {
  return page.evaluate(async ([k, v]) => {
    const { t } = await import('/src/config/copy/index.js');
    const out = t(k, v || undefined);
    return Array.isArray(out) ? out : String(out);
  }, [key, vars || null]);
}

async function dateText(page, day) {
  return page.evaluate(async d => {
    const { t } = await import('/src/config/copy/index.js');
    const { monthDayParts } = await import('/src/core/dates.js');
    return t('R-H02.dateFormat', monthDayParts(d));
  }, day);
}

async function setImageHook(page, on) {
  await page.evaluate(async flag => {
    const { setDetailImageAction } = await import('/src/ui/screens/detail/index.js');
    window.__imageCalls = [];
    setDetailImageAction(flag ? arg => window.__imageCalls.push({ char: arg.char, record: arg.record && arg.record.id }) : null);
  }, on);
}

async function nudge(page) {
  // 入口桩注册不触发重渲染：随便一次无关写入让页面按新状态重画。
  await page.evaluate(async () => {
    const { getStore } = await import('/src/store/store.js');
    getStore().commit('test:nudge', draft => { draft.funnel = { ...(draft.funnel || {}), n: Date.now() }; });
  });
  await page.waitForTimeout(60);
}

async function waitView(page, pred, arg) {
  await page.waitForFunction(pred, arg);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function clickTop(page, id) {
  await page.click(topSel(id));
}

export default async function detailSpec(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // ------------------------------------------------------------------ 1. 无记录
  step('no records: 「还没有记录」 without empty cells; char card, source row; no next / list rows; opening writes nothing');
  await seed(page, {});
  // M4-5（src/ui/images-entry.js）启动时已注册真去处；先卸掉，断言「没注册时这一行不显示」。
  await setImageHook(page, false);
  const log0 = (await page.evaluate(() => window.__shiziTest.getWriteLog())).length;
  await openDetailPage(page, '永');
  let v = await view(page);
  assert.equal(v.count, await copy(page, 'R-D03.none'), 'R-D03 「还没有记录」');
  assert.equal(v.empty, await copy(page, 'X-DETAIL.emptyNote'), 'empty note');
  assert.equal(v.cells.length, 0, 'no empty placeholder cells (R-D03)');
  assert.equal(v.pinyin, 'yǒng', 'pinyin');
  assert.equal(v.strokes, '5 画', 'stroke count');
  assert.equal(v.wordLabel, '词语', 'word label 词语');
  assert.deepEqual(v.tiles, [{ ch: '永', blank: true }, { ch: '远', blank: false }], 'word tiles 永远, target slot framed');
  assert.equal(v.source, '长也', 'source row gloss (etymology.json)');
  assert.equal(v.sourceFrom, '《说文解字》', 'source row origin');
  assert.equal(v.next, null, 'no next-review row without judged records (P12)');
  assert.equal(v.list, null, 'no wrong / forget row');
  assert.equal(v.image, null, 'image entry hidden until M4-5 registers it');
  assert.equal(v.remove, null, 'not custom → no remove row');
  assert.equal(v.swap, `${await copy(page, 'R-D05.swapWord')}›`, 'swap-word row shown for a context word');
  assert.deepEqual(v.practice, { disabled: false, text: '练这个字' }, 'practice button');
  const log1 = (await page.evaluate(() => window.__shiziTest.getWriteLog())).length;
  assert.equal(log1, log0, 'opening the detail page wrote nothing');
  await setImageHook(page, true);
  await nudge(page);
  v = await view(page);
  assert.equal(v.image && v.image.state, 'noRecord', 'image entry registered → greyed (no record)');
  assert.ok(v.image && v.image.text.includes(await copy(page, 'R-D04.noRecordNote')), 'R-D04 no-record note');
  assert.equal(v.image && v.image.tag, 'DIV', 'greyed entry is not a button');

  // ------------------------------------------------------------------ 2. 有记录
  step('with records: count / first date / cells in order (no 「下一次」 cell), ink vs no ink, zoom; next review from sched.due');
  await back(page);
  await waitTop(page, 'home');
  await seed(page, { steps: [
    { char: '和', judgment: 'correct', daysAgo: 20, ink: true },
    { char: '和', judgment: 'wrong', daysAgo: 9 },
    { char: '和', judgment: 'correct', daysAgo: 2 },
  ] });
  await openDetailPage(page, '和');
  v = await view(page);
  let st = await state(page);
  const heRecs = st.flat.filter(r => r.char === '和').sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  assert.equal(v.count, '记录了 3 次', 'R-D03 「记录了 3 次」');
  assert.equal(v.first, `首次记录 ${await dateText(page, heRecs[0].localDay)}`, 'first record date');
  assert.deepEqual(v.cells.map(c => c.record), heRecs.map(r => r.id), 'one cell per judged record, oldest first, nothing else');
  assert.deepEqual(v.cells.map(c => c.judgment), ['correct', 'wrong', 'correct'], 'cell judgments');
  assert.deepEqual(v.cells.map(c => c.ink), ['true', 'false', 'false'], 'first cell has stored ink, others none');
  assert.deepEqual(v.cells.map(c => c.noink), [false, true, true], 'no-ink cells: glyph + 「没有笔迹」 (R-D07)');
  const [m0, d0] = heRecs[1].localDay.split('-').slice(1).map(Number);
  assert.equal(v.cells[1].caption, `${m0}·${d0} 写错`, 'caption 「M·D 写错」');
  assert.ok(v.cells.every(c => c.tag === 'BUTTON' && c.aria), 'cells are buttons with accessible names');
  assert.equal(v.next, `下次练习 · 大约 ${await dateText(page, st.sched['base:和'].due)} 再练到`, 'R-D02 next review = sched.due');
  assert.equal(v.list, null, 'latest correct, not due → no list row');
  assert.equal(v.image && v.image.state, 'noInk', 'latest record has no ink → image entry greyed');
  assert.ok(v.image.text.includes(await copy(page, 'R-D04.noInkNoteGlyph')), 'R-D04 no-ink note (perRecordInk off → Glyph variant)');
  assert.ok(!v.image.text.includes('再写一次就能做图片'), 'A5: no promise that writing again makes the image');
  await page.click(`${topSel('detail-cell')}[data-record="${heRecs[0].id}"]`);
  await page.waitForSelector(tid('detail-zoom'));
  await waitNavIdle(page);
  assert.ok(await page.$(tid('detail-zoom-ink')), 'zoom shows the stored ink');
  assert.equal((await page.textContent(`${tid('detail-zoom')} .sz-sheet__title`)).trim(), v.cells[0].aria, 'zoom title = cell name');
  await page.click(tid('detail-zoom-close'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="detail-zoom"]'));
  await waitNavIdle(page);
  await page.click(`${topSel('detail-cell')}[data-record="${heRecs[2].id}"]`);
  await page.waitForSelector(tid('detail-zoom-noink'));
  assert.equal((await page.textContent(tid('detail-zoom-noink'))).trim(), await copy(page, 'R-D07.noInkLarge'), 'zoom: 「这一次没有留下笔迹」');
  await waitNavIdle(page);
  await page.click(tid('detail-zoom-close'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="detail-zoom"]'));
  await waitNavIdle(page);
  await setImageHook(page, false);

  // ------------------------------------------------------------------ 3. 写错过 / 快忘了 / 没有字源
  step('wrong list row (red dot, opens the list), leaves in real time after a correction; forget row; no-source chars hide the block');
  await back(page);
  await waitTop(page, 'home');
  await seed(page, { steps: [
    { char: '水', judgment: 'correct', daysAgo: 8 },
    { char: '水', judgment: 'wrong', daysAgo: 1 },
    { char: '大', judgment: 'correct', daysAgo: 30 },
    { char: '欤', judgment: 'correct', daysAgo: 3 },
  ], dueBack: { 大: 3 } });
  await openDetailPage(page, '水');
  v = await view(page);
  assert.equal(v.list && v.list.kind, 'wrong', 'wrong list row');
  assert.equal(v.list.dot, true, 'wrong row has the red dot');
  assert.ok(v.list.text.includes('写错过') && v.list.text.includes(await copy(page, 'R-D01.wrongLine')), 'R-D01 「上次你判断写错了」');
  assert.equal(v.rowTestids[0], 'detail-list-row', 'status row sits above the practice schedule');
  const hasList = await page.evaluate(async () => !!(await import('/src/ui/router.js')).getScreen('library-list'));
  if (hasList) {
    assert.equal(v.list.tag, 'BUTTON', 'row is a button when the list screen exists');
    await clickTop(page, 'detail-list-row');
    await waitTop(page, 'library-list');
    const p = await page.evaluate(() => history.state.params);
    assert.deepEqual(p && p.kind, 'wrong', 'opened the wrong list');
    await back(page);
    await waitTop(page, 'detail');
  } else {
    assert.equal(v.list.tag, 'DIV', 'no list screen registered → row is not a dead button');
  }
  st = await state(page);
  const lastWrong = st.flat.filter(r => r.char === '水' && r.judgment === 'wrong')[0];
  await page.evaluate(async id => {
    const { getStore } = await import('/src/store/store.js');
    const { correctRecord } = await import('/src/core/records.js');
    const { localDay, addDays } = await import('/src/core/dates.js');
    getStore().commit('test:correct', (draft, c) => {
      for (const m of Object.keys(draft.records)) {
        const arr = draft.records[m];
        if (Array.isArray(arr) && arr.some(r => r.id === id)) draft.records[m] = arr.map(r => (r.id === id ? correctRecord(r, 'correct', c.now) : r));
      }
      draft.sched = { ...draft.sched, 'base:水': { ...draft.sched['base:水'], due: addDays(localDay(c.now), 5) } };
    });
  }, lastWrong.id);
  await waitView(page, () => !document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-list-row"]'));
  v = await view(page);
  assert.equal(v.list, null, 'R-D01: corrected to 写对 → the wrong row disappears in real time');
  await back(page);
  await waitTop(page, 'home');
  await openDetailPage(page, '大');
  v = await view(page);
  assert.equal(v.list && v.list.kind, 'forget', 'due correct char → forget row');
  assert.equal(v.list.dot, false, 'forget row has no red dot');
  assert.ok(v.list.text.includes('快忘了') && v.list.text.includes(await copy(page, 'R-D01.forgetLine')), 'R-D01 「有一阵没写，可能快忘了」');
  await back(page);
  await waitTop(page, 'home');
  await openDetailPage(page, '欤');
  v = await view(page);
  assert.equal(v.source, null, 'R-D09: no etymology → the whole source block is hidden');
  assert.equal(v.wordLabel, '释义', 'pinyin-only card (欤字) → 释义 label');
  assert.equal(v.gloss, await copy(page, 'X-PROMPT.fallbackHint'), 'gloss = the prompt hint line');
  assert.equal(v.swap, null, 'no context word → no swap-word row');

  // ------------------------------------------------------------------ 4. 自选未写 + 移除 / 撤销
  step('custom, unwritten: remove → confirm → undo bar above 练这个字 → undo restores position and time → 已撤销');
  await back(page);
  await waitTop(page, 'home');
  await seed(page, { custom: ['山', '木', '日'] });
  const custom0 = (await state(page)).custom;
  await openDetailPage(page, '木');
  v = await view(page);
  assert.equal(v.count, '还没有记录', 'custom unwritten → no records');
  assert.ok(v.remove && v.remove.includes('从自选的字移除') && v.remove.includes(await copy(page, 'R-D06.rowSub')), 'remove row + sub line');
  await clickTop(page, 'detail-remove');
  await page.waitForSelector(tid('detail-remove-confirm'));
  await waitNavIdle(page);
  assert.equal((await page.textContent(`${tid('detail-remove-confirm')} .sz-confirm__body`)).trim(), await copy(page, 'R-D06.confirmBody', { char: '木' }), 'confirm body');
  assert.equal((await page.textContent(tid('confirm-ok'))).trim(), '移除', 'confirm button 移除');
  assert.equal((await page.textContent(tid('confirm-cancel'))).trim(), '取消', 'cancel button 取消');
  await page.click(tid('confirm-ok'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="detail-remove-confirm"]'));
  await waitView(page, () => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="undo-bar"]'));
  st = await state(page);
  assert.deepEqual(st.custom.added.map(e => e.char), ['山', '日'], 'removed from custom.added');
  v = await view(page);
  assert.equal(v.remove, null, 'remove row gone');
  assert.equal(v.undo && v.undo.state, 'on', 'undo bar shown');
  assert.ok(v.undo.text.includes('「木」已从自选的字移除') && v.undo.text.includes('离开这一页前可以撤销'), 'undo bar lines (R-D06)');
  const geo = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const bar = top.querySelector('[data-testid="undo-bar"]').getBoundingClientRect();
    const btn = top.querySelector('[data-testid="detail-practice"]').getBoundingClientRect();
    return { barBottom: bar.bottom, btnTop: btn.top };
  });
  assert.ok(geo.barBottom <= geo.btnTop, 'undo bar floats above 练这个字');
  await clickTop(page, 'undo-button');
  await waitView(page, () => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-undo"]');
    return !!el && el.dataset.state === 'done';
  });
  st = await state(page);
  assert.deepEqual(st.custom, custom0, 'undo put 木 back at its old position with its old time');
  v = await view(page);
  assert.ok(v.undo.text.includes('已撤销'), '「已撤销」');
  assert.ok(v.remove, 'remove row back');

  step('undo lifetime: leaving the page (back) or pushing another page (练这个字 → 写字页) expires it');
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-undo"]'), null, { timeout: 5000 });
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await clickTop(page, 'detail-remove');
  await page.waitForSelector(tid('detail-remove-confirm'));
  await waitNavIdle(page);
  await page.click(tid('confirm-ok'));
  await waitView(page, () => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="undo-bar"]'));
  await back(page);
  await waitTop(page, 'home');
  await openDetailPage(page, '木');
  v = await view(page);
  assert.equal(v.undo, null, 'back → reopen: no undo bar (expired)');
  assert.equal(v.remove, null, 'still removed');
  st = await state(page);
  assert.deepEqual(st.custom.added.map(e => e.char), ['山', '日'], 'custom stays without 木');
  await seed(page, { custom: ['山', '木', '日'] });
  await waitView(page, () => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-remove"]'));
  await clickTop(page, 'detail-remove');
  await page.waitForSelector(tid('detail-remove-confirm'));
  await waitNavIdle(page);
  await page.click(tid('confirm-ok'));
  await waitView(page, () => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="undo-bar"]'));
  await clickTop(page, 'detail-practice');
  await waitTop(page, 'write');
  await page.click(topSel('page-back'));
  await waitTop(page, 'detail');
  v = await view(page);
  assert.equal(v.undo, null, 'pushed the write page and came back → undo expired');

  step('remove / undo failures (failNextWrite): confirm stays with 三段式; undo failure keeps the button');
  await goHome(page);
  await seed(page, { custom: ['山', '木', '日'] });
  const custom1 = (await state(page)).custom;
  await openDetailPage(page, '木');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.custom' }));
  await clickTop(page, 'detail-remove');
  await page.waitForSelector(tid('detail-remove-confirm'));
  await waitNavIdle(page);
  await page.click(tid('confirm-ok'));
  await page.waitForFunction(fail => {
    const el = document.querySelector('[data-testid="detail-remove-confirm"] .sz-confirm__body');
    return !!el && el.textContent.trim() === fail;
  }, await copy(page, 'X-DETAIL.saveFailed'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  assert.equal((await page.textContent(tid('confirm-ok'))).trim(), '再试一次', 'retry button');
  assert.equal((await page.textContent(tid('confirm-cancel'))).trim(), '先不保存', 'cancel button');
  st = await state(page);
  assert.deepEqual(st.custom, custom1, 'failed remove: custom unchanged');
  await page.click(tid('confirm-ok'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="detail-remove-confirm"]'));
  await waitView(page, () => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="undo-bar"]'));
  st = await state(page);
  assert.deepEqual(st.custom.added.map(e => e.char), ['山', '日'], 'retry removed it');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.custom' }));
  await clickTop(page, 'undo-button');
  await waitView(page, () => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-undo"]');
    return !!el && el.dataset.state === 'failed';
  });
  v = await view(page);
  assert.ok(v.undo.text.includes(await copy(page, 'X-DETAIL.saveFailed')) && v.undo.text.includes(await copy(page, 'X-DETAIL.undoFailedL2')), 'undo failure lines');
  assert.equal(v.undo.button, true, 'undo button still there');
  st = await state(page);
  assert.deepEqual(st.custom.added.map(e => e.char), ['山', '日'], 'failed undo: still removed');
  await clickTop(page, 'undo-button');
  await waitView(page, () => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-undo"]');
    return !!el && el.dataset.state === 'done';
  });
  st = await state(page);
  assert.deepEqual(st.custom, custom1, 'second undo restored it');

  // ------------------------------------------------------------------ 5. 旧照片
  step('legacy photo: not a record (P10b); 「旧版本的记录」 → read-only 「「人」的旧记录」 page');
  await back(page);
  await waitTop(page, 'home');
  await seed(page, { photos: ['人'] });
  await openDetailPage(page, '人');
  v = await view(page);
  assert.equal(v.count, '还没有记录', 'photo does not count as a record (P10b)');
  assert.equal(v.dataCount, '0', 'data-count 0');
  assert.equal(v.legacy, `${await copy(page, 'X-DETAIL.legacyEntry')}›`, 'legacy row 「旧版本的记录 ›」');
  await clickTop(page, 'detail-legacy');
  await waitTop(page, 'detail-photo');
  const photo = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => top.querySelector(`[data-testid="${id}"]`);
    return {
      title: top.querySelector('[data-page-title]').textContent.trim(),
      src: q('photo-image') ? q('photo-image').getAttribute('src') : null,
      alt: q('photo-image') ? q('photo-image').getAttribute('alt') : null,
      caption: q('photo-caption').textContent.trim(),
      body: q('photo-body').innerHTML,
      buttons: [...top.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent.trim()),
      bg: getComputedStyle(q('photo-screen')).backgroundColor,
    };
  });
  assert.equal(photo.title, '「人」的旧记录', 'R-D10 title');
  assert.equal(photo.src, PNG, 'the stored photo is shown');
  assert.equal(photo.alt, '旧版本拍下的照片', 'photo alt text');
  assert.equal(photo.caption, '旧版本的记录', 'caption');
  assert.equal(photo.body, '旧版本拍照留下的记录，只能看，不能做成图片。<br>备份时会一起存下。', 'R-D10 body (two lines)');
  assert.deepEqual(photo.buttons, ['关闭'], 'read-only: only the close button, no make-image');
  assert.equal(photo.bg, 'rgb(31, 27, 24)', 'dark page #1F1B18');
  await page.click(topSel('page-back'));
  await waitTop(page, 'detail');

  // ------------------------------------------------------------------ 6. 换掉这个词语
  step('swap word: banner + undo; failure 三段式; undo failure; prompt switches to pinyin-only (deck.js / prompt.js 口径)');
  await back(page);
  await waitTop(page, 'home');
  await seed(page, {});
  await openDetailPage(page, '静');
  v = await view(page);
  assert.equal(v.word, '平静', 'word 平静');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.wordOff' }));
  await clickTop(page, 'detail-swap');
  await waitView(page, () => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-swap-fail"]'));
  st = await state(page);
  assert.equal(st.wordOff, null, 'failed swap: wordOff unchanged');
  v = await view(page);
  assert.equal(v.banner, null, 'no banner after a failed swap');
  assert.ok((await page.textContent(topSel('detail-swap-fail'))).includes(await copy(page, 'X-DETAIL.saveFailed')), 'failure note');
  await clickTop(page, 'detail-swap-fail-retry');
  await waitView(page, () => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-word-banner"]'));
  st = await state(page);
  assert.deepEqual(Object.keys(st.wordOff), ['base:静'], 'retry: wordOff[base:静] written');
  v = await view(page);
  assert.equal(v.banner.text, '「平静」以后不会再出现', 'R-D05 banner');
  assert.equal(v.banner.undo, true, 'banner undo');
  assert.equal(v.wordLabel, '释义', 'card label → 释义');
  assert.equal(v.gloss, await copy(page, 'X-PROMPT.fallbackHint'), 'gloss = prompt hint line');
  assert.equal(v.swap, null, 'swap row gone');
  assert.equal(v.swapFail, false, 'failure block gone');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.wordOff' }));
  await clickTop(page, 'detail-word-undo');
  await waitView(page, () => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-word-banner"]');
    return !!el && el.dataset.state === 'failed';
  });
  v = await view(page);
  assert.equal(v.banner.text, await copy(page, 'X-DETAIL.saveFailed'), 'undo failure → banner explains');
  assert.equal(v.banner.undo, true, 'undo still clickable');
  st = await state(page);
  assert.deepEqual(Object.keys(st.wordOff), ['base:静'], 'failed undo: still off');
  await clickTop(page, 'detail-word-undo');
  await waitView(page, () => {
    const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-word-banner"]');
    return !!el && el.dataset.state === 'undone';
  });
  st = await state(page);
  assert.deepEqual(st.wordOff, {}, 'undo removed the key');
  v = await view(page);
  assert.equal(v.banner.text, '已撤销', '「已撤销」');
  assert.equal(v.wordLabel, '词语', 'label back to 词语');
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-word-banner"]'), null, { timeout: 5000 });
  await page.waitForTimeout(PRESS_SETTLE_MS);

  step('wordOff in effect → write-page prompt is the pinyin-only card; B from here → finish → back to this page');
  await clickTop(page, 'detail-swap');
  await waitView(page, () => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-word-banner"]'));
  await clickTop(page, 'detail-practice');
  await waitTop(page, 'write');
  st = await state(page);
  assert.deepEqual(st.sessions.B && st.sessions.B.queue, ['base:静'], 'B = [静]');
  assert.deepEqual(st.sessions.B.source, { view: 'detail', char: '静' }, 'B source = detail 静');
  const expected = await page.evaluate(async () => {
    const { cardForKey, withWordOff } = await import('/src/data/deck.js');
    const { promptCells } = await import('/src/ui/screens/write/prompt.js');
    const wo = window.__shiziTest.getState().wordOff;
    const on = promptCells(withWordOff(cardForKey('base:静'), wo));
    const off = promptCells(cardForKey('base:静'));
    return { on: { cells: on.cells.map(c => c.text), hint: on.hint }, off: { cells: off.cells.map(c => c.text), hint: off.hint } };
  });
  const shown = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return {
      cells: [...top.querySelectorAll('[data-testid="write-prompt-cell"]')].map(el => el.textContent),
      hint: top.querySelector('[data-testid="write-prompt-hint"]').textContent,
      single: top.querySelector('[data-testid="write-prompt"]').dataset.single,
    };
  });
  assert.deepEqual({ cells: shown.cells, hint: shown.hint }, expected.on, 'write prompt = promptCells(withWordOff(card))');
  assert.deepEqual(expected.on.cells, ['jìng'], 'pinyin-only single cell');
  assert.equal(expected.on.hint, await copy(page, 'X-PROMPT.fallbackHint'), 'hint = fallback hint');
  assert.ok(JSON.stringify(expected.off.cells) !== JSON.stringify(expected.on.cells), 'differs from the 平静 prompt');
  assert.ok(!shown.cells.join('').includes('平'), 'the swapped word no longer appears');
  assert.equal(shown.single, 'true', 'single-cell prompt');
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel('write-judge-correct'));
  await waitTop(page, 'result');
  assert.equal((await page.textContent(topSel('result-leave'))).trim(), '回到「静」', 'result leave button 回到「静」');
  await page.click(topSel('result-leave'));
  await waitTop(page, 'detail');
  v = await view(page);
  assert.equal(v.char, '静', 'back on the detail page of 静');
  assert.equal(v.count, '记录了 1 次', 'the new record shows up');
  assert.equal(v.banner, null, 'banner expired (left the page for the write page)');

  // ------------------------------------------------------------------ 7. B 没写完
  step('B unfinished: opening detail does not pop S02 nor touch sessions.B; 练这个字 pops S02; cancel keeps B deep-equal');
  await goHome(page);
  await seed(page, { B: { chars: ['永', '和'] } });
  const b0 = (await state(page)).sessions.B;
  await openDetailPage(page, '永');
  assert.equal(await page.$(tid('s02-dialog')), null, 'no S02 on open');
  assert.deepEqual((await state(page)).sessions.B, b0, 'sessions.B unchanged by opening');
  await clickTop(page, 'detail-practice');
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  assert.ok((await page.textContent(tid('s02-body'))).includes('「永」「和」'), 'S02 lists the old B chars');
  await page.click(tid('s02-cancel'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="s02-dialog"]'));
  await waitNavIdle(page);
  assert.deepEqual((await state(page)).sessions.B, b0, 'cancel: B deep-equal');
  assert.equal(await page.evaluate(() => document.querySelector('.sz-app').dataset.topScreen), 'detail', 'still on detail');

  step('practice start failure (failNextWrite sessions) → 三段式 in the footer; retry opens the write page');
  await back(page);
  await waitTop(page, 'home');
  await seed(page, {});
  await openDetailPage(page, '永');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.sessions' }));
  await clickTop(page, 'detail-practice');
  await waitView(page, () => !!document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-practice-fail"]'));
  st = await state(page);
  assert.equal(st.sessions ? st.sessions.B : null, null, 'failed start: no B');
  assert.ok((await page.textContent(topSel('detail-practice-fail'))).includes(await copy(page, 'X-DETAIL.saveFailed')), 'failure note');
  await clickTop(page, 'detail-practice-fail-retry');
  await waitTop(page, 'write');
  st = await state(page);
  assert.deepEqual(st.sessions.B.queue, ['base:永'], 'retry started B [永]');
}
