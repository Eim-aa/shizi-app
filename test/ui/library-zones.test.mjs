// r7-L1（D60）：字库首页三档记忆状态与「今日练习」的纯函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWN_STABILITY_DAYS, MEMORY_ZONES, ZONE_TONE, memoryZoneOf, memoryZones, skippedZone, todayPlanModel, zoneSamples,
} from '../../src/ui/screens/library/model.js';
import { planDaily } from '../../src/core/session-start.js';
import { normalizeKind, listEntries, listModel } from '../../src/ui/screens/library/list-model.js';

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

test('skippedZone (D62): skipped and still no judged record; not counted in recorded; newest skip first; written later → leaves; undo (record removed) → leaves', () => {
  const skip = (n, char, day) => ({ ...rec(n, char, null, day), kind: 'skipped' });
  const rows = [
    skip(1, '甲', '2026-09-01'), skip(2, '乙', '2026-09-08'), skip(3, '甲', '2026-09-09'), // 甲 skipped twice → newest record
    skip(4, '丙', '2026-09-10'), rec(5, '丙', 'correct', '2026-09-11'), // 丙 written afterwards → not skipped any more
    rec(6, '丁', 'correct', '2026-08-01'), skip(7, '丁', '2026-09-12'), // 丁 judged before, skipped later → has a judged record → not here
    { ...rec(8, '戊', 'correct'), kind: 'answer-seen', judgment: null }, skip(9, '戊', '2026-09-13'), // answer-seen is not a judged record
  ];
  const s = stateOf(rows, {});
  const z = skippedZone(s);
  assert.deepEqual([z.kind, z.n], ['skipped', 3]);
  assert.deepEqual(z.items.map(i => i.char), ['戊', '甲', '乙'], 'newest skip first');
  assert.equal(z.items[1].record.id, 'r3', 'a char keeps its latest skip record');
  assert.ok(z.items.every(i => i.tone === 3));
  assert.equal(memoryZones(s, TODAY).recorded, 2, '丙 and 丁 only: skipped chars are not 已练汉字');
  assert.equal(zoneSamples(z).length, 3);
  assert.deepEqual(skippedZone(null), { kind: 'skipped', n: 0, items: [] });
  assert.deepEqual(listEntries(s, { kind: 'skipped', today: TODAY }).map(e => [e.char, e.count, e.day]), [['戊', 0, '2026-09-13'], ['甲', 0, '2026-09-09'], ['乙', 0, '2026-09-08']]);
  assert.equal(normalizeKind('skippedList'), 'skipped');
  const m = listModel(s, { kind: 'skipped', today: TODAY });
  assert.deepEqual([m.title, m.view, m.rows.length, m.button.label], ['已跳过', 'skippedList', 3, '练这些字']);
  assert.ok(m.rows.every(r => r.noThumb && r.thumbCaption === ''), 'no 没有笔迹 thumbnail on skipped rows');
  assert.equal(m.rows[0].meta, '9月13日跳过');
  assert.equal(listModel(stateOf([], {}), { kind: 'skipped', today: TODAY }).empty, true);
  const undone = stateOf(rows.filter(r => r.id !== 'r2'), {});
  assert.deepEqual(skippedZone(undone).items.map(i => i.char), ['戊', '甲']);
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

  // D66 ⑧：自己选的那一组（B）写到一半时，「今日练习」仍然只数今天的练习（A），不被 B 的剩余字数占用
  const picked = { ...session, id: 's2', slot: 'B', kind: 'picked', queue: ['base:东', 'base:西'], cursor: 1 };
  const both = todayPlanModel({ ...stateOf([rec(1, '永', 'correct', '2026-09-01')]), sessions: { A: session, B: picked, lastEnded: {} } }, at(TODAY), { deck: DECK });
  assert.deepEqual({ phase: both.phase, n: both.n }, { phase: 'half', n: 3 }, 'A has 3 left, B has 1: the row says 3');
  const onlyB = todayPlanModel({ ...stateOf([rec(1, '永', 'correct', '2026-09-01')]), sessions: { A: null, B: picked, lastEnded: {} } }, at(TODAY), { deck: DECK });
  assert.equal(onlyB.phase, 'fresh', 'only B in progress: today’s practice has not started');
});
