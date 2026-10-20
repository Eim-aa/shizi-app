// B1 原生数据层的传输（01-架构设计 §4.1、§8.1「数据层端点」；原生实现 ios/ShiziApp/ShiziApp/NativeStoreBridge.swift）。
//
// 页面经同源请求调用原生 SQLite：POST <origin>/__native/store/v1/<op>，body = JSON，回 JSON：
//   {ok:true, …}  |  {ok:false, error:{code, message, key?}}
// 两种调用：
//   callSync(op, payload)                 同步 XHR——store 的每次写入（apply）。返回时原生事务已提交（或已回滚并给出错误码）。
//   callAsync(op, payload, {timeoutMs})   异步 XHR + 超时——启动加载（load）与一次性迁移（import / commitMigration / diag）。
// 超时：同步 XHR 在窗口上下文不能设 timeout，期限由原生执行（NativeStoreBridge.timeout(for:)，写入 10s、加载与迁移 30s），
// 到期回 E_TIMEOUT；异步调用 JS 自己也设一道期限（xhr.timeout，默认 30s → E_TIMEOUT）。
// 启动时的第一次 load 由 src/platform/native-preload.js（index.html 里的经典脚本）在 HTML 解析时就发出，store/native-boot.js 取用。
//
// op 与载荷：
//   ping                                         → {schema, migration}
//   load                                         → {schema, migration, rows:[[key, raw]…]}（按键的 UTF-16 序）
//   apply           {ops:[[key, raw|null, sum?]…]}  一个事务；→ {written}
//   import          {rows:[[key, raw, sum]…], count, digest, source}  清空后整批写入，state=imported；→ {migration}
//   commitMigration {count, digest}              原生重算摘要一致 → state=done；→ {migration}
//   diag            {entry}                      记一条诊断（迁移失败 / 回退原因）；→ {diag:[…]}
//   stats                                        → {rows, bodyBytes, fileBytes, tables, schema, migration}
// 错误码：E_FULL（磁盘满，按配额处理）E_IO E_BUSY E_CORRUPT E_SQLITE E_VERIFY（校验不符，已回滚）E_BAD_REQUEST E_BAD_KEY
//   E_SCHEMA E_MIGRATION E_UNAVAILABLE E_UNKNOWN_OP E_INTERNAL；原生回 E_TIMEOUT、传输层失败记为 E_TRANSPORT——
//   这两种「结果未知」（uncertain：写入可能稍后仍提交），由 storage.js 进阻断（R-B09），重启后以库为准。
//
// 校验和 checksum(raw) = 「UTF-8 字节数:FNV-1a 32 十六进制」，与 NativeStore.checksum 同口径：原生入库前核对、写后读回再比对。
// digestRows(rows) 是迁移用的整体摘要（count:总字节:fnv），与 NativeStore.digest 同口径。
// 本模块不碰 localStorage、不碰 DOM；isNativeStoreHost 只看页面的协议（shizi-resource: = iOS 壳），e2e 装的假原生桥不受影响。

export const NATIVE_STORE_BASE = '/__native/store/v1/';
export const NATIVE_STORE_SCHEME = 'shizi-resource:';

const UNCERTAIN_CODES = new Set(['E_TIMEOUT', 'E_TRANSPORT']);

export class NativeStoreError extends Error {
  constructor(code, message, { op = null, key = null } = {}) {
    super(message || code);
    this.name = 'NativeStoreError';
    this.code = code;
    this.op = op;
    this.key = key;
    /** 结果未知（写入可能已提交也可能没有）。 */
    this.uncertain = UNCERTAIN_CODES.has(code);
  }
}

/** 页面是否运行在带原生数据层的 iOS 壳里（随包页面的协议是 shizi-resource:）。 */
export function isNativeStoreHost(win = globalThis) {
  try {
    return !!win && !!win.location && win.location.protocol === NATIVE_STORE_SCHEME;
  } catch (error) {
    return false;
  }
}

// ---------------------------------------------------------------- 校验和

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hex8(h) {
  const s = (h >>> 0).toString(16);
  return '00000000'.slice(s.length) + s;
}

/**
 * 按 UTF-8 字节流做 FNV-1a 32（不分配缓冲：逐码元编码；孤立代理按 U+FFFD 计，与 TextEncoder / Swift 一致）。
 * 返回 {h, bytes}；seed 可接上一段的 h，做流式摘要。
 */
