// 作品出口 e2e 共用辅助（阶段 1 P1-E7；不是 spec：run.mjs 只加载 *.spec.js）。
//
//   seedWork(page, {kind, chars, steps, ...})   造一组（真实 mutator）并 seed 成「已结束、停在 lastEnded」的会话；返回 {sessionId, slot, records}
//        steps[i] 对应 chars[i]：'correct' | 'wrong'（有墨）、'correct-noink' | 'wrong-noink'（判断了但没墨）、'skip'、
//        'seen'（看过答案没写）、'seen-ink'（看过答案后自己写了一遍，墨存在 answer-seen 记录上）、
//        'paper-correct' | 'paper-wrong'（历史上在纸上写、回来自判的记录：source:'paper'、没有墨，P1-E78；D63 起 App 不再产生，这里手写一条旧记录，用来核对历史展示仍照常）
//   openResultPage(page, {slot, sessionId})     push 结果页并等 idle
//   resultSnapshot(page)                        作品 / 行 / 页头分享的现状
//   seedMonthRecords(page, {month, entries})    往某月塞若干天的有墨 / 无墨记录（月字帖、年报用）
import { tid, topSel, waitNavIdle } from './helpers.mjs';

export async function seedWork(page, { id = 's40', kind = 'daily', slot = 'A', chars, steps, source = { view: 'home' }, clock = null, endedAt = null, extraDraft = null }) {
  const res = await page.evaluate(async o => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { skipInDraft } = await import('/src/ui/screens/write/skip.js');
    const { appendRecordToDraft } = await import('/src/ui/screens/write/answer.js');
    const { makeRecord } = await import('/src/core/records.js');
    const { advance, createSession, endSlot } = await import('/src/core/sessions.js');
    const { applyJudgment } = await import('/src/core/fsrs.js');
    const { buildStroke, encodeInk } = await import('/src/core/ink-math.js');
    const { setInk } = await import('/src/store/store.js');
    window.__shiziTest.reset();
    if (o.clock) window.__shiziTest.setClock(o.clock);
    const now = window.__shiziTest.now();
    const s = createSession({ id: o.id, kind: o.kind, source: o.source, queue: o.chars.map(c => 'base:' + c), at: now - 120000 });
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    draft.sessions[o.slot] = s;
    let n = 100;
    const nextId = p => p + (n += 1);
    const strokes = [
      [{ x: 60, y: 120, t: 0 }, { x: 170, y: 121, t: 60 }, { x: 280, y: 122, t: 120 }],
      [{ x: 172, y: 60, t: 400 }, { x: 173, y: 170, t: 460 }, { x: 174, y: 290, t: 520 }],
    ];
    const ids = [];
    o.steps.forEach((step, i) => {
      const cur = draft.sessions[o.slot];
      const key = cur.queue[cur.cursor];
      const at = now - 100000 + i * 1000;
      if (step === 'correct' || step === 'wrong') {
        ids.push(judgeInDraft(draft, { slot: o.slot, cardKey: key, judgment: step, strokes, at, nextId, perRecordInk: true }).record.id);
      } else if (step === 'correct-noink' || step === 'wrong-noink') {
        ids.push(judgeInDraft(draft, { slot: o.slot, cardKey: key, judgment: step.split('-')[0], strokes, at, nextId, perRecordInk: false }).record.id);
      } else if (step === 'paper-correct' || step === 'paper-wrong') {
        const rec = makeRecord({ id: nextId('r'), cardKey: key, sessionId: cur.id, kind: 'judged', judgment: step.split('-')[1], at, source: 'paper',
          help: { hints: 0, answerSeen: false, traced: false } });
        appendRecordToDraft(draft, rec);
        const { entry, fsrsBefore } = applyJudgment(draft.sched ? draft.sched[key] : undefined, rec, {});
        draft.sched = { ...(draft.sched || {}), [key]: entry };
        draft.sessions[o.slot] = advance(cur, { cardKey: key, recordId: rec.id, kind: 'judged', fsrsBefore, at });
        ids.push(rec.id);
      } else if (step === 'skip') {
        ids.push(skipInDraft(draft, { slot: o.slot, cardKey: key, at, nextId }).record.id);
      } else {
        const r = makeRecord({ id: nextId('r'), cardKey: key, sessionId: cur.id, kind: 'answer-seen', at, help: { hints: 0, answerSeen: true, traced: false } });
        appendRecordToDraft(draft, r);
        if (step === 'seen-ink') setInk(draft, r, encodeInk(strokes.map(raw => buildStroke(raw, { final: true })), {}));
        draft.sessions[o.slot] = advance(cur, { cardKey: key, recordId: r.id, kind: 'answer-seen', at });
        ids.push(r.id);
      }
    });
    draft.sessions = endSlot(draft.sessions, o.slot, { at: o.endedAt || now - 1000 });
    if (o.extraDraft) Object.assign(draft, o.extraDraft);
    const r = window.__shiziTest.seed(draft);
    const st = window.__shiziTest.getState();
    const records = [];
    for (const v of Object.values(st.records || {})) for (const x of Array.isArray(v) ? v : (v && v.kept) || []) records.push(x);
    return { ok: !!(r && r.ok), r, ids, records };
  }, { id, kind, slot, chars, steps, source, clock, endedAt, extraDraft });
  if (!res.ok) throw new Error('seedWork failed: ' + JSON.stringify(res.r));
  return { sessionId: id, slot, ids: res.ids, records: res.records };
}

