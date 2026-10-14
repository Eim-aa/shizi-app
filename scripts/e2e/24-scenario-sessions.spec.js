// 场景：A / B 两组互不覆盖（02 M2-3「scenario-sessions」；决定-D05 / D07 / D22；01 §3.3；04 §6 场景 3、反例 4）。
//
// 主线：seed A（今天的练习）停在回忆阶段，格子里 2 笔、用过 1 次提示 → 开 B（M2-2 session.startPicked）
//   → sessions.A 深相等（current 的笔画、提示、阶段都没动）→ B 写一字后返回首页（轻提示「已保存，下次接着写」）
//   → 首页 resume-line 为 B、other-line 为 A → 主入口续 B → 结束这组 → 结果页 → 回到来源（首页）
//   → 首页只剩 A：主入口「继续写字」、resume-line 今天的练习 → 进入后 A 原字、2 笔、提示还剩 1 次，不自动进下一字。
// 分支：B 写一字后暂停不结束 → 从首页 other-line 续 A（A 原样）→ 回首页 B 仍在（深相等）→ 主入口续 B 回到 B 的第二个字。

import { bootTestHost, drawStroke, HORIZONTAL, footItems, noToastFor, PRESS_SETTLE_MS, tid, topSel, waitNavIdle, tap } from './helpers.mjs';

const A_CHARS = ['永', '和', '春'];
const B_CHARS = ['大', '中'];

async function seedA(page) {
  const res = await page.evaluate(async chars => {
    const { encodeRawStrokes } = await import('/src/core/ink-math.js');
    const { createSession } = await import('/src/core/sessions.js');
    const now = window.__shiziTest.now();
    const raw = [
      [{ x: 60, y: 120, t: 0 }, { x: 170, y: 121, t: 60 }, { x: 280, y: 122, t: 120 }],
      [{ x: 172, y: 60, t: 400 }, { x: 173, y: 170, t: 460 }, { x: 174, y: 290, t: 520 }],
    ];
    const s = createSession({ id: 's30', kind: 'daily', source: { view: 'home' }, queue: chars.map(c => 'base:' + c), at: now - 60000 });
    const A = { ...s, current: { ...s.current, strokes: encodeRawStrokes(raw), hints: 1, hintRange: null } };
    window.__shiziTest.reset();
    const r = window.__shiziTest.seed({ sessions: { A, B: null, lastEnded: {} } });
    return { ok: !!(r && r.ok), A: window.__shiziTest.getState().sessions.A };
  }, A_CHARS);
  if (!res.ok) throw new Error('seed A failed');
  return res.A;
}

async function sessions(page) {
  return page.evaluate(() => window.__shiziTest.getState().sessions);
}

async function toHome(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('home');
  });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
}

async function waitTop(page, screen) {
  await page.waitForFunction(s => document.querySelector('.sz-app').dataset.topScreen === s, screen);
  await waitNavIdle(page);
}

async function homeLines(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => (top ? top.querySelector(`[data-testid="${id}"]`) : null);
    const line = id => (q(id) ? { slot: q(id).dataset.slot, kind: q(id).dataset.kind, text: q(id).textContent.trim() } : null);
    return {
      screen: document.querySelector('.sz-app').dataset.topScreen,
      // E9a（D49-7）：「这一组还有 N 个字」文字行已删；槽 / 种类 / 句子改读进行中格子块（data-slot / data-kind，读屏名称第一句）
      // H2（D55）：首页不再画进行中的格子，续写的是哪一组由 data-resume（A / B / A+B）与 other-line 表达
      other: line('other-line'),
      cta: q('home-start') ? q('home-start').getAttribute('aria-label') : null,
      dataResume: q('screen-home') ? q('screen-home').dataset.resume : null,
    };
  });
}

