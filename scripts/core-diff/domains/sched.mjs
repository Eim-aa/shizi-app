// 调度域（B4.2）：FSRS（评级、复习、看答案、判断、重放）、配比（mix）、会话（sessions）、开组（session-start，含提交类 op 的内存 store）、
// 新字顺序 / 特别组 / 每组字数 / 摊开 / 提示 / 改判。随机「像真的」状态见 lib/sched-shapes.mjs；少量坏参数验同一套校验。
import { schedShapes } from '../lib/sched-shapes.mjs';

const POLICY_PATCHES = [
  {}, {}, {}, {},
  { answerSeenScope: 'none' }, { skipScope: 'session' }, { customIntoDaily: 'first' }, { customIntoDaily: 'after-due' },
  { dailyExpiry: 'result' }, { sessionExpiry: { first: 'daily', picked: 'daily' } }, { afterClearRestartFirst: false },
  { s02EndOld: 'result' }, { skipNewDeferDays: 0 }, { answerSeenRating: 'Good' }, { ratingFirstCorrect: 'Good' },
  { wrongFirst: { enabled: false } }, { capitalNumerals: { enabled: true, afterGroups: 2, belowDays: 9 } }, { newUserRamp: null },
  { groupMix: { baseSize: 5, reviewsPerGroupForPressure: 3, pressureWindowDays: 7, recentNewWindow: 10, newAccuracyPrior: 0.7, allAccuracyPrior: 0.8, accuracyPriorWeight: 3, valveDays: 4, valveReleaseDays: null, twoNewBelowDays: 1.5, threeNewBelowDays: 0.5, threeNewMinAccuracy: 0.6, newMax: 3, earlyReviewFill: true, earlyCountsTowardCap: false, returnAfterDays: 7, returnGroupSize: 3, earlyFillWhenExhausted: true } },
  { returnSpread: { afterDays: 5, perDayShare: 0.5 } }, { dayStartHour: 0 },
];

let S = null;

