// core/spread.js（D66 ⑨）：到期日摊开的纯函数——v1 迁移与离开 ≥ 30 天回来共用；回来那一刻只执行一次。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import { returnSpreadPerDay, returnSpreadPlan, spreadDue } from '../../src/core/spread.js';
import { spreadLegacyDue } from '../../src/store/migrate.js';
import { rec } from './helpers.mjs';

const TODAY = '2026-09-24';
const e = (due, stability = 5) => ({ fsrs: { stability }, due, lastJudgedAt: 0 });

test('spreadDue: overdue first, then lower stability; at most perDay a day including what was already due there; never earlier; stopped / not-due untouched', () => {
  const sched = {
    'base:甲': e('2026-09-01', 9), 'base:乙': e('2026-09-01', 2), 'base:丙': e('2026-09-10'), 'base:丁': e(TODAY),
    'base:戊': e('2026-09-25'), 'base:己': { ...e('2026-08-01'), stoppedAt: 1 },
  };
  const { sched: out, moved } = spreadDue(sched, { today: TODAY, perDay: 2 });
  assert.equal(out['base:乙'].due, TODAY, 'most overdue, least stable first');
  assert.equal(out['base:甲'].due, TODAY);
  assert.equal(out['base:丙'].due, '2026-09-25', '09-25 already has 戊 → one more slot');
  assert.equal(out['base:丁'].due, '2026-09-26');
  assert.equal(out['base:戊'].due, '2026-09-25', 'not due: untouched');
  assert.equal(out['base:己'].due, '2026-08-01', 'stopped: untouched');
  assert.equal(moved, 4);
  assert.equal(sched['base:乙'].due, '2026-09-01', 'input not mutated');
  assert.deepEqual(spreadLegacyDue(sched, { today: TODAY, perDay: 2 }), { sched: out, moved }, 'migration uses the same function');
  assert.equal(spreadDue(sched, { today: TODAY, perDay: 10 }).moved, 0, 'few enough → nothing moves');
});

test('returnSpreadPlan (policy.returnSpread P323): ≥ 30 days away, not written today, not done for this absence; perDay = round(group size × 0.5)', () => {
  assert.deepEqual({ ...policy.returnSpread }, { afterDays: 30, perDayShare: 0.5 });
  assert.equal(returnSpreadPerDay(null), 10, 'default 20-char group → 10 a day');
  assert.equal(returnSpreadPerDay({ groupSize: 5 }), 3);
  const sched = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`base:${String.fromCodePoint(0x4e00 + i)}`, e('2026-07-15')]));
  const records = { '2026-07': [rec(1, '一', 'judged', 'correct', '2026-07-10')] };
  const state = { records, sched, settings: null };
  const plan = returnSpreadPlan(state, TODAY);
  assert.deepEqual([plan.lastDay, plan.gapDays, plan.perDay, plan.moved], ['2026-07-10', 76, 10, 25]);
  assert.equal(returnSpreadPlan({ ...state, settings: { returnSpreadFor: '2026-07-10' } }, TODAY), null, 'already done for this absence');
  assert.ok(returnSpreadPlan({ ...state, settings: { returnSpreadFor: '2026-05-01' } }, TODAY), 'an earlier absence does not count');
  assert.equal(returnSpreadPlan(state, '2026-08-08'), null, '29 days → no');
  assert.ok(returnSpreadPlan(state, '2026-08-09'), '30 days → yes');
  assert.equal(returnSpreadPlan({ ...state, records: { ...records, '2026-09': [rec(2, '二', 'judged', 'wrong', TODAY)] } }, TODAY), null, 'written today');
  assert.equal(returnSpreadPlan({ records: {}, sched, settings: null }, TODAY), null, 'never practiced');
  assert.equal(returnSpreadPlan(state, TODAY, { ...policy, returnSpread: null }), null, 'switched off');
});
