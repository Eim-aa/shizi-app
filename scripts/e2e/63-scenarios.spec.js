// 场景回归与各里程碑遗留（02 §8 M6「场景回归」「M5 遗留」「M3/M4 遗留」；§8.1 场景映射表；
// docs/product/03-interaction-handoff-checklist.md 连续场景 1–10；foundation/03 §6 关键反例 1–8）。
//
// 本 spec 只补 M1–M5 没有「连续」走过的场景与反例（其余条目指向首次覆盖的 spec，见 acceptance/checklist-M6.md 与 M6-6 报告）：
//   1. 场景 1：首次开始 → 写一笔 → 不判断直接返回（没有记录、没有有效尝试、不要求做完）→ 续写 → 判断 → 返回（1 条 judged、
//      今天记录了 1 个字、组还在、没有结果页）。
//   2. 场景 2 + 反例 2：提示 → 写 → 看答案 → 描一遍 → 自己写 → 下一个（answer-seen 一条，help 三项分开记；本人笔迹 / 参考 /
//      帮助不混）；下一字 提示 → 写 → 判断（judged，help.hints=1）；没落笔就看答案 / 描一遍 / 跳过都不算有效尝试。
//   3. 场景 4（+ 场景 3 的「原现场不动」）：A 有未判笔迹与提示时开临时组 B → 零判断结束 → 重新选组 → 部分判断后结束（结束写入失败
//      留在确认框、重试成功）→ 再开 B 写一笔未判 → 首页「自己选字」再开一组 → S02 保护 B，不覆盖；A 全程深相等。
//   4. 场景 5：自己选字不预选、勾选后取消零写入、再打开不记得勾选；明确开始才有 B、自选的字不变；B 没写完时只读查字零写入、不弹 S02。
//   5. 反例 6（重复点击 / 晚到响应）：同一个判断键、跳过键、「结束这组」同一帧点两次 → 只记一次、只推进一次。
//   6. 遗留：跨天作废回首页（写字页开着，日期变了、回前台 → 今天的练习作废 → 回首页；判断过的记录保留；自选组不过期，P61）。
//   7. 遗留：写字页其它本地状态接 epoch（判断页本地阶段、跳过撤销底栏、写失败提示、未写回的本地笔画在 store 整体替换后都按新状态重来，
//      旧本体卸载时不把替换前的现场写回）。
//   8. 遗留：清空所有记录一并清 sessions.lastEnded（替换见 42-backup），撤销后会话与全部 v2 键深相等。
//   9. 遗留：桥错误回调 shiziShareFailed（P96 过渡）：假原生通道下备份导出发 shareBackup，原生回报失败 → 轻提示、不记导出；
//      图片 / 地址 / 未知三种 kind 的提示句。
// 控制台零错误由 run.mjs 统一断言；全程无绕过 storage.js 的写入。

import { markFirstPracticeDone } from './home-helpers.mjs';
import { bootTestHost, drawStroke, HORIZONTAL, installNativeStub, makeSession, nativeMessages, noToastFor, PRESS_SETTLE_MS, tid, topSel, VERTICAL, waitNavIdle, writeSnapshot, setTextSize, LARGE_TEXT, leaveResult, tap } from './helpers.mjs';

const CLOCK = '2026-09-24T20:00:00';
const SHEET = '[data-testid="query-sheet"]';
const inSheet = id => `${SHEET} ${tid(id)}`;
const S = v => JSON.stringify(v);

// ---------------------------------------------------------------- 取状态

async function facts(page) {
  return page.evaluate(async () => {
    const { todayCount, judgedCardKeysOn } = await import('/src/core/records.js');
    const st = window.__shiziTest.getState();
    const records = [];
    for (const m of Object.keys(st.records || {})) {
      const v = st.records[m];
      for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    }
    records.sort((a, b) => a.at - b.at);
    const d = new Date(window.__shiziTest.now());
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      records,
      sessions: st.sessions,
      todayN: todayCount(records, today),
      judgedToday: [...judgedCardKeysOn(records, today)],
      sched: st.sched,
      ink: st.ink,
      custom: st.custom,
      backupMeta: st.backupMeta,
    };
  });
}

async function copy(page, key, vars) {
  return page.evaluate(async ({ k, v }) => (await import('/src/config/copy/index.js')).t(k, v), { k: key, v: vars || null });
}

async function topScreen(page) {
  return page.evaluate(() => document.querySelector('.sz-app').dataset.topScreen);
}

async function waitTop(page, screen) {
  await page.waitForFunction(s => document.querySelector('.sz-app').dataset.topScreen === s, screen, { timeout: 15000 });
  await waitNavIdle(page);
}

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && w.dataset.phase === p;
  }, phase);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function waitCursor(page, n) {
  await page.waitForFunction(c => {
    const w = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!w && Number(w.dataset.cursor) === c;
  }, n);
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function logLen(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog().length);
}

async function writesSince(page, n) {
  return page.evaluate(k => window.__shiziTest.getWriteLog().slice(k).filter(e => e.op !== 'get').map(e => e.key), n);
}

async function rawKeys(page) {
  return page.evaluate(() => window.__shiziTest.getRawKeys('shizi.v2.'));
}

