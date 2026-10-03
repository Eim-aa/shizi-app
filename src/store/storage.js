// localStorage 驱动（01-架构设计 §4）。整个应用里**唯一**调用 localStorage 写方法的模块。
//
// writeAll(entries, {label})：
//   0. 读每个键的原值 prev；与新值相同的条目跳过；
//   1. 先写提交日志 shizi.v2.txn = {label, at, keys, prev, phase:'writing'} 并读回核对；
//   2. 按固定顺序写数据键：ink.<月>（升序）→ records.<月>（升序）→ sched → custom → wordOff → settings → photos → legacy
//      → backupMeta → funnel → safety → （其他）→ meta → sessions（最后：它决定恢复阶段）；null = removeItem；
//   3. 逐键 getItem 读回比对；
//   4. 删除 txn（删不掉就改写 phase:'done'，启动修复时按「已完成」处理）。
//   任一步失败：按逆序用 prev 回滚（prev 为 null 的键 removeItem）并逐键核对，再删 txn；
//   回滚失败：把没能恢复的键搬到 shizi.corrupt.<key>、txn 复制一份到 shizi.corrupt.shizi.v2.txn（live txn 保留，
//   下次启动 repair() 会再按 prev 回滚），进入阻断状态并抛 BlockingStorageError（R-B09 阻断页由 UI 负责）。
//
// writeOne(key, raw|null, {label})：**只供预算回收的单键缩小写**（store 撞配额后的旁路回收）。
//   单个 setItem/removeItem 本身原子（断电后键要么是原值要么是新值，两者都合法），因此不写 txn——
//   写 txn 要多占一份原值，正是配额吃紧时拿不出的空间。原值留在内存：读回不一致就用它恢复；恢复失败按 rollback 隔离并阻断。
//
// writeRoute(raw|null)（审查整改 F1）：**只供路由提示键 shizi.v2.route** 的单键写（冷启动恢复页面，ui/route-memory.js）。
//   它不是业务数据、不是 store 域、不进备份：值丢了 / 旧了 / 坏了都只是「不恢复、落首页」，所以不写 txn、不读回核对、
//   不回滚、不阻断、不预算回收；失败返回 {ok:false, kind} 且不抛错（静默）。单个 setItem 本身原子。
//   不经 writeAll（writeAll 拒绝这个键），因此不改变「sessions 最后写」的提交顺序，也不会出现在 txn.keys 里——启动 repair()
//   的回滚只动 txn 记下的键，路由提示保持离开时的值，由 route-memory 按修复后的状态再判能不能恢复。
//   故障注入：不计入 interruptAfterWrite 的次数（中断后 halted 时照样拒写——进程已「死」）；failNextWrite 只有 matchKey
//   明确指向它时才命中（免得一次导航把别的用例给 commit 准备的失败吃掉）。
//
// repair()（启动时调用一次）：未完成的 txn 回滚到写前（phase:'done' 视为写后，只删 txn）；
//   然后逐个 shizi.v2.* 键做 JSON + 形状校验，坏值搬到 shizi.corrupt.<key>、原键移除。
//   例外：路由提示 shizi.v2.route 坏了直接删（report.dropped），不隔离、不触发坏值提示——它不是用户数据。
//
// 故障注入（failNextWrite / interruptAfterWrite）只由 platform/test-hooks.js 在 isTestHost() 下调用；
// 生产路径里它们永远是空配置。

import { KEYS, V2_PREFIX, corruptKeyFor, parseAndValidate, specForKey } from '../core/schema.js';
import { estimateUsage } from './budget.js';

// ---------------------------------------------------------------- 错误

/** 写失败。kind: 'quota' | 'security' | 'unknown' | 'verify' | 'interrupted'。 */
export class StorageWriteError extends Error {
  constructor(kind, message, { key = null, phase = null, cause = null } = {}) {
    super(message);
    this.name = 'StorageWriteError';
    this.kind = kind;
    this.key = key;
    this.phase = phase;
    this.cause = cause;
  }
}

