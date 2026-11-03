// 生成 vectors.json：金标准测试向量（规格 §8）。
//
// 输入点由「中线 + 速度关键帧 + 停顿 + 采样率 + 抖动」合成（固定种子，可复现），写成 {x, y, t, p?} 原始点。
// 期望值**不调用参考实现**：用规格里的闭式公式（F_v、F_dir、F_p、阶段因子）按合成时的名义速度 / 方向算出中心值，
// 再给容差区间；结构性断言（端帽、钩、点画、单点、折）直接按规格条文写。
// 用法：node gen-vectors.mjs   → 覆盖写 vectors.json
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- 规格闭式（与规格 §3 文字一致，故意不 import reference.mjs）
const SPEC = {
  B: 13, vMin: 0.62, vK: 0.55, cap: 1.5, dirAngle: -25, dirH: 0.72, dirV: 1.12, dirMin: 0.5,
  pLo: 0.42, pGain: 0.92, pHi: 1.38, lo: 0.25, hi: 0.9, single: 0.9, endFast: 0.12, stopPeak: 1.2,
};
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const Fv = v => 1 - (1 - SPEC.vMin) * (1 - Math.exp(-clamp(v, 0, SPEC.cap) / SPEC.vK));
const sh = Math.abs(Math.sin(-SPEC.dirAngle * DEG));
const sv = Math.abs(Math.sin((90 - SPEC.dirAngle) * DEG));
const dirB = (SPEC.dirV - SPEC.dirH) / (sv - sh);
const dirA = SPEC.dirH - dirB * sh;
const Fdir = thDeg => Math.max(SPEC.dirMin, dirA + dirB * Math.abs(Math.sin((thDeg - SPEC.dirAngle) * DEG)));
const Fp = p => clamp(SPEC.pLo + Math.sqrt(clamp(p, 0, 1)) * SPEC.pGain, SPEC.pLo, SPEC.pHi);
const r3 = x => Math.round(x * 1000) / 1000;
const band = (c, tol) => [r3(c * (1 - tol)), r3(c * (1 + tol))];

// ---------------------------------------------------------------- 随机（mulberry32）
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(1e-9, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}

// ---------------------------------------------------------------- 路径
/** pieces: ['M',x,y] ['L',x,y] ['Q',cx,cy,x,y] ['C',c1x,c1y,c2x,c2y,x,y] → 稠密折线 + 弧长 + 各段终点弧长 knots */
function path(pieces) {
  const pts = [];
  const knots = [0];
  let cur = null;
  const push = p => pts.push(p);
  for (const pc of pieces) {
    const [op, ...a] = pc;
    if (op === 'M') {
      cur = [a[0], a[1]];
      push(cur);
      continue;
    }
    const N = 400;
    for (let i = 1; i <= N; i += 1) {
      const u = i / N;
      let p;
      if (op === 'L') p = [cur[0] + (a[0] - cur[0]) * u, cur[1] + (a[1] - cur[1]) * u];
      else if (op === 'Q') {
        const v = 1 - u;
        p = [v * v * cur[0] + 2 * v * u * a[0] + u * u * a[2], v * v * cur[1] + 2 * v * u * a[1] + u * u * a[3]];
      } else if (op === 'C') {
        const v = 1 - u;
        p = [
          v * v * v * cur[0] + 3 * v * v * u * a[0] + 3 * v * u * u * a[2] + u * u * u * a[4],
          v * v * v * cur[1] + 3 * v * v * u * a[1] + 3 * v * u * u * a[3] + u * u * u * a[5],
        ];
      }
      push(p);
    }
    cur = pts[pts.length - 1];
    knots.push(null); // 稍后填
    knots[knots.length - 1] = pts.length - 1;
  }
  const S = [0];
  for (let i = 1; i < pts.length; i += 1) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = S[S.length - 1];
  const knotS = knots.map(i => S[i]);
  const at = s => {
    const ss = clamp(s, 0, len);
    let lo = 0;
    let hi = S.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= ss) lo = mid;
      else hi = mid;
    }
    const u = (ss - S[lo]) / Math.max(1e-12, S[hi] - S[lo]);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * u, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * u];
  };
  const dirAt = s => {
    const a = at(s - 1);
    const b = at(s + 1);
    return Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG;
  };
  return { pts, S, len, knotS, at, dirAt };
}

