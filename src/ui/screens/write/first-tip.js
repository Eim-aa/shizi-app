// 首练第 1 字格下的一次性提示（阶段 1 Q2-1；实现交接 §3「凭记忆写；想不起来，点下面的「提示」。」；复测 simB D2 / simC D12；03 P181）。
//
// - 只在首练（session.kind === 'first'）第 1 个字的回忆阶段出现，位置是书写格下的说明位（t13 ink3，和别的格下说明同一处）。
// - 出现即记 settings.firstTipSeen = true（经 store.commit；写失败不阻断，下次进页可能再出现一次）；之后——刷新、重新开始首练、清空所有记录后的首练
//   （settings 清空时保留）——都不再出现。
// - 本页挂载时判定一次（和读屏建议同一思路）；首次落笔、用了提示、进了纸上写、离开回忆阶段后收起，不再回来。
//
// data-testid：write-first-tip。

import { html, useEffect, useRef, useState } from '../../../../vendor/ui.js';
import { t } from '../../../config/copy/index.js';

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

/**
 * @param {{settings:object|null, session:object|null, phase:string, strokeCount:number, hinted:boolean, blocked:boolean, getStore:()=>object}} o
 *   blocked：格下说明位已被别的非阻断建议占着（读屏的「改为在纸上写」）。
 * @returns {{node:*}}
 */
export function useFirstTip({ settings, session, phase, strokeCount, hinted, blocked = false, getStore }) {
  const [due] = useState(() => firstTipDue({ settings, session, phase }));
  const [gone, setGone] = useState(false);
  const recorded = useRef(false);
  const visible = due && !gone && !blocked && phase === 'recall' && strokeCount === 0 && !hinted;
  useEffect(() => {
    if (!visible || recorded.current) return;
    recorded.current = true;
    try {
      commitFirstTipSeen(getStore()); // P52 同款：失败不阻断
    } catch (error) {
      // store 不可用：照样显示
    }
  }, [visible]);
  // 一旦收起（落笔 / 提示 / 换阶段）就不再回来：撤销、清空回到 0 笔时也不重新出现。
  useEffect(() => {
    if (due && !gone && recorded.current && !visible) setGone(true);
  }, [due, gone, visible]);
  if (!visible) return { node: null };
  return { node: html`<span class="sz-write__firsttip" data-testid="write-first-tip">${t('X-WRITE.firstTip')}</span>` };
}
