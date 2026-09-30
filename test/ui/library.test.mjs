// 字库首页（墨墙）数据模型单测（M3-1；R-L02 / R-L03 / R-L07 / R-L08 / R-L10；03 P27 / P56 / P63 / P04）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import {
  libraryHomeModel, toneOf, wallColumns, firstRecordDay, customCharsOf, latestJudgedByChar, recordsOfState, cardMini,
  WALL_MAX_ROWS,
} from '../../src/ui/screens/library/model.js';

const TODAY = '2026-09-24';
const at = day => new Date(`${day}T08:00:00`).getTime();

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function rec(n, c, { kind = 'judged', judgment = 'correct', day = TODAY } = {}) {
  const r = { id: `r${n}`, cardKey: `base:${c}`, char: c, sessionId: 's9', kind, at: at(day) + n, localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

function state({ records = [], custom = null, sched = null, settings = null } = {}) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, custom, sched, settings, sessions: { A: null, B: null, lastEnded: {} } };
}

const CHARS = Array.from('的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可也你说年而');

test('empty: no judged record → empty state (answer-seen / skipped do not count; custom only is still empty)', () => {
  const m0 = libraryHomeModel(null, TODAY);
  assert.equal(m0.empty, true);
  assert.equal(m0.recorded, 0);
  assert.deepEqual(m0.facts, []);
  assert.deepEqual(m0.wall.cells, []);
  const m1 = libraryHomeModel(state({
    records: [rec(1, '永', { kind: 'answer-seen' }), rec(2, '和', { kind: 'skipped' })],
    custom: { added: [{ char: '馨', at: 1 }] },
  }), TODAY);
  assert.equal(m1.empty, true, 'only answer-seen / skipped / custom → still empty (prototype noRec)');
  assert.deepEqual(m1.hollow, ['馨']);
  assert.equal(m1.wall.more, 0);
});

test('big number, facts (R-L10) and since date (P63: first valid record day)', () => {
  const records = [
    rec(1, '永', { kind: 'skipped', day: '2026-08-01' }),
    rec(2, '永', { day: '2026-08-12' }),
    rec(3, '和', { day: '2026-09-01', judgment: 'wrong' }),
    rec(4, '永', { day: TODAY }),
  ];
  const m = libraryHomeModel(state({ records }), TODAY);
  assert.equal(m.recorded, 2);
  assert.equal(m.firstDay, '2026-08-12', 'skipped record does not start the record');
  assert.deepEqual(m.facts, [{ kind: 'since', day: '2026-08-12' }]);
  const withCustom = libraryHomeModel(state({ records, custom: { added: [{ char: '馨', at: 1 }, { char: '永', at: 2 }, { char: '鼎', at: 3 }] } }), TODAY);
  assert.deepEqual(withCustom.hollow, ['馨', '鼎'], 'custom chars already written are not hollow');
  assert.deepEqual(withCustom.facts, [{ kind: 'customUnwritten', n: 2 }, { kind: 'since', day: '2026-08-12' }]);
});

test('firstRecordDay includes folded months (01 §9)', () => {
  const folded = { '2025-01': { folded: true, month: '2025-01', byDay: { '2025-01-03': ['永'] }, chars: ['永'], kept: [] } };
  const st = { records: { ...folded, '2026-09': [rec(5, '和')] } };
  const { records, foldedDays } = recordsOfState(st);
  assert.equal(records.length, 1);
  assert.deepEqual(foldedDays, ['2025-01-03']);
  assert.equal(firstRecordDay(records, foldedDays), '2025-01-03');
  assert.equal(firstRecordDay([], []), null);
});

test('tone buckets follow policy.inkToneDays (P56) — boundaries inclusive', () => {
  assert.deepEqual([...policy.inkToneDays], [7, 30, 90]);
  assert.equal(toneOf(TODAY, TODAY), 0);
  assert.equal(toneOf(addDays(TODAY, -7), TODAY), 0);
  assert.equal(toneOf(addDays(TODAY, -8), TODAY), 1);
  assert.equal(toneOf(addDays(TODAY, -30), TODAY), 1);
  assert.equal(toneOf(addDays(TODAY, -31), TODAY), 2);
  assert.equal(toneOf(addDays(TODAY, -90), TODAY), 2);
  assert.equal(toneOf(addDays(TODAY, -91), TODAY), 3);
  assert.equal(toneOf('bad', TODAY), 3);
  assert.equal(toneOf(addDays(TODAY, -4), TODAY, [1, 2, 3]), 3, 'thresholds are injectable');
});

test('wall order: hollow first, then latest judged newest → oldest (by id); wrong = standard glyph kind', () => {
  const records = [
    rec(1, '甲', { day: '2026-06-01' }),
    rec(2, '乙', { day: '2026-09-01', judgment: 'wrong' }),
    rec(3, '丙', { day: '2026-09-20' }),
    rec(4, '甲', { day: TODAY, judgment: 'wrong' }),
    rec(5, '乙', { day: TODAY }), // 更正为对 / 再写对：离开写错过
  ];
  const m = libraryHomeModel(state({ records, custom: { added: [{ char: '馨', at: 1 }] } }), TODAY);
  assert.deepEqual(m.wall.cells.map(c => [c.char, c.kind, c.tone]), [
    ['馨', 'hollow', null],
    ['乙', 'ink', 0],
    ['甲', 'wrong', 0],
    ['丙', 'ink', 0],
  ]);
  assert.deepEqual(m.wrong.chars, ['甲'], 'wrong list = latest judged is wrong (K15)');
  assert.equal(m.wall.cells[1].record.id, 'r5', 'cell carries the latest judged record');
});

