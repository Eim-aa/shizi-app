// 金标准 · 记录（src/core/records.js；B4.3）。随机差分各生成器的固定种子取样 + test/core/records.test.mjs 里的手选向量；期望值是参考引擎回包。
import { groupsFor } from '../lib/b43-golden.mjs';

const rec = (serial, char, kind, judgment, day, extra = {}) => {
  const r = { id: 'r' + serial, cardKey: 'base:' + char, char, sessionId: 's1', kind, at: 1789000000000 + serial * 1000, localDay: day, help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false }, ...extra };
  if (kind === 'judged') r.judgment = judgment;
  return r;
};
const sched = (due, stability = 5) => ({ fsrs: { stability }, due, lastJudgedAt: 0 });
const T = '2026-09-24';

function hand() {
  const R = [];
  const op = (name, args) => R.push({ op: name, args });
  for (const id of ['r12', 'r0', 's3', 'r', 'r9007199254740993', 'r' + '9'.repeat(400), 'r007']) op('records.recordSerial', { id });
  for (const id of ['s7', 's0', 'r3']) op('records.sessionSerial', { id });
  op('records.compareRecordIds', { a: 'r9', b: 'r10' });
  op('records.compareRecordIds', { a: 'x', b: 'r1' });
  for (const cardKey of ['base:静', 'custom:𠀋', 'base:静亦', 'legacy:3', 'base:\n', 'base: x']) op('records.charOfCardKey', { cardKey });
  const records = [rec(3, '静', 'judged', 'correct', T), rec(9, '亦', 'skipped', null, T)];
  op('records.nextSerial', { records });
  op('records.nextSerial', { records, metaSerial: 40 });
  op('records.nextSerial', { records, sessions: { A: { id: 's12', items: [{ recordId: 'r15' }] }, B: null, lastEnded: { B: { id: 's20', items: [] } } } });
  op('records.nextSerial', {});
  op('records.makeRecord', { id: 'r3', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'correct', at: new Date(2026, 8, 24, 23, 59).getTime(), help: { hints: 1 } });
  op('records.makeRecord', { id: 'r4', cardKey: 'base:静', sessionId: 's1', kind: 'answer-seen', at: new Date(2026, 8, 24, 3, 59).getTime() });
  for (const bad of [{ kind: 'judged' }, { kind: 'skipped', judgment: 'wrong' }, { kind: 'judged', judgment: 'maybe' }, { cardKey: 'base:静亦', kind: 'skipped' }, { id: 'x1', kind: 'skipped' }, { sessionId: 'nope', kind: 'skipped' }, { kind: 'uncertain' }]) {
    op('records.makeRecord', { id: 'r1', cardKey: 'base:静', sessionId: 's1', at: 1789000000000, ...bad });
  }
  const r = rec(1, '静', 'judged', 'correct', T);
  op('records.validateRecord', { record: r });
  op('records.validateRecord', { record: { ...r, char: '亦' } });
  op('records.validateRecord', { record: { ...r, help: { hints: 65, answerSeen: false, traced: false } } });
  op('records.validateRecord', { record: { ...r, localDay: '2026-9-24' } });
  op('records.validateRecord', { record: { ...r, kind: 'skipped', corrections: [] } });
  op('records.validateRecord', { record: null });
  // 最近一次以 id 序号为准（时钟被调回）
  const clockBack = [rec(5, '静', 'judged', 'wrong', T), rec(6, '静', 'judged', 'correct', '2026-09-23')];
  op('records.latestJudged', { records: clockBack, cardKey: 'base:静' });
  op('records.isInWrongList', { records: clockBack, cardKey: 'base:静' });
  const mixed = [rec(1, '静', 'judged', 'wrong', '2026-09-20'), rec(2, '静', 'answer-seen', null, T), rec(3, '静', 'skipped', null, T)];
  op('records.latestJudgedByCard', { records: mixed });
  op('records.wrongList', { records: mixed });
  op('records.practicedByChar', { records: [rec(1, '静', 'answer-seen', null, T), rec(2, '亦', 'judged', 'wrong', T), rec(3, '静', 'skipped', null, T), rec(4, '亦', 'answer-seen', null, T)] });
  // 更正
  const r7 = rec(7, '静', 'judged', 'correct', T, { help: { hints: 2, answerSeen: false, traced: false } });
  op('records.correctRecord', { record: r7, judgment: 'wrong', at: 111 });
  op('records.correctRecord', { record: r7, judgment: 'correct', at: 111 });
  op('records.correctRecord', { record: { ...r7, legacy: true }, judgment: 'wrong', at: 1 });
  op('records.correctRecord', { record: rec(8, '静', 'answer-seen', null, T), judgment: 'correct', at: 1 });
  // 快忘了
  const fr = [rec(1, '静', 'judged', 'correct', '2026-06-01'), rec(2, '亦', 'judged', 'correct', '2026-09-20'), rec(3, '慢', 'judged', 'wrong', '2026-06-01')];
  op('records.forgetList', { records: fr, sched: { 'base:静': sched('2026-09-10'), 'base:亦': sched('2026-10-01'), 'base:慢': sched('2026-09-01') }, today: T });
  const chars = [...'一二三四五六七八九十百千万亿'];
  const many = chars.map((ch, i) => rec(i + 1, ch, 'judged', 'correct', '2026-06-01'));
  const many2 = Object.fromEntries(chars.map((ch, i) => ['base:' + ch, sched(i < 2 ? '2026-09-01' : '2026-09-20', i === 1 ? 1 : 9)]));
  op('records.forgetList', { records: many, sched: many2, today: T });
  op('records.forgetList', { records: many, sched: many2, today: T, policy: { forgetCap: 3 } });
  op('records.forgetList', { records: many, sched: many2, today: T, policy: { forgetRule: 'retrievability' } });
  op('records.forgetList', { records: fr, sched: { 'base:静': { ...sched('2026-09-01'), stoppedAt: 1 } }, today: T });
  // 今日数、复习数、按月
  const day = [rec(1, '静', 'judged', 'wrong', T), rec(2, '静', 'judged', 'correct', T), rec(3, '亦', 'answer-seen', null, T), rec(4, '慢', 'skipped', null, T), rec(5, '额', 'judged', 'correct', '2026-09-23'), rec(6, '鲜', 'judged', 'correct', T)];
  op('records.todayCount', { records: day, today: T });
  op('records.todayCount', { records: day, today: '2026-09-23' });
  op('records.recordsByMonth', { records: [rec(4, '静', 'judged', 'correct', '2026-09-02'), rec(1, '静', 'judged', 'wrong', '2026-08-30'), rec(3, '静', 'answer-seen', null, '2026-09-01'), rec(5, '亦', 'judged', 'wrong', '2026-09-02')] });
  op('records.judgedDaysInMonth', { records: day, month: '2026-09' });
  op('records.reviewsDoneOn', { records: [rec(1, '静', 'judged', 'correct', '2026-09-20'), rec(2, '静', 'judged', 'correct', T), rec(3, '亦', 'judged', 'correct', T), rec(4, '慢', 'answer-seen', null, '2026-09-20'), rec(5, '慢', 'judged', 'wrong', T)], day: T });
  op('records.replaceRecord', { records: [rec(1, '静', 'judged', 'wrong', T)], next: { id: 'r9' } });
  op('records.removeRecord', { records: [rec(1, '静', 'judged', 'wrong', T)], id: 'r9' });
  return R;
}

export default {
  id: 'records',
  source: 'src/core/records.js',
  build({ withTZ, opCases }) {
    return { groups: groupsFor('records', { seed: 4301, perOp: 14, hand: hand(), withTZ, opCases }) };
  },
};
