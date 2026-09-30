import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRecord,
  validateRecord,
  recordSerial,
  sessionSerial,
  compareRecordIds,
  nextSerial,
  charOfCardKey,
  latestJudgedByCard,
  latestJudged,
  wrongList,
  isInWrongList,
  forgetList,
  correctRecord,
  replaceRecord,
  removeRecord,
  todayCount,
  todayInkRow,
  judgedCountOfCard,
  wrongCountOfCard,
  firstJudgedOfCard,
  recordsByMonth,
  judgedDaysInMonth,
  reviewsDoneOn,
  writtenCardKeys,
  hasAnyJudged,
} from '../../src/core/records.js';
import { at, rec, policyWith } from './helpers.mjs';

const TODAY = '2026-09-24';
const sched = (due, stability = 5) => ({ fsrs: { stability }, due, lastJudgedAt: 0 });

test('records: makeRecord builds a §3.2 record with localDay from at', () => {
  const r = makeRecord({ id: 'r3', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'correct', at: at(TODAY, 23, 59), help: { hints: 1 } });
  assert.deepEqual(r, {
    id: 'r3', cardKey: 'base:静', char: '静', sessionId: 's1', kind: 'judged', judgment: 'correct',
    at: at(TODAY, 23, 59), localDay: TODAY, help: { hints: 1, answerSeen: false, traced: false },
  });
  const seen = makeRecord({ id: 'r4', cardKey: 'base:静', sessionId: 's1', kind: 'answer-seen', at: at(TODAY) });
  assert.equal(seen.help.answerSeen, true);
  assert.equal('judgment' in seen, false);
});

test('records: makeRecord rejects malformed records', () => {
  const base = { id: 'r1', cardKey: 'base:静', sessionId: 's1', at: at(TODAY) };
  assert.throws(() => makeRecord({ ...base, kind: 'judged' }), /judgment/);
  assert.throws(() => makeRecord({ ...base, kind: 'skipped', judgment: 'wrong' }), /only judged/);
  assert.throws(() => makeRecord({ ...base, kind: 'judged', judgment: 'maybe' }), /judgment/);
  assert.throws(() => makeRecord({ ...base, cardKey: 'base:静亦', kind: 'skipped' }), /cardKey/);
  assert.throws(() => makeRecord({ ...base, id: 'x1', kind: 'skipped' }), /id/);
  assert.throws(() => makeRecord({ ...base, sessionId: 'nope', kind: 'skipped' }), /sessionId/);
  assert.throws(() => makeRecord({ ...base, kind: 'uncertain' }), /kind/);
});

test('records: validateRecord reports char/cardKey mismatch and bad help', () => {
  const r = rec(1, '静', 'judged', 'correct', TODAY);
  assert.deepEqual(validateRecord(r), []);
  assert.ok(validateRecord({ ...r, char: '亦' }).some((e) => e.includes('char')));
  assert.ok(validateRecord({ ...r, help: { hints: 3, answerSeen: false, traced: false } }).some((e) => e.includes('hints')));
  assert.ok(validateRecord({ ...r, localDay: '2026-9-24' }).some((e) => e.includes('localDay')));
  assert.ok(validateRecord({ ...r, kind: 'skipped', judgment: undefined, corrections: [] }).some((e) => e.includes('corrected')));
  assert.deepEqual(validateRecord(null), ['record must be an object']);
});

test('records: ids, serials and card keys', () => {
  assert.equal(recordSerial('r12'), 12);
  assert.ok(Number.isNaN(recordSerial('r0')));
  assert.ok(Number.isNaN(recordSerial('s3')));
  assert.equal(sessionSerial('s7'), 7);
  assert.ok(compareRecordIds('r9', 'r10') < 0, 'numeric, not lexicographic');
  assert.equal(charOfCardKey('base:静'), '静');
  assert.equal(charOfCardKey('custom:𠀋'), '𠀋');
  assert.equal(charOfCardKey('base:静亦'), null);
  assert.equal(charOfCardKey('legacy:3'), null);
});

test('records: nextSerial = max(records, sessions, meta.serial) + 1, holes allowed', () => {
  const records = [rec(3, '静', 'judged', 'correct', TODAY), rec(9, '亦', 'skipped', null, TODAY)];
  assert.equal(nextSerial({ records }), 10);
  assert.equal(nextSerial({ records, metaSerial: 40 }), 41);
  const sessions = { A: { id: 's12', items: [{ recordId: 'r15' }] }, B: null, lastEnded: { B: { id: 's20', items: [] } } };
  assert.equal(nextSerial({ records, sessions }), 21);
  assert.equal(nextSerial({ records, sessions: { A: { id: 's2', items: [{ recordId: 'r30' }] }, B: null, lastEnded: {} } }), 31);
  assert.equal(nextSerial(), 1);
});

test('records: latest judged is decided by id serial, not by clock (setClock-safe)', () => {
  const records = [
    rec(5, '静', 'judged', 'wrong', TODAY, { at: at(TODAY, 20) }),
    rec(6, '静', 'judged', 'correct', '2026-09-23', { at: at('2026-09-23', 8) }), // 时钟被调回
  ];
  assert.equal(latestJudged(records, 'base:静').id, 'r6');
  assert.equal(isInWrongList(records, 'base:静'), false);
});

