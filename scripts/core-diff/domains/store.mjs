// store 域（B4.4；计划 §4.3 ④ 的「写失败注入 / 撞配额注入 / 备份导出导入 / 清空 / 撤销 / 时钟前进后退」）：
// 两种后端（localStorage 替身 / 原生 SQLite 替身）上的 store.commit、seed、replaceWithBackup、启动修复与 ink schema 迁移、
// 预算回收（写前估算 / 撞配额旁路）、保护副本编排、v1 迁移，以及 budget / backup / migrate 的纯函数。
// 状态（records / ink / sched / sessions …）用合法形状造（偶尔变异），让提交大多能写进去、回收与折叠真的发生；
// 磁盘布置里有 JS 写下的库（规范 JSON）、旧 ink 月键（schema 1）、坏值、残留 txn、v1 旧键。
import { encodeInk, encodeInkRaw, GRID, INK } from '../../../src/core/ink-math.js';
import { buildBackupV2, serializeBackup } from '../../../src/core/backup.js';
import { KEYS, inkKey, inkRecordKey, recordsKey } from '../../../src/core/schema.js';

const DAY = 86400000;
// 时钟：2026-10-02 10:00 上海（墨迹、折叠、400 天、4 点分界都在附近）
const T0 = 1790906400000;
const CHARS = ['人', '口', '水', '山', '大', '永', '𠮷'];
const MONTH_DAYS = { '2025-01': '2025-01-05', '2025-06': '2025-06-01', '2025-09': '2025-09-01', '2026-07': '2026-07-03', '2026-08': '2026-08-30', '2026-09': '2026-09-15', '2026-10': '2026-10-02', '2026-11': '2026-11-03' };
const MONTHS = Object.keys(MONTH_DAYS);

function rec(g, serial, month, opts = {}) {
  const ch = opts.char || g.pick(CHARS);
  const kind = opts.kind || g.weighted([['judged', 7], ['answer-seen', 2], ['skipped', 1]]);
  const day = MONTH_DAYS[month].slice(0, 8) + String(g.int(1, 28)).padStart(2, '0');
  const r = { id: `r${serial}`, cardKey: `base:${ch}`, char: ch, sessionId: `s${g.int(1, 6)}`, kind, at: T0 - g.int(0, 400) * DAY + serial, localDay: day,
    help: { hints: g.pick([0, 0, 1, 2]), answerSeen: kind === 'answer-seen', traced: g.chance(0.2) } };
  if (kind === 'judged') r.judgment = g.pick(['correct', 'wrong']);
  if (kind === 'judged' && g.chance(0.1)) r.source = 'paper';
  return r;
}

function stroke(g, n) {
  const pts = [];
  let x = g.int(20, 300);
  let y = g.int(20, 300);
  let t = g.int(0, 2000);
  for (let i = 0; i < n; i += 1) {
    pts.push({ x, y, t });
    x += g.int(-9, 9) + 0.5;
    y += g.int(-9, 9) + 0.25;
    t += g.pick([8, 16, 17, 33]);
  }
  return pts;
}

function inkValue(g) {
  return g.weighted([
    [() => encodeInk([stroke(g, g.int(2, 6)), stroke(g, g.int(2, 5))].map((s) => s.map((p) => ({ ...p, w: INK.base }))), { tolerance: null }), 5],
    [() => encodeInkRaw([stroke(g, g.int(2, 6)), stroke(g, g.int(2, 4))]), 3],
    [() => ({ v: 2, c: GRID, s: [[100, 200, 100, 103, 201, 100]] }), 1],
  ])();
}

function session(g, id, slot, items = []) {
  return {
    id, slot, kind: slot === 'A' ? 'daily' : 'picked', source: { view: 'home' }, queue: ['base:人', 'base:口', 'base:水'], cursor: Math.min(items.length, 3), items,
    current: { phase: 'recall', strokes: [], hints: 0, answerSeen: false }, lastLine: null, startedAt: T0 - DAY, startedDay: '2026-10-01', updatedAt: T0 - DAY,
  };
}

