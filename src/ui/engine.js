// 引擎模式（B3.F；docs/engineering/v10/B3B4-原生化架构与计划.md §3.3 段 2）：iOS 壳里网页不挂界面，只当无界面引擎。
//
// 段 2 起导航真相在原生（NativeStage 的栈：每次栈 / 参数变化调 route.save，冷启动调 route.plan，提醒深链调 deeplink.reminder）。
// 网页这一半：
//   - 建 store、装 App API（window.shiziNative）与写字会话 API（window.shiziNativeWrite），**不调 mountRoot**：网页路由与 root.js 不挂；
//     屏模块照常载入（它们在模块顶层登记屏名与动作：setHomeActions 等，入口规则仍只有 JS 这一份）。
//   - 导航镜像（createEngineRouter）：实现网页路由的同一组接口（getState / subscribe / push / replace / back / switchTab / setParams / whenIdle …），
//     让读栈的规则（结果页 leaveTo、D70、写字页「看这个字 ›」、route-memory）一行不改。它不是真相：
//       · JS 发起的导航（首页「开始写字」、结果页「再写一组」、深链……）= 「去哪」的决定：本地先记上，再发给原生 {op:'nav', …}，原生照做、存栈；
//       · 原生发起的导航（原生页点按推入、返回、切 tab、页内参数）由原生直接改自己的栈，再调 stage.enter 让这里记账（来源记账 planPaper、
//         视图回包），不经网页路由决定去处；
//       · 原生每次存栈（route.save）这里以原生的栈为准对齐。
//   - 宿主（段 1 网页里的透明宿主组件）的那一半——「这一条进来 / 离开 / 被盖住 / 回到顶上时给原生发什么」——由 hostBodies 按新旧两个栈算出，
//     与原来的宿主组件同一组函数（native-session.js 的 writeOpenBody 等、native-stage.js 的 screenOpenMessage），消息格式不变，原生的处理不变。
//   - 阻断页、坏值提示：原来由根组件画，改由这里订阅 store 发同样的消息。
// 网页版（浏览器 / PWA / Playwright e2e）不走这里：没有原生注入的 __shiziEngine，照旧 mountRoot。

import { getScreen, setActiveRouter } from './router.js';
import { forgetTap, noteNativePlan, planPaper, traceNav } from './paper-transition.js';
import { postNative } from '../platform/bridge.js';
import { installCommitFeedback } from '../platform/haptics.js';
import { isNativeShell } from '../platform/env.js';
import { M } from '../config/motion.js';
import { getStore } from '../store/store.js';
import { createRouteMemory, setRouteMemory, routeStackOf, RESTORE_GUARDS } from './route-memory.js';
import * as defaultPolicy from '../config/policy.js';
import { cardForKey } from '../data/deck.js';
import { now as envNow } from '../platform/env.js';
import {
  installNativeStage, nativeScreenOn, screenOpenMessage, takeAway, setEngineHooks,
} from './native-stage.js';
import {
  writeOpenBody, writeCloseBody, redoOpenBody, redoCloseBody, resultOpenBody, resultCloseBody, takeWriteAway,
} from './screens/write/native-session.js';
import { BLOCK_SCREEN, blockReasonOf, onBlockReasonChange } from './screens/block/index.js';
import { blockView, hasJudged } from '../session/views/block.js';
import { corruptNoticeLines } from './components/corrupt-notice.js';

function globalWin() {
  return typeof window !== 'undefined' ? window : null;
}

/** 引擎模式：iOS 壳注入了 __shiziEngine（且确实在壳里）。网页版 / e2e 没有注入，恒为 false。 */
export function engineModeOn(win = globalWin()) {
  return !!(win && win.__shiziEngine === true && win.__shiziNative === true && isNativeShell(win));
}

// ---------------------------------------------------------------- 导航镜像

function topOf(stack) {
  return stack.length ? stack[stack.length - 1] : null;
}

