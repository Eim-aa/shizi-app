// 原生 SQLite 的 Storage 兼容后端（B1；01-架构设计 §4.1）。storage.js 照旧只认「Storage 兼容对象」，这里多出一个
// applyBatch(entries)：storage.js 见到它就走「事务后端」路径——一次 writeAll = 一个原生事务（不再写 shizi.v2.txn 日志）。
//
// 读：启动时从原生读出的全部键值放在内存镜像里，getItem / key / length 同步返回（store 的读语义不变）。
// 写：applyBatch 同步调用原生 apply（platform/native-store.js callSync）；原生提交成功后才更新镜像——
//     所以镜像永远等于磁盘上已提交的内容。setItem / removeItem 是单项 applyBatch（隔离坏值、探测、清理等零星写）。
// 错误映射（抛给 storage.js 分类）：
//   E_FULL                → name 'QuotaExceededError'（classifyStorageError → 'quota'，走预算回收后重试）
//   E_TIMEOUT / E_TRANSPORT → uncertain:true（结果未知，storage.js 置阻断，R-B09；重启后以库为准）
//   其余                   → name 'NativeStoreError'，code 原样（'unknown'；原生已整笔回滚，磁盘没变）

import { checksum, NativeStoreError } from '../platform/native-store.js';

function toStorageError(error, keys) {
  const e = error instanceof NativeStoreError ? error : new NativeStoreError('E_TRANSPORT', error && error.message ? error.message : String(error));
  const out = new Error(e.message);
  out.name = e.code === 'E_FULL' ? 'QuotaExceededError' : 'NativeStoreError';
  out.code = e.code;
  out.uncertain = e.uncertain === true;
  out.key = e.key || (keys.length === 1 ? keys[0] : null);
  return out;
}

export class NativeBackend {
  /**
   * @param {{callSync: Function}} transport
   * @param {Array<[string, string]>} rows  启动时 load 读出的全部键值
   */
  constructor(transport, rows = []) {
    this._transport = transport;
    this._mem = new Map();
    for (const [key, raw] of rows) this._mem.set(String(key), String(raw));
    this._keys = null;
  }

  /** storage.js 据此走事务路径。 */
  get transactional() {
    return true;
  }

  get length() {
    return this._mem.size;
  }

  key(i) {
    if (!this._keys) this._keys = Array.from(this._mem.keys()).sort();
    return i >= 0 && i < this._keys.length ? this._keys[i] : null;
  }

  getItem(key) {
    key = String(key);
    return this._mem.has(key) ? this._mem.get(key) : null;
  }

  setItem(key, value) {
    this._apply([[String(key), String(value)]]);
  }

  removeItem(key) {
    this._apply([[String(key), null]]);
  }

  /**
   * 一个原生事务写完 entries（[key, raw|null]，按给定顺序）。成功后更新镜像；失败抛错、镜像不变。
   */
  applyBatch(entries) {
    this._apply(entries);
  }

  /** 往原生库的诊断记一条（store 迁移 ink schema 2 失败时用；只供排查，不等结果、失败不抛）。 */
  diag(entry) {
    try {
      const pending = this._transport.callAsync ? this._transport.callAsync('diag', { entry }, { timeoutMs: 5000 }) : null;
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (error) {
      // 诊断写不进去不影响启动
    }
  }

  // setItem / removeItem / applyBatch 共用（测试钩子的写日志各包一层公开方法，内部互不调用，免得一笔记两次）。
  _apply(entries) {
    if (!entries.length) return;
    const ops = entries.map(([key, raw]) => (raw === null ? [key, null] : [key, raw, checksum(raw)]));
    try {
      this._transport.callSync('apply', { ops });
    } catch (error) {
      throw toStorageError(error, entries.map(([key]) => key));
    }
    for (const [key, raw] of entries) {
      if (raw === null) this._mem.delete(key);
      else this._mem.set(key, raw);
    }
    this._keys = null;
  }
}

export function createNativeBackend({ transport, rows = [] }) {
  return new NativeBackend(transport, rows);
}

/**
 * 原生库读不出来、而本机已经迁移过（以原生为准）时用的后端：任何读写都抛错——store.load 的探测失败，
 * status.available=false，界面进 R-B09「现在存不了记录」阻断页；不能退回已过时的 localStorage。
 */
export class UnavailableBackend {
  constructor(reason) {
    this.reason = reason || 'native store unavailable';
  }

  _fail() {
    const error = new Error(this.reason);
    error.name = 'NativeStoreUnavailable';
    throw error;
  }

  get length() {
    return this._fail();
  }

  key() {
    return this._fail();
  }

  getItem() {
    return this._fail();
  }

  setItem() {
    return this._fail();
  }

  removeItem() {
    return this._fail();
  }
}
