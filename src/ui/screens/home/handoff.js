// 「拾」的交接（H1 / D51 ④、N2-02；03 P221）：首练第三字写下「拾」，第一次回到首页时，品牌「拾」的位置换成本人写的「拾」墨迹——只发生一次。
//
//   shiHandoffRecord({settings, records, today, hasInk})  这一次该不该交接：返回要画的那条记录（本人写的「拾」），否则 null。
//     条件（全部成立）：settings.shiHandoffDone 不是 true；今天就是用户第一次练习的那天（最早一条判断记录在今天，所以老用户不会补一次）；
//     今天有一条「拾」的作品记录（沿用作品出口成员口径 isWorkOrAfterSeen）且留有墨——取最近一次留墨的那条（D42）。
//   commitShiHandoffDone(store)                          记下「交接过了」（settings.shiHandoffDone = true，经 store.commit；已记过不写）。
//
// 页面怎么用（home/index.js）：首页在顶层时第一次发现 shiHandoffRecord 不为 null，就把这条记录存进组件状态、立即 commit 标志位（刷新 / 重进不再交接），
// 并一直画交接格直到离开首页（切 tab、进别的页）；下一次回来按日常状态（今天的字 / 最近写的字）。淡入 ≤ 300ms，「减少动态效果」直接换成本人的字。
// 「拾」字取自文案表（X-HOME.shiLabel，品牌字的读屏名称），代码里不写汉字字面量。

import { t } from '../../../config/copy/index.js';
import { isJudged, isWorkOrAfterSeen, sortById } from '../../../core/records.js';
import { pickInkRecord } from '../../../core/ink-pick.js';

/** 「拾」的题库键（base:拾）。 */
export function shiCardKey() {
  return `base:${t('X-HOME.shiLabel')}`;
}

/**
 * @param {{settings?: object|null, records: object[], today: string, hasInk: (record:object)=>boolean}} o  records 已平铺
 * @returns {object|null} 要画的「拾」记录，或 null
 */
export function shiHandoffRecord({ settings = null, records, today, hasInk } = {}) {
  if (settings && settings.shiHandoffDone === true) return null;
  if (typeof hasInk !== 'function' || !Array.isArray(records) || !records.length) return null;
  let firstDay = null;
  for (const r of records) if (isJudged(r) && (firstDay === null || r.localDay < firstDay)) firstDay = r.localDay;
  if (firstDay !== today) return null;
  const key = shiCardKey();
  const mine = sortById(records.filter(r => r && r.cardKey === key && r.localDay === today && isWorkOrAfterSeen(r, hasInk)));
  return pickInkRecord(mine, { prefer: 'last', hasInk });
}

/** 记下「交接过了」。已记过不写；写失败返回 {ok:false}（页面下次回到首页还会再交接一次）。 */
export function commitShiHandoffDone(store) {
  const cur = store.getState().settings;
  if (cur && cur.shiHandoffDone === true) return { ok: true, keys: [], skipped: true };
  return store.commit('home:shi-handoff', draft => {
    draft.settings = { ...(draft.settings || {}), shiHandoffDone: true };
  });
}
