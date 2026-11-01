// B1 原生数据层（01 §4.1 / §12.1）：校验和口径（与 Swift 同一组向量）、事务后端的写入语义与耐久性、
// localStorage → 原生的一次性迁移（正常、中断重入、校验失败回退、读不出时的阻断）、备份往返。
// store 的通用契约（commit / 回收 / 中断矩阵 / 备份整单拒绝……）在 store.test.mjs 里对两种后端各跑一遍；这里只测原生特有的部分。
import test from 'node:test';
import assert from 'node:assert/strict';
import { checksum, digestRows, isNativeStoreHost, NativeStoreError, parseResponse } from '../../src/platform/native-store.js';
import { createStorage } from '../../src/store/storage.js';
import { createStore } from '../../src/store/store.js';
import { MIGRATION_SKIP, prepareStorage } from '../../src/store/native-boot.js';
import { NATIVE_BUDGETS, BUDGET_DEFAULTS, storagePressureOf } from '../../src/store/budget.js';
import { KEYS, NATIVE_SMOKE_KEY, NATIVE_STORE_MARKER_KEY, inkRecordKey, recordsKey } from '../../src/core/schema.js';
import { buildBackupV2, inspectBackup, restoreFromBackup, serializeBackup, dropSafety } from '../../src/core/backup.js';
import { mountTestHooks } from '../../src/platform/test-hooks.js';
import { FakeNativeDb } from './native-fake.mjs';
import { MemoryStorage, baselineState, judgeMutation, plain } from './helpers.mjs';

const NOW = Date.parse('2026-10-02T10:00:00+08:00');
const clock = () => NOW;

function nativeEnv(db = new FakeNativeDb()) {
  const storage = createStorage(db.open(), { now: clock });
  const store = createStore({ storage, now: clock });
  store.load();
  return { db, storage, store };
}

function seededNative() {
  const env = nativeEnv();
  assert.equal(env.store.seed(baselineState()).ok, true);
  return env;
}

/** 旧版（localStorage）留下的一份数据：经旧路径（localStorage 后端的 store）写入，再加路由提示、一个 v1 旧键、一个隔离值。 */
function legacyLocal() {
  const ls = new MemoryStorage();
  const storage = createStorage(ls, { now: clock });
  const store = createStore({ storage, now: clock });
  store.load();
  assert.equal(store.seed(baselineState()).ok, true);
  assert.equal(store.commit('judge', judgeMutation('大')).ok, true);
  storage.writeRoute(JSON.stringify({ v: 1, at: NOW, stack: [{ n: 'home', p: {} }] }));
  ls.setItem('shizi.memory.v1', '{"old":true,"char":"拾"}');
  ls.setItem('shizi.corrupt.shizi.v2.custom', 'not json at all');
  ls.setItem(NATIVE_SMOKE_KEY, 'smoke');
  ls.setItem('other.app.key', 'not ours');
  return { ls, state: plain(store.getState()) };
}

function shiziRows(ls) {
  const out = {};
  for (let i = 0; i < ls.length; i += 1) {
    const key = ls.key(i);
    if (key.indexOf('shizi.') === 0 && MIGRATION_SKIP.indexOf(key) < 0) out[key] = ls.getItem(key);
  }
  return out;
}

const fresh = () => new FakeNativeDb({ migration: null });

// ---------------------------------------------------------------- 校验和口径（Swift NativeStoreTests 用同一组向量）

test('checksum / digest vectors are shared with Swift (UTF-8 bytes + FNV-1a 32; lone surrogate = U+FFFD)', () => {
  const vectors = [
    ['', '0:811c9dc5'],
    ['a', '1:e40c292c'],
    ['shizi', '5:5ef7173c'],
    ['拾字', '6:85111e4b'],
    ['{"k":"值"}', '11:f2384e21'],
    ['😀', '4:33a29608'],
    ['a\ud800b', '5:763177ed'],
  ];
  for (const [s, sum] of vectors) assert.equal(checksum(s), sum, JSON.stringify(s));
  assert.equal(digestRows([['shizi.v2.meta', '{"schema":2}'], ['shizi.v2.records.2026-09', '[]']]).digest, '2:14:6e6d7a67');
  assert.equal(digestRows([]).digest, '0:0:811c9dc5');
});

