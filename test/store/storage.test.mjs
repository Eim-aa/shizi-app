// store/storage.js：事务写、固定顺序、逐键核对、回滚、回滚失败隔离与阻断、配额分类、启动修复。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BlockingStorageError, StorageWriteError, classifyStorageError, createStorage, writeRank,
} from '../../src/store/storage.js';
import { KEYS, inkKey, recordsKey } from '../../src/core/schema.js';
import { MemoryStorage, makeError, baselineState, plain } from './helpers.mjs';

function seedBackend(state = baselineState()) {
  const initial = {};
  for (const domain of Object.keys(state)) {
    if (domain === 'records') for (const m of Object.keys(state.records)) initial[recordsKey(m)] = JSON.stringify(state.records[m]);
    else if (domain === 'ink') for (const m of Object.keys(state.ink)) initial[inkKey(m)] = JSON.stringify(state.ink[m]);
    else if (state[domain] !== null) initial[KEYS[domain]] = JSON.stringify(state[domain]);
  }
  return new MemoryStorage({ initial });
}

function traceWrites(backend) {
  const order = [];
  backend.failWhen(({ op, key }) => {
    order.push(`${op}:${key}`);
    return null;
  });
  return order;
}

test('writeAll: txn first, fixed data order (ink.<月> → records.<月> → sched → … → meta → sessions last), txn removed', () => {
  const backend = seedBackend();
  const storage = createStorage(backend, { now: () => 42 });
  const order = traceWrites(backend);
  const s = baselineState();
  const entries = [
    [KEYS.sessions, JSON.stringify(s.sessions)],
    [KEYS.meta, JSON.stringify(Object.assign({}, s.meta, { serial: 9 }))],
    [KEYS.sched, JSON.stringify({})],
    [recordsKey('2026-10'), JSON.stringify([])],
    [recordsKey('2026-08'), JSON.stringify([])],
    [KEYS.settings, JSON.stringify({ sound: false })],
    [inkKey('2026-10'), JSON.stringify({})],
    [inkKey('2026-09'), JSON.stringify({})],
  ];
  // sessions 值不变 → 跳过；其余按固定顺序
  const result = storage.writeAll(entries, { label: 'order' });
  assert.deepEqual(order, [
    `set:${KEYS.txn}`,
    `set:${inkKey('2026-09')}`,
    `set:${inkKey('2026-10')}`,
    `set:${recordsKey('2026-08')}`,
    `set:${recordsKey('2026-10')}`,
    `set:${KEYS.sched}`,
    `set:${KEYS.settings}`,
    `set:${KEYS.meta}`,
    `remove:${KEYS.txn}`,
  ]);
  assert.equal(backend.getItem(KEYS.txn), null);
  assert.equal(result.written.indexOf(KEYS.sessions), -1, 'unchanged key is skipped');
  assert.ok(writeRank(KEYS.sessions) > writeRank(KEYS.meta));
  assert.ok(writeRank(KEYS.meta) > writeRank(KEYS.safety));
});

test('write failure: rolls back in reverse order; previously-missing key rolls back to null (removeItem)', () => {
  const backend = seedBackend();
  const before = backend.snapshot();
  const storage = createStorage(backend);
  backend.failWhen(({ op, key }) => (op === 'set' && key === KEYS.meta ? 'generic' : null));
  const newMonth = recordsKey('2026-10');
  assert.equal(backend.getItem(newMonth), null);
  assert.throws(
    () => storage.writeAll([[newMonth, '[]'], [KEYS.sched, '{}'], [KEYS.meta, '{}']], { label: 'fail-meta' }),
    error => error instanceof StorageWriteError && error.kind === 'unknown' && error.key === KEYS.meta,
  );
  assert.equal(backend.getItem(newMonth), null, 'key that did not exist before is removed again');
  assert.deepEqual(backend.snapshot(), before, 'all keys back to pre-write values, txn gone');
});

test('read-back verification mismatch triggers rollback', () => {
  const backend = seedBackend();
  const before = backend.snapshot();
  const storage = createStorage(backend);
  let hits = 0;
  backend.failWhen(({ op, key }) => (op === 'set' && key === KEYS.sched && (hits += 1) === 1 ? { corrupt: '{"silently":"different"}' } : null));
  assert.throws(
    () => storage.writeAll([[inkKey('2026-09'), '{}'], [KEYS.sched, '{}'], [KEYS.sessions, '{"A":null,"B":null,"lastEnded":{}}']]),
    error => error instanceof StorageWriteError && error.kind === 'verify' && error.key === KEYS.sched,
  );
  backend.failWhen(null);
  assert.deepEqual(backend.snapshot(), before);
});

