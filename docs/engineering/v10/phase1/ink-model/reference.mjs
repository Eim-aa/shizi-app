// 拾字 笔锋模型 · JS 参考实现（P1-S1，规格见 ../笔锋模型规格.md）
//
// 纯函数，node 可跑，无 DOM。原始点 {x, y, t, p?}（345 单位格、ms、p∈[0,1] 仅 Pencil）→ 宽度剖面（profile）→ 几何（geometry）。
// 这是阶段 2 原生书写面（Swift + Metal）的契约实现：原生端对 vectors.json 跑出的「可断言特征」必须落在同一区间。
// 本文件不进产品代码；产品里的 src/core/ink-math.js 不受影响。
//
// 管线（规格 §2–§4）：
//   prepare（零时间差合并 D09、坏点丢弃、时间单调）
//   → filter（向量 1€，指数 α，滞后上限 §2.3）
//   → resample（向心 Catmull-Rom 稠密化 + 等弧长 Δs 重采样，段内时间按弧长线性 → 采样率无关）
//   → analyze（本体因子：速度或压力（D10 替代不叠乘）× 时间平滑 τ；方向因子；阶段因子：起笔 / 收笔 / 点画（D09）/ 折 / 钩）
//   → geometry（中线 + 左右半宽 → 三角带并集 + 斜切起笔 + 圆端帽 + 折角斜接；面积按非零并集扫描线计算）

export const MODEL_VERSION = 'ink-model-1.0';

const DEG = Math.PI / 180;

/** 默认参数（规格 §3 参数表）。T2 = 必须真机由 2–3 位能写规范硬笔楷书的人盲测调定。 */
export const PARAMS = Object.freeze({
  // —— 本体
  base: 13, // B：本体宽（345 单位）。T2
  step: 1, // Δs：等弧长重采样步长
  tau: 35, // ms：本体因子按时间平滑（交接备注八.1，保留）
  // —— 速度因子（手指）F_v(v) = 1 − (1 − vMin)·(1 − e^(−v/vK))，v 夹到 speedCap
  vMin: 0.62, // T2
  vK: 0.55, // 单位/ms。T2
  speedCap: 1.5, // 交接备注八.1，保留
  // —— 压力因子（Pencil，D10：替代 F_v，不叠乘）
  pressureLo: 0.42,
  pressureGain: 0.92,
  pressureHi: 1.38, // P65 过渡值 .58/.94/1.52 是在「无方向因子」时定的；叠上方向因子后整体偏粗，改为让 p≈0.35 时 ≈1.0。T2
  dirPencil: 1, // Pencil（有压力）时方向因子的强度：F = 1 + (F_dir − 1)·dirPencil。T2
  // —— 倾角（Pencil 侧锋）：F_tilt = 1 + tiltGain·clamp((tiltAlt0 − alt)/tiltAlt0, 0, 1)。存储不含倾角前默认关（规格 §3.5）
  tiltGain: 0,
  tiltAlt0: 60, // 度
  // —— 方向因子 F_dir(θ) = max(dirMin, a + b·|sin(θ − dirAngle)|)，a、b 由「横 dirH、竖 dirV」两点解出
  dirAngle: -25, // 度（y 向下坐标；笔锋「薄边」朝右上 25°）。T2
  dirH: 0.72, // θ=0（横）。T2
  dirV: 1.12, // θ=90°（竖）。T2
  dirMin: 0.5,
  dirWin: 6, // 求方向的弧长半窗（单位）：须 ≥ 60Hz 快写时相邻原始点间距的一半，否则抖动直接变成宽度纹波
  // —— 起笔
  entryMs: 40,
  entryLenMin: 5,
  entryLenMax: 12,
  entryStart: 1.12,
  entryPeak: 1.35, // T2
  entryPeakAt: 0.35,
  entryFastDamp: 0.4, // 快起笔时顿的减弱比例
  cutAngle: 45, // 度：斜切线方向（↘，右手执笔的落笔顿向）。T2
  cutMinRel: 30, // 度：切线与行笔方向的最小夹角（小于则尖起笔）
  cutDirLen: 6, // 起笔方向取前 6 单位
  // —— 收笔（D09 / 交接备注八.1：看抬笔前 30ms 均速；lo / hi 阈值）
  window: 30,
  lo: 0.25, // T2
  hi: 0.9, // T2
  stopLen: 7,
  stopPeak: 1.2, // 慢收顿圆。T2
  stopShift: 0.22, // 慢收顿笔向 cutAngle（↘）偏出的比例（× 末端宽 × (1 − kk)）
  tapLenMin: 20,
  tapLenMax: 34, // T2
  tapRatio: 0.4,
  endFast: 0.12, // T2
  tapGamma: 0.6,
  // —— 点画 / 单点（D09，保留）
  dotLen: 24,
  dotProfile: [0.7, 1.1, 0.9],
  single: 0.9,
  // —— 折
  cornerAngle: 65, // 度
  cornerWin: 6,
  cornerBoost: 0.25, // 折肩：斜接点沿外角平分线再推出 cornerBoost × 出段半宽（「耳」）。T2
  miterLimit: 1.8,
  // —— 钩
  hookAngle: 100, // 度。T2
  hookMinLen: 4,
  hookMaxLen: 45,
  hookSpeedRatio: 1.6, // T2
  hookPeakMs: 60,
  hookPress: 0.2, // 钩的转角顿：圆顿半径 = 转角半宽 × (1 + hookPress/2)，中心向 ↘ 偏出
  hookPressShift: 0.12, // （× 转角宽）
  hookHold: 2,
  hookEnd: 0.1,
  hookGamma: 0.7,
  // —— 宽度夹值
  wMinRel: 0.04,
  wMaxRel: 2.4,
  // —— 输入滤波：向量 1€，指数 α（规格 §2.3）
  euroMinCutoff: 6, // Hz
  euroBeta: 0.15, // Hz / (单位/s)
  euroDCutoff: 10, // Hz
  // —— 实时（规格 §7）
  liftBlend: 0.5, // 书写中按「此刻抬笔」的收笔形态预混比例。T2
  liftEaseMs: 70,
  predictWidth: 0.9,
  provisionalMin: 56, // 单位：距笔尖多远之后样本冻结
  // —— 质感（规格 §5）
  feibaiV0: 0.7,
  feibaiV1: 1.4,
  feibaiMax: 0.45, // T2
  bloomRadius: 1.2,
  bloomMinMs: 60,
  bloomFullMs: 300,
  bloomSpread: 0.6,
  bloomAlpha: 0.14,
  // —— 尺寸（规格 §6）
  sizeRef: 258,
  sizeGamma: 0.3,
  sizeCompMax: 1.5,
  hairlinePx: 0.75,
});

