// NativeStage 的网页一半（B3.2；docs/engineering/v10/B3B4-原生化架构与计划.md §3.3 段 1 / §3.4）。
//
// 段 1：网页路由仍是真相源。registerScreen(name, comp, { native: true }) 的屏，在开关打开且原生有同名类（ShiziScreen_<屏名，- 换 _>）时
// 渲染成「原生宿主」——透明、不画内容、下层页保持可见（root.js nativeHost），挂载时发 {type:'native', op:'open', screen, entryId, params, via, plan, underId, payload}，
// 卸载时发 close。原生 NativeStage 把网页栈顶上连续的原生宿主条目画成一个原生栈、播转场（ShiziTransitions）。原生里发起的导航经 App API 的
// nav.* op 回到这里由网页路由执行；目标是原生屏 → 宿主挂载回发 open；目标是网页屏 → 原生先把自己的样子交给宿主层（stage.cover），网页推入，
// 回到这一条时宿主等网页转场放完再发 open via 'return'（原生不带转场盖上），随后收掉截图（B2.8 的做法推广）。
//
// 开关：iOS 壳在文档开始注入 window.__shiziNative = true 与 window.__shiziNativeScreens = [原生有类的屏名]（与 __shiziNativeWrite 同一个启动开关，
// 默认关，B3.F 去掉）。没有注入时什么都不装，所有屏照旧是网页。
// App API：window.shiziNative(op, args) → Promise（src/session/api/index.js；另加三个只管界面的 stage.* op：cover / fence / under）。
// 推送：store 每次成功提交后 {op:'changed', domains}；阻断状态变化 {op:'status', status:'ready'|'blocked', reason}。

import { html, useEffect, useLayoutEffect, useState } from '../../vendor/ui.js';
import { getRouter, nav, setNativeScreenGate } from './router.js';
import { nativePlanOf, whenNavIdle } from './paper-transition.js';
import { M } from '../config/motion.js';
import { postNative } from '../platform/bridge.js';
import { isNativeShell } from '../platform/env.js';
import { aboutBuild } from './screens/mine/about.js';
import { getStore } from '../store/store.js';
import { createAppApi, createChangeFeed } from '../session/api/index.js';
import { blockReasonOf } from './screens/block/index.js';

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/** 开关：iOS 壳注入了 __shiziNative 且在原生壳内（测试可设 __shiziNativeWriteForce 免壳）。 */
export function nativeStageEnabled(win = globalWin()) {
  return !!(win && win.__shiziNative === true && (win.__shiziNativeWriteForce === true || isNativeShell(win)));
}

/** 原生有没有这一屏的类（壳注入的清单）。 */
export function hasNativeScreen(name, win = globalWin()) {
  const list = win && Array.isArray(win.__shiziNativeScreens) ? win.__shiziNativeScreens : [];
  return list.includes(name);
}

/** 这一屏此刻由原生显示：开关开着、原生有类（registerScreen 的 native:true 只是「可以原生」，找不到类就照旧是网页）。 */
export function nativeScreenOn(name, win = globalWin()) {
  return nativeStageEnabled(win) && hasNativeScreen(name, win);
}

setNativeScreenGate(name => nativeScreenOn(name));

// ---------------------------------------------------------------- App API

let api = null;
let feedOff = null;
let lastStatus = null;

function statusOf(store) {
  let reason = null;
  try {
    reason = blockReasonOf(store ? store.status : null);
  } catch (error) {
    reason = { kind: 'unavailable', detail: 'error' };
  }
  return reason ? { status: 'blocked', reason: reason.kind, detail: reason.detail || null } : { status: 'ready', reason: null, detail: null };
}

function postStatus(store) {
  const s = statusOf(store);
  const key = `${s.status}|${s.reason}|${s.detail}`;
  if (key === lastStatus) return;
  lastStatus = key;
  postNative('native', { op: 'status', ...s });
}

/**
 * 装 window.shiziNative 与 changed / status 推送（开关打开时；幂等）。deps 可注入（node:test）。
 * @returns {{call(op: string, args?: object): any} | null}
 */
