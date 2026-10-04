// M1-4 看答案 / 描一遍 / 自己写（02 §3 M1-4；决定-D18；01 §3.2 / §3.3 / §6.5；04 R-W07 / R-W08；走查-W19）。
// seed 一个 A 会话（永 / 和 / 春）→ 没落笔就点「看答案」→ 确认框文案 R-W07 →「接着想」不记任何事 →
// failNextWrite(1,{kind:'generic'}) 时确认写失败留在确认框（三段式）→「再试一次」成功才进看答案页，记录恰好一条
// kind='answer-seen'，今日 N（judged 去重）仍为 0 → 描一遍（先播一遍、落笔即跳过、help.traced）→ 描好了，自己写 →
// 再描一遍 → 自己写 →「下一个」推进（item kind='answer-seen'、结果行 saw），全程不进判断页（compare）→
// 第二字：看答案页「自己写」直达、「下一个」写失败留现场可重试 → 第三字：看答案页底部「下一个」直接推进 →
// 10.13 无笔顺数据：楷体整字、照实记 answer-seen、描一遍浅色整字不播 → 减少动态效果：看答案直接终态。
// 控制台零错误由 run.mjs 统一断言（10.13 段的 404 请求显式放行）。

import {
  bootTestHost, drawStroke, HORIZONTAL, localDayOf, PRESS_SETTLE_MS, seedSession, tid, topSel, VERTICAL,
  waitNavIdle, writeSnapshot, openWrite,
} from './helpers.mjs';

const COPY = {
  link: '看答案',
  confirmBody: '看了答案，这个字就记为看过答案。',
  keepThinking: '接着想',
  show: '看答案',
  saveFailed: '没保存上，你写的字还在。',
  retry: '再试一次',
  notNow: '先不保存',
  answerNote: '这个字记为看过答案，后面再写只算练习。',
  self: '自己写',
  trace: '描一遍',
  next: '下一个',
  traceDone: '描好了，自己写',
  retrace: '再描一遍',
  selfNote: '这个字看过答案了，再写只算练习。',
  traceNote: '浅色是参考字形。',
  titleRecall: '凭记忆写出这个字',
  titleAnswer: '这个字这样写',
  titleTrace: '描一遍',
  titleSelf: '自己写一遍',
  stepTrace: '第 1 步，共 2 步：描一遍',
  stepSelf: '第 2 步，共 2 步：自己写',
};

const CHARS = ['永', '和', '春'];

/** 记录（全部月份展平）、会话 A、今日 N（judged 按字去重，core/records.todayCount）。 */
async function facts(page) {
  return page.evaluate(async () => {
    const { todayCount, answerSeenCardKeysOn, judgedCardKeysOn } = await import('/src/core/records.js');
    const st = window.__shiziTest.getState();
    const records = [];
    for (const m of Object.keys(st.records || {})) {
      const v = st.records[m];
      for (const r of Array.isArray(v) ? v : (v && v.kept) || []) records.push(r);
    }
    const now = window.__shiziTest.now();
    const d = new Date(now);
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      records,
      session: st.sessions ? st.sessions.A || (st.sessions.lastEnded || {}).A || null : null, // 写完后移入 lastEnded（M2-3）
      todayN: todayCount(records, today),
      judgedToday: [...judgedCardKeysOn(records, today)],
      answerSeenToday: [...answerSeenCardKeysOn(records, today)],
      sched: st.sched,
      ink: st.ink,
    };
  });
}

async function text(page, id) {
  const el = page.locator(topSel(id));
  return (await el.count()) ? (await el.first().textContent()).trim() : null;
}

async function visible(page, id) {
  const el = page.locator(topSel(id));
  return (await el.count()) > 0 && el.first().isVisible();
}

/** 按钮文字（顶层图层里 data-testid=id 的按钮）。 */
async function label(page, id) {
  return text(page, id);
}