test('records: answer-seen and skipped are not valid records (D23)', () => {
  const records = [
    rec(1, '静', 'judged', 'wrong', '2026-09-20'),
    rec(2, '静', 'answer-seen', null, TODAY),
    rec(3, '静', 'skipped', null, TODAY),
  ];
  assert.equal(latestJudgedByCard(records).get('base:静').id, 'r1');
  assert.deepEqual(wrongList(records).map((r) => r.char), ['静']);
  assert.equal(hasAnyJudged([rec(1, '静', 'answer-seen', null, TODAY)]), false);
  assert.deepEqual([...writtenCardKeys(records)], ['base:静']);
});

test('records: wrong list = latest judged wrong, newest first; writing it right removes it', () => {
  const records = [
    rec(1, '静', 'judged', 'wrong', '2026-09-20'),
    rec(2, '亦', 'judged', 'wrong', '2026-09-21'),
    rec(3, '慢', 'judged', 'correct', '2026-09-21'),
    rec(4, '静', 'judged', 'correct', '2026-09-22'),
    rec(5, '额', 'judged', 'wrong', '2026-09-23'),
  ];
  assert.deepEqual(wrongList(records).map((r) => r.char), ['额', '亦']);
});

test('records: correcting to correct leaves the wrong list without adding a record (I02/D19)', () => {
  const r1 = rec(1, '静', 'judged', 'wrong', TODAY);
  const before = [r1];
  assert.equal(isInWrongList(before, 'base:静'), true);
  const fixed = correctRecord(r1, 'correct', at(TODAY, 21));
  const after = replaceRecord(before, fixed);
  assert.equal(after.length, 1);
  assert.equal(isInWrongList(after, 'base:静'), false);
  assert.equal(wrongList(after).length, 0);
  assert.equal(judgedCountOfCard(after, 'base:静'), 1);
  assert.equal(wrongCountOfCard(after, 'base:静'), 0);
});

test('records: correctRecord changes only judgment and appends corrections', () => {
  const r1 = { ...rec(7, '静', 'judged', 'correct', TODAY, { hints: 2 }) };
  const c1 = correctRecord(r1, 'wrong', 111);
  assert.equal(c1.judgment, 'wrong');
  assert.deepEqual(c1.corrections, [{ from: 'correct', at: 111 }]);
  for (const k of ['id', 'at', 'localDay', 'cardKey', 'sessionId']) assert.equal(c1[k], r1[k], k);
  assert.deepEqual(c1.help, r1.help, 'help facts never removed');
  const c2 = correctRecord(c1, 'correct', 222);
  assert.deepEqual(c2.corrections, [{ from: 'correct', at: 111 }, { from: 'wrong', at: 222 }]);
  assert.equal(correctRecord(c2, 'correct', 333), c2, 'same judgment is a no-op');
  assert.deepEqual(validateRecord(c2), []);
  assert.throws(() => correctRecord(rec(8, '静', 'answer-seen', null, TODAY), 'correct', 1), /judged/);
  assert.throws(() => correctRecord({ ...r1, legacy: true }, 'wrong', 1), /legacy/);
});

test('records: forget list = latest judged correct and FSRS due (P04)', () => {
  const records = [
    rec(1, '静', 'judged', 'correct', '2026-06-01'),
    rec(2, '亦', 'judged', 'correct', '2026-09-20'),
    rec(3, '慢', 'judged', 'wrong', '2026-06-01'),
  ];
  const s = { 'base:静': sched('2026-09-10'), 'base:亦': sched('2026-10-01'), 'base:慢': sched('2026-09-01') };
  const { items, total } = forgetList({ records, sched: s, today: TODAY });
  assert.deepEqual(items.map((i) => i.record.char), ['静']);
  assert.equal(items[0].overdue, 14);
  assert.equal(total, 1);
});

