// M4-4 备份与恢复：core/backup.js 的纯函数（文件构造、导入校验报告、签名、丢失范围、状态句）与保护副本编排
// （真 store + 内存 Storage + 故障注入：副本失败不替换且不回收、覆盖失败已回滚、撤销失败副本保留、清空与撤销、导出记账）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backupEntries, backupFileName, backupStatus, buildBackupV2, clearAllRecords, confirmModel, dropSafety, endActiveSessions, importLegacyBackup,
  inspectBackup, judgedCharsOf, lossRange, makeSafety, markExported, recordsSignature, restoreFromBackup, safetyMatchesCurrent,
  safetyOf, serializeBackup, setLegacyBackupImporter, undoFromSafety, BACKUP_MAX_BYTES, STAGES,
} from '../../src/core/backup.js';
import { KEYS, parseBackupV2, validateValue } from '../../src/core/schema.js';
import { createStore } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { MemoryStorage, session } from '../store/helpers.mjs';

const NOW = new Date(2026, 8, 24, 20).getTime();

function ms(day, hour = 9) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
}

function rec(serial, char, day, { kind = 'judged', judgment = 'correct' } = {}) {
  const r = { id: `r${serial}`, cardKey: `base:${char}`, char, sessionId: 's1', kind, at: ms(day) + serial, localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

const FSRS = { stability: 3, difficulty: 5, state: 2 };

/** 两个月的记录（7 月、9 月）+ sched / custom / settings / backupMeta / sessions。 */
function currentState() {
  return {
    records: {
      '2026-07': [rec(1, '永', '2026-07-03'), rec(2, '和', '2026-07-04', { judgment: 'wrong' })],
      '2026-09': [rec(3, '永', '2026-09-02'), rec(4, '字', '2026-09-20'), rec(5, '看', '2026-09-21', { kind: 'answer-seen' })],
    },
    sched: {
      'base:永': { fsrs: FSRS, due: '2026-10-01', lastJudgedAt: ms('2026-09-02') },
      'base:和': { fsrs: FSRS, due: '2026-09-25', lastJudgedAt: ms('2026-07-04') },
      'base:字': { fsrs: FSRS, due: '2026-10-05', lastJudgedAt: ms('2026-09-20') },
    },
    custom: { added: [{ char: '鲜', at: ms('2026-09-01') }] },
    settings: { library: 'adv3000', sound: false },
    backupMeta: { lastExportAt: ms('2026-09-10'), lastExportSig: 'x', lastConclusion: null },
    sessions: { A: null, B: null, lastEnded: {} },
  };
}

/** 一份旧备份：9 月 1 日以前的 1 个字。 */
function oldBackupState() {
  return {
    meta: { schema: 2, serial: 9, createdAt: ms('2026-06-01'), months: ['2026-08'] },
    records: { '2026-08': [rec(7, '旧', '2026-08-30'), rec(9, '书', '2026-08-31')] },
    sched: { 'base:旧': { fsrs: FSRS, due: '2026-09-30', lastJudgedAt: ms('2026-08-30') } },
    settings: { library: 'core3500' },
    backupMeta: { lastExportAt: ms('2026-09-01'), lastExportSig: 'old', lastConclusion: null },
  };
}

function makeStore(initialState = null) {
  const backend = new MemoryStorage();
  const storage = createStorage(backend, { now: () => NOW });
  const store = createStore({ storage, now: () => NOW });
  store.load();
  if (initialState) assert.equal(store.seed(initialState).ok, true);
  return { backend, storage, store };
}

function v2Raw(backend) {
  const out = {};
  for (const [k, v] of Object.entries(backend.snapshot())) if (k.indexOf('shizi.') === 0) out[k] = v;
  return out;
}

test('buildBackupV2: 只含白名单键、值 = 落盘字串、缺 meta 时补一份且 parseBackupV2 认得', () => {
  const { store, backend } = makeStore(currentState());
  const state = store.getState();
  const obj = buildBackupV2(state, { now: NOW, serial: store.serial });
  assert.equal(obj.app, 'shizi');
  assert.equal(obj.version, 2);
  assert.equal(obj.date, new Date(NOW).toISOString());
  const keys = Object.keys(obj.data).sort();
  assert.deepEqual(keys, [
    'shizi.v2.backupMeta', 'shizi.v2.custom', 'shizi.v2.meta', 'shizi.v2.records.2026-07', 'shizi.v2.records.2026-09',
    'shizi.v2.sched', 'shizi.v2.settings',
  ]);
  assert.ok(!('shizi.v2.sessions' in obj.data), 'sessions not in backup (01 §3.6)');
  const raw = backend.snapshot();
  for (const key of keys) if (key !== KEYS.meta) assert.equal(obj.data[key], raw[key], `${key} equals stored raw`);
  const meta = JSON.parse(obj.data[KEYS.meta]);
  assert.deepEqual(meta, { schema: 2, serial: store.serial, createdAt: NOW, months: ['2026-07', '2026-09'] });
  const parsed = parseBackupV2(JSON.parse(serializeBackup(obj)));
  assert.equal(parsed.ok, true);
  // Q2-7（03 P182，复测 simA）：备份文件名是用户认得出的「拾字备份-日期.json」，不含 UUID / 英文前缀
  assert.equal(backupFileName(NOW), '拾字备份-2026-09-24.json');
  assert.doesNotMatch(backupFileName(NOW), /shizi|[0-9a-f]{8}-[0-9a-f]{4}/i);
  // 已有 meta 时原样导出
  const withMeta = buildBackupV2({ ...state, meta: { schema: 2, serial: 42, createdAt: 1, months: ['2026-07', '2026-09'] } }, { now: NOW });
  assert.equal(JSON.parse(withMeta.data[KEYS.meta]).serial, 42);
});

test('inspectBackup: 报告（日期、字数含折叠月）与失败原因 → R-B06 口径', () => {
  const good = buildBackupV2({
    ...oldBackupState(),
    records: {
      '2026-06': { folded: true, month: '2026-06', byDay: { '2026-06-02': ['月'] }, chars: ['月', '日'], kept: [] },
      ...oldBackupState().records,
    },
  }, { now: ms('2026-09-01', 20) });
  const report = inspectBackup(serializeBackup(good));
  assert.equal(report.ok, true);
  assert.equal(report.day, '2026-09-01');
  assert.equal(report.count, 4, '旧 书 + 折叠月 月 日');
  assert.equal(report.latestDay, '2026-08-31');
  assert.equal(report.fromLegacy, false);

  const cases = [
    ['not json at all', 'json', 'notBackup'],
    [JSON.stringify({ hello: 1 }), 'format', 'notBackup'],
    [serializeBackup(good).slice(0, 200), 'damaged', 'restoreFailed'],
    [JSON.stringify({ ...good, version: 3 }), 'version', 'restoreFailed'],
    [JSON.stringify({ ...good, data: { ...good.data, 'shizi.v2.records.2026-08': '[{"id":"bad"}]' } }), 'shape', 'restoreFailed'],
    [JSON.stringify({ ...good, data: { 'shizi.v2.settings': '{}' } }), 'empty', 'restoreFailed'],
    [JSON.stringify({ app: 'shizi', version: 1, data: { 'shizi.memory.v1': '{}' } }), 'v1-unsupported', 'restoreFailed'],
  ];
  for (const [text, reason, kind] of cases) {
    const r = inspectBackup(text);
    assert.equal(r.ok, false, reason);
    assert.equal(r.reason, reason);
    assert.equal(r.kind, kind, `${reason} → ${kind}`);
  }
  const big = inspectBackup('x'.repeat(16), { maxBytes: 8 });
  assert.deepEqual([big.reason, big.kind], ['tooLarge', 'notBackup']);
  assert.equal(BACKUP_MAX_BYTES, 10 * 1024 * 1024);
});

test('v1 备份：转换器未注册是桩（v1-unsupported）；M5-4 注册后走同一份报告', () => {
  const v1 = { app: 'shizi', version: 1, date: '2026-08-01T10:00:00.000Z', data: { 'shizi.memory.v1': '{}' } };
  assert.deepEqual(importLegacyBackup(v1), { ok: false, reason: 'v1-unsupported' });
  const converted = buildBackupV2(oldBackupState(), { now: ms('2026-08-01', 18) });
  setLegacyBackupImporter(obj => (obj.version === 1 ? { ok: true, backup: converted } : { ok: false }));
  try {
    const r = inspectBackup(JSON.stringify(v1));
    assert.equal(r.ok, true);
    assert.equal(r.fromLegacy, true);
    assert.equal(r.count, 2);
  } finally {
    setLegacyBackupImporter(null);
  }
  assert.equal(importLegacyBackup('{').reason, 'json');
});

test('recordsSignature: 只看 judged 的 id 与判断；更正、新增改变签名，看过答案不改变', () => {
  const s = currentState().records;
  const base = recordsSignature(s);
  assert.match(base, /^4:[0-9a-f]{8}$/);
  const withSeen = { ...s, '2026-09': [...s['2026-09'], rec(6, '看', '2026-09-22', { kind: 'answer-seen' })] };
  assert.equal(recordsSignature(withSeen), base);
  const corrected = { ...s, '2026-09': s['2026-09'].map(r => (r.id === 'r4' ? { ...r, judgment: 'wrong' } : r)) };
  assert.notEqual(recordsSignature(corrected), base);
  const more = { ...s, '2026-09': [...s['2026-09'], rec(8, '新', '2026-09-23')] };
  assert.notEqual(recordsSignature(more), base);
  assert.equal(recordsSignature({ '2026-09': s['2026-09'], '2026-07': s['2026-07'] }), base, '月份键顺序无关');
  assert.equal(recordsSignature({}), '0:811c9dc5');
});

test('lossRange / confirmModel：现在的记录里晚于备份日期的日子（P26 / K04）；没有记录 → 恢复措辞', () => {
  const s = currentState();
  assert.deepEqual(lossRange(s.records, '2026-09-01'), { from: '2026-09-02', to: '2026-09-20', days: 2 });
  assert.deepEqual(lossRange(s.records, '2026-09-19'), { from: '2026-09-20', to: '2026-09-20', days: 1 });
  assert.equal(lossRange(s.records, '2026-09-24'), null);
  assert.equal(lossRange(s.records, null), null);
  const report = { day: '2026-09-01', count: 23 };
  assert.deepEqual(confirmModel(s, report), { mode: 'replace', day: '2026-09-01', n: 23, m: 3, loss: { from: '2026-09-02', to: '2026-09-20', days: 2 } });
  assert.equal(confirmModel(s, report, { showLoss: false }).loss, null);
  assert.deepEqual(confirmModel({ records: {} }, report), { mode: 'restore', day: '2026-09-01', n: 23, m: 0, loss: null });
});

test('backupStatus：T07 状态机（无记录 / 从没备份 / 一致 / 有改动 / 结论只写结论）', () => {
  const keys = st => backupStatus(st).lines.map(l => l.key);
  assert.deepEqual(keys({ records: {} }), ['R-B02.noRecords']);
  assert.deepEqual(backupStatus({ records: {} }).date, { kind: 'never' });
  assert.equal(backupStatus({ records: {} }).canExport, false);
  const s = currentState();
  const never = { ...s, backupMeta: null };
  assert.deepEqual(keys(never), [], 'N27：有记录、从没备份 → 不写句子');
  const matched = { ...s, backupMeta: { lastExportAt: ms('2026-09-20'), lastExportSig: recordsSignature(s.records) } };
  assert.deepEqual(keys(matched), ['R-B02.allBackedUp']);
  assert.deepEqual(backupStatus(matched).date, { kind: 'day', day: '2026-09-20' });
  assert.deepEqual(keys(s), ['R-B02.changedSince']);
  const restored = { ...matched, backupMeta: { ...matched.backupMeta, lastConclusion: { kind: 'restore', date: '2026-09-01', count: 23 } } };
  assert.deepEqual(backupStatus(restored).lines, [{ key: 'R-B01.conclusionRestore', vars: { day: '2026-09-01', n: 23 } }]);
  const cleared = { records: {}, backupMeta: { lastExportAt: null, lastExportSig: null, lastConclusion: { kind: 'clear', date: null, count: 3 } } };
  assert.deepEqual(keys(cleared), ['R-B01.conclusionClear']);
  // 撤销底栏在时的结论覆盖 backupMeta 里的
  assert.deepEqual(backupStatus(s, { conclusion: { kind: 'restore', date: '2026-08-01', count: 2 } }).lines[0].vars, { day: '2026-08-01', n: 2 });
  // 清空结论之后又写了字：不再说「记录已清空」，回到一般规则
  assert.deepEqual(keys({ ...s, backupMeta: cleared.backupMeta }), []);
});

test('makeSafety：形状合 schema（白名单键原始字串 + 现在的 sessions，P79）', () => {
  const { store } = makeStore(currentState());
  const safety = makeSafety(store.getState(), { kind: 'restore', now: NOW, backupDate: '2026-09-01', count: 2 });
  assert.equal(validateValue(KEYS.safety, safety), null);
  assert.equal(safety.payload[KEYS.sessions], JSON.stringify(store.getState().sessions), 'sessions carried along');
  assert.deepEqual(Object.keys(safety.payload).filter(k => k !== KEYS.sessions).sort(), backupEntries(store.getState()).map(([k]) => k).sort());
  assert.equal(safetyMatchesCurrent(store.getState()), false, 'no safety in state yet');
  const noSessions = makeSafety({ ...store.getState(), sessions: null }, { kind: 'clear', now: NOW });
  assert.ok(!(KEYS.sessions in noSessions.payload), 'no sessions domain → no sessions key');
  assert.equal(validateValue(KEYS.safety, noSessions), null);
  // schema：payload 里的 sessions 必须是合法的 shizi.v2.sessions
  assert.match(validateValue(KEYS.safety, { ...safety, payload: { ...safety.payload, [KEYS.sessions]: '{"A":1}' } }), /sessions/);
  assert.match(validateValue(KEYS.safety, { ...safety, payload: { ...safety.payload, [KEYS.sessions]: 'nope' } }), /not JSON/);
  assert.match(validateValue(KEYS.safety, { ...safety, payload: { ...safety.payload, [KEYS.funnel]: '{}' } }), /bad key/, 'other excluded keys still rejected');
});

/** 有一组没写完的 A 组（今天的练习）与已结束的 B 组。 */
function withActiveSessions() {
  const A = session(8, { queue: ['base:永', 'base:字', 'base:和'], cursor: 1, items: [{ cardKey: 'base:永', recordId: 'r3', kind: 'judged' }] });
  const B = session(6, { slot: 'B', kind: 'picked', queue: ['base:字'], cursor: 1, items: [{ cardKey: 'base:字', recordId: 'r4', kind: 'judged' }] });
  return { ...currentState(), sessions: { A, B: null, lastEnded: { B: { ...B, endedAt: ms('2026-09-20', 10) } } } };
}

test('P79 / M6-6：替换备份结束进行中的组（A/B 置 null、lastEnded 清空），撤销后会话与全部 v2 键逐字还原', () => {
  const { store, backend } = makeStore(withActiveSessions());
  const before = v2Raw(backend);
  const sessionsBefore = JSON.parse(JSON.stringify(store.getState().sessions));
  const report = inspectBackup(serializeBackup(buildBackupV2(oldBackupState(), { now: ms('2026-09-01', 20) })));
  assert.equal(restoreFromBackup(store, report, { now: NOW }).ok, true);
  const st = store.getState();
  assert.equal(st.sessions.A, null, 'A ended');
  assert.equal(st.sessions.B, null);
  assert.ok(Object.keys(sessionsBefore.lastEnded).length > 0, 'fixture had a lastEnded group');
  assert.deepEqual(JSON.parse(JSON.stringify(st.sessions.lastEnded)), {}, 'M6-6: lastEnded cleared with the replace');
  assert.deepEqual(JSON.parse(backend.getItem(KEYS.sessions)).lastEnded, {}, 'lastEnded cleared on disk too');
  assert.deepEqual(JSON.parse(safetyOf(st).payload[KEYS.sessions]), sessionsBefore, 'original sessions in the safety copy');
  assert.equal(JSON.parse(backend.getItem(KEYS.sessions)).A, null, 'on disk too');
  assert.equal(undoFromSafety(store).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().sessions)), sessionsBefore, 'A back, current deep-equal');
  assert.deepEqual(v2Raw(backend), before, 'K03: every v2 key (incl. sessions) byte-equal after undo');
});

