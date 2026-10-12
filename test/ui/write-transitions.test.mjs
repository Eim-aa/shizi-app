// R2-X1（D51 ②⑦，P227；第二轮审查 I2-01）：写字页阶段间 150ms 交叉淡化、判断两键的就绪时序、早到落笔缓存——能在 node 里测的部分。
// 真实页面里的时间轴在 scripts/e2e/85-x1-transitions.spec.js。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FADE_MS, FLIP_MS, FLIP_EASING, TEXT_OUT_MS, SNAPSHOT_TESTID, reducedMotion, makeSnapshot, mountSnapshot, removeSnapshots, diffRegions, flipTransform, sameBox, regionTexts, inkSource,
} from '../../src/ui/screens/write/phase-fade.js';
import { PEN_ARM_MS } from '../../src/ui/screens/write/index.js';
import { JudgeButtons, JudgeFooter } from '../../src/ui/screens/write/compare.js';
import { createInkSurface } from '../../src/ui/canvas/ink-canvas.js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// ---- 最小 DOM 替身（只够 makeSnapshot / mountSnapshot 用）
class El {
  constructor(tag = 'div') {
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.className = '';
    this.width = 0;
    this.height = 0;
    this.parent = null;
    this.listeners = {};
    this.drawn = [];
  }

  get tagName() { return this.tag.toUpperCase(); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  getContext() { return { drawImage: src => this.drawn.push(src) }; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelectorAll(sel) {
    if (sel === 'canvas') return this.all().filter(e => e.tag === 'canvas');
    if (sel === '*') return this.all();
    if (sel === ':scope > .sz-phasefade') return this.children.filter(c => c.className === 'sz-phasefade');
    return [];
  }

  cloneNode(deep) {
    const c = new El(this.tag);
    c.attrs = { ...this.attrs };
    c.className = this.className;
    c.width = this.width;
    c.height = this.height;
    if (deep) for (const k of this.children) c.appendChild(k.cloneNode(true));
    return c;
  }
}
const doc = { createElement: tag => new El(tag) };

function samplePage() {
  const page = new El('div');
  page.className = 'sz-page';
  page.setAttribute('data-testid', 'write-screen');
  const h1 = page.appendChild(new El('h1'));
  h1.setAttribute('data-page-title', '');
  h1.setAttribute('tabindex', '-1');
  const btn = page.appendChild(new El('button'));
  btn.setAttribute('data-testid', 'write-done');
  const grid = page.appendChild(new El('div'));
  grid.setAttribute('data-testid', 'write-grid');
  grid.setAttribute('id', 'x');
  const canvas = grid.appendChild(new El('canvas'));
  canvas.width = 690;
  canvas.height = 690;
  return { page, canvas };
}

test('P227: the cross-fade is 150ms, linear, opacity only (no transform) — read from the injected style', () => {
  assert.equal(FADE_MS, 150);
  const src = read('src/ui/screens/write/phase-fade.js');
  assert.match(src, /@keyframes szPhaseOut\{from\{opacity:1\}to\{opacity:0\}\}/);
  assert.match(src, /animation:szPhaseOut \$\{FADE_MS\}ms \$\{T\.eLinear\} both/);
  const css = src.slice(src.indexOf("injectStyles('write-fade'"), src.indexOf('`);', src.indexOf("injectStyles('write-fade'")));
  // 快照本身（.sz-phasefade）只淡化：没有位移 / 缩放（本人墨的缩放在另一张 FLIP canvas 上，.sz-flipink）
  const overlayRules = css.split('\n').filter(l => /^\.sz-phasefade/.test(l)).join('\n');
  assert.ok(!/transform|translate|scale\(/.test(overlayRules), 'the snapshot overlay only fades — no translate / scale');
  assert.match(css, /pointer-events:none/);
  assert.match(css, /\.sz-phasefade \*\{animation:none !important\}/, 'cloned elements do not replay their own animations');
  // D58 ②（P1-10）：减少动态效果下不再硬切——快照照样 150ms 线性交叉淡化（--dur-reduce），只是不做 FLIP 缩放
  assert.match(css, /prefers-reduced-motion: reduce\)\{\.sz-flipink\{display:none\}\[data-flip-hide\]\{visibility:visible\}\.sz-phasefade\{animation-duration:\$\{T\.dReduce\}\}\}/);
  assert.doesNotMatch(css, /\.sz-phasefade,\.sz-flipink\{display:none\}/, 'the snapshot is not hidden under reduced motion');
  assert.doesNotMatch(src, /!reducedMotion\(\) \? makeSnapshot/, 'the snapshot is taken under reduced motion too');
});

test('D53 ⑥: text regions go out in the first 75ms and come in over 75–150ms (never both visible); the ink is scaled by one FLIP canvas (pure scale, top-centre origin, 200ms)', () => {
  assert.deepEqual([TEXT_OUT_MS, FLIP_MS, FLIP_EASING], [75, 200, 'cubic-bezier(.2,.7,.2,1)']);
  const src = read('src/ui/screens/write/phase-fade.js');
  const css = src.slice(src.indexOf("injectStyles('write-fade'"), src.indexOf('`);', src.indexOf("injectStyles('write-fade'")));
  assert.match(css, /@keyframes szTextOut\{from\{opacity:1\}to\{opacity:0\}\}/);
  assert.match(css, /@keyframes szTextIn\{0%,50%\{opacity:0\}100%\{opacity:1\}\}/, 'new text: transparent for the first half of the 150ms, then in');
  assert.match(css, /\.sz-phasefade \[data-fade-out\]\{animation:szTextOut \$\{TEXT_OUT_MS\}ms \$\{T\.eLinear\} both !important\}/);
  assert.match(css, /\.sz-page \[data-fade-in\]\{animation:szTextIn \$\{FADE_MS\}ms \$\{T\.eLinear\} both\}/);
  assert.match(css, /\.sz-flipink\{[^}]*transform-origin:50% 0/, 'FLIP origin = the top edge midpoint');
  assert.match(css, /\[data-flip-hide\]\{visibility:hidden\}/, 'the real ink at the target stays hidden while the FLIP canvas runs');
  assert.ok(/data-flip-ink/.test(src) && /dropSnapshotInk/.test(src), 'the snapshot never carries a second copy of the ink when a FLIP / the real layer shows it');
});

test('diffRegions / regionTexts: only regions whose text changed are faded out and in; unchanged ones (back arrow, counter, same prompt) do not blink', () => {
  const before = { title: null, prompt: 'yǒng 永远', note: '「根」记为写对', foot: '写好了' };
  assert.deepEqual(diffRegions(before, { title: '写对了吗？', prompt: 'yǒng 永远', note: null, foot: '写错了写对了' }), ['title', 'note', 'foot']);
  assert.deepEqual(diffRegions(before, { ...before }), [], 'nothing changed → nothing fades');
  assert.deepEqual(diffRegions(null, null), []);
  assert.deepEqual(diffRegions({ title: null, prompt: null, note: null, foot: null }, { title: null, prompt: null, note: null, foot: null }), [], 'absent on both sides is not a change');
  const root = { querySelector: sel => (sel.includes('sz-prompt') ? { textContent: ' yǒng  永远 ' } : null) };
  assert.deepEqual(regionTexts(root), { title: null, prompt: 'yǒng 永远', note: null, foot: null }, 'whitespace collapsed, missing regions are null');
});

test('flipTransform / sameBox: a pure scale about the top-centre when the top edge and midline are fixed (P257); otherwise the true translation', () => {
  const grid = { left: 20, top: 188, width: 350, height: 350 };
  const cell = { left: 71.5, top: 188, width: 247, height: 247 };
  const t = flipTransform(grid, cell);
  assert.ok(Math.abs(t.scale - 247 / 350) < 1e-9 && t.dx === 0 && t.dy === 0, `pure scale ${JSON.stringify(t)}`);
  const back = flipTransform(cell, grid);
  assert.ok(Math.abs(back.scale - 350 / 247) < 1e-9 && back.dx === 0 && back.dy === 0);
  const moved = flipTransform(grid, { left: 20, top: 200, width: 350, height: 350 });
  assert.deepEqual([moved.scale, moved.dx, moved.dy], [1, 0, 12], 'a moved box translates');
  assert.equal(sameBox(grid, { ...grid, left: 20.4 }), true);
  assert.equal(sameBox(grid, cell), false);
  assert.equal(sameBox(null, grid), false);
});

test('inkSource: the writing grid with strokes is the ink source; otherwise the judge upper cell; empty grid / no cell → null', () => {
  const box = { getBoundingClientRect: () => ({ left: 20, top: 100, width: 350, height: 350 }), clientLeft: 1, clientTop: 1, clientWidth: 348, clientHeight: 348 };
  const canvas = { width: 696 };
  const mk = (strokes, withMine) => ({
    querySelector(sel) {
      if (sel === '[data-testid="write-grid"]') return strokes === null ? null : { ...box, getAttribute: k => (k === 'data-stroke-count' ? String(strokes) : null), querySelector: () => canvas };
      if (sel === '[data-testid="write-compare-mine"]') return withMine ? { ...box, querySelector: () => canvas } : null;
      return null;
    },
  });
  const a = inkSource(mk(2, false));
  assert.deepEqual([a.kind, a.box], ['grid', { left: 21, top: 101, width: 348, height: 348 }], 'the inner box (border excluded)');
  assert.equal(inkSource(mk(0, false)), null, 'a grid without strokes has no ink');
  assert.equal(inkSource(mk(null, true)).kind, 'card');
  assert.equal(inkSource(mk(null, false)), null);
  assert.equal(inkSource(null), null);
});

test('makeSnapshot: wraps a clone of the page (aria-hidden, own testid), copies every canvas, strips testids / ids / title marks, takes buttons out of the tab order', () => {
  const { page, canvas } = samplePage();
  const snap = makeSnapshot(page, doc);
  const wrap = snap.wrap;
  assert.equal(snap.ink, null, 'no ink in this fake page');
  assert.deepEqual(snap.texts, { title: null, prompt: null, note: null, foot: null });
  assert.equal(wrap.className, 'sz-phasefade');
  assert.equal(wrap.getAttribute('aria-hidden'), 'true');
  assert.equal(wrap.getAttribute('inert'), null, 'no inert attribute: iOS 15.5+ only (API floor gate)');
  assert.equal(wrap.getAttribute('data-testid'), SNAPSHOT_TESTID);
  const clone = wrap.children[0];
  assert.notEqual(clone, page);
  const stripped = [clone, ...clone.all()].every(e => !('data-testid' in e.attrs) && !('id' in e.attrs) && !('data-page-title' in e.attrs) && (e.tag === 'button' || !('tabindex' in e.attrs)));
  assert.ok(stripped, 'the snapshot never duplicates a testid / id / page title of the live page');
  assert.equal(page.getAttribute('data-testid'), 'write-screen', 'the live page keeps its own');
  assert.equal(clone.all().find(e => e.tag === 'button').getAttribute('tabindex'), '-1', 'buttons in the snapshot are out of the tab order');
  assert.equal(page.children.find(e => e.tag === 'button').getAttribute('tabindex'), null, 'the live buttons are untouched');
  const [copy] = clone.querySelectorAll('canvas');
  assert.deepEqual(copy.drawn, [canvas], 'the ink / hint canvases are copied pixel by pixel');
  assert.equal(copy.width, 690, 'same canvas size');
});

test('mountSnapshot / removeSnapshots: one snapshot at a time, removed when the animation ends', () => {
  const { page } = samplePage();
  page.querySelectorAll = El.prototype.querySelectorAll;
  const a = makeSnapshot(page, doc);
  const timers = [];
  const win = { setTimeout: fn => { timers.push(fn); return timers.length; } };
  mountSnapshot(page, a, null, win);
  assert.equal(page.querySelectorAll(':scope > .sz-phasefade').length, 1);
  const b = makeSnapshot(page, doc); // a second switch in a row: the first one is collected before the next is taken
  assert.equal(page.querySelectorAll(':scope > .sz-phasefade').length, 0, 'the previous snapshot is gone when the next one is taken');
  mountSnapshot(page, b, null, win);
  assert.equal(page.querySelectorAll(':scope > .sz-phasefade').length, 1);
  b.wrap.listeners.animationend();
  assert.equal(page.querySelectorAll(':scope > .sz-phasefade').length, 0, 'animationend removes it');
  assert.ok(timers.length >= 2, 'timeouts back the animationend up (the overlay and the text fade-ins)');
  timers[0]();
  removeSnapshots(page);
});

test('reducedMotion follows the media query; without a window it is false', () => {
  assert.equal(reducedMotion({ matchMedia: q => ({ matches: /reduce/.test(q) }) }), true);
  assert.equal(reducedMotion({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(reducedMotion({ matchMedia() { throw new Error('x'); } }), false);
});

test('the write page keys the fade on card + phase, takes the snapshot while rendering (the DOM is still the old state) and mounts it in a layout effect', () => {
  const src = read('src/ui/screens/write/phase-fade.js');
  assert.match(src, /if \(key !== committed\.current && key !== null && committed\.current !== null\)/);
  assert.match(src, /useLayoutEffect\(\(\) => \{[\s\S]*mountSnapshot\(page, p\.snap, el\)/);
  const index = read('src/ui/screens/write/index.js');
  assert.match(index, /usePhaseFade\(writeRef, cardKey \? `\$\{cardKey\}\|\$\{phase\}` : null\)/);
  assert.ok(index.indexOf('usePhaseFade(') < index.indexOf('if (!cardKey) {'), 'the hook runs before the early return (hook order)');
});

// ---- 判断两键的就绪（P227：0–320 不显示，320 起 60% 不可点，440 变实可点）
test('JudgeButtons: ready defaults to true (plain view); ready=false marks the container, and a tap while it is not ready does nothing', () => {
  const find = (node, pred, out = []) => {
    if (node && typeof node === 'object') {
      if (Array.isArray(node)) node.forEach(n => find(n, pred, out));
      else {
        if (pred(node)) out.push(node);
        if (node.props && node.props.children !== undefined) find(node.props.children, pred, out);
      }
    }
    return out;
  };
  const plain = JudgeButtons({ onJudge: () => {} });
  assert.equal(plain.props['data-ready'], 'true');
  const calls = [];
  const gated = JudgeButtons({ onJudge: j => calls.push(j), ready: false });
  assert.equal(gated.props['data-ready'], 'false');
  const buttons = find(gated, n => n.props && n.props['data-testid'] && /write-judge-/.test(n.props['data-testid']));
  assert.equal(buttons.length, 2);
  buttons[0].props.onClick();
  assert.deepEqual(calls, [], 'not ready: the tap is swallowed');
  const live = JudgeButtons({ onJudge: j => calls.push(j), ready: true });
  find(live, n => n.props && n.props['data-testid'] === 'write-judge-wrong')[0].props.onClick();
  assert.deepEqual(calls, ['wrong']);
  assert.equal(JudgeFooter({ onJudge: () => {}, ready: false }).props.children.flat(3).some(c => c && c.type === JudgeButtons && c.props.ready === false), true, 'the footer passes ready through');
});

test('compare.js: the buttons wait 320ms hidden, show at 60% (not tappable) and are solid at 440ms; the reference cell only fades (no translateY)', () => {
  const src = read('src/ui/screens/write/compare.js');
  // D58（P2-05）：时刻取 motion.moment.judgeAppear / judgeReady，关键帧分界由它们算出，不手算
  assert.match(src, /@keyframes szJudgeWait\{0%,\$\{JUDGE_SHOW_AT\}%\{opacity:0\}\$\{JUDGE_SHOW_AT \+ 0\.1\}%,99\.9%\{opacity:\.6\}100%\{opacity:1\}\}/, '0 until 320ms, .6 from then, 1 at 440ms');
  assert.match(src, /JUDGE_SHOW_AT = Math\.round\(\(JUDGE_SHOW_MS \/ JUDGE_READY_MS\) \* 1000\) \/ 10/);
  assert.match(src, /\.sz-judge__btns\[data-ready="false"\]\{[^}]*animation:szJudgeWait \$\{JUDGE_READY_MS\}ms \$\{T\.eLinear\} both;[^}]*pointer-events:none/);
  assert.match(src, /JUDGE_SHOW_MS = M\.moment\.judgeAppear/);
  assert.match(src, /JUDGE_READY_MS = M\.moment\.judgeReady/);
  assert.doesNotMatch(src, /JUDGE_READY_REDUCED_MS/, 'reduced motion: the buttons are tappable at once, no invisible 150ms lock (P1-41)');
  const keyframes = /@keyframes szCmpIn\{([^}]*(?:\}[^}]*)?)\}/.exec(src);
  assert.ok(keyframes && !/translate|transform/.test(keyframes[0]), 'szCmpIn has no transform');
  assert.match(src, /\.sz-compare__row--ref\{[^;]*;animation:szCmpIn \$\{T\.dM\} \$\{T\.eLinear\} \$\{T\.dFade\} both/);
  assert.match(src, /prefers-reduced-motion: reduce\)\{\.sz-compare__row--ref\{animation:szCmpIn \$\{T\.dReduce\} \$\{T\.eLinear\} both\}\}/, 'reduced motion: the reference cell fades in 150ms, not a hard cut');
  assert.match(src, /const ready = active && \(reducedNow \|\| readyKey === key\);/);
});

// ---- 早到的落笔
test('PEN_ARM_MS is 250 (M3: strokes are accepted from 250ms after the new card)', () => {
  assert.equal(PEN_ARM_MS, 250);
});

/** 最小 canvas / box 替身，让 createInkSurface 在 node 里能跑。 */
function surfaceHarness({ acceptFrom }) {
  const handlers = {};
  const ctxStub = new Proxy(function stub() {}, { get: (t, k) => (k === 'getImageData' ? () => ({ data: [] }) : ctxStub), apply: () => ctxStub, set: () => true });
  const canvas = () => ({
    width: 0, height: 0, getContext: () => ctxStub, getBoundingClientRect: () => ({ left: 0, top: 0, width: 345, height: 345 }),
    addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
  });
  const live = canvas();
  const ink = canvas();
  const timers = [];
  const win = {
    document: { createElement: () => canvas(), documentElement: {} },
    devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: fn => { timers.push(['raf', fn]); return timers.length; }, cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { timers.push(['timeout', fn, ms]); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  const events = [];
  const props = { drawable: true, acceptFrom, onStrokeStart: () => events.push('start'), onStrokeEnd: raw => events.push(['end', raw.length]) };
  const box = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 345, height: 345 }) };
  const surface = createInkSurface({ box, inkCanvas: ink, liveCanvas: live, win, getProps: () => props });
  const ptr = (type, x, y, ts) => handlers[type]({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, timeStamp: ts, pointerType: 'mouse', preventDefault() {}, cancelable: true });
  return { surface, events, ptr, timers, props };
}

test('ink surface: a stroke that lands before acceptFrom is NOT dropped — it is held, started at acceptFrom (or at pen-up) and committed with all its points', () => {
  const clock = performance.now();
  const h = surfaceHarness({ acceptFrom: clock + 5000 });
  h.ptr('pointerdown', 10, 10, clock + 1);
  h.ptr('pointermove', 100, 10, clock + 20);
  assert.deepEqual(h.events, [], 'held: no start yet (the hint / result row do not react to a stroke that has not been armed)');
  assert.equal(h.surface.isDrawing(), true, 'but the stroke is being recorded');
  h.ptr('pointerup', 200, 10, clock + 40);
  assert.deepEqual(h.events, ['start', ['end', 3]], 'pen-up before the arming time still delivers start then the whole stroke (not lost)');
  assert.equal(h.surface.paintedCount(), 1, 'and it is painted');
});

test('ink surface: a held stroke is released by the timer at acceptFrom (start fires, then the stroke goes on live); a cancel before that drops it', () => {
  const clock = performance.now();
  const h = surfaceHarness({ acceptFrom: clock + 120 });
  h.ptr('pointerdown', 10, 10, clock + 1);
  const timeout = h.timers.find(t => t && t[0] === 'timeout');
  assert.ok(timeout && timeout[2] > 0 && timeout[2] <= 125, `a release timer is set for the remaining time (${timeout && timeout[2]}ms)`);
  assert.deepEqual(h.events, []);
  timeout[1]();
  assert.deepEqual(h.events, ['start'], 'at acceptFrom the stroke starts for real');
  h.ptr('pointerup', 50, 10, clock + 200);
  assert.deepEqual(h.events, ['start', ['end', 2]]);
  const h2 = surfaceHarness({ acceptFrom: clock + 5000 });
  h2.ptr('pointerdown', 10, 10, clock + 1);
  h2.surface.cancelCurrent('reset'); // card changed again / page reset
  assert.equal(h2.surface.isDrawing(), false);
  h2.ptr('pointerup', 50, 10, clock + 30);
  assert.deepEqual(h2.events, [], 'a cancelled held stroke never commits');
});

test('ink surface: after acceptFrom a stroke starts immediately (unchanged behaviour); not drawable → ignored', () => {
  const clock = performance.now();
  const h = surfaceHarness({ acceptFrom: clock - 1000 });
  h.ptr('pointerdown', 10, 10, clock + 1);
  assert.deepEqual(h.events, ['start']);
  const n = surfaceHarness({ acceptFrom: clock - 1000 });
  n.props.drawable = false;
  n.ptr('pointerdown', 10, 10, clock + 1);
  assert.deepEqual(n.events, []);
});
