// Q1（QA simB D1）：看答案后「自己写一遍」的本人墨迹存进这条「看过答案」记录 → 结果页作品出现「看后写的」格并画本人墨 →
// 分享图默认成员含它 → 刷新、冷启动后仍在。描一遍的笔迹不存；一次看答案后多次自己写只留最后一次。D18 不变（kind 仍是 answer-seen、
// 不算写对写错、不进 sched）。
//
// 流程：seed 今天的练习（永 / 和）→ 永：看答案 → 描一遍（写一横）→ 描好了，自己写（写一竖一横）→ 再描一遍 → 描好了，自己写
// （写一竖）→ 下一个 → 和：写 → 写对了 → 结果页。

import { bootTestHost, drawStroke, HORIZONTAL, openWrite, PRESS_SETTLE_MS, seedSession, tid, topSel, VERTICAL, waitNavIdle, tap } from './helpers.mjs';
import { resultSnapshot } from './work-helpers.mjs';

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!top && top.dataset.phase === p;
  }, phase);
  await page.waitForTimeout(PRESS_SETTLE_MS); // 换阶段 = 新状态，按钮 0.4s 不响应
}

/** 记录、墨迹表（解码后每份的笔数与第一笔起点）、会话。 */
async function facts(page) {
  return page.evaluate(async () => {
    const { decodeInk } = await import('/src/core/ink-math.js');
    const st = window.__shiziTest.getState();
    const records = [];
    for (const v of Object.values(st.records || {})) for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    const ink = {};
    for (const m of Object.keys(st.ink || {})) {
      for (const [id, entry] of Object.entries(st.ink[m])) {
        const d = decodeInk(entry);
        ink[id] = { strokes: d.length, first: d.length ? [Math.round(d[0][0].x), Math.round(d[0][0].y)] : null, last: d.length ? [Math.round(d[0][d[0].length - 1].x), Math.round(d[0][d[0].length - 1].y)] : null };
      }
    }
    return { records, ink, sched: st.sched || {}, sessions: st.sessions };
  });
}

async function waitResultPainted(page) {
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  await page.waitForFunction(() => {
    const cs = [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-canvas"]')];
    return cs.length > 0 && cs.every(c => c.dataset.painted === 'true');
  });
}

/** 作品里某格画布上的墨像素数（非透明）。 */
async function cellInkPixels(page, ch) {
  return page.evaluate(c => {
    const cell = document.querySelector(`.sz-layer[data-top="true"] [data-testid="work-cell"][data-char="${c}"]`);
    const canvas = cell && cell.querySelector('[data-testid="work-canvas"]');
    if (!canvas) return -1;
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1;
    return n;
  }, ch);
}

async function checkResult(page, ctx, seenId, label) {
  const { assert } = ctx;
  await waitResultPainted(page);
  const v = await resultSnapshot(page);
  assert.deepEqual(v.cells.map(c => [c.ch, c.mode, c.state]), [['永', 'hand', 'in'], ['和', 'hand', 'in']],
    `${label}: 永 (看过答案后自己写的) is a work cell drawn with the learner's ink`);
  assert.deepEqual(v.caps, ['看后写的'], `${label}: one cell caption 「看后写的」 (under 永)`);
  assert.deepEqual(v.rows.map(r => r.ch), [], `${label}: 永 is no longer a 「看过答案」 row below the work`);
  assert.ok((await cellInkPixels(page, '永')) > 50, `${label}: the 永 cell canvas has ink pixels`);
  assert.equal(v.share, true, `${label}: share icon shown`);
  // 分享图：默认成员含 永（看后写的），画本人墨
  await page.click(topSel('result-share'));
  await page.waitForFunction(() => {
    const r = document.querySelector('[data-testid="image-preview"]');
    return !!r && r.dataset.state === 'ready';
  });
  await page.waitForTimeout(300);
  const ds = await page.evaluate(() => ({ ...document.querySelector('[data-testid="image-preview"] [data-testid="image-canvas"]').dataset }));
  assert.equal(ds.members, '永和', `${label}: the share image members are 永和`);
  assert.equal(ds.modes, 'hh', `${label}: both drawn with the learner's ink`);
  assert.ok(ds.recordIds.split(',').includes(seenId), `${label}: the image draws the answer-seen record's ink (${seenId})`);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click('[data-testid="image-done"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="image-preview"]'));
  await waitNavIdle(page);
}

