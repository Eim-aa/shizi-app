// B1 启动：选持久化后端，必要时把 localStorage 一次性迁进原生 SQLite（01-架构设计 §4.1、§12.1）。
//
// prepareStorage() 在 app.js 里、bootStore 之前 await（UI 挂载之前，首帧前完成，不出现空态）。永不抛错，返回
//   {kind:'native', backend, budgets, info}        原生 SQLite（镜像后端 + 原生口径预算）
//   {kind:'localStorage', backend:null, budgets:null, info}  网页 / e2e，或迁移没完成时的回退
//   {kind:'native', backend:UnavailableBackend, …, info.unavailable}  已迁移过、原生却读不出来 → store 不可用 → R-B09 阻断页
// info = {action, migration?, fallback?, diag?, ms}，挂到 store.status.backend（测试钩子 getStatus 可见）。
//
// 迁移（库里 migration.state 不是 'done' 时每次启动都走，可重入）：
//   1. 同步通道探测（callSync ping）——写入要靠同步 XHR，这一步不通就不迁移；
//   2. localStorage repair()（与旧版启动时一样：回滚半写的 txn、隔离坏值；不做写探测——写满时正是最该迁移的时候）；读不出来 → 不迁移；
//   3. 读出全部 shizi.* 键（去掉 txn / probe / 冒烟键 / 本标记），算每项校验和与整体摘要；
//   4. import：原生一个事务清空数据表、整批写入（逐项核对校验和、读回比对）、按库里的行重算摘要须一致、记 state=imported；
//   5. 再 load 一遍，逐项核对：条数相同、每个键的值逐字相等、摘要相同；
//   6. 在 localStorage 写标记 shizi.nativeStore.v1（写不进去不影响迁移，只少一道保险）；
//   7. commitMigration：原生再重算摘要一致才置 state=done。之后以原生为准。
// 任何一步失败：localStorage 一字不动（第 2 步的 repair 与旧版启动时的修复相同），这次启动继续用 localStorage，诊断记进
// 原生库（diag）与控制台；下次启动从头再迁。中途被杀：import 是单个事务（要么没写、要么整批 imported），没到 done 就从头再来。
// commitMigration 结果未知（超时 / 传输失败）时再 ping 一次：done → 用原生；imported → 回退；问不到 → 阻断（不冒险双写）。
//
// 旧数据：迁移后 localStorage 里的 shizi.* 键保留一个版本周期不删（规则见 01 §12.1：下一个版本起，迁移完成满 30 天且
// 原生库启动成功后删除）；本版本不删任何 localStorage 键。

import { createStorage } from './storage.js';
import { createNativeBackend, UnavailableBackend } from './native-backend.js';
import { NATIVE_BUDGETS } from './budget.js';
import { KEYS, NATIVE_SMOKE_KEY, NATIVE_STORE_MARKER_KEY } from '../core/schema.js';
import { checksum, createXhrTransport, digestRows, isNativeStoreHost, parseResponse } from '../platform/native-store.js';

/** 迁移时不搬的键：txn 日志（repair 后应已不在）、探针、iOS 冒烟键、迁移标记本身。 */
export const MIGRATION_SKIP = Object.freeze([KEYS.txn, KEYS.probe, NATIVE_SMOKE_KEY, NATIVE_STORE_MARKER_KEY]);

function errInfo(error) {
  return {
    code: error && error.code ? error.code : error && error.kind ? error.kind : error && error.name ? error.name : 'exception',
    message: error && error.message ? String(error.message).slice(0, 300) : String(error).slice(0, 300),
  };
}

class MigrationFailure extends Error {
  constructor(stage, error, extra = {}) {
    const info = errInfo(error);
    super(`${stage}: ${info.message}`);
    this.stage = stage;
    this.code = info.code;
    this.extra = extra;
  }
}

function readMarker(ls) {
  try {
    return ls.read(NATIVE_STORE_MARKER_KEY);
  } catch (error) {
    return null;
  }
}

