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
