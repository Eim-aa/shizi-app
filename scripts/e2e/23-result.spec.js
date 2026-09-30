// 结束这组与结果页（02 M2-3；决定-D19 / D20 / D22；04 R-R01–R-R07、R-W11、R-W15；03 P14 / P62；边改 S04 / S05）。
//
//   1. 最后一字处理完直接进结果页、没有中间页（逐帧采样：写字页空占位 write-empty 一帧都没画出来）——
//      判断（compare）/ 看答案页「下一个」（answer）/ 描一遍「下一个」（trace）/ 自己写「下一个」（retrace）/
//      看过答案后回忆阶段的「下一个」（恢复路径，recall）/ 跳过（recall）；会话移入 lastEnded。
//   2. 跳过最后一字 → 结果页上撤销底栏仍可用（3 秒内）→ 撤销回到写字页那个字。
//   3. 从首页「自己选字」开 B → 写一字 → 结束这组（S04 主按钮「接着写」、无预选；接着写不动会话）→ 先写到这里 → 回到首页。
//   4. 零判断结束 → 回来源 + 轻提示「这组结束了，没有记下字。」；结束写入失败留在确认框，重试成功后结束。
//   5. 钩子 seed 来源 wrongList / forgetList / detail 的 B：离开按钮文案（R-R06）与来源说明（S05）；离开回到下面的来源页。
//   6. 结果页修改判断：不增加记录、corrections 追加、格子与数字按记录更新；看过答案 / 跳过的格子只看不改；修改失败可重试。
//   7. 停在结果页刷新 → 由 lastEnded 恢复；「再写一组」→ 新的今天的练习（结果页出栈，不叠页）；第一次练习结果页。

import {
  bootTestHost, drawStroke, HORIZONTAL, PRESS_SETTLE_MS, tid, topSel, waitNavIdle,
} from './helpers.mjs';

const SHEET = '[data-testid="query-sheet"]';
const inSheet = id => `${SHEET} ${tid(id)}`;

async function evalIn(page, fn, arg) {
  return page.evaluate(fn, arg);
}

/** 造一组（真实 mutator：judgeInDraft / skipInDraft / answer-seen + advance）并 seed；steps 之后 cursor 停在下一字。 */
async function seedGroup(page, o) {
  const res = await evalIn(page, async opts => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { skipInDraft } = await import('/src/ui/screens/write/skip.js');
    const { appendRecordToDraft } = await import('/src/ui/screens/write/answer.js');
    const { makeRecord } = await import('/src/core/records.js');
    const { advance, createSession } = await import('/src/core/sessions.js');
    const slot = opts.kind === 'picked' ? 'B' : 'A';
    const now = window.__shiziTest.now();
    const s = createSession({ id: opts.id || 's40', kind: opts.kind, source: opts.source, queue: opts.chars.map(c => 'base:' + c), at: now });
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    if (opts.other) draft.sessions[opts.other.slot] = opts.other.session;
    draft.sessions[slot] = s;
    let n = 100;
    const nextId = p => p + (n += 1);
    const stroke = [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]];
    (opts.steps || []).forEach((step, i) => {
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
    if (opts.current) {
      const cur = draft.sessions[slot];
      if (opts.current.answerSeen) {
        const key = cur.queue[cur.cursor];
        appendRecordToDraft(draft, makeRecord({ id: nextId('r'), cardKey: key, sessionId: cur.id, kind: 'answer-seen', at: now - 1000, help: { hints: 0, answerSeen: true, traced: false } }));
      }
      draft.sessions[slot] = { ...cur, current: { ...cur.current, ...opts.current } };
    }
    window.__shiziTest.reset();
    const r = window.__shiziTest.seed(draft);
    return { ok: !!(r && r.ok), r, slot };
  }, o);
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
  return res;
}

async function goHome(page) {
  await evalIn(page, async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.switchTab('home');
  });
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
}

async function openWriteSlot(page, slot) {
  await evalIn(page, async s => {
    const { openWrite } = await import('/src/ui/screens/session/index.js');
    openWrite(s);
  }, slot);
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
}

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!top && top.dataset.phase === p;
  }, phase);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

