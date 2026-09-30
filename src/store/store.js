// 单例状态 + commit() 事务 + 订阅（01-架构设计 §4）。
//
// commit(label, mutate) → {ok:true, keys, recovered} | {ok:false, error:{kind, key?, reason?, label}}
//   1. 按域浅拷贝出草稿（copy-on-write）：每个域的顶层容器是新的，里面的值与已发布状态共享且已冻结——
//      mutate 要改某条记录/会话就整体替换它（draft.sessions.A = {...draft.sessions.A, cursor: 3}），
//      就地改已冻结对象会抛 TypeError，commit 返回 {ok:false, error:{kind:'mutator'}}。
//   2. mutate(draft, ctx)；ctx = {now, label, nextId(prefix)}；nextId('r'|'s') 分配记录/会话 id（共用序号，01 §3.1）。
//   3. 计算脏键（序列化后与上次落盘的字串比较）→ 对脏键做形状校验（core/schema.js）。
//   4. 写前估算：超预算（records/ink/400 天）先按 budget.js 回收一次。
//   5. storage.writeAll；撞配额 → 按 budget.js 强制回收一次再重试；仍失败返回 {ok:false}。
//   6. 只有写成功才替换内存状态（冻结）并通知订阅者。写失败不发布（D07）。
//
// 状态形状：{meta, records:{'YYYY-MM': Record[] | folded}, sched, ink, custom, wordOff, settings, photos,
//            legacy, backupMeta, sessions, funnel, safety}；缺的域为 null，records 至少是 {}。

import {
  BACKUP_WHITELIST, DOMAINS, KEYS, V2_PREFIX, CORRUPT_PREFIX,
  isPlainObject, isRecordsKey, keyForDomain, monthOfRecordsKey, parseAndValidate, parseBackupV2, serialOf, specForKey, validateValue,
} from '../core/schema.js';
import { BlockingStorageError, createStorage } from './storage.js';
import { entryBytes, needsRecovery, recover, resolveBudgets } from './budget.js';
import { now as envNow } from '../platform/env.js';

// ---------------------------------------------------------------- 工具

export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

export function emptyState() {
  const state = {};
  for (const domain of DOMAINS) state[domain] = domain === 'records' ? {} : null;
  return state;
}

function shallowCopy(value) {
  if (Array.isArray(value)) return value.slice();
  if (isPlainObject(value)) return Object.assign({}, value);
  return value;
}

/** 按域浅拷贝；records 再下一层（每月数组/折叠对象）也拷贝，方便 push。 */
function buildDraft(state) {
  const draft = {};
  for (const domain of DOMAINS) {
    const value = state[domain];
    if (domain === 'records') {
      const map = {};
      for (const month of Object.keys(value || {})) map[month] = shallowCopy(value[month]);
      draft.records = map;
    } else {
      draft[domain] = value === undefined ? null : shallowCopy(value);
    }
  }
  return draft;
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || a[k] !== b[k]) return false;
    return true;
  }
  return false;
}

function isEmptyMonth(value) {
  return Array.isArray(value) && value.length === 0;
}

/** 状态 → Map<key, value>（空月份、null 域不出现）。 */
function stateToEntries(state) {
  const map = new Map();
  for (const domain of DOMAINS) {
    const value = state[domain];
    if (domain === 'records') {
      for (const month of Object.keys(value || {})) {
        if (value[month] === null || value[month] === undefined || isEmptyMonth(value[month])) continue;
        map.set(keyForDomain('records', month), value[month]);
      }
    } else if (value !== null && value !== undefined) {
      map.set(keyForDomain(domain), value);
    }
  }
  return map;
}

