// 首页相关的 e2e 共用辅助（不是 spec）。阶段 1 P1-E5 起，首次打开隐藏「自己选字」，首练完成后才出现（D46 ②）：
// 需要点「自己选字」的老用例先调 markFirstPracticeDone，让首页不再是首次打开，再继续原来的流程。

/**
 * 让首页不再是「首次打开」：在当前 store 状态上补 backupMeta.lastConclusion（清空过记录的结论句，首页按「有过记录」处理，R-H09 / P46），
 * 不碰 records / sessions / sched——老用例里「没有记录」「零判断」之类的断言照旧成立。已经有判断记录或这条结论时什么都不做。
 * 需要真的「写过字」的场景（首页「昨天写的字」等）直接 seed 记录，不用它。返回 seed 的结果。
 */
export async function markFirstPracticeDone(page) {
  const out = await page.evaluate(() => {
    const T = window.__shiziTest;
    const state = T.getState();
    const has = Object.values(state.records || {}).some(list => (Array.isArray(list) ? list : (list && list.kept) || []).some(r => r.kind === 'judged'));
    const concl = state.backupMeta && state.backupMeta.lastConclusion;
    if (has || concl) return { ok: true, skipped: true };
    const backupMeta = { lastExportAt: null, lastExportSig: null, lastConclusion: { kind: 'clear', date: '2020-01-01', count: 1 }, ...(state.backupMeta || {}) };
    backupMeta.lastConclusion = { kind: 'clear', date: '2020-01-01', count: 1 };
    const r = T.seed({ ...state, backupMeta });
    document.dispatchEvent(new Event('visibilitychange'));
    return r;
  });
  if (!out || !out.ok) throw new Error('markFirstPracticeDone failed: ' + JSON.stringify(out));
  await page.waitForSelector('.sz-layer[data-top="true"] [data-testid="home-pick"]');
  return out;
}

// ---- 阶段 1 E9a：首页五态的造数（77-e9a-home 用；72-p1e5 有自己的一份，口径相同）----
// entries（每条一个独立会话 = 一组一个字）→ groups（保留在槽里的进行中的组）→ setClock → seed。
const SEED_FN = `async (spec) => {
  const { judgeInDraft } = await import('/src/ui/screens/write/compare.js');
  const { createSession } = await import('/src/core/sessions.js');
  const draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
  let n = 100; const nextId = p => p + (n += 1);
  const strokes = [
    [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 168, t: 60 }, { x: 290, y: 172, t: 120 }]],
    [[{ x: 60, y: 120, t: 0 }, { x: 170, y: 118, t: 60 }, { x: 290, y: 122, t: 120 }], [{ x: 172, y: 50, t: 300 }, { x: 170, y: 170, t: 360 }, { x: 174, y: 300, t: 420 }]],
    [[{ x: 70, y: 70, t: 0 }, { x: 170, y: 170, t: 60 }, { x: 290, y: 290, t: 120 }], [{ x: 290, y: 70, t: 250 }, { x: 180, y: 180, t: 310 }, { x: 70, y: 290, t: 370 }]],
  ];
  (spec.entries || []).forEach((e, i) => {
    const at = Date.parse(e.at);
    draft.sessions.A = createSession({ id: nextId('s'), kind: e.kind || 'daily', source: { view: 'home' }, queue: ['base:' + e.char], at });
    judgeInDraft(draft, { slot: 'A', cardKey: 'base:' + e.char, judgment: e.judgment || 'correct', strokes: strokes[i % strokes.length], at, nextId });
  });
  draft.sessions = { A: null, B: null, lastEnded: {} };
  for (const g of spec.groups || []) {
    const at = Date.parse(g.at);
    const s = createSession({ id: nextId('s'), kind: g.kind || 'daily', source: { view: 'home' }, queue: g.chars.map(c => 'base:' + c), at });
    draft.sessions[g.slot || 'A'] = s;
    (g.steps || []).forEach((step, i) => {
      judgeInDraft(draft, { slot: g.slot || 'A', cardKey: 'base:' + g.chars[i], judgment: step, strokes: strokes[(i + 1) % strokes.length], at: at + i * 1000, nextId });
    });
  }
  window.__shiziTest.reset();
  window.__shiziTest.setClock(spec.clock);
  const r = window.__shiziTest.seed(draft);
  return { ok: !!(r && r.ok), r };
}`;

const D = n => `2026-10-${String(n).padStart(2, '0')}`;
const HISTORY10 = ['09-28', '09-28', '09-29', '09-30', '10-01', '10-01', '10-02', '10-03', '10-04', '10-04']
  .map((d, i) => ({ char: String.fromCodePoint(0x6100 + i), at: `2026-${d}T20:0${i % 10}:00` }));

/** 首页五态（first 是没有任何记录的首次打开，不需要造数）。 */
export const HOME_STATES = Object.freeze({
  first: null,
  fresh: { entries: [...'疆酱肆酝春'].map((c, i) => ({ char: c, at: `${D(4)}T20:0${i}:00` })), clock: `${D(5)}T19:30:00` },
  today: { entries: [...'疆酱肆酝'].map((c, i) => ({ char: c, at: `${D(5)}T08:0${i}:00`, judgment: i === 2 ? 'wrong' : 'correct' })), clock: `${D(5)}T12:30:00` },
  progress: { entries: [], groups: [{ at: `${D(5)}T12:00:00`, chars: [...'疆嚷醋膝窗'], steps: ['correct', 'correct'] }], clock: `${D(5)}T12:30:00` },
  special: { entries: HISTORY10, clock: `${D(5)}T21:00:00` },
  back: { entries: [...'醋膝屉鼎窗'].map((c, i) => ({ char: c, at: `2026-09-2${i}T20:00:00` })), clock: `${D(14)}T09:30:00` },
});

/** 按自定义 spec（同 HOME_STATES 的形状）造数，不等首页状态（调用方自己等）。 */
export async function seedHomeSpec(page, spec) {
  const res = await page.evaluate(`(${SEED_FN})(${JSON.stringify(spec)})`);
  if (!res.ok) throw new Error('seedHomeSpec failed: ' + JSON.stringify(res.r));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  return res;
}

/** 造数并等首页换成对应状态；spec 为 null（首次打开）时只清空。 */
export async function seedHomeState(page, name) {
  const spec = HOME_STATES[name];
  if (spec) {
    const res = await page.evaluate(`(${SEED_FN})(${JSON.stringify(spec)})`);
    if (!res.ok) throw new Error('seedHomeState failed: ' + JSON.stringify(res.r));
  } else {
    await page.evaluate(() => window.__shiziTest.reset());
  }
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(v => {
    const el = document.querySelector('.sz-layer [data-testid="screen-home"], [data-testid="screen-home"]');
    return !!el && el.dataset.view === v;
  }, name); // 状态名与 data-view 同名
  await page.waitForTimeout(250);
}
