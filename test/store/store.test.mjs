// store/store.js：commit 事务语义、写失败不发布、中断矩阵、坏值隔离提示一次、配额回收重试、seed、备份整单拒绝。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, deleteInk, deriveSerial, getInk, setInk } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { KEYS, inkKey, recordsKey } from '../../src/core/schema.js';
import {
  MemoryStorage, T0, allRecordIds, baselineState, flatInk, inkEntry, judgeMutation, plain, record,
} from './helpers.mjs';

const NOW = Date.parse('2026-10-02T10:00:00+08:00');
const clock = () => NOW;

function freshStore(backend = new MemoryStorage(), options = {}) {
  const storage = createStorage(backend, { now: clock });
  const store = createStore(Object.assign({ storage, now: clock }, options));
  store.load();
  return { store, storage, backend };
}

function seeded(options = {}) {
  const env = freshStore(options.backend, options.store);
  const r = env.store.seed(baselineState());
  assert.equal(r.ok, true, JSON.stringify(r));
  return env;
}

test('commit success: publishes new frozen state, notifies subscribers, allocates ids from derived serial', () => {
  const { store, backend } = seeded();
  assert.equal(store.serial, 3);
  const seen = [];
  store.subscribe((state, info) => seen.push(info));
  const before = store.getState();
  const order = [];
  backend.failWhen(({ op, key }) => {
    if (op === 'set' && key !== KEYS.txn) order.push(key);
    return null;
  });
  const r = store.commit('judge', judgeMutation('大'));
  backend.failWhen(null);
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = store.getState();
  assert.notEqual(after, before);
  assert.equal(after.records['2026-10'][0].id, 'r4');
  assert.equal(after.meta.serial, 4);
  assert.deepEqual(after.meta.months, ['2026-09', '2026-10'], 'meta.months follows records keys');
  assert.ok(Object.isFrozen(after.records['2026-10'][0]));
  assert.equal(before.records['2026-10'], undefined, 'previous state object untouched');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'commit');
  assert.ok(r.keys.indexOf(KEYS.sessions) === r.keys.length - 1, 'sessions written last');
  assert.equal(backend.getItem(KEYS.txn), null);
  assert.deepEqual(JSON.parse(backend.getItem(recordsKey('2026-10'))), plain(after.records['2026-10']));
  // 墨迹按记录月份分键（F3）：本次只新写 ink.2026-10，ink.2026-09 不动也不进 txn。
  assert.ok(r.keys.includes(inkKey('2026-10')), 'new record ink goes to its own month key');
  assert.ok(!r.keys.includes(inkKey('2026-09')), 'other ink months untouched');
  assert.ok(order.indexOf(inkKey('2026-10')) >= 0 && order.indexOf(inkKey('2026-10')) < order.indexOf(recordsKey('2026-10')), 'ink month written before records month');
  assert.equal(order[order.length - 1], KEYS.sessions, 'sessions is the last data key written');
  assert.equal(backend.getItem('shizi.v2.ink'), null, 'no single ink key any more');
  assert.deepEqual(Object.keys(JSON.parse(backend.getItem(inkKey('2026-10')))), ['r4']);
  assert.deepEqual(store.getInk(after.records['2026-10'][0]), inkEntry());
});