const kf = (frames, u) => {
  if (u <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i += 1) {
    if (u <= frames[i][0]) {
      const [u0, v0] = frames[i - 1];
      const [u1, v1] = frames[i];
      return v0 + ((v1 - v0) * (u - u0)) / Math.max(1e-12, u1 - u0);
    }
  }
  return frames[frames.length - 1][1];
};

/**
 * 合成一笔原始点。
 * speed: [[u, v(单位/ms)], …]；dwell: [{u, ms}]；pressure: [[u, p], …]；hz；jitter（位置高斯 σ，单位）；tJitter（时间抖动 ms）
 */
function synth(P, { speed, dwell = [], pressure = null, hz = 120, seed = 1, jitter = 0.12, tJitter = 0.15, t0 = 1000, phase = 0 }) {
  // 时间—弧长表（Δs = 0.05）
  const ds = 0.05;
  const ts = [0];
  const ss = [0];
  let t = 0;
  const dw = dwell.map(d => ({ s: d.u * P.len, ms: d.ms, done: false })).sort((a, b) => a.s - b.s);
  for (let s = ds; s <= P.len + 1e-9; s += ds) {
    const v = kf(speed, (s - ds / 2) / P.len);
    t += ds / v;
    ts.push(t);
    ss.push(s);
    for (const d of dw) {
      if (!d.done && s >= d.s) {
        t += d.ms;
        ts.push(t);
        ss.push(s);
        d.done = true;
      }
    }
  }
  const T = ts[ts.length - 1];
  const sOfT = tt => {
    let lo = 0;
    let hi = ts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= tt) lo = mid;
      else hi = mid;
    }
    const u = (tt - ts[lo]) / Math.max(1e-12, ts[hi] - ts[lo]);
    return ss[lo] + (ss[hi] - ss[lo]) * u;
  };
  const R = rng(seed);
  const period = 1000 / hz;
  const times = [0];
  for (let k = 1; ; k += 1) {
    const tt = k * period + phase + (R.next() - 0.5) * 2 * tJitter;
    if (tt >= T - 0.5) break;
    times.push(tt);
  }
  times.push(T);
  return times.map((tt, i) => {
    const s = sOfT(tt);
    const [x, y] = P.at(s);
    const j = i === 0 ? 0 : jitter;
    const q = { x: r3(x + R.gauss() * j), y: r3(y + R.gauss() * j), t: Math.round((t0 + tt) * 1000) / 1000 };
    if (pressure) q.p = r3(clamp(kf(pressure, s / P.len) + R.gauss() * 0.004, 0.001, 1));
    return q;
  });
}

/** 名义 v30（合成速度表在抬笔前 30ms 的平均） */
function nominalV30(P, speed) {
  // 从末端往回积 30ms
  let t = 0;
  let s = P.len;
  const ds = 0.05;
  while (t < 30 && s > 0) {
    const v = kf(speed, s / P.len);
    t += ds / v;
    s -= ds;
  }
  return (P.len - s) / Math.max(t, 1e-9);
}

/** 名义收笔：v30 区间、kk、endRel（末端宽 / 末端本体宽 = lerp(stopPeak, endFast, kk)）与端帽类型。 */
function exitExpect(P, speed) {
  const v30 = nominalV30(P, speed);
  const kk = clamp((v30 - SPEC.lo) / (SPEC.hi - SPEC.lo), 0, 1);
  const endRel = SPEC.stopPeak + (SPEC.endFast - SPEC.stopPeak) * kk;
  return {
    v30: [r3(v30 * 0.85), r3(v30 * 1.15)],
    endRel: [r3(Math.max(0, endRel - 0.1)), r3(endRel + 0.1)],
    end: endRel >= 0.5 ? 'round' : 'taper',
    kk,
  };
}

/** 名义宽度 w/B（行笔段，阶段因子 = 1）：F_v(名义 v) × F_dir(名义方向)。 */
const bodyRel = (P, speed, u) => Fv(kf(speed, u)) * Fdir(P.dirAt(u * P.len));

