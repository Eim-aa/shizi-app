// M6-5 跟手交互式返回：router.createBackGestureController 纯逻辑单测（状态、计时器、宽度注入），
// 以及与真实 createRouter + attachWindow 的接线（shizi-native-back 在手势已处理时被吞掉，不多退一层）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachWindow,
  BACK_COMMIT_RATIO,
  BACK_COMMIT_VELOCITY,
  BACK_RETURN_VELOCITY,
  BACK_PARALLAX,
  backGestureCommits,
  createBackGestureController,
  createRouter,
  gestureLayerX,
  GESTURE_ABSORB_MS,
  GESTURE_COMMIT_TIMEOUT_MS,
  GESTURE_SNAP_MS,
  NATIVE_BACK_EVENT,
  registerScreen,
} from '../../src/ui/router.js';

const W = 400;

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
    pending: () => [...timers.values()].map(t => t.ms),
    runAll() {
      for (const [k, t] of [...timers]) {
        timers.delete(k);
        t.fn();
      }
    },
  };
}

// 路由快照替身：只用到 stack / topIsOverlay / pending。
function snapOf({ pages = 2, overlay = false, pending = false } = {}) {
  const stack = [];
  for (let i = 0; i < pages; i += 1) stack.push({ k: 's', id: `e${i + 1}`, n: i === 0 ? 'home' : 'sub' });
  if (overlay) stack.push({ k: 'o', id: 'o1', n: 'sheet' });
  return { stack, depth: stack.length - 1, topIsOverlay: overlay, pending };
}

function setup(opts = {}) {
  const timers = fakeTimers();
  const views = [];
  let backs = 0;
  let clock = 1000;
  const env = {
    state: snapOf(opts),
    reduced: !!opts.reduced,
    blocked: !!opts.blocked,
    busy: !!opts.busy,
  };
  const ctrl = createBackGestureController({
    getState: () => env.state,
    back: () => {
      backs += 1;
    },
    width: () => W,
    reducedMotion: () => env.reduced,
    blocked: () => env.blocked,
    busy: () => env.busy,
    now: () => clock,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onView: v => views.push(v),
  });
  return {
    ctrl,
    timers,
    views,
    env,
    backs: () => backs,
    tick: ms => {
      clock += ms;
    },
    ev: (phase, translationX = 0, velocityX = 0) => ctrl.handle({ phase, translationX, progress: translationX / W, velocityX }),
  };
}

test('thresholds mirror the Swift recognizer (R4-G1 / P270): v > 500 || (x > 1/3 width && v > -200)', () => {
  assert.equal(BACK_COMMIT_RATIO, 1 / 3);
  assert.equal(BACK_COMMIT_VELOCITY, 500);
  assert.equal(BACK_RETURN_VELOCITY, -200);
  assert.equal(backGestureCommits({ translationX: W * BACK_COMMIT_RATIO, velocityX: 0 }, W), false, 'exactly a third does not commit (strict >)');
  assert.equal(backGestureCommits({ translationX: W * BACK_COMMIT_RATIO + 0.5, velocityX: 0 }, W), true, 'past a third of the width, at rest: commits');
  assert.equal(backGestureCommits({ translationX: W * 0.3, velocityX: 0 }, W), false, 'a slow drag to 30% springs back');
  assert.equal(backGestureCommits({ translationX: W * 0.4, velocityX: 0 }, W), true, 'a slow drag to 40% commits (was a spring-back at 50%)');
  assert.equal(backGestureCommits({ translationX: W * 0.3, velocityX: 400 }, W), false, 'a moderate flick short of a third does not commit');
  assert.equal(backGestureCommits({ translationX: 10, velocityX: 500 }, W), false, 'exactly 500 does not commit');
  assert.equal(backGestureCommits({ translationX: 10, velocityX: 501 }, W), true, 'a fast flick commits from a short distance');
  assert.equal(backGestureCommits({ translationX: W * 0.8, velocityX: -199 }, W), true, 'a slight drift back past the threshold still commits');
  assert.equal(backGestureCommits({ translationX: W * 0.8, velocityX: -200 }, W), false, 'exactly -200 does not commit (strict >)');
  assert.equal(backGestureCommits({ translationX: W * 0.8, velocityX: -400 }, W), false, 'a clear leftward pull-back cancels');
  assert.equal(backGestureCommits({ translationX: 10, velocityX: -2000 }, W), false, 'leftward velocity never commits');
  assert.equal(backGestureCommits({ translationX: 'x', velocityX: undefined }, W), false, 'garbage detail is a no');
  assert.equal(backGestureCommits({ translationX: 10 * W, velocityX: 0 }, W), true, 'translation is clamped to the width');
});