/** 一份合法的 v2 状态（小）。 */
function state(g) {
  const months = MONTHS.filter(() => g.chance(0.45));
  const records = {};
  const ink = {};
  let serial = 1;
  const all = [];
  for (const m of months.sort()) {
    const n = g.int(1, 4);
    const list = [];
    for (let i = 0; i < n; i += 1) {
      serial += 1;
      const r = rec(g, serial, m);
      list.push(r);
      all.push(r);
      if (g.chance(0.6)) (ink[m] = ink[m] || {})[r.id] = inkValue(g);
    }
    records[m] = list;
  }
  if (g.chance(0.15) && months.length) {
    const m = months[0];
    records[m] = { folded: true, month: m, byDay: { [MONTH_DAYS[m]]: ['人'] }, chars: ['人'], kept: records[m].filter(() => g.chance(0.5)) };
  }
  if (g.chance(0.1)) (ink['2026-10'] = ink['2026-10'] || {})[`r${serial + 40}`] = inkValue(g); // 孤儿墨迹
  const sched = {};
  for (const r of all) if (r.kind === 'judged' && g.chance(0.7)) sched[r.cardKey] = { fsrs: { stability: g.int(1, 30), difficulty: 5 }, due: g.pick(['2026-09-30', '2026-10-02', '2026-10-09']), lastJudgedAt: r.at };
  const items = all.filter(() => g.chance(0.2)).slice(0, 3).map((r) => ({ cardKey: r.cardKey, recordId: r.id, kind: r.kind }));
  const s = {
    meta: { schema: 2, serial: serial + g.pick([0, 0, 3]), createdAt: T0 - 500 * DAY, months: Object.keys(records).sort() },
    records,
    sched: Object.keys(sched).length || g.chance(0.5) ? sched : null,
    ink,
    custom: g.chance(0.4) ? { added: [{ char: '哈', at: T0 - DAY }] } : null,
    wordOff: g.chance(0.2) ? { 'base:人': T0 } : null,
    settings: g.chance(0.8) ? { library: g.pick(['common', 'core3500']), sound: g.chance(0.5), ...(g.chance(0.4) ? { groupSize: g.pick([5, 10, 20, 30]) } : {}) } : null,
    photos: null,
    legacy: null,
    backupMeta: g.chance(0.6) ? { lastExportAt: g.chance(0.5) ? T0 - 3 * DAY : null, lastExportSig: g.chance(0.5) ? 'x' : null } : null,
    sessions: g.chance(0.7) ? { A: g.chance(0.5) ? session(g, 's7', 'A', items) : null, B: null, lastEnded: g.chance(0.4) ? { B: { ...session(g, 's6', 'B'), endedAt: T0 - DAY } } : {} } : null,
    funnel: g.chance(0.2) ? { x: 1 } : null,
    safety: null,
  };
  if (g.chance(0.08)) s.records['2026-09'] = [{ id: 'r99', nonsense: true }]; // 形状错（seed 拒收）
  return s;
}

/** 状态 → JS 写下的磁盘（规范 JSON；可选旧 ink 月键、坏值、残留 txn、路由提示）。 */
function diskOf(g, s) {
  const out = {};
  const legacyInk = g.chance(0.3);
  for (const domain of Object.keys(s)) {
    const v = s[domain];
    if (domain === 'records') for (const m of Object.keys(v)) out[recordsKey(m)] = JSON.stringify(v[m]);
    else if (domain === 'ink') {
      for (const m of Object.keys(v)) {
        if (legacyInk && g.chance(0.7)) out[inkKey(m)] = JSON.stringify(v[m]);
        else for (const id of Object.keys(v[m])) out[inkRecordKey(m, id)] = JSON.stringify(v[m][id]);
      }
    } else if (v !== null) out[KEYS[domain]] = JSON.stringify(v);
  }
  if (g.chance(0.15)) out[g.pick([KEYS.settings, KEYS.sched, recordsKey('2026-08'), KEYS.custom])] = g.pick(['not json', '{"appearance":"neon"}', '[1]', '{']);
  if (g.chance(0.1)) out['shizi.v2.records.2026-13'] = '[]';
  if (g.chance(0.1)) out[KEYS.route] = g.pick(['{"screen":"home"}', 'bad']);
  if (g.chance(0.1)) out['shizi.corrupt.shizi.v2.sched'] = 'junk';
  if (g.chance(0.12)) {
    const keys = Object.keys(out).filter((k) => k.indexOf('shizi.v2.') === 0).slice(0, 2);
    const prev = {};
    for (const k of keys) prev[k] = g.chance(0.5) ? null : '{"old":1}';
    out[KEYS.txn] = JSON.stringify({ label: 'crash', at: T0 - 1000, keys, prev, phase: g.pick(['writing', 'writing', 'done']) });
  }
  if (g.chance(0.12)) Object.assign(out, v1Disk(g));
  return out;
}

