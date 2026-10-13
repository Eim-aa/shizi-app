// r7-L1（D60）：字库首页三档记忆状态与「今天要写」的纯函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWN_STABILITY_DAYS, MEMORY_ZONES, ZONE_TONE, memoryZoneOf, memoryZones, todayPlanModel, zoneSamples,
} from '../../src/ui/screens/library/model.js';
import { planDaily } from '../../src/core/session-start.js';
import { normalizeKind, listEntries } from '../../src/ui/screens/library/list-model.js';

const TODAY = '2026-09-24';
const at = day => new Date(`${day}T09:00:00`).getTime();
const rec = (n, char, judgment, day = '2026-09-10') => ({
  id: `r${n}`, cardKey: `base:${char}`, char, sessionId: 's9', kind: 'judged', judgment, at: at(day), localDay: day, help: { hints: 0, answerSeen: false, traced: false },
});
const sched = (due, stability) => ({ fsrs: { stability }, due, lastJudgedAt: 0 });

function stateOf(rows, schedMap = {}, extra = {}) {
  const records = {};
  for (const r of rows) (records[r.localDay.slice(0, 7)] || (records[r.localDay.slice(0, 7)] = [])).push(r);
  return { records, sched: schedMap, sessions: { A: null, B: null, lastEnded: {} }, settings: {}, custom: { added: [] }, ...extra };
}

test('memoryZoneOf: wrong or due today → due; not due and stability < 21 → shaky; ≥ 21 → known (boundary inclusive)', () => {
  assert.equal(KNOWN_STABILITY_DAYS, 21);
  assert.equal(memoryZoneOf(rec(1, '永', 'wrong'), sched('2026-10-30', 90), TODAY), 'due', 'latest wrong wins over a far due date');
  assert.equal(memoryZoneOf(rec(1, '永', 'correct'), sched(TODAY, 90), TODAY), 'due', 'due today');
  assert.equal(memoryZoneOf(rec(1, '永', 'correct'), sched('2026-09-01', 90), TODAY), 'due', 'overdue');
  assert.equal(memoryZoneOf(rec(1, '永', 'correct'), sched('2026-09-25', 20.99), TODAY), 'shaky');
  assert.equal(memoryZoneOf(rec(1, '永', 'correct'), sched('2026-09-25', 21), TODAY), 'known');
  assert.equal(memoryZoneOf(rec(1, '永', 'correct'), undefined, TODAY), 'shaky', 'no sched entry counts as stability 0');
  assert.equal(memoryZoneOf(rec(1, '永', 'correct'), { ...sched('2026-09-01', 30), stoppedAt: '2026-09-02' }, TODAY), 'known', 'a stopped card is never due');
});

test('memoryZones: exclusive, sum = recorded, answer-seen / skipped do not count, latest judged decides', () => {
  const rows = [
    rec(1, '永', 'wrong', '2026-09-01'), rec(2, '永', 'correct', '2026-09-05'), // latest correct → not wrong any more
    rec(3, '和', 'wrong'), rec(4, '春', 'correct'), rec(5, '大', 'correct'),
    { ...rec(6, '山', 'correct'), kind: 'answer-seen', judgment: null },
  ];
  const s = stateOf(rows, { 'base:永': sched('2026-12-01', 40), 'base:春': sched('2026-09-20', 5), 'base:大': sched('2026-10-30', 25) });
  const m = memoryZones(s, TODAY);
  assert.equal(m.recorded, 4);
  const sets = Object.fromEntries(MEMORY_ZONES.map(k => [k, m.zones[k].items.map(i => i.char).sort().join('')]));
  assert.deepEqual(sets, { due: '和春', shaky: '', known: '大永' });
  assert.equal(MEMORY_ZONES.reduce((n, k) => n + m.zones[k].n, 0), m.recorded);
  assert.deepEqual(memoryZones(null, TODAY).zones.due, { kind: 'due', n: 0, items: [] }, 'no state → empty zones');
});

