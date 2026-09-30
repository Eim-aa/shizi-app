// core/ink-math.js：宽度关系（慢宽快细、压力替代速度、点画、单点、零 dt 合并、30ms 窗口插值、起收笔），
// 存储编码往返与抽点上限（01 §3.5、§6.2；决定-D09 / D10）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INK, INK_SPEC, INK_TUNABLE_KEYS, inkParams, GRID, buildStroke, speedFactor, pressureFactor, mergeSameTime, liftSpeed, catmullRom, thinStroke,
  strokeLength, encodeInk, decodeInk, isInkV2, resampleForReplay, encodeRawStrokes, decodeRawStrokes,
} from '../../src/core/ink-math.js';
import * as policy from '../../src/config/policy.js';
import { validateValue } from '../../src/core/schema.js';

const HZ120 = 1000 / 120;
const B = INK.base;

/** 匀速直线：从 (x0,y) 起向右 len 单位，速度 v（单位/ms），每 step ms 一个采样；可带固定压力 p。 */
function line({ x0 = 20, y = 170, len = 200, v = 0.3, step = HZ120, p, t0 = 1000 } = {}) {
  const T = len / v;
  const raw = [];
  for (let t = 0; t < T; t += step) {
    const q = { x: x0 + v * t, y, t: t0 + t };
    if (p !== undefined) q.p = p;
    raw.push(q);
  }
  const last = { x: x0 + len, y, t: t0 + T };
  if (p !== undefined) last.p = p;
  raw.push(last);
  return raw;
}

/** 取弧长在 [a, b] 区间内点的平均宽。 */
function meanWidthBetween(pts, a, b) {
  let s = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < pts.length; i += 1) {
    if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (s >= a && s <= b) {
      sum += pts[i].w;
      n += 1;
    }
  }
  assert.ok(n > 0, `no points between ${a} and ${b}`);
  return sum / n;
}

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

test('ink-math: body width = BASE × (1.06 − 0.12·min(v,1.5)); slow is wider than fast', () => {
  close(speedFactor(0), 1.06, 1e-12, 'v=0');
  close(speedFactor(1.5), 0.88, 1e-12, 'v=1.5');
  close(speedFactor(9), 0.88, 1e-12, 'v capped at 1.5');
  const slow = buildStroke(line({ v: 0.1 }), { final: true });
  const fast = buildStroke(line({ v: 1.2 }), { final: true });
  const wSlow = meanWidthBetween(slow, 80, 140);
  const wFast = meanWidthBetween(fast, 80, 140);
  assert.ok(wSlow > wFast, `slow ${wSlow} > fast ${wFast}`);
  close(wSlow, B * speedFactor(0.1), 0.15, 'slow mid-stroke settles on the body width');
  close(wFast, B * speedFactor(1.2), 0.15, 'fast mid-stroke settles on the body width');
});

test('ink-math: width smoothing is by time (α = 1 − e^(−Δt/35ms)), so 60Hz and 120Hz settle the same', () => {
  const at120 = buildStroke(line({ v: 1.0, step: HZ120 }), { final: true });
  const at60 = buildStroke(line({ v: 1.0, step: 1000 / 60 }), { final: true });
  close(meanWidthBetween(at120, 80, 140), meanWidthBetween(at60, 80, 140), 0.08, 'mid width independent of sample rate');
});

test('ink-math: pen pressure replaces the speed factor (D10, not multiplied)', () => {
  close(pressureFactor(1), 1.52, 1e-12, 'p=1');
  close(pressureFactor(0.25), 0.58 + 0.5 * 0.94, 1e-12, 'p=.25');
  close(pressureFactor(0), 0.58, 1e-12, 'p=0 floor');
  const slowPen = buildStroke(line({ v: 0.1, p: 0.25 }), { final: true });
  const fastPen = buildStroke(line({ v: 1.2, p: 0.25 }), { final: true });
  const a = meanWidthBetween(slowPen, 80, 140);
  const b = meanWidthBetween(fastPen, 80, 140);
  close(a, b, 0.05, 'same pressure → same width regardless of speed');
  close(a, B * pressureFactor(0.25), 0.05, 'pressure width = BASE × pressure factor (no speed factor multiplied in)');
  const heavy = buildStroke(line({ v: 1.2, p: 1 }), { final: true });
  assert.ok(meanWidthBetween(heavy, 80, 140) > a, 'more pressure → wider');
  assert.equal(slowPen.pressure, true);
  assert.ok(slowPen.every(pt => pt.p === 0.25), 'pressure survives Catmull-Rom resampling');
});

