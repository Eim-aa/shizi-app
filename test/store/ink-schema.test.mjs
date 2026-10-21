// B2.3 ink schema 2（每条墨迹一个键，原始点）：store 契约对两种后端各跑一遍（helpers.mjs BACKENDS）。
//   · 旧月键（schema 1）启动时逐月迁成单条键：逐条校验、一个月一个原子事务、失败不丢数据（旧月键原样还在）、记诊断、可重入；
//   · 迁移前后 state 逐字段相同；没迁完时读写照常（没动的旧月键不重写，动到的那个月在同一次提交里整月换成单条键）；
//   · 判断提交只写它自己那一条墨迹（写入字节数前后对比打印在测试输出里）；
//   · 墨迹编码按后端（policy P05）：原生 'raw'（Ink v4 原始点）、localStorage 'v3'。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, getInk, setInk } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { KEYS, inkKey, inkRecordKey, recordsKey } from '../../src/core/schema.js';
import { decodeInk, decodeInkRaw, encodeInkRaw, isInkV3, isInkV4 } from '../../src/core/ink-math.js';
import { buildBackupV2, inspectBackup, restoreFromBackup, serializeBackup } from '../../src/core/backup.js';
import * as policy from '../../src/config/policy.js';
import { BACKENDS, baselineState, inkEntry, inkEntryV2, plain, record } from './helpers.mjs';

const NOW = Date.parse('2026-10-02T10:00:00+08:00');
const clock = () => NOW;

/** 一笔原始点（120Hz）。 */
function rawStroke(x0, y0, n = 40, t0 = 0) {
  const pts = [];
  for (let k = 0; k < n; k += 1) pts.push({ x: x0 + k * 3.1, y: y0 + Math.sin(k / 5) * 4, t: t0 + k * (1000 / 120) });
  return pts;
}

