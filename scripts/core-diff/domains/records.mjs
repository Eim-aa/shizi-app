// 记录域（src/core/records.js；B4.3）：随机记录列表（小字池 / 小日期池）喂最近一次 / 写错过 / 快忘了 / 更正 / 序号 / 按月索引等，
// 记录构造与校验用随机合法 / 变异值。列表里的记录保持可识别的形状（字段缺失 / 乱序可以，键类型不乱换），变异只喂 validateRecord / predicates。
import { b43, DAYS, MONTHS } from '../lib/b43-shapes.mjs';

export default {
  id: 'records',
  prepare(g) {
    const B = b43(g);
    g.recsArgs = () => {
      const records = B.records();
      return { records, cardKey: B.cardKeyOfList(records) };
    };
    g.hasInk = (records, pThrow = 0.1) => {
      const ids = records.filter(() => g.chance(0.5)).map((r) => r.id);
      const spec = { ids };
      if (g.chance(pThrow) && records.length) spec.throwIds = [g.pick(records).id];
      return spec;
    };
    g.badRecord = () => {
      const r = B.record(g.int(1, 30));
      if (g.chance(0.4)) return r;
      const m = B.S.mutate(r);
      return m !== null && typeof m === 'object' && !Array.isArray(m) ? m : r;
    };
  },
  ops: {
    'records.recordSerial': { weight: 1, args: (g) => ({ id: g.weighted([[() => `r${g.int(0, 99)}`, 3], [() => g.pick(['r0', 'r01', 'r007', 's3', 'r', 'r1x', 'R5', 'r９', 'r9007199254740993', 'r' + '9'.repeat(30), '', ' r1', 'r1\n']), 3], [() => g.pick([null, 5, true, [], {}]), 1]])() }) },
    'records.sessionSerial': { weight: 0.5, args: (g) => ({ id: g.weighted([[() => `s${g.int(0, 99)}`, 3], [() => g.pick(['s0', 's01', 'r3', 's', 'S1', 's１']), 2], [() => g.pick([null, 7]), 1]])() }) },
    'records.recordId': { weight: 0.4, args: (g) => ({ serial: g.pick([1, 2, 12, 999, 0, -1, 1.5, 2 ** 53, 1e21, 1e300]) }) },
    'records.sessionId': { weight: 0.3, args: (g) => ({ serial: g.pick([1, 7, 0, -3, 2.5, 123456789]) }) },
    'records.compareRecordIds': { weight: 1, args: (g) => ({ a: g.pick(['r9', 'r10', 'x', 'r0', 'r5', 's1', null]), b: g.pick(['r9', 'r10', 'x', 'r0', 'r5', 'r5', 5]) }) },
    'records.sortById': { weight: 1.5, args: (g) => ({ records: b43(g).records() }) },
    'records.nextSerial': {
      weight: 1.5,
      args: (g) => {
        const B = b43(g);
        const a = {};
        if (g.chance(0.8)) a.records = B.records();
        if (g.chance(0.4)) a.metaSerial = g.pick([0, 5, 40, -3, 2.5, null, 'x']);
        if (g.chance(0.6)) {
          const sess = (slot) => ({ id: `s${g.int(1, 30)}`, items: Array.from({ length: g.int(0, 3) }, () => (g.chance(0.9) ? { recordId: `r${g.int(1, 40)}` } : g.pick([null, {}, 5]))) });
          a.sessions = { A: g.chance(0.7) ? sess('A') : null, B: g.chance(0.4) ? sess('B') : null, lastEnded: g.chance(0.7) ? { A: g.chance(0.5) ? sess('A') : null, B: g.chance(0.5) ? sess('B') : null } : undefined };
          if (a.sessions.lastEnded === undefined) delete a.sessions.lastEnded;
        }
        return a;
      },
    },
    'records.charOfCardKey': { weight: 1, args: (g) => ({ cardKey: g.weighted([[() => b43(g).cardKey(), 3], [() => g.pick(['custom:𠀋', 'base:静亦', 'legacy:3', 'base:', 'base:\n', 'base: ', 'custom:é', 'base:é', 'base:😀', 'base:á', 'x', '']), 4], [() => g.pick([null, 5, []]), 1]])() }) },
    'records.validateRecord': { weight: 3, args: (g) => ({ record: g.weighted([[() => g.badRecord(), 8], [() => g.pick([null, 5, 'x', [], true]), 1]])() }) },
    'records.makeRecord': {
      weight: 3,
      args: (g) => {
        const B = b43(g);
        const ch = B.char();
        const a = { id: g.chance(0.97) ? `r${g.int(1, 99)}` : g.pick(['x1', 'r0', 5]), cardKey: g.chance(0.97) ? `base:${ch}` : g.pick(['base:静亦', 'custom:x', 'zzz', 'base:']), sessionId: g.chance(0.97) ? `s${g.int(1, 9)}` : g.pick(['nope', 's0']), kind: g.weighted([['judged', 12], ['answer-seen', 4], ['skipped', 4], ['uncertain', 1]]), at: g.chance(0.97) ? g.time() : g.pick([null, 'x', 1e300, 8.64e15, 8.64e15 + 1, -1]) };
        if (a.kind === 'judged' ? g.chance(0.95) : g.chance(0.06)) a.judgment = g.weighted([['correct', 8], ['wrong', 8], ['maybe', 1], [null, 1]]);
        if (g.chance(0.5)) a.help = g.pick([{ hints: 1 }, { hints: 100 }, { hints: -2.7 }, { hints: '3' }, { hints: 2.9, answerSeen: true }, {}, null, 5, { answerSeen: 'yes', traced: true }, { hints: 1e300 }, { hints: null }, [], { hints: 2 }, { hints: 0, traced: true }]);
        if (g.chance(0.2)) a.inkId = g.chance(0.9) ? 'r4' : g.pick([5, null]);
        if (g.chance(0.25)) a.source = g.pick(['paper', 'screen', 'screen', 'screen', 'x']);
        return a;
      },
    },
    'records.predicates': { weight: 1.5, args: (g) => ({ record: g.weighted([[() => g.badRecord(), 6], [() => g.pick([null, 0, 'x', [], { kind: 'judged' }, { source: 'paper', kind: 'judged' }]), 2]])() }) },
    'records.isAfterSeenWork': { weight: 1, args: (g) => { const r = g.badRecord(); return { record: r, ...(g.chance(0.8) ? { hasInk: g.hasInk([r], 0.3) } : {}) }; } },
    'records.isWorkOrAfterSeen': { weight: 1, args: (g) => { const r = g.badRecord(); return { record: r, ...(g.chance(0.8) ? { hasInk: g.hasInk([r], 0.3) } : {}) }; } },
    'records.withoutPaper': { weight: 1, args: (g) => ({ records: b43(g).records() }) },
    'records.foldWorkByDay': {
      weight: 1.5,
      args: (g) => {
        const B = b43(g);
        const dayMap = () => { const o = {}; for (let i = 0; i < g.int(0, 3); i += 1) o[g.pick(DAYS)] = g.chance(0.92) ? Array.from({ length: g.int(0, 3) }, () => B.char()) : g.pick([null, 'x', {}]); return o; };
        // R15：新折叠带 work / workJudged（同字可重复，order / judgedOnly 两种读法）；旧折叠按 kept 里的写错去掉（日, 字），kept 混入纸上 / 写对 / 坏记录
        const keptOf = (byDay) => {
          const out = [];
          for (const [day, chars] of Object.entries(byDay)) {
            if (!Array.isArray(chars)) continue;
            for (const c of chars) if (g.chance(0.5)) out.push({ ...B.record(g.int(1, 60), { kind: 'judged' }), localDay: day, char: c, judgment: g.pick(['wrong', 'wrong', 'correct', null]), ...(g.chance(0.15) ? { source: 'paper' } : {}) });
          }
          if (g.chance(0.1)) out.push(g.pick([null, 5, 'x', { kind: 'judged', judgment: 'wrong' }, { kind: 'judged', judgment: 'wrong', localDay: '2026-09-20', cardKey: 'base:人' }]));
          return out;
        };
        const seq = () => { const o = {}; for (let i = 0; i < g.int(0, 3); i += 1) o[g.pick(DAYS)] = g.chance(0.92) ? Array.from({ length: g.int(0, 4) }, () => B.char()) : g.pick([null, 'x', {}]); return o; };
        const fold = () => {
          const byDay = dayMap();
          const f = { folded: true, month: g.pick(MONTHS), byDay, chars: [], kept: g.chance(0.7) ? keptOf(byDay) : g.pick([[], null, 'x']), ...(g.chance(0.6) ? { paperOnly: dayMap() } : {}) };
          if (g.chance(0.5)) f.work = g.chance(0.95) ? seq() : g.pick([null, [], 'x']);
          if (g.chance(0.25)) f.workJudged = g.chance(0.95) ? seq() : g.pick([null, []]);
          return f;
        };
        return {
          fold: g.weighted([[fold, 6], [() => g.pick([null, {}, { byDay: null }, { byDay: {}, paperOnly: [] }, { byDay: { '2026-09-20': ['人'] }, paperOnly: { '2026-09-20': 'x' } }, 5]), 2]])(),
          ...(g.chance(0.5) ? { order: g.pick(['first', 'last']) } : {}),
          ...(g.chance(0.4) ? { judgedOnly: g.chance(0.5) } : {}),
        };
      },
    },
    'records.correctRecord': { weight: 2, args: (g) => ({ record: g.chance(0.7) ? b43(g).record(g.int(1, 30), { kind: 'judged' }) : g.badRecord(), judgment: g.weighted([['correct', 4], ['wrong', 4], ['maybe', 1], [null, 1]]), at: g.pick([111, 222.5, g.time(), 0]) }) },
    'records.replaceRecord': { weight: 1, args: (g) => { const records = b43(g).records(); const next = records.length && g.chance(0.8) ? { ...g.pick(records), judgment: 'wrong' } : { id: 'r999' }; return { records, next }; } },
    'records.removeRecord': { weight: 1, args: (g) => { const records = b43(g).records(); return { records, id: records.length && g.chance(0.8) ? g.pick(records).id : 'r999' }; } },
    'records.latestJudgedByCard': { weight: 3, args: (g) => ({ records: b43(g).records(12) }) },
    'records.practicedByChar': { weight: 3, args: (g) => ({ records: b43(g).records(12) }) },
    'records.latestJudged': { weight: 2, args: (g) => g.recsArgs() },
    'records.recordsOfCard': { weight: 1, args: (g) => g.recsArgs() },
    'records.judgedCountOfCard': { weight: 1, args: (g) => g.recsArgs() },
    'records.wrongCountOfCard': { weight: 1, args: (g) => g.recsArgs() },
    'records.firstJudgedOfCard': { weight: 1, args: (g) => g.recsArgs() },
    'records.writtenCardKeys': { weight: 1, args: (g) => ({ records: b43(g).records(12) }) },
    'records.hasAnyJudged': { weight: 1, args: (g) => ({ records: b43(g).records(3) }) },
    'records.wrongList': { weight: 3, args: (g) => ({ records: b43(g).records(14) }) },
    'records.isInWrongList': { weight: 1.5, args: (g) => g.recsArgs() },
    'records.forgetList': {
      weight: 4,
      args: (g) => {
        const B = b43(g);
        const records = B.records(14);
        const a = { records, sched: g.chance(0.93) ? B.schedFor(records) : g.pick([null, [], 5]), today: g.chance(0.93) ? B.day() : g.pick(['x', '2026-9-1', 5]) };
        if (g.chance(0.25)) a.policy = g.pick([{ forgetCap: 3 }, { forgetCap: 0 }, { forgetCap: 100 }, { forgetCap: null }, { forgetCap: 2.5 }, { forgetRule: 'retrievability' }, { forgetCap: -1 }]);
        return a;
      },
    },
    'records.judgedCardKeysOn': { weight: 1, args: (g) => ({ records: b43(g).records(12), day: g.pick(DAYS) }) },
    'records.answerSeenCardKeysOn': { weight: 1, args: (g) => ({ records: b43(g).records(12), day: g.pick(DAYS) }) },
    'records.skippedCardKeysOn': { weight: 1.5, args: (g) => ({ records: b43(g).records(12), day: g.pick(DAYS), ...(g.chance(0.6) ? { fromDay: g.pick(DAYS) } : {}) }) },
    'records.todayCount': { weight: 1.5, args: (g) => ({ records: b43(g).records(12), today: g.pick(DAYS) }) },
    'records.reviewsDoneOn': { weight: 2, args: (g) => ({ records: b43(g).records(14), day: g.pick(DAYS) }) },
    'records.recordsByMonth': { weight: 1.5, args: (g) => ({ records: b43(g).records(12) }) },
    'records.judgedDaysInMonth': { weight: 1, args: (g) => ({ records: b43(g).records(12), month: g.pick(MONTHS) }) },
  },
};