function plainParams(p) {
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

/** 原生发起的导航：镜像的订阅者（路由提示写入）推迟到转场之后（T-push 放完再加一个淡化时长）。 */
const NATIVE_EMIT_DELAY_MS = M.role.pushIn + M.dur.fade;

/** 原生 / 存储里的 [{id?, n, p}] → 镜像条目（页面，k:'s'）。第一条必须是 tab 根、其余是已登记的子页；不合格返回 null。 */
export function entriesOf(list, nextId) {
  if (!Array.isArray(list) || !list.length) return null;
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const e = list[i];
    const def = e && typeof e.n === 'string' ? getScreen(e.n) : null;
    if (!def || (i === 0) !== !!def.tab) break;
    out.push({ k: 's', id: typeof e.id === 'string' && e.id ? e.id : nextId(), n: e.n, p: plainParams(e.p) });
  }
  return out.length ? out : null;
}

/**
 * 导航镜像（网页路由同一组接口）。post(msg) 把 JS 发起的导航发给原生；hosts(prev, next, transition) 算宿主消息（见 hostBodies）。
 * 原生发起的导航经 apply(intent, {origin:'native'})：只记账、返回宿主消息，不再发回原生。
 */
export function createEngineRouter({ post = () => {}, hosts = () => [], defaultTab = 'home', onError = error => console.error('[shizi] engine nav:', error) } = {}) {
  let stack = [];
  let idCounter = 0;
  let seq = 0;
  let navSeq = 0;
  let transition = null;
  let jsSeq = 0; // JS 发给原生的导航意图序号（原生存栈时回报它做到了第几条：还在路上的意图不被旧栈盖掉）
  const listeners = new Set();

  function nextId() {
    idCounter += 1;
    return `e${idCounter}`;
  }

  function bump(entries) {
    for (const e of entries) {
      const m = /^e(\d+)$/.exec(e.id);
      if (m) idCounter = Math.max(idCounter, Number(m[1]));
    }
  }

  function snapshot() {
    return {
      stack: stack.slice(),
      depth: Math.max(0, stack.length - 1),
      tab: stack.length ? stack[0].n : null,
      top: topOf(stack),
      topIsOverlay: false,
      transition,
      navSeq,
      pending: false,
    };
  }

  function emit() {
    const snap = snapshot();
    for (const fn of [...listeners]) {
      try { fn(snap); } catch (error) { onError(error); }
    }
  }

  function setTransition(kind, { animate, cause, from, to, cold = false }) {
    seq += 1;
    transition = cold ? { seq, kind, animate, cause, from, to, cold: true } : { seq, kind, animate, cause, from, to };
  }

  /** 来源记账（root.js 对原生宿主条目的那一支，B2.8）：进写字页的计划随 open 交给原生；返回时删来源。 */
  function account(t) {
    if (!t || !t.from || !t.to) return;
    if (!(t.to.n === 'write' && (t.kind === 'push' || t.kind === 'replace'))) forgetTap();
    if (t.kind !== 'push' && t.kind !== 'replace' && t.kind !== 'pop') return;
    const under = stack.length >= 2 ? stack[stack.length - 2] : null;
    let plan = null;
    try {
      plan = planPaper(t, { reduced: false, root: null, underId: under ? under.id : null, nativeTap: t.kind === 'replace' });
    } catch (error) {
      onError(error);
    }
    if (t.kind !== 'pop') noteNativePlan(t.to.id, plan, under ? under.id : null, null);
    // 转场记录（QA 探针 webNav）：同 root.js 对原生宿主条目的那一支——这一下交给原生画，网页不播
    if (t.animate || t.kind === 'pop') traceNav(`${t.kind}:native`);
  }

  /**
   * 改栈（JS 与原生同一套语义）。intent：
   *   {kind:'push', entry}  {kind:'replace', entry, animate}  {kind:'pop', cause}  {kind:'tab', entry}  {kind:'params', patch}
   *   {kind:'restore', stack}（冷启动重建 / 页面重载后对齐原生，无转场）
   * 返回宿主消息（[{type, body}]）；改不了返回 null。
   */
  function apply(intent, { origin = 'js' } = {}) {
    const prev = snapshot();
    const from = topOf(stack);
    switch (intent.kind) {
      case 'push': {
        stack = [...stack, intent.entry];
        setTransition('push', { animate: true, cause: intent.cause || 'ui', from, to: intent.entry });
        break;
      }
      case 'replace': {
        if (stack.length < 2) return null;
        stack = [...stack.slice(0, -1), intent.entry];
        setTransition('replace', { animate: !!intent.animate, cause: 'ui', from, to: intent.entry });
        break;
      }
      case 'pop': {
        if (stack.length < 2) return null;
        stack = stack.slice(0, -1);
        setTransition('pop', { animate: intent.cause !== 'native', cause: intent.cause || 'ui', from, to: topOf(stack) });
        break;
      }
      case 'tab': {
        if (stack.length === 1 && stack[0].n === intent.entry.n) return [];
        stack = [intent.entry];
        setTransition('tab', { animate: false, cause: 'ui', from, to: intent.entry });
        break;
      }
      case 'params': {
        const top = topOf(stack);
        if (!top) return [];
        const entry = { ...top, p: { ...top.p, ...plainParams(intent.patch) } };
        stack = [...stack.slice(0, -1), entry];
        if (transition && transition.to && transition.to.id === entry.id) transition = { ...transition, to: entry };
        emit();
        return [];
      }
      case 'restore': {
        const entries = entriesOf(intent.stack, nextId);
        if (!entries) return null;
        bump(entries);
        stack = entries;
        setTransition('none', { animate: false, cause: 'restore', from, to: topOf(stack), cold: !!intent.cold });
        break;
      }
      default:
        return null;
    }
    navSeq += 1;
    if (intent.kind !== 'restore') account(transition);
    const next = snapshot();
    let bodies = [];
    try {
      bodies = intent.silent ? [] : hosts(prev, next, transition, { origin });
    } catch (error) {
      onError(error);
    }
    // 原生发起的：订阅者（路由提示写入是一次同步落库）放到转场之后——点按到转场第一帧的路上只有记账与视图回包（原生随后还会 route.save）
    if (origin === 'native') setTimeout(emit, NATIVE_EMIT_DELAY_MS);
    else emit();
    return bodies;
  }

  /** JS 发起：本地记上，告诉原生去哪（原生照做、存栈），宿主消息紧跟着发。 */
  function request(intent) {
    const bodies = apply(intent, { origin: 'js' });
    if (bodies === null) return false;
    jsSeq += 1;
    const wire = { op: 'nav', kind: intent.kind, seq: jsSeq };
    if (intent.entry) wire.entry = { id: intent.entry.id, n: intent.entry.n, p: intent.entry.p };
    if (intent.kind === 'replace') wire.animate = !!intent.animate;
    if (intent.kind === 'pop') wire.cause = intent.cause || 'ui';
    if (intent.kind === 'params') wire.patch = intent.patch;
    post(wire);
    deliver(bodies);
    return true;
  }

  const router = {
    /** 冷启动（route.plan）/ 页面重载后对齐（stage.resync）：按给定的栈重建镜像，返回宿主消息（silent 时不算）。 */
    start(list, { cold = false, silent = false } = {}) {
      const want = Array.isArray(list) && list.length ? list : [{ n: defaultTab, p: {} }];
      let bodies = apply({ kind: 'restore', stack: want, cold, silent });
      if (bodies === null) bodies = apply({ kind: 'restore', stack: [{ n: defaultTab, p: {} }], cold: false, silent }) || [];
      return { stack: stack.map(e => ({ id: e.id, n: e.n, p: e.p })), bodies };
    },
    /** 原生发起的导航：只记账、返回宿主消息。 */
    apply: intent => apply(intent, { origin: 'native' }),
    /** 原生存栈（route.save）：以原生的栈为准（没有转场、不发宿主消息）。返回是否有变。 */
    adopt(list, seq = null) {
      if (Number.isFinite(seq) && seq < jsSeq) return false; // 原生还没做到 JS 刚发出的意图：这份栈是旧的
      const entries = entriesOf(list, nextId);
      if (!entries) return false;
      const same = entries.length === stack.length && entries.every((e, i) => e.id === stack[i].id && e.n === stack[i].n && JSON.stringify(e.p) === JSON.stringify(stack[i].p));
      if (same) return false;
      bump(entries);
      stack = entries;
      navSeq += 1;
      emit();
      return true;
    },
    getState: snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    canGoBack: () => stack.length > 1,
    whenIdle(fn) {
      if (typeof fn !== 'function') throw new TypeError('router.whenIdle: fn must be a function');
      fn();
    },
    push(name, params = {}) {
      const def = getScreen(name);
      if (!def) throw new Error(`router.push: unknown screen "${name}"`);
      if (def.tab) {
        router.switchTab(name);
        return;
      }
      request({ kind: 'push', entry: { k: 's', id: nextId(), n: name, p: plainParams(params) } });
    },
    replace(name, params = {}, opts = {}) {
      const def = getScreen(name);
      if (!def || def.tab) throw new Error(`router.replace: "${name}" is not a registered sub screen`);
      if (stack.length < 2) throw new Error('router.replace: top entry is not a sub screen');
      request({ kind: 'replace', entry: { k: 's', id: nextId(), n: name, p: plainParams(params) }, animate: !!(opts && opts.animate) });
    },
    setParams(patch) {
      request({ kind: 'params', patch: plainParams(patch) });
    },
    back({ cause = 'ui' } = {}) {
      if (stack.length < 2) return false;
      request({ kind: 'pop', cause });
      return true;
    },
    switchTab(name) {
      const def = getScreen(name);
      if (!def || !def.tab) throw new Error(`router.switchTab: "${name}" is not a registered tab screen`);
      if (stack.length === 1 && stack[0].n === name) return;
      request({ kind: 'tab', entry: { k: 's', id: nextId(), n: name, p: {} } });
    },
    // 网页弹层：段 2 起 App 里的弹层全部是原生的（查字 / S02 / 图片 / 选择弹层），不会走到这里；走到了说明有入口漏了原生化
    openOverlay(component, props, { name = 'overlay' } = {}) {
      onError(new Error(`engine: web overlay "${name}" requested in engine mode`));
      return nextId();
    },
    updateOverlay() {},
    closeOverlay() {},
    getOverlay: () => null,
    handleNativeBack: () => router.back({ cause: 'native' }),
    beginBack: () => false,
    setBackProgress: () => false,
    endBack: () => false,
    finishBack: () => false,
    cancelBack: () => false,
    setNativeBackFilter() {},
    attachBackGesture() {},
    handlePopState() {},
  };
  return router;
}