test('isNativeStoreHost: only the iOS shell scheme (e2e fake bridges on http stay on localStorage)', () => {
  assert.equal(isNativeStoreHost({ location: { protocol: 'shizi-resource:' } }), true);
  assert.equal(isNativeStoreHost({ location: { protocol: 'http:' } }), false);
  assert.equal(isNativeStoreHost({ location: { protocol: 'https:' }, webkit: { messageHandlers: { shiziNative: {} } } }), false);
  assert.equal(isNativeStoreHost(null), false);
});

test('parseResponse: ok → object; {ok:false} → NativeStoreError(code); non-200 / non-JSON → E_TRANSPORT (uncertain)', () => {
  assert.deepEqual(parseResponse('ping', 200, '{"ok":true,"schema":1}'), { ok: true, schema: 1 });
  assert.throws(() => parseResponse('apply', 200, '{"ok":false,"error":{"code":"E_FULL","message":"disk"}}'), e => e instanceof NativeStoreError && e.code === 'E_FULL' && !e.uncertain);
  assert.throws(() => parseResponse('apply', 500, ''), e => e.code === 'E_TRANSPORT' && e.uncertain);
  assert.throws(() => parseResponse('apply', 200, '<html>'), e => e.code === 'E_TRANSPORT');
  assert.throws(() => parseResponse('apply', 200, '{"ok":false,"error":{"code":"E_TIMEOUT"}}'), e => e.code === 'E_TIMEOUT' && e.uncertain);
});

// ---------------------------------------------------------------- 事务后端：写入语义与耐久性

test('durability: commit ok ⇒ already in the database (one native transaction, no txn log); a restart sees it', () => {
  const { db, storage, store } = seededNative();
  const applies = db.calls.filter(op => op === 'apply').length;
  const r = store.commit('judge', judgeMutation('大'));
  assert.equal(r.ok, true);
  assert.equal(db.calls.filter(op => op === 'apply').length, applies + 1, 'exactly one native transaction per commit');
  assert.equal(db.getItem(KEYS.txn), null, 'no shizi.v2.txn on the native backend');
  for (const key of r.keys) assert.equal(db.getItem(key), storage.read(key), `${key}: disk == mirror`);
  assert.equal(db.getItem(recordsKey('2026-10')), JSON.stringify(store.getState().records['2026-10']), 'on disk at return time');
  // 「杀进程」：直接从同一个库重新启动
  const again = nativeEnv(db);
  assert.deepEqual(plain(again.store.getState()), plain(store.getState()));
});

test('failure ⇒ nothing changed: disk byte-equal, memory not published (quota, io, verify)', () => {
  for (const [verdict, kind] of [['quota', 'quota'], ['generic', 'unknown'], [{ corrupt: '{}' }, 'verify']]) {
    const { db, store } = seededNative();
    const disk = db.snapshot();
    const before = store.getState();
    db.failWhen(({ key }) => (key === inkRecordKey('2026-10', 'r4') ? verdict : null));
    const r = store.commit('judge', judgeMutation('大'), { reclaim: false });
    db.failWhen(null);
    assert.equal(r.ok, false, JSON.stringify(verdict));
    assert.equal(r.error.kind, kind);
    assert.equal(store.getState(), before);
    assert.deepEqual(db.snapshot(), disk, 'transaction rolled back as a whole');
    assert.equal(store.commit('judge', judgeMutation('大')).ok, true, 'next commit works');
  }
});

test('checksum mismatch on arrival (transport damage) → E_VERIFY → kind verify, disk unchanged', () => {
  const { db, storage, store } = seededNative();
  const disk = db.snapshot();
  const t = db.transport();
  const backend = storage.backend;
  // 模拟传输途中值被改：校验和是原值的，到「原生」时值已变
  backend._transport = { callSync: (op, payload) => t.callSync(op, op === 'apply' ? { ops: payload.ops.map(([k, v, s]) => [k, v === null ? null : v + ' ', s]) } : payload) };
  const r = store.commit('judge', judgeMutation('大'));
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'verify');
  assert.deepEqual(db.snapshot(), disk);
});

test('outcome unknown before the native side even saw it (transport error) → blocked; restart shows pre-state', () => {
  const { db, store } = seededNative();
  const pre = plain(store.getState());
  db.failOp('apply', 'E_TRANSPORT');
  const r = store.commit('judge', judgeMutation('大'));
  assert.equal(r.error.kind, 'blocked');
  assert.equal(store.status.blocked.reason, 'uncertain');
  assert.deepEqual(plain(nativeEnv(db).store.getState()), pre);
});

