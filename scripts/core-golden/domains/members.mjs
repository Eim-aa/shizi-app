// 金标准 · 结构 / 作品成员 / 取墨 / 首练结果页 / 提醒题目选取（B4.3）。随机差分生成器的固定种子取样 + 手选向量。
import { groupsFor } from '../lib/b43-golden.mjs';

const rec = (serial, char, kind, judgment, day, extra = {}) => {
  const r = { id: 'r' + serial, cardKey: 'base:' + char, char, sessionId: 's1', kind, at: 1789000000000 + serial * 1000, localDay: day, help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false }, ...extra };
  if (kind === 'judged') r.judgment = judgment;
  return r;
};

function hand() {
  const R = [];
  const op = (name, args) => R.push({ op: name, args });
  // 结构：左右 / 上下 / 嵌套 / 单笔 / 坏数据（test/core/structure.test.mjs 的构形）
  const line = (x0, y0, x1, y1) => [[x0, y0], [x1, y1]];
  op('structure.describe', { groups: [2, 2], medians: [line(0, 0, 0, 900), line(100, 400, 300, 400), line(600, 0, 600, 900), line(700, 500, 900, 500)] });
  op('structure.describe', { groups: [1, 1], medians: [line(0, 800, 900, 800), line(100, 100, 800, 100)] });
  op('structure.describe', { groups: [1, 1], medians: [line(0, 0, 900, 900), line(200, 200, 700, 700)] });
  op('structure.describe', { groups: [1, 2, 1], medians: [line(0, 0, 9, 9), line(0, 0, 9, 9), line(0, 0, 9, 9), line(0, 0, 9, 9)] });
  op('structure.describe', { groups: [1, 1, 1, 1, 1], medians: [line(0, 0, 9, 9), line(0, 0, 9, 9), line(0, 0, 9, 9), line(0, 0, 9, 9), line(0, 0, 9, 9)] });
  op('structure.describe', { groups: [2], medians: [line(0, 0, 9, 9)] });
  op('structure.describe', {});
  op('structure.describe', { groups: [], medians: [] });
  op('structure.inferStructure', { groups: [1, 1], medians: [[[0, 5]], [[10, 5]]] });
  // 作品成员
  const day = '2026-09-20';
  const recs = [rec(1, '静', 'judged', 'correct', day), rec(2, '静', 'judged', 'wrong', day), rec(3, '亦', 'judged', 'wrong', day), rec(4, '亦', 'judged', 'correct', '2026-09-21', { source: 'paper' }),
    rec(5, '慢', 'answer-seen', null, day), rec(6, '额', 'skipped', null, day), rec(7, '额', 'answer-seen', null, '2026-09-22')];
  for (const extra of [{}, { hasInk: { ids: ['r5'] } }, { hasInk: { ids: ['r2', 'r5', 'r7'] }, added: ['r2', 'r3'] }, { hasInk: { ids: ['r1'], throwIds: ['r5'] }, prefer: 'first', order: 'last' }, { prefer: 'last', order: 'last', hasInk: { ids: ['r1', 'r4'] }, pickInk: null }, { hasInk: { ids: ['r2'] }, pickInk: { ids: ['r1'] } }]) {
    op('workMembers.members', { records: recs, ...extra });
    op('workMembers.records', { records: recs, ...extra });
  }
  op('inkPick.pickRecordInPeriod', { records: recs.slice(0, 3), prefer: 'first', hasInk: { ids: ['r3'] } });
  op('inkPick.pickRecordInPeriod', { records: recs.slice(0, 3), prefer: 'last', hasInk: { ids: [] } });
  op('inkPick.pickRecordInPeriod', { records: [], hasInk: { ids: [] } });
  op('inkPick.pickInkRecord', { records: recs, hasInk: { ids: ['r1', 'r2'], throwIds: ['r2'] } });
  // 首练结果页
  const T = '2026-09-24';
  const chars = ['静', '亦', '慢', '额'].map((c) => ({ char: c, cardKey: `base:${c}` }));
  const sched = { 'base:静': { due: '2026-09-25' }, 'base:亦': { due: '2026-09-26' }, 'base:慢': { due: '2026-09-28' }, 'base:额': { due: '2026-09-20' } };
  for (const sch of [sched, { 'base:静': { due: '2026-09-27' }, 'base:亦': { due: '2026-09-27' } }, { 'base:静': { due: '2026-09-25', stoppedAt: 1 } }, {}, null]) {
    for (const name of ['firstResult.reviewPreview', 'firstResult.previewText', 'firstResult.reviewDays', 'firstResult.daysLaterLine']) op(name, { chars, sched: sch, today: T });
  }
  for (const d of [0, 1, 2, 3, 10, 1.5, 2.5, -1, null, 'x']) op('firstResult.daysLaterText', { days: d });
  for (const [h, m] of [[9, 30], [9, 0]]) op('firstResult.inviteTimeText', { hour: h, minute: m });
  for (const nowMs of [new Date(2026, 8, 24, 6, 59).getTime(), new Date(2026, 8, 24, 7, 0).getTime(), new Date(2026, 8, 24, 9, 29).getTime(), new Date(2026, 8, 24, 9, 30).getTime(), new Date(2026, 8, 24, 21, 59).getTime(), new Date(2026, 8, 24, 22, 0).getTime(), new Date(2026, 8, 24, 3, 10).getTime()]) op('firstResult.inviteTime', { nowMs });
  for (const settings of [null, {}, { remind: { enabled: true } }, { remindInvite: { answered: 'no' } }, { remindInvite: { shown: 1, last: 's1' } }, { remindInvite: { shown: 2, last: 's9' } }, { remindInvite: { shown: 1 } }]) {
    for (const variant of ['first', 'daily', 'picked']) op('firstResult.inviteDecision', { settings, variant, sessionId: 's1' });
  }
  // 提醒
  op('reminder.maskedWord', { card: { chars: ['人', '人'], target: '人', word: '人人' } });
  op('reminder.maskedWord', { card: { chars: ['尴', '尬'], target: '尴' } });
  op('reminder.maskedWord', { card: { chars: ['尴', '尬'], target: '尴' }, policy: { reminderBlank: '?' } });
  op('reminder.maskedWord', { card: { chars: ['学', '习'], target: '习' }, policy: { reminderWord: 'word' } });
  for (const raw of ['base:静', 'custom:字', '静', ' 静 ', 'base:静亦', 'x:静', '', 'é', 'base:é']) op('reminder.normalizeTargetKey', { raw });
  op('reminder.remindOf', {});
  op('reminder.remindOf', { settings: { remind: { enabled: true, hour: 21, minute: 5, permission: 'granted' } } });
  op('reminder.affects', { info: { type: 'commit', keys: ['shizi.v2.sched'] } });
  op('reminder.affects', { info: { type: 'commit', keys: ['shizi.v2.sessions'] } });
  op('reminder.affects', { info: { type: 'load' } });
  return R;
}

export default {
  id: 'members',
  source: 'src/core/structure.js、work-members.js、ink-pick.js、first-result.js、src/platform/reminder.js',
  build({ withTZ, opCases }) {
    return { groups: groupsFor('members', { seed: 4304, perOp: 14, hand: hand(), withTZ, opCases }) };
  },
};