/** 名义面积：∫ B·F_v·F_dir·收笔因子 ds + 末端半圆（不含起笔延伸与转角楔）。 */
function nominalArea(P, speed, { exit = 'auto', pressure = null } = {}) {
  const v30 = nominalV30(P, speed);
  const kk = clamp((v30 - SPEC.lo) / (SPEC.hi - SPEC.lo), 0, 1);
  const Lt = Math.min(0.4 * P.len, 20 + 14 * kk);
  let A = 0;
  let wEnd = 0;
  for (let s = 0.5; s < P.len; s += 1) {
    const u = s / P.len;
    const fb = pressure ? Fp(kf(pressure, u)) : Fv(kf(speed, u));
    let w = SPEC.B * fb * Fdir(P.dirAt(s));
    const d = P.len - s;
    const slow = d < 7 ? 1 + (SPEC.stopPeak - 1) * (1 - d / 7) : 1;
    const fast = d < Lt ? SPEC.endFast + (1 - SPEC.endFast) * Math.pow(d / Lt, 0.6) : 1;
    if (exit !== 'none') w *= slow + (fast - slow) * kk;
    A += w;
    wEnd = w;
  }
  return A + (Math.PI * (wEnd / 2) ** 2) / 2;
}

// ---------------------------------------------------------------- 向量
const vectors = [];
const add = v => vectors.push(v);

// V01 慢横（含零时间差重复点，D09 合并）
{
  const P = path([['M', 70, 150], ['L', 275, 144]]);
  const speed = [[0, 0.12], [0.08, 0.22], [0.85, 0.2], [1, 0.07]];
  const pts = synth(P, { speed, hz: 120, seed: 11 });
  // 插入 3 个零时间差重复（同 t、位置略不同：合并后留最后一个）
  const withDup = [];
  pts.forEach((q, i) => {
    if (i === 10 || i === 40 || i === 80) withDup.push({ x: r3(q.x - 0.6), y: r3(q.y + 0.4), t: q.t });
    withDup.push(q);
  });
  add({
    id: 'V01-heng-slow', name: '慢横（120Hz，含零时间差重复点）', input: { hz: 120, device: 'finger' }, points: withDup,
    expect: {
      single: false, dot: false, hook: false, corners: [0, 0], caps: { start: 'cut', end: 'round' },
      widths: [0.3, 0.5, 0.7].map(u => ({ u, wRel: band(bodyRel(P, speed, u), 0.12) })),
      endRel: [0.95, 1.35], v30: [0, SPEC.lo], feibai: false, blooms: [1, 3],
      area: band(nominalArea(P, speed), 0.12),
      note: '横细：F_dir(≈−1.7°)≈0.70；慢收顿圆，末端 ≈1.2× 本体；慢收带一处洇墨',
    },
  });
}

// V02 快横（出锋 + 飞白）
{
  const P = path([['M', 70, 150], ['L', 275, 144]]);
  const speed = [[0, 0.5], [0.1, 0.95], [1, 1.0]];
  add({
    id: 'V02-heng-fast', name: '快横（120Hz，快收出锋）', input: { hz: 120, device: 'finger' }, points: synth(P, { speed, hz: 120, seed: 12 }),
    expect: {
      single: false, dot: false, hook: false, corners: [0, 0], caps: { start: 'cut', end: 'taper' },
      widths: [0.3, 0.5].map(u => ({ u, wRel: band(bodyRel(P, speed, u), 0.12) })),
      tipRel: [0, 0.12], endRel: exitExpect(P, speed).endRel, v30: exitExpect(P, speed).v30, feibai: true, blooms: [0, 0],
      area: band(nominalArea(P, speed), 0.12),
      note: '快：F_v(0.96)≈0.69 × 横 0.70 ≈ 0.48；末端 0.12×，出锋长 ≈34',
    },
  });
}

// V03 慢竖
{
  const P = path([['M', 172, 62], ['L', 173, 290]]);
  const speed = [[0, 0.12], [0.1, 0.2], [0.85, 0.18], [1, 0.06]];
  add({
    id: 'V03-shu-slow', name: '慢竖（120Hz，慢收顿圆）', input: { hz: 120, device: 'finger' }, points: synth(P, { speed, hz: 120, seed: 13 }),
    expect: {
      single: false, dot: false, hook: false, corners: [0, 0], caps: { start: 'cut', end: 'round' },
      widths: [0.3, 0.5, 0.7].map(u => ({ u, wRel: band(bodyRel(P, speed, u), 0.12) })),
      endRel: [0.95, 1.35], v30: [0, SPEC.lo], feibai: false, blooms: [1, 3],
      area: band(nominalArea(P, speed), 0.12),
      note: '竖粗：F_dir(90°)=1.12；与 V01 同速时 竖/横 ≈ 1.6',
    },
  });
}