test('ink helpers: getInk / setInk / deleteInk address shizi.v2.ink.<record month>; txn only carries touched months', () => {
  const { store, storage, backend } = seeded();
  const r2 = store.getState().records['2026-09'][0];
  assert.deepEqual(getInk(store.getState(), r2), inkEntry(), 'baseline r2 ink lives in 2026-09');
  assert.equal(getInk(store.getState(), store.getState().records['2026-09'][1]), null, 'r3 has no ink (10.12)');
  assert.equal(getInk(store.getState(), Object.assign({}, r2, { inkId: 'r3' })), null, 'inkId wins over id');
  // 抓 txn：它只应包含本次动到的月键
  let txnSeen = null;
  const origWriteAll = storage.writeAll;
  storage.writeAll = (entries, opts) => {
    txnSeen = entries.map(([key]) => key);
    return origWriteAll(entries, opts);
  };
  const r3 = store.getState().records['2026-09'][1];
  const r = store.commit('ink r3', draft => {
    assert.deepEqual(setInk(draft, r3, inkEntry(4, 2)), { month: '2026-09', id: 'r3' });
  });
  storage.writeAll = origWriteAll;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(txnSeen, [inkKey('2026-09')]);
  assert.deepEqual(Object.keys(JSON.parse(backend.getItem(inkKey('2026-09')))).sort(), ['r2', 'r3']);
  assert.ok(Object.isFrozen(store.getState().ink['2026-09']));
  // 删光一个月 → 月键移除
  const del = store.commit('drop ink', draft => {
    assert.equal(deleteInk(draft, r2), true);
    assert.equal(deleteInk(draft, r2), false, 'already gone');
    setInk(draft, r3, null);
  });
  assert.equal(del.ok, true);
  assert.equal(backend.getItem(inkKey('2026-09')), null, 'empty month key removed');
  assert.deepEqual(store.getState().ink, {});
  const bad = store.commit('no month', draft => setInk(draft, { id: 'r9' }, inkEntry()));
  assert.equal(bad.error.kind, 'mutator');
  const badMonth = store.commit('bad month', draft => {
    draft.ink['2026-9'] = { r2: inkEntry() };
  });
  assert.equal(badMonth.error.kind, 'shape');
});

test('write failure does not publish: in-memory state and storage stay as before; retry succeeds without double count', () => {
  const { store, storage, backend } = seeded();
  const beforeState = store.getState();
  const beforeDisk = backend.snapshot();
  let calls = 0;
  store.subscribe(() => (calls += 1));
  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.sched });
  const r = store.commit('judge', judgeMutation('大'));
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'unknown');
  assert.equal(r.error.key, KEYS.sched);
  assert.equal(store.getState(), beforeState, 'same object: nothing published');
  assert.equal(calls, 0);
  assert.deepEqual(backend.snapshot(), beforeDisk);
  const retry = store.commit('judge', judgeMutation('大'));
  assert.equal(retry.ok, true);
  assert.equal(store.getState().records['2026-10'].length, 1, 'retry writes exactly one record');
  assert.equal(store.getState().records['2026-10'][0].id, 'r4', 'failed attempt did not burn a persisted id');
});

test('verify mismatch → rollback → not published', () => {
  const { store, backend } = seeded();
  const beforeDisk = backend.snapshot();
  const beforeState = store.getState();
  let hits = 0;
  backend.failWhen(({ op, key }) => (op === 'set' && key === inkKey('2026-10') && (hits += 1) === 1 ? { corrupt: '{}' } : null));
  const r = store.commit('judge', judgeMutation('大'));
  backend.failWhen(null);
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'verify');
  assert.equal(store.getState(), beforeState);
  assert.deepEqual(backend.snapshot(), beforeDisk);
});