// ---------------------------------------------------------------- 宿主消息

/** 宿主种类：写字 / 重写错字 / 结果页走 B2 通道（nativeWrite），其余原生屏走通用通道（native）；网页独有的屏（开发用演示页）没有宿主。 */
export function hostKind(name) {
  if (name === 'write') return 'write';
  if (name === 'redo') return 'redo';
  if (name === 'result') return 'result';
  return nativeScreenOn(name) ? 'screen' : null;
}

/** 结果条目让开（被推入的页盖住）过：再回到顶上时请原生 via 'return' 盖上（原 NativeResultHost 的 awayResult）。 */
const resultAway = new Set();

/**
 * 新旧两个栈 → 给原生的宿主消息（原来宿主组件挂载 / 卸载 / 被盖住 / 回到顶上时发的同一批消息，顺序同 Preact 一次提交：先卸后挂）：
 *   1. 离开栈的条目（从上往下）：close / result-close（away:false，并清 lastEnded，同网页结果页卸载）/ redo-close；
 *   2. 原来的顶层还在栈里、被新顶层盖住：结果页 result-close away:true（写字页「看这个字 ›」与通用屏 stage.cover 的让开由它们自己记）；
 *   3. 新进来的条目（从下往上）：open / result-open / redo-open（tab 根带 root:true）；
 *   4. 回到顶上的条目：让开过的（结果页 / 写字页 / stage.cover 过的通用屏）请原生 via 'return' 盖上。
 */
