// B4.9a：导航层（ShiziCore Navigation/）的参考 op。全部调 src/ 里的真函数：route-memory.js 的纯函数与 createRouteMemory、engine.js 的
// createEngineRouter / hostBodies / validPrefix、paper-transition.js 的来源记账、native-session.js 的 WRITE_NAVIGATE / RESULT_DEPS 与各条宿主消息、
// session/index.js openWrite、detail/open.js openCharDetail、result/index.js leaveTo。桩只有会话 API / 视图回包 / 时钟（hostBodies 的 io）。
//
//   nav.route.parse {raw}                      parseRoute
//   nav.route.encode {stack, at}               encodeRoute
//   nav.route.fresh {at, now, routeRestore?}   routeFresh
//   nav.route.stackOf {snap}                   routeStackOf
//   nav.route.plan {raw, state, blocked?, corrupt?, deepLink?, now, routeRestore?}   planColdStart(parseRoute(raw), …)
//   nav.route.guard {name, p, state, now}      RESTORE_GUARDS[name]（没有 guard → null）
//   nav.route.validPrefix {stack, state, now}  engine.js validPrefix
//   nav.scenario {native, now, steps:[…]}      一个导航镜像从头跑一串步骤（见 SCENARIO_STEPS），每步回宿主消息 / 发给原生的意图 / 桩调用 / 提示键写入 / 快照
import * as routeMemory from '../../../src/ui/route-memory.js';
import * as policy from '../../../src/config/policy.js';
import { getScreen, registerScreen, setActiveRouter } from '../../../src/ui/router.js';
import { createEngineRouter, hostBodies, validPrefix } from '../../../src/ui/engine.js';
import * as paper from '../../../src/ui/paper-transition.js';
import { WRITE_NAVIGATE, RESULT_DEPS, resetNativeHostState, nativeNavCall } from '../../../src/ui/screens/write/native-session.js';
import { openWrite } from '../../../src/ui/screens/session/index.js';
import { openCharDetail } from '../../../src/ui/screens/detail/open.js';
import { leaveTo, takeSkipUndo } from '../../../src/ui/screens/result/index.js';
import { stageCall } from '../../../src/ui/native-stage.js';
import { setDeckSource, cardForKey } from '../../../src/data/deck.js';
import { deckSources } from '../../build_core_config.mjs';

/** App 引擎模式登记的屏（ShiziCore NavScreens.app 同一份；test/core/nav-screens.test.mjs 守住与 src 的 registerScreen 同步）。 */
export const NAV_TABS = ['home', 'library', 'mine'];
export const NAV_SUBS = ['write', 'redo', 'result', 'session-none', 's02', 'query', 'image-preview', 'image-toast',
  'library-all', 'library-switch', 'library-list', 'detail', 'detail-photo',
  'records', 'about', 'about-privacy', 'about-credits', 'about-letter', 'backup', 'annual', 'remind', 'month', 'block',
  '_demo/sub', 'query-demo'];
const NOOP = () => null;
let registered = false;
function ensureScreens() {
  if (registered) return;
  registered = true;
  NAV_TABS.forEach((n, i) => { if (!getScreen(n)) registerScreen(n, NOOP, { tab: true, order: i }); });
  for (const n of NAV_SUBS) if (!getScreen(n)) registerScreen(n, NOOP, {});
}

/** JS 里异步的视图回包（session/api/detail.js view.detail 是 async）：桩用同步的 thenable，结果确定、不进微任务。 */
const ASYNC_VIEWS = new Set(['detail']);
function thenable(v) {
  return { then(ok) { return thenable(ok ? ok(v) : v); } };
}
function settle(v) {
  let out = v;
  while (out && typeof out.then === 'function') out.then(x => { out = x; });
  return out;
}

/** 桩调用记录里的跳过撤销：截止时刻是界面单调时钟（两边各自的），只比是不是有限数。 */
function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = k === 'until' ? (Number.isFinite(v[k]) ? 'finite' : String(v[k])) : norm(v[k]);
    return o;
  }
  return v === undefined ? null : v;
}

function plainStack(stack) {
  return stack.map(e => ({ id: e.id, n: e.n, p: e.p }));
}
function snapOf(s) {
  const t = s.transition;
  const tr = t ? { seq: t.seq, kind: t.kind, animate: t.animate, cause: t.cause, from: t.from ? t.from.id : null, to: t.to ? t.to.id : null, ...(t.cold ? { cold: true } : {}) } : null;
  return { stack: plainStack(s.stack), depth: s.depth, tab: s.tab, navSeq: s.navSeq, transition: tr };
}