// V04 快竖带出锋（悬针竖）
{
  const P = path([['M', 172, 62], ['L', 174, 298]]);
  const speed = [[0, 0.3], [0.3, 0.6], [1, 1.15]];
  add({
    id: 'V04-shu-fast-chufeng', name: '快竖带出锋（悬针，120Hz）', input: { hz: 120, device: 'finger' }, points: synth(P, { speed, hz: 120, seed: 14 }),
    expect: {
      single: false, dot: false, hook: false, corners: [0, 0], caps: { start: 'cut', end: 'taper' },
      widths: [0.3, 0.6].map(u => ({ u, wRel: band(bodyRel(P, speed, u), 0.12) })),
      ratios: [{ num: 0.8, den: 0.3, range: band(bodyRel(P, speed, 0.8) / bodyRel(P, speed, 0.3), 0.1), note: '越写越快越细' }],
      tipRel: [0, 0.14], endRel: exitExpect(P, speed).endRel, v30: exitExpect(P, speed).v30, feibai: true, blooms: [0, 0],
      area: band(nominalArea(P, speed), 0.12),
    },
  });
}

// V05 撇（120Hz）
const PIE = path([['M', 232, 92], ['C', 228, 170, 190, 240, 92, 285]]);
const PIE_SPEED = [[0, 0.2], [0.25, 0.45], [1, 1.1]];
add({
  id: 'V05-pie', name: '撇（120Hz，加速出锋）', input: { hz: 120, device: 'finger' }, points: synth(PIE, { speed: PIE_SPEED, hz: 120, seed: 15 }),
  expect: {
    single: false, dot: false, hook: false, corners: [0, 0], caps: { start: 'cut', end: 'taper' },
    widths: [0.25, 0.5].map(u => ({ u, wRel: band(bodyRel(PIE, PIE_SPEED, u), 0.13) })),
    ratios: [{ num: 0.7, den: 0.2, range: band(bodyRel(PIE, PIE_SPEED, 0.7) / bodyRel(PIE, PIE_SPEED, 0.2), 0.1), note: '撇由粗到细（加速 + 方向转向「薄边」）' }],
    tipRel: [0, 0.14], endRel: exitExpect(PIE, PIE_SPEED).endRel, v30: exitExpect(PIE, PIE_SPEED).v30, feibai: true, blooms: [0, 0],
    area: band(nominalArea(PIE, PIE_SPEED), 0.12),
  },
});

// V06 捺 慢收顿
{
  const P = path([['M', 118, 112], ['C', 165, 150, 215, 215, 282, 268]]);
  const speed = [[0, 0.3], [0.2, 0.38], [0.6, 0.3], [0.9, 0.14], [1, 0.07]];
  add({
    id: 'V06-na-slow', name: '捺·慢收顿（120Hz）', input: { hz: 120, device: 'finger' }, points: synth(P, { speed, hz: 120, seed: 16 }),
    expect: {
      single: false, dot: false, hook: false, corners: [0, 0], caps: { start: 'point', end: 'round' },
      widths: [0.3, 0.6].map(u => ({ u, wRel: band(bodyRel(P, speed, u), 0.12) })),
      ratios: [{ num: 0.85, den: 0.2, range: band(bodyRel(P, speed, 0.85) / bodyRel(P, speed, 0.2), 0.08), note: '捺由细到粗（越写越慢）' }],
      endRel: [0.95, 1.35], v30: [0, SPEC.lo], feibai: false, blooms: [1, 3],
      area: band(nominalArea(P, speed), 0.12),
      note: '起笔方向 ≈39°，与 45° 斜切线几乎平行 → 尖起笔',
    },
  });
}

// V07 捺 快收出锋（捺脚转平）
{
  const P = path([['M', 118, 112], ['C', 165, 150, 210, 220, 262, 255], ['L', 302, 262]]);
  const uf = P.knotS[1] / P.len; // 捺脚转折处
  const speed = [[0, 0.3], [0.2, 0.36], [uf - 0.12, 0.26], [uf - 0.01, 0.13], [uf + 0.04, 0.6], [1, 1.25]];
  add({
    id: 'V07-na-fast', name: '捺·快收出锋（120Hz）', input: { hz: 120, device: 'finger' }, points: synth(P, { speed, hz: 120, seed: 17 }),
    expect: {
      single: false, dot: false, hook: false, corners: [0, 0], caps: { start: 'point', end: 'taper' },
      widths: [0.3, 0.6, uf - 0.02].map(u => ({ u: r3(u), wRel: band(bodyRel(P, speed, u), 0.13) })),
      ratios: [{ num: r3(uf - 0.02), den: 0.2, range: band(bodyRel(P, speed, uf - 0.02) / bodyRel(P, speed, 0.2), 0.1), note: '捺脚处按（慢）最粗' }],
      tipRel: [0, 0.16], endRel: exitExpect(P, speed).endRel, v30: exitExpect(P, speed).v30, blooms: [0, 0],
      area: band(nominalArea(P, speed), 0.13),
    },
  });
}

