// 调度不变量（r7-S1）。纯函数，只读调用 src/core 与字库页的模型，不改任何东西。
// 模拟器（engine.mjs）在每一组、每一天之后调用；test/core/schedule-invariants.test.mjs 也直接 import。
//
// 每条不变量 = { id, title }；检查函数返回违反列表 [{ id, detail }]。

import * as defaultPolicy from '../../../src/config/policy.js';
import { isReservedChar } from '../../../src/core/new-order.js';
import { capitalAfterKeysFor } from '../../../src/core/special.js';
import { answerSeenCardKeysOn, charOfCardKey, isJudged, judgedCardKeysOn, skippedCardKeysOn } from '../../../src/core/records.js';
import { skipDeferredNewKeys } from '../../../src/core/sessions.js';
import { overdueDays } from '../../../src/core/fsrs.js';
import { addDays, diffDays } from '../../../src/core/dates.js';
import { memoryZones, skippedZone, latestJudgedByChar, recordsOfState } from '../../../src/ui/screens/library/model.js';

export const INVARIANTS = Object.freeze([
  { id: 'G1-no-dup-in-group', title: '同一组内不重复（同一个字只出现一次）' },
  { id: 'G2-group-size', title: '一组的字数不超过上限（首练 = 首练队列长度；之后 = groupSize）' },
  { id: 'G3-not-judged-today', title: '今天已经判断过的字，今天不会再被选进新的一组' },
  { id: 'G4-new-in-library', title: '新字都在当前练习范围（字库）之内，且不是「不进默认排序」的特殊字' },
  { id: 'G5-new-never-judged', title: '被当作「新字」选出的字，之前从没有判断记录' },
  { id: 'G6-due-really-due', title: '被当作「到期」选出的字，调度表里确实到期（due ≤ 今天）' },
  { id: 'G7-early-not-due', title: '被当作「提前复习」选出的字，调度表里确实还没到期' },
  { id: 'G8-one-warmup', title: '一组里热身字至多 1 个' },
  { id: 'G9-due-not-starved', title: '有到期字、复习预算没用完、又不是特别组时，这一组至少带 1 个到期字' },
  { id: 'G10-daily-cap', title: '一天内到期复习的字数不超过每日复习上限（dailyReviewCap）' },
  { id: 'D1-zones-sum', title: '字库三档（待复习 / 未熟悉 / 已熟悉）合计 = 已练汉字数' },
  { id: 'D2-recorded-eq-judged', title: '已练汉字数 = 有判断记录的不同汉字数' },
  { id: 'D3-skipped-not-practiced', title: '「已跳过」的字不计入已练，也不出现在三档里' },
  { id: 'D4-sched-has-judged', title: '调度表里的每个字，至少有一条判断记录' },
  { id: 'D5-due-after-judged-day', title: '每个字的下次到期日，晚于它最近一次判断的那一天（至少次日）' },
  { id: 'D6-zone-due-matches-plan', title: '一天开始时，「待复习」档里的字 = 首页今日练习里「到期」的字（两处口径一致）' },
  { id: 'D7-due-not-starved-long', title: '到期字不会长期不出现：用户每天都练的前提下，没有字逾期超过 60 天' },
  { id: 'P1-skip-undo-restores', title: '撤销跳过之后，记录 / 调度表 / 会话与没跳过一致' },
  { id: 'P2-correction-roundtrip', title: '结果页把判断改过去再改回来，调度表与原来一致' },
  { id: 'P3-skip-seen-no-sched', title: '跳过、看答案不改调度表，也不产生判断记录' },
  { id: 'P4-skip-seen-not-reoffered-today', title: '刚跳过 / 刚看过答案的字，当天再开一组时不会立刻又出现' },
  { id: 'W1-wrong-returns-next-day', title: '写错的字，第二天（如果第二天也练）会再出现' },
  { id: 'P5-hint-shortens-interval', title: '同一个字、同样按时复习，带提示写对的下次间隔比无提示写对的短（仅单测）', unitOnly: true },
  { id: 'G11-new-in-order', title: '新字按既定顺序挑（易忘度清单在前，已写过 / 今天写过 / 今天看过答案或跳过 / 最近几天跳过的新字跳过）' },
  { id: 'X1-judge-commit-fails', title: '写完一个字点「写对 / 写错」，记录一定能存上（不会因为时间异常等原因提交失败）' },
  { id: 'R1-reminder-target-due', title: '提醒通知里的题目，在对应那天已到期，且能练' },
  { id: 'R2-reminder-wrong-first', title: '提醒挑字：写错过的先于只是到期的' },
]);

