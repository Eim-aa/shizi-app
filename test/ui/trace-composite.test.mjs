// 帮助层（提示 / 描一遍）的整层实填 + 双钩画法（D53 ①，第三轮 V3-01 / T3-02）与笔顺快放 ≤ 1.6s（W1，D51 ⑧；V2-02 / I2-02）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEP_PLAY_MAX_MS, traceSplit, tracePreviewed, markTracePreviewed, forgetTracePreviewed } from '../../src/ui/screens/write/answer.js';
import { playbackPlan, drawGlyphSolid, drawGlyphHook, strokeIndexList, glyphTransform, HOOK_WIDTH_PT } from '../../src/ui/canvas/glyph.js';
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
  assert.deepEqual({ speed: 1.6, delay: 180, fade: 220 }, (({ speed, delay, fade }) => ({ speed, delay, fade }))(playbackPlan(d13, {})), 'D58: the fade is motion.duration.release (was 240)');
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

test('drawGlyphSolid：给出的笔画只填色、同一种不透明颜色、不描边、不改 globalAlpha（交叠处不叠色）；可按笔序号列表或 [from, to) 给笔', () => {
  globalThis.Path2D = FakePath;
  const ctx = fakeCtx();
  assert.equal(drawGlyphSolid(ctx, GLYPH, { color: '#C06D57' }), true);
  const ops = ctx.calls.filter(c => c[0] === 'stroke' || c[0] === 'fill');
  assert.deepEqual(ops.map(c => c[0]), ['fill', 'fill', 'fill'], 'no per-stroke outline');
  assert.ok(ops.every(c => c[1] === '#C06D57' && c[2] === 1 && c[3] === 'source-over'), 'one opaque colour, normal compositing');
  const some = fakeCtx();
  drawGlyphSolid(some, GLYPH, { color: '#C06D57', strokes: [2, 0, 2, 9, -1] });
  assert.deepEqual(some.calls.filter(c => c[0] === 'fill').map(c => c[4]), ['M0 0', 'M2 2'], 'strokes: sorted, deduped, out-of-range dropped');
  const range = fakeCtx();
  drawGlyphSolid(range, GLYPH, { color: '#C06D57', from: 1, to: 3 });
  assert.deepEqual(range.calls.filter(c => c[0] === 'fill').map(c => c[4]), ['M1 1', 'M2 2']);
  assert.equal(drawGlyphSolid(fakeCtx(), GLYPH, { strokes: [] }), false, 'nothing to draw');
  assert.deepEqual(strokeIndexList(GLYPH, { from: 1 }), [1, 2]);
});

test('drawGlyphHook：双钩只描细轮廓、不填色、同一个色相；线宽按单位换算，不碰 globalAlpha', () => {
  globalThis.Path2D = FakePath;
  const ctx = fakeCtx();
  assert.equal(drawGlyphHook(ctx, GLYPH, { color: '#C06D57', width: 0.75, strokes: [1, 2] }), true);
  const ops = ctx.calls.filter(c => c[0] === 'stroke' || c[0] === 'fill');
  assert.deepEqual(ops.map(c => `${c[0]}:${c[1]}:${c[4]}`), ['stroke:#C06D57:M1 1', 'stroke:#C06D57:M2 2'], 'only strokes, same hue, no fill');
  assert.ok(ops.every(c => c[3] === 'source-over'), 'no destination-out ring trick any more');
  assert.ok(Math.abs(ops[0][2] - 0.75 / glyphTransform({ size: 345 }).k) < 1e-9, 'line width = width / k (the glyph transform scale)');
  assert.equal(HOOK_WIDTH_PT, 0.75);
  assert.equal(drawGlyphHook(fakeCtx(), GLYPH, { strokes: [] }), false);
});

test('traceSplit：描一遍当前一笔实心、其余双钩、已描过的笔不画；全部写完什么都不画；撤销退回', () => {
  assert.deepEqual(traceSplit(4, 0), { solid: [0], hook: [1, 2, 3] });
  assert.deepEqual(traceSplit(4, 1), { solid: [1], hook: [2, 3] }, 'stroke 0 is covered by the own ink, not drawn');
  assert.deepEqual(traceSplit(4, 3), { solid: [3], hook: [] });
  assert.deepEqual(traceSplit(4, 4), { solid: [], hook: [] }, 'all traced');
  assert.deepEqual(traceSplit(4, 9), { solid: [], hook: [] });
  assert.deepEqual(traceSplit(4, 2), { solid: [2], hook: [3] }, 'undo one stroke (3 → 2) comes back to the same state as before');
  assert.deepEqual(traceSplit(0, 0), { solid: [], hook: [] });
  assert.deepEqual(traceSplit(3, -1), { solid: [0], hook: [1, 2] });
});

test('描一遍层的源码约束：与提示同一个 GlyphWash（实填 + 双钩），不再逐笔 drawGlyph + outline，也没有 ring', () => {
  const wash = fs.readFileSync(path.join(ROOT, 'src/ui/canvas/glyph-wash.js'), 'utf8');
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/screens/write/answer.js'), 'utf8');
  assert.ok(wash.includes('drawGlyphSolid(') && wash.includes('drawGlyphHook('), 'GlyphWash uses the unified composite');
  assert.ok(!wash.includes('drawGlyphRing'), 'no ring');
  assert.ok(src.includes('<${GlyphWash}'), 'TraceLayer renders the shared wash');
  assert.ok(!/outline:\s*\{[^}]*danzhu/.test(src), 'no per-stroke danzhu outline on the trace');
  assert.equal(STEP_PLAY_MAX_MS, policy.motion.stepPlayMaxMs);
});

test('描一遍前的笔顺快放每字只在第一次播（I3-07）：按会话 id + 字记；播过的再进直接是终态；只在页面会话里记', () => {
  forgetTracePreviewed();
  const key = 's1|base:永';
  assert.equal(tracePreviewed(key), false, 'a fresh entry plays');
  markTracePreviewed(key);
  assert.equal(tracePreviewed(key), true, 'the same character in the same session does not replay');
  assert.equal(tracePreviewed('s1|base:和'), false, 'another character still plays');
  assert.equal(tracePreviewed('s2|base:永'), false, 'the same character in another session is a new first time');
  assert.equal(tracePreviewed(null), false);
  markTracePreviewed(null);
  forgetTracePreviewed();
  assert.equal(tracePreviewed(key), false);
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/screens/write/answer.js'), 'utf8');
  assert.ok(src.includes('markTracePreviewed(playKey)') && src.includes('tracePreviewed(playKey)'), 'TraceLayer consults the played set before animating');
  assert.ok(!/先播一遍（每次进描一遍一次）/.test(src), 'the every-entry replay is gone');
});