export default {
  id: 'sched',
  prepare(g) {
    S = schedShapes(g.r);
    g.sched = S;
    g.policyPatch = () => (g.chance(0.75) ? undefined : g.pick(POLICY_PATCHES));
    g.withPolicy = (args) => {
      const p = g.policyPatch();
      return p && Object.keys(p).length ? { ...args, policy: p } : args;
    };
    g.fakeDeck = () => {
      if (g.chance(0.5)) return undefined; // 真题库
      const ks = S.keys();
      const start = g.int(0, ks.length - 30);
      const d = { newCandidates: ks.slice(start, start + g.int(0, 40)) };
      if (g.chance(0.6)) d.warmupCandidates = ks.filter((k, i) => i % 17 === 3).slice(0, g.int(0, 6));
      if (g.chance(0.5)) d.practicable = ks.filter(() => g.chance(0.9));
      if (g.chance(0.3)) d.currentLibraryId = g.pick(['core3500', 'adv3000', 'x']);
      return d;
    };
    g.review = (at) => {
      const rv = { judgment: g.chance(0.9) ? g.pick(['correct', 'correct', 'wrong']) : g.pick(['x', '', 'skipped']), at, cardKey: g.pick(S.keys()) };
      if (g.chance(0.4)) rv.help = { hints: g.pick([0, 1, 2, 3, 5]) };
      return rv;
    };
    g.atNear = () => S.T0 + g.int(0, 500) * S.DAY + g.int(0, S.DAY);
  },
  ops: {
    'fsrs.ratingFor': { weight: 1, args: (g) => g.withPolicy({ judgment: g.pick(['correct', 'wrong', 'x']), help: { hints: g.pick([0, 1, 2, 3, 9]) }, first: g.chance(0.5), warmup: g.chance(0.3) }) },
    'fsrs.reviewCard': {
      weight: 5,
      args: (g) => {
        const lastAt = g.atNear();
        const a = { review: g.review(lastAt + g.int(-3, 60) * S.DAY + g.int(0, S.DAY)) };
        if (g.chance(0.8)) a.before = S.compact({ lastAt });
        if (g.chance(0.2)) a.warmup = g.chance(0.5);
        return g.withPolicy(a);
      },
    },
    'fsrs.applyJudgment': {
      weight: 4,
      args: (g) => {
        const h = S.history({ days: g.int(0, 20) });
        const judged = h.records.filter((r) => r.kind === 'judged');
        const rec = judged.length ? g.pick(judged) : { id: 'r1', cardKey: 'base:x', char: 'x', sessionId: 's1', kind: 'judged', judgment: 'correct', at: S.T0, localDay: '2026-03-02', help: { hints: 0, answerSeen: false, traced: false } };
        const a = { record: rec };
        if (g.chance(0.7) && h.sched[rec.cardKey]) a.entry = h.sched[rec.cardKey];
        if (g.chance(0.6)) a.records = h.records;
        return g.withPolicy(a);
      },
    },
    'fsrs.applyAnswerSeen': {
      weight: 3,
      args: (g) => {
        const h = S.history({ days: g.int(1, 20) });
        const seen = h.records.filter((r) => r.kind === 'answer-seen');
        const rec = seen.length ? g.pick(seen) : { id: 'r1', cardKey: 'base:x', char: 'x', sessionId: 's1', kind: 'answer-seen', at: S.T0, localDay: '2026-03-02', help: { hints: 0, answerSeen: true, traced: true } };
        const a = { record: rec };
        const e = h.sched[rec.cardKey];
        if (e) a.entry = g.chance(0.3) ? { ...e, seenAgainDay: rec.localDay } : e;
        return g.withPolicy(a);
      },
    },
    'fsrs.replay': {
      weight: 4,
      args: (g) => {
        const h = S.history({ days: g.int(1, 30), maxPerGroup: 12 });
        const key = h.records.length ? g.pick(h.records).cardKey : 'base:x';
        const a = { records: h.records.filter((r) => r.cardKey === key) };
        if (g.chance(0.5)) a.fsrsBefore = g.chance(0.3) ? { ...S.compact({ lastAt: S.T0 }), seenBefore: true, reps: 0 } : S.compact({ lastAt: S.T0 });
        if (g.chance(0.15)) a.stoppedAt = 5;
        return g.withPolicy(a);
      },
    },
    'fsrs.overdueDays': { weight: 1, args: (g) => ({ entry: { due: S.dayOf(g.atNear()) }, today: g.chance(0.95) ? S.dayOf(g.atNear()) : 'x' }) },
    'fsrs.retrievability': { weight: 1, args: (g) => ({ entry: { fsrs: S.compact({ lastAt: g.atNear() }) }, now: g.atNear() + 30 * S.DAY }) },
    'mix.practiceStats': { weight: 2, args: (g) => { const h = S.history(); return g.withPolicy({ records: h.records, today: h.today }); } },
    'mix.dueReviewsDoneOn': {
      weight: 2,
      args: (g) => {
        const h = S.history({ days: g.int(2, 25) });
        const today = h.records.length && g.chance(0.6) ? h.records[h.records.length - 1].localDay : h.today;
        return g.withPolicy({ records: h.records, today, sched: h.sched, policy: { groupMix: { ...(g.chance(0.5) ? {} : {}), baseSize: 5, reviewsPerGroupForPressure: 3, pressureWindowDays: 7, recentNewWindow: 10, newAccuracyPrior: 0.7, allAccuracyPrior: 0.8, accuracyPriorWeight: 3, valveDays: 4, valveReleaseDays: 2, twoNewBelowDays: 1.5, threeNewBelowDays: 0.5, threeNewMinAccuracy: 0.6, newMax: 3, earlyReviewFill: true, earlyCountsTowardCap: g.chance(0.2), returnAfterDays: 7, returnGroupSize: 3, earlyFillWhenExhausted: false } } });
      },
    },
    'mix.newTargetOf': {
      weight: 1,
      args: (g) => g.withPolicy({ state: { backlog: g.int(0, 120), groupsPerDay: g.pick([1, 1.5, 2, 3]), newAccuracy: g.r(), lastHadNew: g.chance(0.5), firstBack: g.chance(0.2) }, ...(g.chance(0.5) ? { size: g.pick([5, 10, 20, 30]) } : {}) }),
    },
    'mix.planGroup': {
      weight: 2,
      args: (g) => {
        const ks = S.keys();
        const due = ks.filter(() => g.chance(0.08));
        return g.withPolicy({
          size: g.pick([3, 5, 10, 20, 30]), budget: g.int(0, 40), due, early: ks.filter((k) => !due.includes(k) && g.chance(0.05)),
          warmNext: g.chance(0.5) ? g.pick(ks) : null, warmOk: g.chance(0.5),
          state: { backlog: due.length, groupsPerDay: g.pick([1, 2]), newAccuracy: g.r(), lastHadNew: g.chance(0.5), firstBack: g.chance(0.1) },
          ...(g.chance(0.4) ? { newAvailable: g.int(0, 30) } : {}), ...(g.chance(0.4) ? { reserve: g.int(0, 6) } : {}), ...(g.chance(0.3) ? { pressureSize: 20 } : {}), ...(g.chance(0.3) ? { newCap: g.int(0, 12) } : {}),
        });
      },
    },
    'mix.arrangeGroup': {
      weight: 1,
      args: (g) => {
        const ks = S.keys();
        const pickN = (n) => Array.from({ length: n }, () => g.pick(ks));
        return { warmNew: g.chance(0.4) ? g.pick(ks) : null, revKeys: pickN(g.int(0, 6)), earlyKeys: pickN(g.int(0, 3)), newKeys: pickN(g.int(0, 6)) };
      },
    },
    'sessions.createSession': {
      weight: 1,
      args: (g) => ({
        id: g.chance(0.9) ? 's' + g.int(1, 99) : g.pick(['s0', 'x', 5]), kind: g.chance(0.9) ? g.pick(['first', 'daily', 'picked']) : 'nope',
        queue: g.chance(0.9) ? [...new Set(Array.from({ length: g.int(1, 6) }, () => g.pick(S.keys())))] : g.pick([[], ['base:x', 'base:x'], ['x'], 'base:x']),
        at: g.chance(0.95) ? g.atNear() : 'x', ...(g.chance(0.3) ? { source: { view: 'detail', char: 'x' } } : {}),
      }),
    },
    'sessions.advance': {
      weight: 2,
      args: (g) => {
        const s = S.session();
        const cur = s.cursor < s.queue.length ? s.queue[s.cursor] : null;
        const a = { session: s, cardKey: g.chance(0.85) ? cur : g.pick(S.keys()), kind: g.pick(['judged', 'answer-seen', 'skipped', 'judged', 'x']), at: g.atNear() };
        if (g.chance(0.8)) a.recordId = 'r' + g.int(1, 999);
        if (g.chance(0.5)) a.fsrsBefore = S.compact({ lastAt: S.T0 });
        return a;
      },
    },
    'sessions.withCurrent': { weight: 1, args: (g) => ({ session: S.session(), patch: g.pick([{ phase: 'compare' }, { phase: 'nope' }, { hints: 2 }, { strokes: ['a'] }, {}]), ...(g.chance(0.5) ? { at: g.atNear() } : {}) }) },
    'sessions.undoSkip': {
      weight: 1,
      args: (g) => {
        const s = S.session();
        const last = s.items[s.items.length - 1];
        return { session: s, recordId: last && g.chance(0.8) ? last.recordId : 'r1', at: g.atNear() };
      },
    },
    'sessions.markLineChanged': { weight: 1, args: (g) => { const s = S.session(); return { session: s, recordId: s.lastLine && g.chance(0.7) ? s.lastLine.recordId : 'r1' }; } },
    'sessions.endSlot': { weight: 1, args: (g) => ({ sessions: S.sessions(S.dayOf(g.atNear())), slot: g.pick(['A', 'B']), at: g.atNear(), early: g.chance(0.5) }) },
    'sessions.resumeLines': { weight: 1, args: (g) => ({ sessions: S.sessions(S.dayOf(g.atNear())) }) },
    'sessions.s02Prompt': { weight: 1, args: (g) => ({ sessions: S.sessions(S.dayOf(g.atNear())) }) },
    'sessions.expireDaily': { weight: 2, args: (g) => { const today = S.dayOf(g.atNear()); return g.withPolicy({ sessions: S.sessions(today), today }); } },
    'sessions.recoverSession': {
      weight: 1,
      args: (g) => {
        const s = S.session();
        const h = S.history({ days: g.int(0, 3) });
        const cur = s.queue[s.cursor];
        const records = h.records.slice(0, 5);
        if (cur && g.chance(0.5)) records.push({ id: 'r777', cardKey: cur, char: cur.slice(5), sessionId: s.id, kind: 'judged', judgment: 'correct', at: S.T0, localDay: '2026-03-02', help: { hints: 0, answerSeen: false, traced: false } });
        return { session: s, records };
      },
    },
    'sessions.selectDaily': {
      weight: 6,
      args: (g) => {
        const st = S.state();
        const ks = S.keys();
        const a = { sched: st.sched, records: st.records, today: st.today, newCandidates: ks.filter(() => g.chance(0.6)), groupSize: g.pick([5, 10, 20, 30, null, 7]) };
        if (g.chance(0.6)) a.warmupCandidates = ks.filter((k, i) => i % 11 === 0);
        if (st.state.custom) a.custom = st.state.custom;
        if (g.chance(0.3)) a.practicable = ks.filter(() => g.chance(0.95));
        if (g.chance(0.2)) a.capitalDeferredDay = st.today;
        return g.withPolicy(a);
      },
    },
    'sessions.specialPlan': { weight: 1, args: (g) => { const st = S.state({ days: g.int(5, 40) }); return g.withPolicy({ sched: st.sched, records: st.records, today: st.today, groupSize: g.pick([5, 20]) }); } },
    'sessions.skipDeferredNewKeys': { weight: 1, args: (g) => { const h = S.history(); return g.withPolicy({ records: h.records, today: h.today }); } },
    'newOrder.orderNewKeys': { weight: 1, args: (g) => ({ keys: S.keys().filter(() => g.chance(0.4)) }) },
    'newOrder.warmupKeys': { weight: 1, args: (g) => ({ keys: S.keys().filter(() => g.chance(0.5)) }) },
    'newOrder.facts': { weight: 1, args: (g) => ({ char: g.pick(S.keys()).slice(5) }) },
    'special.capitalProgress': { weight: 1, args: (g) => ({ records: S.history().records }) },
    'groupSize.of': { weight: 1, args: (g) => g.withPolicy({ settings: g.pick([{}, { groupSize: 5 }, { groupSize: 30 }, { groupSize: '5' }, { groupSize: 8 }, null]) }) },
    'groupSize.dailyReviewCapOf': { weight: 1, args: (g) => ({ size: g.pick([5, 10, 20, 30, 7, null, '20']) }) },
    'spread.spreadDue': { weight: 1, args: (g) => { const h = S.history({ days: g.int(5, 40) }); return { sched: h.sched, today: h.today, perDay: g.pick([1, 3, 10, 0]) }; } },
    'spread.returnSpreadPlan': { weight: 2, args: (g) => { const st = S.state({ days: g.int(5, 40) }); return g.withPolicy({ state: st.state, today: st.today }); } },
    'hints.facts': { weight: 1, args: (g) => ({ input: { totalStrokes: g.pick([1, 2, 3, 4, 8, 14, 23, 0, '14', 2.5]), used: g.int(0, 8), ...(g.chance(0.2) ? { hasGroups: false } : {}), ...(g.chance(0.1) ? { hasStrokeData: false } : {}) } }) },
    'hints.button': { weight: 1, args: (g) => ({ input: { totalStrokes: g.pick([0, 3, 14, 30]), used: g.int(0, 8), ...(g.chance(0.1) ? { hasStrokeData: false } : {}) } }) },
    'correct.schedAfterCorrection': {
      weight: 2,
      args: (g) => {
        const h = S.history({ days: g.int(1, 20) });
        const judged = h.records.filter((r) => r.kind === 'judged');
        const rec = judged.length ? g.pick(judged) : null;
        const a = { records: h.records.filter((r) => rec && r.cardKey === rec.cardKey), recordId: rec ? rec.id : 'r1' };
        if (g.chance(0.5)) a.fsrsBefore = S.compact({ lastAt: S.T0 });
        return g.withPolicy(a);
      },
    },
    'start.aStartInfo': { weight: 1, args: (g) => { const st = S.state(); return { state: st.state }; } },
    'start.planDaily': { weight: 5, args: (g) => { const st = S.state(); const d = g.fakeDeck(); return g.withPolicy({ state: st.state, today: st.today, ...(d ? { deck: d } : {}) }); } },
    'start.planSpecial': { weight: 1, args: (g) => { const st = S.state({ days: g.int(5, 40) }); return { state: st.state, today: st.today }; } },
    'start.startNextA': { weight: 5, args: (g) => { const st = S.state(); const d = g.fakeDeck(); return g.withPolicy({ state: st.state, now: st.nowAt, serial: st.serial + g.int(0, 3), ...(d ? { deck: d } : {}) }); } },
    'start.expireStale': { weight: 3, args: (g) => { const st = S.state(); return g.withPolicy({ state: st.state, now: st.nowAt, serial: st.serial }); } },
    'start.startPicked': {
      weight: 2,
      args: (g) => {
        const st = S.state({ days: g.int(0, 10) });
        const keys = g.chance(0.9) ? Array.from({ length: g.int(1, 5) }, () => (g.chance(0.7) ? g.pick(S.keys()) : g.pick(S.keys()).slice(5))) : g.pick([['x:y'], [5, null]]);
        return { state: st.state, keys, now: st.nowAt, serial: st.serial, ...(g.chance(0.5) ? { deck: 'real' } : {}) };
      },
    },
    'start.endOldAndStartPicked': { weight: 1, args: (g) => { const st = S.state({ days: g.int(0, 10) }); return g.withPolicy({ state: st.state, keys: [g.pick(S.keys()), g.pick(S.keys())], now: st.nowAt, serial: st.serial }); } },
    'start.deferSpecial': { weight: 1, args: (g) => { const st = S.state({ days: g.int(0, 5) }); return { state: st.state, now: st.nowAt, serial: st.serial }; } },
    'start.resumeSlot': { weight: 1, args: (g) => { const st = S.state({ days: g.int(0, 10) }); return g.withPolicy({ state: st.state, slot: g.pick(['A', 'B']), now: st.nowAt, serial: st.serial }); } },
  },
};
