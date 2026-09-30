// 首页数据模型单测（M2-1；01 §2 records × resume；决定-D12；03 P16 / P23 / P46；R-H02 / R-H04）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import {
  homeModel, recordsStateOf, resumeOf, resumeKeyOf, epigraphColumnHeight, INK_ROW_MAX, INK_ROW_COMPACT_MAX,
} from '../../src/ui/screens/home/today.js';
import { EPIGRAPHS } from '../../src/config/epigraphs.js';

const DAY = '2026-09-24';
const YDAY = '2026-09-23';
const at = (day, h = 9) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime();

function rec(n, c, { kind = 'judged', judgment = 'correct', day = DAY } = {}) {
  const r = { id: `r${n}`, cardKey: `base:${c}`, char: c, sessionId: 's9', kind, at: at(day, 8) + n, localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

function sess(slot, kind, n, cursor, day = DAY) {
  return { id: `s${slot}`, slot, kind, source: { view: 'home' }, queue: Array.from({ length: n }, (_, i) => `base:${'一二三四五六七八'[i]}`),
    cursor, items: [], current: { phase: 'recall', strokes: [] }, lastLine: null, startedAt: at(day, 7), startedDay: day, updatedAt: at(day, 7) };
}

function state({ records = [], A = null, B = null, backupMeta = null } = {}) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, sessions: { A, B, lastEnded: {} }, backupMeta };
}

test('records dimension: first / empty / record (K06: cleared → empty, not first)', () => {
  assert.equal(recordsStateOf(state(), DAY), 'first');
  assert.equal(recordsStateOf(state({ records: [rec(1, '永', { day: YDAY })] }), DAY), 'empty');
  assert.equal(recordsStateOf(state({ records: [rec(1, '永', { kind: 'answer-seen' })] }), DAY), 'first', 'answer-seen is not a record');
  assert.equal(recordsStateOf(state({ records: [rec(1, '永')] }), DAY), 'record');
  const cleared = state({ backupMeta: { lastExportAt: null, lastExportSig: null, lastConclusion: { kind: 'clear', date: YDAY, count: 3 } } });
  assert.equal(recordsStateOf(cleared, DAY), 'empty');
  assert.equal(recordsStateOf(null, DAY), 'first', 'store not booted');
});

test('resume dimension: none / A / B / A+B; B is the primary line, A the other (D05 / S01)', () => {
  const now = at(DAY);
  assert.deepEqual(resumeOf(state(), now), { resume: 'none', primary: null, other: null });
  assert.deepEqual(resumeOf(state({ A: sess('A', 'daily', 5, 2) }), now),
    { resume: 'A', primary: { slot: 'A', kind: 'daily', remaining: 3 }, other: null });
  assert.deepEqual(resumeOf(state({ B: sess('B', 'picked', 2, 0) }), now),
    { resume: 'B', primary: { slot: 'B', kind: 'picked', remaining: 2 }, other: null });
  assert.deepEqual(resumeOf(state({ A: sess('A', 'first', 5, 1), B: sess('B', 'picked', 2, 1) }), now),
    { resume: 'A+B', primary: { slot: 'B', kind: 'picked', remaining: 1 }, other: { slot: 'A', kind: 'first', remaining: 4 } });
  assert.equal(resumeOf(state({ A: sess('A', 'daily', 5, 5) }), now).resume, 'none', 'written-out group is not resumable');
  assert.equal(resumeOf(state({ A: sess('A', 'daily', 5, 2, YDAY) }), now).resume, 'none', 'yesterday’s daily expires (P37)');
  assert.equal(resumeOf(state({ B: sess('B', 'picked', 2, 0, YDAY) }), now).resume, 'B', 'picked never expires (P61)');
});

test('N and ink row: judged today deduped by char, latest 8 by id (D12)', () => {
  const chars = '一二三四五六七八九';
  const records = [...chars].map((c, i) => rec(i + 1, c));
  records.push(rec(10, '一', { judgment: 'wrong' }), rec(11, '十', { day: YDAY }), rec(12, '二', { kind: 'skipped' }));
  const m = homeModel(state({ records }), at(DAY));
  assert.equal(m.count, 9);
  assert.deepEqual(m.inkRow.map(r => r.char), [...'三四五六七八九一']);
  assert.equal(m.inkRow.length, INK_ROW_MAX);
  const c = homeModel(state({ records }), at(DAY), { inkRowMax: INK_ROW_COMPACT_MAX });
  assert.deepEqual(c.inkRow.map(r => r.char), [...'七八九一']);
  assert.equal(c.count, 9, 'number stays N');
});

test('P16: N row shown together with an unfinished group; false hides it', () => {
  const s = state({ records: [rec(1, '永')], A: sess('A', 'daily', 5, 1) });
  const shown = homeModel(s, at(DAY));
  assert.equal(shown.showRecord, true);
  assert.equal(shown.inkRow.length, 1);
  const hidden = homeModel(s, at(DAY), { policy: { ...policy, homeShowRecordWhileResume: false } });
  assert.equal(hidden.showRecord, false);
  assert.deepEqual(hidden.inkRow, []);
  assert.equal(hidden.count, 1, 'count is still computed');
});

test('first-visit tip only when first and no group; period / date / epigraph from the clock', () => {
  assert.equal(homeModel(state(), at(DAY)).showFirstTip, true);
  assert.equal(homeModel(state({ A: sess('A', 'first', 5, 0) }), at(DAY)).showFirstTip, false);
  const m = homeModel(state(), at(DAY, 16));
  assert.equal(m.period, 'dusk');
  assert.deepEqual(m.dateParts, { month: 9, day: 24 });
  assert.equal(m.epigraph, EPIGRAPHS[0], '2026-09-24 = day 267 → 267 % 3 = 0');
  assert.equal(homeModel(state(), at('2026-09-25', 4)).period, 'night');
  assert.equal(homeModel(state(), at('2026-09-25', 4)).epigraph, EPIGRAPHS[1]);
});

test('R-H04 keys and epigraph column heights', () => {
  assert.equal(resumeKeyOf('picked'), 'R-H04.resumePicked');
  assert.equal(resumeKeyOf('first'), 'R-H04.resumeFirst');
  assert.equal(resumeKeyOf('daily'), 'R-H04.resumeDaily');
  assert.deepEqual(EPIGRAPHS.map(epigraphColumnHeight), [96, 114, 150]);
});
