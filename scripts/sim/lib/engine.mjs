// 调度模拟引擎（r7-S1）。一个虚拟用户按天练习；所有选字、记录、评级、间隔都走真实代码：
//   选字 = core/session-start.startNextA（→ sessions.selectDaily → mix.planGroup …）
//   判断 = ui/screens/write/compare.commitJudgment（→ fsrs.applyJudgment）
//   跳过 / 看答案 / 撤销 / 更正 = 写字页与结果页真实的 commit 函数
//   三档 / 已跳过 = ui/screens/library/model；今日计划 = home/today + planDaily；提醒题目 = platform/reminder
// 本文件只负责「用户怎么做」（答对率、提示、跳过、哪天不练…）和记账，不含任何调度规则。
import * as policy from '../../../src/config/policy.js';
import { addDays, diffDays, localDay } from '../../../src/core/dates.js';
import { overdueDays, ratingFor } from '../../../src/core/fsrs.js';
import { charOfCardKey, isJudged, latestJudged } from '../../../src/core/records.js';
import { isWarmupKey } from '../../../src/core/new-order.js';
import { dueReviewsDoneOn } from '../../../src/core/mix.js';
import { dailyReviewCapOf, groupSizeOf } from '../../../src/core/group-size.js';
import { aStartInfo, expireStale, planDaily, recordsOf, startNextA, startPicked } from '../../../src/core/session-start.js';
import { cardForKey, deckAdapter, isPracticable, libraryOf } from '../../../src/data/deck.js';
import { commitJudgment } from '../../../src/ui/screens/write/compare.js';
import { commitSkip, commitUndoSkip } from '../../../src/ui/screens/write/skip.js';
import { commitAnswerNext, commitAnswerSeen } from '../../../src/ui/screens/write/answer.js';
import { commitResultCorrection } from '../../../src/ui/screens/result/index.js';
import { memoryZones, skippedZone, todayPlanModel } from '../../../src/ui/screens/library/model.js';
import { reminderCandidates, reminderQuestions } from '../../../src/platform/reminder.js';
import { bootDeck, makeStore, rng, STROKES } from './env.mjs';
import { checkGroup, checkState, checkZonePlanAgree } from './invariants.mjs';

const DAY_MS = 86400000;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export const DEFAULTS = Object.freeze({
  id: 'x',
  name: '',
  days: 30,
  startDay: '2026-03-02',
  hour: 20, // 本地几点练
  minute: 0,
  fixedUtcHour: null, // 非 null：每天固定在这个 UTC 时刻练（换时区场景用）
  groupsPerDay: 1, // 数字或 (dayIdx) => 数字
  restDays: [], // 数字 / {from,to} / (dayIdx) => bool：这些天不练（不打开 App）
  user: Object.freeze({
    accuracy: 0.8, // 复习字（非新字）的基础写对率；memory 模式下被遗忘曲线取代
    newAccuracy: 0.6, // 新字第一次的写对率
    difficultyPenalty: 0.25, // 字越难（题库 d 越高）写对率越低：p −= penalty × (d−68)/32，新字全额、复习字半额
    hintRate: 0.1, // 写之前点了提示的比例（hintRateReview 给了就只管新字，复习字用后者）
    hintCorrect: 0.9, // 点了提示以后的写对率（至少）
    answerRate: 0.03, // 看答案的比例
    skipRate: 0.02, // 跳过的比例
    partialRate: 0, // 一天最后一组写到一半就走的概率
  }),
  memory: null, // null | { s0, gain, fail }：开启后复习字的写对率 = 0.9^(间隔天数 / 用户自己的稳定度)
  events: [],
  library: null, // 初始练习范围；null = 默认
  groupSize: null, // 「我的 › 每组字数」（settings.groupSize，D65 #2）；null = 没选过（按 policy.groupSize）
  seed: 1,
  budgets: null,
  probeRate: 0.04, // 每组做「撤销 / 更正」探针的概率
  setup: null, // (store, clock) => void：开局前改状态（迁移场景用）
  freeze: true,
  starveDays: 60,
});

function inRest(cfg, dayIdx) {
  const r = cfg.restDays;
  if (typeof r === 'function') return !!r(dayIdx);
  return (r || []).some(x => (typeof x === 'number' ? x === dayIdx : dayIdx >= x.from && dayIdx <= x.to));
}

function jsonEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function schedScan(sched, today) {
  let n = 0;
  let due = 0;
  let overdueMax = 0;
  let dueTomorrow = 0;
  let due7 = 0;
  let overdueSum = 0;
  for (const e of Object.values(sched || {})) {
    if (!e || e.stoppedAt !== undefined) continue;
    n += 1;
    const od = overdueDays(e, today);
    if (od === null) continue;
    if (od >= 0) {
      due += 1;
      overdueSum += od;
      if (od > overdueMax) overdueMax = od;
    }
    if (od === -1) dueTomorrow += 1;
    if (od >= -7 && od < 0) due7 += 1;
  }
  return { n, due, overdueMax, overdueMean: due ? overdueSum / due : 0, dueTomorrow, due7 };
}

/** 跑一个场景。返回 { cfg, days, groups, events, violations, probes, summary }。 */
export function runScenario(input) {
  bootDeck();
  const cfg = { ...DEFAULTS, ...input, user: { ...DEFAULTS.user, ...(input.user || {}) } };
  const rand = rng(cfg.seed);
  const probeRand = rng((cfg.seed * 2654435761) >>> 0);
  const [y0, m0, d0] = cfg.startDay.split('-').map(Number);
  const instantOf = (dayIdx, skew) => (cfg.fixedUtcHour !== null
    ? Date.UTC(y0, m0 - 1, d0 + dayIdx + skew, cfg.fixedUtcHour)
    : new Date(y0, m0 - 1, d0 + dayIdx + skew, cfg.hour, cfg.minute, 30).getTime());
  const clock = { t: instantOf(0, 0) };
  const store = makeStore(clock, { budgets: cfg.budgets, freeze: cfg.freeze });
  if (cfg.library) store.commit('sim:library', d => { d.settings = { ...(d.settings || {}), library: cfg.library }; });
  if (cfg.groupSize) store.commit('sim:group-size', d => { d.settings = { ...(d.settings || {}), groupSize: cfg.groupSize }; });
  if (cfg.setup) cfg.setup(store, clock);

  const days = [];
  const groups = [];
  const events = [];
  const violations = [];
  const probes = { skipUndo: { n: 0, bad: 0 }, correction: { n: 0, bad: 0 }, skipSeenNoSched: { n: 0, bad: 0 } };
  const origTz = process.env.TZ;
  const mem = new Map();
  let user = { ...cfg.user };
  let skew = 0;
  let skewTotal = 0;
  let starveCardDays = 0;
  let maxOverdueSeen = 0;
  const memStats = { reviews: 0, pSum: 0, correct: 0, byBucket: {} };
  const seenToday = new Map();
  let seenAgainCount = 0;

  function viol(id, day, detail) {
    violations.push({ id, day, detail });
  }
  function viols(list, day) {
    for (const x of list) viol(x.id, day, x.detail);
  }
  const stateNow = () => store.getState();
  const foldedMonths = () => Object.values(stateNow().records || {}).filter(m => m && !Array.isArray(m)).length;
  const snapOf = (slot) => {
    const st = stateNow();
    const sess = st.sessions && st.sessions[slot];
    return JSON.stringify({ r: st.records, s: st.sched, q: sess && { items: sess.items, cursor: sess.cursor, queue: sess.queue } });
  };

  // ---------------------------------------------------------------- 用户模型
  function difficultyZ(card) {
    return clamp(((card && card.d) || 68) - 68, -66, 32) / 32;
  }
  function recallP({ card, char, isNew, nowMs }) {
    const dz = difficultyZ(card);
    if (cfg.memory) {
      const m = mem.get(char);
      if (!m) return clamp(user.newAccuracy - user.difficultyPenalty * dz, 0.05, 0.99);
      const elapsed = Math.max(0, (nowMs - m.last) / DAY_MS);
      return clamp(Math.pow(0.9, elapsed / m.S), 0.02, 0.999);
    }
    const base = isNew ? user.newAccuracy : user.accuracy;
    return clamp(base - user.difficultyPenalty * dz * (isNew ? 1 : 0.5), 0.02, 1);
  }
  function memUpdate({ card, char, outcome, p, nowMs, hinted }) {
    if (!cfg.memory) return;
    const mm = cfg.memory;
    const dz = difficultyZ(card);
    const m = mem.get(char);
    if (!m) {
      let S = mm.s0 * (1 - 0.35 * dz);
      if (outcome === 'correct') S *= 1.5;
      mem.set(char, { S: Math.max(0.5, S), last: nowMs });
      return;
    }
    if (outcome === 'correct') m.S *= Math.min(4, 1 + mm.gain * (1 - p)) * (hinted ? 0.6 : 1);
    else if (outcome === 'wrong') m.S = Math.max(0.8, m.S * mm.fail);
    else m.S = Math.max(1, m.S * 0.8);
    m.last = nowMs;
  }

  // ---------------------------------------------------------------- 一组
  function writeSession({ slot, session, plan, kind, day, dayIdx, groupIdx, partialAfter }) {
    const records0 = recordsOf(stateNow());
    const gi = groups.length;
    const entry = {
      scenario: cfg.id, day, dayIdx, group: groupIdx, slot, kind, queue: [], backlog: plan ? plan.backlog : null,
      pressure: plan ? plan.pressure : null, newTarget: plan ? plan.newTarget : null, budgetLeft: plan ? plan.reviewBudgetLeft : null,
      special: plan && plan.special ? plan.special.kind : null, size: session.queue.length, sessionId: session.id, unwritten: [],
    };
    const sourceOf = (key) => {
      if (kind === 'first') return 'first';
      if (kind === 'picked') return 'picked';
      if (plan.special && plan.special.keys.includes(key)) return 'special';
      if (plan.customKeys.includes(key)) return 'custom';
      if (plan.earlyKeys.includes(key)) return 'early';
      if (plan.dueKeys.includes(key)) {
        const last = latestJudged(records0, key);
        return last && last.judgment === 'wrong' ? 'due-wrong' : 'due';
      }
      if (plan.warmKeys.includes(key)) return 'warm-new';
      if (plan.newKeys.includes(key)) return 'new';
      return '?';
    };
    let wrote = 0;
    for (let pos = 0; pos < session.queue.length; pos += 1) {
      if (partialAfter !== null && wrote >= partialAfter) break;
      const cardKey = session.queue[pos];
      const char = charOfCardKey(cardKey);
      const card = cardForKey(cardKey);
      const st0 = stateNow();
      const schedBefore = st0.sched && st0.sched[cardKey] ? st0.sched[cardKey] : null;
      const isNew = !schedBefore;
      const today = localDay(clock.t);
      const od = schedBefore ? overdueDays(schedBefore, today) : null;
      const p = recallP({ card, char, isNew, nowMs: clock.t });
      const src = sourceOf(cardKey);
      entry.queue.push({ char, src });

      // 当天重复出现统计
      const sk = today + '|' + cardKey;
      seenToday.set(sk, (seenToday.get(sk) || 0) + 1);

      // 用户动作
      const r1 = rand();
      let action;
      let hints = 0;
      let judgment = null;
      let pc = p;
      if (r1 < user.skipRate) action = 'skip';
      else if (r1 < user.skipRate + user.answerRate) action = 'seen';
      else {
        action = 'judged';
        const hr = !isNew && user.hintRateReview !== undefined ? user.hintRateReview : user.hintRate;
        if (rand() < hr) {
          hints = rand() < 0.5 ? 1 : 2;
          pc = Math.max(p, user.hintCorrect);
        }
        judgment = rand() < pc ? 'correct' : 'wrong';
      }

      // 探针：撤销跳过（跳过又撤销，应与没跳过一致）
      if (probeRand() < cfg.probeRate) {
        const foldedBefore = foldedMonths();
        const snap = snapOf(slot);
        const sk1 = commitSkip(store, { slot, cardKey, hints: 0 });
        let ok = sk1.ok;
        if (ok) {
          const un = commitUndoSkip(store, { slot, sessionId: session.id, recordId: sk1.record.id });
          ok = un.ok;
        }
        const snap2 = snapOf(slot);
        probes.skipUndo.n += 1;
        // 这两次提交里刚好触发了预算回收（最旧月份折叠）时，记录本来就会变——不是撤销的问题，不比
        const foldedNow = foldedMonths();
        const foldedDuring = foldedNow !== foldedBefore;
        if (!foldedDuring && (!ok || snap !== snap2)) {
          probes.skipUndo.bad += 1;
          viol('P1-skip-undo-restores', today, `${char}：撤销后状态与跳过前不一致`);
        }
      }

      let rating = null;
      let hintedFlag = false;
      if (action === 'judged') {
        hintedFlag = hints > 0;
        const j = commitJudgment(store, { slot, cardKey, judgment, strokes: STROKES, hints, perRecordInk: false });
        if (!j.ok) {
          // 判断没存上（真实用户会看到失败提示）。记一次违反，然后让用户放弃这个字（跳过）继续。
          viol('X1-judge-commit-fails', today, `${char}：${JSON.stringify(j.error)}`);
          action = 'judge-failed';
          const sj = commitSkip(store, { slot, cardKey, hints: 0 });
          if (!sj.ok) throw new Error('skip after failed judge failed: ' + JSON.stringify(sj.error));
        } else {
        // D66 ①：判断前看过答案的新字不算第一次；当天看答案已记过 Again 的字这次判断不再评级（记「—」）
        const seenBefore = !schedBefore && recordsOf(st0).some(r => r.kind === 'answer-seen' && r.cardKey === cardKey);
        rating = schedBefore && schedBefore.seenAgainDay === today ? '—'
          : ratingFor(judgment, { hints }, policy, { first: !seenBefore && (!schedBefore || (Number(schedBefore.fsrs && schedBefore.fsrs.reps) || 0) === 0), warmup: isWarmupKey(cardKey) });
        memUpdate({ card, char, outcome: judgment, p, nowMs: clock.t, hinted: hintedFlag });
        if (cfg.memory && !isNew) {
          memStats.reviews += 1;
          memStats.pSum += p;
          if (judgment === 'correct') memStats.correct += 1;
          const b = od === null ? 'x' : od <= 0 ? '0' : od <= 3 ? '1-3' : od <= 10 ? '4-10' : '11+';
          const bs = memStats.byBucket[b] || (memStats.byBucket[b] = { n: 0, p: 0 });
          bs.n += 1;
          bs.p += p;
        }
        }
      } else if (action === 'skip') {
        const j = commitSkip(store, { slot, cardKey, hints: 0 });
        if (!j.ok) throw new Error('skip failed');
      } else {
        const a = commitAnswerSeen(store, { slot, cardKey });
        if (!a.ok) throw new Error('answer-seen failed ' + JSON.stringify(a.error));
        const n = commitAnswerNext(store, { slot, cardKey, strokes: null, perRecordInk: false });
        if (!n.ok) throw new Error('answer-next failed ' + JSON.stringify(n.error));
        memUpdate({ card, char, outcome: 'seen', p, nowMs: clock.t });
      }
      wrote += 1;

      const st1 = stateNow();
      const after = st1.sched && st1.sched[cardKey] ? st1.sched[cardKey] : null;
      if (action !== 'judged' && action !== 'judge-failed') {
        probes.skipSeenNoSched.n += 1;
        // D66 ①：复习字看了答案当天记一次 Again（调度项带 seenAgainDay = 今天、不多出判断）；跳过与新字看答案仍不改调度表
        const seenAgain = action === 'seen' && schedBefore && after && after.seenAgainDay === today && after.lastJudgedAt === schedBefore.lastJudgedAt
          && after.fsrs.reps === schedBefore.fsrs.reps + 1;
        if (seenAgain) seenAgainCount += 1;
        if (!seenAgain && !jsonEq(schedBefore, after)) {
          probes.skipSeenNoSched.bad += 1;
          viol('P3-skip-seen-no-sched', today, `${char} ${action}`);
        }
      }
      events.push({
        scenario: cfg.id, day: today, dayIdx, group: groupIdx, slot, pos: pos + 1, char, src, action, hints, judgment: judgment || '',
        rating: rating || '', overdueAtStart: od === null ? '' : od, p: Math.round(p * 1000) / 1000,
        dueAfter: after ? after.due : '', stabilityAfter: after ? Math.round(after.fsrs.stability * 100) / 100 : '',
        difficultyAfter: after ? Math.round(after.fsrs.difficulty * 100) / 100 : '',
        intervalDays: after ? diffDays(today, after.due) : '',
        reps: after ? after.fsrs.reps : '', lapses: after ? after.fsrs.lapses : '',
      });
      entry.queue[entry.queue.length - 1].action = action === 'judge-failed' ? '保存失败' : action === 'judged' ? judgment + (hints ? `+提示${hints}` : '') : action;
      entry.queue[entry.queue.length - 1].dueAfter = after ? after.due : '';
      entry.queue[entry.queue.length - 1].stabilityAfter = after ? Math.round(after.fsrs.stability * 100) / 100 : '';
      clock.t += 40000;
    }
    entry.unwritten = session.queue.slice(wrote).map(charOfCardKey);
    groups.push(entry);

    // 探针：结果页「改成写错再改回来」
    const s = stateNow().sessions[slot];
    if (s && s.cursor >= s.queue.length && probeRand() < cfg.probeRate * 3) {
      const judgedItems = s.items.filter(it => it.kind === 'judged' && it.fsrsBefore);
      if (judgedItems.length) {
        const it = judgedItems[Math.floor(probeRand() * judgedItems.length)];
        const rec0 = recordsOf(stateNow()).find(r => r.id === it.recordId);
        const before = JSON.stringify(stateNow().sched[it.cardKey]);
        const to = rec0.judgment === 'correct' ? 'wrong' : 'correct';
        const c1 = commitResultCorrection(store, { slot, sessionId: s.id, recordId: it.recordId, to });
        const c2 = c1.ok ? commitResultCorrection(store, { slot, sessionId: s.id, recordId: it.recordId, to: rec0.judgment }) : c1;
        const after = JSON.stringify(stateNow().sched[it.cardKey]);
        probes.correction.n += 1;
        if (!c1.ok || !c2.ok || before !== after) {
          probes.correction.bad += 1;
          viol('P2-correction-roundtrip', localDay(clock.t), `${rec0.char}：${rec0.judgment}→${to}→${rec0.judgment} 后调度表变了`);
        }
      }
    }
    return gi;
  }

  // ---------------------------------------------------------------- 按天
  const reminderRows = [];
  for (let dayIdx = 0; dayIdx < cfg.days; dayIdx += 1) {
    // 事件
    for (const ev of cfg.events.filter(e => e.day === dayIdx)) {
      if (ev.type === 'library') store.commit('sim:library', d => { d.settings = { ...(d.settings || {}), library: ev.library }; });
      else if (ev.type === 'clock') { skew += ev.shiftDays; skewTotal += ev.shiftDays; }
      else if (ev.type === 'tz') process.env.TZ = ev.tz;
      else if (ev.type === 'user') user = { ...user, ...ev.patch };
      else if (ev.type === 'groupSize') store.commit('sim:group-size', d => { d.settings = { ...(d.settings || {}), groupSize: ev.groupSize }; });
    }
    clock.t = instantOf(dayIdx, skew);
    const today = localDay(clock.t);
    const rest = inRest(cfg, dayIdx);
    const st = stateNow();
    const scan0 = schedScan(st.sched, today);
    const row = {
      scenario: cfg.id, dayIdx, day: today, practiced: false, groups: 0, cards: 0, newCards: 0, dueCards: 0, earlyCards: 0, wrongRetry: 0,
      warmCards: 0, specialCards: 0, correct: 0, wrong: 0, hinted: 0, seen: 0, skipped: 0,
      backlogStart: scan0.due, overdueMaxStart: scan0.overdueMax, schedN: scan0.n,
      pressureStart: '', newTargetStart: '', budgetLeftStart: '', recorded: 0, zoneDue: 0, zoneShaky: 0, zoneKnown: 0, skippedZone: 0,
      dueTomorrow: scan0.dueTomorrow, due7: scan0.due7, backlogEnd: scan0.due, empty: '', todayPlan: '',
      remindQuestions: '', remindFirst: '', remindEligible: '', remindSched: '', library: '',
    };
    if (rest) {
      days.push(finishRow(row, today));
      continue;
    }
    // 打开 App：跨天过期
    expireStale(store, { now: () => clock.t });
    // 逾期统计（只在用户练习的日子计）
    {
      const sched = stateNow().sched || {};
      for (const e of Object.values(sched)) {
        const od = e && e.stoppedAt === undefined ? overdueDays(e, today) : null;
        if (od !== null && od > maxOverdueSeen) maxOverdueSeen = od;
        if (od !== null && od > cfg.starveDays) starveCardDays += 1;
      }
    }
    // 今日计划（不写入）
    const info = aStartInfo(stateNow());
    if (info.kind === 'daily') {
      const peek = planDaily(stateNow(), { today, deck: deckAdapter, policy });
      row.pressureStart = Math.round(peek.pressure * 100) / 100;
      row.newTargetStart = peek.newTarget;
      row.budgetLeftStart = peek.reviewBudgetLeft;
      row.library = peek.libraryId;
      row.exhausted = !!peek.libraryExhausted;
      const zp = checkZonePlanAgree({ state: stateNow(), today, plan: peek });
      row.zonePlanDiff = zp.onlyZone.length + zp.onlyPlan.length;
      for (const x of zp.violations) viol(x.id, today, x.detail);
    }
    const tp = todayPlanModel(stateNow(), clock.t, { deck: deckAdapter, policy });
    row.todayPlan = `${tp.phase}:${tp.n}(复${tp.review}/新${tp.fresh})`;

    const nGroups = typeof cfg.groupsPerDay === 'function' ? cfg.groupsPerDay(dayIdx) : cfg.groupsPerDay;
    const picks = cfg.events.filter(e => e.day === dayIdx && e.type === 'pick');
    for (let g = 0; g < nGroups; g += 1) {
      clock.t = instantOf(dayIdx, skew) + g * 25 * 60000;
      const state0 = stateNow();
      const records = recordsOf(state0);
      const startInfo = aStartInfo(state0);
      const res = startNextA(store, { now: () => clock.t, deck: deckAdapter });
      if (!res.ok) throw new Error('startNextA failed ' + JSON.stringify(res.error));
      if (res.empty) {
        row.empty = res.libraryExhausted ? '字库写完' : '没有要写的字';
        break;
      }
      const session = res.session;
      const isLast = g === nGroups - 1;
      const partialAfter = isLast && user.partialRate > 0 && rand() < user.partialRate ? Math.max(1, Math.floor(rand() * session.queue.length)) : null;
      if (res.started) {
        viols(checkGroup({ state: state0, today, queue: session.queue, plan: res.plan, kind: startInfo.kind, deck: { libraryOf, newCandidates: deckAdapter.newCandidates }, records }), today);
      }
      writeSession({ slot: 'A', session, plan: res.plan, kind: res.started ? startInfo.kind : session.kind, day: today, dayIdx, groupIdx: g, partialAfter });
      row.groups += 1;
    }
    // 自选字（B 槽）
    for (const pk of picks) {
      clock.t = instantOf(dayIdx, skew) + 3 * 3600000;
      const lib = libraryOf(stateNow().settings && stateNow().settings.library ? stateNow().settings.library : 'core3500');
      const sched = stateNow().sched || {};
      const fresh = deckAdapter.newCandidates(lib.id).filter(k => !sched[k]).slice(pk.offset || 0, (pk.offset || 0) + pk.n);
      const r = startPicked(store, { keys: fresh, deck: deckAdapter });
      if (r.started) {
        const plan = { backlog: null, pressure: null, newTarget: null, reviewBudgetLeft: null, special: null, customKeys: [], earlyKeys: [], dueKeys: [], warmKeys: [], newKeys: [] };
        writeSession({ slot: 'B', session: r.session, plan, kind: 'picked', day: today, dayIdx, groupIdx: 100, partialAfter: null });
        row.groups += 1;
      }
    }
    row.practiced = true;
    days.push(finishRow(row, today, true));
  }

  function finishRow(row, today, practiced = false) {
    const st = stateNow();
    const todaysEvents = events.filter(e => e.dayIdx === row.dayIdx);
    row.cards = todaysEvents.length;
    for (const e of todaysEvents) {
      if (e.src === 'new' || e.src === 'warm-new' || e.src === 'first') row.newCards += 1;
      else if (e.src === 'due' || e.src === 'due-wrong') row.dueCards += 1;
      else if (e.src === 'early') row.earlyCards += 1;
      if (e.src === 'due-wrong') row.wrongRetry += 1;
      if (e.src === 'warm-new') row.warmCards += 1;
      if (e.src === 'special') row.specialCards += 1;
      if (e.action === 'judged') {
        if (e.judgment === 'correct') row.correct += 1;
        else row.wrong += 1;
        if (e.hints) row.hinted += 1;
      } else if (e.action === 'seen') row.seen += 1;
      else row.skipped += 1;
    }
    const z = memoryZones(st, today);
    row.recorded = z.recorded;
    row.zoneDue = z.zones.due.n;
    row.zoneShaky = z.zones.shaky.n;
    row.zoneKnown = z.zones.known.n;
    row.skippedZone = skippedZone(st).n;
    const scan = schedScan(st.sched, today);
    row.backlogEnd = scan.due;
    row.dueTomorrow = scan.dueTomorrow;
    row.due7 = scan.due7;
    row.schedN = scan.n;
    // 一天内到期复习数 ≤ 上限（G10）
    const dueDone = dueReviewsDoneOn(recordsOf(st), today, { sched: st.sched, policy });
    const cap = dailyReviewCapOf(groupSizeOf(st.settings, policy), policy);
    if (dueDone > cap) viol('G10-daily-cap', today, `${dueDone} > ${cap}`);
    viols(checkState({ state: st, today }), today);
    // 提醒
    if (practiced || true) {
      try {
        const deck = { cardFor: cardForKey, practicable: isPracticable };
        const cands = reminderCandidates(st, { deck });
        const qs = reminderQuestions(st, { today, deck });
        row.remindQuestions = qs.length;
        row.remindFirst = qs[0] ? charOfCardKey(qs[0].targetCardKey) + (cands.find(c => c.cardKey === qs[0].targetCardKey).wrong ? '(错)' : '') : '';
        row.remindEligible = cands.length;
        row.remindSched = scan.n;
        const used = new Set();
        for (const q of qs) {
          const e = st.sched[q.targetCardKey];
          if (!e || e.due > q.day || !isPracticable(q.targetCardKey)) viol('R1-reminder-target-due', today, `${q.targetCardKey} 提醒日 ${q.day}`);
          const avail = cands.filter(c => c.due <= q.day && !used.has(c.cardKey));
          const pick = cands.find(c => c.cardKey === q.targetCardKey);
          if (avail.some(c => c.wrong) && pick && !pick.wrong) viol('R2-reminder-wrong-first', today, `${q.day} 选了 ${pick.cardKey} 而不是写错过的`);
          used.add(q.targetCardKey);
        }
      } catch (error) {
        viol('R1-reminder-target-due', today, 'reminder threw: ' + error.message);
      }
    }
    return row;
  }

  // 刚跳过 / 看过答案的字当天又出现（P4）：按事件统计
  {
    const byDayCard = new Map();
    for (const e of events) {
      if (e.slot !== 'A') continue;
      const k = e.day + '|' + e.char;
      const list = byDayCard.get(k) || [];
      list.push(e);
      byDayCard.set(k, list);
    }
    for (const [k, list] of byDayCard) {
      if (list.length >= 2 && list.slice(0, -1).some(e => e.action !== 'judged')) {
        viol('P4-skip-seen-not-reoffered-today', k.split('|')[0], `${list[0].char} 当天第 ${list.length} 次出现（前面有${list.slice(0, -1).map(e => e.action === 'skip' ? '跳过' : '看答案').join('/')}）`);
      }
    }
  }
  // W1：写错的字，第二天（用户第二天也练的话）一定回来
  {
    const byDay = new Map();
    for (const e of events) {
      if (!byDay.has(e.dayIdx)) byDay.set(e.dayIdx, []);
      byDay.get(e.dayIdx).push(e);
    }
    for (const e of events) {
      if (e.action !== 'judged' || e.judgment !== 'wrong' || e.slot !== 'A') continue;
      const next = byDay.get(e.dayIdx + 1);
      if (!next) continue; // 第二天没练
      if (days[e.dayIdx + 1] && days[e.dayIdx + 1].day === e.day) continue; // 日期没变（时钟 / 时区）：不比
      if (!next.some(x => x.char === e.char)) viol('W1-wrong-returns-next-day', e.day, `${e.char} 写错后第二天没有回来（第二天开始时积压 ${days[e.dayIdx + 1].backlogStart}）`);
    }
  }
  // D7：长期逾期
  if (starveCardDays > 0) viol('D7-due-not-starved-long', 'run', `${starveCardDays} 个「字·天」逾期超过 ${cfg.starveDays} 天；最长逾期 ${maxOverdueSeen} 天`);

  if (process.env.TZ !== origTz) {
    if (origTz === undefined) delete process.env.TZ;
    else process.env.TZ = origTz;
  }
  const final = stateNow();
  return {
    cfg, days, groups, events, violations, probes, memStats, state: final, skewTotal,
    maxOverdueSeen, starveCardDays, sameDay: [...seenToday.values()].filter(n => n > 1).length, seenAgainCount,
  };
}

export { addDays, diffDays };
