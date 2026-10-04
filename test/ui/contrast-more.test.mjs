// 阶段 1 P1-E1b（D46 ⑯ / 03 P153）：「增强对比度」（prefers-contrast: more）下淡朱描红 canvas 多画一圈 1pt 外廓，令牌不改。
// 提示笔画的 CSS 描边（drop-shadow）由 scripts/e2e/72-p1e1b-layout.spec.js 在浏览器里断言；这里测 canvas 路径与媒体查询判断。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawGlyph, prefersMoreContrast, glyphTransform } from '../../src/ui/canvas/glyph.js';

class FakePath { constructor(d) { this.d = d; } }

function fakeCtx() {
  const calls = [];
  const ctx = {
    calls, globalAlpha: 1, strokeStyle: '', fillStyle: '', lineWidth: 0, lineJoin: '',
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); }, translate() {}, scale() {},
    stroke(p) { calls.push(['stroke', ctx.strokeStyle, ctx.lineWidth, p.d]); },
    fill(p) { calls.push(['fill', ctx.fillStyle, p.d]); },
  };
  return ctx;
}

const DATA = { strokes: ['M0 0', 'M1 1'] };

test('drawGlyph: no halo by default — only the danzhu outline and the fill', () => {
  globalThis.Path2D = FakePath;
  const ctx = fakeCtx();
  drawGlyph(ctx, DATA, { color: '#C06D57', alpha: 0.4, outline: { color: '#C06D57', width: 4 } });
  const strokes = ctx.calls.filter(c => c[0] === 'stroke');
  assert.equal(strokes.length, 2, 'one outline per stroke');
  assert.ok(strokes.every(c => c[1] === '#C06D57'), 'all danzhu');
});

test('drawGlyph: halo (increase contrast) is drawn first, 1pt wider on each side, in the halo colour; the danzhu outline and fill stay on top', () => {
  globalThis.Path2D = FakePath;
  const ctx = fakeCtx();
  const k = glyphTransform({ size: 345 }).k;
  drawGlyph(ctx, DATA, { color: '#C06D57', alpha: 0.4, outline: { color: '#C06D57', width: 4 }, halo: { color: '#6E655B', extra: 1 } });
  const kinds = ctx.calls.filter(c => c[0] === 'stroke' || c[0] === 'fill').map(c => `${c[0]}:${c[1]}`);
  assert.deepEqual(kinds, ['stroke:#6E655B', 'stroke:#6E655B', 'stroke:#C06D57', 'stroke:#C06D57', 'fill:#C06D57', 'fill:#C06D57'],
    'halo strokes → danzhu outline strokes → fills (the halo is underneath)');
  const halo = ctx.calls.find(c => c[0] === 'stroke' && c[1] === '#6E655B');
  const outline = ctx.calls.find(c => c[0] === 'stroke' && c[1] === '#C06D57');
  assert.ok(Math.abs(halo[2] - (4 + 2) / k) < 1e-9, 'halo line width = (4 + 2 × 1pt) / k');
  assert.ok(Math.abs(outline[2] - 4 / k) < 1e-9, 'the danzhu outline keeps its own width');
});

test('prefersMoreContrast reads the media query; false without a window or when matchMedia throws', () => {
  const saved = globalThis.window;
  try {
    delete globalThis.window;
    assert.equal(prefersMoreContrast(), false, 'no window');
    globalThis.window = { matchMedia: q => ({ matches: q === '(prefers-contrast: more)' }) };
    assert.equal(prefersMoreContrast(), true, 'more');
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    assert.equal(prefersMoreContrast(), false, 'no preference');
    globalThis.window = { matchMedia() { throw new Error('nope'); } };
    assert.equal(prefersMoreContrast(), false, 'throws → false');
  } finally {
    if (saved === undefined) delete globalThis.window;
    else globalThis.window = saved;
  }
});

test('the hint layer carries a constant 1pt ink3 outline under a solid danzhu fill — not only inside @media (prefers-contrast: more) (A2-02 / D51 ⑧)', () => {
  const src = readFileSync(new URL('../../src/ui/screens/write/hint-layer.js', import.meta.url), 'utf8');
  assert.ok(!/@media \(prefers-contrast: more\)\{\.sz-hint__stroke/.test(src), 'no contrast-only drop-shadow rule any more');
  const outline = /\.sz-hint__outline\{((?:\$\{[^}]*\}|[^}])*)\}/.exec(src);
  assert.ok(outline, 'an outline layer rule');
  assert.ok(outline[1].includes('fill:none') && outline[1].includes('stroke:${T.ink3}'), 'ink3 outline, no fill');
  assert.ok(/stroke-width:2px/.test(outline[1]) && /vector-effect:non-scaling-stroke/.test(outline[1]), '2px centred stroke = 1px visible outside, constant under any grid size');
  const fill = /\.sz-hint__stroke\{((?:\$\{[^}]*\}|[^}])*)\}/.exec(src);
  assert.ok(fill && fill[1].includes('fill:${T.danzhu}') && fill[1].includes('stroke:none'), 'solid danzhu fill (the token, not a polyline)');
  assert.ok(src.indexOf('${outlines}${paths}') > 0, 'outlines are painted first, fills on top, so neighbouring strokes leave no seam');
});