export function fnv1aUtf8(str, seed = FNV_OFFSET) {
  let h = seed >>> 0;
  let bytes = 0;
  const n = str.length;
  for (let i = 0; i < n; i += 1) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      h = Math.imul(h ^ c, FNV_PRIME);
      bytes += 1;
      continue;
    }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i += 1;
        h = Math.imul(h ^ (0xf0 | (cp >> 18)), FNV_PRIME);
        h = Math.imul(h ^ (0x80 | ((cp >> 12) & 0x3f)), FNV_PRIME);
        h = Math.imul(h ^ (0x80 | ((cp >> 6) & 0x3f)), FNV_PRIME);
        h = Math.imul(h ^ (0x80 | (cp & 0x3f)), FNV_PRIME);
        bytes += 4;
        continue;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // 孤立代理
    if (c < 0x800) {
      h = Math.imul(h ^ (0xc0 | (c >> 6)), FNV_PRIME);
      h = Math.imul(h ^ (0x80 | (c & 0x3f)), FNV_PRIME);
      bytes += 2;
    } else {
      h = Math.imul(h ^ (0xe0 | (c >> 12)), FNV_PRIME);
      h = Math.imul(h ^ (0x80 | ((c >> 6) & 0x3f)), FNV_PRIME);
      h = Math.imul(h ^ (0x80 | (c & 0x3f)), FNV_PRIME);
      bytes += 3;
    }
  }
  return { h: h >>> 0, bytes };
}

/** 单个值的校验和：「UTF-8 字节数:FNV-1a 32」。 */
export function checksum(raw) {
  const { h, bytes } = fnv1aUtf8(String(raw));
  return `${bytes}:${hex8(h)}`;
}

/**
 * 一批行的摘要（迁移核对用）：rows 必须已按键的 UTF-16 序排好（Array.prototype.sort 默认序）。
 * sums 可传入已算好的校验和（与 rows 同序），省一遍。返回 {count, bytes, digest:'count:bytes:fnv'}。
 */
export function digestRows(rows, sums = null) {
  let h = FNV_OFFSET;
  let bytes = 0;
  rows.forEach(([key, raw], i) => {
    const sum = sums ? sums[i] : checksum(raw);
    bytes += Number(sum.slice(0, sum.indexOf(':')));
    h = fnv1aUtf8(`${key}\u0000${sum}\n`, h).h;
  });
  return { count: rows.length, bytes, digest: `${rows.length}:${bytes}:${hex8(h)}` };
}

// ---------------------------------------------------------------- 传输

/** 原生回复 → 结果对象；{ok:false} 与非 200 抛 NativeStoreError。 */
export function parseResponse(op, status, text) {
  if (status !== 200) throw new NativeStoreError('E_TRANSPORT', `${op}: HTTP ${status}`, { op });
  let res;
  try {
    res = JSON.parse(text);
  } catch (error) {
    throw new NativeStoreError('E_TRANSPORT', `${op}: response is not JSON`, { op });
  }
  if (!res || typeof res !== 'object') throw new NativeStoreError('E_TRANSPORT', `${op}: empty response`, { op });
  if (res.ok !== true) {
    const e = res.error && typeof res.error === 'object' ? res.error : {};
    throw new NativeStoreError(typeof e.code === 'string' ? e.code : 'E_INTERNAL', `${op}: ${e.message || 'failed'}`, { op, key: e.key || null });
  }
  return res;
}

/**
 * 页面里的真实传输。win 可注入（测试）；base 默认 NATIVE_STORE_BASE（相对本源）。
 */
export function createXhrTransport({ win = globalThis, base = NATIVE_STORE_BASE } = {}) {
  const url = op => base + op;
  return {
    kind: 'xhr',
    callSync(op, payload = {}) {
      let xhr;
      try {
        xhr = new win.XMLHttpRequest();
        xhr.open('POST', url(op), false);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(payload));
      } catch (error) {
        throw new NativeStoreError('E_TRANSPORT', `${op}: ${error && error.name ? error.name : 'send failed'}`, { op });
      }
      return parseResponse(op, xhr.status, xhr.responseText);
    },
    callAsync(op, payload = {}, { timeoutMs = 30000 } = {}) {
      return new Promise((resolve, reject) => {
        let xhr;
        try {
          xhr = new win.XMLHttpRequest();
          xhr.open('POST', url(op), true);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.timeout = timeoutMs;
          xhr.onload = () => {
            try {
              resolve(parseResponse(op, xhr.status, xhr.responseText));
            } catch (error) {
              reject(error);
            }
          };
          xhr.onerror = () => reject(new NativeStoreError('E_TRANSPORT', `${op}: request failed`, { op }));
          xhr.ontimeout = () => reject(new NativeStoreError('E_TIMEOUT', `${op}: timed out after ${timeoutMs}ms`, { op }));
          xhr.send(JSON.stringify(payload));
        } catch (error) {
          reject(new NativeStoreError('E_TRANSPORT', `${op}: ${error && error.name ? error.name : 'send failed'}`, { op }));
        }
      });
    },
  };
}