export function hostBodies(prev, next, tr) {
  const out = [];
  const before = prev && prev.stack ? prev.stack : [];
  const after = next && next.stack ? next.stack : [];
  const nextIds = new Set(after.map(e => e.id));
  const prevIds = new Set(before.map(e => e.id));
  // 1. 离开栈的
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const e = before[i];
    if (nextIds.has(e.id)) continue;
    const kind = hostKind(e.n);
    resultAway.delete(e.id);
    takeAway(e.id);
    if (kind === 'write') out.push({ type: 'nativeWrite', body: writeCloseBody(e) });
    else if (kind === 'redo') out.push({ type: 'nativeWrite', body: redoCloseBody(e) });
    else if (kind === 'result') out.push({ type: 'nativeWrite', body: resultCloseBody(e, { away: false }) });
    else if (kind === 'screen') out.push({ type: 'native', body: { op: 'close', screen: e.n, entryId: e.id } });
  }
  // 2. 原来的顶层被盖住
  const oldTop = topOf(before);
  const newTop = topOf(after);
  if (oldTop && newTop && oldTop.id !== newTop.id && nextIds.has(oldTop.id) && hostKind(oldTop.n) === 'result') {
    resultAway.add(oldTop.id);
    out.push({ type: 'nativeWrite', body: resultCloseBody(oldTop, { away: true }) });
  }
  // 3. 新进来的
  for (const e of after) {
    if (prevIds.has(e.id)) continue;
    const kind = hostKind(e.n);
    if (kind === 'write') out.push({ type: 'nativeWrite', body: writeOpenBody(e, next) });
    else if (kind === 'redo') {
      const body = redoOpenBody(e, next);
      if (body) out.push({ type: 'nativeWrite', body });
    } else if (kind === 'result') {
      if (newTop && newTop.id === e.id) out.push({ type: 'nativeWrite', body: resultOpenBody(e, next, { returning: false }) });
      else resultAway.add(e.id); // 冷启动恢复出的、上面还压着页的结果条目：回到顶上时再请原生
    } else if (kind === 'screen') out.push({ type: 'native', body: screenOpenMessage(e, next) });
  }
  // 4. 回到顶上的
  if (newTop && prevIds.has(newTop.id) && (!oldTop || oldTop.id !== newTop.id)) {
    const kind = hostKind(newTop.n);
    if (kind === 'result' && resultAway.has(newTop.id)) {
      resultAway.delete(newTop.id);
      out.push({ type: 'nativeWrite', body: resultOpenBody(newTop, next, { returning: true }) });
    } else if (kind === 'write' && takeWriteAway(newTop.id)) {
      out.push({ type: 'nativeWrite', body: writeOpenBody(newTop, next, { returning: true }) });
    } else if (kind === 'screen' && takeAway(newTop.id)) {
      out.push({ type: 'native', body: screenOpenMessage(newTop, next, { returning: true }) });
    }
  }
  return out;
}

