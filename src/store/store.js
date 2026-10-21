// 单例状态 + commit() 事务 + 订阅（01-架构设计 §4）。
//
// commit(label, mutate, {reclaim?, replace?}) → {ok:true, keys, recovered} | {ok:false, error:{kind, key?, reason?, label}}
//   reclaim:false 跳过第 4、5 步的回收（撞配额直接 {ok:false, kind:'quota'}）——备份编排用，见 commit 注释。
//   1. 按域浅拷贝出草稿（copy-on-write）：每个域的顶层容器是新的，里面的值与已发布状态共享且已冻结——
//      mutate 要改某条记录/会话就整体替换它（draft.sessions.A = {...draft.sessions.A, cursor: 3}），
//      就地改已冻结对象会抛 TypeError，commit 返回 {ok:false, error:{kind:'mutator'}}。
//   2. mutate(draft, ctx)；ctx = {now, label, nextId(prefix)}；nextId('r'|'s') 分配记录/会话 id（共用序号，01 §3.1）。
//   3. 计算脏键（序列化后与上次落盘的字串比较）→ 对脏键做形状校验（core/schema.js）。
//   4. 写前估算：超预算（records/ink/400 天）先按 budget.js 回收一次。
//   5. storage.writeAll；撞配额 → 按 budget.js 强制回收一次再重试；仍失败返回 {ok:false}。
//      撞配额的回收分两路（ink 按月分键后，被淘汰的墨迹多半在本次没动的旧月键里）：
//      本次没动的键（旧 ink 月、旧 records 月）逐键用 storage.writeOne 单键原子写（不写 txn，小键先写）并立即发布——
//      若并进本次提交，txn 要多存一份它的原值，峰值反而更高；本次要写的键上的回收直接并进重试。
//   6. 只有写成功才替换内存状态（冻结）并通知订阅者。写失败不发布（D07）。
//
// 状态形状：{meta, records:{'YYYY-MM': Record[] | folded}, sched, ink:{'YYYY-MM': {[recordId]: Ink}}（Ink v3，读兼容 v2）, custom, wordOff,
//            settings, photos, legacy, backupMeta, sessions, funnel, safety}；缺的域为 null，records / ink 至少是 {}。
// ink 在内存里按记录所属月份分组（state.ink[月][id]，M0 验收 F3 裁定）；读写一律走 getInk / setInk / deleteInk，
// 不要自己拼月份——月份口径见 schema.inkMonthOf。
// B2.3 ink schema 2：落盘每条墨迹一个键 shizi.v2.ink.<月>.<id>（原生 SQLite ink_records 一行），setInk 只让这一条变脏、
// 只写这一条；值是 Ink v4 原始点（core/ink-math encodeInkRaw）。旧月键（schema 1）启动时逐月迁移（migrateInkSchema），
// 迁移前后 state 形状不变；备份文件仍按月分组（core/backup.js backupEntries 由 state 生成，与落盘键无关）。

import {
  BACKUP_WHITELIST, DOMAINS, KEYS, V2_PREFIX, CORRUPT_PREFIX,
  inkIdOf, inkKey, inkMonthOf, inkRecordKey, isInkStorageKey, isMonthKey, isMonthlyDomain, isPlainObject, isRecordId, isRecordsKey,
  keyForDomain, monthOfKey, parseAndValidate, parseBackupV2, parseInkRecordKey, serialOf, specForKey, validateInk, validateValue,
} from '../core/schema.js';
import { BlockingStorageError, createStorage } from './storage.js';
import { entryBytes, needsRecovery, recover, resolveBudgets } from './budget.js';
import { now as envNow } from '../platform/env.js';
import * as policy from '../config/policy.js';

// ---------------------------------------------------------------- 工具

export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

/**
 * 订阅通知是不是「整体替换」：load（启动 / 测试钩子 reset 后重读）或 seed / replaceWithBackup（info.replace）。
 * 页面里按旧状态取的本地现场（写字页笔画）遇到替换要丢弃、按新状态重取。
 */
export function isReplacement(info) {
  return !!info && (info.type === 'load' || info.replace === true);
}

export function emptyState() {
  const state = {};
  for (const domain of DOMAINS) state[domain] = isMonthlyDomain(domain) ? {} : null;
  return state;
}

