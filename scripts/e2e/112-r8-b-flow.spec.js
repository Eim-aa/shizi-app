// r8 卡 B（写字与结果页流程，D66 ③ ④ ⑥ ⑧ ⑮ ⑯）。
//
//   1. ⑥ 今天这一组也能「结束这组」：写字页有「结束这组」、确认框数字、结束后出结果页与作品、「还有 N 个字没写，没有记下。」；首次练习没有。
//   2. ④ 结果页写错的那一行有「修改 ›」（与写字页结果行同一个组件）→ 对照 / 改判弹层 → 改为写对；⑮ 弹层里「看这个字 ›」进字详情、返回回到结果页。
//   3. ③ 结果页「重写错字」→ 推入重写页（只算练习：不写任何记录、不动调度、不动会话）→ 写完回到结果页；没有写错的字时没有这个按钮。
//   4. ④ ⑮ 字详情：记录格放大弹层里改判（字库待复习与下次练习日同步）；「加入自选」一次点击、行变「移出自选」。
//   5. ⑧ 首页进行中：主按钮「继续写字 · 已写 / 总数」、A + B 时两个入口不同说法、第二行「今天的字 · 已写 / 总数 ›」；字库「今日练习」只数今天的练习。
//   6. ⑯ 首练结果页（iPhone 17 402×874）：提醒邀请的「开启提醒 / 先不用」在首屏内（作品再高也不靠滚动）。
//
// R8_SHOTS=<目录> 时顺手截图（评审用，缺省不截）。

import { mkdirSync } from 'node:fs';
import { bootTestHost, drawStroke, footItems, HORIZONTAL, PRESS_SETTLE_MS, tap, tid, topSel, waitNavIdle } from './helpers.mjs';

const SHOTS = process.env.R8_SHOTS || '';
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function evalIn(page, fn, arg) {
  return page.evaluate(fn, arg);
}

/** 造一组并 seed（真实 mutator）；steps 依次 correct | wrong | skip | seen。slot 由 kind 定。 */
async function seedGroup(page, o) {
  const res = await evalIn(page, async opts => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { skipInDraft } = await import('/src/ui/screens/write/skip.js');
    const { appendRecordToDraft } = await import('/src/ui/screens/write/answer.js');
    const { makeRecord } = await import('/src/core/records.js');
    const { advance, createSession } = await import('/src/core/sessions.js');
    const now = window.__shiziTest.now();
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 100;
    const nextId = p => p + (n += 1);
    const stroke = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    for (const g of opts.groups) {
      const slot = g.kind === 'picked' ? 'B' : 'A';
      draft.sessions[slot] = createSession({ id: g.id, kind: g.kind, source: g.source, queue: g.chars.map(c => 'base:' + c), at: now - 120000 });
      (g.steps || []).forEach((step, i) => {
        const cur = draft.sessions[slot];
        const key = cur.queue[cur.cursor];
        const at = now - 60000 + i * 1000;
        if (step === 'correct' || step === 'wrong') judgeInDraft(draft, { slot, cardKey: key, judgment: step, strokes: stroke, at, nextId });
        else if (step === 'skip') skipInDraft(draft, { slot, cardKey: key, at, nextId });
        else {
          const r = makeRecord({ id: nextId('r'), cardKey: key, sessionId: cur.id, kind: 'answer-seen', at, help: { hints: 0, answerSeen: true, traced: false } });
          appendRecordToDraft(draft, r);
          draft.sessions[slot] = advance(cur, { cardKey: key, recordId: r.id, kind: 'answer-seen', at });
        }
      });
    }
    window.__shiziTest.reset();
    (await import('/src/ui/screens/write/compare.js')).forgetRecentInk();
    return window.__shiziTest.seed(draft);
  }, { groups: Array.isArray(o) ? o : [o] });
  if (!res || !res.ok) throw new Error('seed failed: ' + JSON.stringify(res));
}

async function state(page) {
  return evalIn(page, () => {
    const st = window.__shiziTest.getState();
    const records = [];
    for (const v of Object.values(st.records || {})) for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    return { sessions: st.sessions, records, sched: st.sched || {}, custom: st.custom || null };
  });
}