test('mutator mutating frozen state in place is rejected (copy-on-write discipline); shape errors never reach storage', () => {
  const { store, backend } = seeded();
  const beforeDisk = backend.snapshot();
  const r = store.commit('bad', draft => {
    draft.sessions.A.cursor = 5; // A 是已发布的冻结对象
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'mutator');
  const r2 = store.commit('bad-shape', draft => {
    draft.records['2026-09'] = draft.records['2026-09'].concat([{ id: 'r9', nonsense: true }]);
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.error.kind, 'shape');
  assert.equal(r2.error.key, recordsKey('2026-09'));
  const r3 = store.commit('unknown-domain', draft => {
    draft.bogus = 1;
  });
  assert.equal(r3.error.kind, 'shape');
  assert.deepEqual(backend.snapshot(), beforeDisk);
  const noop = store.commit('noop', () => {});
  assert.deepEqual(noop, { ok: true, keys: [], recovered: [] });
});

test('interruptAfterWrite(k) matrix k=1..N: after reload state is exactly pre or post; records unique; ids do not collide', () => {
  // 先量出 N 与写后状态
  const probe = seeded();
  const pre = plain(probe.store.getState());
  const writesBefore = probe.backend.writeCount;
  assert.equal(probe.store.commit('judge', judgeMutation('大')).ok, true);
  const N = probe.backend.writeCount - writesBefore;
  const post = plain(probe.store.getState());
  assert.ok(N >= 5, `commit should touch several keys (N=${N})`);
  const outcomes = [];
  for (let k = 1; k <= N + 1; k += 1) {
    const { store, storage, backend } = seeded();
    storage.interruptAfterWrite(k);
    const r = store.commit('judge', judgeMutation('大'));
    if (k < N) assert.equal(r.ok, false, `k=${k} must not report success`);
    // 「刷新」：同一份 backend，新的 storage/store
    const reloaded = freshStore(backend);
    const state = plain(reloaded.store.getState());
    const isPre = JSON.stringify(sortKeys(state)) === JSON.stringify(sortKeys(pre));
    const isPost = JSON.stringify(sortKeys(state)) === JSON.stringify(sortKeys(post));
    assert.ok(isPre || isPost, `k=${k}: state is neither pre nor post`);
    outcomes.push(isPre ? 'pre' : 'post');
    assert.equal(backend.getItem(KEYS.txn), null, `k=${k}: txn cleared by repair`);
    const ids = allRecordIds(state);
    assert.equal(new Set(ids).size, ids.length, `k=${k}: duplicate record ids`);
    const again = reloaded.store.commit('judge-2', judgeMutation('天'));
    assert.equal(again.ok, true);
    const ids2 = allRecordIds(reloaded.store.getState());
    assert.equal(new Set(ids2).size, ids2.length, `k=${k}: new id collides`);
    assert.equal(reloaded.store.getState().records['2026-10'].filter(rec => rec.char === '大').length, isPost ? 1 : 0, `k=${k}: no double record`);
  }
  assert.equal(outcomes[0], 'pre');
  assert.equal(outcomes[N - 1], 'post', 'interrupt after the final txn removal = committed');
  assert.ok(outcomes.slice(0, N - 1).every(o => o === 'pre'), 'any interruption before txn removal rolls back');
});

test('interruption during repair (double crash) still converges to pre-state', () => {
  const { store, storage, backend } = seeded();
  const pre = plain(store.getState());
  storage.interruptAfterWrite(4); // txn + 3 数据键
  store.commit('judge', judgeMutation('大'));
  const second = createStorage(backend, { now: clock });
  second.interruptAfterWrite(1); // 回滚写了一个键就又「崩溃」
  assert.throws(() => second.repair(), error => error.kind === 'interrupted');
  const third = freshStore(backend);
  assert.deepEqual(sortKeys(plain(third.store.getState())), sortKeys(pre));
});

test('mock-level interruption (backend dies mid-write) is repaired the same way', () => {
  const { store, backend } = seeded();
  const pre = plain(store.getState());
  backend.interruptAfterWrites(3);
  const r = store.commit('judge', judgeMutation('大'));
  assert.equal(r.ok, false);
  backend.resume();
  const reloaded = freshStore(backend);
  assert.equal(reloaded.store.status.lastRepair.txn, 'rolled-back');
  assert.deepEqual(sortKeys(plain(reloaded.store.getState())), sortKeys(pre));
});

test('rollback failure → keys quarantined, store blocked (R-B09), commits refused', () => {
  const { store, backend } = seeded();
  // sched 在写前已存在，回滚要 set 回原值——让这次 set 也失败。
  let schedSets = 0;
  backend.failWhen(({ op, key }) => {
    if (op === 'set' && key === KEYS.sched) return (schedSets += 1) >= 2 ? 'quota' : null;
    if (op === 'set' && key === KEYS.sessions) return 'quota';
    return null;
  });
  const r = store.commit('judge', judgeMutation('大'));
  backend.failWhen(null);
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'blocked');
  assert.ok(store.status.blocked);
  assert.ok(backend.getItem(`shizi.corrupt.${KEYS.sched}`) !== null);
  const again = store.commit('settings', draft => {
    draft.settings = Object.assign({}, draft.settings, { sound: false });
  });
  assert.equal(again.error.kind, 'blocked');
});

test('bad stored values: quarantined at boot, original removed, notice flag set once (not on next boot)', () => {
  const backend = new MemoryStorage();
  backend.setItem(KEYS.settings, '{"appearance":"neon"}');
  backend.setItem(KEYS.sched, 'not json');
  const first = freshStore(backend);
  assert.deepEqual(first.store.status.corruptNotice.keys.sort(), [KEYS.sched, KEYS.settings].sort());
  assert.equal(first.store.getState().settings, null);
  assert.equal(backend.getItem(KEYS.settings), null);
  assert.equal(backend.getItem(`shizi.corrupt.${KEYS.settings}`), '{"appearance":"neon"}');
  first.store.ackCorruptNotice();
  assert.equal(first.store.status.corruptNotice, null);
  first.store.reload(); // 同一次运行里再加载也不会重新置位
  assert.equal(first.store.status.corruptNotice, null);
  const second = freshStore(backend);
  assert.equal(second.store.status.corruptNotice, null, 'next boot: no second notice');
  assert.equal(backend.getItem(`shizi.corrupt.${KEYS.sched}`), 'not json', 'quarantined copy kept for export');
});

test('storage unavailable (SecurityError) → status.available=false, commits refused with kind unavailable', () => {
  const backend = new MemoryStorage().failReads('security');
  const storage = createStorage(backend, { now: clock });
  const store = createStore({ storage, now: clock });
  const report = store.load();
  assert.equal(report.available, false);
  assert.equal(report.kind, 'security');
  const r = store.commit('x', draft => {
    draft.settings = { sound: true };
  });
  assert.equal(r.error.kind, 'unavailable');
});

// ---------------------------------------------------------------- 配额与预算

function inkHeavyState(count) {
  const s = baselineState();
  const months = {};
  const ink = {};
  // 同一个字每个月写一次；只有最近一次受保护
  let serial = 10;
  for (let i = 0; i < count; i += 1) {
    const month = `2026-0${1 + (i % 8)}`;
    const day = `${month}-10`;
    serial += 1;
    const rec = record(serial, '水', { day, at: T0 - (count - i) * 86400000 });
    (months[month] = months[month] || []).push(rec);
    (ink[month] = ink[month] || {})[rec.id] = inkEntry(30, 6);
  }
  for (const m of Object.keys(months)) months[m].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  s.records = Object.assign({}, s.records, months);
  s.records['2026-09'] = s.records['2026-09'].slice();
  s.ink = Object.assign({}, s.ink, ink);
  s.meta = Object.assign({}, s.meta, { serial, months: Object.keys(s.records).sort() });
  return s;
}

test('quota hit → budget recovery (ink by §9 priority) → one retry succeeds; latest-per-char ink kept', () => {
  const state = inkHeavyState(24);
  const probeEnv = freshStore();
  assert.equal(probeEnv.store.seed(state).ok, true);
  // 先在不限额的副本上量出这次提交的峰值占用，再把配额设在峰值之下 1 字节：
  // txn（含 prev 副本）写得下，但后面数据键变大那一步撞配额。
  const dry = probeEnv.backend.clone();
  let peak = 0;
  dry.failWhen(({ op, key, value }) => {
    if (op === 'set') {
      const cur = dry.getItem(key);
      peak = Math.max(peak, dry.usedBytes() - (cur === null ? 0 : (key.length + cur.length) * 2) + (key.length + value.length) * 2);
    }
    return null;
  });
  const dryEnv = freshStore(dry);
  assert.equal(dryEnv.store.commit('judge', judgeMutation('大')).ok, true);
  const quota = peak - 1;
  const backend = probeEnv.backend.clone();
  backend.quotaBytes = quota;
  const { store } = freshStore(backend);
  const latestWater = allRecordIds(store.getState()).filter(id => Number(id.slice(1)) === 34)[0];
  assert.ok(latestWater, 'fixture has r34 as the latest 水');
  let quotaErrors = 0;
  backend.failWhen(({ op, key, value }) => {
    if (op !== 'set') return null;
    const cur = backend.getItem(key);
    const next = backend.usedBytes() - (cur === null ? 0 : (key.length + cur.length) * 2) + (key.length + value.length) * 2;
    if (next > quota) quotaErrors += 1;
    return null; // 真正的配额判断由 MemoryStorage 自己做；这里只计数
  });
  const r = store.commit('judge', judgeMutation('大'));
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(quotaErrors >= 1, 'first attempt really hit the quota');
  assert.ok(r.recovered.some(a => a.type === 'evictInk'), 'recovery evicted ink');
  const ink = flatInk(store.getState().ink);
  assert.ok(ink[latestWater], 'latest judged ink of 水 is never evicted');
  const newId = store.getState().records['2026-10'][0].id;
  assert.equal(newId, 'r35');
  assert.ok(ink[newId], 'the ink written by this commit is kept');
  assert.ok(Object.keys(ink).length < 26, 'older ink was evicted');
  assert.ok(ink.r2, 'latest ink of 人 kept');
  assert.ok(backend.usedBytes() <= quota);
  // 被淘汰的墨迹在旧月键里：它们以单独的小事务先写（不进本次 txn），内存与磁盘一致。
  const reloaded = freshStore(backend.clone());
  assert.deepEqual(plain(reloaded.store.getState()), plain(store.getState()), 'disk == memory after side recovery');
});

test('quota side recovery: evicted old ink months are persisted even if the retried commit still fails', () => {
  const state = inkHeavyState(24);
  const backend = new MemoryStorage();
  const { store } = freshStore(backend);
  assert.equal(store.seed(state).ok, true);
  const before = flatInk(store.getState().ink);
  backend.quotaBytes = backend.usedBytes() + 2000; // txn 写得下，本次提交的大值写不下：旁路回收能写，重试仍失败
  let seen = null;
  store.subscribe((s, info) => {
    if (info.type === 'recover') seen = info;
  });
  const r = store.commit('huge', draft => {
    draft.settings = Object.assign({}, draft.settings, { library: 'x'.repeat(200000) });
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'quota');
  const after = flatInk(store.getState().ink);
  assert.ok(Object.keys(after).length < Object.keys(before).length, 'some old ink evicted');
  assert.ok(seen && seen.keys.every(key => key.indexOf('shizi.v2.ink.') === 0 || key.indexOf('shizi.v2.records.') === 0), 'recover notice lists month keys');
  assert.ok(after.r34 && after.r2, 'latest-per-char kept');
  assert.equal(store.getState().settings.library, 'common', 'the failed commit itself is not published');
  const reloaded = freshStore(backend.clone());
  assert.deepEqual(plain(reloaded.store.getState()), plain(store.getState()), 'disk == memory');
});

test('quota hit with nothing recoverable → {ok:false, kind:quota}, nothing published', () => {
  const backend = new MemoryStorage();
  const { store } = freshStore(backend);
  assert.equal(store.seed(baselineState()).ok, true);
  backend.quotaBytes = backend.usedBytes() + 50;
  const before = store.getState();
  const r = store.commit('big', draft => {
    draft.settings = Object.assign({}, draft.settings, { library: 'x'.repeat(4000) });
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'quota');
  assert.equal(store.getState(), before);
});

test('pre-write estimate over budget → recover first (ink budget), then write', () => {
  const state = inkHeavyState(24);
  const { store } = freshStore(new MemoryStorage(), { budgets: { inkBudgetBytes: 20000 } });
  assert.equal(store.seed(state).ok, true, 'seed does not recover');
  const r = store.commit('judge', judgeMutation('大'));
  assert.equal(r.ok, true);
  assert.ok(r.recovered.length > 0);
  const inkState = store.getState().ink;
  const inkTotal = Object.keys(inkState).reduce((n, m) => n + (inkKey(m).length + JSON.stringify(inkState[m]).length) * 2, 0);
  assert.ok(inkTotal <= 20000 || Object.keys(flatInk(inkState)).length <= 3, 'ink within budget (all month keys) or only protected entries left');
  assert.ok(flatInk(inkState).r34, 'latest 水 kept');
});

test('pre-write: months older than 400 days are folded (P28); current month never folded', () => {
  const s = baselineState();
  s.records['2025-01'] = [record(1, '山', { day: '2025-01-05', session: 1 })];
  s.meta = Object.assign({}, s.meta, { months: ['2025-01', '2026-09'] });
  const { store } = freshStore();
  assert.equal(store.seed(s).ok, true);
  const r = store.commit('judge', judgeMutation('大'));
  assert.equal(r.ok, true);
  const folded = store.getState().records['2025-01'];
  assert.equal(folded.folded, true);
  assert.deepEqual(folded.chars, ['山']);
  assert.equal(folded.kept.length, 1, '山 has no later record, so its latest judged record is kept');
  assert.ok(Array.isArray(store.getState().records['2026-10']));
});

test('usage estimate is refreshed and exposed on status', () => {
  const { store, backend } = seeded();
  const usage = store.status.usage;
  assert.equal(usage.total, backend.usedBytes());
  assert.equal(usage.level, 'ok');
});

// ---------------------------------------------------------------- seed / 备份

test('seed replaces every v2 domain (missing domains deleted) and validates shapes first', () => {
  const { store, backend } = seeded();
  const bad = baselineState();
  bad.sched = { 'base:人': { fsrs: null } };
  const snapshot = backend.snapshot();
  const r = store.seed(bad);
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'shape');
  assert.deepEqual(backend.snapshot(), snapshot, 'nothing written');
  const minimal = { meta: { schema: 2, serial: 0, createdAt: T0, months: [] } };
  assert.equal(store.seed(minimal).ok, true);
  assert.equal(backend.getItem(KEYS.sched), null);
  assert.equal(backend.getItem(recordsKey('2026-09')), null);
  assert.equal(store.getState().sessions, null);
  assert.equal(store.seed({ nope: 1 }).ok, false);
});

function backupFrom(state) {
  const data = {};
  for (const [domain, key] of [['meta', KEYS.meta], ['sched', KEYS.sched], ['custom', KEYS.custom], ['settings', KEYS.settings], ['backupMeta', KEYS.backupMeta]]) {
    if (state[domain] !== null) data[key] = JSON.stringify(state[domain]);
  }
  for (const m of Object.keys(state.records)) data[recordsKey(m)] = JSON.stringify(state.records[m]);
  for (const m of Object.keys(state.ink || {})) data[inkKey(m)] = JSON.stringify(state.ink[m]);
  return { app: 'shizi', version: 2, date: '2026-09-01T00:00:00.000Z', data };
}

test('backup v2: any bad key → whole file rejected and writeAll never called', () => {
  const { store, storage, backend } = seeded();
  const good = backupFrom(baselineState());
  let writeAllCalls = 0;
  const original = storage.writeAll;
  storage.writeAll = (...args) => {
    writeAllCalls += 1;
    return original(...args);
  };
  const snapshot = backend.snapshot();
  for (const key of Object.keys(good.data)) {
    const broken = plain(good);
    broken.data[key] = key === KEYS.meta ? '{"schema":1}' : '{"x":[1,2,{"bad":true}]}';
    const r = store.replaceWithBackup(broken);
    assert.equal(r.ok, false, key);
    assert.equal(r.error.kind, 'invalid');
    assert.equal(r.error.key, key);
  }
  assert.equal(writeAllCalls, 0, 'writeAll must not be called for a rejected backup');
  assert.deepEqual(backend.snapshot(), snapshot);
  storage.writeAll = original;
});

test('backup v2: good file replaces whitelisted keys, leaves sessions alone, clears shizi.corrupt.*', () => {
  const { store, backend } = seeded();
  backend.setItem('shizi.corrupt.shizi.v2.sched', 'junk');
  const other = baselineState();
  other.records = { '2026-08': [record(7, '火', { day: '2026-08-02' })] };
  other.meta = Object.assign({}, other.meta, { serial: 7, months: ['2026-08'] });
  other.ink = { '2026-08': { r7: inkEntry() } };
  const sessionsBefore = backend.getItem(KEYS.sessions);
  const r = store.replaceWithBackup(backupFrom(other));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(backend.getItem(recordsKey('2026-09')), null, 'month absent from backup removed');
  assert.equal(backend.getItem(inkKey('2026-09')), null, 'ink month absent from backup removed');
  assert.ok(backend.getItem(inkKey('2026-08')), 'ink month from backup written');
  assert.deepEqual(store.getInk(store.getState().records['2026-08'][0]), inkEntry());
  assert.ok(backend.getItem(recordsKey('2026-08')));
  assert.equal(backend.getItem(KEYS.sessions), sessionsBefore);
  assert.equal(backend.getItem('shizi.corrupt.shizi.v2.sched'), null);
  assert.ok(store.serial >= 7);
});

test('deriveSerial takes the max over meta.serial, records (incl. folded kept), sessions and ink ids', () => {
  const s = baselineState();
  s.meta.serial = 1;
  s.records['2025-01'] = { folded: true, month: '2025-01', byDay: {}, chars: [], kept: [record(40, '山', { day: '2025-01-02' })] };
  assert.equal(deriveSerial(s), 40);
  s.ink['2026-09'].r77 = inkEntry();
  assert.equal(deriveSerial(s), 77);
  s.sessions.lastEnded = { B: Object.assign(plain(s.sessions.A), { id: 's90', slot: 'B', kind: 'picked' }) };
  assert.equal(deriveSerial(s), 90);
});

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}
