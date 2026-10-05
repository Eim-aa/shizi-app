// M1-4 看答案 / 描一遍 / 自己写（02 §3 M1-4；决定-D18；01 §3.2 / §3.3 / §6.5；04 R-W07 / R-W08；走查-W19）；W1（D34 / D51 ⑧，I2-02 / V2-02）改后：
// seed 一个 A 会话（永 / 和 / 春）→ 先写两笔 → failNextWrite(1) 时点「看答案」写失败弹三段式失败框（先不保存 / 再试一次）→「先不保存」什么都不记 →
// 再点「看答案」**没有任何确认框**、直接进看答案页：记录恰好一条 kind='answer-seen'，今日 N（judged 去重）仍为 0，本人墨（两笔）像素不变、不清空、
// 不换卡，答案字形在书写格的参考字形层里（本人墨下层），第一次格下一行说明并记 settings.answerNoteSeen → 描一遍（快放 ≤ 1.6s、点一下即到终态、
// help.traced）→ 描好了，自己写 → 再描一遍 → 自己写 →「下一个」推进（item kind='answer-seen'、结果行 saw），全程不进判断页（compare）→
// 第二字：看答案页「自己写」直达（第二次起没有格下说明）、「下一个」写失败留现场可重试 → 第三字：描一遍快放 ≤ 1.6s → 10.13 无笔顺数据：楷体整字衬底、
// 照实记 answer-seen、描一遍浅色整字不播 → 减少动态效果：看答案直接终态。控制台零错误由 run.mjs 统一断言（10.13 段的 404 请求显式放行）。

import {
  bootTestHost, drawStroke, HORIZONTAL, localDayOf, PRESS_SETTLE_MS, seedSession, tid, topSel, VERTICAL,
  waitNavIdle, writeSnapshot, openWrite,
} from './helpers.mjs';

const COPY = {
  link: '看答案',
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

/** 点「看答案」：没有确认框，直接进看答案页（D51 ⑧）。 */
async function showAnswer(page) {
  await page.click(topSel('write-show-answer'));
  await waitPhase(page, 'answer');
  assert0(await page.locator(tid('write-answer-confirm')).count() === 0, 'no confirm dialog appeared');
}

function assert0(ok, msg) {
  if (!ok) throw new Error(msg);
}

async function confirmClosed(page) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="write-answer-confirm"]'));
  await waitNavIdle(page);
}

