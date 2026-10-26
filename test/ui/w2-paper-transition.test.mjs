// W2（D57，P282–P284）：写字页进出动效的纯逻辑——曲线、时长、来源记录与计划、逐帧运行器、与 router 进度接口的接线、03 / copy-source 登记。
// 真实的逐帧矩形、与左缘右滑的联动在 scripts/e2e/101-w2-b1.spec.js（rAF 采样）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as policy from '../../src/config/policy.js';
import {
  cubicBezier, OPEN_EASE, CLOSE_EASE, specFor, cancelSpec, runProgress, markPaperSource, planPaper, planPaperDrag, resetPaperSources, hasPaperSource, MAX_FRAME_MS,
  noteTap, paperSourceOf, alphaOf, markNativeOverlayTap, overlayTapped, SOURCE_SELECTOR, nativePlanShape, noteNativePlan, nativePlanOf, nativeBackPlan, setNavBusy, whenNavIdle, navIsIdle,
} from '../../src/ui/paper-transition.js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('policy.paperTransition (P282–P284): 420 / 360 ms, 300 ms × s to finish (≥ 120), 220 ms cancel, B3 220 / 180 from 0.96, reduced motion 150', () => {
  const p = policy.paperTransition;
  assert.deepEqual([p.openMs, p.closeMs, p.fullMs, p.minFinishMs, p.cancelMs], [420, 360, 300, 120, 220]);
  assert.deepEqual([...p.openEase], [0.3, 0, 0.1, 1]);
  assert.deepEqual([...p.closeEase], [0.2, 0.7, 0.2, 1]);
  assert.deepEqual([p.quietOpenMs, p.quietCloseMs, p.quietScaleFrom, p.quietDragPt, p.reducedMs], [220, 180, 0.96, 40, 150]);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.openEase));
});

test('cubicBezier: endpoints, monotone, same curve as CSS (spot values)', () => {
  const e = cubicBezier(0.25, 0.1, 0.25, 1); // CSS ease
  assert.equal(e(0), 0);
  assert.equal(e(1), 1);
  assert.ok(Math.abs(e(0.5) - 0.8024) < 0.002, `ease(0.5) ≈ 0.802 (${e(0.5)})`);
  for (const f of [OPEN_EASE, CLOSE_EASE]) {
    let prev = 0;
    for (let i = 1; i <= 50; i += 1) {
      const v = f(i / 50);
      assert.ok(v >= prev - 1e-9, 'monotone');
      prev = v;
    }
  }
  assert.ok(OPEN_EASE(0.1) < CLOSE_EASE(0.1), 'the open curve starts slower than the close curve (cubic-bezier(.3,0,.1,1))');
});

test('specFor: open 420 (0 → 1), close 360 (1 → 0), finish from s = 300 × s ≥ 120, B3 220 / 180 linear, reduced 150 linear', () => {
  assert.deepEqual([specFor({ mode: 'B1', dir: 'open' }).ms, specFor({ mode: 'B1', dir: 'open' }).from, specFor({ mode: 'B1', dir: 'open' }).to], [420, 0, 1]);
  assert.deepEqual([specFor({ mode: 'B1', dir: 'close' }).ms, specFor({ mode: 'B1', dir: 'close' }).from, specFor({ mode: 'B1', dir: 'close' }).to], [360, 1, 0]);
  assert.equal(specFor({ mode: 'B1', dir: 'close' }, { fromS: 0.5 }).ms, 150, '300 × 0.5');
  assert.equal(specFor({ mode: 'B1', dir: 'close' }, { fromS: 0.1 }).ms, 120, 'never shorter than 120');
  assert.equal(specFor({ mode: 'B1', dir: 'close' }, { fromS: 0.5 }).from, 0.5, 'continues from where the finger let go');
  assert.equal(specFor({ mode: 'B3', dir: 'open' }).ms, 220);
  assert.equal(specFor({ mode: 'B3', dir: 'close' }).ms, 180);
  for (const dir of ['open', 'close']) assert.equal(specFor({ mode: 'R', dir }).ms, 150, `reduced motion ${dir}`);
  const c = cancelSpec({ mode: 'B1' }, 0.4);
  assert.deepEqual([c.ms, c.from, c.to], [220, 0.4, 1], 'cancel: 220 ms back to the full page');
});