// V08 点（D09 短笔）
{
  const P = path([['M', 158, 66], ['L', 171, 82]]);
  const speed = [[0, 0.12], [0.5, 0.25], [1, 0.15]];
  const len = P.len;
  // 名义面积：点画倍数 0.7→1.1→0.9 × 本体
  let A = 0;
  for (let s = 0.25; s < len; s += 0.5) {
    const u = s / len;
    const ph = u < 0.5 ? 0.7 + 0.8 * u : 1.1 - 0.4 * (u - 0.5);
    A += 0.5 * SPEC.B * Fv(kf(speed, u)) * Fdir(P.dirAt(s)) * ph;
  }
  add({
    id: 'V08-dian', name: '点（D09 点画，总长 < 24）', input: { hz: 120, device: 'finger' }, points: synth(P, { speed, hz: 120, seed: 18 }),
    expect: {
      single: false, dot: true, hook: false, corners: [0, 0], caps: { start: 'point', end: 'dot' },
      dotPhase: [{ u: 0, f: 0.7 }, { u: 0.5, f: 1.1 }, { u: 1, f: 0.9 }],
      widths: [{ u: 0.5, wRel: band(bodyRel(P, speed, 0.5) * 1.1, 0.13) }],
      area: [r3(A * 0.85), r3(A * 1.35)],
      note: 'D09：点画倍数 0.7→1.1→0.9 乘本体宽（本体宽含方向因子）；起笔方向 ≈51° 与斜切线近平行 → 尖起笔，成水滴形',
    },
  });
}

// V09 单点（D09：直径 0.9 × 本体宽；含零时间差重复）
add({
  id: 'V09-single', name: '单点（D09，0.9×本体宽）', input: { hz: 120, device: 'finger' },
  points: [{ x: 172.4, y: 171.8, t: 1000 }, { x: 172.0, y: 171.5, t: 1000 }, { x: 172.4, y: 171.8, t: 1000 }, { x: 172.4, y: 171.8, t: 1008.333 }],
  expect: {
    single: true, dot: false, hook: false, corners: [0, 0], caps: { start: 'disc', end: 'disc' },
    singleDiameterRel: [0.9, 0.9],
    area: band(Math.PI * (0.45 * SPEC.B) ** 2, 0.02),
  },
});

// V10 横折（停顿 120ms）
{
  const P = path([['M', 82, 104], ['L', 252, 97], ['L', 246, 292]]);
  const uc = P.knotS[1] / P.len;
  const speed = [[0, 0.15], [0.06, 0.3], [uc - 0.04, 0.28], [uc, 0.1], [uc + 0.035, 0.28], [0.93, 0.25], [1, 0.07]];
  const wh = bodyRel(P, speed, uc * 0.5);
  const wv = bodyRel(P, speed, uc + (1 - uc) * 0.5);
  add({
    id: 'V10-hengzhe', name: '横折（转角停顿 120ms，120Hz）', input: { hz: 120, device: 'finger' },
    points: synth(P, { speed, dwell: [{ u: uc, ms: 120 }], hz: 120, seed: 20 }),
    expect: {
      single: false, dot: false, hook: false, corners: [1, 1], caps: { start: 'cut', end: 'round' },
      widths: [{ u: uc * 0.5, wRel: band(wh, 0.12) }, { u: uc + (1 - uc) * 0.5, wRel: band(wv, 0.12) }],
      ratios: [{ num: uc + (1 - uc) * 0.5, den: uc * 0.5, range: band(wv / wh, 0.12), note: '竖段/横段（横细竖粗）' }],
      cornerAt: band(uc, 0.03), endRel: [0.95, 1.35], blooms: [1, 3], feibai: false,
      area: [r3(nominalArea(P, speed) * 0.88), r3(nominalArea(P, speed) * 1.16)],
    },
  });
}

