// R3-K1（ADA A3-01，P240）：书写格变形时笔画坐标的正方形防线。
// WKWebView 在 AX 档把 .sz-inkgrid 拉成 286×334 时，旧实现 x 除以宽、y 除以高，存进 345 单位正方形的笔迹被纵向压到 1/1.17。
// 现在以较短边为单位、居中映射：容器宽高不等时，屏幕上 dx = dy 的一笔存下来仍是 dx = dy，且每个书写面只上报一次。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInkSurface, squareMapping, GRID } from '../../src/ui/canvas/ink-canvas.js';

function harness(rect) {
  const handlers = {};
  const ctxStub = new Proxy(function stub() {}, { get: () => ctxStub, apply: () => ctxStub, set: () => true });
  const canvas = () => ({
    width: 0, height: 0, getContext: () => ctxStub, getBoundingClientRect: () => rect,
    addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
  });
  const live = canvas();
  const ink = canvas();
  const win = {
    document: { createElement: () => canvas(), documentElement: {} },
    devicePixelRatio: 2,
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  const strokes = [];
  const props = { drawable: true, onStrokeEnd: raw => strokes.push(raw) };
  const surface = createInkSurface({ box: { getBoundingClientRect: () => rect }, inkCanvas: ink, liveCanvas: live, win, getProps: () => props });
  const ptr = (type, x, y, ts) => handlers[type]({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, timeStamp: ts, pointerType: 'touch', preventDefault() {}, cancelable: true });
  return { surface, strokes, ptr, ink, live };
}

function drawDiagonal(h, rect, d) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  h.ptr('pointerdown', cx - d, cy - d, 1);
  h.ptr('pointermove', cx, cy, 2);
  h.ptr('pointerup', cx + d, cy + d, 3);
  return h.strokes[h.strokes.length - 1];
}

const ratio = raw => (raw[raw.length - 1].y - raw[0].y) / (raw[raw.length - 1].x - raw[0].x);
const close = (a, b) => Math.abs(a - b) < 1e-9;

for (const rect of [
  { left: 44, top: 211, width: 286, height: 334 }, // SE3 AX5 在 WKWebView 里实测（A3-01）
  { left: 44, top: 211, width: 304, height: 334 }, // SE3 AX3
  { left: 44, top: 211, width: 287, height: 220 }, // 结果行出现后实测的另一种变形（门禁 before）
  { left: 20, top: 100, width: 335, height: 335 }, // 正常的正方形
]) {
  test(`ink surface: in a ${rect.width}×${rect.height} box a stroke with equal on-screen dx / dy is stored with equal dx / dy, centred in GRID units`, () => {
    const warn = console.warn;
    const warned = [];
    console.warn = (...a) => warned.push(a);
    try {
      const h = harness(rect);
      const raw = drawDiagonal(h, rect, 60);
      assert.ok(close(ratio(raw), 1), `dy/dx = ${ratio(raw)}`);
      const mid = raw[1];
      assert.ok(close(mid.x, GRID / 2) && close(mid.y, GRID / 2), `the centre of the box maps to the centre of the grid (${mid.x}, ${mid.y})`);
      const s = Math.min(rect.width, rect.height);
      assert.ok(close(raw[2].x - raw[0].x, (120 * GRID) / s), 'the unit is the shorter side');
      assert.equal(h.ink.width, h.ink.height, 'the ink bitmap stays square');
      assert.equal(h.ink.width, Math.round(s * 2), 'bitmap side = shorter side × dpr');
      drawDiagonal(h, rect, 30);
      assert.equal(warned.length, rect.width === rect.height ? 0 : 1, 'a non-square box is reported once per surface (not per sample)');
    } finally {
      console.warn = warn;
    }
  });
}

test('squareMapping: shorter side is the unit, the square is centred in the longer side', () => {
  assert.deepEqual(squareMapping({ left: 0, top: 0, width: 286, height: 334 }), { side: 286, ox: 0, oy: 24, square: false });
  assert.deepEqual(squareMapping({ left: 0, top: 0, width: 334, height: 286 }), { side: 286, ox: 24, oy: 0, square: false });
  assert.deepEqual(squareMapping({ left: 0, top: 0, width: 300, height: 300.5 }), { side: 300, ox: 0, oy: 0.25, square: true });
});

test('InkGrid: explicit square width / height in px (no reliance on aspect-ratio or flex stretch); canvases letterbox with object-fit:contain', () => {
  const src = readFileSync(new URL('../../src/ui/canvas/ink-canvas.js', import.meta.url), 'utf8');
  assert.match(src, /style=\$\{\{ width: `\$\{size\}px`, height: `\$\{size\}px` \}\}/);
  assert.match(src, /\.sz-inkgrid\{[^}]*align-self:center/);
  assert.doesNotMatch(src, /\.sz-inkgrid\{[^}]*max-width:100%/, 'max-width would shrink the width but not the height');
  assert.match(src, /canvas\.sz-inkgrid__layer\{object-fit:contain\}/);
});