test('P79：清空所有记录同样结束进行中的组；撤销还原会话；清空失败时会话不动', () => {
  const { store, backend } = makeStore(withActiveSessions());
  const before = v2Raw(backend);
  const sessionsBefore = JSON.parse(JSON.stringify(store.getState().sessions));
  assert.equal(clearAllRecords(store, { now: NOW }).ok, true);
  assert.equal(store.getState().sessions.A, null);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().sessions.lastEnded)), {}, 'M6-6: lastEnded cleared with the clear');
  assert.equal(undoFromSafety(store).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().sessions)), sessionsBefore);
  assert.deepEqual(v2Raw(backend), before);
  const b = makeStore(withActiveSessions());
  const beforeB = v2Raw(b.backend);
  b.storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.sessions });
  const r = clearAllRecords(b.store, { now: NOW });
  assert.equal(r.stage, STAGES.clear);
  assert.deepEqual(v2Raw(b.backend), beforeB, 'clear rolled back incl. sessions; safety dropped');
  assert.ok(b.store.getState().sessions.A, 'A still there');
});

test('M6-6：endActiveSessions——只有 lastEnded 时也清；什么都没有时不写；没有 sessions 域时不建', () => {
  const onlyEnded = { sessions: { A: null, B: null, lastEnded: { A: { id: 's1' } } } };
  endActiveSessions(onlyEnded);
  assert.deepEqual(onlyEnded.sessions, { A: null, B: null, lastEnded: {} }, 'lastEnded-only → cleared');
  const empty = { sessions: { A: null, B: null, lastEnded: {} } };
  const ref = empty.sessions;
  endActiveSessions(empty);
  assert.equal(empty.sessions, ref, 'nothing to end → draft untouched (no write)');
  const none = { sessions: null };
  endActiveSessions(none);
  assert.equal(none.sessions, null, 'no sessions domain → not created');
});

