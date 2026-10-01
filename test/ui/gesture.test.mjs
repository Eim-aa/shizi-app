// M6-5 跟手交互式返回：router.createBackGestureController 纯逻辑单测（状态、计时器、宽度注入），
// 以及与真实 createRouter + attachWindow 的接线（shizi-native-back 在手势已处理时被吞掉，不多退一层）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachWindow,
  BACK_COMMIT_RATIO,
  BACK_COMMIT_VELOCITY,
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

test('thresholds mirror the Swift recognizer: > 24% width or > 650 pt/s', () => {
  assert.equal(BACK_COMMIT_RATIO, 0.24);
  assert.equal(BACK_COMMIT_VELOCITY, 650);
  assert.equal(backGestureCommits({ translationX: W * 0.24, velocityX: 0 }, W), false, 'exactly 24% does not commit (strict >)');
  assert.equal(backGestureCommits({ translationX: W * 0.24 + 0.5, velocityX: 0 }, W), true);
  assert.equal(backGestureCommits({ translationX: 10, velocityX: 650 }, W), false, 'exactly 650 does not commit');
  assert.equal(backGestureCommits({ translationX: 10, velocityX: 651 }, W), true, 'a fast flick commits from a short distance');
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
  assert.deepEqual(g.ctrl.getView(), { phase: 'follow', x: 10, under: -117, width: W });
  g.ev('changed', 80, 120);
  assert.deepEqual(g.ctrl.getView(), { phase: 'follow', x: 80, under: -96, width: W });
  g.ev('ended', 90, 300);
  assert.equal(g.backs(), 0, 'no back below threshold');
  assert.deepEqual(g.ctrl.getView(), { phase: 'snap', x: 0, under: -120, width: W }, 'snap back to 0 / -30%');
  assert.deepEqual(g.timers.pending(), [GESTURE_SNAP_MS + 20]);
  g.timers.runAll();
  assert.equal(g.ctrl.getView(), null, 'view cleared after the snap transition');
  assert.equal(g.views[g.views.length - 1], null, 'onView(null) delivered');
});

test('ended past the distance threshold commits back once and holds the position for the transition', () => {
  const g = setup();
  g.ev('began', 0);
  g.ev('changed', 150);
  g.ev('ended', 150, 100);
  assert.equal(g.backs(), 1, 'back committed');
  assert.deepEqual(g.ctrl.getView(), { phase: 'commit', x: 150, under: -75, width: W }, 'page stays where the finger left it');
  assert.deepEqual(g.timers.pending(), [GESTURE_COMMIT_TIMEOUT_MS], 'fallback timer armed');
  assert.equal(g.ctrl.absorbNativeBack(), true, 'the shizi-native-back that follows is absorbed');
  assert.equal(g.ctrl.absorbNativeBack(), false, 'only once per gesture');
  const handed = g.ctrl.handoff();
  assert.deepEqual(handed, { phase: 'commit', x: 150, under: -75, width: W }, 'transition takes over from the same position');
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

test('overlay open: began closes the top overlay only; the page never moves; the native back is absorbed', () => {
  const g = setup({ overlay: true });
  g.ev('began', 4);
  assert.equal(g.backs(), 1, 'began closes the overlay right away');
  assert.equal(g.ctrl.getView(), null, 'page not moved');
  g.env.state = snapOf(); // 遮罩关掉之后
  g.ev('changed', 250);
  assert.equal(g.ctrl.getView(), null, 'rest of the gesture is not followed');
  g.ev('ended', 250, 800);
  assert.equal(g.backs(), 1, 'ended does not pop the page as well');
  assert.equal(g.views.length, 0, 'no frame was ever drawn');
  assert.equal(g.ctrl.absorbNativeBack(), true, 'the native back of the same gesture is absorbed');
  // 下一次手势（遮罩已关）正常跟随页面
  g.ev('began', 0);
  assert.equal(g.ctrl.getView().phase, 'follow');
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
  g.ev('ended', 200);
  assert.equal(g.backs(), 1, 'commit past the threshold');
  assert.equal(g.ctrl.getView(), null);
  assert.equal(g.ctrl.handoff(), null, 'nothing to hand off: the pop uses the plain fade');
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
  assert.deepEqual(g.ctrl.getView(), { phase: 'follow', x: 120, under: -84, width: W });
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
    if (phase === 'ended' && (x > W * 0.24 || v > 650)) handlers.get(NATIVE_BACK_EVENT)();
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
  w.swift('ended', 200, 300);
  w.history.flush();
  const s = w.router.getState();
  assert.equal(w.history.calls.back, 1, 'one history.back');
  assert.equal(s.depth, 1, 'one page popped');
  assert.equal(s.transition.kind, 'pop');
  assert.equal(s.transition.cause, 'native');
  assert.deepEqual(s.stack.map(e => e.n), ['g-home', 'g-sub']);
});

test('wired: overlay open → began closes it; ended + native back leave the page in place', () => {
  const w = wired();
  w.router.push('g-sub');
  w.router.openOverlay(Noop, {}, { name: 'sheet' });
  assert.equal(w.router.getState().topIsOverlay, true);
  w.swift('began', 0);
  w.history.flush();
  assert.equal(w.router.getState().topIsOverlay, false, 'overlay closed on began');
  assert.equal(w.router.getState().depth, 1);
  w.swift('changed', 300);
  w.swift('ended', 300, 900);
  w.history.flush();
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
