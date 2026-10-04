// 每组复习与新字的配比（规则 D「保底一新 + 积压阀」，决定 D41 / D28 / D40；policy.groupMix P125、policy.warmup P126、policy.capitalNumerals P128）。
// 纯函数；依据 docs/engineering/v10/phase1/复习新字配比-研究与推荐.md §4.3 / §6，参考实现 docs/engineering/v10/phase1/tools/simulate-mix.mjs
// （RULES.D + planGroup，test/core/mix.test.mjs 用同一组输入逐项对照）。全部输入从现有 records / sched 推出，不新增存储。
//
// 规则（阈值以每组 5 个字为前提）：
//   p（积压天数）= 到期未写数 ÷（reviewsPerGroupForPressure × 近 pressureWindowDays 天平均每天组数，至少 1）
//   新字数 = p ≥ valveDays ? (上一组有新字 ? 0 : 1) : p ≥ twoNewBelowDays ? 1 : (p < threeNewBelowDays 且最近新字写对率 ≥ 0.6) ? 3 : 2
//   离开 ≥ returnAfterDays 天回来的第一组：把「上一组有新字」当作 false，积压阀照常给 1 个新字（不判全复习）；这一组缩短为 returnGroupSize（3）个字
//   （D48 ⑧，P184；组大小在 sessions.selectDaily 取，本模块的 planGroup 只按传入的 size 配）。
//   复习 = min(到期数, groupSize − 新字数, 今日复习预算)；新字最多 newMax 个；到期不够时用最快到期的字提前复习补位（不计入每日上限），
//   仍不足才补新字（首练后的第一组因此是 1 热身 + 4 新）。
//   热身字：只在首练后 firstDays 天内或最近写得吃力时放，每组至多 1 个（新热身字或热身字复习二选一）、放组首，占一个新字位（新字位 ≥ 2 时）。
//   组内顺序：热身字 →「复习、新」交错 → 提前复习放最后；末位若是新字，换成好写的字（复习 / 提前复习），收在「写得出来」上。

import { addDays, diffDays } from './dates.js';
import { isJudged, reviewsDoneOn, sortById } from './records.js';
import { replay } from './fsrs.js';

// ---------------------------------------------------------------- 输入：从 records 推出

function accuracyOf(values, prior, weight) {
  if (!values.length) return prior;
  const ok = values.reduce((n, v) => n + (v ? 1 : 0), 0);
  return (ok + prior * weight) / (values.length + weight);
}

/**
 * 练习状态（全部从 records 推出）。
 * 「组」= 有判断的会话（按 sessionId 去重；旧数据迁移来的记录没有会话，按「那一天 1 组」算）。
 * @param {Array} records 全部记录
 * @param {string} today YYYY-MM-DD
 * @param {{policy:object, isWarm:(cardKey:string)=>boolean}} o
 * @returns {{groupsTotal:number, groupsPerDay:number, newAccuracy:number, allAccuracy:number, lastHadNew:boolean, firstBack:boolean,
 *   dayIndex:number, hadToday:boolean, lastDay:string|null, firstDay:string|null}}
 */