export function makeB49Ops({ clock }) {
  const rr = a => (a.routeRestore ? { ...policy, routeRestore: a.routeRestore } : policy);
  const deck = () => setDeckSource(deckSources());
  return {
    'nav.route.parse': a => routeMemory.parseRoute(a.raw),
    'nav.route.encode': a => routeMemory.encodeRoute(a.stack, a.at),
    'nav.route.fresh': a => routeMemory.routeFresh(a.at, a.now, rr(a)),
    'nav.route.stackOf': a => routeMemory.routeStackOf(a.snap),
    'nav.route.plan': a => {
      ensureScreens();
      deck();
      return routeMemory.planColdStart({
        route: routeMemory.parseRoute(a.raw), state: a.state ?? null, blockReason: a.blocked ? { kind: 'blocked' } : null, corrupt: !!a.corrupt,
        deepLink: !!a.deepLink, now: a.now ?? clock(), policy: rr(a),
      });
    },
    'nav.route.guard': a => {
      deck();
      const g = Object.prototype.hasOwnProperty.call(routeMemory.RESTORE_GUARDS, a.name) ? routeMemory.RESTORE_GUARDS[a.name] : null;
      if (!g) return null;
      try { return g(a.p, { state: a.state ?? null, now: a.now ?? clock(), policy, lookup: cardForKey }) === true; } catch (error) { return false; }
    },
    'nav.route.validPrefix': a => {
      deck();
      return validPrefix(a.stack, { getState: () => a.state ?? null }, a.now ?? clock());
    },
    'nav.scenario': a => scenario(a),
  };
}


/**
 * 场景步骤（每步一个对象，do 选一种）：
 *   start {stack, cold?, silent?}      router.start（冷启动 / 重载对齐）
 *   enter {kind, entry?, cause?, patch?, animate?}   stage.enter（原生发起的导航记账）
 *   push {name, params?} / replace {name, params?, animate?} / back {cause?} / tab {name} / params {patch}   JS 发起
 *   adopt {stack, seq?}                route.save 的对齐
 *   mark {source, key} / overlay / live {key, live} / forget          来源记账（原生入口 / 原生弹层点按 / 入口此刻位置 / 作废）
 *   cover {entryId, url?}              stage.cover
 *   write {fn, args}                   WRITE_NAVIGATE[fn]（back / toResult / toDetail / redoBack）
 *   result {fn, args}                  RESULT_DEPS[fn]（again / toWrite / redo / detail / leave）
 *   openWrite {slot} / detail {char} / leaveTo {leave}
 *   attach / hidden / flush / deepLink  createRouteMemory（attach、切后台、刷新、提醒深链 yieldToDeepLink）
 *   backPlan                           shiziNativeNav back
 */
