// 首练第 1 字格下一次性提示的判定与「已出现」写入（从 src/ui/screens/write/first-tip.js 原样挪来，B2.1；行为不变）。

/** 这一刻要不要出现：首练第 1 字、回忆阶段、从没出现过。纯函数。 */
export function firstTipDue({ settings = null, session = null, phase = 'recall' } = {}) {
  if (!session || session.kind !== 'first' || session.cursor !== 0) return false;
  if (phase !== 'recall') return false;
  return !(settings && settings.firstTipSeen === true);
}

/** 记下提示已出现过（settings.firstTipSeen = true，只出现一次）。已记过不写。 */
export function commitFirstTipSeen(store) {
  const cur = store.getState().settings;
  if (cur && cur.firstTipSeen === true) return { ok: true, keys: [], skipped: true };
  return store.commit('write:first-tip', draft => {
    draft.settings = { ...(draft.settings || {}), firstTipSeen: true };
  });
}
