// 运行环境判定与时钟（01-架构设计 §8、§11）。
// 所有函数都可传入 win（默认 globalThis），便于 node:test 用假对象测试；在 node 下没有 window 时一律返回 false。

const TEST_HOSTNAMES = ['localhost', '127.0.0.1'];

function globalWin() {
  return typeof globalThis !== 'undefined' ? globalThis : undefined;
}

function searchParam(win, name) {
  try {
    const search = win && win.location && typeof win.location.search === 'string' ? win.location.search : '';
    return new URLSearchParams(search).get(name);
  } catch (error) {
    return null;
  }
}

/**
 * 测试钩子挂载条件（01 §11，唯一判定）：
 *   URL 查询参数 test=1
 *   且（location.hostname ∈ {localhost, 127.0.0.1}  或  window.__shiziNativeDev === true）
 * __shiziNativeDev 只由 iOS DEBUG 冒烟构建在 documentStart 注入（Release 不编译）。
 * GitHub Pages（*.github.io）、Release 壳、任何不带 test=1 的地址都返回 false。
 */
export function isTestHost(win = globalWin()) {
  if (!win || !win.location) return false;
  if (searchParam(win, 'test') !== '1') return false;
  let hostname = '';
  try {
    hostname = String(win.location.hostname || '');
  } catch (error) {
    hostname = '';
  }
  if (TEST_HOSTNAMES.indexOf(hostname) >= 0) return true;
  return win.__shiziNativeDev === true;
}

/** 主屏 PWA（display-mode: standalone）或 iOS Safari 的 navigator.standalone。 */
export function isStandalone(win = globalWin()) {
  if (!win) return false;
  try {
    if (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches) return true;
  } catch (error) {
    // matchMedia 不可用时按非 standalone 处理
  }
  return !!(win.navigator && win.navigator.standalone === true);
}

/** 运行在 iOS WKWebView 壳内（原生注册了 shiziNative 消息通道）。 */
export function isNativeShell(win = globalWin()) {
  try {
    return !!(win && win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.shiziNative);
  } catch (error) {
    return false;
  }
}

// ---------------------------------------------------------------- 时钟

let clockOffsetMs = 0;

/**
 * 应用内「现在」（ms）。业务代码取时间一律走这里（或 store 传给 mutate 的 ctx.now），
 * 测试钩子 setClock(iso) 才能整体平移时间。
 */
export function now() {
  return Date.now() + clockOffsetMs;
}

/**
 * 把「现在」平移到 iso 所指时刻（之后照常流逝）；传 null 复原。
 * 只应由 platform/test-hooks.js 调用。返回生效后的 now()。
 */
export function setClockOverride(iso) {
  if (iso === null || iso === undefined) {
    clockOffsetMs = 0;
    return now();
  }
  const target = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(target)) throw new Error(`setClock: unparseable time ${String(iso)}`);
  clockOffsetMs = target - Date.now();
  return now();
}