test('route hint on the native backend: one transaction, failures silent and never block', () => {
  const { db, storage, store } = seededNative();
  assert.deepEqual(storage.writeRoute('{"v":1,"at":1,"stack":[]}'), { ok: true, written: true });
  assert.equal(db.getItem(KEYS.route), '{"v":1,"at":1,"stack":[]}');
  db.failOp('apply', 'E_TIMEOUT');
  assert.deepEqual(storage.writeRoute('{"v":1,"at":2,"stack":[]}'), { ok: false, kind: 'unknown' });
  assert.equal(store.status.blocked, null, 'a lost route hint does not block');
  assert.equal(store.commit('judge', judgeMutation('大')).ok, true);
});

test('removeKeys and quarantine on the native backend go through native transactions', () => {
  const db = new FakeNativeDb();
  db.setItem(KEYS.settings, '{"appearance":"neon"}');
  db.setItem('shizi.corrupt.x', '1');
  db.setItem('shizi.corrupt.y', '2');
  const { storage, store } = nativeEnv(db);
  assert.deepEqual(store.status.corruptNotice.keys, [KEYS.settings]);
  assert.equal(db.getItem(KEYS.settings), null);
  assert.equal(db.getItem(`shizi.corrupt.${KEYS.settings}`), '{"appearance":"neon"}');
  const before = db.calls.filter(op => op === 'apply').length;
  storage.removeKeys(['shizi.corrupt.x', 'shizi.corrupt.y', 'shizi.corrupt.missing']);
  assert.equal(db.calls.filter(op => op === 'apply').length, before + 1, 'one transaction');
  assert.equal(db.getItem('shizi.corrupt.x'), null);
  assert.equal(db.getItem('shizi.corrupt.y'), null);
});

test('test hooks write log records native batches entry by entry, via storage', () => {
  const db = new FakeNativeDb();
  const storage = createStorage(db.open(), { now: clock });
  const store = createStore({ storage, now: clock });
  const win = { location: { search: '?test=1', hostname: 'localhost' } };
  const api = mountTestHooks({ win, storage, getStore: () => store });
  store.load();
  assert.equal(store.seed(baselineState()).ok, true);
  const log = api.getWriteLog();
  assert.ok(log.length >= 5);
  assert.ok(log.every(e => e.via === 'storage' && e.ok));
  assert.ok(log.some(e => e.key === KEYS.sessions && e.op === 'set'));
  assert.equal(api.getStatus().backend.kind, 'native');
});

// ---------------------------------------------------------------- 预算（原生口径）

test('native budgets: same UTF-16 estimate, larger numbers; warning only near 80% of the native quota', () => {
  assert.equal(NATIVE_BUDGETS.quotaBytes, 64 * 1024 * 1024);
  assert.equal(NATIVE_BUDGETS.warnRatio, BUDGET_DEFAULTS.warnRatio);
  assert.ok(NATIVE_BUDGETS.inkBudgetBytes > BUDGET_DEFAULTS.inkBudgetBytes * 10);
  assert.ok(NATIVE_BUDGETS.recordsBudgetBytes > BUDGET_DEFAULTS.recordsBudgetBytes * 10);
  const db = new FakeNativeDb();
  const storage = createStorage(db.open(), { now: clock });
  const store = createStore({ storage, now: clock, budgets: NATIVE_BUDGETS });
  store.load();
  assert.equal(store.seed(baselineState()).ok, true);
  assert.equal(storagePressureOf(store.status.usage), null);
  // 5MiB（localStorage 的假定配额）在原生口径下远没到预警线
  const usage = { total: 5 * 1024 * 1024, ratio: (5 * 1024 * 1024) / NATIVE_BUDGETS.quotaBytes, level: 'ok' };
  assert.equal(storagePressureOf(usage), null);
  assert.deepEqual(storagePressureOf({ level: 'warn', ratio: 0.85 }), { level: 'warn', ratio: 0.85 });
});

// ---------------------------------------------------------------- 迁移

test('web / e2e (not the iOS scheme): prepareStorage keeps localStorage and never calls native', async () => {
  const r = await prepareStorage({ win: { location: { protocol: 'http:' } } });
  assert.equal(r.kind, 'localStorage');
  assert.equal(r.backend, null);
  assert.equal(r.info.action, 'web');
});