export function installNativeStage(win = globalWin(), deps = {}) {
  if (!win || !nativeStageEnabled(win)) return null;
  if (api && win.shiziNative) return api;
  api = createAppApi({
    getStore: deps.getStore || getStore,
    nav: deps.nav || nav,
    build: () => aboutBuild(win), // 关于页的版本行（测试宿主可钉住，同网页页面）
    native: isNativeShell(win) || deps.native === true,
    // 写字会话（write.<op>）：B2 页面的 window.shiziNativeWrite 同一个 API（native-session.js 装）
    write: { call: (op, args) => (typeof win.shiziNativeWrite === 'function' ? win.shiziNativeWrite(op, args) : { ok: false, error: { kind: 'unavailable' } }) },
  });
  win.shiziNative = (op, args) => Promise.resolve(stageCall(op, args, win));
  let store = null;
  try {
    store = (deps.getStore || getStore)();
  } catch (error) {
    store = null;
  }
  if (feedOff) feedOff();
  feedOff = createChangeFeed({ store, post: d => postNative('native', { op: 'changed', ...d }) });
  if (store && typeof store.subscribe === 'function') store.subscribe((state, info) => { if (info && (info.type === 'status' || info.type === 'load')) postStatus(store); });
  lastStatus = null;
  postStatus(store);
  return api;
}

// ---------------------------------------------------------------- 界面一侧的 op（不进 App API：它们碰 DOM）

/**
 * 界面一侧的 App 操作（B3.5b）：原生页要网页界面做一件事（例：字库搜索框打开网页的查字弹层——原生查字弹层 B3.6 之前）时，页面文件自己登记一个 op，
 * 原生经 shiziNative(op) 调用（先走 stage.cover 让开）。登记在页面自己的文件里，不改这个文件；原生查字弹层上线后随之删除。
 */
const uiOps = new Map();
export function registerStageOp(op, fn) {
  if (typeof op === 'string' && typeof fn === 'function') uiOps.set(op, fn);
}

/** 原生页让给网页页面时留在宿主层上的「样子」：entryId → 截图（data URL）。网页推入 / 左缘滑回时露出的是它。 */
const covers = new Map();
const coverListeners = new Set();

function setCover(entryId, url) {
  if (url) covers.set(entryId, url);
  else covers.delete(entryId);
  for (const fn of [...coverListeners]) fn(entryId);
}

/** 让开过（为网页页面）的原生宿主条目：再成为顶层时请原生不带转场盖上（via 'return'）。 */
const away = new Set();

/**
 *   stage.cover {entryId, url?}  宿主层上放 / 收原生页的截图（解码好才回包；空 url = 收）。之后 entryId 记为「让开了」。
 *   stage.fence {}               等页面画完下一帧（两次 rAF）。
 *   stage.under {}               顶层宿主条目下面一页：{entryId, screen, native}（原生返回前核对自己的栈）。
 */
export function stageCall(op, args, win = globalWin()) {
  const a = args && typeof args === 'object' ? args : {};
  if (op === 'stage.cover') {
    const id = typeof a.entryId === 'string' ? a.entryId : null;
    if (!id) return { ok: false, error: { kind: 'invalid' } };
    const url = typeof a.url === 'string' && a.url ? a.url : null;
    if (url) away.add(id);
    if (!url || !win || typeof win.Image !== 'function') {
      setCover(id, url);
      return { ok: true };
    }
    const img = new win.Image();
    img.src = url;
    const decoded = typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
    const late = new Promise(resolve => setTimeout(resolve, M.dur.fade));
    return Promise.race([decoded, late]).then(() => {
      setCover(id, url);
      return { ok: true };
    });
  }
  if (op === 'stage.fence') {
    const raf = win && typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : fn => Promise.resolve().then(fn);
    return new Promise(resolve => raf(() => raf(() => resolve({ ok: true }))));
  }
  if (op === 'stage.under') {
    const router = getRouter();
    const pages = router ? router.getState().stack.filter(e => e.k === 's') : [];
    const under = pages[pages.length - 2] || null;
    return { ok: true, entryId: under ? under.id : null, screen: under ? under.n : null, native: !!(under && nativeScreenOn(under.n, win)) };
  }
  if (uiOps.has(op)) {
    try {
      return uiOps.get(op)(a);
    } catch (error) {
      return { ok: false, error: { kind: 'exception' } };
    }
  }
  if (!api) return { ok: false, error: { kind: 'unavailable' } };
  return api.call(op, a);
}

// ---------------------------------------------------------------- 宿主条目

/** 原生页回来盖上之后多久收掉宿主层上的截图（在原生页下面，看不见；留一会儿防原生页还没盖上时露出下层）。 */
const RETURN_COVER_MS = M.role.pushIn + M.dur.fade;
const HOST_STYLE = 'position:absolute;inset:0;pointer-events:none';
const COVER_STYLE = 'position:absolute;inset:0;width:100%;height:100%;display:block';

/**
 * 这一条下面连续的原生宿主条目（底 → 顶，不含自己）：{entryId, screen, params, payload?}。NativeStage 按它对齐原生栈；
 * withViews：从网页页面回来时下面的原生页已一起让开，带上各自的视图回包，原生不带转场重建。
 */