test('rollback failure: unrecoverable keys quarantined to shizi.corrupt.*, txn copied, BlockingStorageError, later writes blocked', () => {
  const backend = seedBackend();
  const storage = createStorage(backend);
  const originalSched = backend.getItem(KEYS.sched);
  let schedWrites = 0;
  backend.failWhen(({ op, key }) => {
    if (op === 'set' && key === KEYS.sched) {
      schedWrites += 1;
      return schedWrites >= 2 ? 'quota' : null; // 第一次（写新值）成功，第二次（回滚）失败
    }
    if (op === 'set' && key === KEYS.meta) return 'quota';
    return null;
  });
  assert.throws(
    () => storage.writeAll([[KEYS.sched, '{}'], [KEYS.meta, '{}']], { label: 'doomed' }),
    error => error instanceof BlockingStorageError && error.keys.indexOf(KEYS.sched) >= 0 && error.cause.kind === 'quota',
  );
  backend.failWhen(null);
  assert.equal(backend.getItem(`shizi.corrupt.${KEYS.sched}`), '{}', 'the half-written value is moved aside');
  assert.equal(backend.getItem(KEYS.sched), null, 'original key removed');
  const txnCopy = JSON.parse(backend.getItem(`shizi.corrupt.${KEYS.txn}`));
  assert.equal(txnCopy.prev[KEYS.sched], originalSched, 'txn (with prev) is preserved for export/repair');
  assert.ok(backend.getItem(KEYS.txn) !== null, 'live txn stays so the next boot can roll back from prev');
  assert.ok(storage.blocked && storage.blocked.reason === 'rollback-failed');
  assert.throws(() => storage.writeAll([[KEYS.settings, '{}']]), BlockingStorageError);

  // 下次启动：repair 用 txn.prev 把 sched 恢复到写前
  const next = createStorage(backend);
  const report = next.repair();
  assert.equal(report.txn, 'rolled-back');
  assert.equal(backend.getItem(KEYS.sched), originalSched);
  assert.equal(backend.getItem(KEYS.txn), null);
});

test('quota classification', () => {
  assert.equal(classifyStorageError(makeError('quota')), 'quota');
  assert.equal(classifyStorageError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), 'quota');
  assert.equal(classifyStorageError({ name: 'Error', code: 22 }), 'quota');
  assert.equal(classifyStorageError({ code: 1014 }), 'quota');
  assert.equal(classifyStorageError(makeError('security')), 'security');
  assert.equal(classifyStorageError({ code: 18 }), 'security');
  assert.equal(classifyStorageError(new TypeError('x')), 'unknown');
  assert.equal(classifyStorageError(null), 'unknown');

  const backend = seedBackend();
  const storage = createStorage(backend);
  backend.failWhen(({ op, key }) => (op === 'set' && key === inkKey('2026-09') ? 'quota' : null));
  assert.throws(() => storage.writeAll([[inkKey('2026-09'), '{}']]), error => error.kind === 'quota');
  backend.failWhen(({ op, key }) => (op === 'set' && key === inkKey('2026-09') ? 'security' : null));
  assert.throws(() => storage.writeAll([[inkKey('2026-09'), '{}']]), error => error.kind === 'security');
  backend.failWhen(null);
  // 真实配额上限
  const tiny = new MemoryStorage({ quotaBytes: 200 });
  const s2 = createStorage(tiny);
  assert.throws(() => s2.writeAll([[KEYS.settings, JSON.stringify({ library: 'x'.repeat(200) })]]), error => error.kind === 'quota');
  assert.deepEqual(tiny.snapshot(), {}, 'nothing left behind');
});

test('storage-level failNextWrite (test hook path): kinds and matchKey prefix', () => {
  const backend = seedBackend();
  const storage = createStorage(backend);
  storage.failNextWrite(1, { kind: 'quota', matchKey: 'shizi.v2.records.*' });
  assert.throws(() => storage.writeAll([[inkKey('2026-09'), '{}'], [recordsKey('2026-11'), '[]']]), error => error.kind === 'quota' && error.key === recordsKey('2026-11'));
  assert.equal(backend.getItem(recordsKey('2026-11')), null);
  storage.writeAll([[recordsKey('2026-11'), '[]']]); // 注入已用完
  assert.equal(backend.getItem(recordsKey('2026-11')), '[]');
  storage.failNextWrite(1); // 无 matchKey：下一次写（即 txn）失败
  assert.throws(() => storage.writeAll([[KEYS.settings, '{}']]), error => error.key === KEYS.txn && error.kind === 'unknown');
  storage.failNextWrite(1, { kind: 'security' });
  assert.throws(() => storage.writeAll([[KEYS.settings, '{}']]), error => error.kind === 'security');
});

