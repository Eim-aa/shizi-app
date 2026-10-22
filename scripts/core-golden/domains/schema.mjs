// 金标准 · 形状表（src/core/schema.js；计划 §4.3 ① 「schema 校验正反例」）。
// 正例：test/store 的基线状态每个键、各域随机合法值（种子固定，键序随机）；反例：schema.test.mjs 里逐条列出的坏值 + 对合法值的随机变异。
// 每条用例是 {op, args} → 参考引擎回包：schema.validateValue 的回包是 null（通过）或「路径: 原因」字串，models.roundtrip 额外要求 Swift 的模型往返逐字节不变。
import { baselineState } from '../../../test/store/helpers.mjs';
import { makeCtx, rng } from '../../core-diff/lib/gen.mjs';
import { shapes } from '../../core-diff/lib/shapes.mjs';

const V2 = 'shizi.v2.';
const rec = (id, ch, over = {}) => ({
  id: `r${id}`, cardKey: `base:${ch}`, char: ch, sessionId: 's1', kind: 'judged', at: 1790000000000, localDay: '2026-09-15',
  help: { hints: 0, answerSeen: false, traced: false }, judgment: 'correct', ...over,
});
const plain = (x) => JSON.parse(JSON.stringify(x));

function handCases() {
  const R = [];
  const val = (key, value) => R.push({ op: 'schema.validateValue', args: { key, value } });
  const rt = (key, value) => R.push({ op: 'models.roundtrip', args: { key, value } });
  const both = (key, value) => { val(key, value); rt(key, value); };

  // 基线状态逐键（正例）
  const state = baselineState();
  for (const [domain, value] of Object.entries(state)) {
    if (value === null) continue;
    if (domain === 'records') for (const m of Object.keys(value)) both(`${V2}records.${m}`, value[m]);
    else if (domain === 'ink') for (const m of Object.keys(value)) both(`${V2}ink.${m}`, value[m]);
    else both(`${V2}${domain}`, value);
  }
  both(`${V2}records.2025-01`, { folded: true, month: '2025-01', byDay: { '2025-01-03': ['人'] }, chars: ['人'], kept: [rec(1, '人', { localDay: '2025-01-03' })] });
  both(`${V2}records.2025-02`, { folded: true, month: '2025-01', byDay: { '2025-01-03': ['人'] }, chars: ['人'], kept: [] });
  both(`${V2}records.2026-09`, [rec(1, '𠮷')]);
  both(`${V2}records.2026-10`, [rec(1, '人')]);
  both(`${V2}records.2026-09`, [rec(2, '人'), rec(1, '口')]);

  // schema.test.mjs：墨迹各版本
  const v4 = { v: 4, c: 345, r: ['A8gBkAMALiIIsQKOO1w=', 'BNAP0A8A7AQUEwT8Ag=='], g: [0, 400] };
  both(`${V2}ink.2026-09.r12`, v4);
  both(`${V2}ink.2026-09`, { r12: v4 });
  both(`${V2}ink.2026-09.r12`, { v: 3, c: 345, s: ['AAAAAA=='] });
  for (const bad of [
    { v: 4, c: 345, r: ['A8gBkAMALiIIsQKOO1w='], g: [] }, { v: 4, c: 345, r: [[3, 1, 2, 0]], g: [0] }, { v: 4, c: 345, r: ['AAA='], g: [0] },
    { v: 4, c: 345, r: ['A8gBkAMALiIIsQKOO1w='], g: [-1] }, { v: 4, c: 345, r: [], g: [], s: [] }, { v: 4, c: 345, r: [] },
  ]) both(`${V2}ink.2026-09.r12`, bad);
  both(`${V2}ink.2026-09`, { r5: { v: 2, c: 345, s: [[1, 2, 100]] } });
  for (const bad of [{ s5: { v: 2, c: 345, s: [] } }, { r5: { v: 1, c: 345, s: [] } }, { r5: { v: 3, c: 345, s: ['AAAAAA==', ''], p: ['AA==', ''] } }, { r5: { v: 3, c: 345, s: [[1, 2, 100]] } },
    { r5: { v: 3, c: 345, s: ['AA=A'] } }, { r5: { v: 3, c: 345, s: ['AAAAAA=='], dt: [[0]] } }, { r5: { v: 3, c: 345 } }, { r5: { v: 2, c: 345, s: ['AAAAAA=='] } }]) both(`${V2}ink.2026-09`, bad);

  // 记录形状
  const noJudgment = rec(1, '人');
  delete noJudgment.judgment;
  const noSession = rec(1, '人');
  delete noSession.sessionId;
  for (const r of [noJudgment, rec(1, '人', { kind: 'skipped', judgment: 'wrong' }), rec(1, '人', { char: '口' }), rec(1, '人', { help: { hints: 65, answerSeen: false, traced: false } }),
    rec(1, '人', { extraField: 1 }), noSession, { ...noSession, legacy: true }, rec(1, '人', { source: 'paper', inkId: 'r1' }), rec(1, '人', { kind: 'skipped', judgment: undefined, source: 'paper' }),
    rec(1, '人', { corrections: [{ from: 'wrong', at: 1 }] }), rec(1, '人', { kind: 'answer-seen', judgment: undefined, corrections: [] }), rec(1, '人', { legacy: false })]) {
    both(`${V2}records.2026-09`, [plain(r)]);
    R.push({ op: 'schema.validateRecord', args: { record: plain(r) } });
    R.push({ op: 'schema.validateRecord', args: { record: plain(r), month: '2026-10' } });
  }
  // 会话
  const s = baselineState().sessions;
  const bad = plain(s);
  bad.A.kind = 'picked';
  const bad2 = plain(s);
  bad2.A.cursor = 99;
  both(`${V2}sessions`, bad);
  both(`${V2}sessions`, bad2);
  // meta / backupMeta / settings 边角
  for (const v of [{ schema: 1, serial: 0, createdAt: 1, months: [] }, { schema: 2, serial: 0, createdAt: 1, months: [] }, { schema: 2, serial: 0, createdAt: 1, months: ['2026-09', '2026-09'] },
    { schema: 2, serial: 0, createdAt: 1, months: ['2026-10', '2026-09'] }, { schema: 2, serial: -1, createdAt: 1, months: [] }, { schema: 2, serial: 1.5, createdAt: 1, months: [] }]) both(`${V2}meta`, v);
  for (const v of [{ groupSize: 20 }, { groupSize: 7 }, { groupSize: '20' }, { appearance: 'blue' }, { remind: { hour: 24 } }, { remind: { hour: 23, minute: 59 } }, { remindInvite: { answered: 'maybe' } }, { writeMode: 'paper' }, {}, { unknown: 1 }]) both(`${V2}settings`, v);
  for (const v of [{}, { lastExportAt: null }, { lastConclusion: { kind: 'restore', count: 3, date: null } }, { lastConclusion: { kind: 'x', count: 3 } }, { lastConclusion: null }]) both(`${V2}backupMeta`, v);
  // 键
  for (const key of [`${V2}whatever`, `${V2}ink`, `${V2}records.2026-13`, `${V2}ink.2026-13`, 'shizi.corrupt.shizi.v2.meta', 'shizi.nativeSmoke.v1', `${V2}probe`]) val(key, {});
  for (const key of [`${V2}meta`, `${V2}records.2026-09`, `${V2}ink.2026-09`, `${V2}ink.2026-09.r12`, `${V2}ink.2026-09.`, `${V2}ink.2026-09.r0`, `${V2}ink.2026-09.s1`, `${V2}ink.2026-09r1`, `${V2}ink.2026-09.r1.x`,
    `${V2}records.2026-13`, `${V2}sessions`, `${V2}route`, `${V2}txn`, 'shizi.corrupt.shizi.v2.meta', 'shizi.nativeSmoke.v1', 'base:人', 'custom:𠮷', 'base:ab', 'custom:é', `${V2}probe`, '']) {
    R.push({ op: 'schema.keyInfo', args: { key } });
    R.push({ op: 'schema.keyFacts', args: { key } });
  }
  R.push({ op: 'schema.keys', args: {} });
  for (const domain of ['meta', 'records', 'ink', 'sched', 'sessions', 'txn', 'route', 'probe', 'toString', 'nope']) R.push({ op: 'schema.keyForDomain', args: { domain, month: '2026-09' } });
  R.push({ op: 'schema.makeKey', args: { month: '2026-09', id: 'r12' } });
  for (const value of ['2026-02-30', '2028-02-29', '2100-02-29', '0000-02-29', '0099-12-31', '0100-01-01', '9999-12-31', '2026-13-01', '2026-1-1', '２０２６-01-01', 'r12', 'r0', 'r01', 's7', 'r123456789012345678901234567890', 's9007199254740993',
    'base:人', 'base:ab', 'custom:', '人', '𠮷', 'é', '', null, 5, true, [], {}, '2026-09']) R.push({ op: 'schema.valueFacts', args: { value } });
  // 备份外壳（正例用基线状态拼）
  const data = {};
  for (const [domain, value] of Object.entries(baselineState())) {
    if (value === null || domain === 'sessions' || domain === 'funnel' || domain === 'safety') continue;
    if (domain === 'records') for (const m of Object.keys(value)) data[`${V2}records.${m}`] = JSON.stringify(value[m]);
    else if (domain === 'ink') for (const m of Object.keys(value)) data[`${V2}ink.${m}`] = JSON.stringify(value[m]);
    else data[`${V2}${domain}`] = JSON.stringify(value);
  }
  data[`${V2}sessions`] = JSON.stringify(baselineState().sessions);
  const env = { app: 'shizi', version: 2, date: '2026-09-15T01:00:00.000Z', data };
  R.push({ op: 'schema.parseBackupV2', args: { obj: env } });
  for (const key of Object.keys(data)) {
    for (const broken of ['{"not":"the right shape"}', '{oops', { raw: true }]) R.push({ op: 'schema.parseBackupV2', args: { obj: { ...env, data: { ...data, [key]: broken } } } });
    const noMeta = { ...env, data: { ...data } };
    delete noMeta.data[`${V2}meta`];
    R.push({ op: 'schema.parseBackupV2', args: { obj: noMeta } });
  }
  for (const obj of [{ app: 'shizi', version: 1, data: {} }, { app: 'other', version: 2, data: {} }, { app: 'shizi', version: 3, data: {} }, { app: 'shizi', version: 2, data: [] }, null, 5, []]) R.push({ op: 'schema.parseBackupV2', args: { obj } });
  for (const [key, raw] of [[`${V2}meta`, '{'], [`${V2}meta`, JSON.stringify({ schema: 1, serial: 0, createdAt: 1, months: [] })], [`${V2}meta`, JSON.stringify({ schema: 2, serial: 0, createdAt: 1, months: [] })], [`${V2}meta`, 5], [`${V2}nope`, '{}']]) {
    R.push({ op: 'schema.parseAndValidate', args: { key, raw } });
  }
  // 墨迹归月（时区相关，见 groups 的第二组）
  return R;
}

