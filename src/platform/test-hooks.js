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
//   getRawKeys(prefix='shizi.')     localStorage 原始键值（K03 等「全部 v2 键深相等」断言用）
//   getStatus()                     store.status（available/blocked/corruptNotice/usage/lastRepair）
//   failNextWrite(n, {kind:'quota'|'generic'|'security', matchKey?})  接下来 n 次匹配的 setItem 抛错
//   interruptAfterWrite(k)          第 k 次写后模拟进程中断（之后写全部失败且不回滚；刷新页面后 repair）
//   setClock(iso|null)              平移应用时钟（platform/env.js now()）
//   reset()                         清故障、复原时钟、删除全部 shizi.* 键（保留 shizi.nativeSmoke.v1）、重载 store、清写日志
//   getWriteLog()                   本页面对 localStorage 的每次写：{seq, op, key, bytes, via:'storage'|'direct', ok}
//                                   via==='direct' 即绕过 storage.js 的写入（验收断言应为空）。

import { isTestHost, now, setClockOverride } from './env.js';
import { isDriverActive } from '../store/storage.js';
import { NATIVE_SMOKE_KEY } from '../core/schema.js';

const LOG_CAP = 2000;
const PATCHED = typeof Symbol === 'function' ? Symbol.for('shizi.testHooks.patched') : '__shiziTestPatched';

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * 在 backend 的原型上包一层 setItem/removeItem/clear，记录只针对 backend 这个实例的写。
 * 同一原型只包一次；日志写进 sink（数组，超过上限丢最旧）。
 */
function installWriteLog(backend, sink) {
  const proto = Object.getPrototypeOf(backend);
  if (!proto) return;
  const state = { seq: 0 };
  if (proto[PATCHED]) {
    proto[PATCHED].sinks.set(backend, { sink, state });
    return;
  }
  const sinks = new Map([[backend, { sink, state }]]);
  const record = (target, op, key, bytes, ok) => {
    const entry = sinks.get(target);
    if (!entry) return;
    entry.state.seq += 1;
    entry.sink.push({ seq: entry.state.seq, op, key, bytes, via: isDriverActive() ? 'storage' : 'direct', ok });
    if (entry.sink.length > LOG_CAP) entry.sink.splice(0, entry.sink.length - LOG_CAP);
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

function createTestApi({ storage, getStore }) {
  const log = [];
  let backend = null;
  try {
    backend = storage.backend;
  } catch (error) {
    backend = null;
  }
  if (backend) installWriteLog(backend, log);

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
    getRawKeys(prefix = 'shizi.') {
      const out = {};
      for (const [key, raw] of storage.readAll(prefix)) out[key] = raw;
      return out;
    },
    getStatus() {
      return plain(store().status);
    },
    failNextWrite(n = 1, options = {}) {
      storage.failNextWrite(n, options || {});
      return true;
    },
    interruptAfterWrite(k) {
      storage.interruptAfterWrite(k);
      return true;
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
      return { ok: true, removed: keys.length, available: report.available };
    },
    getWriteLog() {
      return log.map(entry => Object.assign({}, entry));
    },
  };
}

/**
 * 挂载入口（app.js 在建 store 之前调用，以便 repair 阶段的写也进日志）。
 * 返回挂上的 api；非测试宿主返回 null 且不触碰 window。
 */
export function mountTestHooks({ win = globalThis, storage, getStore }) {
  if (isTestHost(win)) {
    const api = createTestApi({ storage, getStore });
    win.__shiziTest = api;
    return api;
  }
  return null;
}