test('first launch of the new version: everything is copied, verified key by key, marked done; localStorage untouched except the marker', async () => {
  const { ls, state } = legacyLocal();
  const before = ls.snapshot();
  const db = fresh();
  const r = await prepareStorage({ transport: db.transport(), localBackend: ls });
  assert.equal(r.kind, 'native', JSON.stringify(r.info));
  assert.equal(r.info.action, 'migrated');
  assert.equal(r.info.migration.state, 'done');
  assert.equal(db.migration.state, 'done');
  const expected = shiziRows(ls);
  assert.deepEqual(db.snapshot(), expected, 'native rows == localStorage shizi.* rows, byte for byte');
  assert.ok(expected['shizi.memory.v1'] && expected[KEYS.route] && expected['shizi.corrupt.shizi.v2.custom'], 'v1 keys, route hint and quarantined values are kept too');
  assert.equal(db.getItem(NATIVE_SMOKE_KEY), null, 'smoke key is not migrated');
  assert.equal(db.getItem('other.app.key'), null, 'foreign keys are not migrated');
  assert.equal(r.info.migration.count, Object.keys(expected).length);
  const after = ls.snapshot();
  assert.ok(after[NATIVE_STORE_MARKER_KEY], 'marker written into localStorage');
  delete after[NATIVE_STORE_MARKER_KEY];
  assert.deepEqual(after, before, 'old data kept as is (one version cycle)');
  // store 从原生起来：状态与旧版一字不差
  const storage = createStorage(r.backend, { now: clock });
  const store = createStore({ storage, now: clock, budgets: r.budgets, backendInfo: r.info });
  store.load();
  assert.deepEqual(plain(store.getState()), state);
  assert.equal(store.status.backend.kind, 'native');
  assert.equal(store.status.backend.action, 'migrated');
});

test('fresh install: empty localStorage migrates as 0 rows and goes native', async () => {
  const db = fresh();
  const r = await prepareStorage({ transport: db.transport(), localBackend: new MemoryStorage() });
  assert.equal(r.kind, 'native');
  assert.equal(db.migration.state, 'done');
  assert.equal(db.migration.count, 0);
});

test('already migrated: only one load; localStorage is not read at all', async () => {
  const db = new FakeNativeDb({ initial: { [KEYS.settings]: '{"sound":true}' } });
  const ls = new MemoryStorage();
  let touched = 0;
  const spy = new Proxy(ls, { get(target, prop) { touched += 1; const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; } });
  const r = await prepareStorage({ transport: db.transport(), localBackend: spy });
  assert.equal(r.kind, 'native');
  assert.equal(r.info.action, 'none');
  assert.deepEqual(db.calls, ['load']);
  assert.equal(touched, 0);
  assert.equal(r.backend.getItem(KEYS.settings), '{"sound":true}');
});

test('a half-written localStorage commit (txn present) is rolled back before copying', async () => {
  const ls = new MemoryStorage();
  const storage = createStorage(ls, { now: clock });
  const store = createStore({ storage, now: clock });
  store.load();
  assert.equal(store.seed(baselineState()).ok, true);
  const pre = plain(store.getState());
  storage.interruptAfterWrite(3); // txn + 2 个数据键后「断电」
  store.commit('judge', judgeMutation('大'));
  assert.ok(ls.getItem(KEYS.txn), 'txn left behind');
  ls.resume();
  const db = fresh();
  const r = await prepareStorage({ transport: db.transport(), localBackend: ls });
  assert.equal(r.kind, 'native');
  assert.equal(r.info.repair.txn, 'rolled-back');
  assert.equal(db.getItem(KEYS.txn), null);
  const s2 = createStore({ storage: createStorage(r.backend, { now: clock }), now: clock });
  s2.load();
  assert.deepEqual(plain(s2.getState()), pre, 'native gets the pre-commit state, as the old version would have');
});

test('localStorage that is full (writes fail) still migrates; only the marker is missing', async () => {
  const { ls } = legacyLocal();
  ls.failWhen(({ op }) => (op === 'set' ? 'quota' : null));
  const db = fresh();
  const r = await prepareStorage({ transport: db.transport(), localBackend: ls });
  assert.equal(r.kind, 'native', JSON.stringify(r.info));
  assert.equal(r.info.markerWritten, false);
  assert.equal(db.migration.state, 'done');
});

