// 公开测试钩子 window.__shiziTest（01-架构设计 §11）。
// **只在 isTestHost() 为真时挂载**：URL 带 test=1 且（hostname 为 localhost/127.0.0.1 或 iOS DEBUG 注入了
// window.__shiziNativeDev===true）。生产形态（GitHub Pages、Release 壳、无 test=1）下 window.__shiziTest 保持 undefined。
//
// 钩子：
//   seed(state)                     整体替换全部 v2 域，走形状校验 + writeAll；返回 {ok, keys?|error?}
//                                   state 形状同 store：records / ink 都是 {'YYYY-MM': …} 按月分组
//                                   （ink: {'2026-09': {r2: Ink}}，落到 shizi.v2.ink.2026-09）；月份不是 YYYY-MM → {ok:false, kind:'shape'}
//   getState()                      当前 store 状态（JSON 深拷贝；ink 同上按月分组）
//   getInk(record)                  某条记录的墨迹（按 inkMonthOf/inkIdOf 定位），没有返回 null
//   getRawKeys(prefix='shizi.', {includeRoute?})  localStorage 原始键值（K03 等「全部 v2 键深相等」断言用）；
//                                   默认不含路由提示 shizi.v2.route（审查整改 F1：它随导航而变，不是数据），includeRoute:true 才给
//   getStatus()                     store.status（available/blocked/corruptNotice/usage/lastRepair/backend——B1：kind 'native'|'localStorage' 与迁移信息）
//   failNextWrite(n, {kind:'quota'|'generic'|'security', matchKey?})  接下来 n 次匹配的 setItem 抛错
//   interruptAfterWrite(k)          第 k 次写后模拟进程中断（之后写全部失败且不回滚；刷新页面后 repair）
//   takeFaults()                    取走并清空挂着的注入（B4.8：原生 SwiftEngine 是写入者时，原生在下一次写之前取走，挂到 Swift 一侧）
//   getFaults()                     现在挂着的注入 {fail:[{remaining, kind, matchKey}], interruptAfter, halted, overridden}（B4.7 影子比对读；
//                                   overridden = 夹具脚本把探测 / blocked 换掉了）
//   setClock(iso|null)              平移应用时钟（platform/env.js now()）
//   reset()                         清故障、复原时钟、删除全部 shizi.* 键（保留 shizi.nativeSmoke.v1）、重载 store、清写日志
//   getWriteLog()                   本页面对 localStorage 的每次写：{seq, op, key, bytes, via:'storage'|'direct', ok}
//                                   via==='direct' 即绕过 storage.js 的写入（验收断言应为空）。
//                                   不含路由提示键 shizi.v2.route（审查整改 F1：页面栈一变就写，不是业务数据；各 spec「这一步
//                                   不写存储」的断言针对业务数据）——它的写入单独记在 getRouteWriteLog()，同样带 via。
//   getRouteWriteLog()              shizi.v2.route 的写入（同上格式）。
//   getRoutePlan()                  本次启动的冷启动判定 {reason, restored}（ui/route-memory.js；不是冷启动时 reason 照样给出）

import { isTestHost, now, setClockOverride } from './env.js';
import { isDriverActive } from '../store/storage.js';
import { KEYS, NATIVE_SMOKE_KEY } from '../core/schema.js';

const LOG_CAP = 2000;
const PATCHED = typeof Symbol === 'function' ? Symbol.for('shizi.testHooks.patched') : '__shiziTestPatched';

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * 在 backend 的原型上包一层 setItem/removeItem/clear，记录只针对 backend 这个实例的写。
 * 同一原型只包一次；日志写进 sink（数组，超过上限丢最旧）。
 */
function installWriteLog(backend, sink, routeSink = []) {
  const proto = Object.getPrototypeOf(backend);
  if (!proto) return;
  const state = { seq: 0 };
  if (proto[PATCHED]) {
    proto[PATCHED].sinks.set(backend, { sink, routeSink, state });
    return;
  }
  const sinks = new Map([[backend, { sink, routeSink, state }]]);
  const record = (target, op, key, bytes, ok) => {
    const entry = sinks.get(target);
    if (!entry) return;
    entry.state.seq += 1;
    const out = key === KEYS.route ? entry.routeSink : entry.sink;
    out.push({ seq: entry.state.seq, op, key, bytes, via: isDriverActive() ? 'storage' : 'direct', ok });
    if (out.length > LOG_CAP) out.splice(0, out.length - LOG_CAP);
  };
  const origSet = proto.setItem;
  const origRemove = proto.removeItem;
  const origClear = proto.clear;
  proto.setItem = function setItem(key, value) {
    let ok = false;
    try {
      const out = origSet.call(this, key, value);
      ok = true;
      return out;
    } finally {
      record(this, 'set', String(key), (String(key).length + String(value).length) * 2, ok);
    }
  };
  proto.removeItem = function removeItem(key) {
    let ok = false;
    try {
      const out = origRemove.call(this, key);
      ok = true;
      return out;
    } finally {
      record(this, 'remove', String(key), 0, ok);
    }
  };
  // B1 原生后端（store/native-backend.js）：一次 applyBatch = 一个原生事务，逐项记一条（op 同 setItem / removeItem）。
  const origBatch = proto.applyBatch;
  if (typeof origBatch === 'function') {
    proto.applyBatch = function applyBatch(entries) {
      let ok = false;
      try {
        const out = origBatch.call(this, entries);
        ok = true;
        return out;
      } finally {
        for (const [key, value] of entries) {
          if (value === null) record(this, 'remove', String(key), 0, ok);
          else record(this, 'set', String(key), (String(key).length + String(value).length) * 2, ok);
        }
      }
    };
  }
  if (typeof origClear === 'function') {
    proto.clear = function clear() {
      let ok = false;
      try {
        const out = origClear.call(this);
        ok = true;
        return out;
      } finally {
        record(this, 'clear', '*', 0, ok);
      }
    };
  }
  Object.defineProperty(proto, PATCHED, { value: { sinks }, configurable: true });
}

