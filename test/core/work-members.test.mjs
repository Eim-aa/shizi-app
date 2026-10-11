// 作品成员规则只有一条（D51 ⑤；N2-06）：作品 = 写对 ∪ 看后自写；写错只在手动放进来时进入且带朱点。
// 首页今天的字帖行、结果页作品与这次的图片、月字帖（含「我的」预览）、年报四个出口共用 core/work-members.js。
import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorkMember, workMemberRecords, workMembers } from '../../src/core/work-members.js';
import { buildWork } from '../../src/core/images/work.js';
import { dayMembers, imagePlan, monthCells, monthMembers } from '../../src/core/images/pick.js';
import { hasInkOfState } from '../../src/core/ink-pick.js';
import { monthSheet, dayItems, recordIndex } from '../../src/ui/screens/mine/model.js';
import { annualModel, yearSlice } from '../../src/ui/screens/mine/annual-model.js';
import { at, rec } from './helpers.mjs';

const POINTS = [[{ x: 60, y: 170, w: 11.5 }, { x: 280, y: 172, w: 11.5 }]];
const STORED = { v: 3, c: 345, s: ['AAAAAAAA'] };
const TODAY = '2026-10-05';

function stateOf(records, inked, extra = {}) {
  const months = {};
  const ink = {};
  for (const r of records) {
    const m = r.localDay.slice(0, 7);
    (months[m] || (months[m] = [])).push(r);
    if (inked.includes(r.id)) (ink[m] || (ink[m] = {}))[r.id] = STORED;
  }
  return { records: months, sessions: { A: null, B: null, lastEnded: {} }, ink, ...extra };
}

// 10-05（今天）：永 写对（有墨）、赢 写错（有墨）、和 看后自写（有墨）、春 看过答案没写、大 跳过、纸 写对在纸上
function fixture() {
  const records = [
    rec(1, '永', 'judged', 'correct', TODAY),
    rec(2, '赢', 'judged', 'wrong', TODAY),
    rec(3, '和', 'answer-seen', null, TODAY),
    rec(4, '春', 'answer-seen', null, TODAY),
    rec(5, '大', 'skipped', null, TODAY),
    { ...rec(6, '纸', 'judged', 'correct', TODAY), source: 'paper' },
  ];
  return stateOf(records, ['r1', 'r2', 'r3']);
}

test('isWorkMember: correct and after-seen-with-ink are in; wrong only when added (dot); paper / skipped / seen-without-ink are out', () => {
  const has = r => r.id === 'r3';
  const R = id => fixture().records['2026-10'].find(r => r.id === id);
  assert.equal(isWorkMember(R('r1')), true, 'correct');
  assert.equal(isWorkMember(R('r2')), false, 'wrong is out by default');
  assert.equal(isWorkMember(R('r2'), { added: new Set(['r2']) }), true, 'wrong in when added');
  assert.equal(isWorkMember(R('r2'), { added: ['r2'] }), true, 'added may be an array');
  assert.equal(isWorkMember(R('r2'), { added: new Set(['rX']) }), false);
  assert.equal(isWorkMember(R('r3'), { hasInk: has }), true, 'after-seen with ink');
  assert.equal(isWorkMember(R('r3')), false, 'after-seen needs an injected hasInk');
  assert.equal(isWorkMember(R('r4'), { hasInk: has }), false, 'seen without writing');
  assert.equal(isWorkMember(R('r5'), { hasInk: () => true }), false, 'skipped');
  assert.equal(isWorkMember(R('r6'), { added: new Set(['r6']) }), false, 'paper never');
  assert.equal(isWorkMember(null), false);
});

test('workMembers: wrong in / out, after-seen, D42 across days (record with ink, tag day = firstDay), first / last order', () => {
  const records = [
    rec(1, '永', 'judged', 'correct', '2026-10-01'),
    rec(2, '赢', 'judged', 'wrong', '2026-10-01'),
    rec(3, '和', 'answer-seen', null, '2026-10-02'),
    rec(4, '永', 'judged', 'correct', '2026-10-04'),
    rec(5, '赢', 'judged', 'correct', '2026-10-06'),
  ];
  const has = r => r.id === 'r3' || r.id === 'r4' || r.id === 'r2';
  const out = workMembers(records, { prefer: 'first', hasInk: has });
  assert.deepEqual(out.map(m => [m.char, m.record.id, m.firstDay, m.dot]),
    [['永', 'r4', '2026-10-01', false], ['和', 'r3', '2026-10-02', false], ['赢', 'r5', '2026-10-06', false]],
    '永: the first record has no ink → D42 takes the 10-04 one but the sheet position / tag stay on 10-01; 赢: the wrong r2 never counts, only the correct r5');
  const withAdded = workMembers(records, { prefer: 'first', hasInk: has, added: new Set(['r2']) });
  assert.deepEqual(withAdded.map(m => [m.char, m.record.id, m.dot]), [['永', 'r4', false], ['赢', 'r2', true], ['和', 'r3', false]],
    'added wrong r2 is a member (ink, first from the earliest) and carries the dot; order by first appearance');
  assert.deepEqual(workMembers(records, { prefer: 'last', order: 'last', hasInk: has }).map(m => m.char), ['和', '永', '赢'], 'order last = by latest appearance');
  assert.deepEqual(workMemberRecords(records, { hasInk: has }).map(r => r.id), ['r1', 'r3', 'r4', 'r5']);
});

