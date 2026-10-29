// B4.4 的 JS 参考 op（store / storage / budget / backup / migrate / 原生校验和）。
// 与 ios/ShiziCore/Sources/ShiziCore/Engine/StoreOps.swift 同名、同参数校验、同错误码；规则一律直接调 src/，这里只做协议适配。
//
// 约定：
//   · 引擎里至多一个「store 会话」：store.open 建磁盘（localStorage 替身 MemoryStorage | 原生 SQLite 替身 FakeNativeDb，即 test/store 的两种后端）
//     + storage + store 并 load；store.reboot 在同一块磁盘上重新「启动」；reset 清掉会话。会话存在时状态快照多一个 store 段：
//     {backend, disk（按键排序的原始字串）, state, serial, status, notices（本步收到的订阅通知）, diag（原生）}。
//   · 时钟 = 引擎时钟（clock.set / clock.advance）：storage 与 store 的 now、提交的 ctx.now。
//   · mutate 用数据描述（store.commit 的 ops，见 applyMutation）；磁盘注入 failWhen 用规则表（见 makeFailWhen）。
//   · 存储层直接调用（writeAll / writeOne / repair …）抛错时回包 {ok:false, name, kind, key, message}，不当协议错误。
//   · policy：可选 `policy`（对象）= 浅覆盖 {...policy, ...patch}。
import * as basePolicy from '../../../src/config/policy.js';
import { createStore, deriveSerial, getInk, setInk, deleteInk } from '../../../src/store/store.js';
import { createStorage } from '../../../src/store/storage.js';
import * as budget from '../../../src/store/budget.js';
import * as backup from '../../../src/core/backup.js';
import * as migrate from '../../../src/store/migrate.js';
import { encodeStoredInk } from '../../../src/core/ink-math.js';
import { checksum, digestRows } from '../../../src/platform/native-store.js';
import { MemoryStorage } from '../../../test/store/helpers.mjs';
import { FakeNativeDb } from '../../../test/store/native-fake.mjs';