test('I2：保护副本 / 清空 / 撤销走 store.commit 的 reclaim:false——撞配额不回收、全部键不变；通知是整体替换', () => {
  const { store, backend, storage } = makeStore(currentState());
  const before = v2Raw(backend);
  const seen = [];
  store.subscribe((state, info) => seen.push(info));
  // 配额只注入一次：默认 commit 会「回收后重试一次」吸收它（01 §9），reclaim:false 不重试
  storage.failNextWrite(1, { kind: 'quota', matchKey: KEYS.safety });
  const r = clearAllRecords(store, { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.stage, STAGES.safety);
  assert.equal(r.error.kind, 'quota');
  assert.deepEqual(v2Raw(backend), before, 'nothing changed; July not folded');
  assert.ok(!seen.some(info => info.type === 'recover'), 'no side recovery');
  storage.clearFaults();
  assert.equal(clearAllRecords(store, { now: NOW }).ok, true);
  assert.ok(seen.filter(info => info.type === 'commit').every(info => info.replace === true), 'safety / clear notifications are replacements');
});

test('恢复 → 撤销：替换采用备份（backupMeta 换成本机日期 + 结论、sessions 不动、清 corrupt），撤销后全部 v2 键逐字相等', () => {
  const { store, backend } = makeStore({
    ...currentState(),
    sessions: { A: null, B: null, lastEnded: {} },
  });
  backend.setItem('shizi.corrupt.shizi.v2.custom', '"garbage"');
  const before = v2Raw(backend);
  const report = inspectBackup(serializeBackup(buildBackupV2(oldBackupState(), { now: ms('2026-09-01', 20) })));
  const r = restoreFromBackup(store, report, { now: NOW });
  assert.equal(r.ok, true);
  const st = store.getState();
  assert.deepEqual(Object.keys(st.records), ['2026-08']);
  assert.deepEqual(st.settings, { library: 'core3500' });
  assert.equal(st.custom, null);
  assert.deepEqual(st.backupMeta, {
    lastExportAt: ms('2026-09-10'), lastExportSig: 'x', lastConclusion: { kind: 'restore', date: '2026-09-01', count: 2 },
  });
  assert.deepEqual(st.sessions, { A: null, B: null, lastEnded: {} });
  assert.ok(safetyOf(st), 'safety present while undo is available');
  assert.equal(safetyOf(st).kind, 'restore');
  assert.equal(backend.getItem('shizi.corrupt.shizi.v2.custom'), null, 'corrupt cleaned after successful import');
  assert.equal(safetyMatchesCurrent(st), false);
  const u = undoFromSafety(store);
  assert.equal(u.ok, true);
  const after = v2Raw(backend);
  delete before['shizi.corrupt.shizi.v2.custom'];
  assert.deepEqual(after, before, 'all shizi.* keys byte-equal after undo (safety removed in the same write)');
  assert.equal(safetyOf(store.getState()), null);
});

test('R-B04：保护副本写失败（配额两次 / 通用）→ 不替换、不做预算回收、全部键不变', () => {
  for (const [n, kind, matchKey] of [[2, 'quota', KEYS.safety], [1, 'generic', null], [2, 'quota', null]]) {
    // 7 月是旧月份：若副本走 commit 的「撞配额先回收」，会被折叠——这里必须原样不动
    const { store, backend, storage } = makeStore(currentState());
    const before = v2Raw(backend);
    const report = inspectBackup(serializeBackup(buildBackupV2(oldBackupState(), { now: ms('2026-09-01', 20) })));
    storage.failNextWrite(n, { kind, matchKey });
    const r = restoreFromBackup(store, report, { now: NOW });
    assert.equal(r.ok, false, `${kind} x${n}`);
    assert.equal(r.stage, STAGES.safety);
    storage.clearFaults();
    assert.deepEqual(v2Raw(backend), before, `${kind} x${n}: nothing changed`);
    assert.equal(safetyOf(store.getState()), null);
    assert.equal(Array.isArray(store.getState().records['2026-07']), true, '7 月没有被折叠');
  }
});

test('覆盖失败已回滚：替换中途写失败 → store 回滚、副本删除、全部键不变（R-B06 没能恢复）', () => {
  const { store, backend, storage } = makeStore(currentState());
  const before = v2Raw(backend);
  const report = inspectBackup(serializeBackup(buildBackupV2(oldBackupState(), { now: ms('2026-09-01', 20) })));
  storage.failNextWrite(1, { kind: 'generic', matchKey: 'shizi.v2.records.*' });
  const r = restoreFromBackup(store, report, { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.stage, STAGES.replace);
  assert.equal(r.safetyDropped, true);
  assert.deepEqual(v2Raw(backend), before);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().records)), currentState().records);
});