export async function openResultPage(page, { slot = 'A', sessionId }) {
  await page.evaluate(async o => {
    const { nav } = await import('/src/ui/router.js');
    nav.push('result', o);
  }, { slot, sessionId });
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
  await page.waitForFunction(() => {
    const cs = [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="work-canvas"], .sz-layer[data-top="true"] [data-testid="result-exrow-canvas"]')];
    return cs.every(c => c.dataset.painted === 'true');
  });
}

export async function resultSnapshot(page) {
  return page.evaluate(() => {
    const top = document.querySelector('.sz-layer[data-top="true"]');
    const q = id => (top ? top.querySelector(`[data-testid="${id}"]`) : null);
    const all = id => (top ? [...top.querySelectorAll(`[data-testid="${id}"]`)] : []);
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    };
    const work = q('work');
    return {
      work: work ? {
        n: Number(work.dataset.n), cols: Number(work.dataset.cols), rows: Number(work.dataset.rows), cell: Number(work.dataset.cell),
        variant: work.dataset.variant || '', label: work.getAttribute('aria-label'), rect: rect(work),
      } : null,
      cells: all('work-cell').map(c => ({
        index: Number(c.dataset.index), ch: c.dataset.char, mode: c.dataset.mode, dot: c.dataset.dot, state: c.dataset.state, label: c.getAttribute('aria-label'),
        rect: rect(c), hasDot: !!c.querySelector('[data-testid="work-dot"]'),
      })),
      caps: all('work-cap').map(c => c.textContent.trim()),
      kuan: q('work-kuan') ? q('work-kuan').textContent.trim() : null,
      seal: rect(q('work-seal')),
      sign: q('work-sign') ? { below: q('work-sign').dataset.below, rect: rect(q('work-sign')) } : null,
      rows: all('result-exrow').map(r => ({
        ch: r.dataset.char, state: r.dataset.state, text: r.querySelector('.sz-exrow__t').textContent.trim(),
        aria: r.querySelector('[data-testid="result-exrow-open"]').getAttribute('aria-label'),
        add: r.querySelector('[data-testid="result-add"]') ? { text: r.querySelector('[data-testid="result-add"]').textContent.trim() } : null,
      })),
      share: !!q('result-share'),
      preview: q('result-preview') ? q('result-preview').textContent.trim() : null,
      title: q('result-title') ? q('result-title').textContent.trim() : null,
      foot: rect(top && top.querySelector('.sz-page__foot')),
      body: rect(top && top.querySelector('.sz-page__body')),
      bodyScroll: top && top.querySelector('.sz-page__body') ? { sh: top.querySelector('.sz-page__body').scrollHeight, ch: top.querySelector('.sz-page__body').clientHeight } : null,
    };
  });
}

/** 给某月塞记录：entries = [{day:'2026-09-02', chars:'永山', ink:true|false}]；每个字一条 judged（correct），一个会话一天。 */
export async function seedMonthRecords(page, { entries, clock = '2026-09-24T20:00:00', extraDraft = null }) {
  const res = await page.evaluate(async o => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession } = await import('/src/core/sessions.js');
    window.__shiziTest.reset();
    window.__shiziTest.setClock(o.clock);
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
    let n = 0;
    const nextId = p => p + (n += 1);
    const stroke = [
      [{ x: 60, y: 120, t: 0 }, { x: 170, y: 121, t: 60 }, { x: 280, y: 122, t: 120 }],
      [{ x: 172, y: 60, t: 400 }, { x: 173, y: 170, t: 460 }, { x: 174, y: 290, t: 520 }],
    ];
    for (const e of o.entries) {
      const at0 = new Date(`${e.day}T09:00:00`).getTime();
      [...e.chars].forEach((ch, i) => {
        const at = at0 + i * 1000;
        draft.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + ch], at });
        judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + ch, judgment: 'correct', strokes: stroke, at, nextId, perRecordInk: e.ink !== false });
        draft.sessions.A = null;
      });
    }
    if (o.extraDraft) Object.assign(draft, o.extraDraft);
    const r = window.__shiziTest.seed(draft);
    return { ok: !!(r && r.ok), r };
  }, { entries, clock, extraDraft });
  if (!res.ok) throw new Error('seedMonthRecords failed: ' + JSON.stringify(res.r));
}

export { tid, topSel };