test('records: wrong list and forget list never overlap (K16)', () => {
  // 伪随机序列：多字、多次判断、到期状态混合，断言两单交集为空且并集只含有 judged 的字。
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const chars = '静亦慢额鲜境警部主性体次';
  for (let round = 0; round < 50; round += 1) {
    const records = [];
    const s = {};
    let serial = 1;
    for (const ch of chars) {
      const n = Math.floor(rand() * 4);
      for (let i = 0; i < n; i += 1) {
        const kind = rand() < 0.75 ? 'judged' : rand() < 0.5 ? 'skipped' : 'answer-seen';
        records.push(rec(serial++, ch, kind, rand() < 0.5 ? 'correct' : 'wrong', addDay(-Math.floor(rand() * 90))));
      }
      if (records.some((r) => r.char === ch && r.kind === 'judged')) s['base:' + ch] = sched(addDay(Math.floor(rand() * 20) - 10));
    }
    const wrong = new Set(wrongList(records).map((r) => r.cardKey));
    const forget = forgetList({ records, sched: s, today: TODAY }).items.map((i) => i.cardKey);
    for (const k of forget) assert.equal(wrong.has(k), false, 'round ' + round + ': ' + k + ' in both lists');
  }
  function addDay(n) {
    const d = new Date(2026, 8, 24 + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
});

test('records: forget list orders by overdue desc then stability, caps at forgetCap', async () => {
  const records = [];
  const s = {};
  const chars = '一二三四五六七八九十百千万亿';
  [...chars].forEach((ch, i) => {
    records.push(rec(i + 1, ch, 'judged', 'correct', '2026-06-01'));
    s['base:' + ch] = sched(i < 2 ? '2026-09-01' : '2026-09-20', i === 1 ? 1 : 9);
  });
  const { items, total } = forgetList({ records, sched: s, today: TODAY });
  assert.equal(total, 14);
  assert.equal(items.length, 12);
  assert.deepEqual(items.slice(0, 2).map((i) => i.record.char), ['二', '一'], 'same overdue → lower stability first');
  const small = forgetList({ records, sched: s, today: TODAY, policy: await policyWith({ forgetCap: 3 }) });
  assert.equal(small.items.length, 3);
  await assert.rejects(async () => forgetList({ records, sched: s, today: TODAY, policy: await policyWith({ forgetRule: 'retrievability' }) }), /forgetRule/);
});

test('records: stopped cards never enter the forget list', () => {
  const records = [rec(1, '静', 'judged', 'correct', '2026-06-01')];
  const s = { 'base:静': { ...sched('2026-09-01'), stoppedAt: 1 } };
  assert.equal(forgetList({ records, sched: s, today: TODAY }).total, 0);
});

test('records: today N counts distinct chars judged today only', () => {
  const records = [
    rec(1, '静', 'judged', 'wrong', TODAY),
    rec(2, '静', 'judged', 'correct', TODAY),
    rec(3, '亦', 'answer-seen', null, TODAY),
    rec(4, '慢', 'skipped', null, TODAY),
    rec(5, '额', 'judged', 'correct', '2026-09-23'),
    rec(6, '鲜', 'judged', 'correct', TODAY),
  ];
  assert.equal(todayCount(records, TODAY), 2);
  assert.equal(todayCount(records, '2026-09-23'), 1);
  assert.equal(todayCount([], TODAY), 0);
});

test('records: home ink row shows N ≤ 8 items, else the latest 8 (D12), one per char', () => {
  const chars = '一二三四五六七八九';
  const records = [...chars].map((ch, i) => rec(i + 1, ch, 'judged', 'correct', TODAY));
  assert.deepEqual(todayInkRow(records.slice(0, 5), TODAY).map((r) => r.char), ['一', '二', '三', '四', '五']);
  assert.deepEqual(todayInkRow(records, TODAY).map((r) => r.char), [...'二三四五六七八九']);
  assert.equal(todayCount(records, TODAY), 9, 'number stays N');
  const again = [...records, rec(20, '一', 'judged', 'wrong', TODAY)];
  assert.deepEqual(todayInkRow(again, TODAY).map((r) => r.char), [...'三四五六七八九一'], 'rewritten char moves to its latest position');
});

test('records: counts, first record and monthly index', () => {
  const r1 = rec(1, '静', 'judged', 'wrong', '2026-08-30');
  const records = [
    rec(4, '静', 'judged', 'correct', '2026-09-02'),
    r1,
    rec(3, '静', 'answer-seen', null, '2026-09-01'),
    rec(5, '亦', 'judged', 'wrong', '2026-09-02'),
  ];
  assert.equal(judgedCountOfCard(records, 'base:静'), 2);
  assert.equal(wrongCountOfCard(records, 'base:静'), 1);
  assert.equal(firstJudgedOfCard(records, 'base:静'), r1);
  const byMonth = recordsByMonth(records);
  assert.deepEqual(Object.keys(byMonth).sort(), ['2026-08', '2026-09']);
  assert.deepEqual(byMonth['2026-09'].map((r) => r.id), ['r3', 'r4', 'r5']);
  assert.deepEqual(judgedDaysInMonth(records, '2026-09'), ['2026-09-02']);
});

test('records: replaceRecord / removeRecord keep order and reject unknown ids', () => {
  const records = [rec(1, '静', 'judged', 'wrong', TODAY), rec(2, '亦', 'skipped', null, TODAY)];
  assert.deepEqual(removeRecord(records, 'r2').map((r) => r.id), ['r1']);
  assert.throws(() => removeRecord(records, 'r9'), /not found/);
  assert.throws(() => replaceRecord(records, { id: 'r9' }), /not found/);
});

test('records: reviewsDoneOn counts only cards first judged before that day', () => {
  const records = [
    rec(1, '静', 'judged', 'correct', '2026-09-20'),
    rec(2, '静', 'judged', 'correct', TODAY),
    rec(3, '亦', 'judged', 'correct', TODAY), // 今天第一次写：新字
    rec(4, '慢', 'answer-seen', null, '2026-09-20'),
    rec(5, '慢', 'judged', 'wrong', TODAY), // 以前只看过答案：仍算新字
  ];
  assert.equal(reviewsDoneOn(records, TODAY), 1);
});