test('ink-math: start of stroke 0.85× → 1.08× → 1.0× over 0–6–12 units', () => {
  const pts = buildStroke(line({ v: 0.3 }), { final: true });
  close(pts[0].w / B, 0.85, 1e-9, 'first point 0.85 × body');
  let s = 0;
  let peak = 0;
  pts.forEach((pt, i) => {
    if (i > 0) s += Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y);
    if (s <= 12) peak = Math.max(peak, pt.w);
  });
  const after = meanWidthBetween(pts, 14, 30);
  assert.ok(peak > after, `bulge within the first 12 units (${peak}) > later body (${after})`);
  assert.ok(peak / after > 1.04 && peak / after < 1.09, `bulge ≈ 1.08× (${peak / after})`);
});

test('ink-math: lift taper follows the 30ms average speed (0.25 / 0.9 thresholds)', () => {
  const slow = buildStroke(line({ v: 0.2 }), { final: true });
  const fast = buildStroke(line({ v: 1.2 }), { final: true });
  close(slow.v30, 0.2, 1e-6, 'v30 slow');
  close(fast.v30, 1.2, 1e-6, 'v30 fast');
  assert.ok(slow.endK > 1, `v30 ≤ lo: no taper (endK ${slow.endK})`);
  assert.ok(fast.endK < 0.15, `v30 ≥ hi: tapers to ~0.12 (endK ${fast.endK})`);
  const live = buildStroke(line({ v: 1.2 }), { final: false });
  assert.equal(live.v30, null, 'no lift speed while writing');
  assert.ok(live.endK > fast.endK, 'taper only after lift (final=true)');
});

test('ink-math: 30ms window is interpolated to exactly 30ms (frame-rate independent)', () => {
  // 1 单位/ms 到 t=100，然后 0.2 单位/ms 走 20ms；采样每 20ms。窗口 [90,120]：20ms×0.2 + 10ms×1 = 14 → 14/30。
  const raw = [0, 20, 40, 60, 80, 100].map(t => ({ x: t, y: 0, t }));
  raw.push({ x: 104, y: 0, t: 120 });
  close(liftSpeed(mergeSameTime(raw)), 14 / 30, 1e-12, 'interpolated window');
  // 同样的运动按 5ms 采样，结果一样
  const dense = [];
  for (let t = 0; t <= 100; t += 5) dense.push({ x: t, y: 0, t });
  for (let t = 105; t <= 120; t += 5) dense.push({ x: 100 + (t - 100) * 0.2, y: 0, t });
  close(liftSpeed(mergeSameTime(dense)), 14 / 30, 1e-12, 'same motion at a different sample rate');
  // 整笔短于 30ms：用整段时长
  close(liftSpeed([{ x: 0, y: 0, t: 0 }, { x: 10, y: 0, t: 10 }]), 1, 1e-12, 'shorter than 30ms uses the whole duration');
});

test('ink-math: zero-dt samples merge (last position wins) and do not enter speed', () => {
  const raw = [
    { x: 10, y: 10, t: 0 },
    { x: 20, y: 10, t: 10 },
    { x: 21, y: 10, t: 10 },
    { x: 30, y: 10, t: 20 },
  ];
  const m = mergeSameTime(raw);
  assert.deepEqual(m, [{ x: 10, y: 10, t: 0 }, { x: 21, y: 10, t: 10 }, { x: 30, y: 10, t: 20 }]);
  const withDup = buildStroke(raw, { final: true });
  const without = buildStroke([raw[0], raw[2], raw[3]], { final: true });
  assert.deepEqual(withDup.map(p => [p.x, p.y, p.w]), without.map(p => [p.x, p.y, p.w]), 'identical output');
  // 全部同一时刻 → 单点
  const same = buildStroke([{ x: 1, y: 1, t: 5 }, { x: 2, y: 2, t: 5 }], { final: true });
  assert.equal(same.single, true);
  assert.deepEqual([same[0].x, same[0].y], [2, 2], 'keeps the last position');
});