export function practiceStats(records, today, { policy, isWarm }) {
  const mix = policy.groupMix;
  const warm = policy.warmup;
  const judged = sortById((records || []).filter(isJudged));
  const groupIds = new Set();
  const perDay = new Map(); // 日 → 组 id 集合
  const firstOfCard = new Map(); // cardKey → 第一条 judged 记录
  const firstNew = []; // 非热身字第一次判断的对错（按 id 序）
  let firstDay = null;
  let lastDay = null; // 今天以前最近一个有判断的日子
  let hadToday = false;
  for (const r of judged) {
    const gid = r.sessionId ? r.sessionId : 'legacy:' + r.localDay;
    groupIds.add(gid);
    if (!perDay.has(r.localDay)) perDay.set(r.localDay, new Set());
    perDay.get(r.localDay).add(gid);
    if (firstDay === null || r.localDay < firstDay) firstDay = r.localDay;
    if (r.localDay === today) hadToday = true;
    else if (r.localDay < today && (lastDay === null || r.localDay > lastDay)) lastDay = r.localDay;
    if (!firstOfCard.has(r.cardKey)) {
      firstOfCard.set(r.cardKey, r);
      if (!isWarm(r.cardKey)) firstNew.push(r.judgment === 'correct');
    }
  }
  let groupsInWindow = 0;
  for (let i = 1; i <= mix.pressureWindowDays; i += 1) {
    const set = perDay.get(addDays(today, -i));
    if (set) groupsInWindow += set.size;
  }
  const groupsPerDay = Math.max(1, groupsInWindow / mix.pressureWindowDays);
  const recentNew = firstNew.slice(Math.max(0, firstNew.length - mix.recentNewWindow));
  const recentAll = judged.slice(Math.max(0, judged.length - warm.window)).map((r) => r.judgment === 'correct');
  // 上一组（不论哪天，id 最大的判断所在的会话）有没有新字：它的判断里有没有某字的第一条判断。
  let lastHadNew = true;
  if (judged.length) {
    const tail = judged[judged.length - 1];
    const gid = tail.sessionId ? tail.sessionId : 'legacy:' + tail.localDay;
    lastHadNew = judged.some((r) => (r.sessionId ? r.sessionId : 'legacy:' + r.localDay) === gid && firstOfCard.get(r.cardKey) === r);
  }
  const firstBack = !hadToday && lastDay !== null && diffDays(lastDay, today) >= mix.returnAfterDays;
  if (firstBack) lastHadNew = false; // 离开很久回来的第一组：积压阀不判「全复习」
  return {
    groupsTotal: groupIds.size,
    groupsPerDay,
    newAccuracy: accuracyOf(recentNew, mix.newAccuracyPrior, mix.accuracyPriorWeight),
    allAccuracy: accuracyOf(recentAll, mix.allAccuracyPrior, mix.accuracyPriorWeight),
    lastHadNew,
    firstBack,
    dayIndex: firstDay === null ? 1 : diffDays(firstDay, today) + 1,
    hadToday,
    lastDay,
    firstDay,
  };
}

/** 积压天数 p。 */
export function pressureOf(backlog, groupsPerDay, mix) {
  return backlog / Math.max(1, mix.reviewsPerGroupForPressure * Math.max(1, groupsPerDay));
}

/** 这一组的新字数目标（0–newMax，规则 D）。state = {backlog, groupsPerDay, newAccuracy, lastHadNew}。 */
export function newTargetOf(state, mix) {
  const p = pressureOf(state.backlog, state.groupsPerDay, mix);
  if (p >= mix.valveDays) return state.lastHadNew ? 0 : 1;
  if (p >= mix.twoNewBelowDays) return 1;
  if (p < mix.threeNewBelowDays && state.newAccuracy >= mix.threeNewMinAccuracy) return mix.newMax;
  return 2;
}

/** 热身字门控（P126）：首练后 firstDays 天内，或最近写得吃力。 */
export function warmupAllowed(stats, warm) {
  if (warm.mode !== 'gated') throw new RangeError('unsupported policy.warmup.mode: ' + String(warm.mode));
  return stats.dayIndex <= warm.firstDays || stats.allAccuracy < warm.accuracyBelow;
}

// ---------------------------------------------------------------- 一组怎么配

/**
 * 一组里各类字的个数与人选（不排序、不写入）。与 simulate-mix.mjs planGroup 同一算法。
 * @param {object} a
 * @param {number} a.size                组大小（groupSize）
 * @param {number} a.budget              今日还能做几个到期复习（dailyReviewCap − 已做）
 * @param {Array<{key:string}>} a.due    到期字（已按逾期天数降序、稳定度升序排好）
 * @param {string[]} a.early             提前复习候选（未到期、今天没写过、非热身字，已按到期日升序、稳定度升序排好）
 * @param {(key:string)=>boolean} a.isWarm
 * @param {string|null} a.warmNext       下一个可放的新热身字（没有 = null）
 * @param {boolean} a.warmOk             热身字门控是否放行
 * @param {{backlog:number, groupsPerDay:number, newAccuracy:number, lastHadNew:boolean}} a.state
 * @param {object} a.mix                 policy.groupMix
 * @param {number} [a.newAvailable]      可当新字的字还有多少（缺省不限）
 * @returns {{newTarget:number, revKeys:string[], earlyKeys:string[], newSlots:number, warmNew:string|null, warmRev:number}}
 *   newSlots = 新字位总数（含热身新字）；warmNew 占其中一位。
 */
