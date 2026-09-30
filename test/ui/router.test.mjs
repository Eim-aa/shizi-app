// router 纯逻辑单测：history 抽象成可注入接口（fakeHistory：条目数组 + 异步 popstate，flush() 模拟事件循环）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRouter,
  readState,
  registerScreen,
  getScreen,
  listTabs,
  unregisterScreen,
  attachWindow,
  NATIVE_BACK_EVENT,
  PENDING_TIMEOUT_MS,
  pageDepth,
  backGestureAllowed,
  createBackGestureSync,
} from '../../src/ui/router.js';
import { createBridge } from '../../src/platform/bridge.js';
import { createPressGuard, PRESS_GUARD_MS } from '../../src/ui/components/Button.js';

const Noop = () => null;
const Other = () => null;

function fakeHistory(initialState = null) {
  const entries = [{ state: initialState === null ? null : structuredClone(initialState) }];
  let index = 0;
  const queued = [];
  let listener = null;
  const calls = { push: 0, replace: 0, back: 0, go: [] };
  return {
    calls,
    get state() {
      return entries[index].state;
    },
    get length() {
      return entries.length;
    },
    get index() {
      return index;
    },
    entries,
    pushState(state) {
      calls.push += 1;
      entries.splice(index + 1);
      entries.push({ state: structuredClone(state) });
      index += 1;
    },
    replaceState(state) {
      calls.replace += 1;
      entries[index] = { state: structuredClone(state) };
    },
    back() {
      calls.back += 1;
      this.go(-1, true);
    },
    go(n, fromBack = false) {
      if (!fromBack) calls.go.push(n);
      const target = index + n;
      if (target < 0 || target >= entries.length) return; // 真实浏览器：离开文档或无动作
      queued.push(target);
    },
    // 模拟系统返回键 / 浏览器返回（不经 router）
    systemBack() {
      this.go(-1, true);
    },
    systemForward() {
      this.go(1, true);
    },
    onPop(fn) {
      listener = fn;
    },
    flush() {
      while (queued.length) {
        index = queued.shift();
        if (listener) listener(entries[index].state);
      }
    },
  };
}

function fakeTimers() {
  const timers = new Map();
  let id = 0;
  return {
    setTimeout(fn, ms) {
      id += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(t) {
      timers.delete(t);
    },
    runAll() {
      for (const [k, t] of [...timers]) {
        timers.delete(k);
        t.fn();
      }
    },
    size: () => timers.size,
  };
}

function setup({ state = null, standalone = false } = {}) {
  const history = fakeHistory(state);
  const timers = fakeTimers();
  const errors = [];
  const router = createRouter({
    history,
    isStandalone: () => standalone,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onError: e => errors.push(e),
  });
  history.onPop(s => router.handlePopState(s));
  const snaps = [];
  router.subscribe(s => snaps.push(s));
  return { history, timers, router, errors, snaps };
}

registerScreen('t-home', Noop, { tab: true, order: 0, label: 'H' });
registerScreen('t-lib', Noop, { tab: true, order: 1, label: 'L' });
registerScreen('t-mine', Noop, { tab: true, order: 2, label: 'M' });
registerScreen('t-sub', Other, { label: 'S' });
registerScreen('t-sub2', Other);

const names = r => r.getState().stack.map(e => e.n);

test('registerScreen: self-registration, tab ordering, bad input rejected', () => {
  assert.equal(getScreen('t-sub').component, Other);
  const tabs = listTabs().filter(t => t.name.startsWith('t-')).map(t => t.name);
  assert.deepEqual(tabs, ['t-home', 't-lib', 't-mine']);
  assert.throws(() => registerScreen('', Noop));
  assert.throws(() => registerScreen('x', 'not a function'));
  registerScreen('t-temp', Noop);
  unregisterScreen('t-temp');
  assert.equal(getScreen('t-temp'), null);
});

test('start: replaceState the current entry with depth 0 and the default tab', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  assert.equal(history.length, 1);
  assert.equal(history.calls.replace, 1);
  const st = readState(history.state);
  assert.equal(st.depth, 0);
  assert.equal(st.name, 't-home');
  assert.equal(st.tab, 't-home');
  assert.deepEqual(names(router), ['t-home']);
  assert.throws(() => setup().router.start({ defaultTab: 't-sub' }), /not a registered tab/);
});