/** 小份 v1 数据（旧 localStorage 键）。 */
function v1Disk(g) {
  const iso = (d) => new Date(T0 - d * DAY).toISOString();
  const card = (due, last) => ({ due: iso(due), stability: 3.2, difficulty: 5.1, elapsed_days: 0, scheduled_days: 3, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: iso(last) });
  const memory = {};
  const events = [];
  const chars = CHARS.filter(() => g.chance(0.6));
  chars.forEach((ch, i) => {
    memory[`base:${ch}`] = { seen: g.int(0, 3), fast: 1, last: T0 - (10 + i) * DAY, lastOutcome: g.pick(['fast', 'slow', 'miss', 'hinted']), lastHints: g.int(0, 2), traced: g.chance(0.3),
      fsrsCard: g.chance(0.85) ? card(g.int(-30, 20), 10 + i) : undefined, dueDay: g.chance(0.5) ? '2026-09-20' : null, pendingLearning: g.chance(0.3), queuedFront: g.chance(0.1) };
    if (g.chance(0.7)) {
      events.push({ eventId: `e${i}`, cardKey: g.chance(0.9) ? `base:${ch}` : `custom:3:${ch}`, reviewedAt: iso(10 + i), localDay: new Date(T0 - (10 + i) * DAY + 8 * 3600000).toISOString().slice(0, 10),
        rating: g.pick(['Good', 'Again']), reason: g.pick(['independent', 'wrong', 'dontKnow', 'hinted']), hintCount: g.int(0, 3), traced: g.chance(0.3) });
    }
  });
  if (g.chance(0.3) && chars.length) memory[`base:${chars[0]}`].recentInk = { strokes: [[{ x: 0.2, y: 0.3, w: 1 }, { x: 0.6, y: 0.31 }], [{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.9, w: 1.2 }]] };
  const out = {
    'shizi.memory.v1': JSON.stringify(memory),
    'shizi.fsrsReviewLog.v1': JSON.stringify({ version: 2, events, monthly: {} }),
  };
  if (g.chance(0.5)) out['shizi.added.v1'] = JSON.stringify(['永', 'x']);
  if (g.chance(0.5)) out['shizi.sound.v1'] = JSON.stringify({ enabled: g.chance(0.5), scene: 'rain' });
  if (g.chance(0.4)) out['shizi.library.v1'] = JSON.stringify(g.pick(['junior', 'primary', 'nope']));
  if (g.chance(0.4)) out['shizi.backupMeta.v1'] = JSON.stringify({ lastExportAt: T0 - 40 * DAY });
  if (g.chance(0.4)) out['shizi.session.v1'] = JSON.stringify({ big: 'x'.repeat(50) });
  if (g.chance(0.3)) out['shizi.safety.v1'] = '{}';
  if (g.chance(0.3)) out['shizi.corrupt.shizi.topic.v1'] = 'junk';
  if (g.chance(0.2)) out['shizi.quality.v1'] = g.pick(['{oops', JSON.stringify({ 'base:人': { badWord: 1, last: 5 } })]);
  if (g.chance(0.2)) out['shizi.wild.v1'] = JSON.stringify({ captures: { 永: { day: '2026-09-01', at: T0 - 9 * DAY, dataURL: 'data:image/jpeg;base64,' + 'A'.repeat(40) } } });
  return out;
}

function v1Backup(g) {
  const data = v1Disk(g);
  return { app: 'shizi', version: 1, date: g.chance(0.8) ? new Date(T0 - 5 * DAY).toISOString() : 'not a date', data };
}

function anyRecordRef(g, s) {
  const all = Object.values(s.records).flatMap((v) => (Array.isArray(v) ? v : v.kept));
  if (all.length && g.chance(0.85)) return g.pick(all);
  return g.pick([{ id: 'r9' }, { id: 'r3', localDay: '2026-10-02' }, { id: 'r5', inkId: 'r4', localDay: '2026-09-15' }, { id: 'x', localDay: '2026-09-15' }, { at: T0 }]);
}