test('memoryZones order: due = latest wrong first (newest first) then by due date; samples ≤ 3 with the zone ink tone', () => {
  const rows = [rec(1, '甲', 'wrong', '2026-09-01'), rec(2, '乙', 'wrong', '2026-09-08'), rec(3, '丙', 'correct'), rec(4, '丁', 'correct'), rec(5, '戊', 'correct')];
  const s = stateOf(rows, { 'base:丙': sched('2026-09-20', 3), 'base:丁': sched('2026-09-10', 3), 'base:戊': sched('2026-09-23', 3) });
  const due = memoryZones(s, TODAY).zones.due;
  assert.deepEqual(due.items.map(i => i.char), ['乙', '甲', '丁', '丙', '戊']);
  const samples = zoneSamples(due);
  assert.equal(samples.length, 3);
  assert.ok(samples.every(c => c.kind === 'ink' && c.tone === ZONE_TONE.due));
  assert.deepEqual(ZONE_TONE, { due: 3, shaky: 1, known: 0 }, 'wall4 / wall2 / wall1');
});

test('zone list entries follow the same zones (library-list kind = due | shaky | known)', () => {
  const rows = [rec(1, '永', 'correct'), rec(2, '和', 'correct')];
  const s = stateOf(rows, { 'base:永': sched('2026-09-30', 30), 'base:和': sched('2026-09-30', 3) });
  assert.deepEqual(listEntries(s, { kind: 'known', today: TODAY }).map(e => e.char), ['永']);
  assert.deepEqual(listEntries(s, { kind: 'shaky', today: TODAY }).map(e => e.char), ['和']);
  assert.deepEqual(listEntries(s, { kind: 'due', today: TODAY }), []);
  assert.equal(normalizeKind('dueList'), 'due');
});

const DECK = { newCandidates: () => ['base:新', 'base:字', 'base:词', 'base:句', 'base:文'], practicable: key => key.startsWith('base:'), currentLibraryId: () => 'core3500' };

test('todayPlanModel: fresh → the queue the home button would start, split into review / new', () => {
  const s = stateOf([rec(1, '永', 'correct', '2026-09-01')], { 'base:永': sched('2026-09-20', 3) });
  const p = todayPlanModel(s, at(TODAY), { deck: DECK });
  assert.equal(p.phase, 'fresh');
  assert.equal(p.n, p.review + p.fresh);
  const plan = planDaily(s, { today: TODAY, deck: DECK });
  assert.equal(p.n, plan.queue.length, 'same queue as core planDaily (what home startA opens)');
  assert.equal(p.review, plan.queue.filter(k => s.sched[k]).length);
});

test('todayPlanModel: first visit = the fixed first group (all new); half = home remaining; done = written today', () => {
  const first = todayPlanModel({ records: {}, sched: {}, sessions: { A: null, B: null, lastEnded: {} }, settings: {} }, at(TODAY), { deck: DECK });
  assert.equal(first.phase, 'fresh');
  assert.equal(first.review, 0);
  assert.equal(first.fresh, first.n);
  assert.ok(first.n > 0);

  const written = stateOf([rec(1, '永', 'correct', TODAY)], { 'base:永': sched('2026-09-27', 3) });
  assert.equal(todayPlanModel(written, at(TODAY), { deck: DECK }).phase, 'done');

  const session = {
    id: 's1', slot: 'A', kind: 'daily', source: { view: 'home' }, queue: ['base:山', 'base:水', 'base:火', 'base:木', 'base:金'], cursor: 2, items: [],
    current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false, hintRange: null, referenceReady: false }, lastLine: null,
    startedAt: at(TODAY), startedDay: TODAY, updatedAt: at(TODAY),
  };
  const half = todayPlanModel({ ...stateOf([rec(1, '永', 'correct', '2026-09-01')]), sessions: { A: session, B: null, lastEnded: {} } }, at(TODAY), { deck: DECK });
  assert.deepEqual({ phase: half.phase, n: half.n, remaining: half.remaining }, { phase: 'half', n: 3, remaining: 3 });
});