async function confirmState(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="write-answer-confirm"]');
    if (!panel) return null;
    const body = panel.querySelector('.sz-confirm__body');
    const btn = id => panel.querySelector(`[data-testid="${id}"]`);
    return {
      body: body ? body.textContent : null,
      cancel: btn('confirm-cancel') ? btn('confirm-cancel').textContent.trim() : null,
      ok: btn('confirm-ok') ? btn('confirm-ok').textContent.trim() : null,
      role: panel.getAttribute('role'),
      html: panel.outerHTML,
    };
  });
}

async function waitPhase(page, phase) {
  await page.waitForFunction(p => {
    const top = document.querySelector('.sz-layer[data-top="true"] .sz-write');
    return !!top && top.dataset.phase === p;
  }, phase);
  await page.waitForTimeout(PRESS_SETTLE_MS); // 换阶段 = 新状态，按钮 0.4s 不响应
}

async function waitAttr(page, id, attr, values, timeout = 15000) {
  await page.waitForFunction(({ id: i, attr: a, values: vs }) => {
    const el = document.querySelector(`.sz-layer[data-top="true"] [data-testid="${i}"]`);
    return !!el && vs.includes(el.getAttribute(a));
  }, { id, attr, values }, { timeout });
  return page.getAttribute(topSel(id), attr);
}

async function openConfirm(page) {
  await page.click(topSel('write-show-answer'));
  await page.waitForSelector(tid('write-answer-confirm'));
  await waitNavIdle(page);
}

async function confirmClosed(page) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-answer-confirm"]'));
  await waitNavIdle(page);
}