/** 一次提交的 mutate（数据描述）。 */
function mutation(g) {
  const s = g.storeState || state(g);
  const kind = g.weighted([['judge', 6], ['settings', 2], ['ink', 2], ['session', 1], ['months', 1], ['bad', 1], ['big', 1], ['prune', 1], ['clear', 0.5]]);
  const m = g.pick(['2026-10', '2026-10', '2026-09', '2025-01', '2026-11']);
  switch (kind) {
    case 'judge': {
      const ch = g.pick(CHARS);
      const ops = [{ op: 'append', month: m, record: { cardKey: `base:${ch}`, char: ch, sessionId: 's7', kind: 'judged', judgment: g.pick(['correct', 'wrong']), at: T0 + g.int(0, 9), localDay: MONTH_DAYS[m], help: { hints: 0, answerSeen: false, traced: false } } }];
      if (g.chance(0.6)) ops.push({ op: 'setInk', record: '$last', ink: inkValue(g) });
      else if (g.chance(0.3)) ops.push({ op: 'judgeInk', record: '$last', strokes: [stroke(g, g.int(2, 7)), stroke(g, g.int(2, 5))] });
      if (g.chance(0.5)) ops.push({ op: 'patch', domain: 'sched', key: `base:${ch}`, value: { fsrs: { stability: 2, difficulty: 4 }, due: '2026-10-05', lastJudgedAt: T0 } });
      if (g.chance(0.4)) ops.push({ op: 'prune', cardKeys: [`base:${ch}`] });
      if (g.chance(0.3)) ops.push({ op: 'patch', domain: 'sessions', key: 'A', value: session(g, 's7', 'A', [{ cardKey: `base:${ch}`, recordId: 'r1', kind: 'judged' }]) });
      return ops;
    }
    case 'settings':
      return [{ op: 'set', domain: 'settings', value: { library: g.pick(['common', 'x'.repeat(g.pick([10, 3000, 60000]))]), sound: g.chance(0.5) } }];
    case 'ink': {
      const r = anyRecordRef(g, s);
      return g.chance(0.6) ? [{ op: 'setInk', record: r, ink: g.chance(0.85) ? inkValue(g) : null }] : [{ op: 'deleteInk', record: r }];
    }
    case 'session':
      return [{ op: 'patch', domain: 'sessions', key: g.pick(['A', 'B']), value: g.chance(0.7) ? session(g, `s${g.int(7, 9)}`, 'A') : null }, ...(g.chance(0.3) ? [{ op: 'nextId', prefix: 's' }] : [])];
    case 'months':
      return [{ op: 'month', domain: g.pick(['records', 'ink']), month: g.pick([m, '2026-9', '2026-10']), value: g.pick([[], {}, null]) }];
    case 'bad':
      return [g.pick([
        { op: 'throw', message: 'boom' },
        { op: 'set', domain: 'bogus', value: 1 },
        { op: 'set', domain: 'records', value: [] },
        { op: 'set', domain: 'ink', value: 5 },
        { op: 'nextId', prefix: 'x' },
        { op: 'month', domain: 'records', month: '2026-09', value: [{ id: 'r9', nonsense: true }] },
        { op: 'setInk', record: { id: 'r9' }, ink: inkValue(g) },
        { op: 'set', domain: 'sched', value: { 'base:人': { fsrs: null } } },
        { op: 'delete', domain: 'sessions' },
        { op: 'delete', domain: 'ink' },
      ])];
    case 'big':
      return [{ op: 'set', domain: 'funnel', value: { blob: 'y'.repeat(g.pick([2000, 20000, 200000])) } }];
    case 'prune':
      return [{ op: 'prune', cardKeys: CHARS.filter(() => g.chance(0.5)).map((c) => `base:${c}`) }];
    default:
      return [{ op: 'set', domain: 'records', value: {} }, { op: 'set', domain: 'ink', value: {} }, { op: 'endSessions' }];
  }
}

function backupObj(g) {
  const s = state(g);
  const obj = buildBackupV2(s, { now: T0 - g.int(1, 30) * DAY, serial: s.meta.serial });
  if (g.chance(0.15)) obj.data[g.pick(Object.keys(obj.data))] = '{"x":[1]}';
  if (g.chance(0.05)) obj.version = 3;
  if (g.chance(0.05)) delete obj.data[KEYS.meta];
  return obj;
}

function backupInput(g) {
  return g.weighted([
    [() => serializeBackup(backupObj(g)), 5],
    [() => backupObj(g), 1],
    [() => JSON.stringify(v1Backup(g)), 1.5],
    [() => g.pick(['not json', '{"hello":1}', '{"app": "shizi", "version": 2, "data": {', '']), 1],
  ])();
}