// V11 竖钩（快钩）与 V12 慢钩（反例）
const GOU = path([['M', 182, 60], ['L', 181, 262], ['L', 150, 244]]);
const GOU_UC = GOU.knotS[1] / GOU.len;
{
  const uc = GOU_UC;
  const speed = [[0, 0.15], [0.06, 0.35], [uc - 0.1, 0.32], [uc, 0.12], [uc + 0.02, 0.6], [uc + 0.06, 0.95], [1, 1.0]];
  add({
    id: 'V11-shugou', name: '竖钩（转角停 50ms 后快挑，120Hz）', input: { hz: 120, device: 'finger' },
    points: synth(GOU, { speed, dwell: [{ u: uc, ms: 50 }], hz: 120, seed: 21 }),
    expect: {
      single: false, dot: false, hook: true, corners: [1, 1], caps: { start: 'cut', end: 'hook' },
      widths: [{ u: uc * 0.5, wRel: band(bodyRel(GOU, speed, uc * 0.5), 0.12) }],
      hookLen: [25, 45], tipRel: [0, 0.14], cornerAt: band(uc, 0.03),
      area: [r3(nominalArea(GOU, speed, { exit: 'none' }) * 0.8), r3(nominalArea(GOU, speed, { exit: 'none' }) * 1.05)],
      note: '转角 ≈121° > 100°，转角后 60ms 峰速 ≈0.9 > 1.6 × 转角前均速 ≈0.3 → 钩；钩锋收到 0.1×',
    },
  });
}
{
  const uc = GOU_UC;
  const speed = [[0, 0.15], [0.06, 0.35], [uc - 0.1, 0.32], [uc, 0.12], [uc + 0.02, 0.22], [1, 0.2]];
  add({
    id: 'V12-shugou-slow', name: '竖钩·慢挑（反例：不生成钩锋）', input: { hz: 120, device: 'finger' },
    points: synth(GOU, { speed, dwell: [{ u: uc, ms: 50 }], hz: 120, seed: 22 }),
    expect: {
      single: false, dot: false, hook: false, corners: [1, 1], caps: { start: 'cut', end: 'round' },
      endRel: [0.95, 1.35], v30: [0, SPEC.lo],
      note: '转角够大但挑出速度 ≈0.22 < 1.6 × 0.3：如实画成慢折，不替用户「补」钩',
    },
  });
}

// V13 / V14 带压力的竖（Pencil 240Hz；V14 同压力曲线、速度 ×2 → 本体宽相同，D10）
const PSHU = path([['M', 172, 62], ['L', 172, 292]]);
const PSHU_P = [[0, 0.12], [0.15, 0.55], [0.7, 0.6], [1, 0.25]];
for (const [id, mul, seed] of [['V13-pencil-shu', 1, 23], ['V14-pencil-shu-fast', 2, 24]]) {
  const speed = [[0, 0.15 * mul], [0.1, 0.3 * mul], [0.9, 0.3 * mul], [1, 0.12 * mul]];
  add({
    id, name: mul === 1 ? '带压力的竖（Pencil 240Hz）' : '带压力的竖·快一倍（Pencil 240Hz，D10 对照）', input: { hz: 240, device: 'pencil' },
    points: synth(PSHU, { speed, pressure: PSHU_P, hz: 240, seed, jitter: 0.05 }),
    expect: {
      single: false, dot: false, hook: false, corners: [0, 0], pressure: true,
      caps: { start: 'cut', end: exitExpect(PSHU, speed).end }, v30: exitExpect(PSHU, speed).v30,
      widths: [0.4, 0.5, 0.6].map(u => ({ u, wRel: band(Fp(kf(PSHU_P, u)) * Fdir(90), 0.06) })),
      area: band(nominalArea(PSHU, speed, { pressure: PSHU_P }), 0.12),
      note: 'D10：有压力时 F_p 替代 F_v（不叠乘）；中段宽 = B × F_p(p) × F_dir(90°)',
    },
  });
}

// V15–V17 同一笔 60 / 120 / 240Hz（采样率无关）
const RATE = path([['M', 70, 170], ['Q', 172, 152, 278, 166]]);
const RATE_SPEED = [[0, 0.2], [0.15, 0.6], [0.7, 0.65], [1, 0.3]];
for (const [hz, seed] of [[60, 31], [120, 32], [240, 33]]) {
  add({
    id: `V${hz === 60 ? 15 : hz === 120 ? 16 : 17}-rate-${hz}hz`, name: `同一笔 ${hz}Hz（采样率无关）`, input: { hz, device: 'finger' },
    points: synth(RATE, { speed: RATE_SPEED, hz, seed, jitter: 0.08, phase: hz === 60 ? 5 : 0 }),
    expect: {
      single: false, dot: false, hook: false, corners: [0, 0], caps: { start: 'cut', end: 'round' },
      widths: [0.3, 0.5, 0.7].map(u => ({ u, wRel: band(bodyRel(RATE, RATE_SPEED, u), 0.12) })),
      area: band(nominalArea(RATE, RATE_SPEED), 0.12),
      sameAs: hz === 120 ? null : 'V16-rate-120hz',
    },
  });
}