export const INVARIANT_TITLE = Object.freeze(Object.fromEntries(INVARIANTS.map(i => [i.id, i.title])));

const v = (id, detail) => ({ id, detail });

/**
 * 一组选出来之后的检查（不写入）。
 * @param {object} a
 * @param {object} a.state   store 状态
 * @param {string} a.today
 * @param {string[]} a.queue 这一组的 cardKey
 * @param {object|null} a.plan planDaily 的结果（first 组为 null）
 * @param {string} a.kind    'first' | 'daily'
 * @param {object} a.deck    { libraryOf(id) → { keys } }
 * @param {Array} a.records  平铺的全部记录
 * @param {number} a.dueReviewsAlreadyDone 今天已做的到期复习数（G10）
 */
export function checkGroup({ state, today, queue, plan, kind, deck, records, policy = defaultPolicy }) {
  const out = [];
  const chars = queue.map(charOfCardKey);
  if (new Set(queue).size !== queue.length || new Set(chars).size !== chars.length) {
    out.push(v('G1-no-dup-in-group', queue.join(',')));
  }
  const limit = kind === 'first' ? policy.firstQueue.length : policy.groupSize;
  if (queue.length > limit) out.push(v('G2-group-size', `${queue.length} > ${limit}`));
  const judgedToday = judgedCardKeysOn(records, today);
  for (const k of queue) if (judgedToday.has(k)) out.push(v('G3-not-judged-today', k));
  if (kind === 'first' || !plan) return out;

  const sched = (state && state.sched) || {};
  const everJudged = new Set(records.filter(isJudged).map(r => r.cardKey));
  const lib = deck.libraryOf(plan.libraryId);
  const inLib = new Set(lib ? lib.keys : []);
  const custom = new Set(plan.customKeys || []);
  const capitalOk = new Set((plan.special && plan.special.keys) || []);
  for (const k of plan.newKeys) {
    if (custom.has(k) || capitalOk.has(k)) continue;
    if (!inLib.has(k) && !isCapitalKey(k)) out.push(v('G4-new-in-library', `${k} 不在 ${plan.libraryId}`));
    else if (isReservedChar(charOfCardKey(k)) && !isCapitalKey(k)) out.push(v('G4-new-in-library', `${k} 是特殊字`));
    if (everJudged.has(k) || sched[k]) out.push(v('G5-new-never-judged', k));
  }
  {
    const cand = [...capitalAfterKeysFor(records, policy), ...deck.newCandidates(plan.libraryId)];
    const warm = new Set(plan.warmKeys || []);
    // D65 #5：当天看过答案 / 跳过的字不再出（按 policy），跳过的新字推迟 skipNewDeferDays 天
    const outToday = new Set([
      ...(policy.answerSeenScope === 'today' ? answerSeenCardKeysOn(records, today) : []),
      ...(policy.skipScope === 'today' ? skippedCardKeysOn(records, today) : []),
      ...skipDeferredNewKeys(records, today, policy),
    ]);
    const expected = [];
    for (const k of cand) {
      if (judgedToday.has(k) || outToday.has(k) || sched[k] || expected.includes(k) || warm.has(k)) continue;
      expected.push(k);
      if (expected.length >= plan.newKeys.length) break;
    }
    const got = plan.newKeys.filter(k => !warm.has(k) && !custom.has(k));
    if (!plan.special && got.length && JSON.stringify(got) !== JSON.stringify(expected.slice(0, got.length))) {
      out.push(v('G11-new-in-order', `实际 ${got.map(charOfCardKey).join('')} / 应为 ${expected.slice(0, got.length).map(charOfCardKey).join('')}`));
    }
  }
  for (const k of plan.dueKeys) {
    const e = sched[k];
    if (!e || e.stoppedAt !== undefined || overdueDays(e, today) === null || overdueDays(e, today) < 0) out.push(v('G6-due-really-due', k));
  }
  for (const k of plan.earlyKeys) {
    const e = sched[k];
    if (!e || overdueDays(e, today) === null || overdueDays(e, today) >= 0) out.push(v('G7-early-not-due', k));
  }
  const warmCount = queue.filter(k => (plan.warmKeys || []).includes(k)).length;
  if (warmCount > 1) out.push(v('G8-one-warmup', String(warmCount)));
  if (!plan.special && plan.backlog > 0 && plan.reviewBudgetLeft > 0 && plan.dueKeys.length === 0 && queue.length > 0) {
    out.push(v('G9-due-not-starved', `积压 ${plan.backlog} 个，预算 ${plan.reviewBudgetLeft}，但这一组没有一个到期字（${queue.length} 字）`));
  }
  return out;
}