async function writeView(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const w = top ? top.querySelector('.sz-write') : null;
    const g = top ? top.querySelector('[data-testid="write-grid"]') : null;
    return {
      slot: w ? w.dataset.slot : null,
      cursor: w ? Number(w.dataset.cursor) : null,
      phase: w ? w.dataset.phase : null,
      strokes: g ? Number(g.dataset.strokeCount) : null,
      progress: top && top.querySelector('[data-testid="write-progress"]') ? top.querySelector('[data-testid="write-progress"]').textContent : null,
    };
  });
}

async function judgeOne(page) {
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel('write-judge-correct'));
  await page.waitForFunction(() => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && w.dataset.cursor === '1' && w.dataset.phase === 'recall';
  });
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function checkA(page, assert, seeded, label) {
  await page.waitForSelector(topSel('write-done'), { timeout: 15000 });
  const w = await writeView(page);
  w.hint = ((await footItems(page)).find(i => i.testid === 'write-hint') || {}).aria || null; // D49：次数在读屏名称里；D55：提示是主按钮下文字行里的按钮
  assert.deepEqual([w.slot, w.cursor, w.phase, w.progress], ['A', 0, 'recall', '1 / 3'], `${label}: A on its original character 永 (1 / 3), recall`);
  assert.equal(w.strokes, 2, `${label}: the 2 strokes are back in the grid`);
  assert.equal(w.hint, '提示，还有 4 次', `${label}: one hint used, four left (永 has 5 strokes, D64 ①)`);
  await page.waitForTimeout(800);
  const again = await writeView(page);
  assert.deepEqual([again.cursor, again.strokes], [0, 2], `${label}: no auto-advance to the next character`);
  const s = await sessions(page);
  assert.deepEqual(s.A.current, seeded.current, `${label}: sessions.A.current deep-equal to the seeded one`);
  assert.deepEqual([s.A.cursor, s.A.items], [seeded.cursor, seeded.items], `${label}: cursor / items untouched`);
}