function shallowCopy(value) {
  if (Array.isArray(value)) return value.slice();
  if (isPlainObject(value)) return Object.assign({}, value);
  return value;
}

/** 按域浅拷贝；records / ink 再下一层（每月数组/折叠对象/墨迹表）也拷贝，方便 push 与赋值。 */
function buildDraft(state) {
  const draft = {};
  for (const domain of DOMAINS) {
    const value = state[domain];
    if (isMonthlyDomain(domain)) {
      const map = {};
      for (const month of Object.keys(value || {})) map[month] = shallowCopy(value[month]);
      draft[domain] = map;
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

/** 空月份：records 的空数组、ink 的空表、null/undefined。空月份不落盘（键删除）。 */
function isEmptyMonth(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return isPlainObject(value) && value.folded !== true && Object.keys(value).length === 0;
}

/**
 * 状态 → Map<key, value>（空月份、null 域不出现）。
 * ink（B2.3 ink schema 2）：每条墨迹一个键 shizi.v2.ink.<月>.<id>；例外是 legacy 里还没迁移的旧月键——
 * 这个月的表与读入时浅相等（没动过）就仍按旧月键原样出现（不重写）；一旦有变化，这个月在本次提交里整体改成单条键、删掉旧月键。
 * @param {Map<string, object>|null} legacy  月份 → 读入时那张旧月表（null = 全部按单条键）
 */
function stateToEntries(state, legacy = null) {
  const map = new Map();
  for (const domain of DOMAINS) {
    const value = state[domain];
    if (domain === 'ink') {
      for (const month of Object.keys(value || {})) {
        const table = value[month];
        if (isEmptyMonth(table)) continue;
        if (legacy && legacy.has(month) && shallowEqual(legacy.get(month), table)) {
          map.set(inkKey(month), table);
          continue;
        }
        for (const id of Object.keys(table)) map.set(inkRecordKey(month, id), table[id]);
      }
    } else if (isMonthlyDomain(domain)) {
      for (const month of Object.keys(value || {})) {
        if (isEmptyMonth(value[month])) continue;
        map.set(keyForDomain(domain, month), value[month]);
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
  const ink = state.ink || {};
  for (const month of Object.keys(ink)) for (const id of Object.keys(ink[month] || {})) bump(id);
  return max;
}

/** meta.months 与 records 的非空月份保持一致（ink 月份不进 meta.months）；空月份从草稿里删掉。 */
function syncMonths(draft) {
  for (const month of Object.keys(draft.records)) {
    if (isEmptyMonth(draft.records[month])) delete draft.records[month];
  }
  if (isPlainObject(draft.ink)) {
    for (const month of Object.keys(draft.ink)) if (isEmptyMonth(draft.ink[month])) delete draft.ink[month];
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

// ---------------------------------------------------------------- 墨迹读写 helper（M1 起写字页/详情/图片用）

/**
 * 读一条记录的墨迹：state.ink[inkMonthOf(record)][inkIdOf(record)]；没有返回 null（10.12「没有笔迹」）。
 * state 可以是已发布状态或 commit 草稿。
 */
export function getInk(state, record) {
  const month = inkMonthOf(record);
  const id = inkIdOf(record);
  if (!month || !id || !state || !isPlainObject(state.ink)) return null;
  const table = state.ink[month];
  if (!isPlainObject(table) || !Object.prototype.hasOwnProperty.call(table, id)) return null;
  return table[id];
}

/**
 * 在 commit 草稿里写一条记录的墨迹（copy-on-write：替换月表，不就地改已冻结对象）。ink 为 null 等于 deleteInk。
 * 返回写入的月键 {month, id}；记录缺月份或 id 时抛错（commit 会返回 {ok:false, kind:'mutator'}）。
 */
export function setInk(draft, record, ink) {
  if (ink === null || ink === undefined) return deleteInk(draft, record);
  const month = inkMonthOf(record);
  const id = inkIdOf(record);
  if (!month || !id) throw new Error('setInk: record has no month or id');
  if (!isPlainObject(draft.ink)) draft.ink = {};
  const next = Object.assign({}, draft.ink[month] || {});
  next[id] = ink;
  draft.ink[month] = next;
  return { month, id };
}

/** 在 commit 草稿里删一条记录的墨迹；月表删空后该月键在落盘时移除。返回是否删到了。 */
export function deleteInk(draft, record) {
  const month = inkMonthOf(record);
  const id = inkIdOf(record);
  if (!month || !id || !isPlainObject(draft.ink) || !isPlainObject(draft.ink[month])) return false;
  if (!Object.prototype.hasOwnProperty.call(draft.ink[month], id)) return false;
  const next = Object.assign({}, draft.ink[month]);
  delete next[id];
  draft.ink[month] = next;
  return true;
}

// ---------------------------------------------------------------- store

/**
 * @param {{storage?: object, now?: () => number, budgets?: object, freeze?: boolean}} options
 */
export function createStore({ storage = createStorage(), now = envNow, budgets = null, freeze = true, backendInfo = null, inkFormat = null } = {}) {
  // B2.3：判断墨迹的存储编码（policy P05）：原生 SQLite 'raw'（Ink v4 原始点），localStorage 'v3'（容量）。经 commit 的 ctx.inkFormat 交给写墨的 mutate。
  const inkFormatOf = inkFormat || (storage && storage.kind === 'native' ? policy.nativeStorage.inkFormat : policy.inkFormat);
  let state = deepFreeze(emptyState());
  let lastRaw = new Map(); // 上次落盘（或读入）的 v2 域键 → 原始字串
  let lastValues = new Map(); // 同一批键 → 已发布（冻结）的值
  let legacyInk = new Map(); // B2.3：还没迁成单条键的旧 ink 月键（schema 1）：月份 → 读入时的月表
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
    // B1：这次启动用的是哪种持久化（'native' 原生 SQLite | 'localStorage'）及迁移 / 回退信息（store/native-boot.js prepareStorage）。
    backend: Object.assign({ kind: storage && storage.kind ? storage.kind : 'localStorage' }, backendInfo || {}),
    // B2.3：墨迹落盘形态。{schema: 2 | 1, legacyMonths, migrated?, records?, failed?, ms?}——schema 1 = 还有旧月键没迁完（迁移失败时 failed 记原因）。
    inkSchema: null,
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

  /**
   * 读全部 v2 键。ink：单条键（schema 2）按月拼回 state.ink[月][id]；旧月键（schema 1）整张表读入并记进 legacy
   * （同一个月两种键都有时——迁移只会整月原子地换，正常不会出现——单条键优先，这个月不再算 legacy，下次提交整月改成单条键）。
   */
  function readState() {
    const next = emptyState();
    const raws = new Map();
    const monthTables = new Map();
    const recordTables = new Map();
    for (const [key, raw] of storage.readAll(V2_PREFIX)) {
      const spec = specForKey(key);
      if (!spec || !spec.domain || raw === null) continue;
      const parsed = parseAndValidate(key, raw);
      if (!parsed.ok) continue; // repair() 已隔离；这里只防御
      raws.set(key, raw);
      if (spec.id === 'inkRecord') {
        const { month, id } = parseInkRecordKey(key);
        if (!recordTables.has(month)) recordTables.set(month, {});
        recordTables.get(month)[id] = parsed.value;
      } else if (spec.id === 'ink') {
        monthTables.set(monthOfKey(key), parsed.value);
      } else if (isMonthlyDomain(spec.domain)) {
        next[spec.domain][monthOfKey(key)] = parsed.value;
      } else {
        next[spec.domain] = parsed.value;
      }
    }
    const legacy = new Map();
    for (const month of new Set([...monthTables.keys(), ...recordTables.keys()])) {
      const old = monthTables.get(month);
      const rows = recordTables.get(month);
      next.ink[month] = Object.assign({}, old || {}, rows || {});
      if (old && !rows) legacy.set(month, old);
    }
    return { next, raws, legacy };
  }

  /**
   * B2.3 ink schema 1 → 2：把还在旧月键里的墨迹逐月改成单条键。每个月一次 storage.writeAll（一个原子事务：写这个月每一条 + 删旧月键），
   * 写前逐条形状校验（validateInk），写入时逐键读回核对（localStorage）/ 校验和 + 读回（原生）。
   * 任一月失败：这个月的事务回滚（旧月键原样还在，数据一字不丢），停止迁移，记 status.inkSchema.failed 与诊断（原生库 diag）；
   * 已迁完的月份保留。可重入：下次启动只迁剩下的旧月键；在那之前读写照常（没迁的月份按旧月键读，有改动的那次提交顺手整月迁掉）。
   */
  function migrateInkSchema() {
    const started = now();
    const months = Array.from(legacyInk.keys()).sort();
    const report = { schema: months.length ? 1 : 2, legacyMonths: months.length, migrated: 0, records: 0, failed: null };
    if (!months.length) return report;
    for (const month of months) {
      const table = state.ink[month];
      const entries = [];
      let bad = null;
      for (const id of Object.keys(table || {})) {
        const err = isRecordId(id) ? validateInk(table[id], `${month}.${id}`) : `${month}.${id}: bad record id`;
        if (err) {
          bad = { month, id, stage: 'validate', reason: err };
          break;
        }
        entries.push([inkRecordKey(month, id), JSON.stringify(table[id])]);
      }
      if (bad) {
        report.failed = bad;
        break;
      }
      entries.push([inkKey(month), null]);
      const failure = write(entries, 'ink-schema-2');
      if (failure) {
        report.failed = { month, stage: 'write', error: failure.kind, reason: failure.reason };
        break;
      }
      legacyInk.delete(month);
      for (const [key, raw] of entries) {
        if (raw === null) lastRaw.delete(key);
        else lastRaw.set(key, raw);
      }
      report.migrated += 1;
      report.records += entries.length - 1;
    }
    lastValues = stateToEntries(state, legacyInk);
    report.schema = legacyInk.size ? 1 : 2;
    report.ms = now() - started;
    if (report.failed) {
      if (typeof console !== 'undefined') console.warn('[shizi] ink schema 2 migration stopped:', JSON.stringify(report.failed));
      try {
        const backend = storage.backend;
        if (backend && typeof backend.diag === 'function') backend.diag(Object.assign({ kind: 'ink-schema-2-failed' }, report.failed));
      } catch (error) {
        // 诊断写不进去不影响启动
      }
    }
    return report;
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
      legacyInk = new Map();
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
    const { next, raws, legacy } = readState();
    state = publishFreeze(next);
    lastRaw = raws;
    legacyInk = legacy;
    lastValues = stateToEntries(state, legacyInk);
    serial = deriveSerial(state);
    status.inkSchema = status.blocked ? { schema: legacyInk.size ? 1 : 2, legacyMonths: legacyInk.size, migrated: 0, records: 0, failed: null } : migrateInkSchema();
    refreshUsage();
    notify({ type: 'load' });
    return { available: true, repair: report, corruptNotice: status.corruptNotice };
  }

  /**
   * 计算脏键条目并校验形状。
   * 冻结模式下，值与上次发布的值浅相等（同一批冻结引用）即视为未变，直接复用上次的字串，
   * 避免每次提交都把 records/ink/sched（合计可达 3MB）重新序列化。
   */
  function plan(draft, { convertAll = false } = {}) {
    const next = stateToEntries(draft, convertAll ? null : legacyInk);
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
   * 写入顺序里 ink 月键最先写：把 ink 缩掉这么多，之后每一步的累计占用都不超过「写 txn 之后」那一刻。
   */
  function quotaNeedBytes(entries) {
    let total = 1024;
    for (const [key, raw] of entries) total += Math.max(0, entryBytes(key, raw) - entryBytes(key, lastRaw.get(key)));
    return total;
  }

  /** 本次提交在 txn 里要存的原值字节（撞配额时这部分也要腾出来）。 */
  function txnBytes(entries) {
    let total = 0;
    for (const [key] of entries) total += entryBytes(key, lastRaw.get(key));
    return total;
  }

  /**
   * 撞配额后的「旁路回收」：recover 已改了草稿；其中本次提交**没有**要写的键（dirty 之外），
   * 各自用 storage.writeOne 单键写（小的先写，不写 txn）并立即发布到内存状态；写不进去的键在草稿里还原成已发布的值。
   * 这些写只会缩小或删除键（淘汰墨迹 / 折叠月份），单键原子，断电后要么旧值要么新值。
   * 返回 {written:[key], blocked: error|null}。
   */
  function persistSideRecovery(draft, dirty, label) {
    const next = stateToEntries(draft, legacyInk);
    const side = [];
    for (const [key, oldRaw] of lastRaw) {
      if (dirty.has(key)) continue;
      const spec = specForKey(key);
      if (!spec || !isMonthlyDomain(spec.domain)) continue; // recover 只动 records 月键与 ink
      // 旧 ink 月键（schema 1）不走旁路：它一变就要整月改成单条键（新键 + 删旧键必须在同一个事务里），留给主提交。
      if (spec.id === 'ink') continue;
      if (!next.has(key)) side.push({ key, raw: null, size: entryBytes(key, oldRaw) });
      else if (!shallowEqual(lastValues.get(key), next.get(key))) {
        const value = next.get(key);
        if (validateValue(key, value)) continue; // 形状不对就不写（不应发生）
        side.push({ key, raw: JSON.stringify(value), size: entryBytes(key, oldRaw) });
      }
    }
    side.sort((x, y) => x.size - y.size || (x.key < y.key ? -1 : 1));
    const written = [];
    for (const { key, raw } of side) {
      const spec = specForKey(key);
      const one = parseInkRecordKey(key); // 单条墨迹键：月表里的一条
      const month = one ? one.month : monthOfKey(key);
      const failure = write([[key, raw]], `${label}:recover`, { single: true });
      if (failure && failure.kind === 'blocked') return { written, blocked: failure };
      const published = state[spec.domain] || {};
      if (failure) {
        // 没写进去：草稿里还原成已发布的值，重试提交不带它。
        if (!isPlainObject(draft[spec.domain])) draft[spec.domain] = {};
        if (one) {
          const table = published[month];
          if (isPlainObject(table) && Object.prototype.hasOwnProperty.call(table, one.id)) {
            draft.ink[month] = Object.assign({}, draft.ink[month] || {}, { [one.id]: table[one.id] });
          }
        } else if (Object.prototype.hasOwnProperty.call(published, month)) {
          draft[spec.domain][month] = published[month];
        }
        continue;
      }
      const domainNext = Object.assign({}, published);
      if (one) {
        const table = Object.assign({}, published[month] || {});
        if (raw === null) delete table[one.id];
        else table[one.id] = next.get(key);
        if (Object.keys(table).length) domainNext[month] = table;
        else delete domainNext[month];
      } else if (raw === null) delete domainNext[month];
      else domainNext[month] = next.get(key);
      state = publishFreeze(Object.assign({}, state, { [spec.domain]: domainNext }));
      if (raw === null) lastRaw.delete(key);
      else lastRaw.set(key, raw);
      lastValues = stateToEntries(state, legacyInk);
      written.push(key);
    }
    if (written.length) {
      refreshUsage();
      notify({ type: 'recover', label, keys: written });
    }
    return { written, blocked: null };
  }

  function sizesOf(raws) {
    let records = 0;
    let ink = 0;
    for (const [key, raw] of raws) {
      if (isRecordsKey(key)) records += entryBytes(key, raw);
      else if (isInkStorageKey(key)) ink += entryBytes(key, raw);
    }
    return { records, ink };
  }

  function write(entries, label, { single = false } = {}) {
    try {
      if (single) storage.writeOne(entries[0][0], entries[0][1], { label });
      else storage.writeAll(entries, { label });
      return null;
    } catch (error) {
      if (error instanceof BlockingStorageError) {
        status.blocked = { reason: error.reason || 'rollback-failed', keys: error.keys };
        notify({ type: 'status' });
        return { kind: 'blocked', key: null, reason: error.message };
      }
      return { kind: error && error.kind ? error.kind : 'unknown', key: error && error.key ? error.key : null, reason: error && error.message ? error.message : String(error) };
    }
  }

  function publish(draft, raws, nextSerial, info) {
    state = publishFreeze(draft);
    lastRaw = raws;
    // 写成单条键（或整体替换）的月份不再是旧月键
    for (const month of Array.from(legacyInk.keys())) if (!raws.has(inkKey(month))) legacyInk.delete(month);
    if (legacyInk.size === 0 && status.inkSchema && status.inkSchema.schema === 1) status.inkSchema = Object.assign({}, status.inkSchema, { schema: 2 });
    lastValues = stateToEntries(state, legacyInk);
    serial = nextSerial;
    refreshUsage();
    notify(info);
  }

  /**
   * 写草稿（commit/seed/replace 共用）。allowRecover=false 时不做预算回收。
   * replace=true（seed / replaceWithBackup：整体替换，不是某一页自己的一步写入）时通知里带 replace:true，
   * 让持有本地现场的页面（写字页笔画）丢弃本地副本、按新状态重取（load 通知同理）。
   */
  function persist(draft, label, nextSerial, { allowRecover = true, replace = false } = {}) {
    const tag = replace ? { replace: true } : null;
    // 整体替换（seed / 恢复备份）一律写成单条墨迹键（不保留旧月键）
    const planOpts = { convertAll: replace };
    const nowMs = now();
    syncMonths(draft);
    let p = plan(draft, planOpts);
    if (p.error) return errorResult(p.error.kind, label, { key: p.error.key, reason: p.error.reason });
    if (!p.entries.length) {
      publish(draft, p.raws, nextSerial, { type: 'commit', label, keys: [], ...tag });
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
          p = plan(draft, planOpts);
          if (p.error) return errorResult(p.error.kind, label, { key: p.error.key, reason: p.error.reason });
        }
      }
    }
    let failure = write(p.entries, label);
    // txn 本身都写不下时回收帮不上忙（txn 里是原值副本，回收不会让它变小）。
    if (failure && failure.kind === 'quota' && allowRecover && failure.key !== KEYS.txn) {
      // 要腾出的量：本次净增长 + txn 里的原值副本（按 §9 优先级跨全部月键淘汰）。
      const dirty = new Set(p.entries.map(([key]) => key));
      const r = recover(draft, { now: nowMs, budgets: budgetConfig, force: true, needBytes: quotaNeedBytes(p.entries) + txnBytes(p.entries) });
      if (r.actions.length) {
        recovered.push(...r.actions);
        syncMonths(draft);
        const side = persistSideRecovery(draft, dirty, label);
        if (side.blocked) return errorResult('blocked', label, { key: side.blocked.key, reason: side.blocked.reason, recoveredAttempted: true });
        syncMonths(draft);
        p = plan(draft, planOpts);
        if (p.error) return errorResult(p.error.kind, label, { key: p.error.key, reason: p.error.reason });
        failure = write(p.entries, label);
      }
    }
    if (failure) {
      refreshUsage();
      return errorResult(failure.kind, label, { key: failure.key, reason: failure.reason, recoveredAttempted: recovered.length > 0 });
    }
    const keys = p.entries.map(([key]) => key);
    publish(draft, p.raws, nextSerial, { type: 'commit', label, keys, recovered, ...tag });
    return { ok: true, keys, recovered };
  }

  function guard(label) {
    if (!status.available) return errorResult('unavailable', label, { reason: status.unavailableKind });
    if (status.blocked) return errorResult('blocked', label, { keys: status.blocked.keys });
    return null;
  }

  /**
   * @param {string} label
   * @param {(draft, ctx) => void} mutate
   * @param {{reclaim?: boolean, replace?: boolean}} [options]
   *   reclaim:false —— 不做预算回收：不做写前估算回收、撞配额直接返回 {ok:false, error:{kind:'quota'}}、不做旁路回收
   *     （保护副本写/删、替换、撤销、清空用：它们失败时必须「你现在的记录没有变」，R-B04 / K03，不能顺手折叠旧月份）。
   *     其余（txn、逐键核对、回滚、发布）与默认相同。
   *   replace:true —— 通知里带 replace:true（整体替换：撤销 / 清空后持有本地现场的页面要按新状态重取，同 seed）。
   */
  function commit(label, mutate, { reclaim = true, replace = false } = {}) {
    const blockedResult = guard(label);
    if (blockedResult) return blockedResult;
    if (typeof mutate !== 'function') throw new TypeError('commit(label, mutate) needs a function');
    const draft = buildDraft(state);
    let nextSerial = serial;
    const ctx = {
      now: now(),
      label,
      inkFormat: inkFormatOf,
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
    if (draft.ink === null || draft.ink === undefined) draft.ink = {}; // 墨迹全删 = 空表（开关关闭时同样没有 ink 键）
    if (!isPlainObject(draft.ink)) return errorResult('shape', label, { reason: 'ink must be an object of months' });
    for (const domain of ['records', 'ink']) {
      for (const month of Object.keys(draft[domain])) {
        if (!isMonthKey(month)) return errorResult('shape', label, { reason: `${domain} month ${month} is not YYYY-MM` });
      }
    }
    if (nextSerial !== serial && isPlainObject(draft.meta) && draft.meta.serial !== nextSerial) {
      draft.meta = Object.assign({}, draft.meta, { serial: nextSerial });
    }
    return persist(draft, label, nextSerial, { allowRecover: reclaim !== false, replace: replace === true });
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
    for (const domain of ['records', 'ink']) {
      if (!isPlainObject(draft[domain])) return { error: `${domain} must be an object of months` };
      for (const month of Object.keys(draft[domain])) {
        if (!isMonthKey(month)) return { error: `${domain} month ${month} is not YYYY-MM` };
      }
    }
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
    return persist(n.draft, label, deriveSerial(n.draft), { allowRecover: false, replace: true });
  }

  /**
   * 用 v2 备份替换全部白名单域（funnel/safety 保持不动；sessions 默认不动）。任一键坏 → 整单拒绝，不调用 writeAll。
   * 不做预算回收（同 commit 的 reclaim:false）。成功后清理 shizi.corrupt.*（01 §3.6）。
   * mutate(draft)：可选，白名单域填好之后、落盘之前再改草稿（同一次 writeAll）——backup.js 用它结束进行中的组（P79）。
   * 保护副本、确认、撤销底栏属于 M4-4 backup.js 的编排。
   */
  function replaceWithBackup(obj, { label = 'restore-backup', mutate = null } = {}) {
    const blockedResult = guard(label);
    if (blockedResult) return blockedResult;
    const parsed = parseBackupV2(obj);
    if (!parsed.ok) return errorResult('invalid', label, { reason: parsed.reason, key: parsed.key || null, detail: parsed.detail || null });
    const draft = buildDraft(state);
    for (const domain of BACKUP_WHITELIST) draft[domain] = isMonthlyDomain(domain) ? {} : null;
    for (const [key, raw] of parsed.entries) {
      const spec = specForKey(key);
      const value = JSON.parse(raw);
      if (isMonthlyDomain(spec.domain)) draft[spec.domain][monthOfKey(key)] = value;
      else draft[spec.domain] = value;
    }
    if (typeof mutate === 'function') {
      try {
        mutate(draft);
      } catch (error) {
        return errorResult('mutator', label, { reason: error && error.message ? error.message : String(error) });
      }
    }
    const nextSerial = deriveSerial(draft);
    const result = persist(draft, label, Math.max(nextSerial, serial), { allowRecover: false, replace: true });
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
    /** 当前已发布状态里某条记录的墨迹（见 getInk）。 */
    getInk: record => getInk(state, record),
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
        backend: status.backend,
        inkSchema: status.inkSchema,
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
    /** 判断墨迹的存储编码（'raw' | 'v3'，见 createStore）。 */
    inkFormat: inkFormatOf,
    refreshUsage,
  };
}

// ---------------------------------------------------------------- 启动便捷入口

let activeStore = null;

/**
 * app.js 启动用：建 storage → onStorage(storage)（例如挂测试钩子，要在 repair 之前记录写日志）→ 建 store → load。
 * B1：backend / budgets / backendInfo 来自 store/native-boot.js prepareStorage（iOS 壳里是原生 SQLite 的镜像后端与原生口径的预算；
 * 网页与回退时 backend 为 null = localStorage）。
 */
export function bootStore({ backend = null, onStorage = null, budgets = null, backendInfo = null } = {}) {
  const storage = createStorage(backend, { now: envNow });
  if (typeof onStorage === 'function') onStorage(storage);
  const store = createStore({ storage, budgets, backendInfo });
  const report = store.load();
  activeStore = store;
  return { store, storage, report };
}

export function getStore() {
  if (!activeStore) throw new Error('store is not booted yet (call bootStore first)');
  return activeStore;
}

