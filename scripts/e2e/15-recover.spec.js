// M1-6 会话现场与恢复（02 §3 M1-6；走查-W10；决定-D07；01 §3.3 / §4；03 P52）。
//
// 场景（A 会话 永 / 和 / 春 / 大 / 中）：
//   1. recall：写两笔 → sessions.current.strokes 两行 → 刷新 → 同一字、同一阶段、两笔都在（固化层有墨）；
//      撤销 / 清空 / 清空后撤销都写回；用过提示后刷新：次数保留、提示静态显示（M1-3 恢复约定）。
//   2. compare：写好了 → 刷新 → 仍在判断页，「你的书写」有墨、参考字形 ready；接着写 → 刷新 → recall 且笔迹在。
//   3. answer / trace / retrace：确认看答案 → 刷新 → 看答案卡片；描一遍写一笔 → 刷新 → 描一遍、笔迹与描红层都在；
//      自己写写一笔 → 刷新 → 自己写、笔迹在；answer-seen 记录始终只有一条。
//   4. 恢复幂等：seed「已有本会话该字 judged 记录、会话未推进、phase=compare」→ 打开 → 补推进，不进 compare，今日 N 不变；
//      seed「compare + 空笔画」→ recall，存下的阶段也改回 recall。
//   5. interruptAfterWrite 矩阵：判断 commit 的第 k 次写后中断（k = 1..K，含「records 写后」）→ 刷新 →
//      judged 至多一条、今日 N = judged 数；回滚的 k 仍在判断页且笔迹在，再判断一次只多一条；落盘的 k 不再进判断页。
//   6. 抬笔写失败（P52）：failNextWrite → 笔迹不丢、顶部一次性提示（通用句，约 5s 后收起）；再失败不再提示；visibilitychange(hidden)
//      重写成功；刷新后笔迹都在；新页面加载撞配额 → 配额句。
//   最后：全部写入经 storage.js。

import {
  bootTestHost, drawStroke, HORIZONTAL, VERTICAL, PRESS_SETTLE_MS, seedSession, tid, topSel, waitNavIdle, writeSnapshot,
  openWrite, canvasInk, tap, footItems,
} from './helpers.mjs';

const CHARS = ['永', '和', '春', '大', '中'];
const DIAG = [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]];
const COPY = {
  saveFailed: '这次进度没有保存。请立即导出备份后重新打开 App。',
  quotaFailed: '本地空间已满，这次进度没有保存。请立即导出备份并清理空间。',
};
// 一笔横（encodeRawStrokes 行：stride 3，x×10、y×10、dt）。
const ROW_H = [3, 700, 1720, 0, 1200, 1722, 16, 1720, 1725, 16, 2240, 1722, 16, 2760, 1720, 16];
const ROW_V = [3, 1725, 700, 0, 1722, 1200, 16, 1725, 1720, 16, 1722, 2240, 16, 1720, 2760, 16];

async function facts(page, slot = 'A') {
  return page.evaluate(async sl => {
    const { todayCount } = await import('/src/core/records.js');
    const st = window.__shiziTest.getState();
    const records = [];
    for (const m of Object.keys(st.records || {})) {
      const v = st.records[m];
      for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    }
    const d = new Date(window.__shiziTest.now());
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const session = st.sessions ? st.sessions[sl] : null;
    return {
      records,
      judged: records.filter(r => r.kind === 'judged'),
      answerSeen: records.filter(r => r.kind === 'answer-seen'),
      session,
      storedStrokes: session && session.current ? session.current.strokes.length : null,
      storedPhase: session && session.current ? session.current.phase : null,
      todayN: todayCount(records, today),
    };
  }, slot);
}

async function settle(page) {
  await page.waitForTimeout(PRESS_SETTLE_MS);
}

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!top && top.dataset.phase === p;
  }, phase);
  await settle(page);
}