test('runProgress: s(u) = from + (to − from) × ease(u); first frame starts the clock; a long frame advances at most 50 ms (no jump); onDone after the last frame', () => {
  const frames = [];
  let cb = null;
  const raf = fn => { cb = fn; return 1; };
  let done = 0;
  runProgress({ from: 0, to: 1, ms: 400, ease: u => u, apply: s => frames.push(s), onDone: () => { done += 1; }, raf, now: () => 0 });
  assert.deepEqual(frames, [0], 'applies the start immediately');
  const tick = t => { const f = cb; cb = null; f(t); };
  tick(1000); // first frame: the clock starts here
  assert.equal(frames[frames.length - 1], 0);
  tick(1016);
  assert.ok(Math.abs(frames[frames.length - 1] - 16 / 400) < 1e-9);
  tick(1216); // a 200 ms main-thread stall
  assert.ok(Math.abs(frames[frames.length - 1] - (16 + MAX_FRAME_MS) / 400) < 1e-9, 'a stall advances the animation by at most 50 ms');
  for (let i = 0; i < 20 && cb; i += 1) tick(1216 + (i + 1) * 20);
  assert.equal(frames[frames.length - 1], 1, 'ends exactly on `to`');
  assert.equal(done, 1);
  assert.equal(cb, null, 'stops requesting frames');
});

test('runProgress.cancel stops the loop without calling onDone', () => {
  let cb = null;
  let done = 0;
  const h = runProgress({ from: 0, to: 1, ms: 100, ease: u => u, apply() {}, onDone: () => { done += 1; }, raf: fn => { cb = fn; return 7; }, now: () => 0 });
  h.cancel();
  if (cb) cb(5000);
  assert.equal(done, 0);
});

const el = (rect, text = '开始写字') => ({ getBoundingClientRect: () => ({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }), textContent: text });

test('planPaper: B1 from a marked source, B3 without one, 150 ms fade under reduced motion; other pages stay on the slide', () => {
  resetPaperSources();
  const home = { id: 'home1', n: 'home' };
  const write = { id: 'w1', n: 'write' };
  // push with a source
  markPaperSource(el({ x: 75, y: 683, w: 240, h: 54 }), 'home-start');
  const open = planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null });
  assert.equal(open.mode, 'B1');
  assert.equal(open.dir, 'open');
  assert.deepEqual(open.source.rect, { x: 75, y: 683, w: 240, h: 54 });
  assert.equal(open.source.label, '开始写字');
  assert.ok(hasPaperSource('home1'), 'remembered under the page below');
  // pop from write → B1 back to the remembered rect, then forgotten
  const close = planPaper({ kind: 'pop', from: write, to: home }, { reduced: false, root: null });
  assert.deepEqual([close.mode, close.dir, close.source.rect.w], ['B1', 'close', 240]);
  assert.ok(!hasPaperSource('home1'), 'used once');
  // push without a source → B3; the pop after it is B3 too
  const quiet = planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null });
  assert.deepEqual([quiet.mode, quiet.dir], ['B3', 'open']);
  assert.equal(planPaper({ kind: 'pop', from: write, to: home }, { reduced: false, root: null }).mode, 'B3');
  // reduced motion: always the 150 ms fade, even with a source
  markPaperSource(el({ x: 75, y: 683, w: 240, h: 54 }), 'home-start');
  assert.equal(planPaper({ kind: 'push', from: home, to: write }, { reduced: true, root: null }).mode, 'R');
  assert.equal(planPaper({ kind: 'pop', from: write, to: home }, { reduced: true, root: null }).mode, 'R');
  // other pages: not ours
  assert.equal(planPaper({ kind: 'push', from: home, to: { id: 's1', n: 'settings' } }, { reduced: false, root: null }), null);
  assert.equal(planPaper({ kind: 'pop', from: { id: 's1', n: 'settings' }, to: home }, { reduced: false, root: null }), null);
  assert.equal(planPaper({ kind: 'tab', from: home, to: home }, { reduced: false, root: null }), null);
  // a result page that did not come from the write page keeps the slide; one that did shrinks onto the button (the source survives the replace)
  resetPaperSources();
  assert.equal(planPaper({ kind: 'pop', from: { id: 'r1', n: 'result' }, to: home }, { reduced: false, root: null }), null);
  markPaperSource(el({ x: 75, y: 683, w: 240, h: 54 }), 'home-start');
  planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null });
  assert.equal(planPaper({ kind: 'pop', from: { id: 'r1', n: 'result' }, to: home }, { reduced: false, root: null }).mode, 'B1');
  resetPaperSources();
});