test('R-B05：撤销失败 → 仍是备份里的记录、副本保留、可以再点；再点成功', () => {
  const { store, backend, storage } = makeStore(currentState());
  const before = v2Raw(backend);
  const report = inspectBackup(serializeBackup(buildBackupV2(oldBackupState(), { now: ms('2026-09-01', 20) })));
  assert.equal(restoreFromBackup(store, report, { now: NOW }).ok, true);
  const replaced = v2Raw(backend);
  storage.failNextWrite(1, { kind: 'generic' });
  const u1 = undoFromSafety(store);
  assert.equal(u1.ok, false);
  assert.deepEqual(v2Raw(backend), replaced, 'still the backup data, safety kept');
  assert.ok(safetyOf(store.getState()));
  assert.equal(undoFromSafety(store).ok, true);
  assert.deepEqual(v2Raw(backend), before);
  assert.deepEqual(undoFromSafety(store), { ok: false, error: { kind: 'no-safety' } });
});

test('清空所有记录 → 撤销：清掉记录类域、保留 settings 与本机备份日期、写入结论；撤销逐字还原', () => {
  const { store, backend, storage } = makeStore(currentState());
  const before = v2Raw(backend);
  const r = clearAllRecords(store, { now: NOW });
  assert.equal(r.ok, true);
  const st = store.getState();
  assert.deepEqual(st.records, {});
  for (const d of ['sched', 'custom', 'wordOff', 'photos', 'legacy']) assert.equal(st[d], null, d);
  assert.deepEqual(st.settings, { library: 'adv3000', sound: false });
  assert.deepEqual(st.backupMeta, { lastExportAt: ms('2026-09-10'), lastExportSig: 'x', lastConclusion: { kind: 'clear', date: null, count: 3 } });
  assert.deepEqual(backupStatus(st).lines.map(l => l.key), ['R-B01.conclusionClear']);
  assert.equal(safetyOf(st).kind, 'clear');
  // 清空后撤销失败：记录还是空的
  storage.failNextWrite(1, { kind: 'generic' });
  assert.equal(undoFromSafety(store).ok, false);
  assert.deepEqual(store.getState().records, {});
  assert.equal(undoFromSafety(store).ok, true);
  assert.deepEqual(v2Raw(backend), before);
});