test('re-entrant: killed during import, or after import before commit → this launch stays on localStorage; next launch migrates from scratch', async () => {
  for (const [op, code] of [['import', 'E_TRANSPORT'], ['commitMigration', 'E_IO']]) {
    const { ls } = legacyLocal();
    const db = fresh();
    db.failOp(op, code);
    const first = await prepareStorage({ transport: db.transport(), localBackend: ls });
    assert.equal(first.kind, 'localStorage', op);
    assert.equal(first.info.action, 'fallback');
    assert.equal(first.info.fallback.stage, op === 'import' ? 'import' : 'commit');
    assert.notEqual(db.migration && db.migration.state, 'done');
    assert.ok(db.diag.some(d => d.kind === 'migration-failed'), 'diagnostic recorded in the native db');
    // 回退期间旧路径照常写 localStorage
    const lsStore = createStore({ storage: createStorage(ls, { now: clock }), now: clock });
    lsStore.load();
    assert.equal(lsStore.commit('judge', judgeMutation('天')).ok, true);
    const second = await prepareStorage({ transport: db.transport(), localBackend: ls });
    assert.equal(second.kind, 'native', op);
    assert.equal(db.migration.state, 'done');
    assert.deepEqual(db.snapshot(), shiziRows(ls), 'includes what was written during the fallback launch');
  }
});

test('verification failure (native stored something else) → fallback to localStorage, diag recorded, nothing lost', async () => {
  const { ls } = legacyLocal();
  const before = ls.snapshot();
  const db = fresh();
  db.failWhen(({ key }) => (key === KEYS.sched ? { corrupt: '{}' } : null));
  const r = await prepareStorage({ transport: db.transport(), localBackend: ls });
  assert.equal(r.kind, 'localStorage');
  assert.equal(r.info.fallback.code, 'E_VERIFY');
  assert.notEqual(db.migration && db.migration.state, 'done');
  const after = ls.snapshot();
  delete after[NATIVE_STORE_MARKER_KEY];
  assert.deepEqual(after, before);
  // JS 侧核对：库回报 imported，但读回的值与源不同
  const db2 = fresh();
  const t = db2.transport();
  const tampering = {
    callSync: t.callSync,
    async callAsync(op, payload) {
      const res = await t.callAsync(op, payload);
      if (op === 'load' && res.migration && res.migration.state === 'imported') res.rows = res.rows.map(([k, v]) => [k, k === KEYS.sched ? v + ' ' : v]);
      return res;
    },
  };
  const r2 = await prepareStorage({ transport: tampering, localBackend: legacyLocal().ls });
  assert.equal(r2.kind, 'localStorage');
  assert.equal(r2.info.fallback.stage, 'verify');
  assert.equal(r2.info.fallback.key, KEYS.sched);
  assert.equal(db2.migration.state, 'imported', 'never marked done');
});

test('sync channel unavailable → no import attempted, localStorage kept', async () => {
  const db = fresh();
  const t = db.transport();
  const noSync = { callSync() { throw new NativeStoreError('E_TRANSPORT', 'sync XHR not supported'); }, callAsync: t.callAsync };
  const r = await prepareStorage({ transport: noSync, localBackend: legacyLocal().ls });
  assert.equal(r.kind, 'localStorage');
  assert.equal(r.info.fallback.stage, 'sync-channel');
  assert.ok(db.calls.indexOf('import') < 0);
});

test('native load fails: without marker → localStorage; with marker (already migrated) → unavailable (R-B09), never the stale localStorage', async () => {
  const db = new FakeNativeDb().failReads('io');
  const ls = new MemoryStorage();
  const r1 = await prepareStorage({ transport: db.transport(), localBackend: ls });
  assert.equal(r1.kind, 'localStorage');
  assert.equal(r1.info.fallback.stage, 'load');
  ls.setItem(NATIVE_STORE_MARKER_KEY, '{"v":1}');
  const r2 = await prepareStorage({ transport: db.transport(), localBackend: ls });
  assert.equal(r2.kind, 'native');
  assert.equal(r2.info.action, 'unavailable');
  const store = createStore({ storage: createStorage(r2.backend, { now: clock }), now: clock });
  const report = store.load();
  assert.equal(report.available, false);
  assert.equal(store.commit('x', draft => { draft.settings = { sound: true }; }).error.kind, 'unavailable');
});

