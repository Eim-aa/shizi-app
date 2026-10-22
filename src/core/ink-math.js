// 笔迹管线（01-架构设计 §6.2；决定-D09 / D10；交接备注八.1）+ 存储编码 / 解码 / 抽点（01 §3.5）。
// 纯模块：不碰 DOM / window / localStorage，node:test 直接跑（test/core/ink-math.test.mjs）。
//
// 参考实现：原型 docs/design/v10/extracted/ink-第十稿交接版.js（SZInk.build），逐步对照见
// docs/engineering/v10/reference/L-proto-model-ink.md §3.7。本模块与原型的差异：
//   1. 压感（D10）：原型没有压力路径。这里在 pointerType==='pen' 且 p>0 时用压力因子**替代**速度因子
//      （不叠乘），压力因子沿旧版 index.html:2198（639f592）`.58 + √p × .94`，夹在 [.58, 1.52]
//      ——交接备注「Pencil 压感照现有实现」。起笔 / 收笔 / 点画倍数照乘。
//   2. Catmull-Rom 同时插值 t 与 p（原型只插 t），保证压感笔在重采样后仍有压力。
//   3. 输出点带 t（ms），供存储编码（dt）与笔锋细节（飞白 / 洇墨）用。
//
// 单位：坐标为书写格内部 345×345 单位（01 §6.1，与显示尺寸无关）；时间 ms；输出 {x, y, w, t, p?}，w 为绝对笔宽（单位同坐标）。
//
// 常量：手感参数（BASE、收笔阈值 LO/HI、压力映射、重采样步长、收尖段与 1€ 滤波等原型细节）是「待真机」起始值，
// 登记为 03-待产品决定 P65，默认读 src/config/policy.js 的 policy.ink；已定规格（INK_SPEC：speedCap / tau / window /
// dotLen / single，交接备注八.1、D09）留在本模块。两者合成 INK（默认表）；opts.policy 注入整张 policy，
// opts 上的同名数值键（base / lo / hi / step / pressureLo …）覆盖单项。
// 抽点上限读 policy.inkMaxPointsPerStroke / inkMaxStrokes（P05）；存储编码为 v3 打包（P78），读取兼容 v2。

import * as defaultPolicy from '../config/policy.js';

/** 书写格内部边长（01 §6.1）。 */
export const GRID = 345;

/** 已定规格（交接备注八.1、D09）：不是待定项，不进 policy。 */
export const INK_SPEC = Object.freeze({
  speedCap: 1.5, // 本体宽公式里 v 的上限：BASE × (1.06 − 0.12·min(v, 1.5))
  tau: 35, // 宽度按时间平滑：α = 1 − e^(−Δt/35ms)
  window: 30, // 收笔看抬笔前 30ms 平均速度
  dotLen: 24, // 点画：抬笔后总长 < 24
  single: 0.9, // 单点直径 = 0.9 × 本体宽
});

/** policy.ink（P65 手感参数）里的键；opts 上同名的有限数值覆盖单项。 */
export const INK_TUNABLE_KEYS = Object.freeze([
  'base', 'lo', 'hi', 'pressureLo', 'pressureGain', 'pressureHi', 'step',
  'tapMax', 'tapRatio', 'endMinSlow', 'endMinFast', 'euroMinCutoff', 'euroBeta', 'euroDCutoff',
]);

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/** 笔迹参数表：policy.ink（P65，缺键时报错而不是悄悄补值）+ 已定规格 INK_SPEC。 */
export function inkParams(policy = defaultPolicy) {
  const tunable = policy && policy.ink;
  if (!tunable || typeof tunable !== 'object') throw new TypeError('policy.ink (P65) is missing');
  const out = {};
  for (const key of INK_TUNABLE_KEYS) {
    if (!(typeof tunable[key] === 'number' && Number.isFinite(tunable[key]))) throw new TypeError(`policy.ink.${key} (P65) is not a finite number`);
    out[key] = tunable[key];
  }
  return Object.freeze({ ...out, ...INK_SPEC });
}

/** 默认参数表（policy.ink + INK_SPEC）。 */
export const INK = inkParams(defaultPolicy);

function params(opts) {
  if (!opts) return INK;
  const table = opts.policy ? inkParams(opts.policy) : INK;
  let out = null;
  for (const key of INK_TUNABLE_KEYS) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v) && v !== table[key]) {
      if (!out) out = { ...table };
      out[key] = v;
    }
  }
  return out || table;
}

/** 速度因子（本体宽 / BASE）：1.06 − 0.12·min(v, 1.5)。 */
export function speedFactor(v, k = INK) {
  return 1.06 - 0.12 * Math.min(Math.max(0, v), k.speedCap);
}

/** 压力因子（本体宽 / BASE），仅 pen 且 p>0 时使用（D10：替代速度因子，不叠乘）。 */
export function pressureFactor(p, k = INK) {
  return clamp(k.pressureLo + Math.sqrt(clamp(p, 0, 1)) * k.pressureGain, k.pressureLo, k.pressureHi);
}

function hasPressure(point) {
  return typeof point.p === 'number' && point.p > 0;
}

// ---------------------------------------------------------------- 1€ 滤波 / Catmull-Rom

function oneEuro(minCutoff, beta, dCutoff) {
  let xp = null;
  let dxp = 0;
  let tp = null;
  const alpha = (fc, dt) => 1 / (1 + 1 / (2 * Math.PI * fc) / dt);
  return (x, t) => {
    if (xp === null) {
      xp = x;
      tp = t;
      return x;
    }
    const dt = t - tp;
    if (!(dt > 0)) return xp;
    const dx = (x - xp) / dt;
    const ad = alpha(dCutoff, dt);
    const dxh = ad * dx + (1 - ad) * dxp;
    const a = alpha(minCutoff + beta * Math.abs(dxh), dt);
    const xh = a * x + (1 - a) * xp;
    xp = xh;
    dxp = dxh;
    tp = t;
    return xh;
  };
}

