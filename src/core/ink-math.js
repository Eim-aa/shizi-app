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
// 常量（BASE、收笔阈值 LO/HI、压力映射）是「待真机」起始值（交接备注一、八.3；L-proto-model-ink §4.2）。
// 03-待产品决定 目前没有对应 P 编号，所以暂放在本模块的 INK 常量表里、全部可经 opts 注入；
// 已在 M1-1 报告登记待定项（登记 P 编号后迁入 src/config/policy.js）。
// 抽点上限读 policy.inkMaxPointsPerStroke / inkMaxStrokes（P05）。

import * as defaultPolicy from '../config/policy.js';

/** 书写格内部边长（01 §6.1）。 */
export const GRID = 345;

export const INK = Object.freeze({
  base: 11.5, // 本体宽 BASE（pt / 345 单位）——待真机（交接备注八.1）
  lo: 0.25, // 收笔阈值：抬笔前 30ms 均速 ≤ lo 不收尖（pt/ms）——待真机
  hi: 0.9, // 收笔阈值：≥ hi 收到最尖（pt/ms）——待真机
  // 以下为已定规格（交接备注八.1、D09）
  speedCap: 1.5, // 本体宽公式里 v 的上限：BASE × (1.06 − 0.12·min(v, 1.5))
  tau: 35, // 宽度按时间平滑：α = 1 − e^(−Δt/35ms)
  window: 30, // 收笔看抬笔前 30ms 平均速度
  dotLen: 24, // 点画：抬笔后总长 < 24
  step: 3, // Catmull-Rom 重采样约 3 单位一点
  tapMax: 28, // 收尖段长度 min(28, 30%·len)（原型细节）
  tapRatio: 0.3,
  endMinSlow: 0.9, // 收尖末端倍数：k=0 → .9（原型细节；k=0 时实际不收尖）
  endMinFast: 0.12, // k=1 → .12
  single: 0.9, // 单点直径 = 0.9 × 本体宽
  // 1€ 滤波参数（原型；文字规格未写）
  euroMinCutoff: 1,
  euroBeta: 0.02,
  euroDCutoff: 1,
  // 压力因子（D10；旧版 index.html:2198）——待真机
  pressureLo: 0.58,
  pressureGain: 0.94,
  pressureHi: 1.52,
});

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function params(opts) {
  if (!opts) return INK;
  return {
    ...INK,
    base: num(opts.base, INK.base),
    lo: num(opts.lo, INK.lo),
    hi: num(opts.hi, INK.hi),
  };
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
      const q = {
        x: 0.5 * (2 * b.x + (-a.x + c.x) * u + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * u2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * u3),
        y: 0.5 * (2 * b.y + (-a.y + c.y) * u + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * u2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * u3),
        t: lerp(num(b.t, 0), num(c.t, 0), u),
      };
      if (hasPressure(b) || hasPressure(c)) q.p = lerp(num(b.p, 0), num(c.p, 0), u);
      if (typeof b.w === 'number' && typeof c.w === 'number') q.w = lerp(b.w, c.w, u);
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
 * @param {number} [opts.base]  本体宽（默认 INK.base）
 * @param {number} [opts.lo] [opts.hi]  收笔阈值
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

// ---------------------------------------------------------------- 存储编码 InkV2（01 §3.5）

/**
 * 管线输出（每笔 {x,y,w,t,p?}，345 空间）→ InkV2 紧凑编码：
 *   { v:2, c:345, s:[[x,y,w, x,y,w, …]], dt:[[…]], p?:[[…]] }
 *   x / y：0–1000 整数（= 坐标 / 345 × 1000，落在格外的点不截断）；w：本体宽倍数 ×100（w / base × 100）；
 *   dt：相邻点 ms 差（每笔第一个点 = 距上一笔最后一点的间隔，第一笔为 0；按累计取整，无漂移）；
 *   p：仅当有 pen 压力时出现，压力 ×100（无压力的点为 0）。
 * 存储前每笔按弧长抽点到 ≤ inkMaxPointsPerStroke；超过 inkMaxStrokes 笔只留前 inkMaxStrokes 笔（P05）。
 * @param {Array<Array<{x,y,w,t?,p?}>>} strokes
 * @param {{base?:number, maxPoints?:number, maxStrokes?:number, policy?:object}} [opts]
 */
export function encodeInk(strokes, opts = {}) {
  const policy = opts.policy || defaultPolicy;
  const base = num(opts.base, INK.base);
  const maxPoints = num(opts.maxPoints, policy.inkMaxPointsPerStroke);
  const maxStrokes = num(opts.maxStrokes, policy.inkMaxStrokes);
  const kept = (strokes || []).filter(s => Array.isArray(s) && s.length > 0).slice(0, Math.max(0, Math.floor(maxStrokes)));
  const thinned = kept.map(s => thinStroke(s, maxPoints));
  const withPressure = thinned.some(s => s.some(hasPressure));
  const s = [];
  const dt = [];
  const p = [];
  let t0 = null; // 整份墨迹第一个点的时间
  let lastRel = 0;
  for (const stroke of thinned) {
    const row = [];
    const drow = [];
    const prow = [];
    for (const pt of stroke) {
      row.push(Math.round((pt.x / GRID) * 1000), Math.round((pt.y / GRID) * 1000), Math.max(0, Math.round((num(pt.w, base) / base) * 100)));
      const t = num(pt.t, null);
      let rel = lastRel;
      if (t !== null) {
        if (t0 === null) t0 = t;
        rel = Math.max(lastRel, Math.round(t - t0));
      }
      drow.push(rel - lastRel);
      lastRel = rel;
      if (withPressure) prow.push(hasPressure(pt) ? Math.round(clamp(pt.p, 0, 1) * 100) : 0);
    }
    s.push(row);
    dt.push(drow);
    if (withPressure) p.push(prow);
  }
  const ink = { v: 2, c: GRID, s, dt };
  if (withPressure) ink.p = p;
  return ink;
}

/** InkV2 形状是否合法（与 core/schema.js inkFields 同口径，再加行长度一致）。 */
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

/**
 * InkV2 → 每笔 {x, y, w, t, p?}（345 空间，w 为绝对宽；t 从 0 起的累计 ms）。形状不合法返回 null。
 * 回放 / 缩略图渲染前再走 catmullRom（resampleForReplay）保证外观与书写时一致（01 §3.5）。
 */
export function decodeInk(ink, opts = {}) {
  if (!isInkV2(ink)) return null;
  const base = num(opts.base, INK.base);
  const scale = GRID / 1000;
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
