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

test('the hint layer is drawn with the same wash as the trace layer: opaque danzhu fill (+ hairline hooks on the trace), no ink3 ring, no separate SVG outline rules (D53 ①)', () => {
  const hint = readFileSync(new URL('../../src/ui/screens/write/hint-layer.js', import.meta.url), 'utf8');
  const trace = readFileSync(new URL('../../src/ui/screens/write/answer.js', import.meta.url), 'utf8');
  const wash = readFileSync(new URL('../../src/ui/canvas/glyph-wash.js', import.meta.url), 'utf8');
  assert.ok(hint.includes('<${GlyphWash}') && trace.includes('<${GlyphWash}'), 'hint layer and trace layer both use GlyphWash');
  assert.ok(!/sz-hint__outline|sz-hint__stroke|drop-shadow/.test(hint), 'no SVG outline / drop-shadow rules left in the hint layer');
  assert.ok(wash.includes("glyphColor('--danzhu')") && !/glyphColor\('--ink3'\)/.test(wash), 'danzhu only');
  assert.ok(wash.includes('prefersMoreContrast()') && wash.includes('HOOK_WIDTH_MORE_CONTRAST_PT'), 'increase-contrast thickens the hook lines (P153)');
  assert.ok(!/drawGlyph(Solid|Hook)\(/.test(hint + trace), 'only glyph-wash.js calls the two drawing functions');
});