export default async function answer(page, ctx) {
  const { assert } = ctx;
  const phasesSeen = new Set();
  const track = async () => {
    const s = await writeSnapshot(page);
    if (s.phase) phasesSeen.add(s.phase);
    return s;
  };

  ctx.step('seed an A session (永 / 和 / 春) and open the write screen');
  await bootTestHost(page, ctx.baseURL);
  const seeded = await seedSession(page, { slot: 'A', kind: 'daily', chars: CHARS, cursor: 0 });
  assert.ok(seeded.ok, 'seed accepted');
  await openWrite(page, { slot: 'A' });
  let s = await track();
  assert.equal(s.phase, 'recall', 'starts in recall');
  assert.equal(await label(page, 'write-show-answer'), COPY.link, 'recall shows the 「看答案」 text button (R-W07.btnShowAnswer)');
  assert.ok(await page.isVisible(topSel('write-done')), 'recall footer is the normal one (「写好了」 present)');

  ctx.step('看答案 → centred confirm with R-W07 copy; the answer character is not in it (D16)');
  await openConfirm(page);
  let c = await confirmState(page);
  assert.equal(c.body, COPY.confirmBody, 'confirm body R-W07.confirmBody');
  assert.deepEqual([c.cancel, c.ok], [COPY.keepThinking, COPY.show], 'buttons 接着想 / 看答案');
  assert.equal(c.role, 'alertdialog', 'confirm is an alertdialog');
  assert.deepEqual(CHARS.filter(ch => c.html.includes(ch)), [], 'no answer character in the confirm');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
  assert.ok(focused !== 'confirm-ok' && focused !== 'confirm-cancel', 'no button preselected in the confirm');

  ctx.step('接着想 → nothing recorded, still recall');
  await page.click(topSel('confirm-cancel'));
  await confirmClosed(page);
  let f = await facts(page);
  assert.equal(f.records.length, 0, 'no record after 接着想');
  assert.equal(f.session.current.phase, 'recall', 'session phase still recall');
  s = await track();
  assert.equal(s.phase, 'recall', 'screen still recall');

  ctx.step('failNextWrite(1,{generic}) → confirming fails → stays in the confirm with the three-part failure copy');
  await openConfirm(page);
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(topSel('confirm-ok'));
  await page.waitForTimeout(PRESS_SETTLE_MS);
  c = await confirmState(page);
  assert.ok(!!c, 'confirm still open after the failed write');
  assert.equal(c.body, COPY.saveFailed, 'body switches to 「没保存上，你写的字还在。」 (R-W16 / R-G04)');
  assert.deepEqual([c.cancel, c.ok], [COPY.notNow, COPY.retry], 'buttons 先不保存 / 再试一次');
  f = await facts(page);
  assert.equal(f.records.length, 0, 'failed write recorded nothing');
  assert.equal(f.session.current.phase, 'recall', 'failed write did not change the session');
  assert.equal(f.session.current.answerSeen, false, 'answerSeen still false');
  const recordWrites = await page.evaluate(() => window.__shiziTest.getWriteLog()
    .filter(e => e.ok && e.op === 'set' && e.key.startsWith('shizi.v2.records.')).length);
  assert.equal(recordWrites, 0, 'no records key was written (rolled back / never published)');

  ctx.step('再试一次 → succeeds → answer page; exactly one answer-seen record, not judged, today N = 0');
  await page.click(topSel('confirm-ok'));
  await confirmClosed(page);
  await waitPhase(page, 'answer');
  s = await track();
  assert.equal(s.title, COPY.titleAnswer, 'title R-W03.titleAnswer');
  f = await facts(page);
  assert.equal(f.records.length, 1, 'exactly one record after the retry');
  const rec1 = f.records[0];
  assert.equal(rec1.kind, 'answer-seen', "record kind === 'answer-seen'");
  assert.equal(rec1.cardKey, 'base:永', 'record is for 永');
  assert.equal(rec1.sessionId, 's1', 'record carries the session id');
  assert.equal(rec1.judgment, undefined, 'answer-seen has no judgment');
  assert.deepEqual(rec1.help, { hints: 0, answerSeen: true, traced: false }, 'help facts: answerSeen true, hints 0, traced false');
  assert.equal(rec1.localDay, localDayOf(rec1.at), 'localDay derived from at');
  assert.equal(f.todayN, 0, '今日 N (judged, deduped by char) does not count answer-seen');
  assert.deepEqual(f.judgedToday, [], 'no judged record today');
  assert.deepEqual(f.answerSeenToday, ['base:永'], 'answer-seen is listed as its own event');
  assert.ok(!f.sched || Object.keys(f.sched).length === 0, 'sched (FSRS) untouched by answer-seen');
  assert.deepEqual(f.ink, {}, 'no ink written for answer-seen');
  assert.equal(f.session.current.phase, 'answer', "session.current.phase === 'answer'");
  assert.equal(f.session.current.answerSeen, true, 'session.current.answerSeen === true');
  assert.equal(f.session.lastLine, null, 'result line collapsed on confirming (D19)');
  assert.equal(f.session.cursor, 0, 'cursor not advanced yet');

  ctx.step('answer page: card plays the glyph, R-W07 note and buttons, 下一个 link; no judge / write-done');
  const anim = await waitAttr(page, 'write-answer-card', 'data-anim', ['completed', 'static', 'failed']);
  assert.equal(await page.getAttribute(topSel('write-answer-card'), 'data-state'), 'ready', 'stroke data ready');
  assert.equal(anim, 'completed', 'hanzi-writer play finished (final state = full glyph)');
  assert.ok(await page.locator(`${topSel('write-answer-card')} svg path`).count() > 0, 'glyph strokes drawn in the card');
  const card = await page.locator(topSel('write-answer-card')).boundingBox();
  assert.equal(Math.round(card.width), 353, 'answer card is 353 wide at 393×852 (same geometry as the grid: screen width − 40, D36 / P1-E1b gutter 20)');
  assert.equal(await text(page, 'write-answer-note'), COPY.answerNote, 'note above buttons R-W07.answerNote');
  assert.deepEqual([await label(page, 'write-answer-self'), await label(page, 'write-answer-trace')], [COPY.self, COPY.trace],
    'buttons 自己写 / 描一遍');
  assert.equal(await label(page, 'write-answer-next'), COPY.next, 'bottom link 下一个');
  assert.equal(await visible(page, 'write-done'), false, 'no 「写好了」 on the answer page');
  assert.equal(await visible(page, 'write-show-answer'), false, 'no second 「看答案」');
  assert.equal(await visible(page, 'write-grid'), false, 'grid replaced by the answer card');

  ctx.step('描一遍 → trace: outline + preview animation, R-W08 note, step dot 1, traced fact recorded');
  await page.click(topSel('write-answer-trace'));
  await waitPhase(page, 'trace');
  s = await track();
  assert.equal(s.title, COPY.titleTrace, 'title 描一遍');
  assert.equal(await page.getAttribute(topSel('write-steps'), 'aria-label'), COPY.stepTrace, 'step dots R-W04.stepTrace');
  assert.equal(await text(page, 'write-note'), COPY.traceNote, 'grid note 浅色是参考字形。');
  assert.equal(s.strokes, 0, 'trace starts with an empty grid');
  assert.equal(await label(page, 'write-trace-done'), COPY.traceDone, 'main button 描好了，自己写');
  assert.deepEqual(s.done, null, 'no 「写好了」 in trace');
  const traceDone0 = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="write-trace-done"]').disabled);
  assert.equal(traceDone0, true, '描好了 disabled before writing');
  assert.equal(await label(page, 'write-answer-next'), COPY.next, '下一个 link in trace');
  assert.equal(await page.getAttribute(topSel('write-trace-layer'), 'data-state'), 'ready', 'trace layer has stroke data');
  assert.equal(await page.getAttribute(topSel('write-trace-layer'), 'data-anim'), 'running', 'preview (先播一遍) is running (走查-W19)');
  f = await facts(page);
  assert.equal(f.records.length, 1, 'still one record');
  assert.equal(f.records[0].help.traced, true, 'entering trace sets help.traced on the same record');
  assert.equal(f.session.current.phase, 'trace', 'session phase trace');

  ctx.step('pen-down during the preview skips it; the stroke still counts');
  await drawStroke(page, HORIZONTAL);
  assert.equal(await waitAttr(page, 'write-trace-layer', 'data-anim', ['skipped', 'completed']), 'skipped', 'preview skipped by writing');
  s = await track();
  assert.equal(s.strokes, 1, 'stroke on the trace grid');
  const traceDone1 = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="write-trace-done"]').disabled);
  assert.equal(traceDone1, false, '描好了 enabled after writing');

  ctx.step('描好了，自己写 → retrace: empty grid, R-W07 self note, 再描一遍 / 下一个, no skip link');
  await page.click(topSel('write-trace-done'));
  await waitPhase(page, 'retrace');
  s = await track();
  assert.equal(s.title, COPY.titleSelf, 'title 自己写一遍');
  assert.equal(await page.getAttribute(topSel('write-steps'), 'aria-label'), COPY.stepSelf, 'step dots R-W04.stepSelf');
  assert.equal(s.strokes, 0, 'retrace starts empty');
  assert.equal(await text(page, 'write-note'), COPY.selfNote, 'grid note R-W07.selfNote');
  assert.deepEqual([await label(page, 'write-retrace-trace'), await label(page, 'write-answer-next')], [COPY.retrace, COPY.next],
    'buttons 再描一遍 / 下一个');
  assert.equal(await page.locator(topSel('write-answer-next')).count(), 1, 'only one 下一个 (no skip-row link in retrace)');
  assert.equal(await visible(page, 'write-trace-layer'), false, 'no trace outline in retrace');

  ctx.step('write in retrace, 再描一遍 → trace again (fresh grid, preview replays), 描好了 → retrace');
  await drawStroke(page, VERTICAL);
  s = await track();
  assert.equal(s.strokes, 1, 'one stroke in retrace');
  await page.click(topSel('write-retrace-trace'));
  await waitPhase(page, 'trace');
  s = await track();
  assert.equal(s.strokes, 0, 'back in trace with an empty grid');
  assert.ok(['running', 'completed'].includes(await page.getAttribute(topSel('write-trace-layer'), 'data-anim')), 'preview plays again');
  await drawStroke(page, HORIZONTAL);
  await page.click(topSel('write-trace-done'));
  await waitPhase(page, 'retrace');
  f = await facts(page);
  assert.equal(f.records.length, 1, 'phase switches never add records');

  ctx.step('下一个 → next character in recall; item kind answer-seen, result line saw; never went to compare');
  await page.click(topSel('write-answer-next'));
  await waitPhase(page, 'recall');
  s = await track();
  assert.equal(s.cursor, 1, 'cursor advanced to 1');
  assert.equal(s.progress, '2 / 3', 'progress 2 / 3');
  assert.equal(s.title, COPY.titleRecall, 'title back to recall');
  assert.equal(s.strokes, 0, 'new character starts empty');
  f = await facts(page);
  assert.equal(f.records.length, 1, 'still exactly one record (下一个 adds none)');
  assert.deepEqual(f.session.items, [{ cardKey: 'base:永', kind: 'answer-seen', recordId: rec1.id }], 'item recorded as answer-seen');
  assert.deepEqual(f.session.lastLine, { recordId: rec1.id, kind: 'saw' }, "result line {kind:'saw'} (「永」记为看过答案)");
  assert.equal(f.session.current.answerSeen, false, 'fresh current for the next character');
  assert.equal(f.todayN, 0, '今日 N still 0');
  assert.equal(await label(page, 'write-show-answer'), COPY.link, '看答案 available again for the new character');

  ctx.step('第二字: confirm → 自己写 goes straight to retrace (traced stays false)');
  await openConfirm(page);
  await page.click(topSel('confirm-ok'));
  await confirmClosed(page);
  await waitPhase(page, 'answer');
  await page.click(topSel('write-answer-self'));
  await waitPhase(page, 'retrace');
  f = await facts(page);
  assert.equal(f.records.length, 2, 'second answer-seen record');
  assert.equal(f.records[1].cardKey, 'base:和', 'record for 和');
  assert.equal(f.records[1].help.traced, false, '自己写 without 描一遍 → traced false');

  ctx.step('下一个 write fails → stays in retrace with 先不保存 / 再试一次; 先不保存 → back; 下一个 again → advances');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(topSel('write-answer-next'));
  await page.waitForSelector(`${topSel('write-answer-foot')}[data-failed="true"]`);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  s = await track();
  assert.equal(s.cursor, 1, 'failed 下一个 did not advance');
  assert.equal(s.phase, 'retrace', 'still retrace');
  assert.equal(await text(page, 'write-note'), COPY.saveFailed, 'note 没保存上，你写的字还在。');
  assert.deepEqual([await label(page, 'write-answer-fail-cancel'), await label(page, 'write-answer-fail-retry')], [COPY.notNow, COPY.retry],
    'buttons 先不保存 / 再试一次');
  f = await facts(page);
  assert.equal(f.session.cursor, 1, 'session cursor unchanged in storage');
  assert.equal(f.session.items.length, 1, 'no item added by the failed write');
  await page.click(topSel('write-answer-fail-cancel'));
  await page.waitForSelector(`${topSel('write-answer-foot')}[data-failed="false"]`);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  assert.equal(await text(page, 'write-note'), COPY.selfNote, '先不保存 → normal retrace note');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(topSel('write-answer-next'));
  await page.waitForSelector(`${topSel('write-answer-foot')}[data-failed="true"]`);
  await page.waitForTimeout(PRESS_SETTLE_MS);
  await page.click(topSel('write-answer-fail-retry'));
  await waitPhase(page, 'recall');
  s = await track();
  assert.equal(s.cursor, 2, '再试一次 → advanced to the third character');
  f = await facts(page);
  assert.equal(f.session.items.length, 2, 'exactly one item for 和 (retry did not duplicate)');
  assert.equal(f.records.length, 2, 'still two records');

  ctx.step('第三字: answer page bottom 下一个 advances directly; session complete');
  await openConfirm(page);
  await page.click(topSel('confirm-ok'));
  await confirmClosed(page);
  await waitPhase(page, 'answer');
  await page.click(topSel('write-answer-next'));
  await page.waitForFunction(() => {
    const st = window.__shiziTest.getState();
    const s = st.sessions.A || (st.sessions.lastEnded || {}).A; // 写完后移入 lastEnded、换成结果页（M2-3）
    return !!s && s.cursor === 3;
  });
  f = await facts(page);
  assert.equal(f.records.filter(r => r.kind === 'answer-seen').length, 3, 'three answer-seen records');
  assert.equal(f.records.filter(r => r.kind === 'judged').length, 0, 'no judged record anywhere');
  assert.deepEqual(f.session.items.map(i => i.kind), ['answer-seen', 'answer-seen', 'answer-seen'], 'three answer-seen items');
  assert.equal(f.todayN, 0, '今日 N = 0 after three answer-seen characters');
  assert.equal(phasesSeen.has('compare'), false, 'the flow never entered the judge page (compare)');
  const direct = await page.evaluate(() => window.__shiziTest.getWriteLog().filter(e => e.via === 'direct'));
  assert.deepEqual(direct, [], 'every localStorage write went through storage.js');

  ctx.step('10.13: no stroke data (404) → Kai full glyph DOM text, answer-seen recorded as-is, trace uses the light full glyph');
  const NODATA = '国';
  ctx.allowConsoleError(new RegExp(`^http 404: .*/data/(${NODATA}|${encodeURIComponent(NODATA)})\\.json$`));
  ctx.allowConsoleError(/^console\.error: Failed to load resource: the server responded with a status of 404/);
  await page.route('**/data/*.json', route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    if (name === `${NODATA}.json`) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' });
    return route.continue();
  });
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
  await waitNavIdle(page);
  const seeded2 = await seedSession(page, { slot: 'A', kind: 'daily', chars: [NODATA, '春'], cursor: 0, id: 's9' });
  assert.ok(seeded2.ok, 'seeded a session whose first character has no stroke data');
  await openWrite(page, { slot: 'A' });
  await openConfirm(page);
  await page.click(topSel('confirm-ok'));
  await confirmClosed(page);
  await waitPhase(page, 'answer');
  assert.equal(await waitAttr(page, 'write-answer-card', 'data-state', ['missing']), 'missing', 'stroke data missing');
  assert.equal(await page.getAttribute(`${topSel('write-answer-card')} ${tid('write-glyph-fallback')}`, 'data-variant'), 'answer',
    'Kai full glyph fallback (variant answer)');
  assert.equal(await text(page, 'write-glyph-fallback'), NODATA, 'fallback is DOM text of the character');
  assert.equal(await text(page, 'write-answer-note'), COPY.answerNote, 'note R-W08.answerNote');
  f = await facts(page);
  assert.equal(f.records.length, 1, 'answer-seen recorded without stroke data (照实记)');
  assert.equal(f.records[0].kind, 'answer-seen', 'kind answer-seen');
  assert.equal(f.records[0].cardKey, `base:${NODATA}`, 'record for the no-data character');
  await page.click(topSel('write-answer-trace'));
  await waitPhase(page, 'trace');
  assert.equal(await page.getAttribute(topSel('write-trace-layer'), 'data-state'), 'missing', 'trace layer: no data');
  assert.equal(await page.getAttribute(`${topSel('write-trace-layer')} ${tid('write-glyph-fallback')}`, 'data-variant'), 'trace',
    'trace uses the light full glyph (variant trace)');
  assert.equal(await page.getAttribute(topSel('write-trace-layer'), 'data-anim'), 'idle', 'no stroke-order preview without data');
  assert.equal(await text(page, 'write-note'), COPY.traceNote, 'note 浅色是参考字形。');
  await page.unroute('**/data/*.json');

  ctx.step('reduced motion: answer page shows the final glyph immediately (static)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
  await waitNavIdle(page);
  const seeded3 = await seedSession(page, { slot: 'A', kind: 'daily', chars: ['春'], cursor: 0, id: 's12' });
  assert.ok(seeded3.ok, 'seeded a one-character session');
  await openWrite(page, { slot: 'A' });
  await openConfirm(page);
  await page.click(topSel('confirm-ok'));
  await confirmClosed(page);
  await waitPhase(page, 'answer');
  assert.equal(await waitAttr(page, 'write-answer-card', 'data-anim', ['static', 'completed', 'failed']), 'static',
    'reduced motion → static final glyph');
  await page.click(topSel('write-answer-trace'));
  await waitPhase(page, 'trace');
  assert.equal(await waitAttr(page, 'write-trace-layer', 'data-anim', ['static', 'running', 'completed']), 'static',
    'reduced motion → no preview in trace');
  await page.emulateMedia({ reducedMotion: null });
}