/** B4.8：写入注入挂上了——告诉原生（SwiftEngine 是写入者时它在下一次写之前取走，见 takeFaults）。网页版没有原生通道，什么都不发。 */
function armedForNative(win = globalThis) {
  try {
    const ch = win && win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.shiziNative;
    if (ch) ch.postMessage({ type: 'native', op: 'qa-faults' });
  } catch (error) {
    // 测试设施，发不出去不影响
  }
}

function createTestApi({ storage, getStore }) {
  // B4.7 影子比对：夹具脚本会把 storage 的探测 / blocked 换成假的（States/_ops/blockMode.js）——getFaults 报出来，影子那组不比
  const originalProbe = storage ? storage.probe : null;
  const blockedDesc = storage ? Object.getOwnPropertyDescriptor(storage, 'blocked') : null;
  const log = [];
  const routeLog = [];
  let backend = null;
  try {
    backend = storage.backend;
  } catch (error) {
    backend = null;
  }
  if (backend) installWriteLog(backend, log, routeLog);

  const store = () => getStore();

  return {
    seed(state) {
      return plain(store().seed(state));
    },
    getState() {
      return plain(store().getState());
    },
    getInk(record) {
      const ink = store().getInk(record);
      return ink === null || ink === undefined ? null : plain(ink);
    },
    getRawKeys(prefix = 'shizi.', { includeRoute = false } = {}) {
      const out = {};
      for (const [key, raw] of storage.readAll(prefix)) if (includeRoute || key !== KEYS.route) out[key] = raw;
      return out;
    },
    getStatus() {
      return plain(store().status);
    },
    failNextWrite(n = 1, options = {}) {
      storage.failNextWrite(n, options || {});
      armedForNative();
      return true;
    },
    /** 现在挂着的写入注入 {fail:[{remaining, kind, matchKey}], interruptAfter, halted}（B4.7 影子比对读）。 */
    getFaults() {
      const f = plain(storage.faults);
      const d = Object.getOwnPropertyDescriptor(storage, 'blocked');
      f.overridden = storage.probe !== originalProbe || !!(d && blockedDesc && d.get !== blockedDesc.get);
      return f;
    },
    interruptAfterWrite(k) {
      storage.interruptAfterWrite(k);
      armedForNative();
      return true;
    },
    /** B4.8：iOS 壳里写入者是原生 SwiftEngine 时，原生在下一次要写的 op 之前取走挂着的写入注入（取走即清空，同一个注入只生效一次）。 */
    takeFaults() {
      const f = plain(storage.faults);
      storage.clearFaults();
      return f;
    },
    setClock(iso) {
      const t = setClockOverride(iso === undefined ? null : iso);
      return new Date(t).toISOString();
    },
    now() {
      return now();
    },
    reset() {
      storage.clearFaults();
      setClockOverride(null);
      const keys = storage.listKeys('shizi.').filter(key => key !== NATIVE_SMOKE_KEY);
      storage.removeKeys(keys);
      const report = store().reload();
      log.length = 0;
      routeLog.length = 0;
      return { ok: true, removed: keys.length, available: report.available };
    },
    getWriteLog() {
      return log.map(entry => Object.assign({}, entry));
    },
    getRouteWriteLog() {
      return routeLog.map(entry => Object.assign({}, entry));
    },
    async getRoutePlan() {
      const { getRouteMemory } = await import('../ui/route-memory.js');
      const memory = getRouteMemory();
      return memory ? memory.lastPlan() : null;
    },
  };
}

/**
 * 挂载入口（app.js 在建 store 之前调用，以便 repair 阶段的写也进日志）。
 * 返回挂上的 api；非测试宿主返回 null 且不触碰 window。
 */
export function mountTestHooks({ win = globalThis, storage, getStore }) {
  if (isTestHost(win)) {
    // B3.F 冷启动「阻断优先」的流程测试（RestoreAndDeepLinkTests）：壳在文档开始注入 __shiziQAStorageUnavailable 时，这一次启动的存储探测失败（只在测试宿主）
    if (win.__shiziQAStorageUnavailable === true && storage && typeof storage.probe === 'function') storage.probe = () => ({ ok: false, kind: 'security' });
    const api = createTestApi({ storage, getStore });
    win.__shiziTest = api;
    win.__shiziTestTakeFaults = () => api.takeFaults(); // B4.8：原生按函数名调（WebEngine.evaluate）
    return api;
  }
  return null;
}