test('push only pushState; state carries {depth, name, params, stack}', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  router.push('t-sub', { level: 1 });
  assert.equal(history.length, 2);
  const st = history.state;
  assert.equal(st.depth, 1);
  assert.equal(st.name, 't-sub');
  assert.deepEqual(st.params, { level: 1 });
  assert.deepEqual(st.stack.map(e => e.n), ['t-home', 't-sub']);
  const s = router.getState();
  assert.equal(s.depth, 1);
  assert.equal(s.transition.kind, 'push');
  assert.equal(s.transition.animate, true);
  assert.equal(s.transition.from.n, 't-home');
  assert.throws(() => router.push('nope'), /unknown screen/);
});

test('back calls history.back and applies the change only in popstate', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  router.push('t-sub', { level: 1 });
  assert.equal(router.back(), true);
  assert.equal(history.calls.back, 1);
  assert.equal(router.getState().depth, 1, 'nothing changes before popstate');
  history.flush();
  const s = router.getState();
  assert.equal(s.depth, 0);
  assert.deepEqual(names(router), ['t-home']);
  assert.equal(s.transition.kind, 'pop');
  assert.equal(s.transition.cause, 'ui');
  assert.equal(s.transition.animate, true);
});

test('tab root: back() is a no-op and never calls history.back (does not leave the page)', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  assert.equal(router.back(), false);
  assert.equal(router.handleNativeBack(), false);
  assert.equal(history.calls.back, 0);
  assert.equal(router.canGoBack(), false);
});

test('three pushes + three system backs return to the tab root, history index 0', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  for (let i = 1; i <= 3; i += 1) router.push('t-sub', { level: i });
  assert.equal(history.length, 4);
  assert.equal(router.getState().depth, 3);
  for (let d = 2; d >= 0; d -= 1) {
    history.systemBack();
    history.flush();
    assert.equal(router.getState().depth, d);
    assert.equal(router.getState().transition.cause, 'system');
    assert.equal(router.getState().transition.kind, 'pop');
    if (d > 0) assert.deepEqual(router.getState().top.p, { level: d });
  }
  assert.equal(history.index, 0);
  assert.deepEqual(names(router), ['t-home']);
});

test('popstate applies the depth difference (go(-2) pops two, forward pushes back)', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  router.push('t-sub', { level: 1 });
  router.push('t-sub2', { level: 2 });
  history.go(-2);
  history.flush();
  assert.equal(router.getState().depth, 0);
  assert.equal(router.getState().transition.kind, 'pop');
  assert.equal(router.getState().transition.from.n, 't-sub2');
  history.systemForward();
  history.flush();
  assert.equal(router.getState().depth, 1);
  assert.equal(router.getState().transition.kind, 'push');
  assert.equal(router.getState().top.n, 't-sub');
});

test('switchTab at the root uses replaceState (no new entry, no animation)', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  router.switchTab('t-lib');
  assert.equal(history.length, 1);
  assert.equal(history.state.tab, 't-lib');
  assert.equal(router.getState().transition.kind, 'tab');
  assert.equal(router.getState().transition.animate, false);
  assert.throws(() => router.switchTab('t-sub'), /not a registered tab/);
});

test('switchTab from a sub page goes back silently to the root, then replaces the tab', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  router.push('t-sub');
  router.push('t-sub');
  router.switchTab('t-mine');
  assert.deepEqual(history.calls.go, [-2]);
  history.flush();
  const s = router.getState();
  assert.equal(s.depth, 0);
  assert.deepEqual(names(router), ['t-mine']);
  assert.equal(history.index, 0);
  assert.equal(history.state.tab, 't-mine');
});

test('overlay stack: overlay takes an entry; back closes the overlay before the page', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  router.push('t-sub');
  const id = router.openOverlay(Noop, { a: 1 }, { name: 'confirm' });
  assert.equal(history.length, 3);
  assert.equal(router.getState().depth, 2);
  assert.equal(router.getState().topIsOverlay, true);
  assert.equal(router.getState().top.n, 't-sub', 'overlay does not change the top screen');
  assert.deepEqual(router.getOverlay(id).props, { a: 1 });
  router.updateOverlay(id, { b: 2 });
  assert.deepEqual(router.getOverlay(id).props, { a: 1, b: 2 });
  const seqBefore = router.getState().transition.seq;
  router.back();
  history.flush();
  assert.equal(router.getOverlay(id), null, 'closed overlay is dropped from memory');
  assert.equal(router.getState().depth, 1);
  assert.equal(router.getState().top.n, 't-sub');
  assert.equal(router.getState().transition.seq, seqBefore, 'closing an overlay is not a page transition');
});