test('ink-math: single point = 0.9 × body width; dot (<24 units, after lift) 0.7 → 1.1 → 0.9', () => {
  const one = buildStroke([{ x: 100, y: 100, t: 0 }], { final: true });
  assert.equal(one.length, 1);
  assert.equal(one.single, true);
  close(one[0].w, 0.9 * B, 1e-12, 'single point diameter');
  const shortRaw = line({ len: 12, v: 0.2 });
  const dot = buildStroke(shortRaw, { final: true });
  assert.equal(dot.dot, true);
  const bodyW = B * speedFactor(0.2); // 短划里本体宽由 BASE 平滑地趋近 BASE × speedFactor(.2)
  close(dot[0].w / B, 0.7, 1e-9, 'dot starts at 0.7 × body (first body width = BASE)');
  const maxRatio = Math.max(...dot.map(p => p.w)) / bodyW;
  assert.ok(maxRatio > 1.05 && maxRatio < 1.15, `dot peaks near 1.1 × body (${maxRatio})`);
  close(dot[dot.length - 1].w / bodyW, 0.9, 0.05, 'dot ends near 0.9 × body');
  const live = buildStroke(shortRaw, { final: false });
  assert.equal(live.dot, false, 'dot is decided only after lift');
  assert.equal(buildStroke(line({ len: 40 }), { final: true }).dot, false, '≥ 24 units is not a dot');
});

test('ink-math: Catmull-Rom resamples about every 3 units and keeps the end point', () => {
  const pts = catmullRom([{ x: 0, y: 0, t: 0 }, { x: 30, y: 0, t: 30 }, { x: 60, y: 0, t: 60 }]);
  assert.ok(pts.length >= 21, `~3 units per point (${pts.length})`);
  assert.deepEqual(pts[pts.length - 1], { x: 60, y: 0, t: 60 });
  for (let i = 1; i < pts.length; i += 1) assert.ok(pts[i].t >= pts[i - 1].t, 't is monotone');
  assert.equal(buildStroke([], { final: true }).length, 0, 'empty input → no points');
});

test('ink-math: thinning keeps ≤ inkMaxPointsPerStroke points by arc length, first and last kept', () => {
  assert.equal(policy.inkMaxPointsPerStroke, 32);
  assert.equal(policy.inkMaxStrokes, 36);
  const pts = buildStroke(line({ len: 300, v: 0.05 }), { final: true });
  assert.ok(pts.length > 32, `fixture is long (${pts.length})`);
  const thin = thinStroke(pts);
  assert.ok(thin.length <= 32 && thin.length >= 30, `≤ 32 points (${thin.length})`);
  assert.deepEqual(thin[0], pts[0]);
  assert.deepEqual(thin[thin.length - 1], pts[pts.length - 1]);
  close(strokeLength(thin), strokeLength(pts), 0.5, 'straight line keeps its length');
  assert.equal(thinStroke(pts.slice(0, 5)).length, 5, 'short strokes untouched');
  assert.equal(thinStroke(pts, 8).length, 8, 'custom cap');
});