test('planPaper: a stale source (older than sourceFreshMs) is ignored; pushing another page forgets the source', async () => {
  resetPaperSources();
  const home = { id: 'home2', n: 'home' };
  markPaperSource(el({ x: 1, y: 1, w: 10, h: 10 }), 'home-start');
  const realNow = performance.now.bind(performance);
  const t0 = realNow();
  performance.now = () => t0 + policy.paperTransition.sourceFreshMs + 50;
  try {
    assert.equal(planPaper({ kind: 'push', from: home, to: { id: 'w', n: 'write' } }, { reduced: false, root: null }).mode, 'B3', 'too old: no source');
  } finally {
    performance.now = realNow;
  }
  markPaperSource(el({ x: 1, y: 1, w: 10, h: 10 }), 'home-start');
  planPaper({ kind: 'push', from: home, to: { id: 'w', n: 'write' } }, { reduced: false, root: null });
  assert.ok(hasPaperSource('home2'));
  planPaper({ kind: 'push', from: home, to: { id: 's', n: 'settings' } }, { reduced: false, root: null });
  assert.ok(!hasPaperSource('home2'), 'another push from the same page forgets it');
  resetPaperSources();
});

test('planPaperDrag: the write page is a B1 paper when its source is known, B3 otherwise; other pages slide', () => {
  resetPaperSources();
  const home = { id: 'home3', n: 'home' };
  assert.equal(planPaperDrag({ id: 'w', n: 'write' }, home, null).mode, 'B3');
  assert.equal(planPaperDrag({ id: 's', n: 'settings' }, home, null), null);
  markPaperSource(el({ x: 75, y: 683, w: 240, h: 54 }), 'home-start');
  planPaper({ kind: 'push', from: home, to: { id: 'w', n: 'write' } }, { reduced: false, root: null });
  const d = planPaperDrag({ id: 'w', n: 'write' }, home, null);
  assert.deepEqual([d.mode, d.dir, d.drag], ['B1', 'close', true]);
  assert.ok(hasPaperSource('home3'), 'planning the drag does not consume the source (a cancelled drag keeps it)');
  resetPaperSources();
});

test('root.js wiring: BACK_TRANSITION hands the progress to the paper (begin / frame / clear take the gesture context); the router progress API is untouched', () => {
  const root = read('src/ui/root.js');
  assert.match(root, /import \{\s*cancelSpec, clearPaper, createPaper, forgetTap, noteNativePlan, noteTap, onNativeHostChange, PAPER_CSS, planPaper, planPaperDrag, runProgress, setNavBusy, specFor,\s*traceNav,\s*\} from '\.\/paper-transition\.js';/);
  assert.match(root, /begin\(top, under, ctx\)/);
  assert.match(root, /frame\(top, under, view, ctx\)/);
  assert.match(root, /clear\(el, ctx\)/);
  assert.match(root, /plan: planPaperDrag\(topE, underE, appRef\.current\)/);
  assert.match(root, /BACK_TRANSITION\.frame\(g\.els\.top, g\.els\.under, view, g\.els\)/);
  assert.match(root, /const s = 1 - \(Number\.isFinite\(view\.progress\) \? view\.progress : 0\)/, 's = 1 − p');
  const router = read('src/ui/router.js');
  for (const name of ['beginBack', 'setBackProgress', 'endBack', 'finishBack', 'cancelBack']) assert.ok(router.includes(`${name}(`), `router.${name} still there`);
  // R6-J1：来源是通用机制——根组件在捕获阶段记下每次点按的可点元素，页面不再各自登记（首页主按钮也不例外）
  assert.match(root, /doc\.addEventListener\('click', onClick, true\)/);
  assert.match(root, /const onClick = event => noteTap\(event && event\.target\)/);
  for (const f of ['src/ui/screens/home/index.js', 'src/ui/screens/library/all.js', 'src/ui/screens/detail/index.js', 'src/ui/screens/result/index.js']) {
    assert.doesNotMatch(read(f), /markPaperSource|data-paper-source/, `${f}: no per-page source wiring`);
  }
});

