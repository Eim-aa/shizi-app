// 描一遍整字一次合成与笔顺快放 ≤ 1.6s（W1，D51 ⑧；V2-02 / I2-02）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEP_PLAY_MAX_MS } from '../../src/ui/screens/write/answer.js';
import { playbackPlan, drawGlyphSolid, drawGlyphRing, RING_OUTER_UNITS, TRACE_FILL_ALPHA } from '../../src/ui/canvas/glyph.js';
import * as policy from '../../src/config/policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------- 笔顺快放 ≤ 1.6s

const line = (len, n = 4) => Array.from({ length: n }, (_, i) => [(len * i) / (n - 1), 0]);
const dataOf = (n, len) => ({ strokes: Array.from({ length: n }, () => 'M0 0L1 1Z'), medians: Array.from({ length: n }, () => line(len)) });
/** hanzi-writer 总时长 = 起始淡化 + Σ (长度 + 600) ÷ (3 × speed) + 笔间隔 × (n − 1)。 */
const hanziTotal = (d, p) => p.fade + d.medians.reduce((a, m) => a + (m[m.length - 1][0] - m[0][0] + 600) / (3 * p.speed), 0) + p.delay * (d.medians.length - 1);

test('playbackPlan：笔顺快放总时长 ≤ 1.6s（13 笔、长笔、1 笔、30 笔都一样）；缺省节奏本来就够快的不动', () => {
  assert.equal(STEP_PLAY_MAX_MS, 1600);
  assert.equal(STEP_PLAY_MAX_MS, policy.motion.stepPlayMaxMs);
  for (const [n, len] of [[13, 300], [13, 900], [30, 600], [8, 500], [1, 400]]) {
    const d = dataOf(n, len);
    const p = playbackPlan(d, { maxMs: STEP_PLAY_MAX_MS });
    assert.ok(hanziTotal(d, p) <= STEP_PLAY_MAX_MS, `n=${n} len=${len}: ${Math.round(hanziTotal(d, p))}ms ≤ 1600 (plan says ${p.estimatedMs})`);
    assert.ok(p.estimatedMs <= STEP_PLAY_MAX_MS);
    assert.ok(p.speed >= policy.motion.answerSpeed, 'speed only goes up');
  }
  // 旧节奏下 13 笔字要 4 秒以上（审查 I2-02：「答案逐笔播 4–8s」）
  const d13 = dataOf(13, 300);
  assert.ok(hanziTotal(d13, { speed: 1.6, delay: 180, fade: 240 }) > 4000, 'old pacing was > 4s');
  // 单笔短字：不需要提速，保持缺省 speed
  const one = playbackPlan(dataOf(1, 100), { maxMs: STEP_PLAY_MAX_MS });
  assert.equal(one.speed, policy.motion.answerSpeed);
  // 不给 maxMs 就是旧节奏
  assert.deepEqual({ speed: 1.6, delay: 180, fade: 240 }, (({ speed, delay, fade }) => ({ speed, delay, fade }))(playbackPlan(d13, {})));
});

// ---------------------------------------------------------------- 描一遍整字一次合成

class FakePath { constructor(d) { this.d = d; } }

function fakeCtx() {
  const calls = [];
  const ctx = {
    calls, globalAlpha: 1, globalCompositeOperation: 'source-over', strokeStyle: '', fillStyle: '', lineWidth: 0, lineJoin: '',
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); }, translate() {}, scale() {},
    stroke(p) { calls.push(['stroke', ctx.strokeStyle, ctx.lineWidth, ctx.globalCompositeOperation, p.d]); },
    fill(p) { calls.push(['fill', ctx.fillStyle, ctx.globalAlpha, ctx.globalCompositeOperation, p.d]); },
  };
  return ctx;
}
const GLYPH = { strokes: ['M0 0', 'M1 1', 'M2 2'] };

test('drawGlyphSolid：每笔只填色、同一种不透明颜色、不描边、不改 globalAlpha（交叠处不叠色，透明度由画布整体给）', () => {
  globalThis.Path2D = FakePath;
  const ctx = fakeCtx();
  assert.equal(drawGlyphSolid(ctx, GLYPH, { color: '#C06D57' }), true);
  const ops = ctx.calls.filter(c => c[0] === 'stroke' || c[0] === 'fill');
  assert.deepEqual(ops.map(c => c[0]), ['fill', 'fill', 'fill'], 'no per-stroke outline');
  assert.ok(ops.every(c => c[1] === '#C06D57' && c[2] === 1 && c[3] === 'source-over'), 'one opaque colour, normal compositing');
  assert.equal(TRACE_FILL_ALPHA, 0.4, 'the whole layer (canvas element) carries the 0.4');
});

test('drawGlyphRing：先描边、再用 destination-out 擦掉字形本身，只留外侧一圈（交叠处的内部边不描）；增强对比度的 halo 在最底层', () => {
  globalThis.Path2D = FakePath;
  const ctx = fakeCtx();
  drawGlyphRing(ctx, GLYPH, { color: '#C06D57', halo: { color: '#6E655B', extra: 1 } });
  const ops = ctx.calls.filter(c => c[0] === 'stroke' || c[0] === 'fill');
  assert.deepEqual(ops.map(c => `${c[0]}:${c[1]}:${c[3]}`), [
    'stroke:#6E655B:source-over', 'stroke:#6E655B:source-over', 'stroke:#6E655B:source-over',
    'stroke:#C06D57:source-over', 'stroke:#C06D57:source-over', 'stroke:#C06D57:source-over',
    'fill:#000:destination-out', 'fill:#000:destination-out', 'fill:#000:destination-out',
  ]);
  const halo = ops[0];
  const ring = ops[3];
  assert.ok(halo[2] > ring[2], 'the halo band is wider than the danzhu ring');
  assert.ok(RING_OUTER_UNITS > 0);
  const plain = fakeCtx();
  drawGlyphRing(plain, GLYPH, { color: '#C06D57' });
  assert.deepEqual(plain.calls.filter(c => c[0] === 'stroke').map(c => c[1]), ['#C06D57', '#C06D57', '#C06D57'], 'no halo by default');
  assert.equal(drawGlyphRing(plain, { strokes: [] }, {}), false);
});

test('描一遍层的源码约束：整字合成（不再逐笔 drawGlyph + outline），与提示同一个 GlyphWash', () => {
  const wash = fs.readFileSync(path.join(ROOT, 'src/ui/canvas/glyph-wash.js'), 'utf8');
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/screens/write/answer.js'), 'utf8');
  assert.ok(wash.includes('drawGlyphSolid(') && wash.includes('drawGlyphRing('), 'GlyphWash uses the unified composite');
  assert.ok(src.includes('<${GlyphWash}'), 'TraceLayer renders the shared wash');
  assert.ok(!/outline:\s*\{[^}]*danzhu/.test(src), 'no per-stroke danzhu outline on the trace');
  assert.equal(STEP_PLAY_MAX_MS, policy.motion.stepPlayMaxMs);
});
