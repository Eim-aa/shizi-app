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

import { getTextSize } from '../platform/text-size.js';
import { decorateMineReply } from './screens/mine/native-view.js'; // B3.5c：我的页的折行点（页面侧量，B2.7 的做法）
import { html, useEffect, useLayoutEffect, useState } from '../../vendor/ui.js';
import { getRouter, getScreen, nav, setNativeScreenGate } from './router.js';
import { exitMs } from './components/exit.js';
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

/**
 * 这一屏此刻由原生显示：开关开着、原生有类（registerScreen 的 native:true 只是「可以原生」，找不到类就照旧是网页）。
 * tab 根页（首页 / 字库 / 我的）与原生 Tab 栏同开（B3.5d 删掉了 B3.5a 的根页闸 __shiziNativeRoots）。
 */
export function nativeScreenOn(name, win = globalWin()) {
  return nativeStageEnabled(win) && hasNativeScreen(name, win);
}

setNativeScreenGate(name => nativeScreenOn(name));

// ---------------------------------------------------------------- App API

let api = null;
let feedOff = null;
/** B3.F：引擎模式的栈往来实现（ui/engine.js 注入，App API 的 route.* / stage.enter|resync / deeplink.reminder 转给它）。 */
let engineHooks = null;

export function setEngineHooks(hooks) {
  engineHooks = hooks && typeof hooks === 'object' ? hooks : null;
}
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
    route: deps.route || engineHooks,
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
  if (!api) return { ok: false, error: { kind: 'unavailable' } };
  return decorateReply(op, api.call(op, a), a && a.width);
}

/** B3.5c：页面侧量的折行点等「只有页面能算」的补充（B2.7 webLineStarts 做法），按视图 op 挂上。 */
function decorateReply(op, reply, width) {
  if (op !== 'view.mine') return reply;
  return reply && typeof reply.then === 'function' ? reply.then(r => decorateMineReply(r, width)) : decorateMineReply(reply, width);
}