// R6-J1（交互与动效规范 T0 B1 / §8b IC-22）：写字页的任何入口都从被点元素展开，返回沿原路缩回它
const node = (rect, { text = '', bg = 'rgb(35, 31, 27)', testid = null, parent = null, disabled = false, tag = 'BUTTON' } = {}) => {
  const n = {
    tagName: tag, disabled, textContent: text, isConnected: true, parentElement: parent,
    getBoundingClientRect: () => ({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }),
    getAttribute: k => (k === 'data-testid' ? testid : null),
    matches: () => tag === 'BUTTON',
    closest(sel) {
      if (sel === '.sz-exit') return null;
      if (typeof sel === 'string' && sel.includes('role="dialog"')) { for (let e = this; e; e = e.parentElement) if (e.dialog) return e; return null; }
      for (let e = this; e; e = e.parentElement) if (e.tagName === 'BUTTON') return e;
      return null;
    },
    _bg: bg,
    dialog: false,
  };
  return n;
};

test('noteTap: the tapped control (closest button) becomes the source — solid when its background is opaque, plain otherwise; disabled controls and non-controls are ignored', () => {
  resetPaperSources();
  const realGCS = globalThis.getComputedStyle;
  globalThis.getComputedStyle = e => ({ backgroundColor: e._bg, color: 'rgb(1, 2, 3)', borderTopLeftRadius: '12px' });
  try {
    const home = { id: 'h9', n: 'home' };
    const write = { id: 'w9', n: 'write' };
    const btn = node({ x: 20, y: 600, w: 160, h: 44 }, { text: '接着写 ›', bg: 'rgba(0, 0, 0, 0)', testid: 'other-line' });
    const span = { ...node({ x: 30, y: 610, w: 40, h: 20 }, { tag: 'SPAN' }), parentElement: btn };
    span.closest = btn.closest.bind(span);
    noteTap(span);
    const open = planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null });
    assert.equal(open.mode, 'B1', 'a text button is a B1 source too (no more B3 for 「接着写」)');
    assert.deepEqual(open.source.rect, { x: 20, y: 600, w: 160, h: 44 });
    assert.equal(open.source.solid, false);
    assert.equal(open.source.label, '', 'a plain source draws no button-shaped label');
    assert.deepEqual(paperSourceOf('h9'), { rect: { x: 20, y: 600, w: 160, h: 44 }, solid: false, key: 'other-line' });
    planPaper({ kind: 'pop', from: write, to: home }, { reduced: false, root: null });
    noteTap(node({ x: 75, y: 683, w: 240, h: 54 }, { text: '开始写字', testid: 'home-start' }));
    const p2 = planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null });
    assert.deepEqual([p2.mode, p2.source.solid, p2.source.label, p2.source.bg], ['B1', true, '开始写字', 'rgb(35, 31, 27)']);
    planPaper({ kind: 'pop', from: write, to: home }, { reduced: false, root: null });
    noteTap(node({ x: 1, y: 1, w: 10, h: 10 }, { disabled: true }));
    assert.equal(planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null }).mode, 'B3', 'a disabled control is not a source');
    planPaper({ kind: 'pop', from: write, to: home }, { reduced: false, root: null });
    noteTap({ closest: () => null });
    assert.equal(planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null }).mode, 'B3', 'tapping a non-control leaves no source');
    // 点了别的页面 / 返回 / 切 Tab：这次点按作废
    planPaper({ kind: 'pop', from: write, to: home }, { reduced: false, root: null });
    noteTap(node({ x: 1, y: 1, w: 10, h: 10 }));
    planPaper({ kind: 'tab', from: home, to: { id: 'l', n: 'library' } }, { reduced: false, root: null });
    assert.equal(planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null }).mode, 'B3', 'a tab switch forgets the tap');
  } finally {
    globalThis.getComputedStyle = realGCS;
    resetPaperSources();
  }
  assert.equal(SOURCE_SELECTOR, '[data-paper-source], button, [role="button"], a[href]');
  assert.deepEqual([alphaOf('rgba(0, 0, 0, 0)'), alphaOf('transparent'), alphaOf('rgb(1, 2, 3)'), alphaOf('rgba(1, 2, 3, 0.5)'), alphaOf('rgb(1 2 3 / 40%)')], [0, 0, 1, 0.5, 0.4]);
});

