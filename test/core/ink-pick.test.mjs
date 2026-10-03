// 时间段视图取「某一次」笔迹的共用口径（D42，解 03 P122；src/core/ink-pick.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickInkRecord, pickRecordInPeriod, storedInkPresent, hasInkOfState, inkHasStrokes, normalizePrefer,
} from '../../src/core/ink-pick.js';
import { rec } from './helpers.mjs';

const INK_ENTRY = { s: ['AAAAAAAA'] };
/** 「静」：8 月首次、9-1、9-8、9-22（D27 回收了中间两次的墨迹）。 */
const JING = [
  rec(1, '静', 'judged', 'correct', '2026-08-05'),
  rec(2, '静', 'judged', 'correct', '2026-09-01'),
  rec(3, '静', 'judged', 'correct', '2026-09-08'),
  rec(4, '静', 'judged', 'wrong', '2026-09-22'),
];
const state = { ink: { '2026-08': { r1: INK_ENTRY }, '2026-09': { r4: INK_ENTRY } } };
const inMonth = month => JING.filter(r => r.localDay.startsWith(month + '-'));

test('pickInkRecord: preference direction — first scans early to late, last scans late to early; skips records without ink', () => {
  const has = new Set(['r2', 'r3']);
  const hasInk = r => has.has(r.id);
  assert.equal(pickInkRecord(JING, { prefer: 'first', hasInk }).id, 'r2');
  assert.equal(pickInkRecord(JING, { prefer: 'last', hasInk }).id, 'r3', 'last: r4 has none, so r3');
  assert.equal(pickInkRecord(JING, { hasInk }).id, 'r3', 'default prefer = last');
  assert.equal(normalizePrefer('whatever'), 'last');
  // 偏好方向上的那条有墨就直接取它
  assert.equal(pickInkRecord(JING, { prefer: 'first', hasInk: () => true }).id, 'r1');
  assert.equal(pickInkRecord(JING, { prefer: 'last', hasInk: () => true }).id, 'r4');
});

test('pickInkRecord: nothing with ink in the period gives null; empty / bad input gives null; a throwing hasInk counts as no ink', () => {
  assert.equal(pickInkRecord(JING, { prefer: 'first', hasInk: () => false }), null);
  assert.equal(pickInkRecord([], { hasInk: () => true }), null);
  assert.equal(pickInkRecord(null, { hasInk: () => true }), null);
  assert.equal(pickInkRecord(JING, {}), null, 'no hasInk: nothing can be said to have ink');
  const bomb = r => {
    if (r.id === 'r4') throw new Error('boom');
    return r.id === 'r3';
  };
  assert.equal(pickInkRecord(JING, { prefer: 'last', hasInk: bomb }).id, 'r3');
});

test('pickRecordInPeriod: no ink anywhere in the period gives the preferred-direction record with inked=false (shown honestly as no ink)', () => {
  assert.deepEqual(pickRecordInPeriod(JING, { prefer: 'first', hasInk: () => false }), { record: JING[0], inked: false });
  assert.deepEqual(pickRecordInPeriod(JING, { prefer: 'last', hasInk: () => false }), { record: JING[3], inked: false });
  assert.deepEqual(pickRecordInPeriod(JING, { prefer: 'first', hasInk: r => r.id === 'r3' }), { record: JING[2], inked: true });
  assert.deepEqual(pickRecordInPeriod([], { prefer: 'first', hasInk: () => true }), { record: null, inked: false });
});

test('D42 example: jing, September (first) = 9-22; August = its own August one; ink outside the period never stands in', () => {
  const hasInk = hasInkOfState(state);
  assert.equal(pickRecordInPeriod(inMonth('2026-09'), { prefer: 'first', hasInk }).record.id, 'r4', '9-01 recycled, so 9-22');
  assert.equal(pickRecordInPeriod(inMonth('2026-08'), { prefer: 'first', hasInk }).record.id, 'r1');
  // 9 月里一份墨迹都没有（只剩 8 月那份）：如实没有，不拿 8 月的冒充
  const aug = { ink: { '2026-08': { r1: INK_ENTRY } } };
  assert.deepEqual(pickRecordInPeriod(inMonth('2026-09'), { prefer: 'first', hasInk: hasInkOfState(aug) }), { record: JING[1], inked: false });
  assert.equal(pickInkRecord(inMonth('2026-09'), { prefer: 'first', hasInk: hasInkOfState(aug) }), null);
});

test('storedInkPresent: looks the record up in the per-month table (inkId first), never decodes; empty strokes or missing table give false', () => {
  assert.equal(storedInkPresent(state, JING[0]), true);
  assert.equal(storedInkPresent(state, JING[1]), false);
  assert.equal(storedInkPresent(state, { ...JING[1], inkId: 'r4', localDay: '2026-09-22' }), true, 'inkId wins over id');
  assert.equal(storedInkPresent({ ink: { '2026-09': { r4: { s: [] } } } }, JING[3]), false, 'no strokes');
  assert.equal(storedInkPresent({ ink: { '2026-09': { r4: { s: [''] } } } }, JING[3]), false, 'only empty strokes');
  assert.equal(storedInkPresent({ ink: { '2026-09': { r4: null } } }, JING[3]), false);
  assert.equal(storedInkPresent({}, JING[3]), false);
  assert.equal(storedInkPresent(null, JING[3]), false);
  assert.equal(storedInkPresent(state, null), false);
  assert.equal(inkHasStrokes({ s: [[1, 2, 3]] }), true);
});

test('performance: 3000 chars x 4 records pick with one table lookup per candidate and no decoding', () => {
  const records = [];
  const ink = {};
  for (let i = 0; i < 3000; i += 1) {
    for (let k = 0; k < 4; k += 1) records.push(rec(i * 4 + k + 1, '字' + i, 'judged', 'correct', '2026-09-0' + (k + 1)));
    ink['r' + (i * 4 + 4)] = INK_ENTRY; // 每字只有最近一次留有墨迹
  }
  const st = { ink: { '2026-09': ink } };
  const byChar = new Map();
  for (const r of records) {
    if (!byChar.has(r.char)) byChar.set(r.char, []);
    byChar.get(r.char).push(r);
  }
  const t0 = Date.now();
  let hit = 0;
  for (const list of byChar.values()) if (pickRecordInPeriod(list, { prefer: 'first', hasInk: hasInkOfState(st) }).inked) hit += 1;
  assert.equal(hit, 3000);
  assert.ok(Date.now() - t0 < 1000, 'cheap');
});