const has = (a, k) => Object.prototype.hasOwnProperty.call(a, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** 磁盘注入规则表 → failWhen 函数。规则 {op?, key?, prefix?, nth?, from?, verdict}；每条规则自己数命中次数。 */
export function makeFailWhen(rules) {
  const st = rules.map((r) => ({ r, hits: 0 }));
  return ({ op, key }) => {
    for (const s of st) {
      const r = s.r;
      if (has(r, 'op') && r.op !== op) continue;
      if (has(r, 'key') && r.key !== key) continue;
      if (has(r, 'prefix') && key.indexOf(r.prefix) !== 0) continue;
      s.hits += 1;
      const fire = has(r, 'nth') ? s.hits === r.nth : has(r, 'from') ? s.hits >= r.from : true;
      if (fire) return r.verdict;
    }
    return null;
  };
}

/** 调用期间把 Date.now 钉在引擎时钟上（inspectBackup 转换 v1 备份时不给 now，取 Date.now）。 */
function atClock(t, fn) {
  const real = Date.now;
  Date.now = () => t;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

export function makeB44Ops({ required, str, finite, int, badArgs, clock, setClock }) {
  let S = null; // {kind, disk, storage, store, notices}
  const now = () => clock();

  const optObj = (a, k) => {
    if (!has(a, k)) return undefined;
    if (!isObj(a[k])) throw badArgs(k + ' must be an object');
    return a[k];
  };
  const objArg = (a, k) => {
    const v = required(a, k);
    if (!isObj(v)) throw badArgs(k + ' must be an object');
    return v;
  };
  const arrArg = (a, k) => {
    const v = required(a, k);
    if (!Array.isArray(v)) throw badArgs(k + ' must be an array');
    return v;
  };
  const strArr = (a, k) => {
    const v = arrArg(a, k);
    if (v.some((x) => typeof x !== 'string')) throw badArgs(k + ' must be an array of strings');
    return v;
  };
  const optStr = (a, k) => {
    if (!has(a, k)) return undefined;
    if (typeof a[k] !== 'string') throw badArgs(k + ' must be a string');
    return a[k];
  };
  const optFinite = (a, k) => (has(a, k) ? finite(a[k], k) : undefined);
  const optBool = (a, k) => {
    if (!has(a, k)) return undefined;
    if (typeof a[k] !== 'boolean') throw badArgs(k + ' must be a boolean');
    return a[k];
  };
  const nowArg = (a) => (has(a, 'now') ? finite(a.now, 'now') : now());
  const policyOf = (a) => {
    const p = optObj(a, 'policy');
    return p ? { ...basePolicy, ...p } : basePolicy;
  };
  const rawOrNull = (a, k) => {
    const v = required(a, k);
    if (v !== null && typeof v !== 'string') throw badArgs(k + ' must be a string or null');
    return v;
  };
  const session = () => {
    if (!S) throw badArgs('store is not open');
    return S;
  };

  function openDisk(kind, a) {
    const initial = optObj(a, 'disk') || {};
    for (const k of Object.keys(initial)) if (typeof initial[k] !== 'string') throw badArgs('disk values must be strings');
    const quota = optFinite(a, 'quota');
    const opts = { initial, quotaBytes: quota === undefined ? Infinity : quota };
    return kind === 'native' ? new FakeNativeDb(opts) : new MemoryStorage(opts);
  }

  function boot(s) {
    const backend = s.kind === 'native' ? s.disk.open() : s.disk;
    s.storage = createStorage(backend, { now });
    const o = { storage: s.storage, now };
    if (s.budgets) o.budgets = s.budgets;
    if (s.inkFormat) o.inkFormat = s.inkFormat;
    s.store = createStore(o);
    s.store.subscribe((state, info) => s.notices.push(plain(info)));
    return s.store.load();
  }

  /** 错误对象 → 回包（存储层直接调用抛错时）。 */
  function errReply(error) {
    return { ok: false, name: String(error && error.name), kind: error && error.kind ? error.kind : null, key: error && error.key ? error.key : null, message: String(error && error.message) };
  }

  // ---- mutate 的数据描述（store.commit ops）
  function applyMutation(ops, draft, ctx) {
    let last = null;
    const recOf = (r) => (r === '$last' ? last : r);
    for (const m of ops) {
      switch (m.op) {
        case 'set':
          draft[m.domain] = m.value;
          break;
        case 'delete':
          delete draft[m.domain];
          break;
        case 'month': {
          if (!isObj(draft[m.domain])) throw new Error('mutation: ' + m.domain + ' is not an object');
          draft[m.domain][m.month] = m.value;
          break;
        }
        case 'append': {
          if (!isObj(draft.records)) throw new Error('mutation: records is not an object');
          const rec = { id: ctx.nextId('r'), ...m.record };
          const cur = draft.records[m.month];
          draft.records[m.month] = Array.isArray(cur) ? cur.concat([rec]) : [rec];
          last = rec;
          break;
        }
        case 'setInk':
          setInk(draft, recOf(m.record), m.ink);
          break;
        case 'deleteInk':
          deleteInk(draft, recOf(m.record));
          break;
        case 'judgeInk':
          setInk(draft, recOf(m.record), encodeStoredInk(m.strokes, { policy: basePolicy, format: ctx.inkFormat }));
          break;
        case 'nextId':
          ctx.nextId(m.prefix);
          break;
        case 'patch':
          draft[m.domain] = { ...(isObj(draft[m.domain]) ? draft[m.domain] : {}), [m.key]: m.value };
          break;
        case 'prune':
          budget.pruneInkOfCards(draft, m.cardKeys);
          break;
        case 'endSessions':
          backup.endActiveSessions(draft);
          break;
        case 'throw':
          throw new Error(m.message);
        default:
          throw new Error('mutation: unknown op ' + m.op);
      }
    }
  }

  function checkMutation(list) {
    const known = ['set', 'delete', 'month', 'append', 'setInk', 'deleteInk', 'judgeInk', 'nextId', 'patch', 'prune', 'endSessions', 'throw'];
    for (const m of list) {
      if (!isObj(m) || typeof m.op !== 'string' || known.indexOf(m.op) < 0) throw badArgs('ops must be mutation objects');
      if (['set', 'delete', 'month', 'patch'].indexOf(m.op) >= 0 && typeof m.domain !== 'string') throw badArgs('mutation domain must be a string');
      if ((m.op === 'month' || m.op === 'append') && typeof m.month !== 'string') throw badArgs('mutation month must be a string');
      if (m.op === 'patch' && typeof m.key !== 'string') throw badArgs('mutation key must be a string');
      if (m.op === 'append' && !isObj(m.record)) throw badArgs('mutation record must be an object');
      if (['setInk', 'deleteInk', 'judgeInk'].indexOf(m.op) >= 0 && m.record !== '$last' && !isObj(m.record)) throw badArgs('mutation record must be an object or $last');
      if (m.op === 'setInk' && !has(m, 'ink')) throw badArgs('mutation ink is missing');
      if (m.op === 'judgeInk' && (!Array.isArray(m.strokes) || m.strokes.some((s) => !Array.isArray(s) || s.some((p) => !isObj(p) || typeof p.x !== 'number' || typeof p.y !== 'number' || (has(p, 't') && typeof p.t !== 'number'))))) {
        throw badArgs('mutation strokes must be arrays of points');
      }
      if (m.op === 'nextId' && typeof m.prefix !== 'string') throw badArgs('mutation prefix must be a string');
      if (m.op === 'prune' && (!Array.isArray(m.cardKeys) || m.cardKeys.some((k) => typeof k !== 'string'))) throw badArgs('mutation cardKeys must be strings');
      if (m.op === 'throw' && typeof m.message !== 'string') throw badArgs('mutation message must be a string');
      if ((m.op === 'set' || m.op === 'month' || m.op === 'patch') && !has(m, 'value')) throw badArgs('mutation value is missing');
    }
  }

  function checkRules(list) {
    for (const r of list) {
      if (!isObj(r)) throw badArgs('fail rules must be objects');
      if (has(r, 'op') && r.op !== 'set' && r.op !== 'remove') throw badArgs('rule op must be set or remove');
      if (has(r, 'key') && typeof r.key !== 'string') throw badArgs('rule key must be a string');
      if (has(r, 'prefix') && typeof r.prefix !== 'string') throw badArgs('rule prefix must be a string');
      for (const k of ['nth', 'from']) if (has(r, k) && (!Number.isInteger(r[k]) || r[k] < 1 || r[k] > 1e6)) throw badArgs('rule ' + k + ' must be a positive integer');
      const v = r.verdict;
      if (!(v === 'quota' || v === 'security' || v === 'generic' || (isObj(v) && typeof v.corrupt === 'string'))) throw badArgs('rule verdict must be quota | security | generic | {corrupt}');
    }
  }

  /** 预算类 op 的状态形状（records：月 → 记录数组 | 折叠对象；ink：月 → 表）。 */
  const recList = (v) => Array.isArray(v) && v.every(isObj);
  function checkShape(state) {
    if (has(state, 'records') && state.records !== null) {
      if (!isObj(state.records)) throw badArgs('records must be an object of months');
      for (const m of Object.keys(state.records)) {
        const v = state.records[m];
        if (!(recList(v) || (isObj(v) && v.folded === true && recList(v.kept)))) throw badArgs('records months must be record lists');
      }
    }
    if (has(state, 'ink') && state.ink !== null) {
      if (!isObj(state.ink)) throw badArgs('ink must be an object of months');
      for (const m of Object.keys(state.ink)) if (!isObj(state.ink[m])) throw badArgs('ink months must be objects');
    }
    return state;
  }

  const budgetsOf = (a) => {
    const b = optObj(a, 'budgets');
    return b ? budget.resolveBudgets(b) : budget.resolveBudgets(null);
  };
  const tierOut = (t) => (t === Infinity ? 'Infinity' : t);

  const OPS = {
    // ---------------------------------------------------------------- store 会话
    'store.open': (a) => {
      const kind = str(a, 'backend');
      if (kind !== 'local' && kind !== 'native') throw badArgs('backend must be local or native');
      const budgets = optObj(a, 'budgets');
      const inkFormat = optStr(a, 'inkFormat');
      const disk = openDisk(kind, a);
      let rules = null;
      if (has(a, 'fail')) {
        rules = arrArg(a, 'fail');
        checkRules(rules);
      }
      if (rules) disk.failWhen(makeFailWhen(rules));
      if (has(a, 'clock')) setClock(finite(a.clock, 'clock'));
      S = { kind, disk, budgets: budgets || null, inkFormat: inkFormat || null, notices: [] };
      return boot(S);
    },
    'store.reboot': (a) => {
      const s = session();
      if (optBool(a, 'resume')) s.disk.resume();
      return boot(s);
    },
    'store.close': () => {
      S = null;
      return null;
    },
    'store.commit': (a) => {
      const s = session();
      const label = str(a, 'label');
      const ops = arrArg(a, 'ops');
      checkMutation(ops);
      const reclaim = optBool(a, 'reclaim');
      const replace = optBool(a, 'replace');
      const o = {};
      if (reclaim !== undefined) o.reclaim = reclaim;
      if (replace !== undefined) o.replace = replace;
      return s.store.commit(label, (draft, ctx) => applyMutation(ops, draft, ctx), o);
    },
    'store.seed': (a) => {
      const s = session();
      const input = required(a, 'state');
      const label = optStr(a, 'label');
      return s.store.seed(input, label === undefined ? {} : { label });
    },
    'store.replaceWithBackup': (a) => {
      const s = session();
      const obj = required(a, 'backup');
      const label = optStr(a, 'label');
      const end = optBool(a, 'endSessions');
      const o = {};
      if (label !== undefined) o.label = label;
      if (end) o.mutate = backup.endActiveSessions;
      return s.store.replaceWithBackup(obj, o);
    },
    'store.fault': (a) => {
      const s = session();
      let fail = null;
      if (has(a, 'failNextWrite')) {
        const f = objArg(a, 'failNextWrite');
        const n = finite(required(f, 'n'), 'n');
        const kind = has(f, 'kind') ? str(f, 'kind') : 'generic';
        if (kind !== 'quota' && kind !== 'generic' && kind !== 'security') throw badArgs('kind must be quota | generic | security');
        const matchKey = optStr(f, 'matchKey');
        fail = { n, kind, matchKey: matchKey === undefined ? null : matchKey };
      }
      const interrupt = has(a, 'interruptAfterWrite') ? finite(a.interruptAfterWrite, 'interruptAfterWrite') : undefined;
      const clear = optBool(a, 'clearFaults');
      if (fail) s.storage.failNextWrite(fail.n, { kind: fail.kind, matchKey: fail.matchKey });
      if (interrupt !== undefined) s.storage.interruptAfterWrite(interrupt);
      if (clear) s.storage.clearFaults();
      return null;
    },
    'store.disk': (a) => {
      const s = session();
      let rules;
      if (has(a, 'fail') && a.fail !== null) {
        rules = arrArg(a, 'fail');
        checkRules(rules);
      }
      const quota = has(a, 'quota') ? (a.quota === null ? Infinity : finite(a.quota, 'quota')) : undefined;
      const quotaRel = has(a, 'quotaRel') ? finite(a.quotaRel, 'quotaRel') : undefined;
      const interrupt = has(a, 'interrupt') ? int(a, 'interrupt', 1e6) : undefined;
      if (has(a, 'failReads') && a.failReads !== null && typeof a.failReads !== 'string') throw badArgs('failReads must be a string or null');
      let failOp = null;
      if (has(a, 'failOp')) {
        if (s.kind !== 'native') throw badArgs('failOp needs the native backend');
        const f = objArg(a, 'failOp');
        failOp = { op: str(f, 'op'), code: str(f, 'code'), after: has(f, 'after') ? optBool(f, 'after') : false, times: has(f, 'times') ? int(f, 'times', 100) : 1 };
      }
      const resume = optBool(a, 'resume');
      if (has(a, 'fail')) s.disk.failWhen(rules ? makeFailWhen(rules) : null);
      if (quota !== undefined) s.disk.quotaBytes = quota;
      if (quotaRel !== undefined) s.disk.quotaBytes = s.disk.usedBytes() + quotaRel;
      if (interrupt !== undefined) s.disk.interruptAfterWrites(interrupt);
      if (has(a, 'failReads')) s.disk.failReads(a.failReads);
      if (failOp) s.disk.failOp(failOp.op, failOp.code, { after: failOp.after, times: failOp.times });
      if (resume) s.disk.resume();
      return null;
    },
    'store.ackCorruptNotice': () => {
      session().store.ackCorruptNotice();
      return null;
    },
    'store.getInk': (a) => {
      const r = getInk(session().store.getState(), objArg(a, 'record'));
      return r === undefined ? null : r;
    },
    'store.refreshUsage': () => session().store.refreshUsage(),
    'store.writeRoute': (a) => session().storage.writeRoute(rawOrNull(a, 'raw')),
    'store.writeOne': (a) => {
      const s = session();
      const key = str(a, 'key');
      const raw = rawOrNull(a, 'raw');
      try {
        return { ok: true, written: s.storage.writeOne(key, raw, { label: 'diff-one' }).written };
      } catch (error) {
        return errReply(error);
      }
    },
    'store.writeAll': (a) => {
      const s = session();
      const entries = arrArg(a, 'entries');
      for (const e of entries) {
        if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string' || (e[1] !== null && typeof e[1] !== 'string')) throw badArgs('entries must be [key, raw|null] pairs');
      }
      const label = optStr(a, 'label');
      try {
        return { ok: true, written: s.storage.writeAll(entries, { label: label === undefined ? 'write' : label }).written };
      } catch (error) {
        return errReply(error);
      }
    },
    'store.repair': () => {
      const s = session();
      try {
        return { ok: true, report: s.storage.repair() };
      } catch (error) {
        return errReply(error);
      }
    },
    'store.removeKeys': (a) => {
      const s = session();
      const keys = strArr(a, 'keys');
      try {
        return { ok: true, removed: s.storage.removeKeys(keys) };
      } catch (error) {
        return errReply(error);
      }
    },

    // ---------------------------------------------------------------- budget（纯函数）
    'budget.entryBytes': (a) => budget.entryBytes(str(a, 'key'), rawOrNull(a, 'raw')),
    'budget.bucketOfKey': (a) => budget.bucketOfKey(str(a, 'key')),
    'budget.estimateUsage': (a) => {
      const pairs = arrArg(a, 'pairs');
      for (const p of pairs) if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string') throw badArgs('pairs must be [key, raw] pairs');
      return budget.estimateUsage(pairs, budgetsOf(a));
    },
    'budget.storagePressureOf': (a) => budget.storagePressureOf(required(a, 'usage')),
    'budget.inkBudgetOf': (a) => budget.inkBudgetOf(required(a, 'settings'), policyOf(a)),
    'budget.needsRecovery': (a) => {
      const state = checkShape(objArg(a, 'state'));
      const o = { now: nowArg(a), budgets: budgetsOf(a) };
      if (has(a, 'totalBytes')) o.totalBytes = finite(a.totalBytes, 'totalBytes');
      return budget.needsRecovery(state, o);
    },
    'budget.recover': (a) => {
      const draft = plain(checkShape(objArg(a, 'draft')));
      const o = { now: nowArg(a), budgets: budgetsOf(a) };
      if (has(a, 'force')) o.force = optBool(a, 'force');
      if (has(a, 'needBytes')) o.needBytes = finite(a.needBytes, 'needBytes');
      if (has(a, 'limit')) {
        const l = objArg(a, 'limit');
        const lim = {};
        if (has(l, 'ink')) lim.ink = optBool(l, 'ink');
        if (has(l, 'inkMonths')) lim.inkMonths = strArr(l, 'inkMonths');
        if (has(l, 'months')) lim.months = strArr(l, 'months');
        o.limit = lim;
      }
      if (has(a, 'afterSeenKeepDays')) o.afterSeenKeepDays = finite(a.afterSeenKeepDays, 'afterSeenKeepDays');
      const r = budget.recover(draft, o);
      return { actions: r.actions, freedBytes: r.freedBytes, draft };
    },
    'budget.pruneInkOfCards': (a) => {
      const draft = plain(checkShape(objArg(a, 'draft')));
      const dropped = budget.pruneInkOfCards(draft, strArr(a, 'cardKeys'));
      return { dropped, draft };
    },
    'budget.inkTiers': (a) => {
      const records = checkShape({ records: objArg(a, 'records') }).records;
      const o = {};
      if (has(a, 'sessions')) o.sessions = a.sessions;
      if (has(a, 'now')) o.now = finite(a.now, 'now');
      if (has(a, 'keepDays')) o.keepDays = finite(a.keepDays, 'keepDays');
      const index = budget.indexRecords(records, o);
      const cur = str(a, 'currentMonth');
      const out = {};
      for (const id of strArr(a, 'ids')) out[id] = tierOut(budget.inkTier(id, index, cur));
      return out;
    },
    'budget.deriveSerial': (a) => deriveSerial(objArg(a, 'state')),

    // ---------------------------------------------------------------- backup
    'backup.recordsSignature': (a) => backup.recordsSignature(required(a, 'records')),
    'backup.judgedChars': (a) => [...backup.judgedCharsOf(required(a, 'records'))],
    'backup.judgedDays': (a) => backup.judgedDaysOf(required(a, 'records')),
    'backup.entries': (a) => backup.backupEntries(objArg(a, 'state')),
    'backup.build': (a) => {
      const o = { now: nowArg(a) };
      if (has(a, 'serial')) o.serial = finite(a.serial, 'serial');
      return backup.buildBackupV2(objArg(a, 'state'), o);
    },
    'backup.serialize': (a) => backup.serializeBackup(required(a, 'obj')),
    'backup.fileName': (a) => backup.backupFileName(nowArg(a)),
    'backup.failureKind': (a) => backup.failureKind(str(a, 'reason')),
    'backup.inspect': (a) => {
      const input = required(a, 'input');
      if (typeof input !== 'string' && !isObj(input)) throw badArgs('input must be a string or an object');
      const o = has(a, 'maxBytes') ? { maxBytes: finite(a.maxBytes, 'maxBytes') } : {};
      return atClock(now(), () => backup.inspectBackup(input, o));
    },
    'backup.importLegacy': (a) => {
      const input = required(a, 'input');
      if (typeof input !== 'string' && !isObj(input)) throw badArgs('input must be a string or an object');
      return backup.importLegacyBackup(input, { now: nowArg(a) });
    },
    'backup.lossRange': (a) => backup.lossRange(required(a, 'records'), required(a, 'day')),
    'backup.confirmModel': (a) => {
      const showLoss = optBool(a, 'showLoss');
      return backup.confirmModel(required(a, 'state'), objArg(a, 'report'), showLoss === undefined ? {} : { showLoss });
    },
    'backup.status': (a) => (has(a, 'conclusion') ? backup.backupStatus(required(a, 'state'), { conclusion: a.conclusion }) : backup.backupStatus(required(a, 'state'))),
    'backup.makeSafety': (a) => {
      const o = { kind: str(a, 'kind'), now: nowArg(a) };
      if (has(a, 'backupDate')) o.backupDate = a.backupDate;
      if (has(a, 'count')) o.count = a.count;
      return backup.makeSafety(objArg(a, 'state'), o);
    },
    'backup.endActiveSessions': (a) => {
      const draft = plain(objArg(a, 'draft'));
      backup.endActiveSessions(draft);
      return draft;
    },
    'backup.safetyMatches': (a) => backup.safetyMatchesCurrent(objArg(a, 'state')),
    'backup.conclusionOfSafety': (a) => {
      const state = objArg(a, 'state');
      return backup.conclusionOfSafety(backup.safetyOf(state), state);
    },
    // 编排（在 store 会话上）
    'backup.restore': (a) => {
      const s = session();
      const input = required(a, 'input');
      if (typeof input !== 'string' && !isObj(input)) throw badArgs('input must be a string or an object');
      const at = nowArg(a);
      const report = atClock(now(), () => backup.inspectBackup(input));
      if (!report.ok) return { inspected: report };
      return { inspected: { ok: true, day: report.day, count: report.count }, result: backup.restoreFromBackup(s.store, report, { now: at }) };
    },
    'backup.clearAll': (a) => {
      const s = session();
      const at = nowArg(a);
      return backup.clearAllRecords(s.store, { now: at });
    },
    'backup.undo': () => {
      const s = session();
      return backup.undoFromSafety(s.store);
    },
    'backup.dropSafety': () => {
      const s = session();
      return backup.dropSafety(s.store);
    },
    'backup.markExported': (a) => {
      const s = session();
      const at = finite(required(a, 'at'), 'at');
      const sig = optStr(a, 'sig');
      return backup.markExported(s.store, sig === undefined ? { at } : { at, sig });
    },
    'backup.export': (a) => {
      const s = session();
      return backup.serializeBackup(backup.buildBackupV2(s.store.getState(), { now: nowArg(a), serial: s.store.serial }));
    },

    // ---------------------------------------------------------------- migrate
    'migrate.readV1': (a) => {
      const strict = optBool(a, 'strict');
      return migrate.readV1(required(a, 'data'), strict === undefined ? {} : { strict });
    },
    'migrate.canonicalCardKey': (a) => migrate.canonicalCardKey(required(a, 'raw')),
    'migrate.spreadPerDayOf': (a) => migrate.spreadPerDayOf(policyOf(a)),
    'migrate.convertV1': (a) => {
      const o = { now: finite(required(a, 'now'), 'now'), policy: policyOf(a) };
      if (has(a, 'dueBase')) o.dueBase = finite(a.dueBase, 'dueBase');
      const source = optStr(a, 'source');
      if (source !== undefined) o.source = source;
      if (has(a, 'present')) o.present = strArr(a, 'present');
      if (has(a, 'bad')) o.bad = strArr(a, 'bad');
      const r = migrate.convertV1(required(a, 'values'), o);
      return { state: r.state, report: r.report, serial: r.serial };
    },
    'migrate.legacyBackupToV2': (a) => migrate.legacyBackupToV2(required(a, 'obj'), { now: nowArg(a), policy: policyOf(a) }),
    'migrate.boot': (a) => {
      const s = session();
      const at = nowArg(a);
      return migrate.bootMigration({ store: s.store, now: () => at, policy: policyOf(a) });
    },
    'migrate.release': (a) => {
      const s = session();
      const at = nowArg(a);
      return migrate.releaseLegacyKeys({ store: s.store, now: at, policy: policyOf(a) });
    },

    // ---------------------------------------------------------------- 原生校验和
    'native.checksum': (a) => checksum(str(a, 'raw')),
    'native.digestRows': (a) => {
      const rows = arrArg(a, 'rows');
      for (const p of rows) if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string') throw badArgs('rows must be [key, raw] pairs');
      return digestRows(rows);
    },
  };

  /** 状态快照里的 store 段（没有会话 = null）。 */
  function snapshot() {
    if (!S) return null;
    const out = {
      backend: S.kind,
      disk: S.disk.snapshot(),
      state: S.store.getState(),
      serial: S.store.serial,
      status: S.store.status,
      notices: S.notices,
    };
    if (S.kind === 'native') out.diag = S.disk.diag;
    return out;
  }

  // 每个 B4.4 op 开始时清空「本步收到的通知」（快照里的 notices 只装这一步的）。
  const wrapped = {};
  for (const [name, fn] of Object.entries(OPS)) {
    wrapped[name] = (a) => {
      if (S) S.notices = [];
      // store.js 迁移失败时 console.warn 一条诊断；差分里成千上万次，静音（行为不变）
      const warn = console.warn;
      console.warn = () => {};
      try {
        return fn(a);
      } finally {
        console.warn = warn;
      }
    };
  }
  return { ops: wrapped, session, snapshot, reset: () => { S = null; } };
}