function scenario(a) {
  ensureScreens();
  setDeckSource(deckSources());
  paper.resetPaperSources();
  resetNativeHostState();
  takeSkipUndo('', '');
  const native = new Set(Array.isArray(a.native) ? a.native : []);
  const away = new Set();
  const resultAway = new Set();
  let calls = [];
  let captured = [];
  let posted = [];
  let writes = [];
  const timers = [];
  const io = {
    api: { call: (op, args) => { const r = op === 'redoOpen' ? { ok: Array.isArray(args.chars) && args.chars.length > 0, op } : { ok: true, op }; calls.push({ api: op, args: norm(args), ok: r.ok }); return r; } },
    view: (name, params) => { calls.push({ view: name, params: norm(params) }); const v = { ok: true, view: name }; return ASYNC_VIEWS.has(name) ? thenable(v) : v; },
    now: () => 0,
    nativeOn: name => native.has(name),
    undo: (slot, sessionId) => { const u = takeSkipUndo(slot, sessionId); calls.push({ undo: [slot, sessionId], got: norm(u) }); return u; },
    leave: (slot, sessionId) => { calls.push({ leave: [slot, sessionId] }); },
    width: () => 390,
    ax: () => false,
    back: () => {},
    takeAway: id => { if (!id || !away.has(id)) return false; away.delete(id); return true; },
    resultAway,
  };
  const router = createEngineRouter({
    post: m => posted.push(m),
    hosts: (prev, next, tr) => { const b = hostBodies(prev, next, tr, io); captured.push(...b); return b; },
    onError: e => { throw e; },
  });
  setActiveRouter(router);
  const doc = { visibilityState: 'visible', handlers: [], addEventListener(type, fn) { if (type === 'visibilitychange') this.handlers.push(fn); }, removeEventListener() {} };
  const win = { document: doc, addEventListener() {}, removeEventListener() {} };
  const fakeStore = { storage: { read: () => null, writeRoute: raw => { writes.push(raw); return { ok: true }; } }, status: { available: true }, getState: () => ({}) };
  const memory = routeMemory.createRouteMemory({ getStore: () => fakeStore, win, now: () => (a.now ?? 0), bridge: { pending: () => [] } });
  const savedSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = fn => { timers.push(fn); return timers.length; };
  const out = [];
  try {
    for (const step of Array.isArray(a.steps) ? a.steps : []) {
      calls = []; captured = []; posted = []; writes = [];
      let ret = null;
      try {
        ret = runStep(step, { router, memory, doc, away });
      } catch (error) {
        ret = { error: true };
      }
      // 步骤之后：推迟的订阅者（原生发起的导航）与「重写错字页没有能练的字 → 退回去」
      while (timers.length) timers.shift()();
      if (calls.some(c => c.api === 'redoOpen' && c.ok === false)) router.back();
      while (timers.length) timers.shift()();
      const s = router.getState();
      const plans = {};
      const sources = {};
      for (const e of s.stack) { plans[e.id] = paper.nativePlanOf(e.id); sources[e.id] = paper.paperSourceOf(e.id); }
      out.push({
        ret: norm(ret),
        bodies: captured.map(b => ({ type: b.type, body: norm(settle(b.body)) })).filter(b => b.body),
        posted: norm(posted), calls, writes, snap: snapOf(s), plans: norm(plans), sources: norm(sources), pristine: memory.pristine(),
      });
    }
  } finally {
    globalThis.setTimeout = savedSetTimeout;
    setActiveRouter(null);
  }
  return out;
}

function plainParams(p) {
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

function runStep(step, { router, memory, doc, away }) {
  switch (step.do) {
    case 'start': return { stack: router.start(step.stack, { cold: !!step.cold, silent: !!step.silent }).stack };
    case 'enter': {
      const intent = { kind: step.kind, cause: step.cause, animate: step.animate, patch: step.patch };
      if (step.entry) intent.entry = { k: 's', id: String(step.entry.id), n: String(step.entry.n), p: plainParams(step.entry.p) };
      const bodies = router.apply(intent);
      return bodies === null ? { ok: false } : { ok: true };
    }
    case 'push': router.push(step.name, step.params); return null;
    case 'replace': router.replace(step.name, step.params, { animate: !!step.animate }); return null;
    case 'back': return router.back({ cause: step.cause || 'ui' });
    case 'tab': router.switchTab(step.name); return null;
    case 'params': router.setParams(step.patch); return null;
    case 'adopt': return router.adopt(step.stack, Number.isFinite(step.seq) ? step.seq : null);
    case 'mark': paper.markNativePaperSource({ ...(step.source || {}), key: step.key ?? null }); return null;
    case 'overlay': paper.markNativeOverlayTap(); return null;
    case 'live': paper.setNativeLiveSource(step.key, step.live); return null;
    case 'forget': paper.forgetTap(); return null;
    case 'cover': {
      const r = stageCall('stage.cover', { entryId: step.entryId, url: step.url }, null);
      if (typeof step.entryId === 'string' && step.entryId && typeof step.url === 'string' && step.url) away.add(step.entryId);
      return r;
    }
    case 'write': return WRITE_NAVIGATE[step.fn](...(step.args || []));
    case 'result': return RESULT_DEPS[step.fn](...(step.args || []));
    case 'openWrite': return openWrite(step.slot);
    case 'detail': return openCharDetail(step.char);
    case 'leaveTo': leaveTo(step.leave); return null;
    case 'attach': memory.attach(router); return null;
    case 'hidden': doc.visibilityState = 'hidden'; doc.handlers.forEach(fn => fn()); doc.visibilityState = 'visible'; return null;
    case 'flush': memory.flush(); return null;
    case 'deepLink': {
      let ran = false;
      const how = memory.yieldToDeepLink(() => { ran = true; });
      return { how, ran };
    }
    case 'backPlan': return nativeNavCall('back', {}, null);
    default: throw new Error('unknown step ' + step.do);
  }
}
