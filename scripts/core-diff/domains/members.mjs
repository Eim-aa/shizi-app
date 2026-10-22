// 结构 / 作品成员 / 取墨 / 首练结果页 / 提醒题目选取（src/core/structure.js、work-members.js、ink-pick.js、first-result.js、src/platform/reminder.js；B4.3）。
import { b43, CHARS, DAYS } from '../lib/b43-shapes.mjs';
import { deckSources } from '../../build_core_config.mjs';

let deck = null;
const pad = (n) => String(n).padStart(2, '0');

export default {
  id: 'members',
  prepare(g) {
    deck = deck || deckSources();
    const B = b43(g);
    /** 一份「部件分组 + 笔顺中线」：两块分别落在左右 / 上下 / 重叠 / 嵌套的包围盒里；偶尔坏数据。 */
    g.structureCase = () => {
      const nGroups = g.weighted([[() => 2, 12], [() => 1, 1], [() => 3, 2], [() => 4, 1], [() => 5, 1], [() => 0, 1]])();
      const groups = Array.from({ length: nGroups }, () => g.int(1, 3));
      const total = groups.reduce((s, n) => s + n, 0);
      const layout = g.pick(['lr', 'lr', 'lr', 'tb', 'tb', 'tb', 'overlap', 'nested', 'random', 'thin']);
      const box = (i) => {
        if (layout === 'lr') return i % 2 === 0 ? [0, 480, 0, 1000] : [520, 1000, 0, 1000];
        if (layout === 'tb') return i % 2 === 0 ? [0, 1000, 0, 480] : [0, 1000, 520, 1000];
        if (layout === 'overlap') return [g.int(0, 300), g.int(500, 1000), g.int(0, 300), g.int(500, 1000)];
        if (layout === 'nested') return i % 2 === 0 ? [0, 1000, 0, 1000] : [300, 700, 300, 700];
        if (layout === 'thin') return i % 2 === 0 ? [0, 600, 500, 500] : [400, 1000, 500, 500];
        const x0 = g.int(0, 800);
        const y0 = g.int(0, 800);
        return [x0, x0 + g.int(0, 400), y0, y0 + g.int(0, 400)];
      };
      const medians = [];
      groups.forEach((n, gi) => {
        const [x0, x1, y0, y1] = box(gi);
        for (let s = 0; s < n; s += 1) medians.push(Array.from({ length: g.int(1, 4) }, () => [g.int(x0, x1), g.int(y0, y1)]));
      });
      const a = { groups, medians };
      if (g.chance(0.05)) a.medians = g.pick([null, 'x', [], [5], [[null]], [[[1]]], [[[1, 'a']]], medians.slice(1)]);
      if (g.chance(0.05)) a.groups = g.pick([null, [], [0, 2], [1.5, 1], [-1, 3], 'x', [1, 1, 1, 1, 1, 1, 1, 1, 1]]);
      void total;
      return a;
    };
    g.workRecords = () => B.records(10);
    g.addedOf = (records) => records.filter((r) => r.kind === 'judged' && r.judgment === 'wrong' && g.chance(0.6)).map((r) => r.id);
    g.stateForInk = (records) => {
      const ink = {};
      for (const r of records) {
        if (!g.chance(0.5)) continue;
        const month = r.localDay.slice(0, 7);
        const id = r.inkId || r.id;
        (ink[month] || (ink[month] = {}))[id] = g.pick([{ v: 4, c: 345, r: ['AAAA'], g: [0] }, { v: 4, c: 345, r: [''], g: [0] }, { v: 3, c: 345, s: ['AAAA'] }, { v: 2, c: 345, s: [[1, 2, 3]] }, { v: 2, c: 345, s: [[]] }, { v: 4, c: 345, r: [], g: [] }, null, { v: 3, c: 345, s: [] }, { v: 3, s: '' }, { r: 'x' }, { s: [{}] }]);
      }
      return { ink };
    };
    /** 复现预告用：{chars: [{char, cardKey}], sched, today}。 */
    g.previewArgs = () => {
      const today = g.pick(DAYS);
      const chars = Array.from({ length: g.int(0, 6) }, () => g.weighted([[() => { const c = g.pick(CHARS); return { char: c, cardKey: `base:${c}` }; }, 9], [() => g.pick([null, {}, { char: 'x' }, 5]), 1]])());
      const sched = {};
      for (const c of CHARS) {
        if (!g.chance(0.6)) continue;
        const off = g.pick([-3, -1, 0, 1, 2, 3, 4, 5, 9, 30]);
        const d = new Date(Date.UTC(2026, 8, 24 + off));
        const e = { due: g.chance(0.95) ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : g.pick(['x', '2026-9-9']), fsrs: {}, lastJudgedAt: 0 };
        if (g.chance(0.1)) e.stoppedAt = 5;
        sched[`base:${c}`] = e;
      }
      return { chars, sched: g.chance(0.95) ? sched : g.pick([null, {}, []]), today: g.chance(0.97) ? '2026-09-24' : today };
    };
    const picks = deck.seed.map((r) => r.target);
    g.reminderState = () => {
      const chars = [...new Set(Array.from({ length: g.int(0, 8) }, () => g.weighted([[() => g.pick(picks), 8], [() => g.pick(CHARS), 1], [() => 'ghost', 1]])()))];
      const sched = {};
      const records = [];
      let serial = 1;
      for (const c of chars) {
        const key = `base:${c}`;
        const dueOff = g.pick([-9, -4, -1, 0, 0, 1, 1, 2, 3, 5, 8, 12]);
        const d = new Date(Date.UTC(2026, 8, 24 + dueOff));
        if (g.chance(0.9)) {
          const e = { fsrs: { stability: 1 }, due: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, lastJudgedAt: 0 };
          if (g.chance(0.1)) e.stoppedAt = 1;
          if (g.chance(0.04)) e.due = null;
          sched[key] = e;
        }
        for (let i = 0; i < g.int(0, 3); i += 1) {
          const day = g.pick(DAYS);
          records.push({ id: `r${serial++}`, cardKey: key, char: c, sessionId: 's1', kind: g.weighted([['judged', 8], ['skipped', 1], ['answer-seen', 1]]), at: 1789000000000, localDay: day, help: { hints: 0, answerSeen: false, traced: false }, judgment: g.pick(['correct', 'wrong']) });
        }
      }
      for (const r of records) if (r.kind !== 'judged') delete r.judgment;
      const months = {};
      for (const r of g.chance(0.5) ? records.reverse() : records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
      const state = { records: months, sched };
      if (g.chance(0.3)) state.wordOff = Object.fromEntries(chars.filter(() => g.chance(0.4)).map((c) => [`base:${c}`, 1]));
      if (g.chance(0.5)) state.settings = { remind: g.pick([{ enabled: true, hour: 21, minute: 5 }, { enabled: true }, { enabled: false, hour: 9, minute: 30 }, { enabled: true, hour: 25, minute: -3 }, { enabled: true, hour: 1.5 }, null]) };
      return state;
    };
  },
  ops: {
    'structure.validGroups': { weight: 1, args: (g) => { const c = g.structureCase(); return { groups: c.groups, total: g.pick([c.groups && Array.isArray(c.groups) ? c.groups.reduce((s, n) => s + (Number(n) || 0), 0) : 0, 0, 3, 5]) }; } },
    'structure.inferStructure': { weight: 5, args: (g) => g.structureCase() },
    'structure.describe': { weight: 5, args: (g) => g.structureCase() },

    'workMembers.isWorkMember': { weight: 1.5, args: (g) => { const r = g.badRecord(); return { record: r, ...(g.chance(0.7) ? { hasInk: g.hasInk([r], 0.3) } : {}), ...(g.chance(0.5) ? { added: [r.id] } : {}) }; } },
    'workMembers.isWrongMember': { weight: 0.5, args: (g) => ({ record: g.weighted([[() => g.badRecord(), 4], [() => g.pick([null, 0, 'x', {}]), 1]])() }) },
    'workMembers.records': { weight: 2, args: (g) => { const records = g.workRecords(); return { records, ...(g.chance(0.7) ? { hasInk: g.hasInk(records) } : {}), ...(g.chance(0.6) ? { added: g.addedOf(records) } : {}) }; } },
    'workMembers.members': {
      weight: 6,
      args: (g) => {
        const records = g.workRecords();
        const a = { records };
        if (g.chance(0.8)) a.hasInk = g.hasInk(records);
        if (g.chance(0.6)) a.added = g.addedOf(records);
        if (g.chance(0.6)) a.prefer = g.pick(['first', 'last', 'x', null]);
        if (g.chance(0.6)) a.order = g.pick(['first', 'last', 'x']);
        if (g.chance(0.4)) a.pickInk = g.chance(0.3) ? null : g.hasInk(records);
        return a;
      },
    },

    'inkPick.normalizePrefer': { weight: 0.3, args: (g) => ({ prefer: g.pick(['first', 'last', 'x', '', null, 5]) }) },
    'inkPick.inkHasStrokes': { weight: 1.5, args: (g) => ({ ink: g.pick([{ v: 4, r: ['AAAA'] }, { v: 4, r: [''] }, { v: 4, r: [] }, { r: [5, ''] }, { s: ['AAAA'] }, { s: [''] }, { s: [[]] }, { s: [[1]] }, { s: [null, ''] }, { s: [{}] }, { s: 'x' }, {}, null, 0, 'x', [], [1], { r: 'x', s: ['AAAA'] }]) }) },
    'inkPick.storedInkPresent': { weight: 2.5, args: (g) => { const records = g.workRecords(); const r = records.length ? g.pick(records) : g.badRecord(); return { state: g.chance(0.95) ? g.stateForInk(records) : g.pick([null, {}, { ink: null }, { ink: [] }, 5]), record: g.chance(0.9) ? r : g.pick([{ at: g.time() }, { id: 'r1' }, {}, null, 5]) }; } },
    'inkPick.pickInkRecord': { weight: 2.5, args: (g) => { const records = g.workRecords(); return { records, ...(g.chance(0.6) ? { prefer: g.pick(['first', 'last', 'x', null]) } : {}), ...(g.chance(0.9) ? { hasInk: g.hasInk(records, 0.3) } : {}) }; } },
    'inkPick.pickRecordInPeriod': { weight: 2.5, args: (g) => { const records = g.workRecords(); return { records, ...(g.chance(0.6) ? { prefer: g.pick(['first', 'last', 'x']) } : {}), ...(g.chance(0.9) ? { hasInk: g.hasInk(records, 0.3) } : {}) }; } },

    'firstResult.tierOfDue': { weight: 1.5, args: (g) => ({ due: g.pick(DAYS), today: g.pick(DAYS) }) },
    'firstResult.reviewPreview': { weight: 3, args: (g) => g.previewArgs() },
    'firstResult.previewText': { weight: 3, args: (g) => g.previewArgs() },
    'firstResult.reviewDays': { weight: 2, args: (g) => g.previewArgs() },
    'firstResult.daysLaterText': { weight: 1.5, args: (g) => ({ days: g.pick([0, 1, 2, 3, 7, 1.5, 2.5, -4, null, '5', 'x', 1e9, [], true]) }) },
    'firstResult.daysLaterLine': { weight: 3, args: (g) => g.previewArgs() },
    'firstResult.inviteOf': { weight: 1, args: (g) => ({ settings: g.weighted([[() => ({ remindInvite: g.pick([{ shown: g.pick([0, 1, 2, 3, 1.5, -1, 'x']), last: g.pick(['s1', null, 5]), answered: g.pick(['yes', 'no', 'denied', 'maybe', null]) }, {}, null]) }), 6], [() => g.pick([null, {}, 5, { remindInvite: 5 }]), 2]])() }) },
    'firstResult.inviteDecision': {
      weight: 2,
      args: (g) => ({
        settings: g.weighted([[() => ({ ...(g.chance(0.4) ? { remind: g.pick([{ enabled: true }, { enabled: false }, null]) } : {}), remindInvite: g.pick([{ shown: g.pick([0, 1, 2]), last: g.pick(['s1', 's2', null]), answered: g.pick(['yes', null, null]) }, {}]) }), 6], [() => g.pick([null, {}]), 1]])(),
        variant: g.pick(['first', 'daily', 'picked', 'x']),
        sessionId: g.pick(['s1', 's2', 's3']),
      }),
    },
    'firstResult.inviteShown': { weight: 2, args: (g) => ({ ...(g.chance(0.9) ? { settings: g.pick([null, {}, { sound: false }, { remindInvite: { shown: 1, last: 's1' } }, { remindInvite: { shown: 2, last: 's2', answered: 'no' } }, { remindInvite: { shown: 0 } }, { remind: { enabled: true }, remindInvite: { last: 's1', shown: 1, extra: 5 } }]) } : {}), sessionId: g.pick(['s1', 's2', 's3']) }) },
    'firstResult.inviteAnswer': { weight: 2, args: (g) => ({ ...(g.chance(0.9) ? { settings: g.pick([null, {}, { sound: false }, { remindInvite: { shown: 1, last: 's1' } }, { remindInvite: { shown: 2, last: 's2', answered: 'no' } }, { remindInvite: { answered: 'yes' } }]) } : {}), answer: g.pick(['yes', 'no', 'denied', 'maybe', null, 5]) }) },
    'firstResult.inviteTime': { weight: 2, args: (g) => ({ nowMs: g.chance(0.93) ? g.time() + g.pick([0, 29 * 60000, 30 * 60000, 59999, 3600000 * 3, -3600000 * 5]) : g.pick([8.64e15, 8.64e15 + 1, -8.64e15, 1e300, 0]) }) },
    'firstResult.inviteTimeText': { weight: 0.5, args: (g) => ({ hour: g.pick([9, 20, 0, 12, '7', null]), minute: g.pick([0, 5, 30, 59, '3', 100]) }) },

    'reminder.remindOf': { weight: 1, args: (g) => ({ settings: g.weighted([[() => ({ remind: g.pick([{ enabled: true, hour: 21, minute: 5, permission: 'granted' }, { hour: 9.5, permission: 'weird' }, {}, null, { enabled: 'yes' }, { hour: 25, minute: -1 }]) }), 5], [() => g.pick([null, {}, 5]), 1]])(), ...(g.chance(0.3) ? { policy: g.pick([{ remindDefault: '7:05' }, { remindDefault: '24:00' }, { remindDefault: 'x' }, { remindDefault: null }, { remindDefault: ' 8:30 ' }]) } : {}) }) },
    'reminder.normalizeTargetKey': { weight: 2, args: (g) => ({ raw: g.weighted([[() => g.pick(['base:静', 'custom:字', '静', ' 静 ', 'base:静亦', 'x:静', 'base:', '', 'base:\n', 'base:é', 'base:é', 'é', 'custom:base:x', '\u{20BB7}', 'base:\u{20BB7}', 'BASE:x']), 8], [() => g.pick([null, 5, [], {}]), 1]])() }) },
    'reminder.maskedWord': { weight: 2, args: (g) => ({ card: g.cardOf(), ...(g.chance(0.4) ? { policy: g.pick([{ reminderWord: 'word' }, { reminderBlank: '?' }, { reminderBlank: '' }, { reminderBlank: 5 }]) } : {}) }) },
    'reminder.candidates': { weight: 1.5, args: (g) => ({ state: g.reminderState(), ...(g.chance(0.05) ? { policy: { reminderPick: 'random' } } : {}) }) },
    'reminder.questions': { weight: 3, args: (g) => ({ state: g.reminderState(), today: g.chance(0.98) ? g.pick(['2026-09-24', '2026-09-24', '2026-09-30', '2026-12-28']) : g.pick(['x', '2026-9-1']), ...(g.chance(0.2) ? { count: g.pick([0, 1, 3, 8, 20]) } : {}) }) },
    'reminder.fireDayOf': { weight: 1.5, args: (g) => ({ ...(g.chance(0.9) ? { now: g.time() } : {}), ...(g.chance(0.9) ? { remind: g.pick([{ hour: 20, minute: 0 }, { hour: 3, minute: 59 }, { hour: 4, minute: 0 }, { hour: 25, minute: 70 }, { hour: 1.5, minute: 2.5 }, { hour: -3, minute: 0 }, {}, { hour: 'x' }]) } : {}), today: '2026-09-24', ...(g.chance(0.2) ? { policy: { dayStartHour: g.pick([0, 4, 6, 24, 1.5]) } } : {}) }) },
    'reminder.payload': { weight: 2, args: (g) => ({ state: g.reminderState(), today: '2026-09-24', ...(g.chance(0.7) ? { now: g.time() } : {}), ...(g.chance(0.2) ? { remind: g.pick([{ enabled: true, hour: 21, minute: 5 }, { enabled: false, hour: 7, minute: 0 }]) } : {}) }) },
    'reminder.affects': { weight: 1.5, args: (g) => ({ info: g.pick([{ type: 'load' }, { replace: true }, { type: 'commit', keys: ['shizi.v2.records.2026-09'] }, { type: 'commit', keys: ['shizi.v2.sched'] }, { type: 'recover', keys: ['shizi.v2.settings.x', 'a'] }, { type: 'commit', keys: ['shizi.v2.wordOffx'] }, { type: 'commit', keys: ['shizi.v2.sessions'] }, { type: 'commit', keys: [] }, { type: 'commit' }, { type: 'other', keys: ['shizi.v2.sched'] }, { type: 'commit', keys: [5, null, 'shizi.v2.wordOff'] }, null, {}, 5]) }) },
  },
};