// V18 撇 60Hz（与 V05 对照，曲线 + 快速）
add({
  id: 'V18-pie-60hz', name: '撇 60Hz（与 V05 120Hz 对照）', input: { hz: 60, device: 'finger' },
  points: synth(PIE, { speed: PIE_SPEED, hz: 60, seed: 35, phase: 7 }),
  expect: {
    single: false, dot: false, hook: false, corners: [0, 0], caps: { start: 'cut', end: 'taper' },
    tipRel: [0, 0.14], sameAs: 'V05-pie',
  },
});

// V19 短快笔（D09：不足 30ms 用整段时长）
{
  const P = path([['M', 120, 200], ['L', 150, 205]]);
  const speed = [[0, 1.4], [1, 1.4]];
  add({
    id: 'V19-short-fast', name: '短快笔（总时长 < 30ms，D09 用整段时长）', input: { hz: 120, device: 'finger' },
    points: synth(P, { speed, hz: 120, seed: 36, jitter: 0.05 }),
    expect: {
      single: false, dot: false, hook: false, corners: [0, 0], caps: { end: 'taper' },
      v30: [1.25, 1.55], v30WholeDuration: true,
    },
  });
}

// V20 提
{
  const P = path([['M', 92, 236], ['L', 152, 196]]);
  const speed = [[0, 0.15], [0.15, 0.5], [1, 1.0]];
  add({
    id: 'V20-ti', name: '提（120Hz）', input: { hz: 120, device: 'finger' }, points: synth(P, { speed, hz: 120, seed: 37 }),
    expect: {
      single: false, dot: false, hook: false, corners: [0, 0], caps: { start: 'cut', end: 'taper' },
      widths: [{ u: 0.5, wRel: band(bodyRel(P, speed, 0.5), 0.13) }],
      tipRel: [0, 0.14],
      note: '提方向 ≈−34°，接近「薄边」方向 → 方向因子夹到 dirMin 0.5',
    },
  });
}

