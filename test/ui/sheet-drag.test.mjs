// 弹层下滑关闭与退场（交互与动效规范 N4 ③ / T0-2，D58 ④；审计 P1-07 / P1-08）。
// 旧实现（10650a2）上：Sheet.js 明文不做下滑（没有 createSheetDrag），关闭时一帧消失（没有 exit.js），这里全红。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSheetDrag } from '../../src/ui/components/Sheet.js';
import { exitMs, EXIT_CLASS } from '../../src/ui/components/exit.js';
import { M } from '../../src/config/motion.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const H = 600;

function drag(points, { atTop = true } = {}) {
  const d = createSheetDrag({ height: H });
  const [x0, y0, t0] = points[0];
  d.start(x0, y0, t0, atTop);
  let last = null;
  for (const [x, y, t] of points.slice(1)) last = d.move(x, y, t);
  return { last, end: d.end(points[points.length - 1][2]) };
}

test('a slow drag past a third of the sheet height closes it; short of it springs back; dragging back cancels', () => {
  assert.equal(drag([[100, 100, 0], [100, 120, 100], [100, 330, 800], [100, 331, 1200]]).end, 'close', '230px of 600 > 1/3');
  assert.equal(drag([[100, 100, 0], [100, 120, 100], [100, 250, 800], [100, 251, 1200]]).end, 'snap', '150px of 600 < 1/3');
  assert.equal(drag([[100, 100, 0], [100, 120, 100], [100, 400, 500], [100, 300, 560]]).end, 'snap', 'pulled back up quickly → cancel (v < returnVelocity)');
});

test('a fast flick down closes from a short distance (v > gesture.commitVelocity)', () => {
  assert.equal(drag([[100, 100, 0], [100, 115, 20], [100, 140, 40], [100, 170, 60]]).end, 'close');
});

test('direction slop: a horizontal drag (image pager) or a drag while the content is scrolled never takes over', () => {
  const h = drag([[100, 100, 0], [140, 104, 30], [200, 108, 60]]);
  assert.equal(h.last.engaged, false);
  assert.equal(h.end, null);
  const s = drag([[100, 100, 0], [100, 130, 30], [100, 400, 300]], { atTop: false });
  assert.equal(s.last.engaged, false, 'content not at the top: the drag scrolls it');
  assert.equal(s.end, null);
  const tiny = createSheetDrag({ height: H });
  tiny.start(0, 0, 0, true);
  assert.equal(tiny.move(0, M.gesture.directionSlop - 1, 10).engaged, false, 'inside the slop nothing moves');
  assert.equal(tiny.move(0, M.gesture.directionSlop + 5, 20).engaged, true);
});

test('follow offset is measured from where the drag took over and never goes above 0', () => {
  const d = createSheetDrag({ height: H });
  d.start(0, 0, 0, true);
  d.move(0, 20, 10);
  assert.equal(d.move(0, 80, 20).offset, 60);
  assert.equal(d.move(0, -50, 30).offset, 0);
  assert.equal(d.cancel(), 'snap');
});

test('Sheet wiring: touch + pointer listeners, gesture tokens, reduced motion does not follow; entry animations fill backwards', () => {
  const src = read('src/ui/components/Sheet.js');
  assert.match(src, /useSheetDrag\(panelRef, close\)/);
  assert.match(src, /addEventListener\('touchmove', onTouchMove, \{ passive: false \}\)/, 'preventDefault on the vertical drag (no rubber band)');
  assert.match(src, /follow = !prefersReducedMotion\(window\)/);
  assert.match(src, /M\.gesture\.sheetCommitRatio/);
  assert.match(src, /animation:sz-sheet-in \$\{T\.dSheet\} \$\{T\.eOut\} backwards/, 'T-sheet in: 280ms ease.out; backwards so an inline drag transform wins');
  assert.doesNotMatch(src, /不能跟手下拉/, 'the old "no swipe-down" note is gone');
});

test('exit (T0-2): sheets 220ms down + scrim 180ms, confirms 180ms, toasts / undo bars 150ms; reduced motion 150ms fades', () => {
  assert.equal(exitMs('sheet', false), Math.max(M.role.sheetOut, M.role.scrimOut));
  assert.equal(exitMs('confirm', false), M.role.confirmOut);
  assert.equal(exitMs('fade', false), M.role.toastOut);
  for (const k of ['sheet', 'confirm', 'fade']) assert.equal(exitMs(k, true), M.dur.reduce);
  const ex = read('src/ui/components/exit.js');
  assert.match(ex, /data-exit="sheet"\]>\.sz-sheet\{animation:sz-exit-sheet \$\{T\.dRelease\} \$\{T\.eIn\} both !important\}/);
  assert.match(ex, /data-exit="confirm"\]>\.sz-confirm\{animation:sz-exit-confirm \$\{T\.dS\} \$\{T\.eIn\} both !important\}/);
  assert.equal(EXIT_CLASS, 'sz-exit');
  // 每个弹层（经 useDialogFocus）、提示条、撤销条（两种）都接上了退场
  assert.match(read('src/ui/components/Sheet.js'), /playExit\(overlay/);
  assert.match(read('src/ui/components/Toast.js'), /playExit\(ref\.current, 'fade'\)/);
  assert.match(read('src/ui/components/UndoBar.js'), /playExit\(ref\.current, 'fade'\)/);
  assert.match(read('src/ui/screens/write/skip.js'), /playExit\(ref\.current, 'fade'\)/);
});