test('ink-math: encodeInk → InkV2 → decodeInk round trip (345 space, ints, schema-valid)', () => {
  const strokes = [
    buildStroke(line({ x0: 30, y: 60, len: 120, v: 0.4 }), { final: true }),
    buildStroke(line({ x0: 60, y: 200, len: 80, v: 0.9, t0: 3000 }), { final: true }),
    buildStroke([{ x: 172.5, y: 300, t: 5000 }], { final: true }),
  ];
  const ink = encodeInk(strokes);
  assert.equal(ink.v, 2);
  assert.equal(ink.c, GRID);
  assert.equal(ink.s.length, 3);
  assert.equal(ink.p, undefined, 'no p row without pen pressure');
  assert.ok(isInkV2(ink));
  assert.ok(ink.s.every(row => row.every(Number.isInteger)) && ink.dt.every(row => row.every(Number.isInteger)));
  assert.equal(validateValue('shizi.v2.ink.2026-09', { r12: ink }), null, 'passes core/schema.js ink shape');
  assert.equal(ink.dt[0][0], 0, 'first point dt = 0');
  assert.ok(ink.dt[1][0] > 1000, 'second stroke starts with the gap since the first stroke ended');
  const back = decodeInk(ink);
  assert.equal(back.length, 3);
  for (let si = 0; si < 3; si += 1) {
    const thin = thinStroke(strokes[si]);
    assert.equal(back[si].length, thin.length);
    back[si].forEach((pt, i) => {
      close(pt.x, thin[i].x, (GRID / 1000) / 2 + 1e-9, `x s${si}p${i}`);
      close(pt.y, thin[i].y, (GRID / 1000) / 2 + 1e-9, `y s${si}p${i}`);
      close(pt.w, thin[i].w, B * 0.005 + 1e-9, `w s${si}p${i}`);
      close(pt.t - back[0][0].t, thin[i].t - strokes[0][0].t, 1, `t s${si}p${i}`);
    });
  }
  // 再编码稳定（整数网格上的不动点）
  assert.deepEqual(encodeInk(back), ink);
  // 回放：再走一次 Catmull-Rom，端点不变
  const replay = resampleForReplay(back);
  assert.deepEqual([replay[0][0].x, replay[0][0].y], [back[0][0].x, back[0][0].y]);
  assert.ok(replay[0].every(pt => Number.isFinite(pt.w)), 'w interpolated for replay');
  assert.equal(decodeInk({ v: 1, c: 345, s: [] }), null, 'wrong version → null');
  assert.equal(decodeInk({ v: 2, c: 345, s: [[1, 2]] }), null, 'row not a multiple of 3 → null');
});

test('ink-math: pen pressure survives encoding (p row ×100, only when present)', () => {
  const pen = buildStroke(line({ len: 100, v: 0.5, p: 0.42 }), { final: true });
  const ink = encodeInk([pen]);
  assert.ok(Array.isArray(ink.p) && ink.p[0].every(x => x === 42));
  assert.equal(validateValue('shizi.v2.ink.2026-09', { r3: ink }), null);
  const back = decodeInk(ink);
  assert.ok(back[0].every(pt => pt.p === 0.42));
});

test('ink-math: encodeInk caps strokes at inkMaxStrokes and points at inkMaxPointsPerStroke', () => {
  const many = [];
  for (let i = 0; i < 50; i += 1) many.push(buildStroke(line({ y: 5 + i * 6, len: 250, v: 0.05, t0: i * 10000 }), { final: true }));
  const ink = encodeInk(many);
  assert.equal(ink.s.length, policy.inkMaxStrokes, '≤ 36 strokes (first 36 kept)');
  assert.ok(ink.s.every(row => row.length / 3 <= policy.inkMaxPointsPerStroke), '≤ 32 points per stroke');
  assert.equal(ink.s[0][1], Math.round((5 / GRID) * 1000), 'first stroke kept first');
  const custom = encodeInk(many, { maxStrokes: 4, maxPoints: 10 });
  assert.equal(custom.s.length, 4);
  assert.ok(custom.s.every(row => row.length / 3 <= 10));
  const bytes = JSON.stringify(ink).length * 2;
  assert.ok(bytes < 64 * 1024, `36×32 ink stays compact (${bytes} B)`);
});