/** 已用序号的最大值：meta.serial、records（含折叠 kept）、sessions、ink 键。 */
export function deriveSerial(state) {
  let max = state.meta && Number.isInteger(state.meta.serial) ? state.meta.serial : 0;
  const bump = id => {
    const s = serialOf(id);
    if (s > max) max = s;
  };
  for (const month of Object.keys(state.records || {})) {
    const value = state.records[month];
    const list = Array.isArray(value) ? value : value && Array.isArray(value.kept) ? value.kept : [];
    for (const rec of list) bump(rec.id);
  }
  const sessions = state.sessions;
  if (sessions) {
    const all = [sessions.A, sessions.B, sessions.lastEnded && sessions.lastEnded.A, sessions.lastEnded && sessions.lastEnded.B];
    for (const s of all) {
      if (!s) continue;
      bump(s.id);
      for (const item of s.items || []) if (item.recordId) bump(item.recordId);
      if (s.lastLine && s.lastLine.recordId) bump(s.lastLine.recordId);
    }
  }
  for (const id of Object.keys(state.ink || {})) bump(id);
  return max;
}

/** meta.months 与 records 的非空月份保持一致；空月份从草稿里删掉。 */
function syncMonths(draft) {
  for (const month of Object.keys(draft.records)) {
    if (draft.records[month] === null || draft.records[month] === undefined || isEmptyMonth(draft.records[month])) delete draft.records[month];
  }
  if (!isPlainObject(draft.meta)) return;
  const months = Object.keys(draft.records).sort();
  const current = Array.isArray(draft.meta.months) ? draft.meta.months : [];
  if (current.length === months.length && current.every((m, i) => m === months[i])) return;
  draft.meta = Object.assign({}, draft.meta, { months });
}

function errorResult(kind, label, extra) {
  return { ok: false, error: Object.assign({ kind, label }, extra || {}) };
}

// ---------------------------------------------------------------- store

/**
 * @param {{storage?: object, now?: () => number, budgets?: object, freeze?: boolean}} options
 */
