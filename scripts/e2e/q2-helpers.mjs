// 阶段 1 Q2 小缺陷卡共用的 e2e 辅助（不是 spec：run.mjs 只加载 *.spec.js）。
//
//   seedEndedGroup(page, {chars:[{c, judgment, ink}], clock, id})   造一个已结束的组（lastEnded.A），写字用真实 mutator judgeInDraft；返回 {ok, id}
//   openResultOf(page, id)                                          nav.push('result', {slot:'A', sessionId}) 并等 idle
//   openSharePreview(page, id)                                      打开结果页再点右上「分享」，等预览 ready；返回后弹层在顶层
//   goHomeTab(page)                                                 回首页 tab 并等 idle

import { PRESS_SETTLE_MS, topSel, waitNavIdle } from './helpers.mjs';

export async function seedEndedGroup(page, { chars, clock = '2026-09-24T20:00:00', id = 's90', extraState = null } = {}) {
  const res = await page.evaluate(async ({ chars: cs, clock: ck, id: sid, extra }) => {
    const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
    const { createSession, endSlot } = await import('/src/core/sessions.js');
    window.__shiziTest.reset();
    window.__shiziTest.setClock(ck);
    const now = window.__shiziTest.now();
    const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} }, ...(extra || {}) };
    let n = 0;
    const nextId = p => p + (n += 1);
    const stroke = [
      [{ x: 60, y: 120, t: 0 }, { x: 170, y: 121, t: 60 }, { x: 280, y: 122, t: 120 }],
      [{ x: 172, y: 60, t: 400 }, { x: 173, y: 170, t: 460 }, { x: 174, y: 290, t: 520 }],
    ];
    const t0 = now - 3600000;
    draft.sessions.A = createSession({ id: sid, kind: 'daily', source: { view: 'home' }, queue: cs.map(x => 'base:' + x.c), at: t0 });
    cs.forEach((x, i) => {
      judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + x.c, judgment: x.judgment || 'correct', strokes: stroke, at: t0 + (i + 1) * 1000, nextId, perRecordInk: x.ink !== false });
    });
    draft.sessions = endSlot(draft.sessions, 'A', { at: t0 + (cs.length + 1) * 1000 });
    const r = window.__shiziTest.seed(draft);
    return { ok: !!(r && r.ok), r };
  }, { chars, clock, id, extra: extraState });
  if (!res.ok) throw new Error('seed failed: ' + JSON.stringify(res.r));
  return { ok: true, id };
}

export async function goHomeTab(page) {
  await page.evaluate(async () => (await import('/src/ui/router.js')).nav.switchTab('home'));
  await page.waitForFunction(() => document.querySelector('.sz-app').dataset.topScreen === 'home');
  await waitNavIdle(page);
}

export async function openResultOf(page, id = 's90') {
  await page.evaluate(async sid => (await import('/src/ui/router.js')).nav.push('result', { slot: 'A', sessionId: sid }), id);
  await page.waitForSelector(topSel('result-screen'));
  await waitNavIdle(page);
}

export async function openSharePreview(page, id = 's90') {
  await openResultOf(page, id);
  await page.click(topSel('result-share'));
  await page.waitForFunction(() => {
    const r = document.querySelector('[data-testid="image-preview"]');
    return !!r && r.dataset.state === 'ready';
  });
  await page.waitForTimeout(PRESS_SETTLE_MS);
}