test('planPaper replace (result 「再写一组」 / undo-skip → write), D62: a tapped replace is a plain push-in (mode S) and returns by a plain slide; a programmatic replace keeps the T-phase fade', () => {
  resetPaperSources();
  const result = { id: 'r5', n: 'result' };
  const write = { id: 'w5', n: 'write' };
  markPaperSource(el({ x: 20, y: 780, w: 353, h: 54 }, '再写一组'), 'result-again');
  const open = planPaper({ kind: 'replace', from: result, to: write }, { reduced: false, root: null, underId: 'home5' });
  assert.deepEqual([open.mode, open.dir], ['S', 'open'], 'not a home entry: pushed in from the right, no paper');
  assert.deepEqual(paperSourceOf('home5'), { pushed: true }, 'remembered as pushed, so the way back is a plain slide');
  assert.equal(planPaper({ kind: 'pop', from: write, to: { id: 'home5', n: 'home' } }, { reduced: false, root: null }), null, 'returning slides out (no B1 / B3)');
  assert.equal(planPaper({ kind: 'replace', from: result, to: write }, { reduced: false, root: null, underId: 'home5' }), null, 'no tap: T-phase');
  markPaperSource(el({ x: 1, y: 1, w: 10, h: 10 }), 'x');
  assert.equal(planPaper({ kind: 'replace', from: result, to: write }, { reduced: true, root: null, underId: 'home5' }), null, 'reduced motion: the generic 150 ms fade');
  assert.equal(planPaper({ kind: 'replace', from: write, to: write }, { reduced: false, root: null }), null, 'write → write is a content change, not an entry');
  resetPaperSources();
});


test('planPaper D62: only an entry on the home page itself is B1; library / detail / list / sheet-over-home entries are plain pushes and return by a plain slide; B3 (no tap) is unchanged', () => {
  resetPaperSources();
  const write = { id: 'w6', n: 'write' };
  const tapped = (rect, overlay = false) => {
    const n = el(rect, '练这些字');
    if (overlay) n.closest = sel => (typeof sel === 'string' && sel.includes('role="dialog"') ? n : null);
    markPaperSource(n, 'x');
  };
  for (const from of [{ id: 'lib', n: 'library' }, { id: 'det', n: 'detail' }, { id: 'lst', n: 'library-list' }, { id: 'all', n: 'library-all' }]) {
    tapped({ x: 20, y: 700, w: 353, h: 54 });
    assert.equal(planPaper({ kind: 'push', from, to: write }, { reduced: false, root: null }), null, `${from.n}: plain push`);
    assert.deepEqual(paperSourceOf(from.id), { pushed: true });
    assert.equal(planPaperDrag(write, from, null), null, `${from.n}: edge swipe slides`);
    assert.equal(planPaper({ kind: 'pop', from: write, to: from }, { reduced: false, root: null }), null, `${from.n}: pop slides`);
  }
  const home = { id: 'h6', n: 'home' };
  tapped({ x: 20, y: 700, w: 353, h: 54 }, true);
  assert.equal(planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null }), null, 'a sheet over home (查字「练这个字」) is not a home entry');
  tapped({ x: 20, y: 700, w: 353, h: 54 });
  assert.equal(planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null }).mode, 'B1', 'a home button is B1');
  planPaper({ kind: 'pop', from: write, to: home }, { reduced: false, root: null });
  assert.equal(planPaper({ kind: 'push', from: { id: 'lib', n: 'library' }, to: write }, { reduced: false, root: null }).mode, 'B3', 'no tap (notification / deep link) stays B3');
  resetPaperSources();
});

test('03 / copy-source: P282–P284 are registered (D57), P280 / P281 too; P260 / P261 / P278 point at D57', () => {
  const md = read('docs/engineering/v10/03-待产品决定.md');
  const row = id => md.split('\n').find(l => l.startsWith(`| ${id} |`));
  for (const id of ['P280', 'P281', 'P282', 'P283', 'P284']) {
    assert.ok(row(id), `${id} is in 03`);
    assert.match(row(id).split(' | ')[4], id === 'P283' ? /^已决定 D58（R6-J1/ : /^已决定 D57/, `${id} default column`);
  }
  const src = JSON.parse(read('docs/engineering/v10/copy-source.json'));
  for (const id of ['P280', 'P281', 'P282', 'P283', 'P284']) assert.ok(src.nonRuntimeDecisions[id], `${id} in nonRuntimeDecisions`);
});