/**
 * Catmull-Rom（均匀，τ=.5），首尾点重复，每段 max(1, ceil(段长/step)) 个点；t / p / w（若有）在段内线性插值。
 * 输入输出都是 {x, y, t, p?, w?}。
 */
export function catmullRom(points, step = INK.step) {
  if (!Array.isArray(points) || points.length < 2) return (points || []).map(p => ({ ...p }));
  const out = [];
  const P = [points[0], ...points, points[points.length - 1]];
  const lerp = (a, b, u) => a + (b - a) * u;
  for (let i = 1; i < P.length - 2; i += 1) {
    const a = P[i - 1];
    const b = P[i];
    const c = P[i + 1];
    const d = P[i + 2];
    const n = Math.max(1, Math.ceil(Math.hypot(c.x - b.x, c.y - b.y) / step));
    for (let j = 0; j < n; j += 1) {
      const u = j / n;
      const u2 = u * u;
      const u3 = u2 * u;
      const x = 0.5 * (2 * b.x + (-a.x + c.x) * u + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * u2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * u3);
      const y = 0.5 * (2 * b.y + (-a.y + c.y) * u + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * u2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * u3);
      const t = lerp(num(b.t, 0), num(c.t, 0), u);
      // 一次字面量建好全部字段（键序同前：x, y, t, p?, w?）：事后再加 p / w 会让每个点多挂一个 PropertyArray
      // （M6-3 61-perf：缩略图保持挂载时点列占 JS 堆的大头）。
      const hasP = hasPressure(b) || hasPressure(c);
      const hasW = typeof b.w === 'number' && typeof c.w === 'number';
      let q;
      if (hasP && hasW) q = { x, y, t, p: lerp(num(b.p, 0), num(c.p, 0), u), w: lerp(b.w, c.w, u) };
      else if (hasP) q = { x, y, t, p: lerp(num(b.p, 0), num(c.p, 0), u) };
      else if (hasW) q = { x, y, t, w: lerp(b.w, c.w, u) };
      else q = { x, y, t };
      out.push(q);
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

// ---------------------------------------------------------------- 采样整理

/**
 * 同一时间戳的采样合并（留最后的位置，D09「零时间差点合并、不参与速度计算」）；坏点丢弃。
 * 输入 {x, y, t, p?}；输出新数组。
 */
export function mergeSameTime(raw) {
  const out = [];
  for (const r of raw || []) {
    if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
    const q = { x: r.x, y: r.y, t: num(r.t, out.length ? out[out.length - 1].t : 0) };
    if (hasPressure(r)) q.p = clamp(r.p, 0, 1);
    if (out.length && q.t === out[out.length - 1].t) out[out.length - 1] = q;
    else out.push(q);
  }
  return out;
}

/**
 * 抬笔前 `window` ms 的平均速度（pt/ms）：窗口插值到恰好 30ms，分子分母取同一段（与刷新率无关）；
 * 整笔短于 30ms 时用整段时长（D09）。只用合并后的原始点。点数 < 2 返回 null。
 */
export function liftSpeed(merged, windowMs = INK.window) {
  const n = merged.length;
  if (n < 2) return null;
  const tl = merged[n - 1].t;
  const t0 = tl - windowMs;
  let i = n - 1;
  let d = 0;
  while (i > 0 && merged[i - 1].t >= t0) {
    d += Math.hypot(merged[i].x - merged[i - 1].x, merged[i].y - merged[i - 1].y);
    i -= 1;
  }
  let dt = tl - merged[i].t;
  if (i > 0) {
    const a = merged[i - 1];
    const b = merged[i];
    const u = (b.t - t0) / (b.t - a.t);
    d += Math.hypot(b.x - a.x, b.y - a.y) * u;
    dt = windowMs;
  }
  return dt > 0 ? d / dt : 0;
}

// ---------------------------------------------------------------- 主管线

/**
 * 原始采样 → 带宽度的点列（01 §6.2）。
 * @param {Array<{x:number,y:number,t:number,p?:number}>} raw  345 空间、ms；p 仅 pen（>0 才算有压力）
 * @param {object} [opts]
 * @param {boolean} [opts.final=false]  已抬笔：锁尾、收笔、点画判定
 * @param {number} [opts.base]  本体宽（默认 policy.ink.base，P65）
 * @param {number} [opts.lo] [opts.hi]  收笔阈值（默认 policy.ink.lo / hi，P65）；其它 INK_TUNABLE_KEYS 同样可覆盖
 * @param {object} [opts.policy]  注入整张 policy（读其 ink 表）
 * @returns {Array<{x,y,w,t,p?}>} 附属性 v30 / dot / single / endK / pressure（数组上的属性，不进 JSON）
 */
export function buildStroke(raw, opts = {}) {
  const k = params(opts);
  const base = k.base;
  const final = opts.final === true;
  const m = mergeSameTime(raw);
  if (!m.length) {
    const empty = [];
    empty.v30 = null;
    empty.dot = false;
    empty.single = false;
    empty.endK = 0;
    empty.pressure = false;
    return empty;
  }
  const pressure = m.some(hasPressure);
  const fx = oneEuro(k.euroMinCutoff, k.euroBeta, k.euroDCutoff);
  const fy = oneEuro(k.euroMinCutoff, k.euroBeta, k.euroDCutoff);
  const f = m.map(r => {
    const q = { x: fx(r.x, r.t / 1000), y: fy(r.y, r.t / 1000), t: r.t };
    if (r.p !== undefined) q.p = r.p;
    return q;
  });
  if (final && m.length > 1) f[f.length - 1] = { ...m[m.length - 1] }; // 抬笔锁尾到原始末点
  const p = catmullRom(f, k.step);
  const n = p.length;
  const L = [0];
  for (let i = 1; i < n; i += 1) L.push(L[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y));
  const len = L[n - 1];

  // 单点：直径 0.9 × 本体宽（D09）。有压力时本体宽按压力。
  if (m.length === 1 || len === 0) {
    const last = p[n - 1];
    const body = hasPressure(last) ? base * pressureFactor(last.p, k) : base;
    const q = { x: last.x, y: last.y, w: body * k.single, t: last.t };
    if (hasPressure(last)) q.p = last.p;
    const o = [q];
    o.v30 = null;
    o.dot = true;
    o.single = true;
    o.endK = q.w / base;
    o.pressure = pressure;
    return o;
  }

  const dot = final && len < k.dotLen;
  const v30 = final ? liftSpeed(m, k.window) : null;
  const vv = v30 === null ? 0.5 : v30;
  const kk = clamp((vv - k.lo) / Math.max(1e-6, k.hi - k.lo), 0, 1);
  const endMin = k.endMinSlow + (k.endMinFast - k.endMinSlow) * kk;
  const tap = Math.min(k.tapMax, len * k.tapRatio);

  let w = hasPressure(p[0]) ? base * pressureFactor(p[0].p, k) : base;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    if (i > 0) {
      const dt = p[i].t - p[i - 1].t;
      if (dt > 0) {
        const target = hasPressure(p[i])
          ? base * pressureFactor(p[i].p, k) // D10：压力替代速度，不叠乘
          : base * speedFactor((L[i] - L[i - 1]) / dt, k);
        w += (target - w) * (1 - Math.exp(-dt / k.tau));
      }
    }
    const s = L[i];
    let fct;
    if (dot) {
      const u = len ? s / len : 0;
      fct = u < 0.5 ? 0.7 + (1.1 - 0.7) * (u / 0.5) : 1.1 + (0.9 - 1.1) * ((u - 0.5) / 0.5);
    } else {
      fct = s < 6 ? 0.85 + 0.23 * (s / 6) : s < 12 ? 1.08 - 0.08 * ((s - 6) / 6) : 1;
      if (final && kk > 0 && len - s < tap) {
        const u = (len - s) / tap;
        fct *= endMin + (1 - endMin) * u;
      }
    }
    const q = { x: p[i].x, y: p[i].y, w: w * fct, t: p[i].t };
    if (hasPressure(p[i])) q.p = p[i].p;
    out.push(q);
  }
  out.v30 = v30;
  out.dot = dot;
  out.single = false;
  out.endK = out[n - 1].w / base;
  out.pressure = pressure;
  return out;
}

/** 总弧长。 */
export function strokeLength(points) {
  let len = 0;
  for (let i = 1; i < (points || []).length; i += 1) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

// ---------------------------------------------------------------- 抽点（01 §3.5）

/**
 * 按弧长均匀抽点到 ≤ max 个：首末点必留；目标弧长位置取最近的原始点（不新造点，w / t / p 保持原值）。
 */
export function thinStroke(points, max = defaultPolicy.inkMaxPointsPerStroke) {
  const n = (points || []).length;
  const cap = Math.max(2, Math.floor(max));
  if (n <= cap) return (points || []).map(p => ({ ...p }));
  const L = [0];
  for (let i = 1; i < n; i += 1) L.push(L[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const len = L[n - 1];
  if (!(len > 0)) {
    // 原地抖动（无位移）：按下标均匀取
    const idx = [];
    for (let j = 0; j < cap; j += 1) idx.push(Math.round((j * (n - 1)) / (cap - 1)));
    return [...new Set(idx)].map(i => ({ ...points[i] }));
  }
  const picked = [0];
  let i = 0;
  for (let j = 1; j < cap - 1; j += 1) {
    const target = (j * len) / (cap - 1);
    while (i < n - 1 && L[i + 1] <= target) i += 1;
    let best = i;
    if (i < n - 1 && Math.abs(L[i + 1] - target) < Math.abs(L[i] - target)) best = i + 1;
    if (best <= picked[picked.length - 1]) best = picked[picked.length - 1] + 1;
    if (best >= n - 1) break;
    picked.push(best);
  }
  picked.push(n - 1);
  return picked.map(k => ({ ...points[k] }));
}

/**
 * 存储前按误差自适应抽点（P121，阶段 1 P1-E3）：从首末两点起，反复在「回放误差最大」的位置插回一个原始点，
 * 直到每段误差都在容差内或点数到 max（不新造点，w / t / p 保持原值）。误差 = 下面三项各除以容差后的最大值：
 *   位置：点到所在段首末连线的距离；笔宽 / 时间：与段内按弧长线性插值的差（回放时 Catmull-Rom 对 w / t 也是线性插值）。
 * 直的、匀速的笔画只留很少的点；弯、钩、收笔变细、停顿处点多。tolerance 为 null 时退回 thinStroke（按弧长均匀抽点）。
 * @param {Array<{x,y,w,t?}>} points
 * @param {{max?:number, tolerance?:{xy:number, w:number, t:number}|null}} [opts]
 */
export function simplifyStroke(points, opts = {}) {
  const max = num(opts.max, defaultPolicy.inkMaxPointsPerStroke);
  const tol = opts.tolerance === undefined ? defaultPolicy.inkStoreTolerance : opts.tolerance;
  if (!tol) return thinStroke(points, max);
  const pts = points || [];
  const n = pts.length;
  const cap = Math.max(2, Math.floor(max));
  if (n <= 2) return pts.map(p => ({ ...p }));
  const txy = num(tol.xy, 0.3) > 0 ? num(tol.xy, 0.3) : 0.3;
  const tw = num(tol.w, 0.3) > 0 ? num(tol.w, 0.3) : 0.3;
  const tt = num(tol.t, 24) > 0 ? num(tol.t, 24) : 24;
  const L = [0];
  for (let i = 1; i < n; i += 1) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const worst = (a, b) => {
    const A = pts[a];
    const B = pts[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L2 = dx * dx + dy * dy;
    const span = L[b] - L[a];
    const wa = num(A.w, 0);
    const wb = num(B.w, 0);
    const ta = num(A.t, null);
    const tb = num(B.t, null);
    let err = 0;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const P = pts[i];
      const s = L2 > 0 ? clamp(((P.x - A.x) * dx + (P.y - A.y) * dy) / L2, 0, 1) : 0;
      const u = span > 0 ? (L[i] - L[a]) / span : (i - a) / (b - a);
      let e = Math.hypot(A.x + dx * s - P.x, A.y + dy * s - P.y) / txy;
      e = Math.max(e, Math.abs(wa + (wb - wa) * u - num(P.w, 0)) / tw);
      const tp = num(P.t, null);
      if (ta !== null && tb !== null && tp !== null) e = Math.max(e, Math.abs(ta + (tb - ta) * u - tp) / tt);
      if (e > err) {
        err = e;
        at = i;
      }
    }
    return { a, b, at, err };
  };
  // 回放核对：均匀 Catmull-Rom 在相邻段长悬殊处（长直段接短钩）会冲出去，连线误差看不到——
  // 按回放公式（与 catmullRom 同一组系数、同一步长）逐段取样，量到原始折线的距离，超过 REPLAY_FACTOR × 位置容差也要再插点。
  const replayLimit = txy * REPLAY_FACTOR;
  const step = INK.step;
  const distToRange = (x, y, a, b) => {
    let best = Infinity;
    for (let i = Math.max(0, a - 1); i < Math.min(n - 1, b + 1); i += 1) {
      const P = pts[i];
      const Q = pts[i + 1];
      const dx = Q.x - P.x;
      const dy = Q.y - P.y;
      const L2 = dx * dx + dy * dy;
      const s = L2 > 0 ? clamp(((x - P.x) * dx + (y - P.y) * dy) / L2, 0, 1) : 0;
      const d = Math.hypot(P.x + dx * s - x, P.y + dy * s - y);
      if (d < best) best = d;
    }
    return best;
  };
  const replayErr = (segs, j) => {
    const g = segs[j];
    const A = pts[j > 0 ? segs[j - 1].a : g.a];
    const B = pts[g.a];
    const C = pts[g.b];
    const D = pts[j + 1 < segs.length ? segs[j + 1].b : g.b];
    const m = Math.max(1, Math.ceil(Math.hypot(C.x - B.x, C.y - B.y) / step));
    let err = 0;
    for (let k = 1; k < m; k += 1) {
      const u = k / m;
      const u2 = u * u;
      const u3 = u2 * u;
      const x = 0.5 * (2 * B.x + (-A.x + C.x) * u + (2 * A.x - 5 * B.x + 4 * C.x - D.x) * u2 + (-A.x + 3 * B.x - 3 * C.x + D.x) * u3);
      const y = 0.5 * (2 * B.y + (-A.y + C.y) * u + (2 * A.y - 5 * B.y + 4 * C.y - D.y) * u2 + (-A.y + 3 * B.y - 3 * C.y + D.y) * u3);
      err = Math.max(err, distToRange(x, y, g.a, g.b) / replayLimit);
    }
    return err;
  };
  const midIndex = (a, b) => {
    const half = (L[a] + L[b]) / 2;
    let i = a + 1;
    while (i < b - 1 && L[i] < half) i += 1;
    return i;
  };
  const segs = [worst(0, n - 1)];
  segs[0].rep = replayErr(segs, 0);
  let count = 2;
  while (count < cap) {
    let k = -1;
    let score = 1;
    for (let j = 0; j < segs.length; j += 1) {
      const g = segs[j];
      if (g.b - g.a < 2) continue; // 没有内部点可插
      const e = Math.max(g.err, g.rep);
      if (e > score) {
        score = e;
        k = j;
      }
    }
    if (k < 0) break;
    const g = segs[k];
    const at = g.err > 1 && g.at > g.a ? g.at : midIndex(g.a, g.b);
    segs.splice(k, 1, worst(g.a, at), worst(at, g.b));
    for (let j = Math.max(0, k - 1); j <= Math.min(segs.length - 1, k + 2); j += 1) segs[j].rep = replayErr(segs, j);
    count += 1;
  }
  const keep = [0];
  for (const g of segs) keep.push(g.b); // segs 按位置有序（每次原地拆成相邻两段）
  return keep.map(i => ({ ...pts[i] }));
}

/** 回放核对的位置容差倍数（simplifyStroke）：回放曲线离原始折线超过 3 × 位置容差（过渡 0.9 单位）就再插点。 */
const REPLAY_FACTOR = 3;

// ---------------------------------------------------------------- 存储编码 Ink v3（01 §3.5，P78）

/** v3 的 dt 量化档（ms，16 档，近似对数）：回放只需大致速度（P78）。编码取对数距离最近的档。 */
export const INK_DT_LEVELS = Object.freeze([0, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 512, 1024, 2048]);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const m = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i += 1) m[B64.charCodeAt(i)] = i;
  return m;
})();
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** 字节数组 → 标准 base64（带 = 补位）。纯 JS，不依赖 btoa / Buffer。 */
export function bytesToBase64(bytes) {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i];
    const b = i + 1 < n ? bytes[i + 1] : 0;
    const c = i + 2 < n ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)]
      + (i + 1 < n ? B64[((b & 15) << 2) | (c >> 6)] : '=')
      + (i + 2 < n ? B64[c & 63] : '=');
  }
  return out;
}