for (const B of BACKENDS) {

function open(disk) {
  const storage = createStorage(B.open(disk), { now: clock });
  const store = createStore({ storage, now: clock });
  const report = store.load();
  return { store, storage, disk, report };
}

/** 把盘上的单条墨迹键改回 schema 1 的旧月键（模拟 B2.3 之前写下的数据）。 */
function toLegacyDisk(disk) {
  const tables = {};
  for (const key of Object.keys(disk.snapshot())) {
    const m = /^shizi\.v2\.ink\.(\d{4}-\d{2})\.(r\d+)$/.exec(key);
    if (!m) continue;
    (tables[m[1]] = tables[m[1]] || {})[m[2]] = JSON.parse(disk.getItem(key));
    disk.removeItem(key);
  }
  for (const month of Object.keys(tables)) disk.setItem(inkKey(month), JSON.stringify(tables[month]));
  return tables;
}

/** 两个月的墨迹（9 月 r2 v3、r3 v2；10 月 r5 v3），全部按旧月键放在盘上。 */
function legacyDisk() {
  const disk = B.make();
  const base = baselineState();
  base.records['2026-10'] = [record(5, '大', { day: '2026-10-01' })];
  base.meta = Object.assign({}, base.meta, { serial: 5, months: ['2026-09', '2026-10'] });
  base.ink = { '2026-09': { r2: inkEntry(), r3: inkEntryV2() }, '2026-10': { r5: inkEntry(6, 2) } };
  const { store } = open(disk);
  assert.equal(store.seed(base).ok, true);
  const tables = toLegacyDisk(disk);
  return { disk, tables, base };
}

test(`[${B.name}] ink schema 1 → 2 at load: every legacy month becomes one key per record, state unchanged, idempotent`, () => {
  const { disk, tables, base } = legacyDisk();
  assert.ok(disk.getItem(inkKey('2026-09')) && disk.getItem(inkKey('2026-10')), 'legacy month keys on disk');
  const { store } = open(disk);
  const s = store.status.inkSchema;
  assert.deepEqual({ schema: s.schema, legacyMonths: s.legacyMonths, migrated: s.migrated, records: s.records, failed: s.failed },
    { schema: 2, legacyMonths: 2, migrated: 2, records: 3, failed: null });
  assert.equal(disk.getItem(inkKey('2026-09')), null, 'month key removed');
  assert.equal(disk.getItem(inkKey('2026-10')), null);
  for (const month of Object.keys(tables)) {
    for (const id of Object.keys(tables[month])) {
      assert.equal(disk.getItem(inkRecordKey(month, id)), JSON.stringify(tables[month][id]), `${month}.${id} byte-equal to the legacy entry`);
    }
  }
  assert.deepEqual(plain(store.getState().ink), plain(base.ink), 'state.ink unchanged by the migration');
  assert.equal(disk.getItem(KEYS.txn), null);
  // 可重入：再启动一次什么都不写
  const before = disk.snapshot();
  const again = open(disk);
  assert.deepEqual(again.store.status.inkSchema, { schema: 2, legacyMonths: 0, migrated: 0, records: 0, failed: null });
  assert.deepEqual(disk.snapshot(), before);
  assert.deepEqual(plain(again.store.getState()), plain(store.getState()));
});

test(`[${B.name}] ink schema migration failure: that month rolls back untouched, earlier months stay migrated, diagnostic recorded, next start retries`, () => {
  const { disk, tables } = legacyDisk();
  // 10 月那一笔写坏（读回不符 / 原生校验不符）：只有 10 月失败
  disk.failWhen(({ op, key }) => (op === 'set' && key === inkRecordKey('2026-10', 'r5') ? { corrupt: '{}' } : null));
  const first = open(disk);
  disk.failWhen(null);
  const s = first.store.status.inkSchema;
  assert.equal(s.schema, 1, 'still schema 1: a legacy month is left');
  assert.equal(s.migrated, 1);
  assert.equal(s.failed.month, '2026-10');
  assert.equal(s.failed.stage, 'write');
  assert.equal(s.failed.error, 'verify');
  assert.equal(disk.getItem(inkKey('2026-10')), JSON.stringify(tables['2026-10']), 'failed month: legacy key byte-equal (no data lost)');
  assert.equal(disk.getItem(inkRecordKey('2026-10', 'r5')), null, 'and no half-written record key');
  assert.equal(disk.getItem(inkKey('2026-09')), null, 'September migrated before the failure');
  assert.deepEqual(plain(first.store.getInk({ id: 'r5', localDay: '2026-10-01' })), plain(tables['2026-10'].r5), 'reads still work');
  if (B.native) assert.equal(disk.diag[disk.diag.length - 1].kind, 'ink-schema-2-failed', 'native diag entry');
  // 没迁完时照常写：不动 10 月的提交不碰旧月键
  const r = first.store.commit('settings', draft => {
    draft.settings = Object.assign({}, draft.settings, { sound: false });
  });
  assert.equal(r.ok, true);
  assert.ok(!r.keys.some(k => k.indexOf('shizi.v2.ink.') === 0), 'no ink key rewritten');
  assert.equal(disk.getItem(inkKey('2026-10')), JSON.stringify(tables['2026-10']));
  // 下次启动重试成功
  const second = open(disk);
  assert.equal(second.store.status.inkSchema.schema, 2);
  assert.equal(second.store.status.inkSchema.migrated, 1);
  assert.equal(disk.getItem(inkKey('2026-10')), null);
  assert.equal(disk.getItem(inkRecordKey('2026-10', 'r5')), JSON.stringify(tables['2026-10'].r5));
});

test(`[${B.name}] a commit that touches a not-yet-migrated month converts that month in the same transaction`, () => {
  const { disk, tables } = legacyDisk();
  disk.failWhen(({ op, key }) => (op === 'set' && key.indexOf('shizi.v2.ink.') === 0 ? 'generic' : null));
  const { store } = open(disk); // 迁移全部失败：两个月都还是旧月键
  disk.failWhen(null);
  assert.equal(store.status.inkSchema.migrated, 0);
  const r6 = record(6, '天', { day: '2026-09-20' });
  const r = store.commit('judge-ish', draft => {
    draft.records['2026-09'] = draft.records['2026-09'].concat([r6]);
    setInk(draft, r6, inkEntry(5, 1));
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(disk.getItem(inkKey('2026-09')), null, 'September converted inside the commit');
  for (const id of ['r2', 'r3']) assert.equal(disk.getItem(inkRecordKey('2026-09', id)), JSON.stringify(tables['2026-09'][id]));
  assert.ok(disk.getItem(inkRecordKey('2026-09', 'r6')));
  assert.equal(disk.getItem(inkKey('2026-10')), JSON.stringify(tables['2026-10']), 'October untouched (still legacy)');
  assert.equal(store.status.inkSchema.schema, 1);
  const again = open(disk);
  assert.equal(again.store.status.inkSchema.schema, 2);
  assert.deepEqual(plain(again.store.getState().ink), plain(store.getState().ink));
});

test(`[${B.name}] judge commit writes only its own ink record (bytes: one record vs the whole month)`, () => {
  const disk = B.make();
  const { store, storage } = open(disk);
  const base = baselineState();
  // 一个月 60 份墨迹（D27 每字两份 + 看后自写，20 字 / 天时一个月的量级）
  const recs = [];
  const table = {};
  for (let i = 0; i < 60; i += 1) {
    const rec = record(10 + i, String.fromCharCode(0x4e00 + i), { day: '2026-10-01' });
    recs.push(rec);
    table[rec.id] = store.inkFormat === 'raw' ? encodeInkRaw([rawStroke(20, 40 + i), rawStroke(30, 120, 30, 400), rawStroke(40, 220, 50, 900)]) : inkEntry(16, 7);
  }
  base.records['2026-10'] = recs;
  base.meta = Object.assign({}, base.meta, { serial: 70, months: ['2026-09', '2026-10'] });
  base.ink['2026-10'] = table;
  assert.equal(store.seed(base).ok, true);
  const writes = [];
  const orig = storage.writeAll;
  storage.writeAll = (entries, opts) => {
    writes.push(...entries.filter(([key]) => key.indexOf('shizi.v2.ink.') === 0));
    return orig(entries, opts);
  };
  const rec = record(71, '永', { day: '2026-10-02' });
  const ink = store.inkFormat === 'raw' ? encodeInkRaw([rawStroke(20, 40), rawStroke(30, 120, 30, 400), rawStroke(40, 220, 50, 900)]) : inkEntry(16, 7);
  const r = store.commit('judge', draft => {
    draft.records['2026-10'] = draft.records['2026-10'].concat([rec]);
    setInk(draft, rec, ink);
  });
  storage.writeAll = orig;
  assert.equal(r.ok, true);
  assert.deepEqual(writes.map(([key]) => key), [inkRecordKey('2026-10', 'r71')], 'exactly one ink key written');
  const after = writes.reduce((n, [, raw]) => n + (raw ? raw.length : 0), 0);
  const before = JSON.stringify(store.getState().ink['2026-10']).length; // schema 1：整月重写
  console.log(`# B2.3 [${B.name}] judge ink write: schema 1 month key ${before} chars (${(before * 2 / 1024).toFixed(1)} KiB UTF-16) → schema 2 one record ${after} chars (${(after * 2 / 1024).toFixed(2)} KiB); ${(before / after).toFixed(0)}× less (61 records in the month, ${store.inkFormat})`);
  assert.ok(after * 30 < before, 'one record is a small fraction of the month');
});

test(`[${B.name}] judge ink encoding follows the backend (policy P05): native raw points (Ink v4), localStorage v3`, async () => {
  const { loadFSRSGlobal } = await import('../core/helpers.mjs');
  loadFSRSGlobal();
  const { commitJudgment } = await import('../../src/session/ops/judge.js');
  const { createSession } = await import('../../src/core/sessions.js');
  const disk = B.make();
  const { store } = open(disk);
  assert.equal(store.inkFormat, B.native ? policy.nativeStorage.inkFormat : policy.inkFormat);
  const s = createSession({ id: 's1', kind: 'daily', queue: ['base:永'], at: NOW });
  assert.equal(store.seed({ meta: { schema: 2, serial: 1, createdAt: NOW, months: [] }, records: {}, ink: {}, sched: {}, sessions: { A: { ...s, slot: 'A' }, B: null, lastEnded: {} } }).ok, true);
  const strokes = [rawStroke(30, 100, 40, 1000), rawStroke(60, 200, 30, 1700)];
  const r = commitJudgment(store, { slot: 'A', cardKey: 'base:永', judgment: 'correct', strokes, hints: 0, perRecordInk: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const ink = getInk(store.getState(), r.record);
  if (B.native) {
    assert.ok(isInkV4(ink), 'native: raw points');
    const back = decodeInkRaw(ink);
    assert.equal(back.length, 2);
    back.forEach((st, i) => st.forEach((p, j) => {
      assert.ok(Math.abs(p.x - strokes[i][j].x) <= 0.05 + 1e-9 && Math.abs(p.y - strokes[i][j].y) <= 0.05 + 1e-9, 'x / y within 0.1 unit');
      assert.ok(Math.abs(p.t - (strokes[i][j].t - 1000)) <= 1, 't within 1 ms (gap between strokes kept)');
    }));
  } else {
    assert.ok(isInkV3(ink), 'localStorage: v3 (capacity)');
  }
  assert.equal(decodeInk(ink).length, 2, 'renders on the web either way');
  assert.ok(disk.getItem(inkRecordKey(r.record.localDay.slice(0, 7), r.record.id)), 'one key per record on disk');
});

test(`[${B.name}] backup: export groups ink by month (format unchanged), restore of an old (schema 1 era) backup writes one key per record`, () => {
  const { disk, base } = legacyDisk();
  const { store } = open(disk);
  const file = buildBackupV2(store.getState(), { now: NOW });
  assert.equal(file.version, 2, 'backup version unchanged');
  assert.ok(file.data[inkKey('2026-09')] && file.data[inkKey('2026-10')], 'ink grouped by month in the envelope');
  assert.ok(!Object.keys(file.data).some(k => /^shizi\.v2\.ink\.\d{4}-\d{2}\./.test(k)), 'no one-record keys in backups');
  // 旧备份（B2.3 之前导出：同一信封、v3 / v2 墨迹）恢复到一台新机器
  const fresh = open(B.make());
  const report = inspectBackup(serializeBackup(file));
  assert.equal(report.ok, true);
  assert.equal(restoreFromBackup(fresh.store, report, { now: NOW }).ok, true);
  assert.deepEqual(plain(fresh.store.getState().ink), plain(base.ink));
  assert.equal(fresh.disk.getItem(inkKey('2026-09')), null);
  assert.ok(fresh.disk.getItem(inkRecordKey('2026-09', 'r3')));
  // v4 墨迹在备份里往返
  const v4 = encodeInkRaw([rawStroke(10, 10), rawStroke(20, 30, 10, 500)]);
  assert.equal(fresh.store.commit('v4', draft => { setInk(draft, { id: 'r2', localDay: '2026-09-15' }, v4); }).ok, true);
  const again = inspectBackup(serializeBackup(buildBackupV2(fresh.store.getState(), { now: NOW })));
  assert.equal(again.ok, true, JSON.stringify(again));
  const third = open(B.make());
  assert.equal(restoreFromBackup(third.store, again, { now: NOW }).ok, true);
  assert.deepEqual(plain(third.store.getInk({ id: 'r2', localDay: '2026-09-15' })), plain(v4));
});

}
