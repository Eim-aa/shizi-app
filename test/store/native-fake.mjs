// test/store 共用：原生 SQLite 数据层的 JS 替身（B1）。语义照 ios/ShiziApp/ShiziApp/NativeStore.swift + NativeStoreBridge.swift：
//   · 键 → 原始字串；apply 一个事务（任一项失败整笔回滚）；值带校验和，入库前核对、写后读回比对，不符 E_VERIFY；
//   · import / commitMigration / load / ping / diag / stats 与原生同一协议（请求、回复都过一遍 JSON，模拟序列化）；
//   · 迁移标记 migration = {state:'imported'|'done', count, digest, …}；done 之后拒绝再导入（E_MIGRATION）。
// 注入能力与 helpers.mjs MemoryStorage 同名同义（store 契约测试两种后端共用一套用例）：
//   quotaBytes            （键长+值长）×2 的合计超过它 → E_FULL（整笔回滚）
//   failWhen(fn)          每项写前调用 fn({op, key, value, count})：'quota' → E_FULL；'generic' | 'security' → E_IO；
//                         {corrupt:'值'} → 存成别的值（读回比对不符 → E_VERIFY，整笔回滚）
//   interruptAfterWrites(k)  第 k 项写落在某个事务之内 → 这个事务没提交就「断电」（磁盘不变）；恰好是事务最后一项 → 提交后「断电」。
//                         之后所有请求抛 E_TRANSPORT（结果未知），直到 resume()
//   failReads(kind)       load / ping / stats 回 E_UNAVAILABLE（库打不开）
//   failOp(op, code, {after})  下一次 op 回 code（after:true = 先照常执行、再回错误：模拟「已提交但回复超时」）
// 观察：getItem / setItem / removeItem / key / length（直接读写「磁盘」，不经注入，用于布置与核对）、snapshot()、clone()、
//   usedBytes()、writeCount（已提交的写项数）、calls（op 调用记录）。
import { NativeStoreError, checksum, digestRows, parseResponse } from '../../src/platform/native-store.js';
import { createNativeBackend, UnavailableBackend } from '../../src/store/native-backend.js';

const sortKeys = keys => keys.slice().sort();

export class FakeNativeDb {
  constructor({ quotaBytes = Infinity, initial = null, migration = { state: 'done', count: 0, digest: '0:0:811c9dc5', source: 'test' } } = {}) {
    this._map = new Map();
    this.quotaBytes = quotaBytes;
    this.migration = migration ? Object.assign({}, migration) : null;
    this.diag = [];
    this._failWhen = null;
    this._interruptAt = null;
    this._halted = false;
    this._readFailure = null;
    this._opFailures = [];
    this.writeCount = 0;
    this.calls = [];
    if (initial) for (const key of Object.keys(initial)) this._map.set(key, String(initial[key]));
  }

  // ---- 「磁盘」直接读写（布置 / 核对）

  get length() {
    return this._map.size;
  }

  key(i) {
    const keys = sortKeys(Array.from(this._map.keys()));
    return i >= 0 && i < keys.length ? keys[i] : null;
  }

  getItem(key) {
    return this._map.has(String(key)) ? this._map.get(String(key)) : null;
  }

  setItem(key, value) {
    this._map.set(String(key), String(value));
  }

  removeItem(key) {
    this._map.delete(String(key));
  }

  usedBytes() {
    let total = 0;
    for (const [k, v] of this._map) total += (k.length + v.length) * 2;
    return total;
  }

  snapshot() {
    const out = {};
    for (const key of sortKeys(Array.from(this._map.keys()))) out[key] = this._map.get(key);
    return out;
  }

  rows() {
    return sortKeys(Array.from(this._map.keys())).map(key => [key, this._map.get(key)]);
  }

  clone() {
    const db = new FakeNativeDb({ quotaBytes: this.quotaBytes, initial: this.snapshot(), migration: this.migration });
    return db;
  }

  // ---- 注入

  failWhen(fn) {
    this._failWhen = fn;
    return this;
  }

  interruptAfterWrites(k) {
    this._interruptAt = this.writeCount + k;
    return this;
  }

  failReads(kind) {
    this._readFailure = kind || null;
    return this;
  }

  failOp(op, code, { after = false, times = 1 } = {}) {
    this._opFailures.push({ op, code, after, times });
    return this;
  }

  resume() {
    this._halted = false;
    this._interruptAt = null;
    this._failWhen = null;
    this._readFailure = null;
    this._opFailures = [];
    return this;
  }

  // ---- 协议

  _takeOpFailure(op) {
    const i = this._opFailures.findIndex(f => f.op === op);
    if (i < 0) return null;
    const f = this._opFailures[i];
    f.times -= 1;
    if (f.times <= 0) this._opFailures.splice(i, 1);
    return f;
  }