/** 是否是合法的标准 base64 串（长度 4 的倍数、补位正确）。 */
export function isBase64(str) {
  return typeof str === 'string' && str.length % 4 === 0 && B64_RE.test(str);
}

/** 标准 base64 → Uint8Array；不合法返回 null。 */
export function base64ToBytes(str) {
  if (!isBase64(str)) return null;
  const pad = str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0;
  const len = (str.length / 4) * 3 - pad;
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < str.length; i += 4) {
    const a = B64_INDEX[str.charCodeAt(i)];
    const b = B64_INDEX[str.charCodeAt(i + 1)];
    const c = str[i + 2] === '=' ? 0 : B64_INDEX[str.charCodeAt(i + 2)];
    const d = str[i + 3] === '=' ? 0 : B64_INDEX[str.charCodeAt(i + 3)];
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < len) out[o++] = (v >> 16) & 255;
    if (o < len) out[o++] = (v >> 8) & 255;
    if (o < len) out[o++] = v & 255;
  }
  return out;
}

/** ms 差 → 0–15 档（对数距离最近；负数按 0）。 */
export function quantizeDt(ms) {
  const want = Math.max(0, num(ms, 0));
  const lw = Math.log1p(want);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < INK_DT_LEVELS.length; i += 1) {
    const d = Math.abs(Math.log1p(INK_DT_LEVELS[i]) - lw);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * 管线输出（每笔 {x,y,w,t,p?}，345 空间）→ Ink v3 打包编码（P78）：
 *   { v:3, c:345, s:['<base64>', …], p?:['<base64>', …] }
 *   s 每笔一个 base64 串，每点 4 字节（大端 32 位）：x 10 位 | y 10 位 | w 8 位 | dt 4 位
 *     x / y：坐标 / 345 × 1000 取整，夹到 0–1023（落在格外稍远的点被夹到边上）；
 *     w：本体宽倍数 ×100（w / base × 100），夹到 0–255；
 *     dt：相邻点 ms 差量化到 INK_DT_LEVELS 的 16 档（每笔第一个点 = 距上一笔最后一点的间隔，第一笔为 0；
 *         笔内按累计时间做误差补偿，笔间间隔单独量化、不把长停顿的误差带进下一笔）。
 *   p：仅当有 pen 压力时出现，每点 1 字节（压力 ×255，有压力的点至少 1；无压力的点为 0）。
 * 存储前每笔按误差自适应抽点（simplifyStroke，容差 policy.inkStoreTolerance，P121），点数 ≤ inkMaxPointsPerStroke（过渡 24）；
 * opts.tolerance=null 时按弧长均匀抽点（thinStroke，P78 原口径）。超过 inkMaxStrokes 笔只留前 inkMaxStrokes 笔（P05）。
 * @param {Array<Array<{x,y,w,t?,p?}>>} strokes
 * @param {{base?:number, maxPoints?:number, maxStrokes?:number, tolerance?:object|null, policy?:object}} [opts]
 */
export function encodeInk(strokes, opts = {}) {
  const policy = opts.policy || defaultPolicy;
  const base = num(opts.base, opts.policy ? inkParams(policy).base : INK.base);
  const maxPoints = num(opts.maxPoints, policy.inkMaxPointsPerStroke);
  const maxStrokes = num(opts.maxStrokes, policy.inkMaxStrokes);
  const kept = (strokes || []).filter(s => Array.isArray(s) && s.length > 0).slice(0, Math.max(0, Math.floor(maxStrokes)));
  const tolerance = opts.tolerance !== undefined ? opts.tolerance : policy.inkStoreTolerance || null;
  const thinned = kept.map(s => simplifyStroke(s, { max: maxPoints, tolerance }));
  const withPressure = thinned.some(s => s.some(hasPressure));
  const s = [];
  const p = [];
  let t0 = null; // 整份墨迹第一个点的时间
  let lastRel = 0; // 上一个点的真实相对时间（取整、单调）
  for (const stroke of thinned) {
    const bytes = new Uint8Array(stroke.length * 4);
    const pbytes = withPressure ? new Uint8Array(stroke.length) : null;
    let strokeRel0 = 0; // 本笔第一个点的真实相对时间
    let decWithin = 0; // 本笔内已编码的量化时间累计
    stroke.forEach((pt, j) => {
      const x = clamp(Math.round((num(pt.x, 0) / GRID) * 1000), 0, 1023);
      const y = clamp(Math.round((num(pt.y, 0) / GRID) * 1000), 0, 1023);
      const w = clamp(Math.round((num(pt.w, base) / base) * 100), 0, 255);
      const t = num(pt.t, null);
      let rel = lastRel;
      if (t !== null) {
        if (t0 === null) t0 = t;
        rel = Math.max(lastRel, Math.round(t - t0));
      }
      let q;
      if (j === 0) {
        q = quantizeDt(rel - lastRel);
        strokeRel0 = rel;
        decWithin = 0;
      } else {
        q = quantizeDt(rel - strokeRel0 - decWithin);
        decWithin += INK_DT_LEVELS[q];
      }
      lastRel = rel;
      const o = j * 4;
      bytes[o] = x >> 2;
      bytes[o + 1] = ((x & 3) << 6) | (y >> 4);
      bytes[o + 2] = ((y & 15) << 4) | (w >> 4);
      bytes[o + 3] = ((w & 15) << 4) | q;
      if (pbytes) pbytes[j] = hasPressure(pt) ? Math.max(1, Math.round(clamp(pt.p, 0, 1) * 255)) : 0;
    });
    s.push(bytesToBase64(bytes));
    if (pbytes) p.push(bytesToBase64(pbytes));
  }
  const ink = { v: 3, c: GRID, s };
  if (withPressure) ink.p = p;
  return ink;
}

/** 旧 InkV2（JSON 数字编码，M4-5 前写入的数据）形状是否合法（与 core/schema.js 同口径，再加行长度一致）。 */
export function isInkV2(ink) {
  if (!ink || typeof ink !== 'object' || ink.v !== 2 || !Number.isFinite(ink.c) || ink.c <= 0) return false;
  if (!Array.isArray(ink.s)) return false;
  const intRow = r => Array.isArray(r) && r.every(Number.isInteger);
  if (!ink.s.every(r => intRow(r) && r.length % 3 === 0)) return false;
  if (ink.dt !== undefined && !(Array.isArray(ink.dt) && ink.dt.length === ink.s.length
    && ink.dt.every((r, i) => intRow(r) && r.length === ink.s[i].length / 3))) return false;
  if (ink.p !== undefined && !(Array.isArray(ink.p) && ink.p.length === ink.s.length
    && ink.p.every((r, i) => intRow(r) && r.length === ink.s[i].length / 3))) return false;
  return true;
}

/** Ink v3 形状是否合法：s / p 为 base64 串，s 每串字节数是 4 的倍数，p 与 s 逐笔点数一致。 */
export function isInkV3(ink) {
  if (!ink || typeof ink !== 'object' || ink.v !== 3 || !Number.isFinite(ink.c) || ink.c <= 0) return false;
  if (!Array.isArray(ink.s) || ink.dt !== undefined) return false;
  const counts = [];
  for (const str of ink.s) {
    const bytes = base64ToBytes(str);
    if (!bytes || bytes.length % 4 !== 0) return false;
    counts.push(bytes.length / 4);
  }
  if (ink.p !== undefined) {
    if (!Array.isArray(ink.p) || ink.p.length !== ink.s.length) return false;
    for (let i = 0; i < ink.p.length; i += 1) {
      const bytes = base64ToBytes(ink.p[i]);
      if (!bytes || bytes.length !== counts[i]) return false;
    }
  }
  return true;
}

/** 可读的墨迹（v4 原始点 / v3 / 旧 v2）。 */
export function isInk(ink) {
  return isInkV4(ink) || isInkV3(ink) || isInkV2(ink);
}

/**
 * Ink（v4 原始点 / v3 打包 / 旧 v2）→ 每笔 {x, y, w, t, p?}（345 空间，w 为绝对宽；t 从 0 起的累计 ms）。形状不合法返回 null。
 * v4 没有存宽度：按当前笔锋参数（opts 同 buildStroke）重算，与书写时一致；v3 / v2 是烘焙好的宽度。
 * 回放 / 缩略图渲染前再走 catmullRom（resampleForReplay）保证外观与书写时一致（01 §3.5）。
 */
export function decodeInk(ink, opts = {}) {
  if (ink && typeof ink === 'object' && ink.v === 4) return decodeInkV4(ink, opts); // 合法性由解码本身判（不合法返回 null），不先整份解包校验一遍
  const base = num(opts.base, opts.policy ? inkParams(opts.policy).base : INK.base);
  const scale = GRID / 1000;
  if (isInkV3(ink)) {
    let t = 0;
    return ink.s.map((str, si) => {
      const bytes = base64ToBytes(str);
      const pbytes = ink.p ? base64ToBytes(ink.p[si]) : null;
      const pts = [];
      for (let o = 0; o < bytes.length; o += 4) {
        const x = (bytes[o] << 2) | (bytes[o + 1] >> 6);
        const y = ((bytes[o + 1] & 63) << 4) | (bytes[o + 2] >> 4);
        const w = ((bytes[o + 2] & 15) << 4) | (bytes[o + 3] >> 4);
        t += INK_DT_LEVELS[bytes[o + 3] & 15];
        const q = { x: x * scale, y: y * scale, w: (w / 100) * base, t };
        if (pbytes && pbytes[o / 4] > 0) q.p = pbytes[o / 4] / 255;
        pts.push(q);
      }
      return pts;
    });
  }
  if (!isInkV2(ink)) return null;
  let t = 0;
  return ink.s.map((row, si) => {
    const pts = [];
    for (let j = 0; j < row.length; j += 3) {
      const idx = j / 3;
      t += ink.dt ? ink.dt[si][idx] : 0;
      const q = { x: row[j] * scale, y: row[j + 1] * scale, w: (row[j + 2] / 100) * base, t };
      if (ink.p && ink.p[si][idx] > 0) q.p = ink.p[si][idx] / 100;
      pts.push(q);
    }
    return pts;
  });
}

/** 解码后的每笔再过一次 Catmull-Rom（w / t / p 线性插值），得到可直接交给笔锋渲染的点列。 */
export function resampleForReplay(decoded, step = INK.step) {
  return (decoded || []).map(pts => catmullRom(pts, step));
}

// ---------------------------------------------------------------- 会话现场的原始笔画编码（供 M1-6 写 sessions.current.strokes）

/**
 * 原始采样（每笔 {x,y,t,p?}）→ 整数数组（每笔一行，形状层只要求「笔 = 数组」，core/schema.js currentFields）：
 *   [stride, x, y, dt, (p), x, y, dt, (p), …]   stride = 3（无压力）或 4（pen 压力 ×1000）；
 *   x / y ×10（0.1 单位精度）；dt 为相对本笔第一个点的累计取整后的相邻差（第一个点 0）。
 * 原始采样全精度保留到 0.1 单位 / 1ms，恢复后重跑 buildStroke 与书写时一致（W10）。
 */
export function encodeRawStrokes(rawStrokes) {
  return (rawStrokes || []).filter(s => Array.isArray(s) && s.length).map(stroke => {
    const pen = stroke.some(hasPressure);
    const row = [pen ? 4 : 3];
    const t0 = num(stroke[0].t, 0);
    let last = 0;
    for (const pt of stroke) {
      const rel = Math.max(last, Math.round(num(pt.t, t0) - t0));
      row.push(Math.round(pt.x * 10), Math.round(pt.y * 10), rel - last);
      if (pen) row.push(hasPressure(pt) ? Math.round(clamp(pt.p, 0, 1) * 1000) : 0);
      last = rel;
    }
    return row;
  });
}

/** encodeRawStrokes 的逆；坏行跳过。t 从 0 起（每笔各自从 0 起）。 */
export function decodeRawStrokes(rows) {
  const out = [];
  for (const row of rows || []) {
    if (!Array.isArray(row) || !row.every(Number.isInteger)) continue;
    const stride = row[0];
    if ((stride !== 3 && stride !== 4) || (row.length - 1) % stride !== 0 || row.length < 1 + stride) continue;
    const pts = [];
    let t = 0;
    for (let j = 1; j < row.length; j += stride) {
      t += row[j + 2];
      const q = { x: row[j] / 10, y: row[j + 1] / 10, t };
      if (stride === 4 && row[j + 3] > 0) q.p = row[j + 3] / 1000;
      pts.push(q);
    }
    out.push(pts);
  }
  return out;
}

// ---------------------------------------------------------------- 存储编码 Ink v4：原始点（B2.3，规格 §6.4，DQ2-C）
//
// 与会话现场 / 桥上的 encodeRawStrokes 是同一份点、同一精度（x / y 0.1 单位、dt 1ms、p 0.001），只是按笔打包成字节：
// 一行 [stride, x, y, dt, (p), …] ↔ 一个 base64 串，互逆、无损（rawRowToPacked / packedToRawRow）。打包是因为 JSON 整数
// 每点约 13 个字符，实测（test/core/ink-math.test.mjs B2.3）120Hz 常用 300 字 × 2 份就有 4.8MiB；打包后约为其 30%。
//
// 一笔的字节：stride（3 | 4）一个字节，之后每点依次：zz(x − 上一点 x)、zz(y − 上一点 y)、dt、（stride 4 时）zz(p − 上一点 p)，
// 都是 LEB128 变长整数（每字节 7 位，低位在前）；zz = zigzag（0, −1, 1, −2 … → 0, 1, 2, 3 …）；第一点的「上一点」为 0。
// 120Hz 手写相邻点多在 ±6.3 单位内，每点通常 3 个字节（Pencil 再加 1）。

/** 有符号整数 → zigzag 非负整数。 */
function zz(n) {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}

function unzz(u) {
  return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
}

function pushVarint(out, u) {
  let v = u;
  while (v >= 128) {
    out.push((v % 128) | 128);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

const VARINT_MAX_BYTES = 5; // ≤ 2^35：远大于任何坐标 / 时间差

/** encodeRawStrokes 的一行 → 打包串；行不合法返回 null。 */
export function rawRowToPacked(row) {
  if (!isRawStrokeRow(row)) return null;
  const stride = row[0];
  const bytes = [stride];
  let px = 0;
  let py = 0;
  let pp = 0;
  for (let j = 1; j < row.length; j += stride) {
    pushVarint(bytes, zz(row[j] - px));
    pushVarint(bytes, zz(row[j + 1] - py));
    pushVarint(bytes, Math.max(0, row[j + 2]));
    px = row[j];
    py = row[j + 1];
    if (stride === 4) {
      pushVarint(bytes, zz(row[j + 3] - pp));
      pp = row[j + 3];
    }
  }
  return bytesToBase64(Uint8Array.from(bytes));
}

/** 打包串 → encodeRawStrokes 的一行；坏串（base64 不对、变长整数截断 / 过长、没有点）返回 null。 */
export function packedToRawRow(str) {
  const bytes = base64ToBytes(str);
  if (!bytes || bytes.length < 4) return null;
  const stride = bytes[0];
  if (stride !== 3 && stride !== 4) return null;
  let i = 1;
  const next = () => {
    let u = 0;
    let mul = 1;
    for (let k = 0; k < VARINT_MAX_BYTES; k += 1) {
      if (i >= bytes.length) return null;
      const b = bytes[i++];
      u += (b & 127) * mul;
      if (b < 128) return u;
      mul *= 128;
    }
    return null;
  };
  const row = [stride];
  let px = 0;
  let py = 0;
  let pp = 0;
  while (i < bytes.length) {
    const dx = next();
    const dy = next();
    const dt = next();
    const dp = stride === 4 ? next() : 0;
    if (dx === null || dy === null || dt === null || dp === null) return null;
    px += unzz(dx);
    py += unzz(dy);
    row.push(px, py, dt);
    if (stride === 4) {
      pp += unzz(dp);
      row.push(pp);
    }
  }
  return row.length > 1 ? row : null;
}

/** encodeRawStrokes 的一行是否合法（stride 3 / 4、整数、至少一个点）。 */
export function isRawStrokeRow(row) {
  if (!Array.isArray(row) || row.length < 4 || !row.every(Number.isInteger)) return false;
  const stride = row[0];
  return (stride === 3 || stride === 4) && row.length >= 1 + stride && (row.length - 1) % stride === 0;
}

/**
 * 原始采样（每笔 {x,y,t,p?}，t 为 ms、任意起点；网页写字页与原生书写面经桥交来的同一份）→ Ink v4：
 *   { v:4, c:345, r:['<base64>'…], g:[ms…] }
 *   r：每笔一个打包串（见上，= encodeRawStrokes 那一行）——原始点全精度（0.1 单位 / 1ms），不抽点、不烘焙宽度；
 *   g：每笔起笔距上一笔最后一点的 ms（第一笔 0；取整、负数按 0），与 r 等长——回放时还原笔间停顿。
 * 超过 inkMaxStrokes 笔只留前 inkMaxStrokes 笔（P05）。没有笔画返回 {v:4, c:345, r:[], g:[]}。
 * 宽度不存：读的人按自己的笔锋模型重算（网页 decodeInk → buildStroke；原生 InkModel，规格 §6.4「与书写时逐样本一致」）。
 * @param {Array<Array<{x,y,t,p?}>>} rawStrokes
 * @param {{maxStrokes?:number, policy?:object}} [opts]
 */
export function encodeInkRaw(rawStrokes, opts = {}) {
  const policy = opts.policy || defaultPolicy;
  const maxStrokes = num(opts.maxStrokes, policy.inkMaxStrokes);
  const kept = (rawStrokes || [])
    .filter(s => Array.isArray(s) && s.length)
    .slice(0, Math.max(0, Math.floor(maxStrokes)));
  const r = encodeRawStrokes(kept).map(rawRowToPacked);
  const g = [];
  let lastEnd = null;
  for (const stroke of kept) {
    const t0 = num(stroke[0].t, null);
    g.push(lastEnd === null || t0 === null ? 0 : Math.max(0, Math.round(t0 - lastEnd)));
    let end = t0; // 本笔最后一点的时间（单调不减，与 encodeRawStrokes 同一夹法）
    for (const pt of stroke) {
      const t = num(pt.t, end);
      if (t !== null && (end === null || t > end)) end = t;
    }
    if (end !== null) lastEnd = end;
  }
  return { v: 4, c: GRID, r, g };
}

/** v4 → encodeRawStrokes 的行（每笔一行）；形状不对（含任一笔解不开）返回 null。 */
export function inkRawRows(ink) {
  if (!ink || typeof ink !== 'object' || ink.v !== 4 || !Number.isFinite(ink.c) || ink.c <= 0) return null;
  if (!Array.isArray(ink.r) || !Array.isArray(ink.g) || ink.g.length !== ink.r.length) return null;
  if (!ink.g.every(x => Number.isInteger(x) && x >= 0)) return null;
  const rows = [];
  for (const str of ink.r) {
    const row = typeof str === 'string' ? packedToRawRow(str) : null;
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

/** Ink v4 是否合法（每笔都能解开、g 与 r 等长且为非负整数）。 */
export function isInkV4(ink) {
  return inkRawRows(ink) !== null;
}

/**
 * Ink v4 → 原始点（每笔 {x, y, t, p?}，t 为整份墨迹从 0 起的累计 ms，笔间停顿按 g 还原）。不是 v4 返回 null。
 * 原生回放读同一份（ios InkStoredInk.decode；逐点一致由 test/core/ink-v4.test.mjs 与 XCTest 共用的夹具核对）。
 */
export function decodeInkRaw(ink) {
  const rows = inkRawRows(ink);
  if (!rows) return null;
  const scale = GRID / ink.c;
  let offset = 0;
  return decodeRawStrokes(rows).map((pts, i) => {
    offset += ink.g[i];
    const out = pts.map(q => {
      const o = { x: q.x * scale, y: q.y * scale, t: q.t + offset };
      if (q.p !== undefined) o.p = q.p;
      return o;
    });
    if (out.length) offset = out[out.length - 1].t;
    return out;
  });
}

/**
 * 判断 / 看后自写存墨用的编码入口（session/ops judge、answer）：format 'raw'（缺省）→ Ink v4 原始点；'v3' → 旧管线
 * buildStroke(final) + encodeInk（抽点、烘焙宽度）。选哪种由 store 按后端给（ctx.inkFormat：原生 'raw'、localStorage 'v3'，policy P05）。
 */
export function encodeStoredInk(rawStrokes, { policy = defaultPolicy, format = 'raw' } = {}) {
  if (format === 'v3') {
    const built = (rawStrokes || []).filter(s => Array.isArray(s) && s.length).map(s => buildStroke(s, { final: true }));
    return encodeInk(built, { policy });
  }
  return encodeInkRaw(rawStrokes, { policy });
}

const decodedV4 = new WeakMap(); // 墨迹对象（store 里冻结、引用稳定）→ 默认参数下的解码结果：字墙 / 列表反复渲染同一份

/** v4 解码成与 v3 相同的点列 {x, y, w, t, p?}：原始点 → buildStroke(final) 按当前笔锋参数算宽度。 */
function decodeInkV4(ink, opts) {
  const plain = !opts || Object.keys(opts).length === 0;
  if (plain && decodedV4.has(ink)) return decodedV4.get(ink);
  const raw = decodeInkRaw(ink);
  if (!raw) return null;
  const out = raw.map(s => buildStroke(s, Object.assign({}, opts, { final: true })).map(q => {
    const o = { x: q.x, y: q.y, w: q.w, t: q.t };
    if (q.p !== undefined) o.p = q.p;
    return o;
  }));
  if (plain) decodedV4.set(ink, out);
  return out;
}