test('commitMigration outcome unknown: ping says done → native; ping impossible → unavailable (no double writes)', async () => {
  const db = fresh();
  db.failOp('commitMigration', 'E_TIMEOUT', { after: true });
  const r = await prepareStorage({ transport: db.transport(), localBackend: legacyLocal().ls });
  assert.equal(r.kind, 'native');
  assert.equal(r.info.action, 'migrated');
  const db2 = fresh();
  const t = db2.transport();
  let pings = 0;
  const flaky = {
    callSync(op, payload) {
      if (op === 'ping' && (pings += 1) > 1) throw new NativeStoreError('E_TRANSPORT', 'gone');
      return t.callSync(op, payload);
    },
    async callAsync(op, payload) {
      if (op === 'commitMigration') throw new NativeStoreError('E_TIMEOUT', 'late');
      return t.callAsync(op, payload);
    },
  };
  const r2 = await prepareStorage({ transport: flaky, localBackend: legacyLocal().ls });
  assert.equal(r2.kind, 'native');
  assert.equal(r2.info.action, 'unavailable');
});

test('a database that is already done refuses another import (old localStorage can never overwrite newer native data)', () => {
  const db = new FakeNativeDb();
  const res = db.handle('import', { rows: [], count: 0, digest: '0:0:811c9dc5' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'E_MIGRATION');
});

// ---------------------------------------------------------------- 备份往返

test('backup round trip on the native store: export → restore writes SQLite, every whitelisted key byte-equal', () => {
  const src = seededNative();
  assert.equal(src.store.commit('judge', judgeMutation('大')).ok, true);
  const text = serializeBackup(buildBackupV2(src.store.getState(), { now: NOW, serial: src.store.serial }));
  const dst = nativeEnv();
  assert.equal(dst.store.seed({ meta: { schema: 2, serial: 0, createdAt: NOW, months: [] } }).ok, true);
  const report = inspectBackup(text);
  assert.equal(report.ok, true);
  const r = restoreFromBackup(dst.store, report, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(dst.db.getItem(KEYS.safety), 'protection copy written to the database');
  assert.equal(dropSafety(dst.store).ok, true);
  for (const key of Object.keys(JSON.parse(text).data)) {
    if (key === KEYS.backupMeta) continue;
    assert.equal(dst.db.getItem(key), src.db.getItem(key), key);
  }
  // 重启后从库里读出同样的记录
  const again = nativeEnv(dst.db);
  assert.deepEqual(plain(again.store.getState().records), plain(src.store.getState().records));
});

test('an old backup file (made by the localStorage version) restores into the native store unchanged', () => {
  const { state } = legacyLocal();
  const oldFile = serializeBackup(buildBackupV2(state, { now: NOW, serial: 4 }));
  const dst = nativeEnv();
  const report = inspectBackup(oldFile);
  assert.equal(report.ok, true);
  assert.equal(restoreFromBackup(dst.store, report, { now: NOW }).ok, true);
  assert.deepEqual(plain(dst.store.getState().records), state.records);
  assert.deepEqual(plain(dst.store.getState().ink), state.ink);
  assert.deepEqual(plain(dst.store.getState().sched), state.sched);
});

// B4.5c：原生 SwiftEngine（DEBUG -shizi-engine swift）与页面写同一个库——另一个写入者写完，页面镜像 reloadRows + store.reload 后读到它写的。
test('NativeBackend.reloadRows：另一个写入者写库之后，镜像与 store 重读到库里现在的内容', () => {
  const db = new FakeNativeDb();
  const a = nativeEnv(db);
  assert.equal(a.store.seed(baselineState()).ok, true);
  // 另一个写入者（同一个库、自己的镜像）提交一次判断
  const b = nativeEnv(db);
  assert.equal(b.store.commit('judge', judgeMutation('大')).ok, true);
  assert.notDeepEqual(plain(a.store.getState().records), plain(b.store.getState().records));
  a.storage.backend.reloadRows();
  a.store.reload();
  assert.deepEqual(plain(a.store.getState()), plain(b.store.getState()));
  // 之后 a 自己的提交基于重读后的状态（不会把 b 写的覆盖掉）
  assert.equal(a.store.commit('judge', judgeMutation('小')).ok, true);
  const c = nativeEnv(db);
  assert.deepEqual(plain(c.store.getState()), plain(a.store.getState()));
});