export function createStore({ storage = createStorage(), now = envNow, budgets = null, freeze = true } = {}) {
  let state = deepFreeze(emptyState());
  let lastRaw = new Map(); // 上次落盘（或读入）的 v2 域键 → 原始字串
  let lastValues = new Map(); // 同一批键 → 已发布（冻结）的值
  let serial = 0;
  const listeners = new Set();
  const budgetConfig = resolveBudgets(budgets);
  const status = {
    available: true,
    unavailableKind: null,
    blocked: null,
    corruptNotice: null, // null 或 {keys:[…]}；只在本次启动新隔离了坏值时置一次
    usage: null,
    lastRepair: null,
  };

  const publishFreeze = value => (freeze ? deepFreeze(value) : value);

  function notify(info) {
    for (const fn of Array.from(listeners)) {
      try {
        fn(state, info);
      } catch (error) {
        // 订阅者异常不影响已提交的状态
        if (typeof console !== 'undefined') console.error('[shizi] store listener failed', error);
      }
    }
  }

  function refreshUsage() {
    try {
      status.usage = storage.estimateUsage(budgetConfig);
    } catch (error) {
      status.usage = null;
    }
    return status.usage;
  }

  function readState() {
    const next = emptyState();
    const raws = new Map();
    for (const [key, raw] of storage.readAll(V2_PREFIX)) {
      const spec = specForKey(key);
      if (!spec || !spec.domain || raw === null) continue;
      const parsed = parseAndValidate(key, raw);
      if (!parsed.ok) continue; // repair() 已隔离；这里只防御
      if (spec.domain === 'records') next.records[monthOfRecordsKey(key)] = parsed.value;
      else next[spec.domain] = parsed.value;
      raws.set(key, raw);
    }
    return { next, raws };
  }

  /**
   * 启动：探测 → repair() → 读全部 v2 键。返回 {available, repair, corruptNotice}。
   * 存储不可用时 status.available=false，之后 commit 一律 {ok:false, kind:'unavailable'}（R-B09 由 UI 处理）。
   */
  function load() {
    const probe = storage.probe();
    if (!probe.ok) {
      status.available = false;
      status.unavailableKind = probe.kind;
      state = deepFreeze(emptyState());
      lastRaw = new Map();
      lastValues = new Map();
      notify({ type: 'status' });
      return { available: false, kind: probe.kind };
    }
    status.available = true;
    status.unavailableKind = null;
    let report;
    try {
      report = storage.repair();
    } catch (error) {
      status.available = false;
      status.unavailableKind = error && error.kind ? error.kind : 'unknown';
      notify({ type: 'status' });
      return { available: false, kind: status.unavailableKind };
    }
    status.lastRepair = report;
    status.blocked = storage.blocked ? { reason: storage.blocked.reason, keys: storage.blocked.keys } : null;
    if (report.quarantined.length) status.corruptNotice = { keys: report.quarantined.map(q => q.key) };
    const { next, raws } = readState();
    state = publishFreeze(next);
    lastRaw = raws;
    lastValues = stateToEntries(state);
    serial = deriveSerial(state);
    refreshUsage();
    notify({ type: 'load' });
    return { available: true, repair: report, corruptNotice: status.corruptNotice };
  }

  /**
   * 计算脏键条目并校验形状。
   * 冻结模式下，值与上次发布的值浅相等（同一批冻结引用）即视为未变，直接复用上次的字串，
   * 避免每次提交都把 records/ink/sched（合计可达 3MB）重新序列化。
   */
  function plan(draft) {
    const next = stateToEntries(draft);
    const entries = [];
    const raws = new Map();
    for (const [key, value] of next) {
      let raw;
      if (freeze && lastRaw.has(key) && shallowEqual(lastValues.get(key), value)) {
        raws.set(key, lastRaw.get(key));
        continue;
      }
      try {
        raw = JSON.stringify(value);
      } catch (error) {
        return { error: { kind: 'shape', key, reason: `${key}: not serializable` } };
      }
      raws.set(key, raw);
      if (lastRaw.get(key) === raw) continue;
      const err = validateValue(key, value);
      if (err) return { error: { kind: 'shape', key, reason: err } };
      entries.push([key, raw]);
    }
    for (const key of lastRaw.keys()) if (!next.has(key)) entries.push([key, null]);
    return { entries, raws };
  }

  function projectedTotal(entries) {
    const base = status.usage ? status.usage.total : 0;
    let delta = 0;
    for (const [key, raw] of entries) delta += entryBytes(key, raw) - entryBytes(key, lastRaw.get(key));
    return base + delta;
  }

  /**
   * 撞配额后要腾出的量 = 本次提交的净增长（新值比原值多出的字节）+ 1KiB 余量。
   * 写入顺序里 ink 最先写：把 ink 缩掉这么多，之后每一步的累计占用都不超过「写 txn 之后」那一刻。
   */
  function quotaNeedBytes(entries) {
    let total = 1024;
    for (const [key, raw] of entries) total += Math.max(0, entryBytes(key, raw) - entryBytes(key, lastRaw.get(key)));
    return total;
  }

  /** 撞配额时只允许回收本次已经要写的键（见 budget.recover 的 limit）。 */
  function dirtyLimit(entries) {
    const months = [];
    let ink = false;
    for (const [key] of entries) {
      if (key === KEYS.ink) ink = true;
      else if (isRecordsKey(key)) months.push(monthOfRecordsKey(key));
    }
    return { ink, months };
  }

  function sizesOf(raws) {
    let records = 0;
    let ink = 0;
    for (const [key, raw] of raws) {
      if (isRecordsKey(key)) records += entryBytes(key, raw);
      else if (key === KEYS.ink) ink = entryBytes(key, raw);
    }
    return { records, ink };
  }

  function write(entries, label) {
    try {
      storage.writeAll(entries, { label });
      return null;
    } catch (error) {
      if (error instanceof BlockingStorageError) {
        status.blocked = { reason: 'rollback-failed', keys: error.keys };
        notify({ type: 'status' });
        return { kind: 'blocked', key: null, reason: error.message };
      }
      return { kind: error && error.kind ? error.kind : 'unknown', key: error && error.key ? error.key : null, reason: error && error.message ? error.message : String(error) };
    }
  }

  function publish(draft, raws, nextSerial, info) {
    state = publishFreeze(draft);
    lastRaw = raws;
    lastValues = stateToEntries(state);
    serial = nextSerial;
    refreshUsage();
    notify(info);
  }

  /** 写草稿（commit/seed/replace 共用）。allowRecover=false 时不做预算回收。 */
  function persist(draft, label, nextSerial, { allowRecover = true } = {}) {
    const nowMs = now();
    syncMonths(draft);
    let p = plan(draft);
    if (p.error) return errorResult(p.error.kind, label, { key: p.error.key, reason: p.error.reason });
    if (!p.entries.length) {
      publish(draft, p.raws, nextSerial, { type: 'commit', label, keys: [] });
      return { ok: true, keys: [], recovered: [] };
    }
    const recovered = [];
    if (allowRecover) {
      const need = needsRecovery(draft, { now: nowMs, budgets: budgetConfig, totalBytes: projectedTotal(p.entries), sizes: sizesOf(p.raws) });
      if (need.any) {
        const r = recover(draft, { now: nowMs, budgets: budgetConfig });
        if (r.actions.length) {
          recovered.push(...r.actions);
          syncMonths(draft);
          p = plan(draft);
          if (p.error) return errorResult(p.error.kind, label, { key: p.error.key, reason: p.error.reason });
        }
      }
    }
    let failure = write(p.entries, label);
    // txn 本身都写不下时回收帮不上忙（txn 里是原值副本，回收不会让它变小）。
    if (failure && failure.kind === 'quota' && allowRecover && failure.key !== KEYS.txn) {
      const r = recover(draft, { now: nowMs, budgets: budgetConfig, force: true, needBytes: quotaNeedBytes(p.entries), limit: dirtyLimit(p.entries) });
      if (r.actions.length) {
        recovered.push(...r.actions);
        syncMonths(draft);
        p = plan(draft);
        if (p.error) return errorResult(p.error.kind, label, { key: p.error.key, reason: p.error.reason });
        failure = write(p.entries, label);
      }
    }
    if (failure) {
      refreshUsage();
      return errorResult(failure.kind, label, { key: failure.key, reason: failure.reason, recoveredAttempted: recovered.length > 0 });
    }
    const keys = p.entries.map(([key]) => key);
    publish(draft, p.raws, nextSerial, { type: 'commit', label, keys, recovered });
    return { ok: true, keys, recovered };
  }

  function guard(label) {
    if (!status.available) return errorResult('unavailable', label, { reason: status.unavailableKind });
    if (status.blocked) return errorResult('blocked', label, { keys: status.blocked.keys });
    return null;
  }

  function commit(label, mutate) {
    const blockedResult = guard(label);
    if (blockedResult) return blockedResult;
    if (typeof mutate !== 'function') throw new TypeError('commit(label, mutate) needs a function');
    const draft = buildDraft(state);
    let nextSerial = serial;
    const ctx = {
      now: now(),
      label,
      nextId(prefix) {
        if (prefix !== 'r' && prefix !== 's') throw new Error(`nextId prefix must be 'r' or 's', got ${prefix}`);
        nextSerial += 1;
        return `${prefix}${nextSerial}`;
      },
    };
    try {
      mutate(draft, ctx);
    } catch (error) {
      return errorResult('mutator', label, { reason: error && error.message ? error.message : String(error) });
    }
    for (const domain of Object.keys(draft)) {
      if (DOMAINS.indexOf(domain) < 0) return errorResult('shape', label, { reason: `unknown domain ${domain}` });
    }
    if (!isPlainObject(draft.records)) return errorResult('shape', label, { reason: 'records must be an object' });
    if (nextSerial !== serial && isPlainObject(draft.meta) && draft.meta.serial !== nextSerial) {
      draft.meta = Object.assign({}, draft.meta, { serial: nextSerial });
    }
    return persist(draft, label, nextSerial);
  }

  function normalizeInput(input) {
    if (!isPlainObject(input)) return { error: 'state must be an object' };
    for (const key of Object.keys(input)) if (DOMAINS.indexOf(key) < 0) return { error: `unknown domain ${key}` };
    let copy;
    try {
      copy = JSON.parse(JSON.stringify(input));
    } catch (error) {
      return { error: 'state is not JSON-serializable' };
    }
    const draft = emptyState();
    for (const domain of DOMAINS) {
      if (!Object.prototype.hasOwnProperty.call(copy, domain) || copy[domain] === null) continue;
      draft[domain] = copy[domain];
    }
    if (!isPlainObject(draft.records)) return { error: 'records must be an object of months' };
    return { draft };
  }

  /**
   * 测试钩子 seed：整体替换全部 v2 域（未给出的域删除），走形状校验 + writeAll，不做预算回收。
   */
  function seed(input, { label = 'test-seed' } = {}) {
    const blockedResult = guard(label);
    if (blockedResult) return blockedResult;
    const n = normalizeInput(input);
    if (n.error) return errorResult('shape', label, { reason: n.error });
    // meta.months 按给定 records 同步，让种子不必手写
    return persist(n.draft, label, deriveSerial(n.draft), { allowRecover: false });
  }

  /**
   * 用 v2 备份替换全部白名单域（sessions/funnel/safety 保持不动）。任一键坏 → 整单拒绝，不调用 writeAll。
   * 成功后清理 shizi.corrupt.*（01 §3.6）。保护副本、确认、撤销底栏属于 M4-4 backup.js 的编排。
   */
  function replaceWithBackup(obj, { label = 'restore-backup' } = {}) {
    const blockedResult = guard(label);
    if (blockedResult) return blockedResult;
    const parsed = parseBackupV2(obj);
    if (!parsed.ok) return errorResult('invalid', label, { reason: parsed.reason, key: parsed.key || null, detail: parsed.detail || null });
    const draft = buildDraft(state);
    for (const domain of BACKUP_WHITELIST) draft[domain] = domain === 'records' ? {} : null;
    for (const [key, raw] of parsed.entries) {
      const spec = specForKey(key);
      const value = JSON.parse(raw);
      if (spec.domain === 'records') draft.records[monthOfRecordsKey(key)] = value;
      else draft[spec.domain] = value;
    }
    const nextSerial = deriveSerial(draft);
    const result = persist(draft, label, Math.max(nextSerial, serial), { allowRecover: false });
    if (result.ok) {
      try {
        storage.removeKeys(storage.listKeys(CORRUPT_PREFIX));
      } catch (error) {
        // 清理失败不影响替换结果
      }
      status.corruptNotice = null;
      refreshUsage();
    }
    return result;
  }

  return {
    load,
    /** 重新从存储读（测试钩子 reset 之后等）。 */
    reload: load,
    getState: () => state,
    commit,
    seed,
    replaceWithBackup,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get status() {
      return {
        available: status.available,
        unavailableKind: status.unavailableKind,
        blocked: status.blocked,
        corruptNotice: status.corruptNotice,
        usage: status.usage,
        lastRepair: status.lastRepair,
      };
    },
    /** 坏值顶部提示显示过后调用；本次启动不再提示。 */
    ackCorruptNotice() {
      status.corruptNotice = null;
    },
    get serial() {
      return serial;
    },
    get storage() {
      return storage;
    },
    budgets: budgetConfig,
    refreshUsage,
  };
}

// ---------------------------------------------------------------- 启动便捷入口

let activeStore = null;

/**
 * app.js 启动用：建 storage → onStorage(storage)（例如挂测试钩子，要在 repair 之前记录写日志）→ 建 store → load。
 */
export function bootStore({ backend = null, onStorage = null, budgets = null } = {}) {
  const storage = createStorage(backend, { now: envNow });
  if (typeof onStorage === 'function') onStorage(storage);
  const store = createStore({ storage, budgets });
  const report = store.load();
  activeStore = store;
  return { store, storage, report };
}

export function getStore() {
  if (!activeStore) throw new Error('store is not booted yet (call bootStore first)');
  return activeStore;
}