export function params(over) {
  const k = { ...PARAMS, ...(over || {}) };
  // 方向因子两点解 a、b
  const sh = Math.abs(Math.sin((0 - k.dirAngle) * DEG));
  const sv = Math.abs(Math.sin((90 - k.dirAngle) * DEG));
  k.dirB = (k.dirV - k.dirH) / (sv - sh);
  k.dirA = k.dirH - k.dirB * sh;
  return k;
}

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = u => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};
const hasP = q => typeof q.p === 'number' && q.p > 0;

// ------------------------------------------------------------------ 因子（规格 §3）

export function speedFactor(v, k) {
  const vv = clamp(v, 0, k.speedCap);
  return 1 - (1 - k.vMin) * (1 - Math.exp(-vv / k.vK));
}

export function pressureFactor(p, k) {
  return clamp(k.pressureLo + Math.sqrt(clamp(p, 0, 1)) * k.pressureGain, k.pressureLo, k.pressureHi);
}

export function tiltFactor(altDeg, k) {
  if (!(k.tiltGain > 0) || typeof altDeg !== 'number') return 1;
  return 1 + k.tiltGain * clamp((k.tiltAlt0 - altDeg) / k.tiltAlt0, 0, 1);
}

/** θ：行笔方向（弧度，y 向下坐标，0 = 向右，π/2 = 向下）。 */
export function dirFactor(theta, k) {
  return Math.max(k.dirMin, k.dirA + k.dirB * Math.abs(Math.sin(theta - k.dirAngle * DEG)));
}

/** 显示尺寸 S（pt，书写格边长或缩略图边长）→ 线宽补偿倍数（规格 §6）。几何按 S/345 缩放，宽度再乘这个。 */
export function sizeComp(S, k = params()) {
  if (S >= k.sizeRef) return 1;
  return Math.min(k.sizeCompMax, Math.pow(S / k.sizeRef, -k.sizeGamma));
}

// ------------------------------------------------------------------ 输入预处理（规格 §2）

/** 零时间差合并（留最后位置，D09）；坏点丢弃；时间不单调时夹到前一点（再按零差合并）。 */
export function prepare(raw) {
  const out = [];
  for (const r of raw || []) {
    if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
    const prevT = out.length ? out[out.length - 1].t : 0;
    let t = Number.isFinite(r.t) ? r.t : prevT;
    if (out.length && t < prevT) t = prevT;
    const q = { x: r.x, y: r.y, t };
    if (hasP(r)) q.p = clamp(r.p, 0, 1);
    if (typeof r.alt === 'number') q.alt = r.alt;
    if (out.length && t === prevT) out[out.length - 1] = q;
    else out.push(q);
  }
  return out;
}

/** 向量 1€（指数 α = 1 − e^(−2π·fc·Δt)，速度取模长，两轴共用截止频率）。 */
export function oneEuro(points, k) {
  const out = [];
  let xh = 0;
  let yh = 0;
  let dh = 0;
  let tp = 0;
  points.forEach((q, i) => {
    if (i === 0) {
      xh = q.x;
      yh = q.y;
      tp = q.t;
      out.push({ ...q });
      return;
    }
    const dt = (q.t - tp) / 1000;
    if (!(dt > 0)) {
      out.push({ ...q, x: xh, y: yh });
      return;
    }
    const sp = Math.hypot(q.x - xh, q.y - yh) / dt;
    const ad = 1 - Math.exp(-2 * Math.PI * k.euroDCutoff * dt);
    dh = ad * sp + (1 - ad) * dh;
    const fc = k.euroMinCutoff + k.euroBeta * dh;
    const a = 1 - Math.exp(-2 * Math.PI * fc * dt);
    xh = a * q.x + (1 - a) * xh;
    yh = a * q.y + (1 - a) * yh;
    tp = q.t;
    out.push({ ...q, x: xh, y: yh });
  });
  return out;
}