/** 逐帧采样顶层页面与写字页空占位（「无中间页」）。 */
async function startFrames(page) {
  await evalIn(page, () => {
    window.__frames = [];
    window.__framesOn = true;
    const tick = () => {
      const app = document.querySelector('.sz-app');
      const top = document.querySelector('.sz-layer[data-top="true"]');
      window.__frames.push({ screen: app ? app.dataset.topScreen : null, empty: !!(top && top.querySelector('[data-testid="write-empty"]')) });
      if (window.__framesOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrames(page) {
  return evalIn(page, () => {
    window.__framesOn = false;
    const seq = [];
    for (const f of window.__frames) if (seq[seq.length - 1] !== f.screen) seq.push(f.screen);
    return { seq, empty: window.__frames.filter(f => f.empty).length, n: window.__frames.length };
  });
}

async function waitResult(page) {
  await page.waitForSelector(topSel('result-screen'));
}

async function state(page) {
  return evalIn(page, () => {
    const st = window.__shiziTest.getState();
    const records = [];
    for (const v of Object.values(st.records || {})) for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    return { sessions: st.sessions, records, sched: st.sched || {} };
  });
}

async function resultView(page) {
  return evalIn(page, () => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => (top ? top.querySelector(`[data-testid="${id}"]`) : null);
    const txt = id => (q(id) ? q(id).textContent.trim() : null);
    const body = q('result-body');
    return {
      header: top && top.querySelector('[data-page-title]') ? top.querySelector('[data-page-title]').textContent.trim() : null,
      variant: body ? body.dataset.variant : null,
      early: body ? body.dataset.early : null,
      kicker: txt('result-kicker'),
      title: txt('result-title'),
      sub: txt('result-sub'),
      date: txt('result-date'),
      again: txt('result-again'),
      leave: txt('result-leave'),
      imageNote: txt('result-image-note'),
      remindSlot: !!q('result-remind-slot'),
      footButtons: top ? [...top.querySelectorAll('.sz-page__foot button')].map(b => b.dataset.testid) : [],
      cells: top ? [...top.querySelectorAll('[data-testid="result-cell"]')].map(c => ({
        kind: c.dataset.kind, judgment: c.dataset.judgment, changeable: c.dataset.changeable,
        char: c.querySelector('[data-testid="result-cell-char"]').textContent, caption: c.querySelector('[data-testid="result-cell-caption"]').textContent,
        aria: c.getAttribute('aria-label'),
      })) : [],
    };
  });
}

async function writeAndJudge(page, judgment = 'correct') {
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await waitPhase(page, 'compare');
  await page.click(topSel(`write-judge-${judgment}`));
}

async function openAnswer(page) {
  await page.click(topSel('write-show-answer'));
  await page.waitForSelector(tid('write-answer-confirm'));
  await waitNavIdle(page);
  await page.click(tid('confirm-ok'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-answer-confirm"]'));
  await waitPhase(page, 'answer');
}

async function toastText(page) {
  const el = await page.$(tid('toast'));
  return el ? (await el.textContent()).trim() : null;
}

export default async function resultSpec(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // ------------------------------------------------------------------ 1. 最后一字 → 结果页（各阶段）
  const lastPaths = [
    { name: 'compare: 写对了', act: async () => writeAndJudge(page, 'correct'), kind: 'judged' },
    { name: 'answer: bottom 下一个', act: async () => { await openAnswer(page); await page.click(topSel('write-answer-next')); }, kind: 'answer-seen' },
    {
      name: 'trace: bottom 下一个',
      act: async () => { await openAnswer(page); await page.click(topSel('write-answer-trace')); await waitPhase(page, 'trace'); await page.click(topSel('write-answer-next')); },
      kind: 'answer-seen',
    },
    {
      name: 'retrace: 下一个',
      act: async () => { await openAnswer(page); await page.click(topSel('write-answer-self')); await waitPhase(page, 'retrace'); await page.click(topSel('write-answer-next')); },
      kind: 'answer-seen',
    },
    { name: 'recall after answer seen (restore path): 下一个', current: { answerSeen: true, phase: 'recall' }, act: async () => page.click(topSel('write-answer-next')), kind: 'answer-seen' },
    { name: 'recall: 跳过', act: async () => page.click(topSel('write-skip')), kind: 'skipped' },
  ];
  for (const p of lastPaths) {
    step(`last character via ${p.name} → result page directly, no intermediate page (D20 / R-W11)`);
    await goHome(page);
    await seedGroup(page, { kind: 'daily', chars: ['永', '和'], steps: ['correct'], current: p.current });
    await openWriteSlot(page, 'A');
    await startFrames(page);
    await p.act();
    await waitResult(page);
    await page.waitForTimeout(120);
    const frames = await stopFrames(page);
    assert.deepEqual(frames.seq.slice(-2), ['write', 'result'], `top screen went write → result (${frames.n} frames)`);
    assert.equal(frames.empty, 0, 'the empty write placeholder was never painted');
    const st = await state(page);
    assert.ok(!st.sessions.A && st.sessions.lastEnded.A && st.sessions.lastEnded.A.id === 's40', 'session moved to lastEnded.A');
    const v = await resultView(page);
    assert.deepEqual(v.cells.map(c => c.kind), ['judged', p.kind], `cells [judged, ${p.kind}]`);
    assert.deepEqual(v.cells.map(c => c.aria), ['永 · 写对', `和 · ${{ judged: '写对', skipped: '跳过', 'answer-seen': '看过答案' }[p.kind]}`], 'H3: cell accessible names');
    assert.equal(v.header, '这次练习', 'daily header 这次练习');
  }

  step('last character skipped → the undo bar is still usable on the result page; 撤销 → back to that character');
  await goHome(page);
  await seedGroup(page, { kind: 'daily', chars: ['永', '和'], steps: ['correct'] });
  await openWriteSlot(page, 'A');
  await page.click(topSel('write-skip'));
  await waitResult(page);
  assert.equal((await page.locator(topSel('write-skip-undo-text')).textContent()).trim(), '已跳过「和」', 'bar 已跳过「和」 on the result page');
  await waitNavIdle(page);
  await page.click(topSel('write-skip-undo-btn'));
  await page.waitForSelector(topSel('write-screen'));
  let st = await state(page);
  assert.deepEqual([st.sessions.A && st.sessions.A.cursor, !!st.sessions.lastEnded.A, st.records.filter(r => r.kind === 'skipped').length], [1, false, 0],
    'back on 和 (cursor 1), not ended, skip removed');

  // ------------------------------------------------------------------ 3. 首页自己选字开 B → 结束这组 → 回到首页
  step('home 自己选字 → B [永和春]; write 永; 结束这组 → S04 (主按钮 接着写, no preselection); 接着写 leaves B untouched');
  await goHome(page);
  await evalIn(page, () => window.__shiziTest.reset());
  await goHome(page);
  await page.click(tid('home-pick'));
  await page.waitForSelector(inSheet('query-input'));
  await waitNavIdle(page);
  await page.locator(inSheet('query-input')).fill('永和春');
  for (const c of ['永', '和', '春']) {
    await page.locator(`${SHEET} [data-testid="query-row"][data-char="${c}"] [data-testid="query-row-select"]`).click();
  }
  await page.locator(inSheet('query-go')).click();
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  st = await state(page);
  assert.ok(st.sessions.B && st.sessions.B.kind === 'picked' && st.sessions.B.queue.length === 3, 'B opened with 3 characters');
  assert.equal(await page.locator(topSel('write-end')).count(), 1, '结束这组 shown in a picked group');
  await writeAndJudge(page, 'correct');
  await waitPhase(page, 'recall');
  const beforeEnd = (await state(page)).sessions.B;
  await page.click(topSel('write-end'));
  await page.waitForSelector(tid('write-end-dialog'));
  await waitNavIdle(page);
  const dlg = await evalIn(page, () => {
    const d = document.querySelector('[data-testid="write-end-dialog"]');
    const btns = [...d.querySelectorAll('button')];
    return {
      body: d.querySelector('[data-testid="write-end-body"]').textContent,
      buttons: btns.map(b => [b.dataset.testid, b.className.includes('sz-btn--primary') ? 'primary' : 'other']),
      active: document.activeElement === d,
      pressed: btns.some(b => b.hasAttribute('aria-pressed')),
    };
  });
  assert.equal(dlg.body, '还有 2 个字没写，结束后就不写了。判断过的 1 个字已经记下。', 'S04 body (R-W15) with n=2, m=1');
  assert.deepEqual(dlg.buttons, [['write-end-confirm', 'other'], ['write-end-continue', 'primary']], 'S04: 接着写 is the primary button, 结束这组 a normal one');
  assert.ok(dlg.active && !dlg.pressed, 'focus on the dialog itself, no preselected button');
  await page.click(tid('write-end-continue'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-end-dialog"]'));
  await waitNavIdle(page);
  assert.deepEqual((await state(page)).sessions.B, beforeEnd, '接着写: B deep-equal, nothing written');

  step('结束这组 → result 这次选的字 / 先写到这里 → 回到首页 (tab root), lastEnded cleared');
  await page.click(topSel('write-end'));
  await page.waitForSelector(tid('write-end-dialog'));
  await waitNavIdle(page);
  await page.click(tid('write-end-confirm'));
  await waitResult(page);
  await waitNavIdle(page);
  let v = await resultView(page);
  assert.deepEqual([v.header, v.variant, v.early, v.kicker], ['这次选的字', 'picked', 'true', '这次选的字'], 'picked result, ended early');
  assert.ok(v.title.endsWith('先写到这里'), 'title 这次选的字 / 先写到这里 (P14)');
  assert.equal(v.sub, '「永」记下了。还有 2 个字没写，没有记下。点一个格子，可以对照参考字形、修改判断。', 'R-R05 body');
  assert.ok(/^\d+ 月 \d+ 日 · 自己选的$/.test(v.date), `S05 date line ${v.date}`);
  assert.deepEqual([v.leave, v.footButtons], ['回到首页', ['result-leave']], 'only the leave button: 回到首页');
  st = await state(page);
  assert.ok(!st.sessions.B && st.sessions.lastEnded.B && st.sessions.lastEnded.B.endedEarly === true, 'B ended early into lastEnded.B');
  await page.click(topSel('result-leave'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
  const depth = await evalIn(page, async () => (await import('/src/ui/router.js')).getRouter().getState().depth);
  assert.equal(depth, 0, 'back at the home tab root');
  st = await state(page);
  assert.equal(st.sessions.lastEnded.B, undefined, 'lastEnded.B cleared after leaving the result page');

  // ------------------------------------------------------------------ 4. 零判断 / 失败
  step('zero judged: 结束这组 → back to the source + toast 这组结束了，没有记下字。');
  await seedGroup(page, { kind: 'picked', chars: ['额', '鲜'], steps: ['skip'] });
  await openWriteSlot(page, 'B');
  await page.click(topSel('write-end'));
  await page.waitForSelector(tid('write-end-dialog'));
  await waitNavIdle(page);
  assert.equal((await page.locator(tid('write-end-body')).textContent()), '还有 1 个字没写，结束后就不写了。判断过的 0 个字已经记下。', 'S04 body with m=0');
  await page.click(tid('write-end-confirm'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  assert.equal(await toastText(page), '这组结束了，没有记下字。', 'zero-judged toast (R-W15 / D22)');
  st = await state(page);
  assert.ok(!st.sessions.B && st.sessions.lastEnded.B.endedEarly, 'B ended');
  await waitNavIdle(page);

  step('H4: 结束这组 shown in answer / trace / retrace, hidden on the judge page; ending from the answer page with 0 judged → back + toast');
  await seedGroup(page, { kind: 'picked', chars: ['额', '鲜', '境'], steps: [] });
  await openWriteSlot(page, 'B');
  const endVisible = async () => {
    const el = page.locator(topSel('write-end'));
    return (await el.count()) === 1 && el.isVisible();
  };
  const endInAnswerFoot = async () => evalIn(page, () => {
    const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-end"]');
    return !!b && !!b.closest('[data-testid="write-answer-foot"]');
  });
  await openAnswer(page);
  assert.ok(await endVisible(), 'answer: 结束这组 visible');
  assert.ok(await endInAnswerFoot(), 'answer: 结束这组 lives in the answer footer (下一个 row)');
  await page.click(topSel('write-answer-trace'));
  await waitPhase(page, 'trace');
  assert.ok(await endVisible(), 'trace: 结束这组 visible');
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel('write-trace-done'));
  await waitPhase(page, 'retrace');
  assert.ok(await endVisible(), 'retrace: 结束这组 visible');
  await page.click(topSel('write-answer-next'));
  await page.waitForFunction(() => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && w.dataset.cursor === '1' && w.dataset.phase === 'recall';
  });
  await waitNavIdle(page);
  assert.ok(await endVisible(), 'recall (next char): 结束这组 visible');
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await waitPhase(page, 'compare');
  assert.equal(await page.locator(topSel('write-end')).count(), 0, 'compare (judge page): no 结束这组');
  await page.click(topSel('write-continue'));
  await waitPhase(page, 'recall');
  await openAnswer(page);
  await page.click(topSel('write-end'));
  await page.waitForSelector(tid('write-end-dialog'));
  await waitNavIdle(page);
  assert.equal(await page.locator(tid('write-end-body')).textContent(), '还有 2 个字没写，结束后就不写了。判断过的 0 个字已经记下。',
    'S04 body from the answer page: n = 2 (current included), m = 0 (看过答案不算判断)');
  await page.click(tid('write-end-confirm'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  assert.equal(await toastText(page), '这组结束了，没有记下字。', 'H4: zero-judged toast after ending from the answer page');
  st = await state(page);
  assert.ok(!st.sessions.B && st.sessions.lastEnded.B && st.sessions.lastEnded.B.endedEarly, 'B ended early');
  assert.equal(st.records.filter(r => r.kind === 'judged').length, 0, 'no judged record written by ending');
  await waitNavIdle(page);

  step('结束 write fails → stays in the dialog (三段式), B untouched; 再试一次 → ends');
  await seedGroup(page, { kind: 'picked', chars: ['额', '鲜', '境'], steps: ['correct'] });
  await openWriteSlot(page, 'B');
  const beforeFail = (await state(page)).sessions.B;
  await page.click(topSel('write-end'));
  await page.waitForSelector(tid('write-end-dialog'));
  await waitNavIdle(page);
  await evalIn(page, () => window.__shiziTest.failNextWrite(1));
  await page.click(tid('write-end-confirm'));
  await page.waitForSelector('[data-testid="write-end-dialog"][data-state="failed"]');
  assert.equal(await page.locator(tid('write-end-body')).textContent(), '没保存上，你写的字还在。', 'failure body R-W16');
  assert.deepEqual((await state(page)).sessions.B, beforeFail, 'B untouched after the failed write');
  await waitNavIdle(page);
  await page.click(tid('write-end-retry'));
  await waitResult(page);
  st = await state(page);
  assert.ok(!st.sessions.B && st.sessions.lastEnded.B.endedEarly, 'retry ended the group');
  await waitNavIdle(page);

  // ------------------------------------------------------------------ 5. 来源（R-R06 / S05）
  const sources = [
    { source: { view: 'wrongList' }, leave: '回到写错过', from: '从写错过' },
    { source: { view: 'forgetList' }, leave: '回到快忘了', from: '从快忘了' },
    { source: { view: 'detail', char: '额' }, leave: '回到「额」', from: '自己选的' },
  ];
  for (const s of sources) {
    step(`seeded B with source ${s.source.view}: leave button 「${s.leave}」, source line 「${s.from}」; leave → back to the page below`);
    await goHome(page);
    await seedGroup(page, { kind: 'picked', chars: ['额', '鲜'], steps: ['correct'], source: s.source });
    await openWriteSlot(page, 'B');
    await writeAndJudge(page, 'wrong');
    await waitResult(page);
    await waitNavIdle(page);
    v = await resultView(page);
    assert.equal(v.leave, s.leave, `R-R06 leave ${s.leave}`);
    assert.ok(v.date && v.date.endsWith(`· ${s.from}`), `S05 source line ${v.date}`);
    assert.ok(v.title.endsWith('写完了'), 'completed picked group: 这次选的字 / 写完了');
    await page.click(topSel('result-leave'));
    await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
    await waitNavIdle(page);
  }

  // ------------------------------------------------------------------ 6. 结果页修改判断
  step('result page: 3 cells (judged / seen / judged); tap judged → R-R02 sheet; 改为写错 → same record, no new record');
  await goHome(page);
  await seedGroup(page, { kind: 'daily', chars: ['永', '和', '春'], steps: ['correct', 'seen'] });
  await openWriteSlot(page, 'A');
  await writeAndJudge(page, 'correct');
  await waitResult(page);
  await waitNavIdle(page);
  v = await resultView(page);
  assert.equal(v.title, '这次记录了 2 个字', 'R-R01 title by records');
  assert.equal(v.sub, '「和」看过答案，没算在内。点一个格子，可以对照参考字形、修改判断。', 'P62 only-seen sentence + grid hint');
  assert.deepEqual(v.cells.map(c => [c.char, c.caption, c.changeable]), [['永', '写对', 'true'], ['和', '看过答案', 'false'], ['春', '写对', 'true']], 'cells');
  assert.deepEqual(v.cells.map(c => c.aria), ['永 · 写对', '和 · 看过答案', '春 · 写对'], 'H3: every cell button has an accessible name 「字 · 标签」');
  assert.equal(v.imageNote, '这次记下的字都没有留下笔迹，不能保存本次练习图片；本月图片仍可到练习记录保存。', 'R-R07 all-missing note (perRecordInk off)');
  assert.deepEqual([v.again, v.leave], ['再写一组', '回到首页'], 'daily footer 再写一组 + 回到首页');
  const inkCells = await evalIn(page, () => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="result-cell"]')].map(c => {
    const cv = c.querySelector('[data-testid="result-cell-ink"] canvas');
    let painted = 0;
    if (cv && cv.width) {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted += 1;
    }
    return { ink: !!cv, painted: painted > 0, noink: !!c.querySelector('[data-testid="result-cell-noink"]') };
  }));
  assert.deepEqual(inkCells, [{ ink: false, painted: false, noink: true }, { ink: false, painted: false, noink: false }, { ink: true, painted: true, noink: false }],
    'cells: seeded 永 has no ink (没有笔迹, 10.12); 和 seen glyph; 春 just written shows the learner\'s ink');
  const before = await state(page);
  await page.click(`${topSel('result-cell')}[data-index="0"]`);
  await page.waitForSelector(tid('result-sheet'));
  await waitNavIdle(page);
  const sheet = await evalIn(page, () => {
    const s = document.querySelector('[data-testid="result-sheet"]');
    const q = id => s.querySelector(`[data-testid="${id}"]`);
    return { title: s.querySelector('.sz-sheet__title').textContent, close: q('result-sheet-close').textContent.trim(), note: q('result-sheet-note').textContent, flip: q('result-sheet-flip') ? q('result-sheet-flip').textContent.trim() : null };
  });
  assert.deepEqual(sheet, { title: '「永」这次记为写对', close: '取消', note: '改了只换掉这一次，不会多算一次。', flip: '改为写错' }, 'R-R02 judged sheet');
  await page.click(tid('result-sheet-flip'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  await waitNavIdle(page);
  st = await state(page);
  assert.equal(st.records.length, before.records.length, 'no record added by the correction');
  const yong = st.records.find(r => r.char === '永' && r.kind === 'judged');
  assert.deepEqual([yong.judgment, yong.corrections.length, yong.corrections[0].from], ['wrong', 1, 'correct'], 'same record: judgment wrong, one correction');
  assert.ok(st.sched['base:永'].due !== before.sched['base:永'].due, `sched replayed (due ${before.sched['base:永'].due} → ${st.sched['base:永'].due})`);
  v = await resultView(page);
  assert.deepEqual([v.cells[0].caption, v.cells[0].judgment, v.title], ['写错', 'wrong', '这次记录了 2 个字'], 'cell shows 写错; count unchanged');
  assert.equal(v.cells[0].aria, '永 · 写错', 'H3: the accessible name follows the corrected judgment');

  step('seen cell → sheet without 改为…, 关闭; correction failure → 没改成 + retry');
  await page.click(`${topSel('result-cell')}[data-index="1"]`);
  await page.waitForSelector(tid('result-sheet'));
  await waitNavIdle(page);
  const seenSheet = await evalIn(page, () => {
    const s = document.querySelector('[data-testid="result-sheet"]');
    return { title: s.querySelector('.sz-sheet__title').textContent, close: s.querySelector('[data-testid="result-sheet-close"]').textContent.trim(),
      note: s.querySelector('[data-testid="result-sheet-note"]').textContent, flip: !!s.querySelector('[data-testid="result-sheet-flip"]'),
      noink: s.querySelector('[data-testid="result-sheet-noink"]') ? s.querySelector('[data-testid="result-sheet-noink"]').textContent : null };
  });
  assert.deepEqual(seenSheet, { title: '「和」看过答案', close: '关闭', note: '看过答案的字不判断对错，没算在内。', flip: false, noink: '这次没写' }, 'R-R02 seen sheet (P15 这次没写)');
  await page.click(tid('result-sheet-close'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  await waitNavIdle(page);
  await page.click(`${topSel('result-cell')}[data-index="2"]`);
  await page.waitForSelector(tid('result-sheet'));
  await waitNavIdle(page);
  await evalIn(page, () => window.__shiziTest.failNextWrite(1));
  await page.click(tid('result-sheet-flip'));
  await page.waitForSelector(tid('result-sheet-fail-retry'));
  assert.equal(await page.locator(tid('result-sheet-note')).textContent(), '没改成，还是原来的判断。', 'failure note R-W10');
  st = await state(page);
  assert.equal(st.records.find(r => r.char === '春' && r.kind === 'judged').judgment, 'correct', 'unchanged after the failure');
  await waitNavIdle(page);
  await page.click(tid('result-sheet-fail-retry'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="result-sheet"]'));
  st = await state(page);
  assert.equal(st.records.find(r => r.char === '春' && r.kind === 'judged').judgment, 'wrong', 'retry changed it');
  assert.equal(st.records.length, before.records.length, 'still no record added');

  // ------------------------------------------------------------------ 7. 刷新 / 再写一组 / 第一次
  step('reload on the result page → restored from lastEnded');
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitResult(page);
  await waitNavIdle(page);
  v = await resultView(page);
  assert.deepEqual([v.title, v.cells.length, v.cells[2].caption], ['这次记录了 2 个字', 3, '写错'], 'same result after reload');

  step('再写一组 → a new 今天的练习 on the write page; the result page left the stack (no stacking)');
  await page.click(topSel('result-again'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'write');
  await waitNavIdle(page);
  const nav = await evalIn(page, async () => {
    const snap = (await import('/src/ui/router.js')).getRouter().getState();
    return { depth: snap.depth, names: snap.stack.map(e => e.n) };
  });
  assert.deepEqual(nav, { depth: 1, names: ['home', 'write'] }, 'stack home → write');
  st = await state(page);
  assert.ok(st.sessions.A && st.sessions.A.id !== 's40' && st.sessions.A.kind === 'daily', 'new daily group in A');
  assert.equal(st.sessions.lastEnded.A, undefined, 'old lastEnded.A cleared');

  step('第一次练习 result: header 第一次练习, date-only line, 5 columns, only 回到首页, remind slot');
  await goHome(page);
  await seedGroup(page, { kind: 'first', chars: ['尴', '嚏', '狩', '晤', '飓'], steps: ['correct', 'wrong', 'seen', 'skip'] });
  await openWriteSlot(page, 'A');
  await writeAndJudge(page, 'correct');
  await waitResult(page);
  await waitNavIdle(page);
  v = await resultView(page);
  assert.deepEqual([v.header, v.variant, v.title], ['第一次练习', 'first', '这次记录了 3 个字'], 'first result');
  assert.ok(/^\d+ 月 \d+ 日$/.test(v.date), `R-R03 date only: ${v.date}`);
  assert.deepEqual(v.footButtons, ['result-leave'], 'only 回到首页');
  assert.equal(v.remindSlot, true, 'remind invitation slot (placeholder until M5-5)');
  const cols = await page.getAttribute(topSel('result-grid'), 'data-cols');
  assert.equal(cols, '5', '5 columns');
  await page.click(topSel('result-leave'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);

  step('all localStorage writes went through storage.js');
  const direct = await evalIn(page, () => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct'));
  assert.deepEqual(direct, [], 'no direct localStorage writes');
}