async function toastText(page) {
  const el = await page.$(tid('toast'));
  return el ? (await el.textContent()).trim() : null;
}

async function waitToast(page, text) {
  await page.waitForFunction(x => {
    const el = document.querySelector('[data-testid="toast"]');
    return !!el && el.textContent.trim() === x;
  }, text, { timeout: 5000 });
}

async function resetAt(page, iso = CLOCK) {
  await page.evaluate(i => {
    window.__shiziTest.reset();
    window.__shiziTest.setClock(i);
  }, iso);
}

async function seed(page, state) {
  const r = await page.evaluate(s => window.__shiziTest.seed(s), state);
  if (!r || !r.ok) throw new Error(`seed failed: ${S(r)}`);
}

async function now(page) {
  return page.evaluate(() => window.__shiziTest.now());
}

async function toHome(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await waitTop(page, 'home');
}

async function backToHome(page) {
  await page.click(topSel('page-back'));
  await waitTop(page, 'home');
}

async function openSlot(page, slot) {
  await page.evaluate(async s => (await import('/src/ui/screens/session/index.js')).openWrite(s), slot);
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
}

async function homeView(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => (top ? top.querySelector(`[data-testid="${id}"]`) : null);
    const home = q('screen-home');
    return {
      records: home ? home.dataset.records : null,
      resume: home ? home.dataset.resume : null,
      // H2（D55）：首页不再画进行中的格子与计数，剩余字数由会话状态（facts）断言
    };
  });
}

/** 写好了 → 判断页 → 点判断键 → 等下一字（或结果页）。 */
async function judge(page, judgment, { nextCursor = null } = {}) {
  await page.click(topSel('write-done'));
  await waitPhase(page, 'compare');
  await page.click(topSel(`write-judge-${judgment}`));
  if (nextCursor !== null) await waitCursor(page, nextCursor);
}

/** 点「看答案」：直接进描一遍（D64 ②）。 */
async function openAnswer(page) {
  await tap(page, 'write-show-answer');
  await waitPhase(page, 'trace');
}

async function openPickSheet(page) {
  await page.click(topSel('home-pick'));
  await page.waitForSelector(inSheet('query-input'));
  await waitNavIdle(page);
}

async function closeSheet(page) {
  await page.evaluate(() => history.back());
  await page.waitForSelector(SHEET, { state: 'detached' });
  await waitNavIdle(page);
}

async function sheetRows(page) {
  return page.evaluate(sel => [...document.querySelectorAll(`${sel} [data-testid="query-row"]`)].map(r => ({
    char: r.dataset.char,
    selected: r.dataset.selected || null,
    checked: r.querySelector('[data-testid="query-row-select"]') ? r.querySelector('[data-testid="query-row-select"]').getAttribute('aria-checked') : null,
  })), SHEET);
}

async function typeInSheet(page, text) {
  const input = page.locator(inSheet('query-input'));
  await input.fill('');
  if (text) await input.fill(text);
  await page.waitForTimeout(80);
}

/** 本页面会话里造一个 A（今天的练习）并带本人笔画、提示次数。 */
async function seedAWithInk(page, chars, { strokes = 2, hints = 1, id = 's600' } = {}) {
  return page.evaluate(async ({ chars: cs, n, h, sid }) => {
    const { encodeRawStrokes } = await import('/src/core/ink-math.js');
    const { createSession } = await import('/src/core/sessions.js');
    const at = window.__shiziTest.now() - 60000;
    const raw = [
      [{ x: 60, y: 120, t: 0 }, { x: 170, y: 121, t: 60 }, { x: 280, y: 122, t: 120 }],
      [{ x: 172, y: 60, t: 400 }, { x: 173, y: 170, t: 460 }, { x: 174, y: 290, t: 520 }],
    ].slice(0, n);
    const s = createSession({ id: sid, kind: 'daily', source: { view: 'home' }, queue: cs.map(c => 'base:' + c), at });
    const A = { ...s, current: { ...s.current, strokes: encodeRawStrokes(raw), hints: h, hintRange: null } };
    const r = window.__shiziTest.seed({ sessions: { A, B: null, lastEnded: {} } });
    return { ok: !!(r && r.ok), A: window.__shiziTest.getState().sessions.A };
  }, { chars, n: strokes, h: hints, sid: id });
}

async function startPicked(page, chars) {
  const r = await page.evaluate(async cs => {
    const m = await import('/src/ui/screens/session/index.js');
    const res = m.startPicked(cs, { source: { view: 'home' } });
    return res && typeof res === 'object' ? { ok: res.ok !== false, s02: !!res.s02, opened: !!res.opened } : { ok: !!res };
  }, chars);
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  return r;
}

async function endGroup(page) {
  await tap(page, 'write-end');
  await page.waitForSelector(tid('write-end-dialog'));
  await waitNavIdle(page);
}

// ================================================================= spec