test('gestureLayerX: top follows the finger, under slides from -30% width to 0 (parallax)', () => {
  assert.equal(BACK_PARALLAX, 0.3);
  assert.deepEqual(gestureLayerX(0, W), { top: 0, under: -120 });
  assert.deepEqual(gestureLayerX(200, W), { top: 200, under: -60 });
  assert.deepEqual(gestureLayerX(W, W), { top: W, under: 0 });
  assert.deepEqual(gestureLayerX(-50, W), { top: 0, under: -120 }, 'negative clamps to 0');
  assert.deepEqual(gestureLayerX(W + 50, W), { top: W, under: 0 }, 'past the edge clamps to the width');
  assert.deepEqual(gestureLayerX(123.456, W), { top: 123.456, under: -82.96 }, 'under is rounded to 0.01px');
});

test('began / changed follow the finger; ended below the threshold snaps back, then clears', () => {
  const g = setup();
  g.ev('began', 10);
  assert.deepEqual(g.ctrl.getView(), { phase: 'follow', kind: 'page', progress: 0.025, x: 10, under: -117, width: W });
  g.ev('changed', 80, 120);
  assert.deepEqual(g.ctrl.getView(), { phase: 'follow', kind: 'page', progress: 0.2, x: 80, under: -96, width: W });
  g.ev('ended', 90, 300);
  assert.equal(g.backs(), 0, 'no back below threshold');
  assert.deepEqual(g.ctrl.getView(), { phase: 'snap', kind: 'page', progress: 0, x: 0, under: -120, width: W }, 'snap back to 0 / -30%');
  assert.deepEqual(g.timers.pending(), [GESTURE_SNAP_MS + 75], 'snap + motion.duration.xs of slack');
  g.timers.runAll();
  assert.equal(g.ctrl.getView(), null, 'view cleared after the snap transition');
  assert.equal(g.views[g.views.length - 1], null, 'onView(null) delivered');
});

test('ended past the distance threshold commits back once and holds the position for the transition', () => {
  const g = setup();
  g.ev('began', 0);
  g.ev('changed', 150);
  g.ev('ended', 250, 100);
  assert.equal(g.backs(), 1, 'back committed');
  assert.deepEqual(g.ctrl.getView(), { phase: 'commit', kind: 'page', progress: 0.625, x: 250, under: -45, width: W }, 'page stays where the finger left it');
  assert.deepEqual(g.timers.pending(), [GESTURE_COMMIT_TIMEOUT_MS], 'fallback timer armed');
  assert.equal(g.ctrl.absorbNativeBack(), true, 'the shizi-native-back that follows is absorbed');
  assert.equal(g.ctrl.absorbNativeBack(), false, 'only once per gesture');
  const handed = g.ctrl.handoff();
  assert.deepEqual(handed, { phase: 'commit', kind: 'page', progress: 0.625, x: 250, under: -45, width: W }, 'transition takes over from the same position');
  assert.equal(g.ctrl.getView(), null);
  assert.deepEqual(g.timers.pending(), [], 'fallback timer cleared by the handoff');
  assert.equal(g.ctrl.handoff(), null, 'nothing to hand off twice');
});

test('a fast flick commits from a short distance (velocity threshold)', () => {
  const g = setup();
  g.ev('began', 0);
  g.ev('changed', 30, 900);
  g.ev('ended', 30, 900);
  assert.equal(g.backs(), 1);
  assert.equal(g.ctrl.getView().phase, 'commit');
});