  /** 一个事务写 ops（[key, raw|null, sum?]）；失败抛 {code, key}，磁盘不变。 */
  _transaction(ops, { checkInterrupt = true } = {}) {
    const undo = [];
    const rollback = () => {
      for (let i = undo.length - 1; i >= 0; i -= 1) {
        const [key, prev] = undo[i];
        if (prev === null) this._map.delete(key);
        else this._map.set(key, prev);
      }
    };
    if (checkInterrupt && this._interruptAt !== null && this.writeCount + ops.length > this._interruptAt) {
      // 「断电」落在事务里：没提交
      this._interruptAt = null;
      this._halted = true;
      throw { code: 'E_TRANSPORT', message: 'process died inside transaction' };
    }
    try {
      for (const [key, raw, sum] of ops) {
        if (typeof key !== 'string' || key.indexOf('shizi.') !== 0) throw { code: 'E_BAD_KEY', key };
        const prev = this._map.has(key) ? this._map.get(key) : null;
        let value = raw;
        if (this._failWhen) {
          const verdict = this._failWhen({ op: raw === null ? 'remove' : 'set', key, value: raw, count: this.writeCount + undo.length + 1 });
          if (verdict && typeof verdict === 'object' && Object.prototype.hasOwnProperty.call(verdict, 'corrupt')) value = String(verdict.corrupt);
          else if (verdict === 'quota') throw { code: 'E_FULL', key };
          else if (verdict) throw { code: 'E_IO', key };
        }
        if (raw === null) {
          undo.push([key, prev]);
          this._map.delete(key);
          continue;
        }
        if (sum !== undefined && sum !== null && checksum(raw) !== sum) throw { code: 'E_VERIFY', key, message: 'checksum mismatch on arrival' };
        const used = this.usedBytes() - (prev === null ? 0 : (key.length + prev.length) * 2);
        if (used + (key.length + value.length) * 2 > this.quotaBytes) throw { code: 'E_FULL', key };
        undo.push([key, prev]);
        this._map.set(key, value);
        if (this._map.get(key) !== raw) throw { code: 'E_VERIFY', key, message: 'read-back mismatch' };
      }
    } catch (error) {
      rollback();
      throw error;
    }
    this.writeCount += ops.length;
    if (checkInterrupt && this._interruptAt !== null && this.writeCount >= this._interruptAt) {
      this._interruptAt = null;
      this._halted = true; // 提交后「断电」：本次回复也收不到
      throw { code: 'E_TRANSPORT', message: 'process died after commit' };
    }
    return ops.length;
  }

  handle(op, payload = {}) {
    this.calls.push(op);
    try {
      if (this._halted) throw { code: 'E_TRANSPORT', message: 'process is gone' };
      const injected = this._takeOpFailure(op);
      if (injected && !injected.after) throw { code: injected.code, message: `injected ${injected.code}` };
      const out = this._perform(op, payload);
      if (injected && injected.after) throw { code: injected.code, message: `injected ${injected.code} after success` };
      return Object.assign({ ok: true }, out);
    } catch (error) {
      if (error && error.code) return { ok: false, error: { code: error.code, message: error.message || error.code, key: error.key || undefined } };
      return { ok: false, error: { code: 'E_INTERNAL', message: String(error) } };
    }
  }

  _perform(op, payload) {
    if (this._readFailure && ['load', 'ping', 'stats', 'apply', 'import', 'commitMigration'].indexOf(op) >= 0) {
      throw { code: 'E_UNAVAILABLE', message: `database cannot be opened (${this._readFailure})` };
    }
    switch (op) {
      case 'ping':
        return { schema: 1, migration: this.migration };
      case 'load':
        return { schema: 1, migration: this.migration, rows: this.rows() };
      case 'apply':
        if (!Array.isArray(payload.ops)) throw { code: 'E_BAD_REQUEST' };
        return { written: this._transaction(payload.ops) };
      case 'import': {
        if (this.migration && this.migration.state === 'done') throw { code: 'E_MIGRATION', message: 'migration already done' };
        const rows = payload.rows || [];
        if (rows.length !== payload.count) throw { code: 'E_VERIFY', message: 'row count' };
        const before = new Map(this._map);
        this._map.clear();
        try {
          this._transaction(rows, { checkInterrupt: false });
          const d = digestRows(this.rows());
          if (d.digest !== payload.digest) throw { code: 'E_VERIFY', message: `digest mismatch ${d.digest} vs ${payload.digest}` };
        } catch (error) {
          this._map = before;
          throw error;
        }
        this.migration = { state: 'imported', count: payload.count, digest: payload.digest, source: payload.source || '', importedAt: 1 };
        return { migration: this.migration };
      }
      case 'commitMigration': {
        const m = this.migration;
        if (!m) throw { code: 'E_MIGRATION', message: 'nothing imported' };
        if (m.state === 'done') {
          if (m.digest !== payload.digest) throw { code: 'E_MIGRATION' };
          return { migration: m };
        }
        if (m.digest !== payload.digest || m.count !== payload.count) throw { code: 'E_MIGRATION' };
        if (digestRows(this.rows()).digest !== payload.digest) throw { code: 'E_VERIFY' };
        this.migration = Object.assign({}, m, { state: 'done', doneAt: 2 });
        return { migration: this.migration };
      }
      case 'diag':
        if (payload.entry) this.diag.push(payload.entry);
        return { diag: this.diag.slice() };
      case 'stats':
        return { rows: this._map.size, migration: this.migration };
      default:
        throw { code: 'E_UNKNOWN_OP' };
    }
  }

  /** 页面一侧看到的传输（与 createXhrTransport 同形）：请求与回复都过 JSON。 */
  transport() {
    const call = (op, payload) => {
      const res = this.handle(op, JSON.parse(JSON.stringify(payload || {})));
      return parseResponse(op, 200, JSON.stringify(res));
    };
    return {
      kind: 'fake',
      callSync: (op, payload) => call(op, payload),
      callAsync: async (op, payload) => call(op, payload),
    };
  }

  /** 「启动」：像 native-boot 一样 load 出全部行建镜像后端；库打不开时给 UnavailableBackend。 */
  open() {
    const t = this.transport();
    try {
      const snap = t.callSync('load', {});
      return createNativeBackend({ transport: t, rows: snap.rows });
    } catch (error) {
      return new UnavailableBackend(error instanceof NativeStoreError ? error.code : String(error));
    }
  }
}