export function nativeRunBelow(snap, entryId, withViews = false, win = globalWin()) {
  const pages = snap ? snap.stack.filter(e => e.k === 's') : [];
  const i = pages.findIndex(e => e.id === entryId);
  const out = [];
  for (let j = i - 1; j >= 1; j -= 1) {
    const e = pages[j];
    if (!nativeScreenOn(e.n, win)) break;
    const item = { entryId: e.id, screen: e.n, params: e.p || {} };
    if (withViews) {
      const p = viewPayload(e.n, e.p);
      if (!(p && typeof p.then === 'function')) item.payload = p; // 异步视图（将来的页面）不随消息带：原生跳过重建，盖在现有的上面
    }
    out.unshift(item);
  }
  return out;
}

function underOf(snap, entryId) {
  const pages = snap ? snap.stack.filter(e => e.k === 's') : [];
  const i = pages.findIndex(e => e.id === entryId);
  return i > 0 ? pages[i - 1] : null;
}

function viewPayload(name, params) {
  if (!api) return { ok: false, error: { kind: 'unavailable' } };
  return api.call(`view.${name}`, { ...(params || {}) });
}

/** 发 open（视图回包若是 Promise，等它好了再发）。返回是否发出。 */
function sendOpen(msg, payload) {
  if (payload && typeof payload.then === 'function') {
    payload.then(p => postNative('native', { ...msg, payload: p }), () => postNative('native', { ...msg, payload: { ok: false, error: { kind: 'exception' } } }));
    return true;
  }
  return postNative('native', { ...msg, payload });
}

/**
 * 原生屏的宿主（root.js Layer 对 native 屏、开关打开且原生有类时渲染它，代替网页组件）：不画内容；布局阶段发 open（消息先于这一帧网页画面到原生），
 * 卸载时发 close。让开给网页页面后再成为顶层：等网页转场空闲，发 open via 'return'。
 */
export function NativeScreenHost({ params, entry }) {
  const name = entry ? entry.n : '';
  const id = entry ? entry.id : null;
  const [cover, setCoverState] = useState(() => (id ? covers.get(id) || null : null));
  useEffect(() => {
    const on = e => { if (e === id) setCoverState(covers.get(id) || null); };
    coverListeners.add(on);
    on(id);
    return () => coverListeners.delete(on);
  }, [id]);
  useLayoutEffect(() => {
    if (!entry) return undefined;
    installNativeStage();
    const router = getRouter();
    const snap = router ? router.getState() : null;
    const tr = snap ? snap.transition : null;
    const animate = !!(tr && tr.to && tr.to.id === id && tr.animate && !tr.cold);
    const plan = nativePlanOf(id);
    const via = !animate ? 'restore' : tr.kind === 'replace' ? 'replace' : plan && plan.mode === 'quiet' ? 'quiet' : 'push';
    const under = underOf(snap, id);
    const base = () => ({ op: 'open', screen: name, entryId: id, params: params || {}, underId: under ? under.id : null, underScreen: under ? under.n : null, sentAt: Date.now() });
    let sent = sendOpen({ ...base(), via, plan, run: nativeRunBelow(snap, id) }, viewPayload(name, params));
    let waiting = false;
    let cancelWait = null;
    let coverTimer = null;
    const off = router && typeof router.subscribe === 'function' ? router.subscribe(() => {
      const top = router.getState().top;
      if (!away.has(id) || !top || top.id !== id || waiting) return;
      waiting = true;
      cancelWait = whenNavIdle(() => {
        cancelWait = null;
        waiting = false;
        const now = router.getState().top;
        if (!away.has(id) || !now || now.id !== id) return;
        away.delete(id);
        sent = sendOpen({ ...base(), via: 'return', plan: null, run: nativeRunBelow(router.getState(), id, true) }, viewPayload(name, now.p)) || sent;
        clearTimeout(coverTimer);
        coverTimer = setTimeout(() => setCover(id, null), RETURN_COVER_MS);
      });
    }) : null;
    return () => {
      if (off) off();
      if (cancelWait) cancelWait();
      clearTimeout(coverTimer);
      away.delete(id);
      setCover(id, null);
      if (sent) postNative('native', { op: 'close', screen: name, entryId: id });
    };
  }, [id]);
  return html`<div data-testid="native-host" data-screen=${name} style=${HOST_STYLE}>
    ${cover ? html`<img src=${cover} alt="" aria-hidden="true" style=${COVER_STYLE} />` : null}
  </div>`;
}