function inkOfCases() {
  const R = [];
  for (const record of [{ id: 'r5', localDay: '2026-09-30', at: Date.parse('2026-09-30T23:30:00+08:00') }, { id: 'r1', at: new Date(2026, 6, 4, 12).getTime() }, { id: 'r1' }, { id: 'r5', inkId: 'r4', localDay: '2026-09-30' },
    { id: 'r1', at: 8.64e15 + 1 }, { id: 'r1', at: 1e300 }, { id: 'r1', at: 0 }, { id: 'r1', at: -1 }, { id: 'r1', localDay: '2026-02-30', at: new Date(2026, 1, 28, 23, 59, 59, 999).getTime() }, null, 5, [], 'x']) {
    R.push({ op: 'schema.inkOf', args: { record } });
  }
  return R;
}

function randomCases(seed, n) {
  const g = makeCtx(rng(seed));
  const S = shapes(g);
  const R = [];
  for (let i = 0; i < n; i += 1) {
    const { key, value } = S.forKind(g.pick(S.kinds));
    const v = S.maybeBad(value, 0.5);
    R.push({ op: i % 2 ? 'models.roundtrip' : 'schema.validateValue', args: { key, value: v } });
  }
  for (let i = 0; i < n / 10; i += 1) R.push({ op: 'schema.parseBackupV2', args: { obj: S.maybeBad(S.backupEnvelope(), 0.5) } });
  return R;
}

export default {
  id: 'schema',
  source: 'src/core/schema.js',
  build({ withTZ, opCases }) {
    return {
      // 基线状态（test/store/helpers.mjs baselineState）：Swift 的 schema / 模型测试直接读，不再手抄。
      baseline: baselineState(),
      groups: [
        withTZ('Asia/Shanghai', () => ({ tz: 'Asia/Shanghai', cases: opCases([...handCases(), ...inkOfCases(), ...randomCases(20261023, 700)]) })),
        withTZ('America/New_York', () => ({ tz: 'America/New_York', cases: opCases(inkOfCases()) })),
        withTZ('Australia/Lord_Howe', () => ({ tz: 'Australia/Lord_Howe', cases: opCases(inkOfCases()) })),
      ],
    };
  },
};