function rule(g) {
  const r = {};
  if (g.chance(0.6)) r.op = g.pick(['set', 'set', 'remove']);
  const k = g.weighted([['key', 3], ['prefix', 3], ['none', 2]]);
  if (k === 'key') r.key = g.pick([KEYS.sched, KEYS.sessions, KEYS.meta, KEYS.txn, KEYS.settings, KEYS.safety, recordsKey('2026-10'), inkRecordKey('2026-10', 'r9'), KEYS.backupMeta]);
  if (k === 'prefix') r.prefix = g.pick(['shizi.v2.ink.', 'shizi.v2.records.', 'shizi.corrupt.', 'shizi.v2.']);
  if (g.chance(0.5)) r.nth = g.int(1, 3);
  else if (g.chance(0.3)) r.from = g.int(1, 3);
  r.verdict = g.weighted([['quota', 4], ['generic', 3], ['security', 1], [{ corrupt: '{}' }, 2]]);
  return r;
}

export default {
  id: 'store',
  prepare(g) {
    g.storeState = null;
  },
  ops: {
    'store.open': {
      weight: 4,
      args: (g) => {
        const s = state(g);
        g.storeState = s;
        const a = { backend: g.pick(['local', 'native']), clock: T0 + g.pick([0, 0, 3600000, -86400000 * 3, 86400000 * 40]) };
        const d = g.weighted([['state', 6], ['v1', 1.5], ['empty', 2.5]]);
        if (d === 'state') a.disk = diskOf(g, s);
        if (d === 'v1') a.disk = v1Disk(g);
        if (g.chance(0.12)) a.fail = Array.from({ length: g.int(1, 2) }, () => rule(g));
        if (g.chance(0.2)) a.budgets = g.pick([{ inkBudgetBytes: 4000 }, { recordsBudgetBytes: 600 }, { quotaBytes: 30000, warnRatio: 0.5 }, { inkBudgetBytes: 0, recordsBudgetBytes: 0 }]);
        if (g.chance(0.05)) a.quota = g.int(2000, 40000);
        if (g.chance(0.05)) a.inkFormat = g.pick(['raw', 'v3']);
        return a;
      },
    },
    'store.reboot': { weight: 1.5, args: (g) => (g.chance(0.5) ? { resume: true } : {}) },
    'store.seed': {
      weight: 3,
      args: (g) => {
        const s = state(g);
        g.storeState = s;
        if (g.chance(0.05)) return { state: { nope: 1 } };
        if (g.chance(0.05)) return { state: { meta: { schema: 2, serial: 0, createdAt: T0, months: [] } } };
        return { state: s };
      },
    },
    'store.commit': {
      weight: 14,
      args: (g) => {
        const a = { label: g.pick(['judge', 'write:judge', 'settings', 'x']), ops: mutation(g) };
        if (g.chance(0.2)) a.reclaim = false;
        if (g.chance(0.1)) a.replace = true;
        return a;
      },
    },
    'store.replaceWithBackup': { weight: 1.5, args: (g) => ({ backup: backupObj(g), ...(g.chance(0.5) ? { endSessions: true } : {}) }) },
    'store.fault': {
      weight: 3,
      args: (g) => g.weighted([
        [() => ({ failNextWrite: { n: g.pick([1, 1, 2, 3]), kind: g.pick(['quota', 'generic', 'security']), ...(g.chance(0.6) ? { matchKey: g.pick([KEYS.sched, KEYS.sessions, KEYS.meta, KEYS.safety, 'shizi.v2.records.*', 'shizi.v2.ink.*', KEYS.backupMeta, KEYS.route]) } : {}) } }), 5],
        [() => ({ interruptAfterWrite: g.int(1, 8) }), 2],
        [() => ({ clearFaults: true }), 2],
      ])(),
    },
    'store.disk': {
      weight: 3,
      args: (g) => g.weighted([
        [() => ({ fail: Array.from({ length: g.int(1, 2) }, () => rule(g)) }), 4],
        [() => ({ fail: null }), 1],
        [() => ({ quotaRel: g.pick([-100, 0, 50, 500, 2000, 6000, 20000]) }), 4],
        [() => ({ quota: null }), 1],
        [() => ({ interrupt: g.int(1, 6) }), 1.5],
        [() => ({ resume: true }), 2],
        [() => ({ failReads: g.pick(['security', 'quota', null]) }), 0.5],
        [() => ({ failOp: { op: 'apply', code: g.pick(['E_TIMEOUT', 'E_TRANSPORT', 'E_FULL', 'E_IO', 'E_VERIFY']), after: g.chance(0.5), times: g.int(1, 2) } }), 1],
      ])(),
    },
    'store.ackCorruptNotice': { weight: 0.5 },
    'store.getInk': { weight: 1, args: (g) => ({ record: anyRecordRef(g, g.storeState || state(g)) }) },
    'store.refreshUsage': { weight: 0.3 },
    'store.writeRoute': { weight: 0.7, args: (g) => ({ raw: g.pick(['{"screen":"home"}', null, '{"screen":"detail","char":"人"}']) }) },
    'store.writeOne': { weight: 0.8, args: (g) => ({ key: g.pick([inkRecordKey('2026-10', 'r2'), recordsKey('2025-01'), KEYS.settings, KEYS.txn, '']), raw: g.pick(['{}', null, '[]']) }) },
    'store.writeAll': {
      weight: 0.8,
      args: (g) => ({ entries: g.pick([[[KEYS.settings, '{"sound":false}'], [KEYS.meta, '{}']], [[KEYS.sched, null]], [[KEYS.txn, '{}']], [[KEYS.probe, '1']], [], [[recordsKey('2026-10'), '[]'], [inkKey('2026-09'), '{}']]]) }),
    },
    'store.repair': { weight: 0.5 },
    'store.removeKeys': { weight: 0.5, args: (g) => ({ keys: g.pick([['shizi.corrupt.shizi.v2.sched'], [KEYS.route, 'shizi.nope'], []]) }) },
    'store.close': { weight: 0.3 },

    // ---- budget（纯函数）
    'budget.recover': {
      weight: 3,
      args: (g) => {
        const s = state(g);
        if (s.records['2026-09'] && !Array.isArray(s.records['2026-09'])) delete s.records['2026-09'];
        const a = { draft: { records: s.records, ink: s.ink, sessions: s.sessions, settings: s.settings }, now: T0 + g.pick([0, 0, 40 * DAY, -2 * DAY]) };
        if (g.chance(0.6)) a.budgets = g.pick([{ inkBudgetBytes: g.int(0, 3000) }, { recordsBudgetBytes: g.int(0, 2000) }, {}]);
        if (g.chance(0.4)) {
          a.force = true;
          a.needBytes = g.pick([100, 2000, 1e9]);
        }
        if (g.chance(0.3)) a.limit = g.pick([{ inkMonths: MONTHS.filter(() => g.chance(0.5)), months: [] }, { ink: true }, { months: ['2025-01', '2025-06'] }]);
        if (g.chance(0.2)) a.afterSeenKeepDays = g.pick([0, 1, 30, 1000]);
        return a;
      },
    },
    'budget.needsRecovery': {
      weight: 1,
      args: (g) => {
        const s = state(g);
        if (s.records['2026-09'] && !Array.isArray(s.records['2026-09'])) delete s.records['2026-09'];
        const a = { state: { records: s.records, ink: s.ink, settings: s.settings }, now: T0 + g.pick([0, 40 * DAY]) };
        if (g.chance(0.5)) a.budgets = { inkBudgetBytes: g.int(0, 3000), recordsBudgetBytes: g.int(0, 3000) };
        if (g.chance(0.5)) a.totalBytes = g.int(0, 4e6);
        return a;
      },
    },
    'budget.pruneInkOfCards': {
      weight: 1.5,
      args: (g) => {
        const s = state(g);
        if (s.records['2026-09'] && !Array.isArray(s.records['2026-09'])) delete s.records['2026-09'];
        return { draft: { records: s.records, ink: s.ink, sessions: s.sessions }, cardKeys: CHARS.filter(() => g.chance(0.5)).map((c) => `base:${c}`) };
      },
    },
    'budget.inkTiers': {
      weight: 1,
      args: (g) => {
        const s = state(g);
        if (s.records['2026-09'] && !Array.isArray(s.records['2026-09'])) delete s.records['2026-09'];
        const ids = Array.from({ length: 12 }, (_, i) => `r${i + 1}`);
        const a = { records: s.records, ids, currentMonth: g.pick(['2026-10', '2026-09']) };
        if (g.chance(0.5)) a.sessions = s.sessions;
        if (g.chance(0.5)) a.now = T0;
        if (g.chance(0.3)) a.keepDays = g.pick([0, 30]);
        return a;
      },
    },
    'budget.estimateUsage': { weight: 0.5, args: (g) => ({ pairs: Object.entries(diskOf(g, state(g))), ...(g.chance(0.5) ? { budgets: { quotaBytes: g.int(0, 40000), warnRatio: g.pick([0.5, 0.8]) } } : {}) }) },
    'budget.storagePressureOf': { weight: 0.3, args: (g) => ({ usage: g.pick([null, { level: 'ok', ratio: 0.5 }, { level: 'warn', ratio: 0.81234 }, { level: 'full', ratio: 1.0005 }, { level: 'warn', ratio: 'x' }]) }) },
    'budget.inkBudgetOf': { weight: 0.3, args: (g) => ({ settings: g.pick([null, { groupSize: 5 }, { groupSize: 30 }, { groupSize: 7 }, 'x', { groupSize: '20' }]) }) },
    'budget.entryBytes': { weight: 0.2, args: (g) => ({ key: g.pick(['ab', 'shizi.v2.meta', '字']), raw: g.pick([null, '', 'cde', '😀字']) }) },
    'budget.bucketOfKey': { weight: 0.2, args: (g) => ({ key: g.pick([KEYS.txn, KEYS.route, inkKey('2026-09'), inkRecordKey('2026-09', 'r2'), 'shizi.v2.ink', 'shizi.corrupt.x', 'shizi.memory.v1', 'other']) }) },
    'budget.deriveSerial': { weight: 0.5, args: (g) => ({ state: state(g) }) },

    // ---- backup
    'backup.recordsSignature': { weight: 0.6, args: (g) => ({ records: state(g).records }) },
    'backup.judgedChars': { weight: 0.3, args: (g) => ({ records: state(g).records }) },
    'backup.judgedDays': { weight: 0.3, args: (g) => ({ records: state(g).records }) },
    'backup.entries': { weight: 0.3, args: (g) => ({ state: state(g) }) },
    'backup.build': { weight: 0.6, args: (g) => ({ state: g.chance(0.8) ? state(g) : { records: {}, meta: null }, now: T0 - g.int(0, 9) * DAY, ...(g.chance(0.5) ? { serial: g.pick([0, 7, -1, 2.5]) } : {}) }) },
    'backup.serialize': { weight: 0.4, args: (g) => ({ obj: g.chance(0.7) ? backupObj(g) : g.value(3) }) },
    'backup.fileName': { weight: 0.2, args: (g) => ({ now: T0 + g.pick([0, 3600000 * 15, -3600000 * 7]) }) },
    'backup.failureKind': { weight: 0.1, args: (g) => ({ reason: g.pick(['json', 'format', 'tooLarge', 'invalid', 'shape', 'damaged', 'v1-unsupported']) }) },
    'backup.inspect': { weight: 2, args: (g) => ({ input: backupInput(g), ...(g.chance(0.1) ? { maxBytes: g.pick([8, 200, 1e6]) } : {}) }) },
    'backup.importLegacy': { weight: 0.5, args: (g) => ({ input: g.chance(0.8) ? JSON.stringify(v1Backup(g)) : g.pick(['{', '{"app":"shizi","version":1,"data":{}}', { app: 'shizi', version: 2, data: {} }]) }) },
    'backup.lossRange': { weight: 0.4, args: (g) => ({ records: state(g).records, day: g.pick(['2026-09-01', '2026-10-02', null, '2026-9-1', '2025-01-01']) }) },
    'backup.confirmModel': { weight: 0.3, args: (g) => ({ state: state(g), report: { day: g.pick(['2026-09-01', null]), count: g.int(0, 30) }, ...(g.chance(0.3) ? { showLoss: false } : {}) }) },
    'backup.status': {
      weight: 0.6,
      args: (g) => {
        const s = state(g);
        if (g.chance(0.4)) s.backupMeta = { lastExportAt: T0 - DAY, lastExportSig: g.pick(['x', null]), lastConclusion: g.pick([null, { kind: 'restore', date: '2026-09-01', count: 3 }, { kind: 'clear', date: null, count: 2 }]) };
        if (g.chance(0.3)) s.records = {};
        return g.chance(0.3) ? { state: s, conclusion: g.pick([null, { kind: 'restore', date: '2026-08-01', count: 2.5 }, { kind: 'clear' }]) } : { state: s };
      },
    },
    'backup.makeSafety': { weight: 0.4, args: (g) => ({ state: state(g), kind: g.pick(['restore', 'clear']), now: T0, ...(g.chance(0.5) ? { backupDate: g.pick(['2026-09-01', 5, null]) } : {}), ...(g.chance(0.5) ? { count: g.pick([3, -1, 2.5, '4']) } : {}) }) },
    'backup.endActiveSessions': { weight: 0.3, args: (g) => ({ draft: { sessions: g.pick([null, { A: null, B: null, lastEnded: {} }, { A: null, B: null, lastEnded: { A: { id: 's1' } } }, state(g).sessions, { B: null }]) } }) },
    'backup.safetyMatches': { weight: 0.2, args: (g) => ({ state: state(g) }) },
    'backup.conclusionOfSafety': { weight: 0.2, args: (g) => ({ state: { ...state(g), safety: g.pick([null, { kind: 'clear', payload: {} }, { kind: 'restore', backupDate: '2026-09-01', count: 3, payload: {} }, { kind: 'restore', payload: {} }]) } }) },
    'backup.restore': { weight: 3, args: (g) => ({ input: backupInput(g) }) },
    'backup.clearAll': { weight: 1.5 },
    'backup.undo': { weight: 2.5 },
    'backup.dropSafety': { weight: 0.6 },
    'backup.markExported': { weight: 0.8, args: (g) => ({ at: T0 + g.int(0, 9) * 1000, ...(g.chance(0.3) ? { sig: 'sig' } : {}) }) },
    'backup.export': { weight: 0.8 },

    // ---- migrate
    'migrate.readV1': { weight: 0.5, args: (g) => ({ data: g.chance(0.85) ? v1Disk(g) : g.pick([{ 'shizi.memory.v1': 5 }, { 'shizi.memory.v1': '[1]' }, 'x']), ...(g.chance(0.5) ? { strict: true } : {}) }) },
    'migrate.canonicalCardKey': { weight: 0.3, args: (g) => ({ raw: g.pick(['base:大', 'custom:12:骉', 'custom:3:', 'legacy:4', 'base:大小', 7, 'base:', 'custom:𠮷', 'base:12', 'base:1:2:3', 'custom:１2:字']) }) },
    'migrate.convertV1': {
      weight: 1.5,
      args: (g) => {
        const raw = v1Disk(g);
        const values = {};
        for (const [k, v] of Object.entries(raw)) {
          try {
            values[{ 'shizi.memory.v1': 'memory', 'shizi.fsrsReviewLog.v1': 'fsrsLog', 'shizi.added.v1': 'added', 'shizi.sound.v1': 'sound', 'shizi.library.v1': 'library', 'shizi.backupMeta.v1': 'backupMeta', 'shizi.wild.v1': 'wild', 'shizi.quality.v1': 'quality' }[k] || 'x'] = JSON.parse(v);
          } catch {
            // 坏 JSON：略过
          }
        }
        delete values.x;
        const a = { values, now: T0 + g.pick([0, 3600000 * 20]) };
        if (g.chance(0.3)) a.dueBase = T0 - 3 * DAY;
        if (g.chance(0.3)) a.source = 'backup';
        if (g.chance(0.4)) a.present = Object.keys(raw).sort();
        if (g.chance(0.3)) a.policy = g.pick([{ migration: { legacyHintedAs: 'correct', synthesizeFromMemory: true, spreadDuePerDayShare: 0.1 } }, { migration: { synthesizeFromMemory: false } }, { features: { perRecordInk: false } }, { groupSize: 4 }]);
        return a;
      },
    },
    'migrate.legacyBackupToV2': { weight: 0.5, args: (g) => ({ obj: g.chance(0.85) ? v1Backup(g) : g.pick([{ app: 'shizi', version: 1, data: {} }, { app: 'x', version: 1, data: {} }]), now: T0 }) },
    'migrate.spreadPerDayOf': { weight: 0.1, args: (g) => (g.chance(0.5) ? { policy: { groupSize: g.pick([20, 5, 2.5, 0]) } } : {}) },
    'migrate.boot': { weight: 1.5, args: (g) => ({ now: T0 + g.pick([0, 31 * DAY, 2 * DAY]), ...(g.chance(0.1) ? { policy: { migration: { importLegacy: false } } } : {}) }) },
    'migrate.release': { weight: 0.5, args: (g) => ({ now: T0 + g.pick([0, 31 * DAY]) }) },

    // ---- 原生校验和
    'native.checksum': { weight: 0.3, args: (g) => ({ raw: g.string(8) }) },
    'native.digestRows': { weight: 0.2, args: (g) => ({ rows: Object.entries(diskOf(g, state(g))).sort((a, b) => (a[0] < b[0] ? -1 : 1)) }) },
  },
};

/** 金标准（scripts/core-golden/domains/backup-roundtrip.mjs）用：同一个状态工厂。 */
export { state as storeState, T0 as STORE_T0 };
