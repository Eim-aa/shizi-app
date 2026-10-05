// P1-S2 原生书写面 spike 的网页侧接线（src/ui/canvas/native-ink.js + ink-canvas.js nativeInk）。
// 开关关（没有 window.__shiziNativeInk）时 ink-canvas 行为完全照旧；开关开时落笔交给原生、抬笔原始点走 onUp 同一条固化路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInkSurface } from '../../src/ui/canvas/ink-canvas.js';
import { fromNativeRaw, nativeInkEnabled, toNativeRaw } from '../../src/ui/canvas/native-ink.js';

function harness({ flag = true, channel = true, acceptFrom } = {}) {
  const handlers = {};
  const ctxStub = new Proxy(function stub() {}, { get: (t, k) => (k === 'getImageData' ? () => ({ data: [] }) : ctxStub), apply: () => ctxStub, set: () => true });
  const canvas = () => ({
    width: 0, height: 0, style: {}, getContext: () => ctxStub, getBoundingClientRect: () => ({ left: 10, top: 20, width: 345, height: 345 }),
    addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
  });
  const live = canvas();
  const ink = canvas();
  const timers = [];
  const posted = [];
  let now = 1000;
  const win = {
    document: { createElement: () => canvas(), documentElement: {}, addEventListener() {} },
    devicePixelRatio: 1,
    performance: { now: () => now },
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: fn => { timers.push(['raf', fn]); return timers.length; }, cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { timers.push(['timeout', fn, ms]); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  if (flag) win.__shiziNativeInk = true;
  if (channel) win.webkit = { messageHandlers: { shiziNative: { postMessage: m => posted.push(m) } } };
  const events = [];
  const props = {
    drawable: true,
    acceptFrom,
    onStrokeStart: () => events.push('start'),
    onStrokeEnd: raw => events.push(['end', raw]),
    onStrokeCancel: reason => events.push(['cancel', reason]),
  };
  const box = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 345, height: 345 }) };
  const surface = createInkSurface({ box, inkCanvas: ink, liveCanvas: live, win, getProps: () => props, nativeInk: true });
  const ptr = (type, x, y, ts) => handlers[type]({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, timeStamp: ts, pointerType: 'mouse', preventDefault() {}, cancelable: true });
  return { surface, win, events, posted, ptr, timers, props, ink, live, setNow: t => { now = t; } };
}

test('native ink: off without the DEBUG flag or without the native channel — the web surface writes as before', () => {
  for (const opts of [{ flag: false }, { channel: false }]) {
    const h = harness(opts);
    assert.equal(nativeInkEnabled(h.win), false);
    assert.equal(h.ink.style.visibility, undefined, 'web canvases untouched');
    h.ptr('pointerdown', 20, 30, 1000);
    h.ptr('pointermove', 60, 30, 1010);
    h.ptr('pointerup', 90, 30, 1020);
    assert.deepEqual(h.events.map(e => (Array.isArray(e) ? e[0] : e)), ['start', 'end']);
    assert.equal(h.posted.filter(m => m.type === 'nativeInk').length, 0, 'nothing posted to native');
    assert.equal(h.win.shiziNativeInk, undefined);
    h.surface.destroy();
  }
});

test('native ink: on — web canvases hidden, web pointer input ignored, strokes synced to native', () => {
  const h = harness();
  assert.equal(nativeInkEnabled(h.win), true);
  assert.equal(h.ink.style.visibility, 'hidden');
  assert.equal(h.live.style.opacity, '0');
  h.ptr('pointerdown', 20, 30, 1000);
  h.ptr('pointerup', 90, 30, 1020);
  assert.deepEqual(h.events, [], 'web input does not write while native owns the grid');
  const stroke = [{ x: 1, y: 2, t: 3 }, { x: 4, y: 5, t: 6, p: 0.5 }];
  h.surface.sync([stroke]);
  const last = h.posted.filter(m => m.op === 'strokes').pop();
  assert.deepEqual(last.strokes, [[[1, 2, 3], [4, 5, 6, 0.5]]]);
  // 每帧量 rect（rAF）：变化时才发
  const raf = h.timers.find(t => t && t[0] === 'raf');
  raf[1]();
  const rect = h.posted.filter(m => m.op === 'rect').pop();
  assert.equal(rect.x, 10);
  assert.equal(rect.w, 345);
  assert.equal(rect.drawable, true);
  h.surface.destroy();
  assert.equal(h.ink.style.visibility, undefined, 'destroy restores the web canvases');
  assert.deepEqual(h.posted.pop(), { type: 'nativeInk', op: 'rect', visible: false });
});