/** 宿主消息按序发给原生（视图回包是 Promise 的等它好了再发；排在它后面的消息跟着等，顺序不变）。 */
let chain = null;
function deliver(bodies) {
  for (const b of bodies || []) {
    const async = !!(b.body && typeof b.body.then === 'function');
    if (!async && !chain) {
      postNative(b.type, b.body);
      continue;
    }
    const mine = (chain || Promise.resolve()).then(() => Promise.resolve(b.body)).then(body => { if (body) postNative(b.type, body); }, () => {});
    chain = mine;
    mine.then(() => { if (chain === mine) chain = null; });
  }
}

/** 原生发起的导航回包里的宿主消息：Promise 的先等好（回包一次带全）。 */
async function resolved(bodies) {
  const out = [];
  for (const b of bodies || []) {
    const body = await Promise.resolve(b.body);
    if (body) out.push({ type: b.type, body });
  }
  return out;
}

/** 栈里从底往上第一页不合格（RESTORE_GUARDS）之前的那一段。 */
function validPrefix(stack, store) {
  const state = store && typeof store.getState === 'function' ? store.getState() : null;
  const ctx = { state, now: envNow(), policy: defaultPolicy, lookup: cardForKey };
  const out = [];
  for (const e of stack) {
    const guard = Object.prototype.hasOwnProperty.call(RESTORE_GUARDS, e.n) ? RESTORE_GUARDS[e.n] : null;
    let ok = true;
    if (guard) {
      try { ok = guard(e.p, ctx) === true; } catch (error) { ok = false; }
    }
    if (!ok) break;
    out.push(e);
  }
  return out.length ? out : stack.slice(0, 1);
}