export default async function scenario(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // ------------------------------------------------------------------ 主线
  step('seed A (daily) paused in recall: 2 strokes + hints=1; open B via session.startPicked → A deep-equal');
  let seeded = await seedA(page);
  await toHome(page);
  assert.equal(seeded.current.strokes.length, 2, 'A has 2 stored strokes');
  const opened = await page.evaluate(async chars => {
    const { startPicked } = await import('/src/ui/screens/session/index.js');
    const r = startPicked(chars, { source: { view: 'home' } });
    return { ok: r.ok, opened: r.opened };
  }, B_CHARS);
  assert.deepEqual(opened, { ok: true, opened: 'new' }, 'startPicked opened a new B (A is untouched, no S02)');
  await waitTop(page, 'write');
  let s = await sessions(page);
  assert.deepEqual(s.A, seeded, 'sessions.A deep-equal after opening B');
  assert.ok(s.B && s.B.kind === 'picked' && s.B.queue.join() === 'base:大,base:中', 'B = [大 中]');
  assert.equal((await writeView(page)).slot, 'B', 'write page shows B');

  step('B: write one character, then go back to home → toast; resume-line = B, other-line = A');
  await judgeOne(page);
  s = await sessions(page);
  assert.equal(s.B.cursor, 1, 'B advanced to 中');
  assert.deepEqual(s.A, seeded, 'A still deep-equal');
  await page.click(topSel('page-back'));
  await waitTop(page, 'home');
  assert.equal(await noToastFor(page), true, 'no toast within 1.5s of coming back (R4-F1 / P262)');
  let h = await homeLines(page);
  assert.equal(h.dataResume, 'A+B', 'B (自己选的) is the main entry, A is the other-line (D05)');
  assert.deepEqual([h.other && h.other.slot, h.other && h.other.kind], ['A', 'daily'], 'other-line is A (今天的练习)');
  assert.equal(h.dataResume, 'A+B', 'home resume state A+B');

  step('continue B from the main entry → 结束这组 → result → 回到首页 (the source)');
  await page.click(tid('home-start'));
  await waitTop(page, 'write');
  let w = await writeView(page);
  assert.deepEqual([w.slot, w.cursor], ['B', 1], 'main entry resumed B on 中 (B first, D05)');
  await tap(page, 'write-end');
  await page.waitForSelector(tid('write-end-dialog'));
  await waitNavIdle(page);
  assert.equal(await page.locator(tid('write-end-body')).textContent(), '还有 1 个字没写。已写的 1 个已记下。', 'S04 body');
  await page.click(tid('write-end-confirm'));
  await waitTop(page, 'result');
  assert.equal(await page.locator(topSel('result-title')).count(), 0, 'B result: no visible heading any more (R2-R1: the picked page is the work layout)');
  assert.equal((await page.locator(topSel('result-sub')).textContent()).trim(), '还有 1 个字没写，没有记下。', 'B result ended early: the one line about what was not written');
  assert.equal((await page.locator(topSel('result-leave')).textContent()).trim(), '回到首页', 'leave to the source: 回到首页');
  s = await sessions(page);
  assert.deepEqual(s.A, seeded, 'A still deep-equal after ending B');
  await page.click(topSel('result-leave'));
  await waitTop(page, 'home');

  step('home now shows only A: main entry 继续写字, resume-line 今天的练习; enter → A intact, no auto-advance');
  h = await homeLines(page);
  assert.equal(h.cta, '继续写字', 'main entry reads 继续写字');
  assert.equal(h.dataResume, 'A', 'only A is unfinished: the main entry continues A (the remaining count is no longer drawn on the home, D55)');
  assert.equal(h.other, null, 'no other-line');
  s = await sessions(page);
  assert.deepEqual([s.B, s.lastEnded.B], [null, undefined], 'B ended and its result left (lastEnded.B cleared)');
  await page.click(tid('home-start'));
  await waitTop(page, 'write');
  await checkA(page, assert, seeded, 'after B ended');

  // ------------------------------------------------------------------ 分支：B 暂停不结束
  step('branch: B paused (not ended) → resume A from other-line → A intact → back home → B still there, deep-equal');
  seeded = await seedA(page);
  await toHome(page);
  await page.evaluate(async chars => {
    const { startPicked } = await import('/src/ui/screens/session/index.js');
    startPicked(chars, { source: { view: 'home' } });
  }, B_CHARS);
  await waitTop(page, 'write');
  await judgeOne(page);
  await page.click(topSel('page-back'));
  await waitTop(page, 'home');
  const pausedB = (await sessions(page)).B;
  assert.equal(pausedB.cursor, 1, 'B paused on 中');
  h = await homeLines(page);
  assert.deepEqual([h.dataResume, h.other && h.other.slot], ['A+B', 'A'], 'main entry continues B, other-line A');
  await page.click(tid('other-line'));
  await waitTop(page, 'write');
  await checkA(page, assert, seeded, 'A resumed while B is paused');
  s = await sessions(page);
  assert.deepEqual(s.B, pausedB, 'B untouched while writing A');
  await page.click(topSel('page-back'));
  await waitTop(page, 'home');
  s = await sessions(page);
  assert.deepEqual([s.B, s.lastEnded.B], [pausedB, undefined], 'B still paused (not ended), deep-equal');
  assert.deepEqual(s.A, seeded, 'A deep-equal after coming back');
  h = await homeLines(page);
  assert.deepEqual([h.dataResume, h.other && h.other.slot], ['A+B', 'A'], 'home still offers B (main entry) then A (other-line)');
  await page.click(tid('home-start'));
  await waitTop(page, 'write');
  w = await writeView(page);
  assert.deepEqual([w.slot, w.cursor, w.phase], ['B', 1, 'recall'], 'main entry resumes B on 中');
  await toHome(page);

  step('all localStorage writes went through storage.js');
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct'));
  assert.deepEqual(direct, [], 'no direct localStorage writes');
}