test('closeOverlay closes the overlay together with pages pushed over it', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  const id = router.openOverlay(Noop, {});
  router.push('t-sub');
  assert.equal(router.getState().depth, 2);
  history.systemBack();
  history.flush();
  assert.equal(router.getState().topIsOverlay, true, 'back from the pushed page returns to the open overlay');
  assert.ok(router.getOverlay(id));
  router.push('t-sub');
  router.closeOverlay(id);
  assert.deepEqual(history.calls.go, [-2]);
  history.flush();
  assert.equal(router.getState().depth, 0);
  assert.equal(router.getOverlay(id), null);
});

test('operations issued while a back is pending run after popstate, in order', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  router.push('t-sub', { level: 1 });
  const id = router.openOverlay(Noop, {});
  router.closeOverlay(id);
  router.push('t-sub2', { level: 2 }); // queued behind the close
  assert.equal(router.getState().pending, true);
  assert.equal(history.length, 3, 'push not executed yet');
  history.flush();
  assert.deepEqual(names(router), ['t-home', 't-sub', 't-sub2']);
  assert.equal(router.getState().depth, 2);
  assert.equal(history.length, 3, 'forward overlay entry replaced by the new page');
  assert.equal(history.state.name, 't-sub2');
});

test('pending back times out if popstate never arrives, queue still drains', () => {
  const { history, router, timers } = setup();
  router.start({ defaultTab: 't-home' });
  router.push('t-sub');
  router.back();
  router.push('t-sub2');
  assert.equal(router.getState().pending, true);
  history.entries.length = history.index + 1; // 丢掉排队中的 popstate
  timers.runAll();
  assert.equal(router.getState().pending, false);
  assert.equal(router.getState().top.n, 't-sub2');
  assert.ok(PENDING_TIMEOUT_MS >= 500);
});

test('standalone PWA: system back skips the transition, UI back keeps it', () => {
  const { history, router } = setup({ standalone: true });
  router.start({ defaultTab: 't-home' });
  router.push('t-sub');
  router.push('t-sub');
  history.systemBack();
  history.flush();
  assert.equal(router.getState().transition.kind, 'pop');
  assert.equal(router.getState().transition.animate, false);
  router.back();
  history.flush();
  assert.equal(router.getState().transition.animate, true);
});

test('native back event: pops a page with cause "native"; attachWindow wires the event', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  router.push('t-sub');
  const handlers = new Map();
  const win = {
    addEventListener: (t, fn) => handlers.set(t, fn),
    removeEventListener: t => handlers.delete(t),
  };
  const detach = attachWindow(router, win);
  handlers.get(NATIVE_BACK_EVENT)();
  history.flush();
  assert.equal(router.getState().depth, 0);
  assert.equal(router.getState().transition.cause, 'native');
  handlers.get(NATIVE_BACK_EVENT)(); // tab 根：无动作
  assert.equal(history.calls.back, 1);
  detach();
  assert.equal(handlers.size, 0);
});