test('finalize: when txn removal fails the txn is marked done; repair keeps the post-write state', () => {
  const backend = seedBackend();
  const storage = createStorage(backend);
  backend.failWhen(({ op, key }) => (op === 'remove' && key === KEYS.txn ? 'generic' : null));
  storage.writeAll([[KEYS.settings, '{"sound":false}']]);
  backend.failWhen(null);
  assert.equal(JSON.parse(backend.getItem(KEYS.txn)).phase, 'done');
  const report = createStorage(backend).repair();
  assert.equal(report.txn, 'completed');
  assert.equal(backend.getItem(KEYS.settings), '{"sound":false}');
  assert.equal(backend.getItem(KEYS.txn), null);
});

test('repair: bad JSON / bad shape quarantined, original removed, reported once; good keys untouched', () => {
  const backend = seedBackend();
  backend.setItem(KEYS.sched, '{not json');
  backend.setItem(recordsKey('2026-08'), JSON.stringify([{ id: 'x' }]));
  backend.setItem('shizi.v2.records.2026-13', '[]');
  backend.setItem('shizi.memory.v1', '{"legacy":true}');
  const goodMeta = backend.getItem(KEYS.meta);
  const report = createStorage(backend).repair();
  assert.deepEqual(report.quarantined.map(q => q.key).sort(), [recordsKey('2026-08'), KEYS.sched].sort());
  assert.deepEqual(report.unknown, ['shizi.v2.records.2026-13'], 'unknown v2 keys are left alone');
  assert.equal(backend.getItem(KEYS.sched), null);
  assert.equal(backend.getItem(`shizi.corrupt.${KEYS.sched}`), '{not json');
  assert.equal(backend.getItem(KEYS.meta), goodMeta);
  assert.equal(backend.getItem('shizi.memory.v1'), '{"legacy":true}', 'v1 keys are not touched');
  const second = createStorage(backend).repair();
  assert.deepEqual(second.quarantined, [], 'second boot has nothing new to report');
});

test('probe: security error on write is reported as unavailable', () => {
  const backend = new MemoryStorage().failReads('security');
  const storage = createStorage(backend);
  const result = storage.probe();
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'security');
  assert.equal(createStorage(new MemoryStorage()).probe().ok, true);
});

test('writeAll refuses to touch txn/probe keys and non-string values', () => {
  const storage = createStorage(new MemoryStorage());
  assert.throws(() => storage.writeAll([[KEYS.txn, '{}']]), TypeError);
  assert.throws(() => storage.writeAll([[KEYS.meta, { a: 1 }]]), TypeError);
  assert.deepEqual(plain(storage.writeAll({})), { written: [], label: 'write' });
});

test('writeOne: single-key atomic write without txn (budget side recovery); verify mismatch restores the old value', () => {
  const backend = seedBackend();
  const storage = createStorage(backend);
  const order = traceWrites(backend);
  const key = inkKey('2026-09');
  assert.deepEqual(storage.writeOne(key, '{}', { label: 'shrink' }).written, [key]);
  assert.deepEqual(order, [`set:${key}`], 'no txn written');
  assert.equal(backend.getItem(key), '{}');
  assert.deepEqual(storage.writeOne(key, '{}').written, [], 'unchanged value is skipped');
  storage.writeOne(key, null);
  assert.equal(backend.getItem(key), null, 'null removes the key');
  backend.setItem(key, '{"a":1}');
  let hits = 0;
  backend.failWhen(({ op, key: k }) => (op === 'set' && k === key && (hits += 1) === 1 ? { corrupt: '{"b":2}' } : null));
  assert.throws(() => storage.writeOne(key, '{}'), error => error instanceof StorageWriteError && error.kind === 'verify');
  backend.failWhen(null);
  assert.equal(backend.getItem(key), '{"a":1}', 'old value restored');
  assert.equal(backend.getItem(KEYS.txn), null);
  assert.throws(() => storage.writeOne(KEYS.txn, '{}'), TypeError);
});
