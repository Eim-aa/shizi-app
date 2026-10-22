// 金标准 · 选字与组成（src/core/sessions.js selectDaily / session-start.js planDaily · startNextA · expireStale / mix.js / spread.js；
// 计划 §4.3 ①「选字 / 组成」）。随机「像真的」状态（scripts/core-diff/lib/sched-shapes.mjs，固定种子）× 真题库 / 假题库 × 几种 policy 覆盖，
// 期望值是参考引擎的回包。两个时区。
import { rng } from '../../core-diff/lib/gen.mjs';
import { schedShapes } from '../../core-diff/lib/sched-shapes.mjs';

const PATCHES = [undefined, undefined, { answerSeenScope: 'none' }, { customIntoDaily: 'first' }, { dailyExpiry: 'result' }, { skipNewDeferDays: 0 },
  { capitalNumerals: { enabled: true, afterGroups: 2, belowDays: 9 } }, { returnSpread: { afterDays: 5, perDayShare: 0.5 } }];

function cases() {
  const r = rng(20261023);
  const S = schedShapes(r);
  const R = [];
  const withP = (args) => {
    const p = S.pick(PATCHES);
    return p ? { ...args, policy: p } : args;
  };
  // 每个状态只配一个 op（状态整份进夹具，夹具大小 ≈ 状态数 × 状态大小）
  const ops = ['start.planDaily', 'start.startNextA', 'start.expireStale', 'mix.practiceStats', 'mix.dueReviewsDoneOn', 'spread.returnSpreadPlan', 'sessions.selectDaily'];
  for (let i = 0; i < 84; i += 1) {
    const st = S.state({ days: S.int(0, 18), maxPerGroup: 6 });
    const ks = S.keys();
    switch (ops[i % ops.length]) {
      case 'start.planDaily': R.push({ op: 'start.planDaily', args: withP({ state: st.state, today: st.today }) }); break;
      case 'start.startNextA': R.push({ op: 'start.startNextA', args: withP({ state: st.state, now: st.nowAt, serial: st.serial }) }); break;
      case 'start.expireStale': R.push({ op: 'start.expireStale', args: withP({ state: st.state, now: st.nowAt, serial: st.serial }) }); break;
      case 'mix.practiceStats': R.push({ op: 'mix.practiceStats', args: { records: st.records, today: st.today } }); break;
      case 'mix.dueReviewsDoneOn': R.push({ op: 'mix.dueReviewsDoneOn', args: { records: st.records, today: st.records.length ? st.records[st.records.length - 1].localDay : st.today, sched: st.sched } }); break;
      case 'spread.returnSpreadPlan': R.push({ op: 'spread.returnSpreadPlan', args: withP({ state: st.state, today: st.today }) }); break;
      default: R.push({ op: 'sessions.selectDaily', args: withP({ sched: st.sched, records: st.records, today: st.today, newCandidates: ks.filter(() => r() < 0.5), warmupCandidates: ks.filter((k, j) => j % 13 === 1), groupSize: S.pick([5, 10, 20, 30]) }) });
    }
  }
  for (let i = 0; i < 40; i += 1) {
    const ks = S.keys();
    const due = ks.filter(() => r() < 0.07);
    R.push({ op: 'mix.planGroup', args: { size: S.pick([3, 5, 10, 20, 30]), budget: S.int(0, 40), due, early: ks.filter((k) => !due.includes(k) && r() < 0.05), warmNext: r() < 0.5 ? S.pick(ks) : null, warmOk: r() < 0.5, state: { backlog: due.length, groupsPerDay: S.pick([1, 2]), newAccuracy: r(), lastHadNew: r() < 0.5, firstBack: r() < 0.1 }, newAvailable: S.int(0, 30), reserve: S.int(0, 6), newCap: S.int(0, 12) } });
    for (const backlog of [0, 3, 8, 15, 30, 64, 120]) R.push({ op: 'mix.newTargetOf', args: { state: { backlog, groupsPerDay: S.pick([1, 2, 3]), newAccuracy: r(), lastHadNew: r() < 0.5, firstBack: r() < 0.2 }, size: S.pick([5, 10, 20, 30]) } });
  }
  R.push({ op: 'newOrder.orderNewKeys', args: { keys: S.keys() } });
  R.push({ op: 'newOrder.warmupKeys', args: { keys: S.keys() } });
  R.push({ op: 'newOrder.capital', args: {} });
  for (const libraryId of ['core3500', 'adv3000', 'rare', 'curriculum2500', 'nope']) R.push({ op: 'schedDeck.facts', args: { libraryId } });
  return R;
}

export default {
  id: 'schedule',
  source: 'src/core/sessions.js、src/core/session-start.js、src/core/mix.js、src/core/spread.js、src/core/new-order.js、src/data/deck.js（deckAdapter）',
  build({ withTZ, opCases }) {
    const R = cases();
    return { groups: ['Asia/Shanghai', 'America/Los_Angeles'].map((tz) => withTZ(tz, () => ({ tz, cases: opCases(R) }))) };
  },
};
