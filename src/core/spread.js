// 到期日摊开（纯函数）：把一次性大量到期的字摊到之后几天，只往后挪、不提前。
//
// 两处用：
//   ① v1 迁移那一刻（D65 #2，store/migrate.js spreadLegacyDue 就是这里的 spreadDue）；
//   ② 离开 ≥ policy.returnSpread.afterDays 天回来的那一刻（D66 ⑨，P323，产品体验评审 P4-01）：returnSpreadPlan。
//      只在「回来那一刻」执行一次——还没在这一天判断过、离上次练习 ≥ 30 天，且 settings.returnSpreadFor 不是这次离开前的
//      最后一个练习日（执行后记下它，同一次离开不会再摊第二次）。由 core/session-start.js 在首页打开（expireStale）与开组（startA）
//      时写入；planDaily 读的是摊开后的调度表，所以首页 / 字库「今天要写」与真正开的组一致。
// FSRS 卡与记录都不变，只改调度项的 due。

import * as defaultPolicy from '../config/policy.js';
import { addDays, diffDays, isValidDay } from './dates.js';
import { isJudged } from './records.js';
import { groupSizeOf } from './group-size.js';

/**
 * 把 due ≤ today 的调度项摊到 today 起的之后几天：按 due 早的在前（再按稳定度低、键）排，从 today 起逐日放，
 * 每天连同那天本来就到期的字至多 perDay 个；只往后挪、不提前（to ≥ 原 due），未到期的字不动、停掉的字不动。
 * 不改入参，返回 {sched, moved}（moved = 到期日被改了的字数）。
 * @param {object} sched {[cardKey]: {fsrs, due, lastJudgedAt, stoppedAt?}}
 * @param {{today:string, perDay:number}} o
 */
export function spreadDue(sched, { today, perDay }) {
  const out = {};
  const load = new Map(); // 日 → 已排的个数（含本来就在那天到期的字）
  const overdue = [];
  for (const [key, entry] of Object.entries(sched || {})) {
    out[key] = entry;
    if (!entry || !isValidDay(entry.due) || entry.stoppedAt !== undefined) continue;
    if (entry.due <= today) overdue.push([key, entry]);
    else load.set(entry.due, (load.get(entry.due) || 0) + 1);
  }
  if (!(perDay > 0) || overdue.length <= perDay) return { sched: out, moved: 0 };
  const stab = (e) => (e.fsrs ? Number(e.fsrs.stability) || 0 : 0);
  overdue.sort((a, b) => (a[1].due < b[1].due ? -1 : a[1].due > b[1].due ? 1 : 0) || stab(a[1]) - stab(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let day = today;
  let moved = 0;
  for (const [key, entry] of overdue) {
    while ((load.get(day) || 0) >= perDay) day = addDays(day, 1);
    load.set(day, (load.get(day) || 0) + 1);
    if (day !== entry.due) {
      out[key] = { ...entry, due: day };
      moved += 1;
    }
  }
  return { sched: out, moved };
}

function recordsOfState(state) {
  const out = [];
  const months = (state && state.records) || {};
  for (const month of Object.keys(months)) {
    const value = months[month];
    const list = Array.isArray(value) ? value : value && Array.isArray(value.kept) ? value.kept : [];
    for (const r of list) out.push(r);
  }
  return out;
}

/** 离开回来时每天至多摊几个：round(每组字数 × policy.returnSpread.perDayShare)，至少 1；没配 → 0（不摊）。 */
export function returnSpreadPerDay(settings, policy = defaultPolicy) {
  const cfg = policy && policy.returnSpread;
  const share = cfg ? Number(cfg.perDayShare) : 0;
  if (!(share > 0)) return 0;
  return Math.max(1, Math.round(groupSizeOf(settings, policy) * share));
}

/**
 * 离开 ≥ afterDays 天回来的那一刻要不要摊（D66 ⑨）。不写入，返回 null（不摊）或 {sched, moved, lastDay, perDay, gapDays}：
 * - 今天已经有判断 → null（已经不是「回来那一刻」）；
 * - 最近一个练习日（今天以前最近一个有判断的日子）离今天 < afterDays 天，或从没练过 → null；
 * - settings.returnSpreadFor === 最近一个练习日（这次离开已经摊过）→ null。
 * 其余：按每组字数一半摊开（moved 可以是 0：到期字本来就不多，也照样记下已执行）。
 */
export function returnSpreadPlan(state, today, policy = defaultPolicy) {
  const cfg = policy && policy.returnSpread;
  if (!cfg || !Number.isInteger(cfg.afterDays) || cfg.afterDays <= 0 || !isValidDay(today)) return null;
  let lastDay = null;
  for (const r of recordsOfState(state)) {
    if (!isJudged(r) || !isValidDay(r.localDay)) continue;
    if (r.localDay === today) return null;
    if (r.localDay < today && (lastDay === null || r.localDay > lastDay)) lastDay = r.localDay;
  }
  if (lastDay === null) return null;
  const gapDays = diffDays(lastDay, today);
  if (gapDays < cfg.afterDays) return null;
  const settings = state && state.settings;
  if (settings && settings.returnSpreadFor === lastDay) return null;
  const perDay = returnSpreadPerDay(settings, policy);
  if (!perDay) return null;
  const { sched, moved } = spreadDue((state && state.sched) || {}, { today, perDay });
  return { sched, moved, lastDay, perDay, gapDays };
}

/**
 * 草稿里执行回来时的摊开（store.commit 的 mutate 里调用）：改 draft.sched、记 settings.returnSpreadFor。
 * @returns {null | {moved:number, lastDay:string, perDay:number, gapDays:number}}
 */
export function applyReturnSpreadInDraft(draft, today, policy = defaultPolicy) {
  const plan = returnSpreadPlan(draft, today, policy);
  if (!plan) return null;
  if (plan.moved) draft.sched = plan.sched;
  draft.settings = { ...(draft.settings || {}), returnSpreadFor: plan.lastDay };
  return { moved: plan.moved, lastDay: plan.lastDay, perDay: plan.perDay, gapDays: plan.gapDays };
}