export function planGroup({ size, budget, due, early, isWarm, warmNext, warmOk, state, mix, newAvailable = Infinity }) {
  const newTarget = Math.min(size, newTargetOf(state, mix));
  const revSlots = Math.min(size - newTarget, budget);
  const revKeys = [];
  let warmRev = 0;
  for (const d of due) {
    if (revKeys.length >= revSlots) break;
    if (isWarm(d.key)) {
      if (warmRev >= 1) continue; // 热身字复习每组最多 1 个
      warmRev += 1;
    }
    revKeys.push(d.key);
  }
  let newSlots = Math.min(mix.newMax, size - revKeys.length, newAvailable);
  let earlyKeys = [];
  if (mix.earlyReviewFill && revKeys.length + newSlots < size) {
    earlyKeys = early.slice(0, size - revKeys.length - newSlots);
  }
  newSlots = Math.min(size - revKeys.length - earlyKeys.length, newAvailable); // 仍不足就再补新字
  let warmNew = null;
  if (newSlots >= 2 && warmRev === 0 && warmOk && warmNext) {
    warmNew = warmNext;
  }
  return { newTarget, revKeys, earlyKeys, newSlots, warmNew, warmRev };
}

/**
 * 组内顺序：热身字（新热身字或热身字复习）在组首；其余「复习、新、复习、新…」交错；提前复习放最后；
 * 末位若是新字且还有复习 / 提前复习，换一个好写的字到末位。
 * @param {{warmNew:string|null, revKeys:string[], earlyKeys:string[], newKeys:string[], isWarm:(key:string)=>boolean}} a
 * @returns {string[]}
 */
export function arrangeGroup({ warmNew, revKeys, earlyKeys, newKeys, isWarm }) {
  const items = [];
  if (warmNew) items.push({ key: warmNew, kind: 'warm' });
  const revs = [...revKeys].sort((a, b) => (isWarm(b) ? 1 : 0) - (isWarm(a) ? 1 : 0)).map((key) => ({ key, kind: 'rev' }));
  const news = newKeys.map((key) => ({ key, kind: 'new' }));
  if (revs.length && isWarm(revs[0].key)) items.push({ ...revs.shift(), kind: 'warm' }); // 热身字复习也放组首
  while (revs.length || news.length) {
    if (revs.length) items.push(revs.shift());
    if (news.length) items.push(news.shift());
  }
  for (const key of earlyKeys) items.push({ key, kind: 'early' });
  // 组尾放好写的字：末位是新字、前面还有（非热身的）复习 / 提前复习时，把最靠后的那个挪到末位（其余顺序不变）
  if (items.length > 1 && items[items.length - 1].kind === 'new') {
    for (let i = items.length - 2; i >= 0; i -= 1) {
      if (items[i].kind === 'rev' || items[i].kind === 'early') {
        items.push(items.splice(i, 1)[0]);
        break;
      }
    }
  }
  return items.map((it) => it.key);
}

// ---------------------------------------------------------------- 每日复习上限的记账（提前复习不计入）

/**
 * 今天已做的「到期复习」数：reviewsDoneOn（今天 judged、以前也 judged 过的字）减去其中「写的时候还没到期」的提前复习。
 * 判断「写的时候是否到期」：用该字的记录从头重放（与结果页更正同一套 fsrs.replay），重放到今天为止的 due 与现在的 sched.due 一致时才信，
 * 取今天以前的重放结果 due > 今天 即为提前复习；对不上（旧数据迁移来的 sched 等）一律当作到期复习，保守地计数。
 * policy.groupMix.earlyCountsTowardCap 为 true 时不做这件事。
 */
export function dueReviewsDoneOn(records, today, { sched, policy }) {
  const all = reviewsDoneOn(records, today);
  if (policy.groupMix.earlyCountsTowardCap !== false || !all) return all;
  const byCard = new Map();
  for (const r of records || []) {
    if (!isJudged(r)) continue;
    if (!byCard.has(r.cardKey)) byCard.set(r.cardKey, []);
    byCard.get(r.cardKey).push(r);
  }
  let early = 0;
  for (const [cardKey, list] of byCard) {
    if (!list.some((r) => r.localDay === today) || !list.some((r) => r.localDay < today)) continue; // 今天写过、以前也写过 = 一个复习字
    const entry = sched ? sched[cardKey] : undefined;
    if (!entry) continue;
    try {
      const sorted = sortById(list);
      const full = replay(null, sorted, { policy });
      if (!full || full.due !== entry.due) continue;
      const before = replay(null, sorted.filter((r) => r.localDay < today), { policy });
      if (before && before.due > today) early += 1;
    } catch (error) {
      // FSRS 库不可用等：保守地不扣
    }
  }
  return Math.max(0, all - early);
}