/** 抬笔前 window ms 均速（与 src/core/ink-math.js liftSpeed 同口径，D09：不足 window 用整段时长）。 */
export function liftSpeed(m, windowMs) {
  const n = m.length;
  if (n < 2) return null;
  const tl = m[n - 1].t;
  const t0 = tl - windowMs;
  let i = n - 1;
  let d = 0;
  while (i > 0 && m[i - 1].t >= t0) {
    d += Math.hypot(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y);
    i -= 1;
  }
  let dt = tl - m[i].t;
  if (i > 0) {
    const a = m[i - 1];
    const b = m[i];
    const u = (b.t - t0) / (b.t - a.t);
    d += Math.hypot(b.x - a.x, b.y - a.y) * u;
    dt = windowMs;
  }
  return dt > 0 ? d / dt : 0;
}

/** 落笔后 window ms 均速（liftSpeed 的镜像）。 */
export function startSpeed(m, windowMs) {
  const rev = m.map(q => ({ x: q.x, y: q.y, t: -q.t })).reverse();
  return liftSpeed(rev, windowMs);
}

// ------------------------------------------------------------------ 重采样（规格 §2.4）

/** 向心 Catmull-Rom 稠密化（端点镜像补控制点），段内 t / p 按弧长线性；再按等弧长 Δs 重采样。 */
export function resample(points, k) {
  const n = points.length;
  if (n === 1) return [{ ...points[0], s: 0 }];
  const P = points;
  const ext = (a, b) => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y });
  const dense = [];
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = i === 0 ? ext(P[0], P[1]) : P[i - 1];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = i + 2 < n ? P[i + 2] : ext(P[n - 1], P[n - 2]);
    const segChord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const M = Math.max(4, Math.ceil(segChord / 0.25));
    const kn = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
    const t0 = 0;
    const t1 = t0 + kn(p0, p1);
    const t2 = t1 + kn(p1, p2);
    const t3 = t2 + kn(p2, p3);
    const pts = [];
    for (let j = 0; j <= M; j += 1) {
      if (j === M && i < n - 2) break; // 段尾留给下一段
      const tt = t1 + ((t2 - t1) * j) / M;
      const L = (pa, pb, ta, tb) => {
        const u = (tt - ta) / (tb - ta);
        return { x: pa.x + (pb.x - pa.x) * u, y: pa.y + (pb.y - pa.y) * u };
      };
      const A1 = L(p0, p1, t0, t1);
      const A2 = L(p1, p2, t1, t2);
      const A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2);
      const B2 = L(A2, A3, t1, t3);
      const C = L(B1, B2, t1, t2);
      pts.push(segChord < 1e-9 ? { x: p1.x, y: p1.y } : C);
    }
    // 段内弧长 → 时间 / 压力线性
    let acc = 0;
    const lens = [0];
    for (let j = 1; j < pts.length; j += 1) {
      acc += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y);
      lens.push(acc);
    }
    const segLen = i < n - 2 ? acc + Math.hypot(p2.x - pts[pts.length - 1].x, p2.y - pts[pts.length - 1].y) : acc;
    pts.forEach((q, j) => {
      const u = segLen > 1e-9 ? lens[j] / segLen : j / Math.max(1, pts.length - 1);
      const d = { x: q.x, y: q.y, t: lerp(p1.t, p2.t, u) };
      if (hasP(p1) || hasP(p2)) d.p = lerp(p1.p || 0, p2.p || 0, u);
      if (typeof p1.alt === 'number' && typeof p2.alt === 'number') d.alt = lerp(p1.alt, p2.alt, u);
      if (p2.predicted) d.predicted = true;
      dense.push(d);
    });
  }
  // 等弧长
  const S = [0];
  for (let j = 1; j < dense.length; j += 1) S.push(S[j - 1] + Math.hypot(dense[j].x - dense[j - 1].x, dense[j].y - dense[j - 1].y));
  const len = S[S.length - 1];
  const out = [];
  let j = 0;
  const count = Math.max(1, Math.ceil(len / k.step - 1e-9));
  for (let m = 0; m <= count; m += 1) {
    const s = m === count ? len : m * k.step;
    while (j < dense.length - 2 && S[j + 1] < s) j += 1;
    // 在 [j, j+1] 内插值；停顿（一串零长稠密点）的时间计入停顿点之后的下一个样本的 Δt
    let a = j;
    let b = Math.min(j + 1, dense.length - 1);
    if (m === count) {
      a = dense.length - 1;
      b = a;
    }
    const span = S[b] - S[a];
    const u = span > 1e-12 ? clamp((s - S[a]) / span, 0, 1) : 0;
    const A = dense[a];
    const B = dense[b];
    const q = { x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u), t: lerp(A.t, B.t, u), s };
    if (A.p !== undefined || B.p !== undefined) q.p = lerp(A.p || 0, B.p || 0, u);
    if (A.alt !== undefined && B.alt !== undefined) q.alt = lerp(A.alt, B.alt, u);
    if (B.predicted && u > 0) q.predicted = true;
    out.push(q);
  }
  return out;
}