test('reload: restores the stack from history.state; dead overlays are popped silently', () => {
  const first = setup();
  first.router.start({ defaultTab: 't-home' });
  first.router.push('t-sub', { level: 1 });
  first.router.push('t-sub2', { level: 2 });
  first.router.openOverlay(Noop, {});
  // 模拟刷新：同样的 history 条目、新的 router（遮罩只活在内存里，已不存在）
  const history = fakeHistory(first.history.entries[0].state);
  for (const e of first.history.entries.slice(1)) history.pushState(e.state);
  assert.equal(history.index, 3);
  const timers = fakeTimers();
  const router = createRouter({ history, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  history.onPop(s => router.handlePopState(s));
  router.start({ defaultTab: 't-home' });
  assert.deepEqual(router.getState().stack.map(e => e.n), ['t-home', 't-sub', 't-sub2']);
  assert.equal(router.getState().topIsOverlay, false);
  assert.deepEqual(history.calls.go, [], 'go(-1) goes through back()');
  assert.equal(router.getState().pending, true);
  history.flush();
  assert.equal(router.getState().depth, 2);
  assert.equal(router.getState().transition.animate, false, 'silent: no transition');
  assert.deepEqual(router.getState().top.p, { level: 2 });
  router.push('t-sub'); // ids keep increasing past restored ones
  const ids = router.getState().stack.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('reload: unknown or foreign state starts fresh; unregistered sub screens are cut', () => {
  const legacy = setup({ state: { shiziView: 'practice' } });
  legacy.router.start({ defaultTab: 't-home' });
  assert.deepEqual(names(legacy.router), ['t-home']);
  assert.equal(readState(legacy.history.state).depth, 0);

  const gone = {
    tag: 'shizi-router', v: 1, depth: 1, name: 't-gone', params: {}, tab: 't-home',
    stack: [{ k: 's', id: 'e1', n: 't-home', p: {} }, { k: 's', id: 'e2', n: 't-gone', p: {} }],
  };
  const history = fakeHistory({ ...gone, depth: 0, stack: gone.stack.slice(0, 1) });
  history.pushState(gone);
  const router = createRouter({ history, setTimeout: () => 0, clearTimeout: () => {} });
  history.onPop(s => router.handlePopState(s));
  router.start({ defaultTab: 't-home' });
  assert.deepEqual(names(router), ['t-home']);
  history.flush();
  assert.equal(router.getState().depth, 0);
  assert.equal(history.index, 0);
});

test('foreign popstate entry (e.g. #hash) is re-stamped without changing the screen', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  router.push('t-sub');
  history.pushState(null); // 手动改 hash 产生的条目
  history.systemBack();
  history.systemForward();
  history.flush();
  assert.equal(router.getState().top.n, 't-sub');
  assert.equal(readState(history.state).name, 't-sub');
});

test('setParams / replace update the current entry in place', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  router.push('t-sub', { a: 1 });
  router.setParams({ b: 2 });
  assert.deepEqual(history.state.params, { a: 1, b: 2 });
  assert.equal(history.length, 2);
  router.replace('t-sub2', { c: 3 });
  assert.equal(history.length, 2);
  assert.equal(history.state.name, 't-sub2');
  assert.equal(router.getState().transition.kind, 'replace');
  assert.throws(() => router.replace('t-home'), /not a registered sub screen/);
});

test('navSeq changes on every structural change (drives the 0.4s press guard)', () => {
  const { history, router } = setup();
  router.start({ defaultTab: 't-home' });
  const a = router.getState().navSeq;
  router.push('t-sub');
  const b = router.getState().navSeq;
  const id = router.openOverlay(Noop, {});
  const c = router.getState().navSeq;
  router.setParams({ x: 1 });
  assert.equal(router.getState().navSeq, c, 'setParams is not a new state');
  router.closeOverlay(id);
  history.flush();
  assert.ok(a < b && b < c && c < router.getState().navSeq);
});

test('Button press guard: 0.4s after a state change and between presses, by event timeStamp', () => {
  let stateChange = 1000;
  const accept = createPressGuard(PRESS_GUARD_MS, () => stateChange);
  assert.equal(accept(1200), false, 'within 0.4s of a new page');
  assert.equal(accept(1400), true);
  assert.equal(accept(1799), false, 'second press within 0.4s');
  assert.equal(accept(1800), true);
  stateChange = 2000;
  assert.equal(accept(1990), false, 'an event stamped before the state change is dropped too');
  assert.equal(accept(2400), true);
});

test('Button press guard, rapid (G2 撤销 / 清空): no same-button 0.4s throttle, the 0.4s-after-new-state guard stays', () => {
  let stateChange = 1000;
  const accept = createPressGuard(PRESS_GUARD_MS, () => stateChange);
  assert.equal(accept(1200, { rapid: true }), false, 'still dropped within 0.4s of a new page / state');
  assert.equal(accept(1400, { rapid: true }), true);
  assert.equal(accept(1550, { rapid: true }), true, 'second press 150ms later is accepted');
  assert.equal(accept(1600, { rapid: true }), true);
  assert.equal(accept(1700), false, 'a non-rapid press right after is still throttled');
  stateChange = 2000;
  assert.equal(accept(2100, { rapid: true }), false, 'rapid presses inside 0.4s of a state change are dropped');
  assert.equal(accept(2400, { rapid: true }), true);
});

// ---------------------------------------------------------------------------
// K1 / 01 §7：tab 根页与阻断页 backGestureEnabled(false)，有子页 true；写字页（ownsBackGesture）为顶层时根组件不发。

registerScreen('t-owner', Noop, { ownsBackGesture: true });

function gateHarness() {
  const sent = [];
  const win = { webkit: { messageHandlers: { shiziNative: { postMessage: m => sent.push(m) } } } };
  const bridge = createBridge(win); // 真 bridge：值变化才发
  const env = setup();
  env.router.start({ defaultTab: 't-home' });
  const sync = createBackGestureSync({ send: v => bridge.setBackGestureEnabled(v) });
  let blocked = false;
  // 模拟 root 的 effect：每次路由状态变化后按 (depth, blocked) 同步。
  const rootEffect = () => sync.update(env.router.getState(), blocked);
  env.router.subscribe(rootEffect);
  rootEffect(); // 挂载
  return {
    ...env,
    bridge,
    values: () => sent.filter(m => m.type === 'backGestureEnabled').map(m => m.value),
    setBlocked(v) {
      blocked = v;
      rootEffect();
    },
  };
}

test('pageDepth / backGestureAllowed: overlays do not count; tab root and block page are false', () => {
  const s = k => ({ k, id: 'x', n: 't-home' });
  assert.equal(pageDepth({ stack: [s('s')] }), 0);
  assert.equal(pageDepth({ stack: [s('s'), s('o')] }), 0, 'overlay over the tab root is still depth 0');
  assert.equal(pageDepth({ stack: [s('s'), s('s'), s('o')] }), 1);
  assert.equal(pageDepth(null), 0);
  assert.equal(backGestureAllowed({ stack: [s('s')] }), false);
  assert.equal(backGestureAllowed({ stack: [s('s'), s('s')] }), true);
  assert.equal(backGestureAllowed({ stack: [s('s'), s('s')] }, true), false, 'blocked wins');
});

test('back gesture gate: root → sub → root sends [false, true, false]; tab switch / overlay at root send nothing', () => {
  const h = gateHarness();
  assert.deepEqual(h.values(), [false], 'tab root at mount → false');
  h.router.switchTab('t-lib');
  h.history.flush();
  h.router.openOverlay(Noop, {});
  h.history.flush();
  assert.deepEqual(h.values(), [false], 'tab switch and an overlay over the tab root do not re-send');
  h.router.back();
  h.history.flush();
  h.router.push('t-sub');
  h.history.flush();
  assert.deepEqual(h.values(), [false, true], 'sub page → true');
  h.router.push('t-sub2');
  h.history.flush();
  assert.deepEqual(h.values(), [false, true], 'deeper sub page: value unchanged, not re-sent');
  h.router.back();
  h.history.flush();
  h.router.back();
  h.history.flush();
  assert.equal(h.router.getState().depth, 0);
  assert.deepEqual(h.values(), [false, true, false], 'back to the tab root → false');
});

test('back gesture gate: block page forces false; unblocking re-syncs from the stack', () => {
  const h = gateHarness();
  h.router.push('t-sub');
  h.history.flush();
  assert.deepEqual(h.values(), [false, true]);
  h.setBlocked(true);
  assert.deepEqual(h.values(), [false, true, false], 'block page → false even with a sub page underneath');
  h.setBlocked(false);
  assert.deepEqual(h.values(), [false, true, false, true], 'unblocked with a sub page → true again');
});

test('back gesture gate: the owning screen (write) decides while on top; root does not override it', () => {
  const h = gateHarness();
  // 写字页的 useBackGestureGate：顶层 false，否则按栈（子组件 effect 先于根组件执行）。
  const ownerApply = () => {
    const st = h.router.getState();
    const isTop = st.top && st.top.n === 't-owner';
    h.bridge.setBackGestureEnabled(isTop ? false : backGestureAllowed(st));
  };
  h.router.subscribe(ownerApply);
  h.router.push('t-owner');
  h.history.flush();
  assert.deepEqual(h.values(), [false], 'write page on top: stays false (root skipped depth 0 → 1)');
  h.router.push('t-sub');
  h.history.flush();
  assert.deepEqual(h.values(), [false, true], 'sub page pushed over the write page → true');
  h.router.back();
  h.history.flush();
  assert.deepEqual(h.values(), [false, true, false], 'back to the write page → false again, root did not send true');
  h.router.back();
  h.history.flush();
  assert.deepEqual(h.values(), [false, true, false], 'write page → tab root: false, no transient true');
});