test('commit without a transition (history stuck) snaps back after the fallback timeout', () => {
  const g = setup();
  g.ev('began', 0);
  g.ev('ended', 300);
  assert.equal(g.backs(), 1);
  g.timers.runAll(); // commit timeout
  assert.equal(g.ctrl.getView().phase, 'snap');
  g.timers.runAll(); // snap end
  assert.equal(g.ctrl.getView(), null);
});

test('cancelled snaps back without going back', () => {
  const g = setup();
  g.ev('began', 5);
  g.ev('changed', 200);
  g.ev('cancelled', 0);
  assert.equal(g.backs(), 0);
  assert.equal(g.ctrl.getView().phase, 'snap');
  g.ev('ended', 300); // 迟到的 ended 不再属于这次手势
  assert.equal(g.backs(), 0, 'a stray ended after cancel does nothing');
});

test('overlay open (N3-6 / N4, P1-06): the top overlay follows the finger, the page never moves; ended past the threshold closes it once; the native back is absorbed', () => {
  const g = setup({ overlay: true });
  g.ev('began', 4);
  assert.equal(g.backs(), 0, 'began no longer closes the overlay on touch-down');
  assert.deepEqual(g.ctrl.getView(), { phase: 'follow', overlay: true, progress: 0.01, x: 4, under: 0, width: W }, 'the overlay follows, not the page');
  g.ev('changed', 250);
  assert.equal(g.ctrl.getView().x, 250);
  assert.equal(g.ctrl.getView().overlay, true);
  g.ev('ended', 250, 0);
  assert.equal(g.backs(), 1, 'past a third of the width: the overlay is closed (once)');
  assert.equal(g.ctrl.getView().phase, 'commit', 'stays where the finger let go; the exit fades from there');
  g.env.state = snapOf(); // 遮罩关掉之后
  assert.equal(g.ctrl.absorbNativeBack(), true, 'the native back of the same gesture is absorbed');
  g.timers.runAll();
  assert.equal(g.ctrl.getView(), null, 'view cleared');
  // 下一次手势（遮罩已关）正常跟随页面
  g.ev('began', 0);
  assert.equal(g.ctrl.getView().phase, 'follow');
  assert.equal(g.ctrl.getView().overlay, undefined);
});

test('overlay open: a short drag springs the overlay back and closes nothing (cancellable, P1-06)', () => {
  const g = setup({ overlay: true });
  g.ev('began', 0);
  g.ev('changed', 60);
  g.ev('ended', 60, 0);
  assert.equal(g.backs(), 0, 'below the threshold: nothing closes');
  assert.equal(g.ctrl.getView().phase, 'snap');
  assert.equal(g.ctrl.getView().overlay, true);
  g.timers.runAll();
  assert.equal(g.ctrl.getView(), null);
  // 快甩同样关
  const f = setup({ overlay: true });
  f.ev('began', 0);
  f.ev('ended', 20, 900);
  assert.equal(f.backs(), 1, 'a fast flick closes it');
  // 减少动态效果：不跟手，松手按同一阈值
  const r = setup({ overlay: true, reduced: true });
  r.ev('began', 0);
  r.ev('changed', 300);
  assert.equal(r.views.length, 0, 'reduced motion: no frame is drawn');
  r.ev('ended', 300, 0);
  assert.equal(r.backs(), 1, 'reduced motion: still closes on release past the threshold');
});

test('tab root, blocked, busy or pending navigation: ignored, and the native back passes through', () => {
  for (const opts of [{ pages: 1 }, { blocked: true }, { busy: true }, { pending: true }]) {
    const g = setup(opts);
    g.ev('began', 0);
    g.ev('changed', 200);
    g.ev('ended', 200, 900);
    assert.equal(g.backs(), 0, `${JSON.stringify(opts)}: no back`);
    assert.equal(g.views.length, 0, `${JSON.stringify(opts)}: no frame`);
    assert.equal(g.ctrl.absorbNativeBack(), false, `${JSON.stringify(opts)}: native back not absorbed`);
  }
  const blockedOverlay = setup({ overlay: true, blocked: true });
  blockedOverlay.ev('began', 0);
  assert.equal(blockedOverlay.backs(), 0, 'blocked: an overlay is not closed either');
});

