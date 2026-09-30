// 页面侧 Service Worker 接线与版本一致性（01-架构设计 §8.3；02 M5-1）。
//
// app.js 在挂载 UI 之后调用 startServiceWorker()（01 §2 启动顺序最后一步）：
//   1. BUILD 比对：index.html 的 meta[shizi-asset-build] 与 src/build-info.js 的 BUILD 不一致（HTML 与模块来自不同版本，
//      例如浏览器 HTTP 缓存里的旧模块）→ 带防循环标记 reload 一次；reload 后仍不一致就不再 reload，只标记。
//   2. 只读就绪标记：<html data-shizi-ready="<BUILD>">（门禁 / 冒烟探针读它，不依赖 __shiziTest）。
//   3. 注册 sw.js（updateViaCache:'none'：sw.js 与 importScripts 的 sw-manifest.js 都绕过 HTTP 缓存比对字节）。
//      不注册：没有 navigator.serviceWorker、非 http(s)（iOS 壳的自定义 scheme）、原生壳内、测试宿主（?test=1 的 localhost，
//      e2e 用 page.route 改写数据请求，worker 会绕过它；加 &sw=1 才注册）。
//   4. 「有新版本」：worker 激活后 postMessage {type:'shizi-sw-activated', build}，或页面 hello 得到的 {type:'shizi-sw-version'}
//      报出的 build 与本页 BUILD 不同 → 非写字页立即 location.reload()；写字页不刷新（W10 现场由写字页自己在抬笔时写回），
//      等顶层离开写字页再 reload。等待期间 <html data-shizi-update="pending">。
//
// 不写 localStorage（不经 store.commit 的写入只有 sessionStorage 里的防循环标记，它不是记录，关页即失）。

import { BUILD } from '../build-info.js';
import { isNativeShell, isTestHost } from './env.js';

export const MSG_ACTIVATED = 'shizi-sw-activated';
export const MSG_VERSION = 'shizi-sw-version';
export const MSG_HELLO = 'shizi-hello';
export const WRITE_SCREEN = 'write';
export const RELOAD_FLAG_KEY = 'shizi.buildReload';
export const UPDATE_FLAG_KEY = 'shizi.swReload';
export const UPDATE_CHECK_MIN_MS = 60 * 60 * 1000;

function globalWin() {
  return typeof window !== 'undefined' ? window : undefined;
}

function searchParam(win, name) {
  try {
    return new URLSearchParams(win.location.search || '').get(name);
  } catch (error) {
    return null;
  }
}

function session(win) {
  try {
    return win.sessionStorage || null;
  } catch (error) {
    return null;
  }
}

function readFlag(win, key) {
  try {
    const s = session(win);
    return s ? s.getItem(key) : null;
  } catch (error) {
    return null;
  }
}

/** 写成功返回 true；写不了（隐私模式等）返回 false——调用方据此放弃 reload，宁可不刷新也不死循环。 */
function writeFlag(win, key, value) {
  try {
    const s = session(win);
    if (!s) return false;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    return value === null || s.getItem(key) === value;
  } catch (error) {
    return false;
  }
}

function rootEl(win) {
  return win && win.document ? win.document.documentElement : null;
}

function setMark(win, name, value) {
  const el = rootEl(win);
  if (!el) return;
  if (value === null || value === undefined) el.removeAttribute(name);
  else el.setAttribute(name, String(value));
}

/** index.html 声明的 BUILD。 */
export function htmlBuild(win = globalWin()) {
  try {
    const meta = win.document.querySelector('meta[name="shizi-asset-build"]');
    return meta ? meta.getAttribute('content') || '' : '';
  } catch (error) {
    return '';
  }
}

/**
 * 启动时 BUILD 比对（01 §8.3）。返回 {ok, reloading}：
 *   一致 → 清防循环标记；不一致且本会话还没为这一对 (meta, BUILD) reload 过 → 记标记后 reload；
 *   已 reload 过（或标记写不进）→ 不再 reload，标记 data-shizi-build-mismatch。
 */
export function checkBuild(win = globalWin(), build = BUILD) {
  const meta = htmlBuild(win);
  if (!meta || meta === build) {
    if (readFlag(win, RELOAD_FLAG_KEY) !== null) writeFlag(win, RELOAD_FLAG_KEY, null);
    setMark(win, 'data-shizi-build-mismatch', null);
    return { ok: true, reloading: false };
  }
  const pair = `${meta}|${build}`;
  setMark(win, 'data-shizi-build-mismatch', pair);
  if (readFlag(win, RELOAD_FLAG_KEY) === pair || !writeFlag(win, RELOAD_FLAG_KEY, pair)) {
    console.warn('[shizi] index.html and modules disagree on BUILD after one reload:', pair);
    return { ok: false, reloading: false };
  }
  win.location.reload();
  return { ok: false, reloading: true };
}