async function waitAttr(page, id, attr, values, timeout = 15000) {
  await page.waitForFunction(({ id: i, attr: a, values: vs }) => {
    const el = document.querySelector(`.sz-layer[data-top="true"] [data-testid="${i}"]`);
    return !!el && vs.includes(el.getAttribute(a));
  }, { id, attr, values }, { timeout });
  return page.getAttribute(topSel(id), attr);
}

async function write(page, pts, expectCount) {
  await drawStroke(page, pts);
  await page.waitForFunction(n => {
    const g = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]');
    return !!g && Number(g.dataset.strokeCount) === n;
  }, expectCount);
  await effects(page);
}

/** 等 Preact 的 useEffect（抬笔写 sessions 在 effect 里）跑完：两帧 + 一个宏任务。 */
async function effects(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
}

async function present(page, id) {
  return (await page.locator(topSel(id)).count()) > 0;
}

/** 刷新整页：router 从 history.state 恢复写字页（01 §7），store 从 localStorage 重载（含 repair）。 */
async function reloadWrite(page) {
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await page.waitForSelector(topSel('write-screen'));
  await waitNavIdle(page);
}

/** 新页面（about:blank → 测试宿主首页）+ seed + 打开写字页。 */
async function fresh(page, ctx, { session = {}, extraState = {} } = {}) {
  await page.goto('about:blank');
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0, extraState, ...session });
  if (!seeded.ok) throw new Error('seed failed: ' + JSON.stringify(seeded.result));
  await openWrite(page, { slot: 'A' });
}

async function pixelsIn(page, testid) {
  return page.evaluate(id => {
    const host = document.querySelector(`.sz-layer[data-top="true"] [data-testid="${id}"]`);
    if (!host) return -1;
    let n = 0;
    for (const c of host.querySelectorAll('canvas')) {
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n += 1;
    }
    return n;
  }, testid);
}

async function noticeInfo(page) {
  return page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid="write-persist-notice"]');
    const el = els[0];
    return { count: els.length, kind: el ? el.dataset.kind : null, text: el ? el.textContent.trim() : null,
      role: el ? el.getAttribute('role') : null };
  });
}

async function hideDocument(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState; // 复原（原型上的 getter）
  });
}

async function writeLogLength(page) {
  return page.evaluate(() => window.__shiziTest.getWriteLog().length);
}