export default async function run(page, ctx) {
  const { assert, step } = ctx;
  await bootTestHost(page, ctx.baseURL);

  // --------------------------------------------------------------- 1. 场景 1
  step('场景 1: first start → one stroke → back without judging → no record, no valid attempt, group not forced');
  await resetAt(page);
  await waitNavIdle(page);
  let h = await homeView(page);
  assert.equal(h.records, 'first', 'home starts in the first-visit state');
  await page.click(topSel('home-start'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  let f = await facts(page);
  assert.equal(f.sessions.A && f.sessions.A.kind, 'first', 'main entry opened the first practice (A, kind first)');
  const firstQueue = f.sessions.A.queue.slice();
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(150);
  await backToHome(page);
  f = await facts(page);
  assert.equal(f.records.length, 0, 'returning without judging writes no record at all');
  assert.equal(f.todayN, 0, 'today N stays 0');
  assert.equal(f.sessions.A.current.strokes.length, 1, 'the unjudged stroke is kept in the session (resume later)');
  assert.equal(await noToastFor(page), true, 'no toast within 1.5s of coming back (R4-F1 / P262)');
  h = await homeView(page);
  assert.deepEqual([h.records, h.resume], ['first', 'A'], 'home: still first-visit records state, resume A');
  assert.equal(f.sessions.A.queue.length - f.sessions.A.cursor, 3, 'the group still has all 3 chars to write (the home no longer draws the count, D55)');

  step('场景 1: resume → same char with its stroke → judge → back: one judged record, 今天的 N = 1, group stays open');
  await page.click(topSel('home-start'));
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  let w = await writeSnapshot(page);
  assert.deepEqual([w.cursor, w.strokes], [0, 1], 'resumed on the first char with the stroke still there');
  await judge(page, 'correct', { nextCursor: 1 });
  await backToHome(page);
  f = await facts(page);
  assert.equal(f.records.filter(r => r.kind === 'judged').length, 1, 'exactly one judged record');
  assert.equal(f.records[0].cardKey, firstQueue[0], 'for the first char of the first practice');
  assert.equal(f.todayN, 1, 'today N = 1');
  assert.ok(f.sessions.A && f.sessions.A.cursor === 1, 'the group is still open at cursor 1 (not forced to finish)');
  h = await homeView(page);
  assert.equal(h.resume, 'A', 'D55: with the group still open the home just offers 继续写字 (no copybook, no count)');
  assert.equal(f.sessions.A.queue.length - f.sessions.A.cursor, 2, 'two chars left in the group');
  assert.equal(await topScreen(page), 'home', 'no result page, no forced next step');

  // --------------------------------------------------------------- 2. 场景 2 + 反例 2
  step('场景 2: hint → write → 看答案（直接描一遍）→ 凭记忆写 → 下一个: one answer-seen record, help facts kept apart');
  await resetAt(page);
  await seed(page, { sessions: { A: makeSession({ id: 's610', slot: 'A', kind: 'daily', chars: ['大', '中', '永', '和'], at: await now(page) }), B: null, lastEnded: {} } });
  await toHome(page);
  await openSlot(page, 'A');
  await tap(page, 'write-hint');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  f = await facts(page);
  assert.equal(f.sessions.A.current.hints, 1, 'hint used once (session.current.hints)');
  await drawStroke(page, HORIZONTAL);
  await openAnswer(page);
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-trace-done'));
  await waitPhase(page, 'retrace');
  await drawStroke(page, VERTICAL);
  await tap(page, 'write-answer-next');
  await waitCursor(page, 1);
  f = await facts(page);
  assert.equal(f.records.length, 1, 'one record for 大');
  let rec = f.records[0];
  assert.equal(rec.kind, 'answer-seen', 'kind answer-seen (never went to the judge page, D18)');
  assert.deepEqual(rec.help, { hints: 1, answerSeen: true, traced: true }, 'help facts: hints 1, answerSeen, traced — separate fields');
  assert.equal(rec.judgment, undefined, 'no judgment on answer-seen');
  assert.equal(f.todayN, 0, 'answer-seen is not a valid attempt: today N 0');
  // Q1（QA simB D1）：描一遍的笔迹仍不存；「自己写一遍」的那一竖存成这条看过答案记录的墨迹（作品「看后写的」，D31），kind 不变
  const inkIds = Object.values(f.ink || {}).flatMap(table => Object.keys(table));
  assert.deepEqual(inkIds, [rec.id], 'trace strokes are not stored; the 自己写 stroke is stored as the answer-seen record\'s ink (Q1)');
  assert.ok(!f.sched || !f.sched['base:大'], 'no FSRS entry for answer-seen');
  assert.deepEqual(f.sessions.A.items, [{ cardKey: 'base:大', kind: 'answer-seen', recordId: rec.id }], 'item answer-seen');

  step('场景 2: next char hint → write → 写对了: judged with help.hints 1 (answerSeen / traced false)');
  await tap(page, 'write-hint');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await drawStroke(page, HORIZONTAL);
  await judge(page, 'correct', { nextCursor: 2 });
  f = await facts(page);
  rec = f.records.find(r => r.cardKey === 'base:中');
  assert.equal(rec && rec.kind, 'judged', 'judged record for 中');
  assert.equal(rec.judgment, 'correct', 'judgment correct');
  assert.deepEqual(rec.help, { hints: 1, answerSeen: false, traced: false }, 'help facts of this attempt only');
  assert.equal(f.todayN, 1, 'today N 1');
  assert.ok(f.sched && f.sched['base:中'], 'FSRS entry for the judged char');

  step('反例 2: 没落笔就看答案 → 描一遍 → 下一个; 没落笔就跳过 — neither counts as a valid attempt');
  await openAnswer(page);
  await tap(page, 'write-answer-next');
  await waitCursor(page, 3);
  f = await facts(page);
  rec = f.records.find(r => r.cardKey === 'base:永');
  assert.equal(rec && rec.kind, 'answer-seen', 'answer-seen for 永 (no stroke, no judgment)');
  assert.equal(f.todayN, 1, 'today N still 1 after 看答案 / 描一遍 without a stroke');
  await tap(page, 'write-skip');
  await waitTop(page, 'result');
  f = await facts(page);
  rec = f.records.find(r => r.cardKey === 'base:和');
  assert.equal(rec && rec.kind, 'skipped', 'skipped record for 和');
  assert.equal(f.todayN, 1, 'today N still 1 after 跳过 without a stroke');
  assert.deepEqual(f.judgedToday, ['base:中'], 'only 中 is a judged (valid) attempt today');
  await leaveResult(page);
  await waitTop(page, 'home');

  // --------------------------------------------------------------- 3. 场景 4（A 现场不动）
  step('场景 4: A has unjudged strokes + hint; temp group B ends with zero judgments → back, toast, A untouched');
  await resetAt(page);
  const seededA = await seedAWithInk(page, ['永', '和', '春']);
  assert.ok(seededA.ok, 'seed A with 2 strokes and 1 hint');
  const A0 = seededA.A;
  await toHome(page);
  await startPicked(page, ['大', '中']);
  f = await facts(page);
  assert.deepEqual(f.sessions.B.queue, ['base:大', 'base:中'], 'B opened');
  await endGroup(page);
  await page.click(tid('write-end-confirm'));
  await waitTop(page, 'home');
  assert.equal(await toastText(page), null, 'I3 P0-11: no toast after a zero-judgment ending');
  f = await facts(page);
  assert.equal(f.sessions.B, null, 'B ended');
  assert.equal(f.records.length, 0, 'zero judgments → no record');
  assert.equal(S(f.sessions.A), S(A0), 'A deep-equal (strokes, hint, phase untouched)');

  step('场景 4: re-pick → partial judgment → 结束这组 write fails (stays in the dialog) → retry → result 先写到这里; A untouched');
  await startPicked(page, ['春', '大', '中']);
  await drawStroke(page, HORIZONTAL);
  await judge(page, 'correct', { nextCursor: 1 });
  await endGroup(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(tid('write-end-confirm'));
  await page.waitForSelector(`${tid('write-end-dialog')}[data-state="failed"]`);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  f = await facts(page);
  assert.ok(f.sessions.B && f.sessions.B.cursor === 1, 'failed end keeps B as it was');
  assert.equal(await topScreen(page), 'write', 'still on the write page');
  await page.click(tid('write-end-retry'));
  await waitTop(page, 'result');
  f = await facts(page);
  assert.ok(!f.sessions.B && f.sessions.lastEnded.B && f.sessions.lastEnded.B.endedEarly === true, 'B ended early into lastEnded.B');
  assert.equal(f.records.filter(r => r.kind === 'judged').length, 1, 'the partial judgment is kept (1 judged)');
  assert.equal(S(f.sessions.A), S(A0), 'A deep-equal after the partial group');
  await leaveResult(page);
  await waitTop(page, 'home');

  step('场景 4: B with an unjudged stroke → 自己选字 another group → S02 protects B (cancel = nothing written)');
  await startPicked(page, ['永']);
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(150);
  await backToHome(page);
  const B1 = (await facts(page)).sessions.B;
  assert.equal(B1.current.strokes.length, 1, 'B has one unjudged stroke');
  await markFirstPracticeDone(page); // P1-E5 / D46 ②：首次打开不显示「自己选字」；只补 backupMeta，不碰记录与会话
  await openPickSheet(page);
  await typeInSheet(page, '和春');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="和"] [data-testid="query-row-select"]`).click();
  const beforeS02 = await logLen(page);
  await page.locator(inSheet('query-go')).click();
  await page.waitForSelector(tid('s02-dialog'));
  await waitNavIdle(page);
  assert.ok(await page.isVisible(tid('s02-dialog')), 'S02 instead of overwriting the unfinished B');
  await page.click(tid('s02-cancel'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="s02-dialog"]'));
  await waitNavIdle(page);
  assert.deepEqual(await writesSince(page, beforeS02), [], 'S02 + cancel: zero writes');
  f = await facts(page);
  assert.equal(S(f.sessions.B), S(B1), 'B deep-equal (its stroke still there)');
  assert.equal(S(f.sessions.A), S(A0), 'A deep-equal');
  if (await page.$(SHEET)) await closeSheet(page);

  // --------------------------------------------------------------- 4. 场景 5
  step('场景 5: 自己选字 — no preselection; check then cancel → zero writes; reopen remembers nothing');
  await resetAt(page);
  await toHome(page);
  await markFirstPracticeDone(page); // 同上（写入发生在「零写入」计量之前）
  let base = await logLen(page);
  let keys0 = await rawKeys(page);
  await openPickSheet(page);
  await typeInSheet(page, '永和');
  let rows = await sheetRows(page);
  assert.deepEqual(rows.map(r => [r.char, r.checked]), [['永', 'false'], ['和', 'false']], 'rows unchecked (no preselection)');
  assert.equal(await page.locator(inSheet('query-go')).isDisabled(), true, 'bottom button truly disabled with 0 selected');
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="永"] [data-testid="query-row-select"]`).click();
  rows = await sheetRows(page);
  assert.equal(rows.find(r => r.char === '永').checked, 'true', 'typed char can be checked');
  await closeSheet(page);
  assert.deepEqual(await writesSince(page, base), [], 'open / type / check / cancel: zero writes');
  assert.deepEqual(await rawKeys(page), keys0, 'storage deep-equal after cancel');
  f = await facts(page);
  assert.ok(!f.sessions || !f.sessions.B, 'no B after cancel');
  await openPickSheet(page);
  assert.equal(await page.locator(inSheet('query-input')).inputValue(), '', 'reopened with an empty input');
  await typeInSheet(page, '永和');
  rows = await sheetRows(page);
  assert.deepEqual(rows.map(r => r.checked), ['false', 'false'], 'reopen: nothing remembered as selected');

  step('场景 5: explicit start → B with the checked chars; the 自选字 list is not touched by picking');
  const custom0 = (await facts(page)).custom;
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="永"] [data-testid="query-row-select"]`).click();
  await page.locator(`${SHEET} [data-testid="query-row"][data-char="和"] [data-testid="query-row-select"]`).click();
  await page.locator(inSheet('query-go')).click();
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
  f = await facts(page);
  assert.deepEqual([f.sessions.B.kind, f.sessions.B.queue], ['picked', ['base:永', 'base:和']], 'B created only on the explicit start');
  assert.equal(S(f.custom), S(custom0), 'custom (自选的字) unchanged');

  step('场景 5: B unfinished → read-only lookup from 字库 (rows, card) writes nothing and does not ask S02');
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(150);
  await backToHome(page);
  const B2 = (await facts(page)).sessions.B;
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('library'));
  await waitTop(page, 'library');
  base = await logLen(page);
  keys0 = await rawKeys(page);
  await page.click(`.sz-layer[data-top="true"] ${tid('library-query-open')}`);
  await page.waitForSelector(inSheet('query-input'));
  await waitNavIdle(page);
  await typeInSheet(page, '永');
  await page.waitForSelector(`${inSheet('query-card')}[data-char="永"]`);
  assert.equal(await page.$(tid('s02-dialog')), null, 'no S02 for a read-only lookup');
  await closeSheet(page);
  assert.deepEqual(await writesSince(page, base), [], 'lookup with an unfinished B: zero writes');
  assert.deepEqual(await rawKeys(page), keys0, 'storage deep-equal');
  assert.equal(S((await facts(page)).sessions.B), S(B2), 'B deep-equal');
  await toHome(page);

  // --------------------------------------------------------------- 5. 反例 6
  step('反例 6: the judge button clicked twice in the same frame → one judged record, cursor +1');
  await resetAt(page);
  await seed(page, { sessions: { A: makeSession({ id: 's620', slot: 'A', kind: 'daily', chars: ['永', '和', '春'], at: await now(page) }), B: null, lastEnded: {} } });
  await openSlot(page, 'A');
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await waitPhase(page, 'compare');
  await page.evaluate(() => {
    const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-judge-correct"]');
    b.click();
    b.click();
  });
  await waitCursor(page, 1);
  f = await facts(page);
  assert.equal(f.records.length, 1, 'double judge: exactly one record');
  assert.equal(f.sessions.A.cursor, 1, 'cursor advanced once');
  assert.equal(f.sessions.A.items.length, 1, 'one item');

  step('反例 6: 跳过 clicked twice in the same frame → one skipped record, cursor +1');
  // D55：跳过是主按钮下文字行里的按钮；同一帧点两次
  await page.evaluate(() => {
    const b = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-skip"]');
    b.click();
    b.click();
  });
  await waitCursor(page, 2);
  f = await facts(page);
  assert.equal(f.records.filter(r => r.kind === 'skipped').length, 1, 'double skip: one skipped record');
  assert.equal(f.sessions.A.cursor, 2, 'cursor advanced once');

  step('反例 6: 结束这组 confirmed twice in the same frame → ended once');
  await startPicked(page, ['大', '中']);
  await drawStroke(page, HORIZONTAL);
  await judge(page, 'wrong', { nextCursor: 1 });
  await endGroup(page);
  const n0 = (await facts(page)).records.length;
  await page.evaluate(() => {
    const b = document.querySelector('[data-testid="write-end-confirm"]');
    b.click();
    b.click();
  });
  await waitTop(page, 'result');
  f = await facts(page);
  assert.equal(f.records.length, n0, 'no extra record from the second confirm');
  assert.ok(!f.sessions.B && f.sessions.lastEnded.B && f.sessions.lastEnded.B.queue.length === 2, 'B ended once into lastEnded.B');
  assert.equal(f.sessions.A.cursor, 2, 'A untouched by the double confirm');
  await leaveResult(page);
  await waitTop(page, 'home');

  // --------------------------------------------------------------- 6. 跨天作废回首页
  step('遗留: write page open, the day changes, back to foreground → today\'s practice expires (P37) → home; judged kept');
  await resetAt(page, '2026-09-24T23:58:00');
  await page.evaluate(async () => {
    const { makeRecord } = await import('/src/core/records.js');
    const at = window.__shiziTest.now() - 30000;
    const rec = makeRecord({ id: 'r700', cardKey: 'base:永', sessionId: 's700', kind: 'judged', judgment: 'correct', at,
      help: { hints: 0, answerSeen: false, traced: false } });
    const A = {
      id: 's700', slot: 'A', kind: 'daily', source: { view: 'home' }, queue: ['base:永', 'base:和', 'base:春'], cursor: 1,
      items: [{ cardKey: 'base:永', recordId: 'r700', kind: 'judged' }],
      current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false },
      lastLine: null, startedAt: at - 60000, startedDay: '2026-09-24', updatedAt: at,
    };
    const r = window.__shiziTest.seed({ records: { '2026-09': [rec] }, sessions: { A, B: null, lastEnded: {} } });
    if (!r || !r.ok) throw new Error('seed failed ' + JSON.stringify(r));
  });
  await toHome(page);
  await openSlot(page, 'A');
  w = await writeSnapshot(page);
  assert.deepEqual([w.screen, w.cursor], ['write', 1], 'write page open on the second char');
  await page.evaluate(() => {
    window.__shiziTest.setClock('2026-09-25T00:03:00');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitTop(page, 'home');
  f = await facts(page);
  assert.equal(f.sessions.A, null, 'the daily group expired (P37 discard)');
  assert.equal(f.records.filter(r => r.kind === 'judged').length, 1, 'the judged record of yesterday is kept');
  h = await homeView(page);
  assert.equal(h.resume, 'none', 'home: nothing to resume');
  const depth = await page.evaluate(async () => (await import('/src/ui/router.js')).getRouter().getState().depth);
  assert.equal(depth, 0, 'back at the home tab root (no empty write page left)');

  step('遗留: a picked group (B) does not expire across days (P61) → the write page stays');
  await seed(page, { sessions: { A: null, B: makeSession({ id: 's710', slot: 'B', kind: 'picked', chars: ['大', '中'], at: await now(page) }), lastEnded: {} } });
  await openSlot(page, 'B');
  await page.evaluate(() => {
    window.__shiziTest.setClock('2026-09-27T09:00:00');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(600);
  assert.equal(await topScreen(page), 'write', 'still on the write page');
  f = await facts(page);
  assert.equal(f.sessions.B && f.sessions.B.id, 's710', 'B kept');
  await backToHome(page);

  // --------------------------------------------------------------- 7. epoch
  step('遗留 epoch: judge-page local phase (write failed, P52) is dropped when the store is replaced → stored recall');
  await resetAt(page);
  await seed(page, { sessions: { A: makeSession({ id: 's720', slot: 'A', kind: 'daily', chars: ['永', '和', '春'], at: await now(page) }), B: null, lastEnded: {} } });
  await openSlot(page, 'A');
  await drawStroke(page, HORIZONTAL);
  await page.waitForTimeout(200);
  assert.equal((await facts(page)).sessions.A.current.strokes.length, 1, 'stroke written back');
  await page.evaluate(() => window.__shiziTest.failNextWrite(2, { kind: 'generic' }));
  await page.click(topSel('write-done'));
  await waitPhase(page, 'compare');
  assert.equal((await facts(page)).sessions.A.current.phase, 'recall', 'stored phase still recall (both writes failed, P52 local override)');
  assert.ok(await page.isVisible(topSel('write-persist-notice')), 'one-time save-failed notice shown');
  let snap = await page.evaluate(() => window.__shiziTest.getState());
  await seed(page, { sessions: snap.sessions });
  await waitPhase(page, 'recall');
  w = await writeSnapshot(page);
  assert.deepEqual([w.phase, w.strokes], ['recall', 1], 'after the replacement: stored phase (recall) with the stored stroke');
  assert.equal(await page.$(topSel('write-persist-notice')), null, 'the old notice (local state) is gone');
  await page.waitForTimeout(300);
  assert.equal((await facts(page)).sessions.A.current.phase, 'recall', 'the old body did not write its compare phase back');

  step('遗留 epoch: skip-undo bar of the replaced state is dropped');
  await tap(page, 'write-skip');
  await waitCursor(page, 1);
  assert.ok(await page.isVisible(topSel('write-skip-undo')), 'skip undo bar shown');
  snap = await page.evaluate(() => window.__shiziTest.getState());
  await seed(page, { records: snap.records, sessions: snap.sessions });
  await page.waitForFunction(() => !document.querySelector('.sz-layer[data-top="true"] [data-testid="write-skip-undo"]'));
  w = await writeSnapshot(page);
  assert.equal(w.cursor, 1, 'still the stored cursor (1)');
  assert.equal(await page.$(topSel('write-skip-undo')), null, 'no undo bar pointing at the replaced state');

  step('遗留 epoch: a local stroke that was never written back is not carried into the replaced state');
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await drawStroke(page, VERTICAL);
  await page.waitForTimeout(200);
  w = await writeSnapshot(page);
  assert.equal(w.strokes, 1, 'local stroke on screen');
  assert.equal((await facts(page)).sessions.A.current.strokes.length, 0, 'stored strokes 0 (write failed)');
  snap = await page.evaluate(() => window.__shiziTest.getState());
  await seed(page, { records: snap.records, sessions: snap.sessions });
  await page.waitForFunction(() => {
    const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
    return !!g && Number(g.dataset.strokeCount) === 0;
  });
  await page.waitForTimeout(300);
  assert.equal((await facts(page)).sessions.A.current.strokes.length, 0, 'the replaced body did not write its stroke into the new state');
  await page.waitForTimeout(PRESS_SETTLE_MS); // 重挂 = 新状态，按钮 0.4s 不响应
  await backToHome(page);

  // --------------------------------------------------------------- 8. 清空一并清 lastEnded
  step('遗留: 清空记录 also clears sessions.lastEnded (and A/B, P79); undo restores every v2 key');
  await resetAt(page);
  await page.evaluate(async () => {
    const { makeRecord } = await import('/src/core/records.js');
    const at = window.__shiziTest.now() - 3600000;
    const rec = makeRecord({ id: 'r730', cardKey: 'base:永', sessionId: 's731', kind: 'judged', judgment: 'wrong', at,
      help: { hints: 0, answerSeen: false, traced: false } });
    const base = { source: { view: 'home' }, current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false }, lastLine: null, startedDay: '2026-09-24' };
    const A = { ...base, id: 's732', slot: 'A', kind: 'daily', queue: ['base:和', 'base:春'], cursor: 0, items: [], startedAt: at, updatedAt: at };
    const B = { ...base, id: 's731', slot: 'B', kind: 'picked', queue: ['base:永', 'base:大'], cursor: 1,
      items: [{ cardKey: 'base:永', recordId: 'r730', kind: 'judged' }], startedAt: at - 1000, updatedAt: at, endedAt: at, endedEarly: true };
    const r = window.__shiziTest.seed({ records: { '2026-09': [rec] }, sessions: { A, B: null, lastEnded: { B } } });
    if (!r || !r.ok) throw new Error('seed failed ' + JSON.stringify(r));
  });
  const raw0 = await page.evaluate(() => window.__shiziTest.getRawKeys('shizi.v2.'));
  await page.evaluate(async () => (await import('/src/ui/screens/mine/backup.js')).openBackup());
  await page.waitForSelector(topSel('backup-screen'));
  await waitNavIdle(page);
  await page.click(topSel('backup-clear'));
  await page.waitForSelector(topSel('backup-clear-sheet'));
  await waitNavIdle(page);
  await page.click(topSel('backup-clear-ok'));
  await page.waitForSelector(topSel('backup-undo'));
  await waitNavIdle(page);
  f = await facts(page);
  assert.equal(S(f.sessions), S({ A: null, B: null, lastEnded: {} }), 'A / B ended and lastEnded cleared by 清空');
  assert.equal(f.records.length, 0, 'records cleared');
  await page.click(topSel('undo-button'));
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="backup-undo"]');
    return el && el.dataset.state === 'done';
  });
  assert.equal(S(await page.evaluate(() => window.__shiziTest.getRawKeys('shizi.v2.'))), S(raw0), 'undo: every v2 key (incl. sessions.lastEnded) deep-equal');
  await page.waitForFunction(() => !document.querySelector('[data-testid="backup-undo"]'), null, { timeout: 6000 });
  await toHome(page);

  // --------------------------------------------------------------- 10. 边改 Z03（04 §4.3，checklist-M6）
  for (const large of [false, true]) {
    const tag = `360×640${large ? ' + system text XXXL' : ''}`; // P1-E6 / D29：大字 = 系统字号（模拟原生 shiziContentSize），不再是 data-large
    step(`边改 Z03 (${tag}): compact detail — 「已撤销」 does not cover the 「移出自选」 sub line`);
    await page.setViewportSize({ width: 360, height: 640 });
    await resetAt(page);
    await page.evaluate(async () => {
      const nowMs = window.__shiziTest.now();
      window.__shiziTest.seed({ custom: { added: ['山', '木', '日'].map((c, i) => ({ char: c, at: nowMs - (10 - i) * 1000 })) } });
    });
    await setTextSize(page, large ? LARGE_TEXT : 'L');
    await toHome(page);
    await page.evaluate(async () => (await import('/src/ui/screens/detail/index.js')).openDetail('木'));
    await page.waitForSelector(topSel('detail-remove'));
    await waitNavIdle(page);
    await page.click(topSel('detail-remove'));
    await page.waitForSelector(topSel('undo-button'));
    await waitNavIdle(page);
    await page.click(topSel('undo-button'));
    await page.waitForFunction(() => {
      const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="detail-undo"]');
      return !!el && el.dataset.state === 'done';
    });
    await page.waitForSelector(topSel('detail-remove'));
    const sub = await copy(page, 'R-D06.rowSub');
    const geo = await page.evaluate(text => {
      const top = document.querySelector('.sz-layer[data-top="true"]');
      const bar = top.querySelector('[data-testid="detail-undo"] [data-testid="undo-bar"]') || top.querySelector('[data-testid="undo-bar"]');
      const row = top.querySelector('[data-testid="detail-remove"]');
      const el = [...row.querySelectorAll('*')].find(n => n.children.length === 0 && n.textContent.trim() === text);
      if (!bar || !el) return null;
      el.scrollIntoView({ block: 'nearest' }); // 用户滚到这一行时它在可见区里、不被底栏盖住
      const b = bar.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const ix = Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left));
      const iy = Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top));
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = cy >= 0 && cy <= window.innerHeight ? document.elementFromPoint(cx, cy) : null;
      return { overlap: ix * iy, barText: bar.textContent.trim(),
        visible: r.bottom <= window.innerHeight && r.top >= 0, hitSelf: !!hit && (hit === el || el.contains(hit) || hit.contains(el)),
        hit: hit ? `${hit.tagName}.${hit.className} ${hit.getAttribute('data-testid') || ''}` : null, rect: [r.top, r.bottom], bar: [b.top, b.bottom] };
    }, sub);
    assert.ok(geo, 'undo bar and the sub line are both there');
    assert.ok(geo.barText.includes(await copy(page, 'R-D06.undone')), `「已撤销」 shown (${geo.barText})`);
    assert.equal(geo.overlap, 0, `${tag}: 「已撤销」 bar and the sub line do not intersect`);
    assert.ok(geo.visible, `${tag}: the sub line can be scrolled fully into view`);
    assert.ok(geo.hitSelf, `${tag}: the sub line is not covered (hit test: ${geo.hit}; sub ${geo.rect}, bar ${geo.bar})`);
    await page.click(topSel('page-back'));
    await waitTop(page, 'home');
  }
  await setTextSize(page, 'L');
  await page.setViewportSize(ctx.viewport);

  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct'));
  assert.deepEqual(direct, [], 'every localStorage write went through storage.js');

  // --------------------------------------------------------------- 9. shiziShareFailed（假原生通道，最后做：init script 留在本页）
  step('遗留 P96: native shell — backup share fails → shiziShareFailed → toast, export not recorded');
  await installNativeStub(page);
  await page.reload();
  await page.waitForFunction(() => typeof window.__shiziTest === 'object' && typeof window.shiziShareFailed === 'function');
  await waitNavIdle(page);
  await resetAt(page);
  await page.evaluate(async () => {
    const { makeRecord } = await import('/src/core/records.js');
    const at = window.__shiziTest.now() - 3600000;
    const rec = makeRecord({ id: 'r740', cardKey: 'base:永', sessionId: 's740', kind: 'judged', judgment: 'correct', at,
      help: { hints: 0, answerSeen: false, traced: false } });
    window.__shiziTest.seed({ records: { '2026-09': [rec] } });
  });
  const handled = await page.evaluate(() => window.__shiziBridge.hasHandler('shiziShareFailed'));
  assert.equal(handled, true, 'shiziShareFailed has an implementation once the page is ready');
  await page.evaluate(async () => (await import('/src/ui/screens/mine/backup.js')).openBackup());
  await page.waitForSelector(topSel('backup-screen'));
  await waitNavIdle(page);
  await page.click(topSel('backup-export'));
  await page.waitForTimeout(200);
  const shares = await nativeMessages(page, 'shareBackup');
  assert.equal(shares.length, 1, 'export in the native shell posts shareBackup');
  const accepted = await page.evaluate(() => window.shiziShareFailed({ kind: 'backup', reason: 'activity' }));
  assert.equal(accepted, true, 'global returns true (accepted)');
  // 备份页还在屏上：就地三段式（S1 / F3 ①，审计 P1-30），不再出提示条
  await page.waitForSelector(topSel('backup-export-fail'));
  assert.equal((await page.textContent(topSel('backup-export-fail-note'))).trim(), await copy(page, 'X-BACKUP.exportFailed'), 'in-place three-part failure X-BACKUP.exportFailed');
  assert.equal(await page.locator(tid('toast')).count(), 0, 'no toast while the failure is shown in place');
  f = await facts(page);
  assert.ok(!f.backupMeta || !f.backupMeta.lastExportAt, 'export not recorded (lastExportAt unset)');

  step('遗留 P96: card / link / unknown kinds (nothing on screen handles them) → a failure toast with their sentences; nothing written');
  await page.waitForTimeout(450);
  await page.click(topSel('backup-export-fail-cancel'));
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await waitNavIdle(page);
  base = await logLen(page);
  for (const [kind, key] of [['card', 'X-SHARE.cardFailed'], ['link', 'X-SHARE.linkFailed'], ['other', 'X-SHARE.failed']]) {
    await page.evaluate(k => window.shiziShareFailed({ kind: k, reason: 'write' }), kind);
    const text = await copy(page, key);
    await waitToast(page, text);
    assert.equal(await toastText(page), text, `kind ${kind} → ${key}`);
  }
  assert.deepEqual(await writesSince(page, base), [], 'share-failed toasts write nothing');
  const live = await page.getAttribute(tid('toast-host'), 'aria-live');
  assert.equal(live, 'polite', 'toast is a polite live region');
}