function isCapitalKey(k) {
  return ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾', '佰', '仟'].includes(charOfCardKey(k));
}

/** 一天结束（或任意时刻）的状态检查。 */
export function checkState({ state, today }) {
  const out = [];
  const { records } = recordsOfState(state);
  const judgedChars = new Set(records.filter(isJudged).map(r => r.char));
  const zones = memoryZones(state, today);
  const sum = zones.zones.due.n + zones.zones.shaky.n + zones.zones.known.n;
  if (sum !== zones.recorded) out.push(v('D1-zones-sum', `三档合计 ${sum} ≠ 已练 ${zones.recorded}`));
  if (zones.recorded !== judgedChars.size) out.push(v('D2-recorded-eq-judged', `已练 ${zones.recorded} ≠ 有判断的字 ${judgedChars.size}`));
  const skipped = skippedZone(state);
  const inZones = new Set();
  for (const z of Object.values(zones.zones)) for (const it of z.items) inZones.add(it.char);
  for (const it of skipped.items) {
    if (judgedChars.has(it.char) || inZones.has(it.char)) out.push(v('D3-skipped-not-practiced', it.char));
  }
  const latest = latestJudgedByChar(records);
  for (const [key, entry] of Object.entries((state && state.sched) || {})) {
    const ch = charOfCardKey(key);
    const last = ch ? latest.get(ch) : null;
    if (!last) {
      out.push(v('D4-sched-has-judged', key));
      continue;
    }
    if (entry.due && last.localDay && diffDays(last.localDay, entry.due) < 1) {
      out.push(v('D5-due-after-judged-day', `${key} 最近判断 ${last.localDay}，下次到期 ${entry.due}`));
    }
  }
  return out;
}

/** 一天开始时：字库「待复习」档 vs 首页今日练习的到期字数。 */
export function checkZonePlanAgree({ state, today, plan }) {
  const zones = memoryZones(state, today);
  const dueZone = new Set(zones.zones.due.items.map(i => i.cardKey));
  const sched = (state && state.sched) || {};
  const overdueSet = new Set(Object.keys(sched).filter(k => {
    const e = sched[k];
    return e && e.stoppedAt === undefined && overdueDays(e, today) !== null && overdueDays(e, today) >= 0;
  }));
  const onlyZone = [...dueZone].filter(k => !overdueSet.has(k));
  const onlyPlan = [...overdueSet].filter(k => !dueZone.has(k));
  const out = [];
  if (onlyZone.length || onlyPlan.length) {
    out.push(v('D6-zone-due-matches-plan', `待复习档比到期多 ${onlyZone.length} 个（${onlyZone.slice(0, 4).map(charOfCardKey).join('')}），到期比待复习档多 ${onlyPlan.length} 个`));
  }
  return { violations: out, onlyZone, onlyPlan, plan };
}

export { addDays };