test('清空：副本失败 / 清空本身失败 → 全部键不变', () => {
  const a = makeStore(currentState());
  const beforeA = v2Raw(a.backend);
  a.storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.safety });
  assert.equal(clearAllRecords(a.store, { now: NOW }).stage, STAGES.safety);
  assert.deepEqual(v2Raw(a.backend), beforeA);
  const b = makeStore(currentState());
  const beforeB = v2Raw(b.backend);
  // 清空只删记录键（removeItem）；setItem 只有 backupMeta（结论）——让它失败
  b.storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.backupMeta });
  const r = clearAllRecords(b.store, { now: NOW });
  assert.equal(r.stage, STAGES.clear);
  assert.deepEqual(v2Raw(b.backend), beforeB);
});

test('导出记账：lastExportAt / 签名、清结论 → 「现在的记录都已经备份了」；dropSafety 无副本不写', () => {
  const { store, backend } = makeStore(currentState());
  const writes = backend.writeCount;
  assert.deepEqual(dropSafety(store), { ok: true, keys: [] });
  assert.equal(backend.writeCount, writes);
  const sig = recordsSignature(store.getState().records);
  assert.equal(markExported(store, { at: NOW, sig }).ok, true);
  assert.deepEqual(store.getState().backupMeta, { lastExportAt: NOW, lastExportSig: sig });
  assert.deepEqual(backupStatus(store.getState()).lines.map(l => l.key), ['R-B02.allBackedUp']);
  assert.equal(judgedCharsOf(store.getState().records).size, 3);
});