async function goHome(page) {
  await evalIn(page, async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('home');
  });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
}

async function pushScreen(page, name, params) {
  await evalIn(page, async ([n, p]) => {
    const { nav } = await import('/src/ui/router.js');
    nav.push(n, p);
  }, [name, params]);
  await page.waitForFunction(n => document.querySelector('.sz-app').dataset.topScreen === n, name);
  await waitNavIdle(page);
}

async function top(page) {
  return evalIn(page, () => document.querySelector('.sz-app').dataset.topScreen);
}

async function openWriteA(page) {
  await evalIn(page, async () => {
    const { openWrite } = await import('/src/ui/screens/session/index.js');
    openWrite('A');
  });
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
}

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // ------------------------------------------------------------------ 1. ⑥ 今天这一组结束这组
  step('⑥ daily group: 结束这组 is in the head; confirm shows n / m; ending opens the result page with the work and the unwritten line');
  await seedGroup(page, { id: 's60', kind: 'daily', chars: ['永', '和', '春'], steps: ['correct'] });
  await openWriteA(page);
  assert.ok((await footItems(page)).some(i => i.testid === 'write-end'), 'daily: 结束这组 is shown (D66 ⑥)');
  await tap(page, 'write-end');
  await page.waitForSelector(tid('write-end-dialog'));
  await waitNavIdle(page);
  assert.equal(await page.locator(tid('write-end-body')).textContent(), '还有 2 个字没写。已写的 1 个已记下。', 'S04 body: n = 2 unwritten, m = 1 judged');
  await page.click(tid('write-end-confirm'));
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  let v = await evalIn(page, () => {
    const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="result-body"]');
    return { variant: b.dataset.variant, early: b.dataset.early, sub: (document.querySelector('.sz-layer[data-top="true"] [data-testid="result-sub"]') || {}).textContent || null };
  });
  assert.deepEqual(v, { variant: 'daily', early: 'true', sub: '还有 2 个字没写，没有记下。' }, 'daily result, ended early: the same line as the picked group');
  let st = await state(page);
  assert.ok(!st.sessions.A && st.sessions.lastEnded.A.endedEarly === true, 'A moved to lastEnded.A, endedEarly');
  assert.equal(st.records.filter(r => r.kind === 'judged').length, 1, 'only the written char counts');
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);

  step('⑥ the first-practice group (three words, each can be skipped) has no 结束这组');
  await seedGroup(page, { id: 's61', kind: 'first', chars: ['尴', '赢', '拾'], steps: [] });
  await openWriteA(page);
  assert.ok(!(await footItems(page)).some(i => i.testid === 'write-end'), 'first: no 结束这组');
  await goHome(page);

  // ------------------------------------------------------------------ 2. ④ 结果页「修改 ›」与 ⑮ 看这个字
  step('④ result page: the wrong rows carry 「修改 ›」 (the same component as the write page line); it opens the sheet; ⑮ 看这个字 › opens the detail page, back returns to the result page');
  await seedGroup(page, { id: 's62', kind: 'daily', chars: ['永', '和', '春', '大'], steps: ['correct', 'wrong', 'wrong', 'correct'] });
  await pushScreen(page, 'result', { slot: 'A', sessionId: 's62' });
  await page.waitForSelector(topSel('result-redo'));
  await waitNavIdle(page, { settleMs: 1200 });
  await shot(page, 'result-redo-and-change');
  const rows = await evalIn(page, () => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="result-exrow"]')].map(r => ({
    char: r.dataset.char, state: r.dataset.state, change: (() => { const b = r.querySelector('[data-testid="result-exrow-change"]'); return b ? { text: b.textContent.trim(), cls: b.className.includes('sz-line__change'), h: Math.round(b.getBoundingClientRect().height) } : null; })(),
  })));
  const wrongRows = rows.filter(r => r.change);
  assert.deepEqual(wrongRows.map(r => r.char).sort(), ['和', '春'].sort(), 'only the wrong rows have 修改 ›');
  assert.ok(wrongRows.every(r => r.change.text === '修改›' && r.change.cls && r.change.h >= 40), 'the same 「修改 ›」 text button as the write page (class sz-line__change, hit area ≥ 40)');
  await page.click(`${topSel('result-exrow')}[data-char="和"] [data-testid="result-exrow-change"]`);
  await page.waitForSelector(tid('result-sheet'));
  await waitNavIdle(page);
  await shot(page, 'result-sheet-view-char');
  const sheet = await evalIn(page, () => {
    const s = document.querySelector('[data-testid="result-sheet"]');
    const q = id => s.querySelector(`[data-testid="${id}"]`);
    return { title: s.querySelector('.sz-sheet__title').textContent, flip: q('result-sheet-flip').textContent.trim(), view: q('result-sheet-detail').textContent.trim() };
  });
  assert.deepEqual(sheet, { title: '「和」写错了', flip: '改为写对', view: '看这个字 ›' }, 'the sheet: flip + the explicit way into the detail page');
  await page.click(tid('result-sheet-detail'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'detail');
  await waitNavIdle(page);
  assert.equal(await evalIn(page, () => document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-screen"]').dataset.char), '和', 'detail page of the char in the sheet');
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'result');
  await waitNavIdle(page);

  // ------------------------------------------------------------------ 3. ③ 重写错字
  step('③ 重写错字: one tap pushes the redo page (plain push) for the wrong chars; nothing is written; finishing returns to the result page');
  const before = await state(page);
  await page.click(topSel('result-redo'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'redo');
  await waitNavIdle(page);
  const redo0 = await evalIn(page, () => { const r = document.querySelector('.sz-layer[data-top="true"] [data-testid="redo-screen"]'); const w = r.querySelector('.sz-write'); return { stage: w.dataset.stage, i: w.dataset.index, total: w.dataset.total, note: r.querySelector('[data-testid="redo-note"]').textContent, progress: r.querySelector('[data-testid="redo-progress"]').textContent }; });
  assert.deepEqual(redo0, { stage: 'write', i: '0', total: '2', note: '再写一遍，只算练习。', progress: '1 / 2' }, 'two wrong chars, write stage');
  assert.equal(await evalIn(page, () => document.querySelector('.sz-layer[data-top="true"] [data-testid="redo-done"]').disabled), true, '写好了 is disabled until a stroke is written');
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await shot(page, 'redo-write');
  await page.click(topSel('redo-done'));
  await page.waitForSelector(topSel('write-compare'));
  await waitNavIdle(page);
  await shot(page, 'redo-check');
  assert.equal((await page.locator(topSel('redo-next')).textContent()).trim(), '下一个', 'first of two: 下一个');
  await page.click(topSel('redo-again'));
  await page.waitForSelector(topSel('write-grid-live'));
  await waitNavIdle(page);
  assert.equal(await evalIn(page, () => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.stage), 'write', '再写一次: back to an empty grid for the same char');
  await page.click(topSel('redo-show-answer'));
  await page.waitForSelector(topSel('write-compare'));
  await waitNavIdle(page);
  await page.click(topSel('redo-next'));
  await page.waitForFunction(() => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.index === '1');
  await waitNavIdle(page);
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('redo-done'));
  await page.waitForSelector(topSel('write-compare'));
  await waitNavIdle(page);
  assert.equal((await page.locator(topSel('redo-next')).textContent()).trim(), '完成', 'the last one ends with 完成');
  await page.click(topSel('redo-next'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'result');
  await waitNavIdle(page);
  const after = await state(page);
  assert.deepEqual(after.records, before.records, 'redo wrote no record');
  assert.deepEqual(after.sched, before.sched, 'redo did not touch the schedule');
  assert.deepEqual(after.sessions, before.sessions, 'redo did not touch the sessions');

  step('④ flip 春 to 写对 on the result page → the redo list shrinks to 和; flip 和 → the 重写错字 button disappears');
  await page.click(`${topSel('result-exrow')}[data-char="春"] [data-testid="result-exrow-change"]`);
  await page.waitForSelector(tid('result-sheet-flip'));
  await waitNavIdle(page);
  await page.click(tid('result-sheet-flip'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  await waitNavIdle(page);
  st = await state(page);
  assert.equal(st.records.find(r => r.char === '春').judgment, 'correct', '春 flipped');
  await page.click(topSel('result-redo'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'redo');
  await waitNavIdle(page);
  assert.equal(await evalIn(page, () => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.total), '1', 'only 和 is left');
  await page.click(topSel('page-back'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'result');
  await waitNavIdle(page);
  await page.click(`${topSel('result-exrow')}[data-char="和"] [data-testid="result-exrow-change"]`);
  await page.waitForSelector(tid('result-sheet-flip'));
  await waitNavIdle(page);
  await page.click(tid('result-sheet-flip'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  await waitNavIdle(page);
  assert.equal(await page.locator(topSel('result-redo')).count(), 0, 'no wrong chars → no 重写错字');

  // ------------------------------------------------------------------ 4. ④ ⑮ 字详情
  step('④ detail page: tap a record cell → 改为写错 (same record, corrections appended); ⑮ 加入自选 is one tap and the row becomes 移出自选');
  await pushScreen(page, 'detail', { char: '永' });
  await page.waitForSelector(topSel('detail-hero-cell'));
  const recBefore = await state(page);
  await page.click(topSel('detail-hero-cell'));
  await page.waitForSelector(tid('detail-zoom'));
  await waitNavIdle(page);
  await shot(page, 'detail-zoom-flip');
  assert.equal((await page.locator(tid('detail-zoom-flip')).textContent()).trim(), '改为写错', 'the record is 写对 → offers 改为写错');
  assert.equal(await page.locator(tid('detail-zoom-note')).textContent(), '改了只换掉这一次，不会多算一次。', 'same sentence as the result sheet');
  await page.click(tid('detail-zoom-flip'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="detail-zoom"]'));
  await waitNavIdle(page);
  st = await state(page);
  const yong = st.records.find(r => r.char === '永' && r.kind === 'judged');
  assert.deepEqual([yong.judgment, yong.corrections.length], ['wrong', 1], 'same record flipped, one correction');
  assert.equal(st.records.length, recBefore.records.length, 'no record added');
  assert.ok(st.sched['base:永'].due !== recBefore.sched['base:永'].due, 'the schedule follows (next practice day moved)');
  assert.equal(await evalIn(page, () => document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-screen"]').dataset.list), 'wrong', 'the detail page now lists 永 under 待复习 (written wrong)');
  assert.equal(await page.locator(topSel('detail-add')).count(), 1, '永 is not in the custom list: 加入自选 is there');
  await page.click(topSel('detail-add'));
  await page.waitForSelector(topSel('detail-remove'));
  st = await state(page);
  assert.ok(st.custom && st.custom.added.some(e => e.char === '永'), '永 is now in custom.added');
  assert.equal(await page.locator(topSel('detail-add')).count(), 0, 'the add row turned into 移出自选');
  await shot(page, 'detail-rows');

  // ------------------------------------------------------------------ 5. ⑧ 首页与字库
  step('⑧ home: main button 继续写字 · 已写 / 总数 (A only); A + B: 继续写自选字 + 今天的字 · n / total › (a button with a ›)');
  await goHome(page);
  await seedGroup(page, [{ id: 's63', kind: 'daily', chars: ['一', '二', '三', '四', '五', '六', '七', '八'], steps: ['correct', 'correct', 'skip', 'seen'] }]);
  await goHome(page);
  await evalIn(page, () => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);
  let home = await evalIn(page, () => {
    const q = id => document.querySelector(`.sz-layer [data-testid="${id}"]`);
    return { text: q('home-start').textContent.trim(), aria: q('home-start').getAttribute('aria-label'), other: q('other-line') ? q('other-line').textContent.trim() : null };
  });
  assert.deepEqual(home, { text: '继续写字 · 3 / 8', aria: '继续写字，已写 3 个，共 8 个', other: null }, 'skipped words are not counted as written; seen ones are');
  await shot(page, 'home-progress');
  await seedGroup(page, [
    { id: 's63', kind: 'daily', chars: ['一', '二', '三', '四', '五', '六', '七', '八'], steps: ['correct', 'correct'] },
    { id: 's64', kind: 'picked', chars: ['鲜', '境'], steps: [] },
  ]);
  await goHome(page);
  await evalIn(page, () => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);
  home = await evalIn(page, () => {
    const q = id => document.querySelector(`.sz-layer [data-testid="${id}"]`);
    const o = q('other-line');
    return { text: q('home-start').textContent.trim(), other: o.textContent.trim(), tag: o.tagName, aria: o.getAttribute('aria-label') };
  });
  assert.deepEqual(home, { text: '继续写自选字 · 0 / 2', other: '今天的字 · 2 / 8›', tag: 'BUTTON', aria: '接着写今天的字，已写 2 个，共 8 个' }, 'two entries, two wordings, each with its own count');
  await shot(page, 'home-two-entries');

  step('⑧ the library 今日练习 row counts today’s practice (A), not the picked group; one tap continues A');
  await evalIn(page, async () => { const { nav } = await import('/src/ui/router.js'); nav.switchTab('library'); });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'library');
  await waitNavIdle(page);
  const lib = await evalIn(page, () => ({ value: document.querySelector('.sz-layer [data-testid="library-today-value"]').textContent.trim(), phase: document.querySelector('.sz-layer [data-testid="library-today"]').dataset.phase }));
  assert.deepEqual(lib, { value: '还剩 6 个', phase: 'half' }, 'A has 6 of 8 left; B (2 left) does not show here');
  await page.click(topSel('library-today'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  assert.equal(await evalIn(page, () => document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.slot), 'A', 'the row continues group A');
  await goHome(page);

  // ------------------------------------------------------------------ 6. ⑯ 首练结果页的提醒邀请
  step('⑯ first-practice result page on a 402×874 screen (and a shorter 402×700 one): 开启提醒 / 先不用 are inside the first screen, tapping them works without scrolling');
  for (const [height, steps] of [[874, ['correct', 'wrong', 'seen']], [874, ['wrong', 'wrong', 'wrong']], [874, ['correct', 'correct', 'correct']], [700, ['correct', 'wrong', 'seen']]]) {
    await page.setViewportSize({ width: 402, height });
    await seedGroup(page, { id: 's65', kind: 'first', chars: ['尴', '赢', '拾'], steps });
    await pushScreen(page, 'result', { slot: 'A', sessionId: 's65' });
    await page.waitForSelector(topSel('result-invite-yes'), { timeout: 8000 });
    await waitNavIdle(page, { settleMs: 700 });
    const geo = await evalIn(page, () => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const body = top.querySelector('.sz-page__body').getBoundingClientRect();
      const foot = top.querySelector('.sz-page__foot').getBoundingClientRect();
      const r = id => top.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
      const yes = r('result-invite-yes');
      const no = r('result-invite-no');
      return { vh: innerHeight, yesB: yes.bottom, noB: no.bottom, yesT: yes.top, bodyB: body.bottom, footT: foot.top, hit: document.elementFromPoint(yes.left + yes.width / 2, yes.top + yes.height / 2).closest('[data-testid]').dataset.testid };
    });
    assert.ok(geo.yesB <= geo.footT + 0.5 && geo.noB <= geo.footT + 0.5 && geo.yesT >= 0, `${height} ${steps.join(',')}: both buttons are above the foot, inside the viewport (${JSON.stringify(geo)})`);
    assert.equal(geo.hit, 'result-invite-yes', `${height} ${steps.join(',')}: the button is what the finger would hit (nothing covers it)`);
    await shot(page, `first-result-${height}-${steps.join('-')}`);
    await page.click(topSel('result-invite-no'));
    await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] [data-testid="result-invite-no"]'));
    await page.click(topSel('page-back'));
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
    await waitNavIdle(page);
  }
}