// ---------------------------------------------------------------- 阻断页、坏值提示（原来由根组件画）

function watchBlock(store) {
  let openKey = null; // 当前发给原生的阻断页（kind|canExport）
  let openId = null;
  const check = () => {
    let reason = null;
    try { reason = blockReasonOf(store.status); } catch (error) { reason = { kind: 'unavailable', detail: 'error' }; }
    const kind = reason ? reason.kind : null;
    const canExport = kind === 'blocked' && !!store.status.available && hasJudged(store); // 同 BlockScreen
    const key = kind ? `${kind}|${canExport}` : null;
    if (key === openKey) return;
    // 同网页 BlockScreen 的 effect（deps: kind, canExport）：先收旧的再开新的
    if (openId) postNative('native', { op: 'close', entryId: openId });
    openKey = key;
    openId = kind ? `${BLOCK_SCREEN}-${kind}` : null;
    if (!kind) return;
    postNative('native', {
      op: 'open', screen: BLOCK_SCREEN, entryId: openId, params: { kind, canExport }, via: 'restore', run: [],
      payload: { ok: true, view: blockView({ kind, canExport }) },
    });
  };
  check();
  onBlockReasonChange(check); // 迁移失败（R-B09 迁移变体）不在 store.status 里
  return store.subscribe(check);
}

function watchCorrupt(store) {
  const check = () => {
    const current = store.status && store.status.corruptNotice;
    if (!current) return;
    store.ackCorruptNotice();
    const keys = Array.isArray(current.keys) ? current.keys.slice() : [];
    postNative('native', { op: 'corrupt', show: true, keys, lines: corruptNoticeLines() });
  };
  check();
  return store.subscribe(check);
}

// ---------------------------------------------------------------- 启动

let engine = null;

/** 引擎的导航镜像（QA / 测试读；没在引擎模式时 null）。 */
export function getEngine() {
  return engine;
}

/**
 * 引擎模式启动（app.js 在 store 建好、迁移与外观之后调用，代替 mountRoot）。原生等 pageReady 后调 route.plan 重建栈。
 * @returns {Promise<object>} 导航镜像
 */