test('备份页文案小工具（mine/backup.js）：撤销底栏两行、丢失范围句、结论句、「我的」菜单右侧', async () => {
  const ui = await import('../../src/ui/screens/mine/backup.js');
  assert.deepEqual(ui.undoLines('restore', false), ['已换成备份里的记录', '离开这一页前可以撤销']);
  assert.deepEqual(ui.undoLines('clear', false), ['记录已清空', '离开这一页前可以撤销']);
  assert.deepEqual(ui.undoLines('restore', true), ['没能撤销，现在还是备份里的记录', '可以再点一次撤销']);
  assert.deepEqual(ui.undoLines('clear', true), ['没能撤销，记录还是空的', '可以再点一次撤销']);
  assert.equal(ui.lossText({ from: '2026-09-02', to: '2026-09-24' }), '9 月 2 日到 9 月 24 日的记录会丢失，建议先导出备份文件。');
  assert.equal(ui.lossText({ from: '2026-09-20', to: '2026-09-20' }), '9 月 20 日的记录会丢失，建议先导出备份文件。');
  assert.equal(ui.lossText(null), '');
  assert.equal(ui.lineText({ key: 'R-B01.conclusionRestore', vars: { day: '2026-09-01', n: 23 } }), '已换成 9 月 1 日备份里的记录，一共 23 个字。');
  assert.equal(ui.lineText({ key: 'R-B02.noRecords' }), '现在没有记录。');
  assert.deepEqual(ui.backupMenuStatus({ records: {} }), { kind: 'never', day: null, text: '还没有备份' });
  assert.deepEqual(ui.backupMenuStatus({ records: {}, backupMeta: { lastExportAt: ms('2026-09-01', 20) } }),
    { kind: 'day', day: '2026-09-01', text: '上次备份 9 月 1 日 ›' });
  assert.deepEqual(Object.values(ui.NOTE_KEYS), ['R-B04.protectFailed', 'R-B06.cancelled', 'R-B06.notBackup', 'R-B06.restoreFailed']);
});