export default async function recover(page, ctx) {
  const { assert } = ctx;
  const t0 = Date.now();

  // ------------------------------------------------------------------ 1. recall
  ctx.step('recall: each lift writes sessions.current.strokes; refresh restores the same character, phase and ink');
  await fresh(page, ctx);
  await write(page, HORIZONTAL, 1);
  let f = await facts(page);
  assert.equal(f.storedStrokes, 1, 'after the first lift the session holds 1 stroke');
  await write(page, VERTICAL, 2);
  f = await facts(page);
  assert.equal(f.storedStrokes, 2, 'after the second lift the session holds 2 strokes');
  assert.equal(f.storedPhase, 'recall', 'stored phase recall');
  await reloadWrite(page);
  let s = await writeSnapshot(page);
  assert.deepEqual([s.cursor, s.phase, s.strokes], [0, 'recall', 2], 'refresh: cursor 0, recall, 2 strokes');
  assert.ok((await canvasInk(page, 'write-grid-ink')) > 0, 'refresh: the solid layer is painted');
  assert.equal(s.done.disabled, false, '「写好了」 enabled after refresh (strokes restored)');

  ctx.step('undo / clear / undo-after-clear are written back');
  await page.click(topSel('write-undo'));
  await page.waitForFunction(() => Number(document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]').dataset.strokeCount) === 1);
  await effects(page);
  assert.equal((await facts(page)).storedStrokes, 1, 'undo → session holds 1 stroke');
  await settle(page);
  await page.click(topSel('write-clear'));
  await page.waitForFunction(() => Number(document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]').dataset.strokeCount) === 0);
  await effects(page);
  assert.equal((await facts(page)).storedStrokes, 0, 'clear → session holds 0 strokes');
  await settle(page);
  await page.click(topSel('write-undo'));
  await page.waitForFunction(() => Number(document.querySelector('.sz-layer[data-top="true"] [data-testid="write-grid"]').dataset.strokeCount) === 1);
  await effects(page);
  assert.equal((await facts(page)).storedStrokes, 1, 'undo after clear → session holds the stroke again');

  ctx.step('hint used, then refresh: count kept, hint shown statically');
  await tap(page, 'write-hint');
  await waitAttr(page, 'write-hint-layer', 'data-state', ['shown']);
  f = await facts(page);
  assert.equal(f.session.current.hints, 1, 'hint count written');
  await reloadWrite(page);
  s = await writeSnapshot(page);
  assert.deepEqual([s.phase, s.strokes], ['recall', 1], 'refresh: recall with the 1 stroke');
  assert.equal(((await footItems(page)).find(i => i.testid === 'write-hint') || {}).remaining, '1', 'refresh: 1 hint left');
  assert.equal(await waitAttr(page, 'write-hint-layer', 'data-anim', ['static', 'draw', 'fade']), 'static', 'refresh: hint restored statically');

  // ------------------------------------------------------------------ 2. compare
  ctx.step('compare: refresh stays on the judge page with my ink and the reference glyph');
  await write(page, VERTICAL, 2);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-compare'));
  await waitPhase(page, 'compare');
  f = await facts(page);
  assert.deepEqual([f.storedPhase, f.storedStrokes], ['compare', 2], 'stored: compare with 2 strokes');
  await reloadWrite(page);
  await waitPhase(page, 'compare');
  assert.ok(await present(page, 'write-compare'), 'refresh: judge page shown');
  assert.equal(await present(page, 'write-compare-noink'), false, 'refresh: not 「这次没写」');
  assert.ok((await pixelsIn(page, 'write-compare-mine')) > 0, 'refresh: 你的书写 card has ink');
  assert.equal(await waitAttr(page, 'write-compare-ref', 'data-state', ['ready', 'missing']), 'ready', 'refresh: 参考字形 ready');
  assert.ok((await pixelsIn(page, 'write-compare-ref')) > 0, 'refresh: 参考字形 painted');

  ctx.step('接着写 → recall keeps the strokes; refresh keeps them too');
  await page.click(topSel('write-continue'));
  await waitPhase(page, 'recall');
  f = await facts(page);
  assert.deepEqual([f.storedPhase, f.storedStrokes], ['recall', 2], 'stored: recall with 2 strokes');
  await reloadWrite(page);
  s = await writeSnapshot(page);
  assert.deepEqual([s.phase, s.strokes], ['recall', 2], 'refresh: recall, 2 strokes');
  assert.equal((await facts(page)).judged.length, 0, 'no record written by any of this');

  // ------------------------------------------------------------------ 3. answer / trace / retrace
  ctx.step('answer: 看答案 (no confirm dialog; the two strokes stay) → refresh shows the answer layer under the same ink; one answer-seen record');
  await tap(page, 'write-show-answer');
  await waitPhase(page, 'answer');
  assert.equal(await page.locator(tid('write-answer-confirm')).count(), 0, 'no confirm dialog (D51 ⑧)');
  assert.equal((await writeSnapshot(page)).strokes, 2, 'the recall strokes are still on the grid in the answer phase');
  await reloadWrite(page);
  await waitPhase(page, 'answer');
  assert.equal((await writeSnapshot(page)).strokes, 2, 'refresh: the recall strokes come back in the answer phase (not cleared)');
  assert.ok(await present(page, 'write-answer-card'), 'refresh: answer layer shown');
  assert.equal(await waitAttr(page, 'write-answer-card', 'data-state', ['ready', 'missing']), 'ready', 'refresh: answer glyph ready');
  f = await facts(page);
  assert.equal(f.answerSeen.length, 1, 'one answer-seen record');
  assert.equal(f.judged.length, 0, 'no judged record');

  ctx.step('trace: one stroke → refresh keeps trace, the stroke and the outline');
  await page.click(topSel('write-answer-trace'));
  await waitPhase(page, 'trace');
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 0, 'trace starts empty');
  await write(page, HORIZONTAL, 1);
  assert.deepEqual([(await facts(page)).storedPhase, (await facts(page)).storedStrokes], ['trace', 1], 'stored: trace with 1 stroke');
  await reloadWrite(page);
  await waitPhase(page, 'trace');
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 1, 'refresh: trace with 1 stroke');
  assert.ok((await canvasInk(page, 'write-grid-ink')) > 0, 'refresh: trace ink painted');
  assert.equal(await waitAttr(page, 'write-trace-layer', 'data-state', ['ready', 'missing']), 'ready', 'refresh: trace outline present');
  assert.equal(await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="write-trace-done"]').disabled),
    false, 'refresh: 描好了 enabled (stroke counted)');

  ctx.step('retrace: one stroke → refresh keeps retrace and the stroke');
  await page.click(topSel('write-trace-done'));
  await waitPhase(page, 'retrace');
  assert.equal((await writeSnapshot(page)).strokes, 0, 'retrace starts empty');
  await write(page, DIAG, 1);
  await reloadWrite(page);
  await waitPhase(page, 'retrace');
  s = await writeSnapshot(page);
  assert.deepEqual([s.phase, s.strokes], ['retrace', 1], 'refresh: retrace with 1 stroke');
  f = await facts(page);
  assert.equal(f.answerSeen.length, 1, 'still one answer-seen record after three refreshes');
  assert.equal(f.answerSeen[0].help.traced, true, 'traced kept');
  await tap(page, 'write-answer-next');
  await page.waitForFunction(() => Number(document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor) === 1);
  await settle(page);
  f = await facts(page);
  assert.deepEqual([f.session.cursor, f.storedPhase, f.storedStrokes], [1, 'recall', 0], '下一个 → next character, fresh current');

  // ------------------------------------------------------------------ 4. 恢复幂等（seed 的半态）
  ctx.step('seed: judged record exists for the current character but the session was not advanced → open advances it');
  const now = await page.evaluate(() => window.__shiziTest.now());
  const record = await page.evaluate(async at => {
    const { makeRecord } = await import('/src/core/records.js');
    return makeRecord({ id: 'r1', cardKey: 'base:永', sessionId: 's1', kind: 'judged', judgment: 'correct', at,
      help: { hints: 0, answerSeen: false, traced: false } });
  }, now);
  const month = record.localDay.slice(0, 7);
  await fresh(page, ctx, {
    session: { current: { phase: 'compare', strokes: [ROW_H] } },
    extraState: { records: { [month]: [record] } },
  });
  await page.waitForFunction(() => Number(document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor) === 1);
  s = await writeSnapshot(page);
  assert.deepEqual([s.cursor, s.phase, s.strokes], [1, 'recall', 0], 'advanced to the next character in recall, not compare');
  assert.equal(await present(page, 'write-compare'), false, 'judge page not shown');
  f = await facts(page);
  assert.equal(f.judged.length, 1, 'still exactly one judged record');
  assert.equal(f.todayN, 1, '今日 N stays 1');
  assert.deepEqual(f.session.items, [{ cardKey: 'base:永', kind: 'judged', recordId: 'r1' }], 'items[] filled in from the record');
  assert.deepEqual(f.session.lastLine, { recordId: 'r1', kind: 'record' }, 'result line points at the record');
  await reloadWrite(page);
  f = await facts(page);
  assert.deepEqual([f.session.cursor, f.judged.length, f.todayN], [1, 1, 1], 'refresh again: nothing changes');

  ctx.step('seed: compare with no strokes → recall (stored phase fixed too)');
  await fresh(page, ctx, { session: { current: { phase: 'compare', strokes: [] } } });
  s = await writeSnapshot(page);
  assert.deepEqual([s.cursor, s.phase, s.strokes], [0, 'recall', 0], 'recall shown');
  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.phase === 'recall');
  assert.equal((await facts(page)).storedPhase, 'recall', 'stored phase back to recall');

  // ------------------------------------------------------------------ 5. interruptAfterWrite 矩阵
  ctx.step('dry run: count the storage writes of one judge commit');
  const seededCompare = { session: { current: { phase: 'compare', strokes: [ROW_H, ROW_V] } } };
  await fresh(page, ctx, seededCompare);
  await waitPhase(page, 'compare');
  assert.ok((await pixelsIn(page, 'write-compare-mine')) > 0, 'seeded compare opens on the judge page with my ink');
  const before = await writeLogLength(page);
  await page.click(topSel('write-judge-correct'));
  await page.waitForFunction(() => Number(document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor) === 1);
  const log = await page.evaluate(n => window.__shiziTest.getWriteLog().slice(n).map(e => `${e.op}:${e.key}`), before);
  const judgeWrites = [];
  for (const e of log) {
    judgeWrites.push(e);
    if (e === 'remove:shizi.v2.txn') break; // 判断 commit 到删 txn 为止
  }
  const K = judgeWrites.length;
  const recordsAt = judgeWrites.findIndex(e => e.startsWith('set:shizi.v2.records.')) + 1;
  assert.ok(K >= 4 && recordsAt >= 2, `judge commit = ${K} writes (${judgeWrites.join(', ')}); records written at #${recordsAt}`);

  let rolledBack = 0;
  let committed = 0;
  for (let k = 1; k <= K; k += 1) {
    ctx.step(`interruptAfterWrite(${k}) during the judge commit${k === recordsAt ? ' (right after records)' : ''} → refresh`);
    await fresh(page, ctx, seededCompare);
    await waitPhase(page, 'compare');
    await page.evaluate(n => window.__shiziTest.interruptAfterWrite(n), k);
    await page.click(topSel('write-judge-correct'));
    await page.waitForTimeout(150);
    await reloadWrite(page);
    f = await facts(page);
    assert.ok(f.judged.length <= 1, `k=${k}: at most one judged record (${f.judged.length})`);
    assert.equal(f.todayN, f.judged.length, `k=${k}: 今日 N (${f.todayN}) = judged records`);
    s = await writeSnapshot(page);
    if (f.judged.length === 1) {
      committed += 1;
      assert.deepEqual([s.cursor, s.phase], [1, 'recall'], `k=${k}: committed → next character, not back in compare`);
      assert.equal(f.session.items.length, 1, `k=${k}: one item`);
    } else {
      rolledBack += 1;
      await waitPhase(page, 'compare');
      assert.ok((await pixelsIn(page, 'write-compare-mine')) > 0, `k=${k}: rolled back → judge page with my ink`);
      await page.click(topSel('write-judge-correct'));
      await page.waitForFunction(() => Number(document.querySelector('.sz-layer[data-top="true"] .sz-write').dataset.cursor) === 1);
      f = await facts(page);
      assert.deepEqual([f.judged.length, f.todayN], [1, 1], `k=${k}: judging again writes exactly one record, N = 1`);
    }
    if (k === recordsAt) assert.equal(f.judged.length, 1, `k=${k}: after records-then-interrupt only one judgment exists in the end`);
  }
  assert.ok(rolledBack > 0 && committed > 0, `matrix hit both outcomes (rolled back ${rolledBack}, committed ${committed})`);

  // ------------------------------------------------------------------ 6. P52 抬笔写失败
  ctx.step('lift write fails (generic): ink stays, one top notice');
  await fresh(page, ctx);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1));
  await write(page, HORIZONTAL, 1);
  f = await facts(page);
  assert.equal(f.storedStrokes, 0, 'the failed write did not reach the session');
  assert.ok((await canvasInk(page, 'write-grid-ink')) > 0, 'the stroke is still on the grid');
  let n = await noticeInfo(page);
  assert.deepEqual([n.count, n.kind, n.text, n.role], [1, 'generic', COPY.saveFailed, 'status'], 'top notice with the generic sentence');
  assert.equal((await writeSnapshot(page)).done.disabled, false, 'writing is not blocked (写好了 enabled)');

  ctx.step('next lift rewrites everything; the notice leaves by itself (~5s)');
  await write(page, VERTICAL, 2);
  assert.equal((await facts(page)).storedStrokes, 2, 'next lift saved both strokes');
  const shownAt = Date.now();
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-persist-notice"]'), null, { timeout: 8000 });
  assert.equal((await noticeInfo(page)).count, 0, 'notice gone');
  assert.ok(Date.now() - shownAt > 3000, 'notice stayed a few seconds');

  ctx.step('failing again: no second notice; visibilitychange(hidden) rewrites');
  await page.evaluate(() => window.__shiziTest.failNextWrite(2));
  await write(page, DIAG, 3);
  await write(page, HORIZONTAL, 4);
  f = await facts(page);
  assert.equal(f.storedStrokes, 2, 'both writes failed');
  assert.equal((await noticeInfo(page)).count, 0, 'no second notice (only once)');
  s = await writeSnapshot(page);
  assert.equal(s.strokes, 4, 'all 4 strokes still on the grid');
  await hideDocument(page);
  await effects(page);
  f = await facts(page);
  assert.equal(f.storedStrokes, 4, 'visibilitychange → session holds all 4 strokes');
  await reloadWrite(page);
  s = await writeSnapshot(page);
  assert.deepEqual([s.phase, s.strokes], ['recall', 4], 'refresh: all 4 strokes restored');

  ctx.step('new page load, quota failure → the quota sentence');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'quota' }));
  await write(page, DIAG, 5);
  n = await noticeInfo(page);
  assert.deepEqual([n.count, n.kind, n.text], [1, 'quota', COPY.quotaFailed], 'top notice with the quota sentence');
  assert.equal((await facts(page)).storedStrokes, 4, 'quota write did not land');
  await page.click(topSel('write-done'));
  await waitPhase(page, 'compare');
  f = await facts(page);
  assert.deepEqual([f.storedPhase, f.storedStrokes], ['compare', 5], 'entering compare saves all 5 strokes');

  ctx.step('every localStorage write went through storage.js');
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via !== 'storage').length);
  assert.equal(direct, 0, 'no direct localStorage writes');

  // ------------------------------------------------------------------ 7. 没有会话的写字页（M2 验收 H1）
  ctx.step('H1: reset() while the write page is open → back to the home tab root; refresh stays there');
  await fresh(page, ctx);
  assert.equal(await routerDepth(page), 1, 'write page at depth 1');
  await page.evaluate(() => window.__shiziTest.reset());
  await waitHome(page);
  assert.equal(await routerDepth(page), 0, 'reset → home, depth 0');
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitHome(page);
  assert.equal(await routerDepth(page), 0, 'refresh after reset → home, depth 0');
  assert.equal(await present(page, 'write-screen'), false, 'no write page on top');

  ctx.step('H1: refresh restores a write page from history.state whose session is gone → home, depth 0');
  await fresh(page, ctx);
  // 绕过 store 直接删存储（live 页面不知道），刷新时 router 从 history.state 恢复写字页、store 读到空会话。
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('shizi.v2.')) localStorage.removeItem(k);
  });
  assert.equal(await routerDepth(page), 1, 'still on the write page before refresh');
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await waitHome(page);
  assert.equal(await routerDepth(page), 0, 'restored write page without a session → home, depth 0');
  assert.equal(await present(page, 'write-screen'), false, 'no empty write page left on top');
  assert.equal(await page.evaluate(() => window.__shiziTest.getState().sessions), null, 'no session was created by leaving');
  console.log(`    (15-recover took ${Date.now() - t0} ms)`);
}

async function routerDepth(page) {
  return page.evaluate(async () => (await import('/src/ui/router.js')).getRouter().getState().depth);
}

/** 等首页成为顶层页面（转场结束）。 */
async function waitHome(page) {
  await page.waitForFunction(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    return !!top && !!top.querySelector('[data-testid="screen-home"]') && !top.querySelector('[data-testid="write-screen"]');
  }, null, { timeout: 5000 });
  await waitNavIdle(page);
}