test('exits agree: session work, month sheet, annual all drop the wrong char and keep correct ∪ after-seen (the home row is gone, D55)', () => {
  const st = fixture();
  const has = hasInkOfState(st);
  const inkOf = r => (has(r) ? POINTS : null);

  // 这次的图片（session）：buildWork 的作品格
  const sess = { id: 's1', slot: 'A', kind: 'daily', queue: ['base:永', 'base:赢', 'base:和', 'base:春', 'base:大'], cursor: 5,
    items: [['base:永', 'r1', 'judged'], ['base:赢', 'r2', 'judged'], ['base:和', 'r3', 'answer-seen'], ['base:春', 'r4', 'answer-seen'], ['base:大', 'r5', 'skipped']]
      .map(([cardKey, recordId, kind]) => ({ cardKey, recordId, kind })), endedAt: at(TODAY, 21) };
  st.sessions = { A: null, B: null, lastEnded: { A: sess } };
  const plan = imagePlan(st, { kind: 'session', sessionId: 's1' }, { inkOf, hasInk: has });
  assert.deepEqual(plan.cells.map(c => c.ch), ['永', '和']);
  assert.equal(plan.work.addable.length, 1, 'the wrong 赢 can be put in by hand');

  // 这天的图片 / 月字帖 / 「我的」月字帖预览 / 年报
  assert.deepEqual(dayMembers(st, TODAY, { hasInk: has }).members.map(m => m.char), ['永', '和']);
  assert.deepEqual(monthMembers(st, '2026-10', { hasInk: has }).members.map(m => m.char), ['永', '和']);
  assert.deepEqual(monthCells(st, '2026-10', { inkOf, hasInk: has }).cells.map(c => c.ch), ['永', '和']);
  const index = recordIndex(st);
  assert.deepEqual(monthSheet(index, '2026-10').cells.map(c => c.char), ['永', '和']);
  assert.deepEqual(dayItems(index, TODAY).map(c => c.char), ['永', '和']);
  assert.deepEqual(yearSlice(st, 2026).chars, ['永', '和']);
  assert.equal(annualModel(st, TODAY).count, 2);
});

test('buildWork stays in step with isWorkMember: a cell iff (has ink ∧ member); the dot iff a wrong member', () => {
  const kinds = [['judged', 'correct'], ['judged', 'wrong'], ['answer-seen', null], ['skipped', null]];
  for (const [kind, judgment] of kinds) {
    for (const paper of [false, true]) {
      for (const ink of [false, true]) {
        for (const added of [false, true]) {
          if (paper && kind !== 'judged') continue; // 只有 judged 记录能在纸上（core/records.js validateRecord）
          const record = { ...rec(1, '字', kind, judgment, TODAY), ...(paper ? { source: 'paper' } : {}) };
          const w = buildWork({ items: [{ cardKey: 'base:字', recordId: 'r1', kind }], records: new Map([['r1', record]]), hasInk: () => ink, added: added ? ['r1'] : [] });
          const member = isWorkMember(record, { hasInk: () => ink, added: added ? new Set(['r1']) : null });
          const label = JSON.stringify({ kind, judgment, paper, ink, added });
          assert.equal(w.cells.length === 1, ink && member, 'cell ' + label);
          assert.equal(w.cells.length === 1 && w.cells[0].dot, ink && member && judgment === 'wrong', 'dot ' + label);
        }
      }
    }
  }
});

test('folded month: wrong chars never draw wrong ink — the member rule applies to what is still kept', () => {
  const kept = [rec(1, '永', 'judged', 'correct', '2026-09-03'), rec(2, '赢', 'judged', 'wrong', '2026-09-04')];
  const st = {
    records: { '2026-09': { folded: true, byDay: { '2026-09-03': ['永'], '2026-09-04': ['赢'] }, chars: ['永', '赢'], kept } },
    sessions: { A: null, B: null, lastEnded: {} },
    ink: { '2026-09': { r1: STORED, r2: STORED } },
  };
  const has = hasInkOfState(st);
  const members = monthMembers(st, '2026-09', { hasInk: has }).members;
  assert.deepEqual(members.map(m => [m.char, m.record && m.record.id]), [['永', 'r1'], ['赢', null]],
    'the kept wrong record is never picked; 赢 (only known from byDay) falls back to the under placeholder');
  const cells = monthCells(st, '2026-09', { inkOf: r => (has(r) ? POINTS : null), hasInk: has }).cells;
  assert.deepEqual(cells.map(c => [c.ch, c.mode, c.dot]), [['永', 'hand', false], ['赢', 'under', false]]);
  const sheet = monthSheet(recordIndex(st), '2026-09');
  assert.deepEqual(sheet.cells.map(c => [c.char, c.record && c.record.id]), [['永', 'r1'], ['赢', null]]);
});