test('reduced motion: no following, commit only by threshold', () => {
  const g = setup({ reduced: true });
  g.ev('began', 0);
  g.ev('changed', 200);
  assert.equal(g.views.length, 0, 'no frame while dragging');
  g.ev('ended', 250);
  assert.equal(g.backs(), 1, 'commit past the threshold');
  assert.equal(g.ctrl.getView(), null);
  assert.equal(g.ctrl.handoff(), null, 'nothing to hand off: no follow');
  assert.equal(g.ctrl.takeReducedCommit(), true, 'root.js is told the pop came from the gesture (150ms fade, P270)');
  assert.equal(g.ctrl.takeReducedCommit(), false, 'only once');
  assert.equal(g.ctrl.absorbNativeBack(), true);

  const h = setup({ reduced: true });
  h.ev('began', 0);
  h.ev('ended', 40, 100);
  assert.equal(h.backs(), 0, 'below threshold nothing happens');
  assert.equal(h.views.length, 0);
});

test('changed without began starts a gesture (began lost); ended/cancelled without one are ignored', () => {
  const g = setup();
  g.ev('ended', 300, 900);
  g.ev('cancelled', 0);
  assert.equal(g.backs(), 0);
  assert.equal(g.views.length, 0);
  assert.equal(g.ctrl.absorbNativeBack(), false, 'no gesture seen → native back goes through');
  g.ev('changed', 120);
  assert.deepEqual(g.ctrl.getView(), { phase: 'follow', kind: 'page', progress: 0.3, x: 120, under: -84, width: W });
});

test('absorb window: a native back long after ended is not absorbed', () => {
  const g = setup();
  g.ev('began', 0);
  g.ev('ended', 20);
  g.tick(GESTURE_ABSORB_MS + 1);
  assert.equal(g.ctrl.absorbNativeBack(), false);
});

test('reset clears the frame immediately (another navigation took over)', () => {
  const g = setup();
  g.ev('began', 0);
  g.ev('changed', 60);
  g.ctrl.reset();
  assert.equal(g.ctrl.getView(), null);
  assert.equal(g.views[g.views.length - 1], null);
  g.ev('changed', 90); // 同一次手势的余下事件开启新的跟随（began 丢失的兜底）
  assert.equal(g.ctrl.getView().x, 90);
});