// ---------------------------------------------------------------- 演示字（不参与断言，供人看）
function chars() {
  const out = {};
  const S = (pieces, speed, opt = {}) => synth(path(pieces), { speed, hz: 120, ...opt });
  // 永：点、横折钩、横撇、撇、捺
  {
    const hzg = path([['M', 120, 104], ['L', 184, 98], ['L', 181, 286], ['L', 152, 266]]);
    const u1 = hzg.knotS[1] / hzg.len;
    const u2 = hzg.knotS[2] / hzg.len;
    const hp = path([['M', 82, 160], ['L', 136, 156], ['C', 120, 196, 100, 228, 66, 252]]);
    const v1 = hp.knotS[1] / hp.len;
    out['永'] = [
      S([['M', 160, 40], ['L', 176, 62]], [[0, 0.12], [0.5, 0.25], [1, 0.14]], { seed: 101 }),
      synth(hzg, { speed: [[0, 0.15], [0.05, 0.3], [u1 - 0.03, 0.26], [u1, 0.1], [u1 + 0.03, 0.3], [u2 - 0.08, 0.32], [u2, 0.12], [u2 + 0.02, 0.6], [u2 + 0.06, 0.95], [1, 1]], dwell: [{ u: u1, ms: 90 }, { u: u2, ms: 50 }], hz: 120, seed: 102 }),
      synth(hp, { speed: [[0, 0.15], [0.06, 0.3], [v1 - 0.04, 0.26], [v1, 0.1], [v1 + 0.05, 0.35], [1, 1.0]], dwell: [{ u: v1, ms: 80 }], hz: 120, seed: 103 }),
      S([['M', 262, 132], ['C', 245, 152, 222, 172, 196, 186]], [[0, 0.2], [0.3, 0.45], [1, 0.95]], { seed: 104 }),
      S([['M', 196, 188], ['C', 222, 214, 250, 250, 276, 268], ['L', 306, 274]], [[0, 0.25], [0.6, 0.32], [0.85, 0.55], [1, 1.05]], { seed: 105 }),
    ];
  }
  // 大：横、撇、捺
  out['大'] = [
    S([['M', 66, 132], ['L', 280, 124]], [[0, 0.12], [0.08, 0.28], [0.85, 0.25], [1, 0.07]], { seed: 111 }),
    S([['M', 174, 42], ['L', 172, 150], ['C', 160, 220, 120, 268, 62, 300]], [[0, 0.15], [0.1, 0.3], [0.45, 0.35], [1, 1.1]], { seed: 112 }),
    S([['M', 180, 158], ['C', 205, 205, 240, 255, 278, 282], ['L', 308, 288]], [[0, 0.2], [0.6, 0.3], [0.85, 0.55], [1, 1.05]], { seed: 113 }),
  ];
  // 十：横、竖（悬针）
  out['十'] = [
    S([['M', 62, 168], ['L', 284, 160]], [[0, 0.12], [0.08, 0.3], [0.85, 0.26], [1, 0.07]], { seed: 121 }),
    S([['M', 172, 46], ['L', 174, 304]], [[0, 0.2], [0.2, 0.4], [1, 1.1]], { seed: 122 }),
  ];
  // 心：卧钩前的点、卧钩、两点
  {
    const wg = path([['M', 104, 150], ['C', 112, 240, 140, 282, 226, 270], ['L', 246, 236]]);
    const uw = wg.knotS[1] / wg.len;
    out['心'] = [
      S([['M', 66, 196], ['L', 78, 220]], [[0, 0.12], [0.5, 0.22], [1, 0.14]], { seed: 131 }),
      synth(wg, { speed: [[0, 0.18], [0.1, 0.32], [uw - 0.08, 0.3], [uw, 0.12], [uw + 0.03, 0.7], [1, 1.0]], dwell: [{ u: uw, ms: 40 }], hz: 120, seed: 132 }),
      S([['M', 166, 128], ['L', 182, 150]], [[0, 0.12], [0.5, 0.24], [1, 0.14]], { seed: 133 }),
      S([['M', 248, 150], ['L', 268, 176]], [[0, 0.12], [0.5, 0.24], [1, 0.14]], { seed: 134 }),
    ];
  }
  return out;
}

const doc = {
  model: 'ink-model-1.0',
  generated: 'node gen-vectors.mjs（固定种子，可复现）',
  units: { coord: '345 单位格（GRID），y 向下', t: 'ms（任意起点，只看差值）', p: '0–1，仅 Pencil；缺省 = 手指', w: 'w/B，B = 本体宽 13' },
  tiers: {
    structural: 'single / dot / hook / corners / caps / pressure / sameAs / v30WholeDuration：任何落在规格取值范围内的参数都必须成立',
    numeric: 'widths / ratios / tipRel / endRel / area / v30 / hookLen / cornerAt：绑定默认参数（paramsVersion）；T2 调参后按规格 §8.4 重新生成并人工复核',
  },
  paramsVersion: 'ink-model-1.0-defaults',
  assertionGlossary: {
    'widths[].u': '弧长比例位置 s/len；wRel = w(s)/B 落在闭区间',
    ratios: 'w(num·len)/w(den·len) 落在 range',
    tipRel: '末样本 w/B',
    endRel: '末样本 w / 末样本本体宽（不含阶段因子）',
    area: '几何并集面积（345 单位²），非零规则',
    caps: 'start ∈ cut | point | disc；end ∈ round | taper | hook | dot | disc',
    corners: '检测到的折角个数区间',
    cornerAt: '最后一个折角的弧长比例',
    hookLen: '钩段弧长（单位）',
    dotPhase: '点画阶段因子在 u 处的精确值（D09）',
    singleDiameterRel: '单点直径 / B（D09 = 0.9）',
    v30: '抬笔前 30ms 均速（单位/ms）',
    feibai: '是否出现飞白（任一样本 dry > 0.05）',
    blooms: '洇墨处数区间',
    sameAs: '与另一条向量（同一笔不同采样率）在 u = 0.05…0.95 逐位置 |Δw| ≤ max(5%·w, 0.04·B)、面积差 ≤ 3%、端帽一致、弧长差 ≤ 1%',
  },
  vectors,
  demoChars: chars(),
};

writeFileSync(join(HERE, 'vectors.json'), JSON.stringify(doc, null, 1) + '\n');
console.log(`vectors.json: ${vectors.length} vectors, demo chars: ${Object.keys(doc.demoChars).join(' ')}`);