test('B2.8 native hosts: the plan handed to native is the web bookkeeping (home button → paper with its rect; no source → quiet; other taps → push); the way back is planPaperDrag', () => {
  resetPaperSources();
  const home = { id: 'h8', n: 'home' };
  const write = { id: 'w8', n: 'write' };
  markPaperSource(el({ x: 20, y: 700, w: 353, h: 54 }, '开始写字'), 'home-cta');
  const plan = planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null });
  noteNativePlan(write.id, plan, home.id, null);
  const shaped = nativePlanOf(write.id);
  assert.equal(shaped.mode, 'paper');
  assert.deepEqual(shaped.source.rect, { x: 20, y: 700, w: 353, h: 54 });
  assert.equal(shaped.source.key, 'home-cta');
  assert.equal(shaped.panel, null, 'no DOM in node: no panel rect');
  assert.equal(nativeBackPlan(write, home, null).mode, 'paper', 'back: fold into the same button (re-measured when it is on screen)');
  // a programmatic push (notification / deep link / seed) is quiet both ways
  planPaper({ kind: 'pop', from: write, to: home }, { reduced: false, root: null });
  const quiet = planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null });
  assert.deepEqual(nativePlanShape(quiet), { mode: 'quiet' });
  assert.deepEqual(nativeBackPlan(write, home, null), { mode: 'quiet' });
  // a native tap on the result page (「再写一组」/ undo-skip): a tapped replace → push in, and the way back (D70: to home) is a plain slide
  const result = { id: 'r8', n: 'result' };
  const again = planPaper({ kind: 'replace', from: result, to: write }, { reduced: false, root: null, underId: home.id, nativeTap: true });
  assert.deepEqual(nativePlanShape(again), { mode: 'push' });
  assert.deepEqual(paperSourceOf(home.id), { pushed: true });
  assert.deepEqual(nativeBackPlan(write, home, null), { mode: 'push' });
  assert.deepEqual(nativeBackPlan(null, home, null), { mode: 'push' });
  resetPaperSources();
});

test('B2.8 nav idle bus: whenNavIdle runs at once when idle, otherwise when root reports idle; cancel works', () => {
  setNavBusy(false);
  let n = 0;
  whenNavIdle(() => { n += 1; });
  assert.equal(n, 1);
  setNavBusy(true);
  assert.equal(navIsIdle(), false);
  whenNavIdle(() => { n += 10; });
  const cancel = whenNavIdle(() => { n += 100; });
  cancel();
  assert.equal(n, 1);
  setNavBusy(false);
  assert.equal(n, 11);
  assert.equal(navIsIdle(), true);
});

test('B2.8 root.js wiring: transitions into / out of a native host are left to native (no web paper / slide for the hosted layer), bookkeeping stays, idle is reported', () => {
  const src = read('src/ui/root.js');
  assert.match(src, /function nativeMoves\(t, snap\)/);
  assert.match(src, /if \(nativeMoves\(t, snap\) && \(t\.animate \|\| t\.kind === 'pop'\)\) \{/);
  assert.match(src, /planPaper\(t, \{ reduced: false, root: appRef\.current, underId: under \? under\.id : null, nativeTap: t\.kind === 'replace' \}\)/);
  assert.match(src, /traceNav\(`\$\{t\.kind\}:native`\)/);
  assert.match(src, /setNavBusy\(!!animRef\.current\.current \|\| !!gestureOn\)/);
  const ns = read('src/ui/screens/write/native-session.js');
  assert.match(ns, /window\.shiziNativeNav|win\.shiziNativeNav = /);
  assert.match(ns, /useLayoutEffect\(\(\) => \{\n    installNativeWrite\(\);/, 'the write host posts open before the frame is painted');
});


test('R16: a tap on a native overlay (query sheet / S02) counts as an overlay entry: plain push in, plain slide back (D62), not the untapped B3 fade', () => {
  resetPaperSources();
  const home = { id: 'h', n: 'home' };
  const lib = { id: 'l', n: 'library' };
  const write = { id: 'w', n: 'write' };
  markNativeOverlayTap();
  assert.equal(planPaper({ kind: 'push', from: lib, to: write }, { reduced: false, root: null }), null, 'from the library: plain push');
  assert.deepEqual(paperSourceOf('l'), { pushed: true });
  assert.equal(planPaper({ kind: 'pop', from: write, to: lib }, { reduced: false, root: null }), null, 'back: plain slide');
  // 首页「自己选字」的弹层：同样不是首页入口（网页弹层里的点按记 overlay，同一规则）
  let called = 0;
  overlayTapped(() => { called += 1; })();
  assert.equal(called, 1);
  assert.equal(planPaper({ kind: 'push', from: home, to: write }, { reduced: false, root: null }), null, 'from the home pick sheet: plain push');
  // 没有点按（程序进写字页）仍是 B3
  assert.equal(planPaper({ kind: 'push', from: home, to: { id: 'w2', n: 'write' } }, { reduced: false, root: null }).mode, 'B3');
  assert.equal(overlayTapped(undefined), undefined);
});