/** 是否注册 worker（见文件头第 3 条）。 */
export function shouldRegister(win = globalWin()) {
  if (!win || !win.navigator || !win.navigator.serviceWorker) return false;
  const protocol = win.location && win.location.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') return false;
  if (isNativeShell(win)) return false;
  if (isTestHost(win) && searchParam(win, 'sw') !== '1') return false;
  return true;
}

/** 顶层页面名（ui/root.js 写在 .sz-app[data-top-screen]；platform 不 import ui，读只读 DOM 标记）。 */
export function topScreen(win = globalWin()) {
  try {
    const app = win.document.querySelector('.sz-app');
    return app ? app.getAttribute('data-top-screen') || '' : '';
  } catch (error) {
    return '';
  }
}

/**
 * 建一个「有新版本」处理器（可注入 win 单测）。
 * onVersion(build)：收到 worker 报出的 build；与本页 BUILD 相同则忽略。
 */
export function createUpdateController(win = globalWin(), { build = BUILD, reload } = {}) {
  const doReload = reload || (() => win.location.reload());
  let pendingBuild = null;
  let observer = null;
  let reloaded = false;

  function stopWatching() {
    if (observer) observer.disconnect();
    observer = null;
  }

  function reloadFor(target) {
    if (reloaded) return;
    // 同一目标版本本会话已刷过一次仍没换过来（例如 worker 缓存异常）：不再刷，免得死循环。
    if (readFlag(win, UPDATE_FLAG_KEY) === target) {
      console.warn('[shizi] new version still not active after reload:', target);
      setMark(win, 'data-shizi-update', 'stuck');
      stopWatching();
      return;
    }
    writeFlag(win, UPDATE_FLAG_KEY, target);
    reloaded = true;
    stopWatching();
    setMark(win, 'data-shizi-update', 'reloading');
    doReload();
  }

  function evaluate() {
    if (!pendingBuild) return;
    if (topScreen(win) === WRITE_SCREEN) return;
    reloadFor(pendingBuild);
  }

  function watch() {
    if (observer || typeof win.MutationObserver !== 'function') return;
    const target = win.document.getElementById('app') || win.document.body;
    if (!target) return;
    observer = new win.MutationObserver(evaluate);
    observer.observe(target, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-top-screen'] });
  }

  return {
    onVersion(next) {
      if (typeof next !== 'string' || !next) return;
      if (next === build) {
        if (readFlag(win, UPDATE_FLAG_KEY) !== null) writeFlag(win, UPDATE_FLAG_KEY, null);
        return;
      }
      pendingBuild = next;
      setMark(win, 'data-shizi-update', 'pending');
      if (topScreen(win) === WRITE_SCREEN) watch();
      else reloadFor(next);
    },
    pending: () => pendingBuild,
    evaluate,
  };
}

function hello(win, worker) {
  try {
    if (worker) worker.postMessage({ type: MSG_HELLO, build: BUILD });
  } catch (error) {
    // worker 已被替换：controllerchange 会再报一次
  }
}

let started = null;

/**
 * 启动（幂等）：BUILD 比对 → 就绪标记 → 监听「有新版本」→ 注册 worker。
 * @returns {{reloading:boolean, registered:Promise<ServiceWorkerRegistration|null>}}
 */
export function startServiceWorker(win = globalWin()) {
  if (started) return started;
  if (!win || !win.document) {
    started = { reloading: false, registered: Promise.resolve(null) };
    return started;
  }
  const check = checkBuild(win);
  if (check.reloading) {
    started = { reloading: true, registered: Promise.resolve(null) };
    return started;
  }
  setMark(win, 'data-shizi-ready', BUILD);

  const container = win.navigator && win.navigator.serviceWorker;
  if (!container) {
    started = { reloading: false, registered: Promise.resolve(null) };
    return started;
  }
  const updates = createUpdateController(win);
  container.addEventListener('message', event => {
    const data = event && event.data;
    if (!data || (data.type !== MSG_ACTIVATED && data.type !== MSG_VERSION)) return;
    updates.onVersion(data.build);
  });
  container.addEventListener('controllerchange', () => hello(win, container.controller));
  hello(win, container.controller);

  let registration = null;
  let lastCheck = Date.now();
  win.document.addEventListener('visibilitychange', () => {
    if (win.document.visibilityState !== 'visible') return;
    hello(win, container.controller); // worker 被回收后重新登记本页版本
    if (registration && Date.now() - lastCheck > UPDATE_CHECK_MIN_MS) {
      lastCheck = Date.now();
      registration.update().catch(() => null);
    }
  });

  const registered = shouldRegister(win)
    ? new Promise(resolve => {
      const go = () => {
        container.register('sw.js', { updateViaCache: 'none' })
          .then(reg => {
            registration = reg;
            resolve(reg);
          })
          .catch(error => {
            console.warn('[shizi] service worker registration failed:', error && error.message ? error.message : error);
            resolve(null);
          });
      };
      if (win.document.readyState === 'complete') go();
      else win.addEventListener('load', go, { once: true });
    })
    : Promise.resolve(null);
  started = { reloading: false, registered };
  return started;
}

/** 仅供单测复位模块状态。 */
export function _resetForTest() {
  started = null;
}