test('ink-math: raw session strokes encode losslessly enough to rebuild the same ink', () => {
  const raws = [line({ len: 90, v: 0.35 }), line({ len: 50, v: 0.6, p: 0.3, t0: 4000 })];
  const rows = encodeRawStrokes(raws);
  assert.equal(rows[0][0], 3);
  assert.equal(rows[1][0], 4);
  assert.ok(rows.every(r => r.every(Number.isInteger)));
  const back = decodeRawStrokes(rows);
  assert.equal(back.length, 2);
  back.forEach((s, i) => {
    assert.equal(s.length, raws[i].length);
    s.forEach((pt, j) => {
      close(pt.x, raws[i][j].x, 0.05 + 1e-9, 'x');
      close(pt.t, raws[i][j].t - raws[i][0].t, 0.5 + 1e-9, 't');
    });
  });
  assert.ok(back[1].every(pt => Math.abs(pt.p - 0.3) < 1e-9));
  const a = buildStroke(raws[0], { final: true });
  const b = buildStroke(back[0], { final: true });
  close(a[a.length - 1].w, b[b.length - 1].w, 0.05, 'rebuilt end width matches');
  close(meanWidthBetween(a, 30, 60), meanWidthBetween(b, 30, 60), 0.05, 'rebuilt body width matches');
  assert.deepEqual(decodeRawStrokes([[5, 1, 2, 3], 'x', [3, 1, 2]]), [], 'bad rows skipped');
});

test('ink-math: hand-feel constants come from policy.ink (P65); decided spec stays in INK_SPEC', () => {
  assert.deepEqual(
    { base: policy.ink.base, lo: policy.ink.lo, hi: policy.ink.hi, pLo: policy.ink.pressureLo, pGain: policy.ink.pressureGain, pHi: policy.ink.pressureHi },
    { base: 11.5, lo: 0.25, hi: 0.9, pLo: 0.58, pGain: 0.94, pHi: 1.52 },
    'P65 transitional values (沿旧版 / 原型)',
  );
  for (const key of INK_TUNABLE_KEYS) assert.equal(INK[key], policy.ink[key], `INK.${key} reads policy.ink.${key}`);
  assert.deepEqual(Object.keys(policy.ink).sort(), [...INK_TUNABLE_KEYS].sort(), 'policy.ink holds exactly the tunable keys');
  assert.deepEqual(INK_SPEC, { speedCap: 1.5, tau: 35, window: 30, dotLen: 24, single: 0.9 });
  for (const key of Object.keys(INK_SPEC)) assert.equal(key in policy.ink, false, `${key} is decided spec, not a policy key`);
  assert.equal(pressureFactor(1), 1.52);
  assert.equal(pressureFactor(0), 0.58);
});

test('ink-math: policy.ink can be injected (opts.policy) and single keys overridden (opts.base / lo / hi …)', () => {
  const raw = line({ v: 0.3 });
  const def = buildStroke(raw, { final: true });
  const wide = { ...policy, ink: { ...policy.ink, base: 23 } };
  const injected = buildStroke(raw, { final: true, policy: wide });
  const overridden = buildStroke(raw, { final: true, base: 23 });
  const mid = pts => pts[Math.floor(pts.length / 2)].w;
  assert.ok(Math.abs(mid(injected) / mid(def) - 2) < 0.01, 'injected base 23 doubles the body width');
  assert.ok(Math.abs(mid(overridden) - mid(injected)) < 1e-9, 'opts.base overrides the same way');
  const sparse = line({ v: 0.3, step: 50 }); // 采样相距 15 单位：step 3 → 每段 5 点，step 9 → 每段 2 点
  const fine = buildStroke(sparse, { final: true });
  const coarse = buildStroke(sparse, { final: true, step: 9 });
  assert.ok(coarse.length < fine.length * 0.6, `opts.step (P65) coarsens the resampling (${coarse.length} vs ${fine.length})`);
  const slowTaper = buildStroke(line({ v: 0.6 }), { final: true, hi: 5 });
  const fastTaper = buildStroke(line({ v: 0.6 }), { final: true });
  assert.ok(slowTaper[slowTaper.length - 1].w > fastTaper[fastTaper.length - 1].w, 'opts.hi changes the lift taper');
  assert.equal(inkParams(wide).base, 23);
  assert.throws(() => inkParams({ ...policy, ink: { ...policy.ink, lo: undefined } }), /policy\.ink\.lo/);
  assert.throws(() => inkParams({}), /policy\.ink/);
  const ink = encodeInk([def], { policy: wide });
  assert.ok(Math.abs(decodeInk(ink, { policy: wide })[0][0].w - def[0].w) < 0.2, 'encode / decode use the injected base for w');
});