/** 视图请求带上页面此刻的宽与大字号档（原生排版要与网页同一折行）。 */
function viewEnv(win = globalWin()) {
  let width = 0;
  try { width = win.document.documentElement.clientWidth || 0; } catch (error) { width = 0; }
  let ax = 0;
  try { ax = getTextSize().ax || 0; } catch (error) { ax = 0; }
  return width > 0 ? { width, ax } : { ax };
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
export function nativeRunBelow(snap, entryId, withViews = false, win = globalWin(), { view = viewPayload, nativeOn = name => nativeScreenOn(name, win) } = {}) {
  const pages = snap ? snap.stack.filter(e => e.k === 's') : [];
  const i = pages.findIndex(e => e.id === entryId);
  const out = [];
  for (let j = i - 1; j >= 1; j -= 1) {
    const e = pages[j];
    if (!nativeOn(e.n)) break;
    const item = { entryId: e.id, screen: e.n, params: e.p || {} };
    if (withViews) {
      const p = view(e.n, e.p);
      if (!(p && typeof p.then === 'function')) item.payload = p; // 异步视图（将来的页面）不随消息带：原生跳过重建，盖在现有的上面
    }
    out.unshift(item);
  }
  return out;
}

/** tab 根页的宿主：铺满 tab 内容区（不盖 Tab 栏；原生根页同样只盖到 Tab 栏上沿），截图按内容区铺。 */
const ROOT_HOST_STYLE = 'position:relative;height:100%;pointer-events:none';

/** 这一条是不是页面栈的底（tab 根页）。 */
export function isRootEntry(snap, entryId) {
  return !!(snap && snap.stack && snap.stack.length && snap.stack[0].id === entryId);
}

/**
 * tab 根页的原生层此刻要不要让开：顶层是网页页面（不是原生宿主条目）或根页上开着网页弹层。
 * 顶层是原生宿主（写字 / 结果 / 通用原生页）时不让开——它们盖在原生根页上面。
 */
export function rootCovered(snap, entryId) {
  const top = snap ? snap.top : null;
  if (!top) return false;
  if (top.id === entryId) return !!snap.topIsOverlay;
  const def = getScreen(top.n);
  if (!def) return true;
  if (def.nativeHost) return !def.nativeHost(top, snap) || !!snap.topIsOverlay;
  return true;
}

function underOf(snap, entryId) {
  const pages = snap ? snap.stack.filter(e => e.k === 's') : [];
  const i = pages.findIndex(e => e.id === entryId);
  return i > 0 ? pages[i - 1] : null;
}

function viewPayload(name, params) {
  if (!api) return { ok: false, error: { kind: 'unavailable' } };
  const env = viewEnv();
  return decorateReply(`view.${name}`, api.call(`view.${name}`, { ...env, ...(params || {}) }), env.width);
}

/** 让开过（stage.cover）的原生屏条目回到顶上：取一次即清（B3.F 引擎模式的宿主消息 engine.js 用）。 */
export function takeAway(entryId) {
  if (!entryId || !away.has(entryId)) return false;
  away.delete(entryId);
  setCover(entryId, null);
  return true;
}

/**
 * 原生屏条目的 open 消息（与 NativeScreenHost 挂载 / 回来时发的同一个；B3.F 引擎模式由 engine.js 按栈的变化调用）。
 * 视图回包是 Promise 时返回 Promise（消息等它好了再发）。
 */
export function screenOpenMessage(entry, snap, { returning = false, view = viewPayload, now = Date.now, nativeOn = undefined, plan: planOf = nativePlanOf } = {}) {
  const name = entry.n;
  const id = entry.id;
  const params = entry.p || {};
  const under = underOf(snap, id);
  const root = isRootEntry(snap, id);
  const base = { op: 'open', screen: name, entryId: id, params, underId: under ? under.id : null, underScreen: under ? under.n : null, sentAt: now(),
    ...(root ? { root: true, covered: false } : {}) };
  const io = nativeOn ? { view, nativeOn } : { view };
  let msg;
  if (returning) {
    msg = { ...base, via: 'return', plan: null, run: root ? [] : nativeRunBelow(snap, id, true, globalWin(), io) };
  } else {
    const tr = snap ? snap.transition : null;
    const animate = !!(tr && tr.to && tr.to.id === id && tr.animate && !tr.cold);
    const plan = planOf(id);
    const via = !animate ? 'restore' : tr.kind === 'replace' ? 'replace' : plan && plan.mode === 'quiet' ? 'quiet' : 'push';
    msg = { ...base, via, plan, run: nativeRunBelow(snap, id, false, globalWin(), io) };
  }
  const payload = view(name, params);
  if (payload && typeof payload.then === 'function') {
    return payload.then(p => ({ ...msg, payload: p }), () => ({ ...msg, payload: { ok: false, error: { kind: 'exception' } } }));
  }
  return { ...msg, payload };
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
    const root = isRootEntry(snap, id);
    let covered = root ? rootCovered(snap, id) : false;
    const base = () => ({ op: 'open', screen: name, entryId: id, params: params || {}, underId: under ? under.id : null, underScreen: under ? under.n : null, sentAt: Date.now(),
      ...(root ? { root: true, covered } : {}) });
    let sent = sendOpen({ ...base(), via, plan, run: nativeRunBelow(snap, id) }, viewPayload(name, params));
    let waiting = false;
    let cancelWait = null;
    let coverTimer = null;
    let rootTimer = null;
    // B3.5a tab 根页：原生根页是窗口里 WKWebView 上面的一层（不随网页栈出入）——网页页面 / 网页弹层盖到它上面时让开（covered），
    // 盖着它的网页页面 / 弹层走了再回来（等网页转场与弹层退场余影放完，open via 'return' 带新视图）。
    const offRoot = root && router && typeof router.subscribe === 'function' ? router.subscribe(next => {
      const now = rootCovered(next, id);
      if (now === covered) return;
      const overlayLeft = covered && !now && !next.topIsOverlay;
      covered = now;
      clearTimeout(rootTimer);
      if (cancelWait) { cancelWait(); cancelWait = null; }
      if (now) {
        postNative('native', { op: 'root', screen: name, entryId: id, covered: true });
        return;
      }
      rootTimer = setTimeout(() => {
        cancelWait = whenNavIdle(() => {
          cancelWait = null;
          const snapNow = router.getState();
          if (rootCovered(snapNow, id) || !snapNow.stack.length || snapNow.stack[0].id !== id) return;
          covered = false;
          sent = sendOpen({ ...base(), via: 'return', plan: null, run: [] }, viewPayload(name, snapNow.stack[0].p)) || sent;
          clearTimeout(coverTimer);
          coverTimer = setTimeout(() => setCover(id, null), RETURN_COVER_MS);
        });
      }, overlayLeft ? exitMs('sheet') : 0);
    }) : null;
    const off = !root && router && typeof router.subscribe === 'function' ? router.subscribe(() => {
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
      if (offRoot) offRoot();
      if (cancelWait) cancelWait();
      clearTimeout(coverTimer);
      clearTimeout(rootTimer);
      away.delete(id);
      setCover(id, null);
      if (sent) postNative('native', { op: 'close', screen: name, entryId: id });
    };
  }, [id]);
  const snapNow = getRouter() ? getRouter().getState() : null;
  return html`<div data-testid="native-host" data-screen=${name} style=${isRootEntry(snapNow, id) ? ROOT_HOST_STYLE : HOST_STYLE}>
    ${cover ? html`<img src=${cover} alt="" aria-hidden="true" style=${COVER_STYLE} />` : null}
  </div>`;
}