// ---------------------------------------------------------------- D27 本人笔迹（阶段 1 P1-E3）

test('D27：备份信封含墨迹（每字第一次 + 最近一次，跨月键）；导出 → 新机恢复逐字相等；恢复旧备份 → 撤销，墨迹往返不丢', async () => {
  const { encodeInk, buildStroke, decodeInk } = await import('../../src/core/ink-math.js');
  const { flatInk } = await import('../store/helpers.mjs');
  const stroke = (y, t0) => buildStroke([{ x: 60, y, t: t0 }, { x: 170, y: y + 2, t: t0 + 60 }, { x: 280, y: y + 9, t: t0 + 120 }], { final: true });
  const inkA = encodeInk([stroke(120, 0), stroke(200, 500)]);
  const inkB = encodeInk([stroke(90, 0)]);
  // 永：r1（7 月，第一次）+ r3（9 月，最近一次）；和 r2、字 r4 各一次
  const withInk = { ...currentState(), ink: { '2026-07': { r1: inkA, r2: inkB }, '2026-09': { r3: inkB, r4: inkA } } };
  const { store, backend } = makeStore(withInk);
  // 1. 导出文件里有每个 ink 月键，值 = 落盘字串
  const file = buildBackupV2(store.getState(), { now: NOW });
  for (const month of ['2026-07', '2026-09']) {
    assert.equal(file.data[`shizi.v2.ink.${month}`], backend.getItem(`shizi.v2.ink.${month}`), `ink ${month} in the envelope`);
  }
  const report = inspectBackup(serializeBackup(file));
  assert.equal(report.ok, true);
  // 2. 换到一台空的机器上恢复：墨迹逐字相等、可解码
  const fresh = makeStore();
  assert.equal(restoreFromBackup(fresh.store, report, { now: NOW }).ok, true);
  for (const month of ['2026-07', '2026-09']) {
    assert.equal(fresh.backend.getItem(`shizi.v2.ink.${month}`), backend.getItem(`shizi.v2.ink.${month}`), `ink ${month} restored byte-equal`);
  }
  assert.deepEqual(decodeInk(fresh.store.getInk(rec(1, '永', '2026-07-03'))), decodeInk(inkA), 'first-time ink of 永 decodes after restore');
  assert.deepEqual(decodeInk(fresh.store.getInk(rec(3, '永', '2026-09-02'))), decodeInk(inkB), 'latest ink of 永 decodes after restore');
  // 3. 在原机上恢复一份没有墨迹的旧备份 → 墨迹随替换清掉；撤销 → 全部墨迹键逐字回来
  const before = v2Raw(backend);
  const old = inspectBackup(serializeBackup(buildBackupV2(oldBackupState(), { now: ms('2026-09-01', 20) })));
  assert.equal(restoreFromBackup(store, old, { now: NOW }).ok, true);
  assert.deepEqual(flatInk(store.getState().ink), {}, 'backup had no ink → none after replace');
  assert.ok(Object.keys(safetyOf(store.getState()).payload).some(k => k.startsWith('shizi.v2.ink.')), 'safety copy carries the ink keys');
  assert.equal(undoFromSafety(store).ok, true);
  assert.deepEqual(v2Raw(backend), before, 'undo restores every key, ink included, byte-equal');
});