test('width is taken once per gesture (rotation mid-gesture does not jump)', () => {
  let width = 400;
  const ctrl = createBackGestureController({
    getState: () => snapOf(),
    back: () => {},
    width: () => width,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  ctrl.handle({ phase: 'began', translationX: 0 });
  width = 800;
  ctrl.handle({ phase: 'changed', translationX: 100 });
  assert.equal(ctrl.getView().width, 400);
  assert.equal(ctrl.getView().under, -90);
});

// ---------------------------------------------------------------------------
// 与真实 router 的接线

function fakeHistory() {
  const entries = [{ state: null }];
  let index = 0;
  const queued = [];
  let listener = null;
  const calls = { back: 0 };
  return {
    calls,
    get state() {
      return entries[index].state;
    },
    pushState(state) {
      entries.splice(index + 1);
      entries.push({ state: structuredClone(state) });
      index += 1;
    },
    replaceState(state) {
      entries[index] = { state: structuredClone(state) };
    },
    back() {
      calls.back += 1;
      this.go(-1);
    },
    go(n) {
      const target = index + n;
      if (target >= 0 && target < entries.length) queued.push(target);
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

const Noop = () => null;
registerScreen('g-home', Noop, { tab: true, order: 90, label: 'G' });
registerScreen('g-sub', Noop);

function wired() {
  const history = fakeHistory();
  const timers = fakeTimers();
  const router = createRouter({ history, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  history.onPop(s => router.handlePopState(s));
  router.start({ defaultTab: 'g-home' });
  const ctrl = createBackGestureController({
    getState: () => router.getState(),
    back: () => router.back({ cause: 'native' }),
    width: () => W,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  router.setNativeBackFilter(() => ctrl.absorbNativeBack());
  const handlers = new Map();
  attachWindow(router, { addEventListener: (t, fn) => handlers.set(t, fn), removeEventListener: t => handlers.delete(t) });
  // Swift 在同一段脚本里依次派发 progress(ended) 与 shizi-native-back
  const swift = (phase, x, v = 0) => {
    ctrl.handle({ phase, translationX: x, velocityX: v });
    if (phase === 'ended' && (v > 500 || (x > W / 3 && v > -200))) handlers.get(NATIVE_BACK_EVENT)();
  };
  return { history, router, ctrl, swift, nativeBack: () => handlers.get(NATIVE_BACK_EVENT)() };
}

test('wired: a committed gesture pops exactly one page even though Swift also fires shizi-native-back', () => {
  const w = wired();
  w.router.push('g-sub');
  w.router.push('g-sub');
  w.history.flush();
  assert.equal(w.router.getState().depth, 2);
  w.swift('began', 0);
  w.swift('changed', 200);
  w.swift('ended', 250, 300);
  w.history.flush();
  const s = w.router.getState();
  assert.equal(w.history.calls.back, 1, 'one history.back');
  assert.equal(s.depth, 1, 'one page popped');
  assert.equal(s.transition.kind, 'pop');
  assert.equal(s.transition.cause, 'native');
  assert.deepEqual(s.stack.map(e => e.n), ['g-home', 'g-sub']);
});

test('wired: overlay open → the drag closes it on release; ended + native back leave the page in place', () => {
  const w = wired();
  w.router.push('g-sub');
  w.router.openOverlay(Noop, {}, { name: 'sheet' });
  assert.equal(w.router.getState().topIsOverlay, true);
  w.swift('began', 0);
  w.history.flush();
  assert.equal(w.router.getState().topIsOverlay, true, 'still open while the finger is down (P1-06)');
  w.swift('changed', 300);
  w.swift('ended', 300, 900);
  w.history.flush();
  assert.equal(w.router.getState().topIsOverlay, false, 'overlay closed on release');
  assert.equal(w.router.getState().depth, 1, 'page still there');
  assert.equal(w.history.calls.back, 1, 'only the overlay close used history.back');
  assert.deepEqual(w.router.getState().stack.map(e => e.n), ['g-home', 'g-sub']);
});

test('wired: shizi-native-back with no gesture seen (old shell / smoke) still pops one page', () => {
  const w = wired();
  w.router.push('g-sub');
  w.nativeBack();
  w.history.flush();
  assert.equal(w.router.getState().depth, 0);
  w.router.setNativeBackFilter(null);
  w.router.push('g-sub');
  w.nativeBack();
  w.history.flush();
  assert.equal(w.router.getState().depth, 0, 'no filter registered: plain back');
});

test('wired: a snapped-back gesture swallows the stray native back (JS decision is final)', () => {
  const w = wired();
  w.router.push('g-sub');
  w.ctrl.handle({ phase: 'began', translationX: 0 });
  w.ctrl.handle({ phase: 'ended', translationX: 40, velocityX: 100 });
  w.nativeBack(); // 阈值不一致时的迟到事件
  w.history.flush();
  assert.equal(w.router.getState().depth, 1);
  assert.equal(w.ctrl.getView().phase, 'snap');
});

// ---------------------------------------------------------------------------
// R4-G1：与动画样式解耦的进度接口（beginBack / setBackProgress / endBack / finishBack / cancelBack）、
// 顶层页面不能返回（页头左上不是返回键）、遮罩与页面返回动作分开、router 代理。

test('R4-G1 progress API: setBackProgress follows, endBack decides by the same thresholds, reversing mid-way cancels', () => {
  const g = setup();
  assert.equal(g.ctrl.beginBack(), 'page');
  assert.equal(g.ctrl.setBackProgress(0.5, 100), true);
  assert.deepEqual(g.ctrl.getView(), { phase: 'follow', kind: 'page', progress: 0.5, x: 200, under: -60, width: W }, 'progress drives the frame');
  assert.equal(g.ctrl.setBackProgress(0.1, -300), true, 'finger moves back left');
  assert.equal(g.ctrl.getView().x, 40, 'the page follows backwards');
  assert.equal(g.ctrl.endBack(), false, 'released at 10% after pulling back: springs back');
  assert.equal(g.backs(), 0);
  assert.equal(g.ctrl.getView().phase, 'snap');

  const h = setup();
  h.ctrl.beginBack();
  h.ctrl.setBackProgress(0.34, 0);
  assert.equal(h.ctrl.endBack(), true, 'just past a third at rest: completes');
  assert.equal(h.backs(), 1);
  assert.equal(h.ctrl.getView().phase, 'commit');

  const f = setup();
  f.ctrl.beginBack();
  f.ctrl.setBackProgress(0.05);
  assert.equal(f.ctrl.endBack(900), true, 'a fast flick completes from 5%');

  const k = setup();
  k.ctrl.beginBack();
  k.ctrl.setBackProgress(0.1);
  assert.equal(k.ctrl.finishBack(), true, 'finishBack completes regardless of the threshold');
  assert.equal(k.backs(), 1);

  const c = setup();
  c.ctrl.beginBack();
  c.ctrl.setBackProgress(0.9);
  assert.equal(c.ctrl.cancelBack(), true);
  assert.equal(c.backs(), 0, 'cancelBack never goes back');
  assert.equal(c.ctrl.getView().phase, 'snap', 'springs back');
  c.timers.runAll();
  assert.equal(c.ctrl.getView(), null);
  assert.equal(c.ctrl.finishBack(), false, 'nothing to finish after the gesture ended');
});

test('R4-G1: the top page cannot go back (custom lead, e.g. 「接着写」) → ignored like the tab root', () => {
  let ok = false;
  let backs = 0;
  const ctrl = createBackGestureController({
    getState: () => snapOf(),
    back: () => { backs += 1; },
    allowed: () => ok,
    width: () => W,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  assert.equal(ctrl.beginBack(), 'ignored');
  ctrl.handle({ phase: 'changed', translationX: 300 });
  ctrl.handle({ phase: 'ended', translationX: 300, velocityX: 900 });
  assert.equal(backs, 0);
  assert.equal(ctrl.getView(), null);
  ok = true;
  assert.equal(ctrl.beginBack(), 'page', 'allowed again → follows');
});

test('R4-G1 / P1-06: overlay open → the release closes it via closeOverlay, never runs the page back action', () => {
  let closes = 0;
  let pageBacks = 0;
  const ctrl = createBackGestureController({
    getState: () => snapOf({ overlay: true }),
    back: () => { pageBacks += 1; },
    closeOverlay: () => { closes += 1; },
    width: () => W,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  assert.equal(ctrl.beginBack(), 'overlay');
  assert.equal(closes, 0, 'not on touch-down');
  ctrl.setBackProgress(0.9);
  assert.equal(ctrl.endBack(900), true, 'the overlay close is the completion');
  assert.equal(closes, 1, 'overlay closed once');
  assert.equal(pageBacks, 0, 'page back action not run');
});

test('R4-G1: router.beginBack / setBackProgress / endBack / finishBack / cancelBack delegate to the attached controller', () => {
  const w = wired();
  assert.equal(w.router.beginBack(), 'ignored', 'before attach: no controller → ignored');
  w.router.attachBackGesture(w.ctrl);
  assert.equal(w.router.beginBack(), 'ignored', 'tab root: ignored');
  w.router.push('g-sub');
  w.history.flush();
  assert.equal(w.router.beginBack(), 'page');
  assert.equal(w.router.setBackProgress(0.6, 0), true);
  assert.equal(w.ctrl.getView().x, 240);
  assert.equal(w.router.endBack(0), true, 'past a third → completes');
  w.history.flush();
  assert.equal(w.router.getState().depth, 0, 'one page popped');
  assert.equal(w.history.calls.back, 1);
  w.router.push('g-sub');
  w.history.flush();
  w.router.beginBack();
  w.router.setBackProgress(0.8);
  assert.equal(w.router.cancelBack(), true);
  w.history.flush();
  assert.equal(w.router.getState().depth, 1, 'cancel keeps the page');
  w.router.attachBackGesture(null);
  assert.equal(w.router.finishBack(), false, 'detached: no-op');
});