test('columns (5 / 8 at ≥ 60 members; compact 4 / 6) and truncation to 8 rows + more (P27 wall members)', () => {
  assert.equal(wallColumns(0), 5);
  assert.equal(wallColumns(59), 5);
  assert.equal(wallColumns(60), 8);
  assert.equal(wallColumns(59, true), 4);
  assert.equal(wallColumns(60, true), 6);
  assert.equal(policy.wallMoreScope, 'wall-members');

  const mk = n => Array.from({ length: n }, (_, i) => rec(i + 1, String.fromCodePoint(0x4E00 + i), { day: addDays(TODAY, -(n - i)) }));
  const m5 = libraryHomeModel(state({ records: mk(5) }), TODAY);
  assert.equal(m5.wall.cols, 5);
  assert.equal(m5.wall.cells.length, 5);
  assert.equal(m5.wall.more, 0);

  const m30 = libraryHomeModel(state({ records: mk(30) }), TODAY);
  assert.equal(m30.wall.cols, 5);
  assert.equal(m30.wall.cells.length, 30);
  assert.equal(m30.wall.more, 0);

  const m45 = libraryHomeModel(state({ records: mk(45) }), TODAY);
  assert.equal(m45.wall.cells.length, 5 * WALL_MAX_ROWS, '45 members, 5 cols → 40 cells');
  assert.equal(m45.wall.more, 5);
  assert.equal(m45.wall.rows, 8);

  const custom = { added: Array.from('馨鼎瓷').map((char, i) => ({ char, at: i })) };
  const m300 = libraryHomeModel(state({ records: mk(300), custom }), TODAY);
  assert.equal(m300.recorded, 300);
  assert.equal(m300.wall.members, 303);
  assert.equal(m300.wall.cols, 8);
  assert.equal(m300.wall.cells.length, 64);
  assert.equal(m300.wall.more, 303 - 64, 'denominator includes hollow (P27)');
  assert.deepEqual(m300.wall.cells.slice(0, 3).map(c => c.kind), ['hollow', 'hollow', 'hollow']);

  const recordsScope = libraryHomeModel(state({ records: mk(300), custom }), TODAY, { policy: { ...policy, wallMoreScope: 'records' } });
  assert.equal(recordsScope.wall.more, 300 - 61, "'records' scope only counts written chars");

  const compact = libraryHomeModel(state({ records: mk(300) }), TODAY, { compact: true });
  assert.equal(compact.wall.cols, 6);
  assert.equal(compact.wall.cells.length, 48);
});

test('forget card uses core forgetList (K16 / P04): latest correct + due; mutually exclusive with wrong', () => {
  const records = [rec(1, '甲', { day: '2026-05-01' }), rec(2, '乙', { day: '2026-05-02', judgment: 'wrong' }), rec(3, '丙', { day: '2026-09-20' })];
  const fsrs = { stability: 3 };
  const sched = {
    'base:甲': { fsrs, due: '2026-06-01', lastJudgedAt: 1 },
    'base:乙': { fsrs, due: '2026-06-01', lastJudgedAt: 2 },
    'base:丙': { fsrs, due: '2026-12-01', lastJudgedAt: 3 },
  };
  const m = libraryHomeModel(state({ records, sched }), TODAY);
  assert.deepEqual(m.forget.chars, ['甲']);
  assert.equal(m.forget.items[0].tone, 3, 'last written > 90 days ago → oldest tone');
  assert.deepEqual(m.wrong.chars, ['乙']);
  const mini = cardMini(m.wrong.items, 'wrong');
  assert.deepEqual(mini.map(c => [c.char, c.kind]), [['乙', 'wrong']], 'wrong card preview = standard glyph + red dot (K28)');
  assert.deepEqual(cardMini(m.forget.items, 'forget').map(c => [c.char, c.kind, c.tone]), [['甲', 'ink', 3]]);
});

test('card preview keeps at most 4', () => {
  const items = CHARS.slice(0, 6).map(char => ({ char, record: null, tone: 0 }));
  assert.equal(cardMini(items, 'forget').length, 4);
});

test('helpers: customCharsOf dedups and drops non-single chars; latestJudgedByChar uses id order', () => {
  assert.deepEqual(customCharsOf({ added: [{ char: '馨', at: 1 }, { char: '馨', at: 2 }, { char: 'ab', at: 3 }, null] }), ['馨']);
  assert.deepEqual(customCharsOf(null), []);
  const latest = latestJudgedByChar([rec(10, '永', { judgment: 'wrong' }), rec(9, '永'), rec(11, '永', { kind: 'skipped' })]);
  assert.equal(latest.get('永').id, 'r10');
});

test('300 chars model stays fast (R-L09)', () => {
  const records = [];
  let n = 0;
  for (let i = 0; i < 300; i += 1) {
    const c = String.fromCodePoint(0x4E00 + i);
    for (let k = 0; k < 3; k += 1) {
      n += 1;
      records.push(rec(n, c, { day: addDays(TODAY, -((300 - i) + k)), judgment: (i + k) % 7 === 0 ? 'wrong' : 'correct' }));
    }
  }
  records.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const st = state({ records });
  const t0 = process.hrtime.bigint();
  const m = libraryHomeModel(st, TODAY);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(m.recorded, 300);
  assert.ok(ms < 50, `model took ${ms.toFixed(1)}ms`);
});