test('native ink: start → end commits the raw points through onStrokeEnd, times mapped to the page clock', () => {
  const h = harness();
  h.setNow(5000);
  assert.equal(h.win.shiziNativeInk({ kind: 'start', t: 900 }), true);
  assert.deepEqual(h.events, ['start']);
  assert.equal(h.surface.isDrawing(), true);
  h.win.shiziNativeInk({ kind: 'end', raw: [[10, 20, 900], [30, 40, 916, 0.25], [50, 60, 932, 0]], nowNative: 1000 });
  const [kind, raw] = h.events[1];
  assert.equal(kind, 'end');
  assert.deepEqual(raw, [{ x: 10, y: 20, t: 4900 }, { x: 30, y: 40, t: 4916, p: 0.25 }, { x: 50, y: 60, t: 4932 }]);
  assert.equal(h.surface.paintedCount(), 1, 'painted like a web pen-up');
  assert.equal(h.surface.isDrawing(), false);
  h.surface.destroy();
});

test('native ink: a stroke landing before acceptFrom is held and started at acceptFrom (or at pen-up), never dropped', () => {
  const h = harness({ acceptFrom: 1250 });
  h.setNow(1100);
  h.win.shiziNativeInk({ kind: 'start' });
  assert.deepEqual(h.events, [], 'held');
  const timer = h.timers.find(t => t && t[0] === 'timeout');
  assert.equal(timer[2], 150);
  h.win.shiziNativeInk({ kind: 'end', raw: [[1, 1, 1], [2, 2, 2]], nowNative: 2 });
  assert.equal(h.events[0], 'start', 'pen-up before acceptFrom: start first, then commit');
  assert.equal(h.events[1][0], 'end');
  h.surface.destroy();
});

test('native ink: page reset cancels the native stroke; a late end is ignored; native cancel reaches onStrokeCancel', () => {
  const h = harness();
  h.win.shiziNativeInk({ kind: 'start' });
  assert.equal(h.surface.cancelCurrent('reset'), true);
  assert.deepEqual(h.posted.filter(m => m.op === 'cancel').pop(), { type: 'nativeInk', op: 'cancel', reason: 'reset' });
  assert.deepEqual(h.events.pop(), ['cancel', 'reset']);
  assert.equal(h.win.shiziNativeInk({ kind: 'end', raw: [[1, 1, 1], [2, 2, 2]], nowNative: 2 }), false, 'end after reset is not committed');
  assert.equal(h.surface.paintedCount(), 0);
  h.win.shiziNativeInk({ kind: 'start' });
  h.win.shiziNativeInk({ kind: 'cancel', reason: 'hidden' });
  assert.deepEqual(h.events.pop(), ['cancel', 'hidden']);
  h.surface.destroy();
  assert.equal(h.win.shiziNativeInk, undefined, 'global handler removed on destroy');
});

test('native ink: raw conversion helpers drop bad rows and keep p only when > 0', () => {
  assert.deepEqual(fromNativeRaw([[1, 2, 3], [NaN, 1, 1], 'x', [4, 5, 6, 2]], 10, 15), [{ x: 1, y: 2, t: 8 }, { x: 4, y: 5, t: 11, p: 1 }]);
  assert.deepEqual(fromNativeRaw([[1, 2, 3]]), [{ x: 1, y: 2, t: 3 }]);
  assert.deepEqual(toNativeRaw([[{ x: 1, y: 2, t: 3, p: 0 }, { x: 4, y: 5, t: 6, p: 0.4 }]]), [[[1, 2, 3], [4, 5, 6, 0.4]]]);
});