/** 回滚失败、存储进入阻断状态（R-B09）。之后的 writeAll 一律抛此错误，直到重新启动。 */
export class BlockingStorageError extends Error {
  constructor(message, { keys = [], cause = null } = {}) {
    super(message);
    this.name = 'BlockingStorageError';
    this.kind = 'blocked';
    this.keys = keys;
    this.cause = cause;
  }
}

/** 读失败（隐私模式 / 被禁用）。kind 同 classifyStorageError。 */
export class StorageReadError extends Error {
  constructor(kind, message, { key = null, cause = null } = {}) {
    super(message);
    this.name = 'StorageReadError';
    this.kind = kind;
    this.key = key;
    this.cause = cause;
  }
}

/** 配额错误分类：'quota' | 'security' | 'unknown'。 */
export function classifyStorageError(error) {
  if (!error) return 'unknown';
  if (error instanceof StorageWriteError || error instanceof StorageReadError) {
    return error.kind === 'quota' || error.kind === 'security' ? error.kind : 'unknown';
  }
  const name = error.name;
  const code = error.code;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) return 'quota';
  if (name === 'SecurityError' || code === 18) return 'security';
  return 'unknown';
}

function isInterrupted(error) {
  return error instanceof StorageWriteError && error.kind === 'interrupted';
}

function makeInjectedError(kind) {
  const name = kind === 'quota' ? 'QuotaExceededError' : kind === 'security' ? 'SecurityError' : null;
  if (name) {
    if (typeof DOMException === 'function') return new DOMException(`injected ${kind} failure`, name);
    const error = new Error(`injected ${kind} failure`);
    error.name = name;
    return error;
  }
  return new Error('injected generic write failure');
}

// ---------------------------------------------------------------- 写入顺序

const WRITE_ORDER = ['ink', 'records', 'sched', 'custom', 'wordOff', 'settings', 'photos', 'legacy', 'backupMeta', 'funnel', 'safety', '*', 'meta', 'sessions'];

export function writeRank(key) {
  const spec = specForKey(key);
  const id = spec ? spec.id : '*';
  const rank = WRITE_ORDER.indexOf(id);
  return rank >= 0 ? rank : WRITE_ORDER.indexOf('*');
}