export default async function q1AfterSeen(page, ctx) {
  const { assert, step } = ctx;

  step('seed 今天的练习 (永 / 和) and open the write page');
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: ['永', '和'], cursor: 0 });
  assert.ok(seeded.ok, 'seed accepted');
  await openWrite(page, { slot: 'A' });
  await waitPhase(page, 'recall');

  step('永: 看答案（直接描一遍，D64 ②）(one horizontal) → 凭记忆写 (vertical + horizontal) → 再描一遍 → 自己写 (vertical) → 下一个');
  await tap(page, 'write-show-answer');
  await waitPhase(page, 'trace');
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-trace-done'));
  await waitPhase(page, 'retrace');
  let f = await facts(page);
  assert.deepEqual(f.ink, {}, '描一遍 strokes are practice: nothing stored when leaving 描一遍');
  await drawStroke(page, VERTICAL);
  await drawStroke(page, HORIZONTAL);
  await tap(page, 'write-retrace-trace');
  await waitPhase(page, 'trace');
  f = await facts(page);
  const seen = f.records.find(r => r.char === '永');
  assert.equal(seen.kind, 'answer-seen', 'the record is still 看过答案 (D18)');
  assert.deepEqual(Object.keys(f.ink), [seen.id], 'leaving 自己写 (再描一遍) stores the self-written ink on the answer-seen record');
  assert.equal(f.ink[seen.id].strokes, 2, 'two strokes (vertical + horizontal)');
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-trace-done'));
  await waitPhase(page, 'retrace');
  await drawStroke(page, VERTICAL);
  await tap(page, 'write-answer-next');
  await waitPhase(page, 'recall');
  f = await facts(page);
  assert.deepEqual(Object.keys(f.ink), [seen.id], 'still one ink entry for 永');
  assert.equal(f.ink[seen.id].strokes, 1, 'only the last 自己写 is kept (one vertical stroke)');
  assert.ok(Math.abs(f.ink[seen.id].first[0] - f.ink[seen.id].last[0]) < 20 && f.ink[seen.id].last[1] > f.ink[seen.id].first[1] + 100, 'it is the vertical stroke');
  const yong = f.records.find(r => r.char === '永');
  assert.deepEqual([yong.kind, yong.judgment, !!f.sched['base:永']], ['answer-seen', undefined, false], 'no judgment, no FSRS entry (D18)');

  step('和: write → 写对了 → result page');
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-done'));
  await page.waitForSelector(topSel('write-judge-correct'));
  await waitPhase(page, 'compare');
  await page.click(topSel('write-judge-correct'));
  await checkResult(page, ctx, seen.id, 'result page');

  step('reload on the result page → 看后写的 cell and its ink are still there');
  await page.reload();
  await page.waitForSelector('.sz-app');
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  await checkResult(page, ctx, seen.id, 'after reload');

  step('cold start (new browser context with the same storage) → still there');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
  });
  const storageState = await page.context().storageState();
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: ctx.viewport, deviceScaleFactor: 2, locale: 'zh-CN', storageState });
  const p2 = await context.newPage();
  const errors = [];
  p2.on('pageerror', e => errors.push(`pageerror: ${e && e.message}`));
  p2.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  try {
    await bootTestHost(p2, ctx.baseURL, { coldRoute: true });
    const top = await p2.evaluate(() => document.querySelector('.sz-app').dataset.topScreen);
    if (top !== 'result') {
      // 冷启动没把结果页恢复出来时（路由记忆按 P108 判定），从 lastEnded 打开同一组的结果页
      await p2.evaluate(async id => {
        const { nav } = await import('/src/ui/router.js');
        nav.push('result', { slot: 'A', sessionId: id });
      }, seen.sessionId);
    }
    await checkResult(p2, ctx, seen.id, 'after cold start');
    const g = await facts(p2);
    assert.deepEqual(Object.keys(g.ink).sort(), Object.keys(f.ink).concat(g.records.filter(r => r.char === '和').map(r => r.id)).sort(),
      'after cold start: the stored ink is 永 (看后写的) + 和 (写对)');
    assert.deepEqual(errors, [], 'cold-start process: no pageerror / console.error');
  } finally {
    await context.close();
  }
}
