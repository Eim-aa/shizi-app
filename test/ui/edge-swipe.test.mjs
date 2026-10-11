// R4-G1（P271）：网页兜底左缘手势的判定（ui/edge-swipe.js createEdgeSwipeTracker），纯逻辑。
// 派发的 detail 与 Swift dispatchBackGesture 同一形状，再交给 router.createBackGestureController——这里接上真控制器核对端到端结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEdgeSwipeTracker, DIRECTION_SLOP_PX, EDGE_ZONE_PX } from '../../src/ui/edge-swipe.js';
import { createBackGestureController } from '../../src/ui/router.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const W = 390;

function harness({ reduced = false } = {}) {
  const sent = [];
  let backs = 0;
  const ctrl = createBackGestureController({
    getState: () => ({ stack: [{ k: 's', id: 'e1', n: 'home' }, { k: 's', id: 'e2', n: 'sub' }], topIsOverlay: false, pending: false }),
    back: () => { backs += 1; },
    width: () => W,
    reducedMotion: () => reduced,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  const tr = createEdgeSwipeTracker({
    dispatch: d => {
      sent.push(d);
      ctrl.handle(d);
    },
    width: () => W,
  });
  return { tr, ctrl, sent, backs: () => backs };
}

/** 从 (x0, y) 向右拖到 x1，steps 步、每步 dt ms。 */
function drag(tr, x0, x1, y, { steps = 10, dt = 16, t0 = 1000, dy = 0 } = {}) {
  assert.equal(tr.down(x0, y, t0), true);
  let t = t0;
  for (let i = 1; i <= steps; i += 1) {
    t += dt;
    tr.move(x0 + ((x1 - x0) * i) / steps, y + (dy * i) / steps, t);
  }
  return t;
}

test('only presses inside the 12px edge zone start tracking (inside the 20px page gutter, clear of the gutter buttons\' hit areas)', () => {
  const { tr } = harness();
  assert.equal(EDGE_ZONE_PX, 12);
  assert.equal(tr.down(13, 400, 0), false, 'outside the zone');
  assert.equal(tr.active(), false);
  assert.equal(tr.down(12, 400, 0), true, 'zone edge counts');
  assert.equal(tr.down(0, 800, 0), true, 'any height, even the bottom of the screen');
});

test('any height: top / middle / bottom drags past a third go back exactly once', () => {
  for (const y of [120, 420, 800]) {
    const h = harness();
    const t = drag(h.tr, 4, 4 + W * 0.45, y, { dt: 40 }); // 慢拖（速度 < 500）过三分之一
    assert.equal(h.tr.up(4 + W * 0.45, y, t + 40), 'swipe');
    assert.equal(h.backs(), 1, `y=${y}: went back`);
    assert.deepEqual(h.sent.map(d => d.phase).filter((p, i, a) => a[i - 1] !== p), ['began', 'changed', 'ended']);
  }
});

test('short slow drag springs back; translation is measured from the press point; velocity from the last 100ms', () => {
  const h = harness();
  const t = drag(h.tr, 10, 80, 300, { dt: 50 }); // 10 在 12px 起手带内
  const last = h.sent[h.sent.length - 1];
  assert.equal(last.phase, 'changed');
  assert.equal(last.translationX, 70, 'translation from the press point');
  assert.ok(Math.abs(last.velocityX - 140) < 1, `velocity ≈ 7px / 50ms = 140px/s (${last.velocityX})`);
  assert.equal(h.tr.up(80, 300, t + 50), 'swipe');
  assert.equal(h.backs(), 0, 'short of a third and slow: no back');
  assert.equal(h.ctrl.getView().phase, 'snap', 'springs back');
});

test('a fast flick from the edge goes back from a short distance', () => {
  const h = harness();
  const t = drag(h.tr, 2, 70, 500, { steps: 4, dt: 16 });
  h.tr.up(70, 500, t + 8);
  assert.equal(h.backs(), 1);
});

test('mid-way reversal: dragging back toward the edge cancels', () => {
  const h = harness();
  let t = drag(h.tr, 2, 250, 500, { dt: 30 });
  for (let x = 240; x >= 30; x -= 30) {
    t += 30;
    h.tr.move(x, 500, t);
  }
  assert.ok(h.ctrl.getView().x < 40, 'the page followed the finger back');
  h.tr.up(30, 500, t + 30);
  assert.equal(h.backs(), 0, 'pulled back: no back');
});

test('vertical-first drags become scrolling, never a back gesture; a tap stays a tap', () => {
  const h = harness();
  h.tr.down(6, 400, 0);
  assert.equal(h.tr.move(8, 400 + DIRECTION_SLOP_PX + 2, 16), 'scroll');
  assert.equal(h.tr.move(200, 420, 32), 'scroll', 'once scrolling, stays scrolling');
  assert.equal(h.tr.up(200, 420, 48), 'scroll');
  assert.equal(h.sent.length, 0, 'no gesture events');

  h.tr.down(6, 400, 100);
  assert.equal(h.tr.move(9, 402, 116), 'pending', 'under the slop');
  assert.equal(h.tr.up(9, 402, 130), 'tap', 'tap → forwarded to the element underneath');
  assert.equal(h.sent.length, 0);

  h.tr.down(6, 400, 200);
  assert.equal(h.tr.move(0, 400 - 30, 216), 'scroll', 'leftward / up never starts a back gesture');
});

test('pointercancel while following springs back', () => {
  const h = harness();
  drag(h.tr, 2, 300, 500);
  h.tr.cancel();
  assert.equal(h.sent[h.sent.length - 1].phase, 'cancelled');
  assert.equal(h.backs(), 0);
  assert.equal(h.ctrl.getView().phase, 'snap');
});

test('reduced motion: no follow, still goes back past the threshold', () => {
  const h = harness({ reduced: true });
  const t = drag(h.tr, 2, 250, 500, { dt: 40 });
  assert.equal(h.ctrl.getView(), null, 'no follow frames');
  h.tr.up(250, 500, t + 40);
  assert.equal(h.backs(), 1);
});

test('the web fallback is off inside the native shell; the strip is aria-hidden and uses the gutter token', () => {
  const root = readFileSync(join(ROOT, 'src/ui/root.js'), 'utf8');
  assert.match(root, /nativeShellRef\.current \? null : attachEdgeSwipe\(/, 'not attached in the native shell');
  assert.match(root, /const webEdge = !nativeShellRef\.current && edgeOkRef\.current;/, 'strip only outside the native shell, only when back is allowed');
  const src = readFileSync(join(ROOT, 'src/ui/edge-swipe.js'), 'utf8');
  assert.match(src, /class="sz-edge" aria-hidden="true"/);
  assert.match(src, /top:calc\(env\(safe-area-inset-top, 0px\) \+ \$\{T\.hit\}\);bottom:0;width:\$\{EDGE_ZONE_PX\}px/, 'starts below the 44pt page header (never covers 「‹」 / 「×」)');
  assert.match(src, /touch-action:none/);
});