function compareWriteOrder(a, b) {
  const ra = writeRank(a);
  const rb = writeRank(b);
  if (ra !== rb) return ra - rb;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------- 驱动标记（给 test-hooks 的写日志区分来源）

let driverDepth = 0;

/** 当前是否处在 storage.js 自己发起的 setItem/removeItem 调用中。 */
export function isDriverActive() {
  return driverDepth > 0;
}

function defaultBackend() {
  // 访问 localStorage 本身在被禁用时会抛 SecurityError，由调用方分类。
  return globalThis.localStorage;
}

// ---------------------------------------------------------------- 工厂

/**
 * @param {Storage|null} backend  Storage 兼容对象；缺省取 globalThis.localStorage（惰性）。
 * @param {{now?: () => number}} options
 */
export function createStorage(backend = null, { now = () => Date.now() } = {}) {
  let halted = false;
  let blocked = null;
  let failQueue = []; // [{remaining, kind, matchKey}]
  let interruptAfter = null; // 剩余可写次数
  let lastRepair = null;

  function be() {
    return backend || defaultBackend();
  }

  function matches(matchKey, key) {
    if (!matchKey) return true;
    if (matchKey.charAt(matchKey.length - 1) === '*') return key.indexOf(matchKey.slice(0, -1)) === 0;
    return key === matchKey;
  }

  function takeInjectedFailure(key, { explicitOnly = false } = {}) {
    for (let i = 0; i < failQueue.length; i += 1) {
      const rule = failQueue[i];
      if (explicitOnly && !rule.matchKey) continue;
      if (rule.remaining > 0 && matches(rule.matchKey, key)) {
        rule.remaining -= 1;
        if (rule.remaining <= 0) failQueue.splice(i, 1);
        return makeInjectedError(rule.kind);
      }
    }
    return null;
  }

  function afterWrite(key) {
    if (interruptAfter === null) return;
    interruptAfter -= 1;
    if (interruptAfter <= 0) {
      interruptAfter = null;
      halted = true;
      throw new StorageWriteError('interrupted', `interrupted after write to ${key}`, { key, phase: 'interrupt' });
    }
  }

  function guardHalted(key) {
    if (halted) throw new StorageWriteError('interrupted', 'storage halted by interruptAfterWrite', { key, phase: 'halted' });
  }

  function rawSet(key, value) {
    guardHalted(key);
    const injected = takeInjectedFailure(key);
    if (injected) throw injected;
    driverDepth += 1;
    try {
      be().setItem(key, value);
    } finally {
      driverDepth -= 1;
    }
    afterWrite(key);
  }

  function rawRemove(key) {
    guardHalted(key);
    driverDepth += 1;
    try {
      be().removeItem(key);
    } finally {
      driverDepth -= 1;
    }
    afterWrite(key);
  }

  function rawGet(key) {
    return be().getItem(key);
  }

  function read(key) {
    try {
      return rawGet(key);
    } catch (error) {
      throw new StorageReadError(classifyStorageError(error), `read failed: ${key}`, { key, cause: error });
    }
  }

  function listKeys(prefix = '') {
    const store = be();
    const out = [];
    const n = store.length;
    for (let i = 0; i < n; i += 1) {
      const key = store.key(i);
      if (key !== null && key.indexOf(prefix) === 0) out.push(key);
    }
    return out.sort();
  }

  function readAll(prefix = '') {
    return listKeys(prefix).map(key => [key, rawGet(key)]);
  }

  function toWriteError(error, key, phase) {
    if (error instanceof StorageWriteError) return error;
    const kind = classifyStorageError(error);
    return new StorageWriteError(kind, `${phase} failed at ${key}: ${error && error.message ? error.message : error}`, { key, phase, cause: error });
  }

  // 把 key 的现值搬到 shizi.corrupt.<key> 并移除原键。返回是否成功。
  function quarantine(key, raw) {
    try {
      if (raw !== null && raw !== undefined) rawSet(corruptKeyFor(key), raw);
      rawRemove(key);
      return true;
    } catch (error) {
      if (isInterrupted(error)) throw error;
      return false;
    }
  }

  /**
   * 用 txn.prev 把 keys 逆序恢复并逐键核对，成功后删 txn。
   * 失败：隔离未恢复的键、复制 txn 到 corrupt、置阻断，返回 {ok:false, keys}。
   */
  function rollback(txn, keys, cause) {
    const failed = [];
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const key = keys[i];
      const prev = Object.prototype.hasOwnProperty.call(txn.prev, key) ? txn.prev[key] : null;
      try {
        if (rawGet(key) !== prev) {
          if (prev === null) rawRemove(key);
          else rawSet(key, prev);
        }
        if (rawGet(key) !== prev) failed.push(key);
      } catch (error) {
        if (isInterrupted(error)) throw error;
        failed.push(key);
      }
    }
    if (!failed.length) {
      try {
        rawRemove(KEYS.txn);
      } catch (error) {
        if (isInterrupted(error)) throw error;
        // 数据已回到写前；txn 残留只会让下次启动再做一次等价回滚。
      }
      return { ok: true, keys: [] };
    }
    const moved = [];
    for (const key of failed) {
      let raw = null;
      try {
        raw = rawGet(key);
      } catch (error) {
        raw = null;
      }
      if (raw !== null && quarantine(key, raw)) moved.push(key);
    }
    try {
      rawSet(corruptKeyFor(KEYS.txn), JSON.stringify(txn));
    } catch (error) {
      if (isInterrupted(error)) throw error;
    }
    blocked = { reason: 'rollback-failed', keys: failed, moved, cause: cause || null, at: now() };
    return { ok: false, keys: failed };
  }

  function normalizeEntries(entries) {
    const list = Array.isArray(entries) ? entries : Object.keys(entries || {}).map(key => [key, entries[key]]);
    const byKey = new Map();
    for (const pair of list) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError('writeAll entries must be [key, raw|null] pairs');
      const [key, raw] = pair;
      if (typeof key !== 'string' || !key) throw new TypeError('writeAll key must be a non-empty string');
      if (key === KEYS.txn || key === KEYS.probe || key === KEYS.route) throw new TypeError(`writeAll must not touch ${key}`);
      if (raw !== null && typeof raw !== 'string') throw new TypeError(`writeAll value for ${key} must be a string or null`);
      byKey.set(key, raw);
    }
    return [...byKey.entries()].sort((a, b) => compareWriteOrder(a[0], b[0]));
  }

  /**
   * 事务写。entries: [[key, raw|null]] 或 {key: raw|null}。
   * 成功返回 {written:[key…], label}；失败抛 StorageWriteError（已回滚）或 BlockingStorageError（回滚失败）。
   */
  function writeAll(entries, { label = 'write' } = {}) {
    if (halted) throw new StorageWriteError('interrupted', 'storage halted by interruptAfterWrite', { phase: 'halted' });
    if (blocked) throw new BlockingStorageError('storage is blocked after a failed rollback', { keys: blocked.keys });
    const sorted = normalizeEntries(entries);
    const prev = {};
    const todo = [];
    for (const [key, raw] of sorted) {
      let before;
      try {
        before = rawGet(key);
      } catch (error) {
        throw toWriteError(error, key, 'read-prev');
      }
      if (before === raw) continue;
      prev[key] = before;
      todo.push([key, raw]);
    }
    if (!todo.length) return { written: [], label };
    const keys = todo.map(([key]) => key);
    const txn = { label: String(label), at: now(), keys, prev, phase: 'writing' };
    const txnRaw = JSON.stringify(txn);
    try {
      rawSet(KEYS.txn, txnRaw);
      if (rawGet(KEYS.txn) !== txnRaw) throw new StorageWriteError('verify', 'txn read-back mismatch', { key: KEYS.txn, phase: 'txn' });
    } catch (error) {
      if (isInterrupted(error)) throw error;
      // 数据键一个都没动；尽量清掉可能写了一半的 txn。
      try {
        if (rawGet(KEYS.txn) !== null) rawRemove(KEYS.txn);
      } catch (cleanupError) {
        if (isInterrupted(cleanupError)) throw cleanupError;
      }
      throw toWriteError(error, KEYS.txn, 'txn');
    }

    const attempted = [];
    let failure = null;
    try {
      for (const [key, raw] of todo) {
        attempted.push(key);
        try {
          if (raw === null) rawRemove(key);
          else rawSet(key, raw);
        } catch (error) {
          throw toWriteError(error, key, 'write');
        }
      }
      for (const [key, raw] of todo) {
        let back;
        try {
          back = rawGet(key);
        } catch (error) {
          throw toWriteError(error, key, 'verify');
        }
        if (back !== raw) throw new StorageWriteError('verify', `read-back mismatch at ${key}`, { key, phase: 'verify' });
      }
      try {
        rawRemove(KEYS.txn);
      } catch (error) {
        if (isInterrupted(error)) throw error;
        try {
          rawSet(KEYS.txn, JSON.stringify(Object.assign({}, txn, { phase: 'done' })));
        } catch (markError) {
          if (isInterrupted(markError)) throw markError;
          throw toWriteError(error, KEYS.txn, 'finalize');
        }
      }
    } catch (error) {
      if (isInterrupted(error)) throw error;
      failure = toWriteError(error, null, 'write');
    }
    if (!failure) return { written: keys, label };

    const rb = rollback(txn, attempted, failure);
    if (!rb.ok) {
      throw new BlockingStorageError(`rollback failed for ${rb.keys.join(', ')}`, { keys: rb.keys, cause: failure });
    }
    throw failure;
  }

  /**
   * 单键原子写（不写 txn），见文件头。成功返回 {written:[key]|[], label}；失败抛 StorageWriteError（已恢复原值）
   * 或 BlockingStorageError（恢复失败）。
   */
  function writeOne(key, raw, { label = 'write-one' } = {}) {
    if (halted) throw new StorageWriteError('interrupted', 'storage halted by interruptAfterWrite', { phase: 'halted' });
    if (blocked) throw new BlockingStorageError('storage is blocked after a failed rollback', { keys: blocked.keys });
    const [[k, value]] = normalizeEntries([[key, raw]]);
    let before;
    try {
      before = rawGet(k);
    } catch (error) {
      throw toWriteError(error, k, 'read-prev');
    }
    if (before === value) return { written: [], label };
    let failure = null;
    try {
      try {
        if (value === null) rawRemove(k);
        else rawSet(k, value);
      } catch (error) {
        throw toWriteError(error, k, 'write');
      }
      let back;
      try {
        back = rawGet(k);
      } catch (error) {
        throw toWriteError(error, k, 'verify');
      }
      if (back !== value) throw new StorageWriteError('verify', `read-back mismatch at ${k}`, { key: k, phase: 'verify' });
    } catch (error) {
      if (isInterrupted(error)) throw error;
      failure = toWriteError(error, k, 'write');
    }
    if (!failure) return { written: [k], label };
    const rb = rollback({ label: String(label), at: now(), keys: [k], prev: { [k]: before }, phase: 'writing' }, [k], failure);
    if (!rb.ok) throw new BlockingStorageError(`rollback failed for ${rb.keys.join(', ')}`, { keys: rb.keys, cause: failure });
    throw failure;
  }

  /**
   * 路由提示单键写（见文件头）。raw: JSON 字串或 null（删除）。永不抛错（参数类型错除外）：
   * 返回 {ok:true, written:boolean} | {ok:false, kind:'quota'|'security'|'unknown'|'blocked'|'interrupted'}。
   */
  function writeRoute(raw) {
    if (raw !== null && typeof raw !== 'string') throw new TypeError('writeRoute value must be a string or null');
    if (halted) return { ok: false, kind: 'interrupted' };
    if (blocked) return { ok: false, kind: 'blocked' };
    const key = KEYS.route;
    try {
      if (rawGet(key) === raw) return { ok: true, written: false };
      const injected = raw === null ? null : takeInjectedFailure(key, { explicitOnly: true });
      if (injected) throw injected;
      driverDepth += 1;
      try {
        if (raw === null) be().removeItem(key);
        else be().setItem(key, raw);
      } finally {
        driverDepth -= 1;
      }
      return { ok: true, written: true };
    } catch (error) {
      return { ok: false, kind: classifyStorageError(error) };
    }
  }

  /**
   * 启动修复。返回报告：
   *   txn: 'none' | 'rolled-back' | 'completed' | 'corrupt' | 'blocked'
   *   quarantined: [{key, reason}]   本次新隔离的坏值（提示标记据此只置一次）
   *   quarantineFailed: [{key, reason}]
   *   unknown: [key]                 v2 命名空间里不认识的键（不动）
   */
  function repair() {
    const report = { txn: 'none', quarantined: [], quarantineFailed: [], unknown: [], dropped: [], blocked: false };
    const txnRaw = read(KEYS.txn);
    if (txnRaw !== null) {
      const parsed = parseAndValidate(KEYS.txn, txnRaw);
      if (!parsed.ok) {
        // 日志本身坏了，无法判断写前写后；隔离它，后续逐键形状校验兜底。
        report.txn = 'corrupt';
        if (!quarantine(KEYS.txn, txnRaw)) report.quarantineFailed.push({ key: KEYS.txn, reason: parsed.reason });
      } else if (parsed.value.phase === 'done') {
        report.txn = 'completed';
        try {
          rawRemove(KEYS.txn);
        } catch (error) {
          if (isInterrupted(error)) throw error;
        }
      } else {
        const rb = rollback(parsed.value, parsed.value.keys, null);
        report.txn = rb.ok ? 'rolled-back' : 'blocked';
        report.blocked = !rb.ok;
      }
    }
    try {
      if (rawGet(KEYS.probe) !== null) rawRemove(KEYS.probe);
    } catch (error) {
      if (isInterrupted(error)) throw error;
    }
    for (const key of listKeys(V2_PREFIX)) {
      if (key === KEYS.txn || key === KEYS.probe) continue;
      const spec = specForKey(key);
      if (!spec) {
        report.unknown.push(key);
        continue;
      }
      const raw = rawGet(key);
      if (raw === null) continue;
      const parsed = parseAndValidate(key, raw);
      if (parsed.ok) continue;
      if (key === KEYS.route) {
        // 路由提示坏了：直接删，不隔离、不提示（审查整改 F1）。
        try {
          rawRemove(key);
          report.dropped.push(key);
        } catch (error) {
          if (isInterrupted(error)) throw error;
        }
        continue;
      }
      if (quarantine(key, raw)) report.quarantined.push({ key, reason: parsed.reason });
      else report.quarantineFailed.push({ key, reason: parsed.reason });
    }
    lastRepair = report;
    return report;
  }

  /** 读/写可用性探测：{ok:true} | {ok:false, kind}。 */
  function probe() {
    try {
      const token = String(now());
      rawSet(KEYS.probe, token);
      const back = rawGet(KEYS.probe);
      rawRemove(KEYS.probe);
      if (back !== token) return { ok: false, kind: 'unknown' };
      return { ok: true };
    } catch (error) {
      return { ok: false, kind: classifyStorageError(error), error };
    }
  }

  /**
   * 非事务地删除一批键（只给测试钩子 reset() 与「备份导入成功后清理 shizi.corrupt.*」用）。
   * 返回删掉的键；失败的键跳过。
   */
  function removeKeys(keys) {
    const removed = [];
    for (const key of keys) {
      try {
        rawRemove(key);
        removed.push(key);
      } catch (error) {
        if (isInterrupted(error)) throw error;
      }
    }
    return removed;
  }

  return {
    get backend() {
      return be();
    },
    read,
    readAll,
    listKeys,
    writeAll,
    writeOne,
    writeRoute,
    repair,
    probe,
    removeKeys,
    estimateUsage(budgets) {
      return estimateUsage(readAll(''), budgets);
    },
    get blocked() {
      return blocked;
    },
    get halted() {
      return halted;
    },
    get lastRepair() {
      return lastRepair;
    },

    // ---- 故障注入（只由 test-hooks 在 isTestHost() 下调用）
    /** 接下来 n 次匹配 matchKey 的 setItem 抛错。kind: 'quota' | 'generic' | 'security'；matchKey 可带尾 '*' 做前缀匹配。 */
    failNextWrite(n = 1, { kind = 'generic', matchKey = null } = {}) {
      const count = Math.max(0, Math.floor(Number(n) || 0));
      if (count > 0) failQueue.push({ remaining: count, kind, matchKey: matchKey || null });
    },
    /** 从现在起第 k 次写（setItem/removeItem，含 txn）成功后「进程中断」：之后一切写都抛 interrupted，且不回滚。 */
    interruptAfterWrite(k) {
      const count = Math.floor(Number(k) || 0);
      interruptAfter = count > 0 ? count : null;
    },
    /** 清除全部注入与中断状态（不清阻断）。 */
    clearFaults() {
      failQueue = [];
      interruptAfter = null;
      halted = false;
    },
  };
}