function writeMarker(ls, migration) {
  try {
    if (readMarker(ls) !== null) return true;
    const raw = JSON.stringify({ v: 1, at: Date.now(), count: migration.count, digest: migration.digest });
    ls.writeOne(NATIVE_STORE_MARKER_KEY, raw, { label: 'native-store-marker' });
    return true;
  } catch (error) {
    return false;
  }
}

/** localStorage → 原生（见文件头 1–7）。成功返回 {rows, migration, count}；失败抛 MigrationFailure（uncertain 表示结果未知）。 */
export async function migrateFromLocalStorage({ transport, ls, timeoutMs = 60000 }) {
  try {
    transport.callSync('ping', {});
  } catch (error) {
    throw new MigrationFailure('sync-channel', error);
  }
  // 不做写探测：localStorage 写满时正是最需要迁移的时候，探针写不进去不代表读不出来。
  let repair;
  try {
    repair = ls.repair();
  } catch (error) {
    throw new MigrationFailure('local-repair', error);
  }
  if (repair.blocked) throw new MigrationFailure('local-repair', { code: 'blocked', message: 'localStorage repair could not roll back' });
  let rows;
  try {
    rows = ls.readAll('shizi.').filter(([key, raw]) => MIGRATION_SKIP.indexOf(key) < 0 && raw !== null);
  } catch (error) {
    throw new MigrationFailure('local-read', error);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const sums = rows.map(([, raw]) => checksum(raw));
  const { count, digest } = digestRows(rows, sums);
  let imported;
  try {
    imported = await transport.callAsync('import', { rows: rows.map(([key, raw], i) => [key, raw, sums[i]]), count, digest, source: 'localStorage' }, { timeoutMs });
  } catch (error) {
    throw new MigrationFailure('import', error);
  }
  if (!imported.migration || imported.migration.state !== 'imported' || imported.migration.digest !== digest) {
    throw new MigrationFailure('import', { code: 'E_VERIFY', message: 'import did not report the expected digest' });
  }
  let back;
  try {
    back = await transport.callAsync('load', {}, { timeoutMs });
  } catch (error) {
    throw new MigrationFailure('verify-load', error);
  }
  const got = Array.isArray(back.rows) ? back.rows : [];
  if (got.length !== count) throw new MigrationFailure('verify', { code: 'E_VERIFY', message: `row count ${got.length} != ${count}` });
  for (let i = 0; i < count; i += 1) {
    const [key, raw] = rows[i];
    const pair = got[i];
    if (!Array.isArray(pair) || pair[0] !== key || pair[1] !== raw) {
      throw new MigrationFailure('verify', { code: 'E_VERIFY', message: `mismatch at ${key}` }, { key });
    }
  }
  if (digestRows(got).digest !== digest || !back.migration || back.migration.digest !== digest) {
    throw new MigrationFailure('verify', { code: 'E_VERIFY', message: 'digest mismatch after read-back' });
  }
  const markerWritten = writeMarker(ls, { count, digest });
  let committed;
  try {
    committed = await transport.callAsync('commitMigration', { count, digest }, { timeoutMs });
  } catch (error) {
    if (error && error.uncertain) {
      // 结果未知：问一次库的状态。
      let state = null;
      try {
        state = transport.callSync('ping', {}).migration;
      } catch (pingError) {
        const failure = new MigrationFailure('commit', error);
        failure.uncertain = true;
        throw failure;
      }
      if (state && state.state === 'done' && state.digest === digest) committed = { migration: state };
      else throw new MigrationFailure('commit', error);
    } else {
      throw new MigrationFailure('commit', error);
    }
  }
  return { rows: got, migration: committed.migration, count, repair, markerWritten };
}

/**
 * 启动时的第一次 load：先取 platform/native-preload.js 在 HTML 解析时发出的那次（一次性）；没有或没成功再自己请求一次。
 */
async function initialLoad(transport, win, { early = true } = {}) {
  const pending = early && win ? win.__shiziNativeLoad : null;
  if (pending && typeof pending.then === 'function') {
    try {
      delete win.__shiziNativeLoad;
    } catch (error) {
      win.__shiziNativeLoad = undefined;
    }
    try {
      const r = await pending;
      if (r && r.status === 200) return parseResponse('load', r.status, r.text);
    } catch (error) {
      // 预发的那次不可用：下面重新请求
    }
  }
  return transport.callAsync('load', {}, { timeoutMs: 30000 });
}

async function recordDiag(transport, entry) {
  try {
    await transport.callAsync('diag', { entry }, { timeoutMs: 5000 });
  } catch (error) {
    // 诊断写不进去不影响启动
  }
}

/**
 * @param {{win?:object, transport?:object, localBackend?:object, now?:() => number}} options
 *   transport 注入时（单测）不看页面协议，直接走原生路径；localBackend 缺省 = 页面的 localStorage。
 */
export async function prepareStorage(options = {}) {
  try {
    return await prepare(options);
  } catch (error) {
    // 不该发生（prepare 内部各步都已兜住）：原生壳里状态未知 → 阻断，不冒险写过时的 localStorage；网页照旧 localStorage。
    const native = !!options.transport || isNativeStoreHost(options.win || globalThis);
    const info = { kind: native ? 'native' : 'localStorage', action: native ? 'unavailable' : 'web', unavailable: errInfo(error) };
    return native
      ? { kind: 'native', backend: new UnavailableBackend('prepareStorage failed'), budgets: NATIVE_BUDGETS, info }
      : { kind: 'localStorage', backend: null, budgets: null, info };
  }
}

async function prepare({ win = globalThis, transport = null, localBackend = null, now = () => Date.now() } = {}) {
  const started = now();
  const done = (result, info) => {
    result.info = Object.assign({ kind: result.kind, ms: now() - started }, info);
    if (typeof console !== 'undefined' && info.fallback) console.warn('[shizi] native store fallback:', JSON.stringify(info));
    return result;
  };
  if (!transport && !isNativeStoreHost(win)) return done({ kind: 'localStorage', backend: null, budgets: null }, { action: 'web' });
  const t = transport || createXhrTransport({ win });
  const ls = createStorage(localBackend);
  let snap;
  const loadStarted = now();
  try {
    snap = await initialLoad(t, win, { early: !transport });
  } catch (error) {
    const info = errInfo(error);
    if (readMarker(ls) !== null) {
      // 已经迁移过：localStorage 已过时，不能退回去写它。
      return done({ kind: 'native', backend: new UnavailableBackend(`native load failed: ${info.code}`), budgets: NATIVE_BUDGETS }, { action: 'unavailable', unavailable: info });
    }
    return done({ kind: 'localStorage', backend: null, budgets: null }, { action: 'fallback', fallback: Object.assign({ stage: 'load' }, info) });
  }
  const state = snap.migration && snap.migration.state;
  if (state === 'done') {
    // 不碰 localStorage（第一次访问会把整块旧数据读进页面，白费几十毫秒）；标记在迁移那次已写。
    return done({ kind: 'native', backend: createNativeBackend({ transport: t, rows: snap.rows || [] }), budgets: NATIVE_BUDGETS }, { action: 'none', migration: snap.migration, loadMs: now() - loadStarted, nativeMs: snap.ms });
  }
  try {
    const m = await migrateFromLocalStorage({ transport: t, ls });
    return done({ kind: 'native', backend: createNativeBackend({ transport: t, rows: m.rows }), budgets: NATIVE_BUDGETS }, {
      action: 'migrated',
      migration: m.migration,
      repair: m.repair ? { txn: m.repair.txn, quarantined: m.repair.quarantined.length } : null,
      markerWritten: m.markerWritten,
    });
  } catch (error) {
    const failure = { stage: error && error.stage ? error.stage : 'exception', code: error && error.code ? error.code : 'exception', message: error && error.message ? error.message : String(error) };
    if (error && error.extra && error.extra.key) failure.key = error.extra.key;
    await recordDiag(t, Object.assign({ kind: 'migration-failed' }, failure));
    if (error && error.uncertain) {
      return done({ kind: 'native', backend: new UnavailableBackend('migration commit outcome unknown'), budgets: NATIVE_BUDGETS }, { action: 'unavailable', unavailable: failure });
    }
    return done({ kind: 'localStorage', backend: null, budgets: null }, { action: 'fallback', fallback: failure });
  }
}