/** 本人墨：固化层 canvas 上最不透明的像素 + 元素与祖先 opacity 连乘。 */
async function inkProbe(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const ink = top.querySelector('[data-testid="write-grid-ink"]');
    let eff = 1;
    for (let el = ink; el && el.nodeType === 1; el = el.parentElement) eff *= Number(getComputedStyle(el).opacity);
    const data = ink.getContext('2d').getImageData(0, 0, ink.width, ink.height).data;
    let best = null;
    let solid = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 200) solid += 1;
      if (!best || data[i + 3] > best[3] || (data[i + 3] === best[3] && data[i] < best[0])) best = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    }
    return { eff, px: best, solid };
  });
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

  ctx.step('write two strokes first: they are the writer\'s own ink that 看答案 must keep');
  await drawStroke(page, HORIZONTAL);
  await drawStroke(page, VERTICAL);
  s = await track();
  assert.equal(s.strokes, 2, 'two strokes on the recall grid');
  const inkRecall = await inkProbe(page);
  assert.ok(inkRecall.solid > 200 && inkRecall.px[3] > 200, `solid ink on the grid (${inkRecall.solid} px)`);

  await page.waitForFunction(() => window.__shiziTest.getState().sessions.A.current.strokes.length === 2); // 抬笔写回会话现场已落盘，免得注入的失败被它吃掉
  ctx.step('failNextWrite(1,{generic}) → 看答案 write fails → three-part failure dialog (先不保存 / 再试一次); nothing recorded, ink untouched');
  await page.evaluate(() => window.__shiziTest.failNextWrite(1, { kind: 'generic' }));
  await page.click(topSel('write-show-answer'));
  await page.waitForSelector(tid('write-answer-confirm'));
  await waitNavIdle(page);
  let c = await confirmState(page);
  assert.equal(c.body, COPY.saveFailed, 'body 「没保存上，你写的字还在。」 (R-W16 / R-G04)');
  assert.deepEqual([c.cancel, c.ok], [COPY.notNow, COPY.retry], 'buttons 先不保存 / 再试一次');
  assert.deepEqual(CHARS.filter(ch => c.html.includes(ch)), [], 'no answer character in the failure dialog (D16)');
  let f = await facts(page);
  assert.equal(f.records.length, 0, 'failed write recorded nothing');
  assert.equal(f.session.current.phase, 'recall', 'failed write did not change the session');
  assert.equal(f.session.current.answerSeen, false, 'answerSeen still false');
  const recordWrites = await page.evaluate(() => window.__shiziTest.getWriteLog()
    .filter(e => e.ok && e.op === 'set' && e.key.startsWith('shizi.v2.records.')).length);
  assert.equal(recordWrites, 0, 'no records key was written (rolled back / never published)');
  assert.deepEqual((await inkProbe(page)).px, inkRecall.px, 'own ink unchanged after the failure');

  ctx.step('先不保存 → dialog closes, still recall, two strokes still there');
  await page.click(topSel('confirm-cancel'));
  await confirmClosed(page);
  s = await track();
  assert.deepEqual([s.phase, s.strokes], ['recall', 2], 'still recall with the ink');
  f = await facts(page);
  assert.equal(f.records.length, 0, 'no record after 先不保存');

  ctx.step('看答案 (no failure) → NO confirm dialog at all: straight to the answer page on the same card, one answer-seen record, today N = 0');
  await page.click(topSel('write-show-answer'));
  await waitPhase(page, 'answer');
  assert.equal(await page.locator(tid('write-answer-confirm')).count(), 0, 'no confirm dialog (D51 ⑧)');
  s = await track();
  assert.equal(s.title, COPY.titleAnswer, 'title R-W03.titleAnswer');
  f = await facts(page);
  assert.equal(f.records.length, 1, 'exactly one record');
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
  assert.equal(f.session.current.strokes.length, 2, 'the writer\'s two strokes are still in the session (not cleared)');
  assert.equal(f.session.lastLine, null, 'result line collapsed on 看答案 (D19)');
  assert.equal(f.session.cursor, 0, 'cursor not advanced yet');

  ctx.step('answer page: same grid, own ink untouched, the answer glyph is drawn UNDER the ink (--under, in the reference layer); no judge / write-done');
  assert.equal(await waitAttr(page, 'write-answer-card', 'data-state', ['ready', 'missing']), 'ready', 'stroke data ready');
  assert.equal(await page.getAttribute(topSel('write-answer-card'), 'data-anim'), 'reveal', 'answer under-layer reveals (400ms)');
  assert.ok(await visible(page, 'write-grid'), 'the writing grid is still there (看答案 does not swap the card, D51 ⑧)');
  assert.equal(await page.getAttribute(topSel('write-grid'), 'data-drawable'), 'false', 'no more writing on the answer page');
  assert.equal(s.strokes, 2, 'the two strokes are still on the grid');
  const layers = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const card = top.querySelector('[data-testid="write-answer-card"]');
    const glyph = top.querySelector('[data-testid="write-glyph-layer"]');
    const ink = top.querySelector('[data-testid="write-grid-ink"]');
    const grid = top.querySelector('[data-testid="write-grid"]');
    const cv = card.querySelector('canvas');
    const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    let rgb = null;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255) { n += 1; if (!rgb) rgb = [data[i], data[i + 1], data[i + 2]]; }
    }
    const probe = document.createElement('span');
    probe.style.color = 'var(--under)';
    document.body.appendChild(probe);
    const under = getComputedStyle(probe).color;
    probe.remove();
    return {
      inGlyphLayer: glyph.contains(card), below: !!(glyph.compareDocumentPosition(ink) & Node.DOCUMENT_POSITION_FOLLOWING),
      cardW: Math.round(card.getBoundingClientRect().width), gridW: Math.round(grid.getBoundingClientRect().width),
      solid: n, rgb: rgb ? `rgb(${rgb.join(', ')})` : null, under,
    };
  });
  assert.deepEqual([layers.inGlyphLayer, layers.below], [true, true], 'answer layer lives in the reference layer, below the ink canvas');
  assert.equal(layers.cardW, layers.gridW - 2, 'answer layer fills the grid inside its 1px frame (same geometry as the hint layer)');
  assert.equal(layers.gridW, 353, 'grid is 353 wide at 393×852 (screen width − 40, D36 / P1-E1b gutter 20)');
  assert.ok(layers.solid > 500, `the answer glyph is drawn (${layers.solid} solid px)`);
  assert.equal(layers.rgb, layers.under, 'answer glyph colour = --under');
  const inkAnswer = await inkProbe(page);
  assert.deepEqual(inkAnswer.px, inkRecall.px, 'darkest ink pixel identical to the recall one: not dimmed, not cleared');
  assert.equal(inkAnswer.solid, inkRecall.solid, 'same number of solid ink pixels');
  assert.equal(inkAnswer.eff, 1, 'ink canvas effective opacity 1');
  assert.equal(await text(page, 'write-note'), '', 'first time: nothing under the grid — the R-W07.firstExplain line is gone (C3-H / N3-06, D53): this very first 看答案 already shows the answer, there is nothing to foretell');
  assert.equal(((await page.evaluate(() => window.__shiziTest.getState().settings)) || {}).answerNoteSeen, undefined, 'settings.answerNoteSeen is no longer written by the UI (the flag stays in the schema only)');
  assert.equal(await text(page, 'write-answer-note'), COPY.answerNote, 'note above buttons R-W07.answerNote');
  // R2-A1（A2-09）：名称与判断页参考卡同一句——字、拼音、笔画数、结构 / 部件数
  assert.ok(/^参考字形：永，yǒng(，\d+ 画(，[^，]+)?)?$/.test(await page.getAttribute(topSel('write-answer-char'), 'aria-label')), 'screen readers get the answer glyph from the footer (the reference layer is aria-hidden)');
  assert.deepEqual([await label(page, 'write-answer-self'), await label(page, 'write-answer-trace')], [COPY.self, COPY.trace],
    'buttons 自己写 / 描一遍');
  assert.equal(await label(page, 'write-answer-next'), COPY.next, 'bottom link 下一个');
  assert.equal(await visible(page, 'write-done'), false, 'no 「写好了」 on the answer page');
  assert.equal(await visible(page, 'write-show-answer'), false, 'no second 「看答案」');

  ctx.step('描一遍 → trace: outline + preview animation, R-W08 note, step dot 1, traced fact recorded');
  await page.evaluate(() => {
    window.__previewLog = [];
    new MutationObserver(() => {
      const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-trace-layer"]');
      if (el) window.__previewLog.push([el.dataset.anim, performance.now()]);
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-anim'], childList: true });
  });
  await page.click(topSel('write-answer-trace'));
  await waitPhase(page, 'trace');
  s = await track();
  assert.equal(s.title, COPY.titleTrace, 'title 描一遍');
  assert.equal(await page.getAttribute(topSel('write-steps'), 'aria-label'), COPY.stepTrace, 'step dots R-W04.stepTrace');
  assert.equal(await text(page, 'write-note'), '', 'no note under the grid in trace (R-W08.traceNote deleted: the trace explains itself)');
  assert.equal(s.strokes, 0, 'trace starts with an empty grid');
  assert.equal(await label(page, 'write-trace-done'), COPY.traceDone, 'main button 描好了，自己写');
  assert.deepEqual(s.done, null, 'no 「写好了」 in trace');
  const traceDone0 = await page.evaluate(() => document.querySelector('.sz-layer[data-top="true"] [data-testid="write-trace-done"]').disabled);
  assert.equal(traceDone0, true, '描好了 disabled before writing');
  assert.equal(await label(page, 'write-answer-next'), COPY.next, '下一个 link in trace');
  assert.equal(await page.getAttribute(topSel('write-trace-layer'), 'data-state'), 'ready', 'trace layer has stroke data');
  const tr = await page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const fill = top.querySelector('[data-testid="write-trace-fill"]');
    const read = cv => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const f = read(fill);
    let lo = [255, 255, 255];
    let hi = [0, 0, 0];
    let solid = 0;
    let faint = 0;
    for (let i = 0; i < f.length; i += 4) {
      if (f[i + 3] === 255) {
        solid += 1;
        for (let k = 0; k < 3; k += 1) { lo[k] = Math.min(lo[k], f[i + k]); hi[k] = Math.max(hi[k], f[i + k]); }
      } else if (f[i + 3] > 0) faint += 1;
    }
    const css = getComputedStyle(document.documentElement).getPropertyValue('--danzhu').trim();
    return {
      solid, faint, spread: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), fillOpacity: getComputedStyle(fill).opacity, ring: !!top.querySelector('[data-testid="write-trace-ring"]'),
      current: top.querySelector('[data-testid="write-trace-layer"]').dataset.current, css,
    };
  });
  assert.ok(tr.solid > 500, `trace fill drawn (${tr.solid} px)`);
  assert.ok(tr.spread <= 2, `D53 ①: one flat danzhu colour (spread ${tr.spread}): the solid current stroke and the hairline hooks are the same hue, overlaps do not darken`);
  assert.equal(tr.fillOpacity, '1', 'the trace layer is opaque (no whole-layer 0.4)');
  assert.ok(tr.faint > 50, `the other strokes are hairline hooks (anti-aliased edge pixels: ${tr.faint})`);
  assert.equal(tr.ring, false, 'no ink3 ring canvas any more');
  assert.equal(tr.current, '0', 'the current stroke is stroke 0 before anything is traced');
  assert.equal(await page.getAttribute(topSel('write-trace-layer'), 'data-anim'), 'running', 'preview (先播一遍) is running (走查-W19)');
  f = await facts(page);
  assert.equal(f.records.length, 1, 'still one record');
  assert.equal(f.records[0].help.traced, true, 'entering trace sets help.traced on the same record');
  assert.equal(f.session.current.phase, 'trace', 'session phase trace');

  ctx.step('pen-down during the preview skips it; the stroke still counts');
  await drawStroke(page, HORIZONTAL);
  assert.equal(await waitAttr(page, 'write-trace-layer', 'data-anim', ['skipped', 'completed']), 'skipped', 'preview skipped by writing');
  assert.equal(await waitAttr(page, 'write-trace-layer', 'data-current', ['1']), '1', 'D53 ①: one stroke traced → the current (solid) stroke moves on to stroke 1; stroke 0 is covered by the own ink, not drawn any more');
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

  ctx.step('write in retrace, 再描一遍 → trace again (fresh grid): the preview does NOT replay for the same character (I3-07), the wash is the end state');
  await drawStroke(page, VERTICAL);
  s = await track();
  assert.equal(s.strokes, 1, 'one stroke in retrace');
  await page.click(topSel('write-retrace-trace'));
  await waitPhase(page, 'trace');
  s = await track();
  assert.equal(s.strokes, 0, 'back in trace with an empty grid');
  await page.waitForTimeout(300);
  assert.equal(await page.getAttribute(topSel('write-trace-layer'), 'data-anim'), 'idle', 'I3-07: no replay of the stroke-order preview for the same character (the first entry played it)');
  assert.equal(await page.getAttribute(topSel('write-trace-layer'), 'data-current'), '0', 'the wash is already the end state: stroke 0 solid');
  assert.equal(await page.getAttribute(topSel('write-trace-done'), 'disabled'), '', '描好了 is disabled until a stroke is written, no waiting for a preview');
  await drawStroke(page, VERTICAL);
  await page.click(topSel('write-trace-done'));
  await waitPhase(page, 'retrace');
  ctx.step('(a fresh first entry, simulated by forgetting the played set) a single tap on the grid jumps the preview straight to its end state (点一下直接到终态)');
  await page.evaluate(async () => (await import('/src/ui/screens/write/answer.js')).forgetTracePreviewed());
  await page.click(topSel('write-retrace-trace'));
  await waitPhase(page, 'trace');
  assert.ok(['running', 'completed'].includes(await page.getAttribute(topSel('write-trace-layer'), 'data-anim')), 'preview plays on a first entry');
  const tapBox = await page.locator(topSel('write-grid')).boundingBox();
  await page.mouse.click(tapBox.x + tapBox.width / 2, tapBox.y + tapBox.height / 2);
  assert.equal(await waitAttr(page, 'write-trace-layer', 'data-anim', ['skipped', 'completed']), 'skipped', 'one tap → preview skipped');
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

  ctx.step('第二字: 看答案 (no confirm, no first-time line) → 自己写 goes straight to retrace (traced stays false)');
  await showAnswer(page);
  assert.equal(await text(page, 'write-note'), '', 'still no one-time explanation');
  assert.equal(await text(page, 'write-answer-note'), COPY.answerNote, 'the consequence line above the buttons stays');
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

  ctx.step('第三字: 看答案 → 描一遍: the stroke-order preview plays in ≤ 1.6s; 下一个 advances directly; session complete');
  await showAnswer(page);
  await page.evaluate(() => {
    window.__previewLog = [];
    new MutationObserver(() => {
      const el = document.querySelector('.sz-layer[data-top="true"] [data-testid="write-trace-layer"]');
      if (el) window.__previewLog.push([el.dataset.anim, performance.now()]);
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-anim'], childList: true });
  });
  await page.click(topSel('write-answer-trace'));
  await waitPhase(page, 'trace');
  assert.equal(await waitAttr(page, 'write-trace-layer', 'data-anim', ['completed', 'skipped']), 'completed', 'the preview ran to the end on its own');
  const log = await page.evaluate(() => window.__previewLog);
  const tRun = (log.find(e => e[0] === 'running') || [])[1];
  const tDone = (log.find(e => e[0] === 'completed') || [])[1];
  assert.ok(Number.isFinite(tRun) && Number.isFinite(tDone), `preview start / end observed (${JSON.stringify(log.map(e => e[0]))})`);
  assert.ok(tDone - tRun <= 1650, `stroke-order quick play ≤ 1.6s (took ${Math.round(tDone - tRun)}ms, 春 = 9 strokes)`);
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
  await showAnswer(page);
  assert.equal(await waitAttr(page, 'write-answer-card', 'data-state', ['missing']), 'missing', 'stroke data missing');
  assert.equal(await page.getAttribute(`${topSel('write-answer-card')} ${tid('write-glyph-fallback')}`, 'data-variant'), 'under',
    'Kai full glyph fallback, in the under-ink colour (variant under)');
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
  assert.equal(await text(page, 'write-note'), '', 'still no trace note without stroke data');
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
  await showAnswer(page);
  assert.equal(await waitAttr(page, 'write-answer-card', 'data-anim', ['static', 'reveal']), 'static',
    'reduced motion → the answer glyph is just there (no 400ms reveal)');
  await page.click(topSel('write-answer-trace'));
  await waitPhase(page, 'trace');
  assert.equal(await waitAttr(page, 'write-trace-layer', 'data-anim', ['static', 'running', 'completed']), 'static',
    'reduced motion → no preview in trace');
  await page.emulateMedia({ reducedMotion: null });
}