export async function mountEngine({ win = globalWin(), defaultTab = 'home' } = {}) {
  await import('./root.js'); // 屏模块与它们的登记（setHomeActions、图片去处、关于 / 提醒 / 备份 / 年报屏……）；不调 mountRoot
  const router = createEngineRouter({ post: msg => postNative('native', msg), hosts: hostBodies, defaultTab });
  setActiveRouter(router);
  const memory = createRouteMemory({ getStore, win, defaultTab });
  let attached = false;
  const attach = () => {
    if (attached) return;
    attached = true;
    memory.attach(router);
    setRouteMemory(memory);
  };
  setEngineHooks({
    /** route.plan {deepLink?}：冷启动判定（守卫、过期、深链 / 坏值 / 阻断优先全在 planColdStart），按结果重建镜像；回包带原生要建的栈与宿主消息。 */
    async plan(args) {
      const s = (() => { try { return getStore(); } catch (error) { return null; } })();
      const stack = memory.coldStart({ deepLink: !!(args && args.deepLink) });
      const plan = memory.lastPlan();
      const r = router.start(stack, { cold: !!stack });
      attach();
      return { ok: true, reason: plan ? plan.reason : null, restored: !!stack, stack: r.stack, bodies: await resolved(r.bodies), blocked: !!(s && blockReasonOf(s.status)) };
    },
    /** stage.resync {stack}：页面重载（WebContent 被回收）后，按原生还在屏上的栈对齐镜像，不发宿主消息（原生页留着）。 */
    async resync(args) {
      const r = router.start(args && args.stack, { silent: true });
      attach();
      const s = (() => { try { return getStore(); } catch (error) { return null; } })();
      // 重载期间数据可能变了（组没了、字没了）：栈从底往上过一遍同一张逐页有效性表（RESTORE_GUARDS，不看离开时长），第一页不合格起全部收起
      const keep = validPrefix(r.stack, s);
      let bodies = [];
      if (keep.length < r.stack.length) bodies = router.apply({ kind: 'restore', stack: keep }) || [];
      return { ok: true, stack: keep, bodies: await resolved(bodies), blocked: !!(s && blockReasonOf(s.status)) };
    },
    /** route.save {stack}：原生的栈是真相——对齐镜像，写提示键（storage.writeRoute，单一写入者）；flush = 进后台刷新离开时刻。 */
    save(args) {
      router.adopt(args && args.stack, args && Number.isFinite(args.seq) ? args.seq : null);
      attach();
      const res = args && args.flush ? memory.flush() : null;
      return { ok: true, written: !!(res && res.ok) };
    },
    /** stage.enter {kind, entry?, cause?, patch?, animate?}：原生发起的导航记账，回包带宿主消息（视图回包等好）。 */
    async enter(args) {
      const a = args || {};
      const intent = { kind: a.kind, cause: a.cause, animate: a.animate, patch: a.patch };
      if (a.entry) intent.entry = { k: 's', id: String(a.entry.id), n: String(a.entry.n), p: plainParams(a.entry.p) };
      const bodies = router.apply(intent);
      if (bodies === null) return { ok: false, error: { kind: 'invalid' } };
      return { ok: true, bodies: await resolved(bodies) };
    },
    /** deeplink.reminder {cardKey}：与原来 shiziOpenReminderTarget 同一个处理（reminder.js：runDeepLink → 开 B 组 / S02）；去哪由它发的 nav 决定。 */
    deepLink(args) {
      const fn = win && typeof win.shiziOpenReminderTarget === 'function' ? win.shiziOpenReminderTarget : null;
      if (!fn || !args || typeof args.cardKey !== 'string' || !args.cardKey) return { ok: false, error: { kind: 'unavailable' } };
      return { ok: fn(args.cardKey) === true };
    },
  });
  installNativeStage(win, { nav: router });
  let store = null;
  try { store = getStore(); } catch (error) { store = null; }
  if (store && typeof store.subscribe === 'function') {
    watchBlock(store);
    watchCorrupt(store);
    installCommitFeedback(() => store, { haptics: false }); // 判断声 j1 轮换（触觉原生自己发）；网页界面不挂，只有这里装一次
  }
  engine = router;
  return router;
}

export { routeStackOf };