function posAt(samples, s) {
  const n = samples.length;
  if (s <= 0) return samples[0];
  if (s >= samples[n - 1].s) return samples[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const A = samples[lo];
  const B = samples[hi];
  const u = (s - A.s) / Math.max(1e-12, B.s - A.s);
  return { x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u), t: lerp(A.t, B.t, u) };
}

/** 弧长 s 处的宽度（线性插值）。 */
function posAtW(samples, s) {
  const n = samples.length;
  if (s <= 0) return samples[0].w;
  if (s >= samples[n - 1].s) return samples[n - 1].w;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const u = (s - samples[lo].s) / Math.max(1e-12, samples[hi].s - samples[lo].s);
  return lerp(samples[lo].w, samples[hi].w, u);
}

function angleOf(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function wrap(a) {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

// ------------------------------------------------------------------ 分析（规格 §3）

/**
 * 原始点 → 宽度剖面。
 * @param {Array<{x,y,t,p?,alt?}>} raw
 * @param {{final?:boolean, predicted?:Array, params?:object, reduceMotion?:boolean}} [opts]
 */
export function analyze(raw, opts = {}) {
  const k = params(opts.params);
  const final = opts.final !== false;
  const m = prepare(raw);
  const B = k.base;
  const res = { version: MODEL_VERSION, final, base: B, single: false, dot: false, hook: null, corners: [], blooms: [], pressure: m.some(hasP), samples: [], len: 0 };
  if (!m.length) return res;

  // 单点（D09）：合并后只有一个点或总位移为 0
  const totalMove = m.reduce((acc, q, i) => (i ? acc + Math.hypot(q.x - m[i - 1].x, q.y - m[i - 1].y) : 0), 0);
  if (m.length === 1 || totalMove < 1e-6) {
    const last = m[m.length - 1];
    const fb = hasP(last) ? pressureFactor(last.p, k) : 1;
    const w = B * fb * tiltFactor(last.alt, k) * k.single;
    res.single = true;
    res.samples = [{ s: 0, x: last.x, y: last.y, t: last.t, v: 0, fBody: fb, fDir: 1, body: B * fb, fPhase: k.single, w, hwL: w / 2, hwR: w / 2, dry: 0 }];
    res.caps = { start: { type: 'disc' }, end: { type: 'disc' } };
    res.exit = { type: 'disc' };
    res.len = 0;
    const dwell = last.t - m[0].t;
    if (dwell >= k.bloomMinMs && !opts.reduceMotion) res.blooms.push({ s: 0, x: last.x, y: last.y, strength: Math.min(1, dwell / k.bloomFullMs) });
    return res;
  }

  let f = oneEuro(m, k);
  if (final) f[f.length - 1] = { ...m[m.length - 1] }; // 抬笔锁尾到原始末点
  if (!final && Array.isArray(opts.predicted) && opts.predicted.length) {
    const pr = prepare([f[f.length - 1], ...opts.predicted]).slice(1).map(q => ({ ...q, predicted: true }));
    f = f.concat(pr);
  }
  const S = resample(f, k);
  const n = S.length;
  const len = S[n - 1].s;
  res.len = len;

  // 速度（段内按弧长线性，故采样率无关）
  const v = new Array(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    const dt = S[i].t - S[i - 1].t;
    v[i] = dt > 0 ? (S[i].s - S[i - 1].s) / dt : v[i - 1];
  }
  v[0] = n > 1 ? v[1] : 0;

  // 方向
  const theta = S.map(q => {
    const a = posAt(S, q.s - k.dirWin);
    const b = posAt(S, q.s + k.dirWin);
    return angleOf(a, b);
  });

  // 本体因子 + 时间平滑（τ）
  const fBody = new Array(n);
  let wb = 0;
  let vs = 0; // 平滑速度（飞白用）
  for (let i = 0; i < n; i += 1) {
    const target = (hasP(S[i]) ? pressureFactor(S[i].p, k) : speedFactor(v[i], k)) * tiltFactor(S[i].alt, k);
    if (i === 0) {
      wb = target;
      vs = v[i];
    } else {
      const dt = S[i].t - S[i - 1].t;
      if (dt > 0) {
        const a = 1 - Math.exp(-dt / k.tau);
        wb += (target - wb) * a;
        vs += (v[i] - vs) * a;
      }
    }
    fBody[i] = wb;
    S[i].vs = vs;
  }

  const dot = final && len < k.dotLen;
  res.dot = dot;
  const v30 = liftSpeed(m, k.window);
  const vIn = startSpeed(m, k.entryMs);
  res.v30 = v30;
  res.vIn = vIn;
  const kk = clamp((v30 - k.lo) / Math.max(1e-6, k.hi - k.lo), 0, 1);
  res.kk = kk;

  // 折：转角检测（弧长窗 ±cornerWin）
  const turn = S.map(q => {
    if (q.s < k.cornerWin * 0.5 || q.s > len - k.cornerWin * 0.5) return 0;
    const a = posAt(S, q.s - k.cornerWin);
    const b = posAt(S, q.s + k.cornerWin);
    return wrap(angleOf(q, b) - angleOf(a, q));
  });
  const corners = [];
  if (!dot) {
    let i = 0;
    while (i < n) {
      if (Math.abs(turn[i]) >= k.cornerAngle * DEG) {
        let j = i;
        let best = i;
        while (j < n && Math.abs(turn[j]) >= k.cornerAngle * DEG) {
          if (Math.abs(turn[j]) > Math.abs(turn[best])) best = j;
          j += 1;
        }
        corners.push({ i: best, s: S[best].s, turn: turn[best] / DEG, x: S[best].x, y: S[best].y });
        i = j;
      } else i += 1;
    }
  }

  // 钩：最后一个转角 ≥ hookAngle、其后长度在 [hookMinLen, hookMaxLen]、转角后 hookPeakMs 内速度峰值 ≥ hookSpeedRatio × 转角前均速
  let hook = null;
  if (!dot && corners.length) {
    const c = corners[corners.length - 1];
    const tail = len - c.s;
    if (Math.abs(c.turn) >= k.hookAngle && tail >= k.hookMinLen && tail <= k.hookMaxLen) {
      const tc = S[c.i].t;
      const meanBefore = c.s / Math.max(1e-6, tc - S[0].t);
      // 离开转角的时刻：转角后第一个样本（含停顿）
      const dep = Math.min(n - 1, c.i + 1);
      const tDep = S[dep].t;
      let peak = 0;
      for (let i = dep; i < n; i += 1) {
        if (S[i].t - tDep > k.hookPeakMs) break;
        peak = Math.max(peak, v[i]);
      }
      const ratio = peak / Math.max(1e-6, meanBefore);
      if (ratio >= k.hookSpeedRatio) hook = { ...c, len: tail, speedRatio: ratio, meanBefore, peak };
      else c.hookRejected = { speedRatio: ratio };
    }
  }
  res.hook = hook;
  res.corners = corners;

  // 起笔
  const kIn = clamp((vIn - k.lo) / Math.max(1e-6, k.hi - k.lo), 0, 1);
  const Le = clamp(vIn * k.entryMs, k.entryLenMin, k.entryLenMax);
  const peak = 1 + (k.entryPeak - 1) * (1 - k.entryFastDamp * kIn);
  const fEntry = s => {
    if (s >= Le) return 1;
    const u = s / Le;
    if (u < k.entryPeakAt) return lerp(k.entryStart, peak, smooth(u / k.entryPeakAt));
    return lerp(peak, 1, smooth((u - k.entryPeakAt) / (1 - k.entryPeakAt)));
  };

  // 收笔
  const Ls = k.stopLen;
  const Lt = Math.min(k.tapRatio * len, lerp(k.tapLenMin, k.tapLenMax, kk));
  const fSlow = s => (len - s < Ls ? 1 + (k.stopPeak - 1) * smooth(1 - (len - s) / Ls) : 1);
  const fFast = s => (len - s < Lt ? k.endFast + (1 - k.endFast) * Math.pow((len - s) / Lt, k.tapGamma) : 1);
  const blend = final ? 1 : k.liftBlend;
  const fExit = s => lerp(1, lerp(fSlow(s), fFast(s), kk), blend);
  const hookStart = hook ? hook.s + k.hookHold : Infinity;
  const fHook = s => {
    if (s <= hookStart) return 1;
    const u = clamp((len - s) / Math.max(1e-6, len - hookStart), 0, 1);
    return lerp(1, k.hookEnd + (1 - k.hookEnd) * Math.pow(u, k.hookGamma), blend);
  };

  let cutRel = 0;
  const samples = [];
  for (let i = 0; i < n; i += 1) {
    const s = S[i].s;
    const fDir0 = dirFactor(theta[i], k);
    const fDir = hasP(S[i]) ? 1 + (fDir0 - 1) * k.dirPencil : fDir0;
    const body = B * fBody[i] * fDir;
    let fPhase;
    if (dot) {
      const u = len > 0 ? s / len : 0;
      const [a0, a1, a2] = k.dotProfile;
      fPhase = u < 0.5 ? lerp(a0, a1, u / 0.5) : lerp(a1, a2, (u - 0.5) / 0.5);
    } else {
      fPhase = fEntry(s) * (hook ? fHook(s) : fExit(s));
    }
    const w = clamp(body * fPhase, k.wMinRel * B, k.wMaxRel * B);
    // 左右半宽分开记（契约字段）；1.0 两侧相等，倾角方位角 / 侧锋留作 1.x 扩展
    const hwL = w / 2;
    const hwR = w / 2;
    const dry = opts.reduceMotion ? 0 : k.feibaiMax * smooth((S[i].vs - k.feibaiV0) / (k.feibaiV1 - k.feibaiV0));
    const q = { s, x: S[i].x, y: S[i].y, t: S[i].t, v: v[i], theta: theta[i], fBody: fBody[i], fDir, body, fPhase, w, hwL, hwR, dry };
    if (S[i].p !== undefined) q.p = S[i].p;
    if (S[i].predicted) {
      q.predicted = true;
      q.w *= k.predictWidth;
      q.hwL *= k.predictWidth;
      q.hwR *= k.predictWidth;
    }
    samples.push(q);
  }
  res.samples = samples;

  // 起笔斜切参数（规格 §4.3）
  const p0 = samples[0];
  const pd = posAt(S, Math.min(k.cutDirLen, len));
  const th0 = angleOf(p0, pd);
  const rel = Math.abs(wrap(2 * (k.cutAngle * DEG - th0)) / 2); // 两条「线」的锐角夹角 ∈ [0, π/2]
  cutRel = rel / DEG;
  res.entry = { Le, peak, vIn, theta0: th0 / DEG, cutRel, type: dot ? 'dot' : cutRel < k.cutMinRel + 5 ? 'point' : 'cut' };
  if (dot) res.entry.capType = cutRel < k.cutMinRel + 5 ? 'point' : 'cut';

  // 收笔描述
  const last = samples[n - 1];
  const endRel = last.w / Math.max(1e-6, last.body);
  let exitType;
  if (dot) exitType = 'dot';
  else if (hook) exitType = 'hook';
  else exitType = endRel >= 0.5 ? 'round' : 'taper';
  res.exit = { type: exitType, kk, v30, Lt, Ls, endRel, endW: last.w };
  res.caps = { start: { type: res.entry.type === 'dot' ? res.entry.capType : res.entry.type }, end: { type: exitType } };

  // 洇墨：停顿（原始点在 bloomRadius 内停留 ≥ bloomMinMs）+ 慢收
  if (!opts.reduceMotion) {
    let i = 0;
    while (i < m.length) {
      let j = i + 1;
      while (j < m.length && Math.hypot(m[j].x - m[i].x, m[j].y - m[i].y) <= k.bloomRadius) j += 1;
      const dwell = m[j - 1].t - m[i].t;
      if (dwell >= k.bloomMinMs) {
        let cx = 0;
        let cy = 0;
        for (let q = i; q < j; q += 1) {
          cx += m[q].x;
          cy += m[q].y;
        }
        cx /= j - i;
        cy /= j - i;
        let best = 0;
        let bd = Infinity;
        samples.forEach((q, qi) => {
          const d = Math.hypot(q.x - cx, q.y - cy);
          if (d < bd) {
            bd = d;
            best = qi;
          }
        });
        res.blooms.push({ s: samples[best].s, x: samples[best].x, y: samples[best].y, strength: Math.min(1, dwell / k.bloomFullMs), dwell });
        i = j;
      } else i += 1;
    }
    if (final && !hook && !dot && kk < 0.2 && !res.blooms.some(b => len - b.s < 3)) {
      res.blooms.push({ s: len, x: last.x, y: last.y, strength: 0.35 * (1 - kk / 0.2), dwell: 0, slowEnd: true });
    }
  }
  res.params = k;
  return res;
}

/** 前缀冻结区：距笔尖弧长 ≥ Z 的样本不再变化（规格 §7.2）。 */
export function provisionalZone(rawPrefix, k = params()) {
  const m = prepare(rawPrefix);
  const n = m.length;
  let tail2 = 0;
  for (let i = Math.max(1, n - 2); i < n; i += 1) tail2 += Math.hypot(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y);
  return Math.max(k.provisionalMin, tail2 + 6);
}

/** 宽度剖面在弧长 s 处的值（线性插值）。 */
export function widthAt(profile, s) {
  const S = profile.samples;
  if (!S.length) return 0;
  if (S.length === 1) return S[0].w;
  const n = S.length;
  if (s <= 0) return S[0].w;
  if (s >= S[n - 1].s) return S[n - 1].w;
  let i = 0;
  while (i < n - 2 && S[i + 1].s < s) i += 1;
  const u = (s - S[i].s) / Math.max(1e-12, S[i + 1].s - S[i].s);
  return lerp(S[i].w, S[i + 1].w, u);
}

// ------------------------------------------------------------------ 几何（规格 §4）

function orient(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? poly.slice().reverse() : poly;
}

/** 多边形被半平面 {X : dot(X − O, nrm) ≥ 0} 裁剪（Sutherland–Hodgman）。 */
function clipHalf(poly, O, nrm) {
  const out = [];
  const f = P => (P[0] - O[0]) * nrm[0] + (P[1] - O[1]) * nrm[1];
  for (let i = 0; i < poly.length; i += 1) {
    const A = poly[i];
    const Bp = poly[(i + 1) % poly.length];
    const fa = f(A);
    const fb = f(Bp);
    if (fa >= 0) out.push(A);
    if ((fa >= 0) !== (fb >= 0)) {
      const u = fa / (fa - fb);
      out.push([A[0] + (Bp[0] - A[0]) * u, A[1] + (Bp[1] - A[1]) * u]);
    }
  }
  return out;
}

/**
 * 宽度剖面 → 几何：多边形列表（每个都是逆时针，按非零规则取并集）。
 * 组成：中线三角带 + 起笔延伸并按斜切线裁剪 + 末端圆帽扇 + 折角外侧斜接楔。单点为圆盘。
 * @returns {{polys:Array<Array<[number,number]>>, bbox:[number,number,number,number]}}
 */
export function geometry(profile, opts = {}) {
  const k = profile.params || params(opts.params);
  const S = profile.samples;
  const polys = [];
  const seg = opts.capSegments || 16;
  if (!S.length) return { polys, bbox: [0, 0, 0, 0] };
  if (profile.single || S.length === 1) {
    const q = S[0];
    const r = q.w / 2;
    const disc = [];
    for (let i = 0; i < seg * 2; i += 1) {
      const a = (i / (seg * 2)) * Math.PI * 2;
      disc.push([q.x + Math.cos(a) * r, q.y + Math.sin(a) * r]);
    }
    polys.push(orient(disc));
    return finish(polys);
  }
  const n = S.length;
  const T = S.map((q, i) => {
    const a = S[Math.max(0, i - 1)];
    const b = S[Math.min(n - 1, i + 1)];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return [(b.x - a.x) / L, (b.y - a.y) / L];
  });
  const N = T.map(t => [-t[1], t[0]]); // y 向下坐标：+N 在行笔方向的视觉右侧（hwL 一侧）
  const Lp = S.map((q, i) => [q.x + N[i][0] * q.hwL, q.y + N[i][1] * q.hwL]);
  const Rp = S.map((q, i) => [q.x - N[i][0] * q.hwR, q.y - N[i][1] * q.hwR]);
  const strip = [];
  for (let i = 0; i < n - 1; i += 1) {
    strip.push({ i, poly: [Lp[i], Rp[i], Rp[i + 1]] });
    strip.push({ i, poly: [Lp[i], Rp[i + 1], Lp[i + 1]] });
  }

  // 起笔：沿起笔方向向后延伸 e，再用斜切线裁掉切线后方（规格 §4.3）
  const p0 = S[0];
  const th0 = (profile.entry ? profile.entry.theta0 : 0) * DEG;
  const t0 = [Math.cos(th0), Math.sin(th0)];
  const relDeg = profile.entry ? profile.entry.cutRel : 90;
  const relEff = Math.max(k.cutMinRel, relDeg) * DEG;
  // 斜切线方向：取 cutAngle，若与行笔夹角过小则转到恰好 cutMinRel（保持转向一侧）
  let cut = k.cutAngle * DEG;
  if (relDeg < k.cutMinRel) {
    const d = wrap(2 * (cut - th0)) / 2; // 带符号夹角 ∈ (−π/2, π/2]
    cut = th0 + (d >= 0 ? 1 : -1) * k.cutMinRel * DEG;
  }
  const c = [Math.cos(cut), Math.sin(cut)];
  const hw0 = Math.max(p0.hwL, p0.hwR);
  const e = hw0 / Math.tan(relEff) + 0.5;
  const back = [p0.x - t0[0] * e, p0.y - t0[1] * e];
  const nb = [-t0[1], t0[0]];
  const bL = [back[0] + nb[0] * p0.hwL, back[1] + nb[1] * p0.hwL];
  const bR = [back[0] - nb[0] * p0.hwR, back[1] - nb[1] * p0.hwR];
  const ext = [bL, bR, Rp[0], Lp[0]];
  // 保留与 t0 同侧的半平面：法向 = c 的法线，朝 t0 一侧
  let cn = [-c[1], c[0]];
  if (cn[0] * t0[0] + cn[1] * t0[1] < 0) cn = [-cn[0], -cn[1]];
  const O = [p0.x, p0.y];
  const clipS = 2 * e + 2;
  const keep = [];
  const extC = clipHalf(ext, O, cn);
  if (extC.length >= 3) keep.push(extC);
  for (const tri of strip) {
    if (S[tri.i].s <= clipS) {
      const cp = clipHalf(tri.poly, O, cn);
      if (cp.length >= 3) keep.push(cp);
    } else keep.push(tri.poly);
  }
  for (const p of keep) polys.push(orient(p));

  // 末端圆帽
  const qe = S[n - 1];
  const te = T[n - 1];
  const ne = N[n - 1];
  const re = (qe.hwL + qe.hwR) / 2;
  const cap = [[qe.x, qe.y]];
  for (let i = 0; i <= seg; i += 1) {
    const a = (i / seg) * Math.PI; // 从 +N 经 +T 到 −N
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    cap.push([qe.x + (ne[0] * ca + te[0] * sa) * re, qe.y + (ne[1] * ca + te[1] * sa) * re]);
  }
  polys.push(orient(cap));

  const disc = (cx, cy, r) => {
    const d = [];
    for (let i = 0; i < seg * 2; i += 1) {
      const a = (i / (seg * 2)) * Math.PI * 2;
      d.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return orient(d);
  };
  const cd = [Math.cos(k.cutAngle * DEG), Math.sin(k.cutAngle * DEG)];
  // 慢收顿笔：末端圆向 ↘ 偏出（规格 §3.7）
  if (profile.exit && profile.exit.type === 'round' && profile.exit.kk < 1) {
    const sh = k.stopShift * qe.w * (1 - profile.exit.kk);
    if (sh > 0.05) polys.push(disc(qe.x + cd[0] * sh, qe.y + cd[1] * sh, re * 0.92));
  }

  // 折角外侧「耳」：进段外边线与出段外边线的斜接点，再沿外角平分线推出；钩的转角改为圆顿（规格 §4.4）
  const hwAt = s0 => {
    const q = posAtW(S, s0);
    return q;
  };
  for (const cr of profile.corners || []) {
    const q = S[cr.i];
    if (profile.hook && profile.hook.s === cr.s) {
      const r = q.w / 2 * (1 + k.hookPress / 2);
      const sh = k.hookPressShift * q.w;
      polys.push(disc(q.x + cd[0] * sh, q.y + cd[1] * sh, r));
      continue;
    }
    const a = posAt(S, q.s - k.cornerWin);
    const b = posAt(S, q.s + k.cornerWin);
    const din = [q.x - a.x, q.y - a.y];
    const dout = [b.x - q.x, b.y - q.y];
    const li = Math.hypot(...din) || 1;
    const lo = Math.hypot(...dout) || 1;
    din[0] /= li;
    din[1] /= li;
    dout[0] /= lo;
    dout[1] /= lo;
    const sgn = cr.turn > 0 ? -1 : 1; // 外侧在 sgn·N
    const hwIn = hwAt(q.s - k.cornerWin) / 2;
    const hwOut = hwAt(q.s + k.cornerWin) / 2;
    const nIn = [-din[1] * sgn, din[0] * sgn];
    const nOut = [-dout[1] * sgn, dout[0] * sgn];
    const A = [q.x + nIn[0] * hwIn, q.y + nIn[1] * hwIn];
    const C = [q.x + nOut[0] * hwOut, q.y + nOut[1] * hwOut];
    // 线 A + u·din 与 C + v·dout 求交
    const den = din[0] * dout[1] - din[1] * dout[0];
    let M;
    if (Math.abs(den) < 1e-6) M = [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2];
    else {
      const u = ((C[0] - A[0]) * dout[1] - (C[1] - A[1]) * dout[0]) / den;
      M = [A[0] + din[0] * u, A[1] + din[1] * u];
    }
    let bx = M[0] - q.x;
    let by = M[1] - q.y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const hwMax = Math.max(hwIn, hwOut);
    const reach = Math.min(bl + k.cornerBoost * hwOut, k.miterLimit * hwMax);
    M = [q.x + bx * reach, q.y + by * reach];
    polys.push(orient([[q.x, q.y], A, M, C]));
  }
  return finish(polys);
}

function finish(polys) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { polys, bbox: [x0, y0, x1, y1] };
}

/** 非零规则并集面积（扫描线，行距 h 单位）。所有多边形已是逆时针，故并集 = 环绕数 > 0 的区域。 */
export function unionArea(geom, h = 0.1) {
  const [x0, y0, x1, y1] = geom.bbox;
  if (!(y1 > y0)) return 0;
  const rows = Math.ceil((y1 - y0) / h);
  const cross = Array.from({ length: rows }, () => []);
  for (const poly of geom.polys) {
    for (let i = 0; i < poly.length; i += 1) {
      const A = poly[i];
      const Bp = poly[(i + 1) % poly.length];
      if (A[1] === Bp[1]) continue;
      const dir = Bp[1] > A[1] ? 1 : -1;
      const ya = Math.min(A[1], Bp[1]);
      const yb = Math.max(A[1], Bp[1]);
      const r0 = Math.max(0, Math.ceil((ya - y0) / h - 0.5));
      const r1 = Math.min(rows - 1, Math.floor((yb - y0) / h - 0.5));
      for (let r = r0; r <= r1; r += 1) {
        const y = y0 + (r + 0.5) * h;
        if (y < ya || y >= yb) continue;
        const u = (y - A[1]) / (Bp[1] - A[1]);
        cross[r].push([A[0] + (Bp[0] - A[0]) * u, dir]);
      }
    }
  }
  let area = 0;
  for (const row of cross) {
    if (!row.length) continue;
    row.sort((a, b) => a[0] - b[0]);
    let wnd = 0;
    let start = 0;
    for (const [x, d] of row) {
      const was = wnd !== 0;
      wnd += d;
      if (!was && wnd !== 0) start = x;
      else if (was && wnd === 0) area += x - start;
    }
  }
  return area * h;
}

/** 整个字（多笔）→ 每笔 {profile, geom}。 */
export function renderStrokes(strokes, opts = {}) {
  return strokes.map(raw => {
    const profile = analyze(raw, opts);
    return { profile, geom: geometry(profile, opts) };
  });
}
