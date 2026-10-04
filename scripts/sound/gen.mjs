#!/usr/bin/env node
// 拾字 · 音效生成器（D50 ⑦：判断声 j1「纸页落定」三个轮换变体 + 落款盖章声 s1「木印·闷实」）
// 全部程序合成：白噪声 + 滤波 + 包络 + 衰减正弦模态 + 自造短混响。没有采样，没有下载任何现成音效——
// 因此没有第三方素材，THIRD_PARTY_NOTICES / 关于页不需要署名。固定随机种子，结果逐字节可复现（<1 秒，Node ≥ 18，无依赖）。
//
// 用法：
//   node scripts/sound/gen.mjs                    写 assets/sound/：4 个 WAV（网页 / PWA 用，44.1kHz 16bit mono）
//                                                 + 4 个 CAF（iOS 包用，LEI16，无编码补零；macOS 上有 afconvert 时生成）
//   node scripts/sound/gen.mjs --out <dir>        写到别处（测试用：与入库文件比对）
//   node scripts/sound/gen.mjs --candidates <dir> 另把全部候选（含未入选的 j2–j5 / s2–s4 / 笔触 b1 b2 / 现状对照）与 meta.json 写到该目录
//
// 时间约定与设计「时刻编排」一致：t=0 是触发动作的 touch-up 那一帧。
//   判断「收进」：轻纸声 t=0 起播，与 Impact 同帧；250ms 起可落笔 → 判断声应在 ~250ms 内基本结束。
//   落款：印接触纸面时起播，峰值在起播后几 ms 内。
// 响度：盖章 −23、判断 −31 LUFS-M（判断低 8dB；采样峰值上限 −10 / −3 dBFS），文件里已带这个差，播放端 gain 取 1.0。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argOf = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(argOf('--out') || path.join(ROOT, 'assets', 'sound'));
const CAND = argOf('--candidates') ? path.resolve(argOf('--candidates')) : null;
fs.mkdirSync(OUT, { recursive: true });
if (CAND) fs.mkdirSync(path.join(CAND, 'wav'), { recursive: true });

// ───────────────────────── DSP 基础 ─────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ms = (x) => Math.round((x * SR) / 1000);
const dbToLin = (d) => Math.pow(10, d / 20);
const linToDb = (l) => 20 * Math.log10(Math.max(l, 1e-12));

function white(n, r) { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = r() * 2 - 1; return a; }
// 粉噪声（Paul Kellet 经济版），比白噪声暗，接近纸、布一类摩擦的谱斜率
function pink(n, r) {
  const a = new Float64Array(n); let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    a[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return a;
}

// TPT 状态变量滤波器（Zavalishin），f 可以是常数或 t(秒)→Hz 的函数（扫频时每 16 个采样更新一次系数）
function svf(x, { type, f, Q = 0.707 }) {
  const y = new Float64Array(x.length); let ic1 = 0, ic2 = 0; const k = 1 / Q;
  let a1, a2, a3;
  const setF = (fr) => { const g = Math.tan((Math.PI * Math.min(Math.max(fr, 10), SR * 0.45)) / SR); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; };
  const fn = typeof f === 'function' ? f : null;
  if (!fn) setF(f);
  for (let i = 0; i < x.length; i++) {
    if (fn && (i & 15) === 0) setF(fn(i / SR));
    const v0 = x[i]; const v3 = v0 - ic2; const v1 = a1 * ic1 + a2 * v3; const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    y[i] = type === 'lp' ? v2 : type === 'bp' ? k * v1 : type === 'hp' ? v0 - k * v1 - v2 : v0 - k * v1; // 'notch'
  }
  return y;
}
// RBJ 双二阶（用于 EQ 与 K 计权）
function biquad(x, type, f, Q, dB = 0) {
  const A = Math.pow(10, dB / 40), w0 = (2 * Math.PI * f) / SR, cs = Math.cos(w0), sn = Math.sin(w0), al = sn / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
  else if (type === 'highshelf') {
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * (A + 1 + (A - 1) * cs + s); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - s);
    a0 = A + 1 - (A - 1) * cs + s; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - s;
  } else throw new Error(type);
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}

// 包络：升余弦起音 a(ms) → 保持 hold(ms) → 指数衰减 tau(ms)；delay(ms) 之前为 0
function env(n, { a = 2, hold = 0, tau = 30, delay = 0 }) {
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i * 1000) / SR - delay;
    e[i] = t < 0 ? 0 : t < a ? 0.5 - 0.5 * Math.cos((Math.PI * t) / a) : t < a + hold ? 1 : Math.exp(-(t - a - hold) / tau);
  }
  return e;
}
const mul = (x, e) => { for (let i = 0; i < x.length; i++) x[i] *= e[i]; return x; };
const peakOf = (x) => { let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return p; };
const norm = (x, to = 1) => { const p = peakOf(x) || 1; for (let i = 0; i < x.length; i++) x[i] *= to / p; return x; };
function add(dst, src, gain = 1, offset = 0) { for (let i = 0; i < src.length && i + offset < dst.length; i++) if (i + offset >= 0) dst[i + offset] += src[i] * gain; return dst; }
function smoothNoise(n, r, cut) { const x = svf(svf(white(n, r), { type: 'lp', f: cut, Q: 0.6 }), { type: 'lp', f: cut, Q: 0.6 }); let s = 0; for (let i = 0; i < n; i++) s += x[i] * x[i]; const rms = Math.sqrt(s / n) || 1; for (let i = 0; i < n; i++) x[i] /= 2.5 * rms; return x; }

// 衰减正弦模态（印身 / 桌面的共振）：f 起音时略高（drop），随 dropTau 落回 → 「闷」而不「叮」
function mode(n, { f, tau, amp = 1, delay = 0, drop = 0, dropTau = 5, phase = 0 }) {
  const y = new Float64Array(n); let ph = phase; const d0 = ms(delay);
  for (let i = d0; i < n; i++) {
    const t = (i - d0) / SR; const fr = f * (1 + drop * Math.exp(-t / (dropTau / 1000)));
    ph += (2 * Math.PI * fr) / SR;
    const att = Math.min(1, (i - d0) / ms(0.35)); // 0.35ms 起音，避免阶跃爆音
    y[i] = Math.sin(ph) * Math.exp(-t / (tau / 1000)) * amp * att;
  }
  return y;
}

// 纸纤维的细碎爆裂：稀疏冲激（泊松）→ 共振带通，rate(tMs) 为每秒颗粒数
function crackle(n, r, { rate, f, Q = 2.5, lp = 4500 }) {
  const imp = new Float64Array(n);
  for (let i = 0; i < n; i++) { const t = (i * 1000) / SR; if (r() < rate(t) / SR) imp[i] = (r() < 0.5 ? -1 : 1) * (0.35 + 0.65 * r()); }
  return svf(svf(imp, { type: 'bp', f, Q }), { type: 'lp', f: lp, Q: 0.7 });
}
// 摩擦颗粒调幅（stick-slip）：随机短促的小包络叠加 → 擦纸的「沙」感
function grainAM(n, r, { rate, tau = 2.5, floor = 0.35 }) {
  const g = new Float64Array(n); const dec = Math.exp(-1 / ((tau / 1000) * SR)); let v = 0;
  for (let i = 0; i < n; i++) { if (r() < rate / SR) v += 0.5 + r(); v *= dec; g[i] = v; }
  norm(g); for (let i = 0; i < n; i++) g[i] = floor + (1 - floor) * g[i]; return g;
}

// 自造短混响（纸面与桌面的近距离回响）：几条早期反射 + 指数衰减的滤波噪声尾巴，直接卷积
function makeIR(r, { lenMs = 180, tau = 40, lp = 3200, early = [] }) {
  const n = ms(lenMs); const tail = svf(white(n, r), { type: 'lp', f: lp, Q: 0.6 });
  mul(tail, env(n, { a: 6, tau, delay: 4 }));
  let e = 0; for (let i = 0; i < n; i++) e += tail[i] * tail[i]; const s = 1 / Math.sqrt(e || 1);
  for (let i = 0; i < n; i++) tail[i] *= s * 0.6;
  for (const [t, g] of early) tail[ms(t)] += g;
  return tail;
}
function convolve(x, h) {
  const y = new Float64Array(x.length + h.length - 1);
  const hn = []; for (let j = 0; j < h.length; j++) if (Math.abs(h[j]) > 1e-7) hn.push(j);
  for (let i = 0; i < x.length; i++) { const xi = x[i]; if (xi === 0) continue; for (const j of hn) y[i + j] += xi * h[j]; }
  return y;
}
function withVerb(dry, r, opts, wet) { const w = convolve(dry, makeIR(r, opts)); const y = new Float64Array(dry.length); for (let i = 0; i < y.length; i++) y[i] = dry[i] + w[i] * wet; return y; }

function fades(x, inMs, outMs) {
  const ni = Math.max(1, ms(inMs)), no = Math.max(1, ms(outMs)), n = x.length;
  for (let i = 0; i < ni && i < n; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / ni);
  for (let i = 0; i < no && i < n; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / no);
  x[n - 1] = 0; return x;
}

// ───────────────────────── 测量 ─────────────────────────
// ITU-R BS.1770 K 计权（系数按 pyloudnorm 的做法在 44.1k 下重算），短音用 400ms 瞬时响度（LUFS-M）的最大值
function lufsM(x) {
  const pad = ms(400); const p = new Float64Array(x.length + 2 * pad); p.set(x, pad);
  const k = biquad(biquad(p, 'highshelf', 1500, 1 / Math.SQRT2, 4.0), 'hp', 38, 0.5);
  const win = ms(400), step = ms(5); let best = 0;
  const cs = new Float64Array(k.length + 1); for (let i = 0; i < k.length; i++) cs[i + 1] = cs[i] + k[i] * k[i];
  for (let s = 0; s + win <= k.length; s += step) best = Math.max(best, (cs[s + win] - cs[s]) / win);
  return -0.691 + 10 * Math.log10(best || 1e-20);
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) {
      const ar = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, ai = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
      re[i + j + len / 2] = re[i + j] - ar; im[i + j + len / 2] = im[i + j] - ai; re[i + j] += ar; im[i + j] += ai;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
function spectrum(x) {
  let n = 1; while (n < x.length) n <<= 1; n = Math.max(n, 16384);
  const re = new Float64Array(n), im = new Float64Array(n); re.set(x); fft(re, im);
  let tot = 0, hf = 0, lf = 0, mid = 0, cen = 0;
  for (let i = 1; i < n / 2; i++) { const f = (i * SR) / n, p = re[i] * re[i] + im[i] * im[i]; tot += p; cen += f * p; if (f >= 4000) hf += p; if (f < 250) lf += p; if (f >= 300 && f < 3000) mid += p; }
  return { centroid: cen / tot, hf4k: (100 * hf) / tot, lf250: (100 * lf) / tot, mid: (100 * mid) / tot };
}
function measure(x) {
  const p = peakOf(x); let pk = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) === p) { pk = i; break; }
  let on = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > p * 0.01) { on = i; break; }   // −40dB 相对峰值
  let last = 0; for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > p * 0.01) { last = i; break; }
  return { durMs: Math.round((x.length * 1000) / SR), onsetMs: +((on * 1000) / SR).toFixed(1), peakAtMs: +((pk * 1000) / SR).toFixed(1),
    audibleEndMs: Math.round((last * 1000) / SR), peakDb: +linToDb(p).toFixed(1), lufsM: +lufsM(x).toFixed(1), spkLufs: +speakerLufs(x).toFixed(1), ...Object.fromEntries(Object.entries(spectrum(x)).map(([k, v]) => [k, +v.toFixed(k === 'centroid' ? 0 : 1)])) };
}

// 平滑限幅：对称 1ms 窗内取最小所需增益 → 同窗平均（保证峰值处正好到位、增益曲线连续）→ 30ms 释放
function limit(x, ceilDb) {
  const c = dbToLin(ceilDb), n = x.length, L = ms(1), rel = Math.exp(-1 / (0.03 * SR));
  const need = new Float64Array(n); for (let i = 0; i < n; i++) need[i] = Math.min(1, c / Math.max(Math.abs(x[i]), 1e-12));
  const m = new Float64Array(n); for (let i = 0; i < n; i++) { let v = 1; for (let j = Math.max(0, i - L); j <= Math.min(n - 1, i + L); j++) v = Math.min(v, need[j]); m[i] = v; }
  let prev = 1;
  for (let i = 0; i < n; i++) { let s = 0, k = 0; for (let j = Math.max(0, i - L); j <= Math.min(n - 1, i + L); j++) { s += m[j]; k++; } const g = Math.min(s / k, 1 - (1 - prev) * rel); prev = g; x[i] *= g; }
  return x;
}
// 手机外放粗估：iPhone 扬声器 ~300Hz 以下基本放不出来 → 4 阶高通 300Hz 后再算 LUFS-M（只作相对比较）
const speakerLufs = (x) => lufsM(biquad(biquad(x, 'hp', 300, 0.54), 'hp', 300, 1.31));

/** 16bit mono PCM 的 WAV 字节（TPDF ±1LSB 抖动，只在有信号处；抖动种子固定）。同时返回裸 PCM 供 CAF 复用。 */
function encodePcm(x) {
  const n = x.length; const pcm = Buffer.alloc(n * 2); const r = mulberry32(4242);
  for (let i = 0; i < n; i++) { const d = x[i] === 0 ? 0 : r() - r(); const v = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767 + d))); pcm.writeInt16LE(v, 2 * i); }
  return pcm;
}
function wavBytes(pcm) {
  const n = pcm.length / 2; const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return Buffer.concat([b, pcm]);
}
/** iOS 包用的 CAF：线性 PCM 16bit 小端（LEI16），单声道 44.1kHz，只有 desc 与 data 两个块——没有 AAC，所以没有 priming 补零，起音从第 0 个采样开始。 */
function cafBytes(pcm) {
  const h = Buffer.alloc(8 + 12 + 32 + 12 + 4);
  h.write('caff', 0); h.writeUInt16BE(1, 4); h.writeUInt16BE(0, 6);
  h.write('desc', 8); h.writeBigInt64BE(32n, 12);
  h.writeDoubleBE(SR, 20); h.write('lpcm', 28); h.writeUInt32BE(2, 32 /* kCAFLinearPCMFormatFlagIsLittleEndian */);
  h.writeUInt32BE(2, 36); h.writeUInt32BE(1, 40); h.writeUInt32BE(1, 44); h.writeUInt32BE(16, 48);
  h.write('data', 52); h.writeBigInt64BE(BigInt(4 + pcm.length), 56); h.writeUInt32BE(0, 64 /* edit count */);
  return Buffer.concat([h, pcm]);
}
const rendered = new Map(); // 文件名（不带扩展名）→ 采样

// ───────────────────────── 响度目标 ─────────────────────────
// 盖章 −23 LUFS-M；判断 −31（低 8dB）；笔触 −40（再低 9dB，若做也只能是「几乎听不见」）
// 短促音按 400ms 能量算响度时峰值会偏高，所以归一后再过一道 1ms 前瞻的平滑限幅，保证峰值不超过 CEIL
const TARGET = { seal: -23, judge: -31, stroke: -40 };
const CEIL = { seal: -3, judge: -10, stroke: -18 }; // 采样峰值上限（dBFS）

// ───────────────────────── 候选 ─────────────────────────
// render(r, v)：r 随机源；v = { fk 频率系数, gk 增益 dB }（轮换变体用）
const C = [];

// —— 判断「收进」：轻纸声 ——
C.push({ id: 'j1_page_settle', group: 'judge', name: '纸页落定', desc: '一页纸轻轻落在一叠纸上：一口短气 + 纸身的闷响 + 几粒纤维声。起音即峰值，和 Impact 同帧。',
  method: '白噪声 → 低通 1.4k / 高通 250（气）+ 带通 1.1k Q0.9（纸身）+ 0–40ms 泊松纤维颗粒（带通 2.3k）；包络 起音 3ms / τ 30ms 与 1.5ms / τ 16ms；总低通 4.5k，2.8k 处 −2dB',
  dur: 150, fadeIn: 0.6, fadeOut: 25,
  render(r, v) {
    const n = ms(this.dur);
    const puff = norm(mul(svf(svf(white(n, r), { type: 'lp', f: 1400 * v.fk, Q: 0.6 }), { type: 'hp', f: 250, Q: 0.6 }), env(n, { a: 3, tau: 30 })));
    const body = norm(mul(svf(white(n, r), { type: 'bp', f: 1100 * v.fk, Q: 0.9 }), env(n, { a: 1.5, tau: 16 })));
    const cr = norm(crackle(n, r, { rate: (t) => (t < 40 ? 160 : 0), f: 2300 * v.fk, Q: 2.5 }));
    const y = new Float64Array(n); add(y, puff, 1); add(y, body, 0.75); add(y, cr, 0.22);
    return biquad(svf(y, { type: 'lp', f: 4500, Q: 0.6 }), 'peak', 2800, 1, -2);
  } });

C.push({ id: 'j2_page_turn', group: 'judge', name: '轻翻纸', desc: '指尖带起一页纸的「嘶」，频带由亮转暗地扫下来，像把这一页翻过去收好。',
  method: '白噪声 → 带通 Q1.1，中心 1.9k→650Hz 指数扫频（τ 60ms）× 45Hz 平滑随机调幅 ±35%；0–120ms 纤维颗粒；包络 起音 16ms / 保持 18ms / τ 45ms；低通 5k',
  dur: 200, fadeIn: 1, fadeOut: 35,
  render(r, v) {
    const n = ms(this.dur);
    const sw = svf(white(n, r), { type: 'bp', f: (t) => (650 + 1250 * Math.exp(-t / 0.06)) * v.fk, Q: 1.1 });
    const rough = smoothNoise(n, r, 45); for (let i = 0; i < n; i++) sw[i] *= 1 + 0.35 * rough[i];
    norm(mul(sw, env(n, { a: 16, hold: 18, tau: 45 })));
    const cr = norm(mul(crackle(n, r, { rate: (t) => (t < 120 ? 110 : 0), f: 2000 * v.fk, Q: 2.2 }), env(n, { a: 10, hold: 30, tau: 40 })));
    const y = new Float64Array(n); add(y, sw, 1); add(y, cr, 0.2);
    return svf(y, { type: 'lp', f: 5000, Q: 0.6 });
  } });

C.push({ id: 'j3_paper_rub', group: 'judge', name: '纸面轻擦', desc: '手指在纸面上很轻地擦过一下，带细沙的摩擦感，像把墨迹拂进本子。',
  method: '白噪声 → 带通 1.4k Q0.6 × 摩擦颗粒调幅（泊松 240/s，每粒 τ 2.5ms，底 0.35）；包络 起音 8ms / 保持 55ms / τ 35ms；高通 300 + 低通 4k',
  dur: 180, fadeIn: 1, fadeOut: 30,
  render(r, v) {
    const n = ms(this.dur);
    const x = svf(white(n, r), { type: 'bp', f: 1400 * v.fk, Q: 0.6 });
    mul(x, grainAM(n, r, { rate: 240, tau: 2.5, floor: 0.35 })); mul(x, env(n, { a: 8, hold: 55, tau: 35 }));
    return svf(svf(norm(x), { type: 'hp', f: 300, Q: 0.6 }), { type: 'lp', f: 4000, Q: 0.6 });
  } });

C.push({ id: 'j4_palm_smooth', group: 'judge', name: '抚平宣纸', desc: '手掌把宣纸抚平的一声「呼」，最暗、最软，没有颗粒的尖。起音最慢（峰在 ~30ms）。',
  method: '粉噪声 → 两级低通 1.6k + 高通 180 × 18Hz 平滑随机调幅 ±20%；稀疏纤维颗粒 60/s（带通 1.8k，低通 2.6k）；包络 起音 26ms / 保持 8ms / τ 70ms',
  dur: 240, fadeIn: 1, fadeOut: 45,
  render(r, v) {
    const n = ms(this.dur);
    let x = svf(svf(pink(n, r), { type: 'lp', f: 1600 * v.fk, Q: 0.7 }), { type: 'lp', f: 1600 * v.fk, Q: 0.7 }); x = svf(x, { type: 'hp', f: 180, Q: 0.6 });
    const rough = smoothNoise(n, r, 18); for (let i = 0; i < n; i++) x[i] *= 1 + 0.2 * rough[i];
    norm(mul(x, env(n, { a: 26, hold: 8, tau: 70 })));
    const cr = norm(mul(crackle(n, r, { rate: () => 60, f: 1800 * v.fk, Q: 2, lp: 2600 }), env(n, { a: 20, tau: 80 })));
    const y = new Float64Array(n); add(y, x, 1); add(y, cr, 0.12); return y;
  } });

C.push({ id: 'j5_paper_tick', group: 'judge', name: '纸角轻触', desc: '最短的一下：纸边碰到纸，一声干净的「嗒」，几乎只是一个点。',
  method: '白噪声 → 带通 1.6k Q1.3（起音 0.8ms / τ 8ms）+ 带通 420Hz Q2（起音 1.5ms / τ 14ms，纸身）+ 一粒纤维颗粒；低通 5k，2.8k 处 −3dB',
  dur: 85, fadeIn: 0.4, fadeOut: 20,
  render(r, v) {
    const n = ms(this.dur);
    const tick = norm(mul(svf(white(n, r), { type: 'bp', f: 1600 * v.fk, Q: 1.3 }), env(n, { a: 0.8, tau: 8 })));
    const body = norm(mul(svf(white(n, r), { type: 'bp', f: 420 * v.fk, Q: 2 }), env(n, { a: 1.5, tau: 14 })));
    const cr = norm(crackle(n, r, { rate: (t) => (t > 1 && t < 6 ? 400 : 0), f: 2200, Q: 2 }));
    const y = new Float64Array(n); add(y, tick, 0.9); add(y, body, 0.65); add(y, cr, 0.15);
    return biquad(svf(y, { type: 'lp', f: 5000, Q: 0.6 }), 'peak', 2800, 1, -3);
  } });

// —— 落款：盖章声 ——
function sealHit(n, r, { contactLp, contactTau, contactAmp, thump, modes, paperF = 950, paperAmp = 0.22, delay = 0, scale = 1, fk = 1 }) {
  const y = new Float64Array(n);
  const contact = norm(mul(svf(white(n, r), { type: 'lp', f: contactLp, Q: 0.6 }), env(n, { a: 0.4, tau: contactTau, delay })));
  add(y, contact, contactAmp * scale);
  add(y, mode(n, { ...thump, f: thump.f * fk, delay, phase: r() * 0.4 }), scale);
  for (const [f, tau, amp] of modes) add(y, mode(n, { f: f * fk, tau, amp, delay, phase: r() * 6.28 }), scale);
  const paper = norm(mul(svf(white(n, r), { type: 'bp', f: paperF, Q: 0.7 }), env(n, { a: 1, tau: 22, delay })));
  add(y, paper, paperAmp * scale);
  return y;
}
C.push({ id: 's1_wood_muted', group: 'seal', name: '木印·闷实', desc: '木质印面隔着纸压到桌上：一声暖而闷的「笃」，中低频饱满，尾巴是很近的纸面回响。',
  method: '接触噪声（低通 2.8k，τ 3ms）+ 主体 150Hz 衰减正弦（起音高 25% 后 6ms 落回，τ 38ms）+ 75Hz 次低（τ 55ms）+ 模态 340/610/1040/1720Hz（τ 32/24/15/8ms）+ 纸声带通 950；短混响 220ms（早期反射 8/15/23ms，尾巴 τ 45ms，低通 3.2k，湿 −15dB）',
  dur: 320, fadeIn: 0.3, fadeOut: 60,
  render(r, v) {
    const n = ms(this.dur);
    const y = sealHit(n, r, { contactLp: 2800, contactTau: 3, contactAmp: 0.5, thump: { f: 150, tau: 38, amp: 0.55, drop: 0.25, dropTau: 6 },
      modes: [[75, 55, 0.2], [340, 32, 0.62], [610, 24, 0.46], [1040, 15, 0.26], [1720, 8, 0.09]], fk: v.fk });
    return withVerb(y, r, { lenMs: 220, tau: 45, lp: 3200, early: [[8, 0.35], [15, 0.22], [23, 0.12]] }, 0.18);
  } });

C.push({ id: 's2_stone_solid', group: 'seal', name: '石印·清实', desc: '青田 / 寿山一类石章落在纸上：比木印更硬更短，多一点「嗒」的清楚边缘，但仍然是闷的，不清脆。',
  method: '接触噪声（低通 5k，τ 2ms）+ 主体 125Hz（起音高 20%，τ 30ms）+ 模态 270/740/1390/2280/3150Hz（τ 26/17/10/6/3.5ms）+ 纸声；短混响 180ms（早期反射 7/13ms，湿 −16dB）',
  dur: 260, fadeIn: 0.3, fadeOut: 50,
  render(r, v) {
    const n = ms(this.dur);
    const y = sealHit(n, r, { contactLp: 5000, contactTau: 2, contactAmp: 0.6, thump: { f: 125, tau: 30, amp: 0.5, drop: 0.2, dropTau: 4 },
      modes: [[270, 26, 0.55], [740, 17, 0.42], [1390, 10, 0.3], [2280, 6, 0.13], [3150, 3.5, 0.05]], paperAmp: 0.2, fk: v.fk });
    return withVerb(y, r, { lenMs: 180, tau: 35, lp: 3600, early: [[7, 0.3], [13, 0.18]] }, 0.16);
  } });

C.push({ id: 's3_press_rock', group: 'seal', name: '印泥·按稳', desc: '落下一声，再极轻地「按稳」一下（盖章时手腕的那一下摇），之间有印泥与纸的细声。最有仪式感，也最长。',
  method: '第一击：接触低通 1.8k τ 4ms + 140Hz（τ 40ms）+ 模态 330/600/1010Hz；+68ms 第二击 ×0.3、模态降 4%；0–200ms 纸纤维颗粒 70/s（带通 1.6k）；短混响 240ms（湿 −14dB）',
  dur: 380, fadeIn: 0.3, fadeOut: 70,
  render(r, v) {
    const n = ms(this.dur);
    const hit = { contactLp: 1800, contactTau: 4, contactAmp: 0.4, thump: { f: 140, tau: 40, amp: 0.55, drop: 0.22, dropTau: 6 },
      modes: [[72, 50, 0.18], [330, 30, 0.6], [600, 22, 0.42], [1010, 13, 0.22]], fk: v.fk };
    const y = sealHit(n, r, hit);
    add(y, sealHit(n, r, { ...hit, contactLp: 1500, delay: 68, scale: 0.3, fk: v.fk * 0.96, paperAmp: 0.1 }), 1);
    const cr = norm(mul(crackle(n, r, { rate: (t) => (t < 200 ? 70 : 0), f: 1600, Q: 2, lp: 3000 }), env(n, { a: 4, hold: 60, tau: 60 })));
    add(y, cr, 0.06);
    return withVerb(y, r, { lenMs: 240, tau: 50, lp: 3000, early: [[9, 0.33], [17, 0.2], [26, 0.1]] }, 0.2);
  } });

C.push({ id: 's4_felt_deep', group: 'seal', name: '垫纸·极闷', desc: '下面垫着毛毡或一叠纸：最闷、最深的「噗」，几乎没有边缘。耳机里好听，手机外放可能偏小（见报告低频占比）。',
  method: '接触噪声（低通 1.2k，τ 5ms）+ 主体 110Hz（起音高 30%，τ 45ms）+ 模态 230/470/880Hz（τ 34/24/12ms）+ 纸声带通 700；短混响 160ms（湿 −18dB）',
  dur: 220, fadeIn: 0.3, fadeOut: 50,
  render(r, v) {
    const n = ms(this.dur);
    const y = sealHit(n, r, { contactLp: 1200, contactTau: 5, contactAmp: 0.45, thump: { f: 110, tau: 45, amp: 1, drop: 0.3, dropTau: 6 },
      modes: [[230, 34, 0.5], [470, 24, 0.3], [880, 12, 0.12]], paperF: 700, paperAmp: 0.15, fk: v.fk });
    return withVerb(y, r, { lenMs: 160, tau: 32, lp: 2600, early: [[8, 0.25]] }, 0.12);
  } });

// —— 可选：笔触（实验，建议默认不发，见 README）——
C.push({ id: 'b1_brush_touch', group: 'stroke', name: '落笔·一触', desc: '笔尖碰到纸的一下，极短极暗，几乎是「感觉到」而不是「听到」。只在落笔时一次。',
  method: '白噪声 → 低通 1.1k（起音 0.8ms / τ 7ms）+ 230Hz 衰减正弦（τ 10ms）；比判断声再低 9dB',
  dur: 60, fadeIn: 0.4, fadeOut: 15,
  render(r, v) {
    const n = ms(this.dur);
    const x = norm(mul(svf(white(n, r), { type: 'lp', f: 1100 * v.fk, Q: 0.6 }), env(n, { a: 0.8, tau: 7 })));
    add(x, mode(n, { f: 230 * v.fk, tau: 10, amp: 0.25 }), 1); return x;
  } });
C.push({ id: 'b2_brush_drag', group: 'stroke', name: '行笔·沙', desc: '笔毛在纸上拖过的细沙声，一笔一次。真要做应随笔速实时调制，这里只是单发样本。',
  method: '白噪声 → 带通 2k Q0.8 × 摩擦颗粒调幅（420/s，τ 1.5ms）；包络 起音 20ms / 保持 40ms / τ 40ms；低通 4.5k',
  dur: 160, fadeIn: 1, fadeOut: 30,
  render(r, v) {
    const n = ms(this.dur);
    const x = svf(white(n, r), { type: 'bp', f: 2000 * v.fk, Q: 0.8 });
    mul(x, grainAM(n, r, { rate: 420, tau: 1.5, floor: 0.4 })); mul(x, env(n, { a: 20, hold: 40, tau: 40 }));
    return svf(norm(x), { type: 'lp', f: 4500, Q: 0.6 });
  } });

// —— 现状对照（src/platform/sound.js 的算法原样移植，不归一，按现有电平）——
function legacy(kind) {
  const length = Math.round(SR * (kind === 'stamp' ? 0.22 : 0.11)); const d = new Float64Array(length);
  let seed = kind === 'stamp' ? 194 : 73; let filtered = 0;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const noise = (seed / 4294967295) * 2 - 1; const t = i / SR;
    const e = Math.pow(1 - i / length, kind === 'stamp' ? 2.8 : 1.4);
    if (kind === 'stamp') { filtered = filtered * 0.82 + noise * 0.18; d[i] = (Math.sin(2 * Math.PI * (82 + 22 * t) * t) * 0.58 + filtered * 0.34) * e * 0.42; }
    else { d[i] = (noise - filtered) * e * 0.075; filtered = noise; }
  }
  return d;
}
const LEGACY = [
  { id: 'x_legacy_stamp', group: 'legacy', name: '现状 · stamp（判断落定）', desc: '现在判断落定时播的 82Hz 正弦 + 噪声，0.22s。按 D46 ⑮ 将不再用于判断。', data: legacy('stamp') },
  { id: 'x_legacy_paper', group: 'legacy', name: '现状 · paper（描一遍落笔）', desc: '现在「描一遍」每次落笔的高通噪声，0.11s。注意：起音没有淡入，第一个采样就是满包络。', data: legacy('paper') },
];

// ───────────────────────── 渲染 ─────────────────────────
const VARIANTS = [ // 轮换变体：同一配方换噪声种子 + 频率 ±4% + 增益 ±0.7dB，连续播放时不像同一段录音在机关枪
  { tag: '', seed: 0, fk: 1, gk: 0 },
  { tag: '_b', seed: 101, fk: 1.04, gk: -0.7 },
  { tag: '_c', seed: 202, fk: 0.965, gk: -0.4 },
];
const meta = [];
function wavePoints(x, bins = 120) {
  const out = []; const per = x.length / bins;
  for (let b = 0; b < bins; b++) { let p = 0; for (let i = Math.floor(b * per); i < Math.floor((b + 1) * per); i++) p = Math.max(p, Math.abs(x[i])); out.push(+p.toFixed(4)); }
  return out;
}
const baseSeed = { judge: 1000, seal: 2000, stroke: 3000 };
for (const [ci, c] of C.entries()) {
  const vars = c.group === 'seal' ? VARIANTS.slice(0, 1) : VARIANTS;
  const files = []; let m0 = null; let wave = null;
  for (const v of vars) {
    const r = mulberry32(baseSeed[c.group] + ci * 17 + v.seed);
    let x = c.render(r, v);
    x = biquad(x, 'hp', 25, 0.7);           // 去直流
    x = x.slice(0, ms(c.dur));
    fades(x, c.fadeIn, c.fadeOut);
    for (let it = 0; it < 3; it++) {           // 归一 → 限幅，迭代 3 次
      const g = dbToLin(TARGET[c.group] - lufsM(x));
      for (let i = 0; i < x.length; i++) x[i] *= g;
      limit(x, CEIL[c.group]);
    }
    const gv = dbToLin(v.gk); for (let i = 0; i < x.length; i++) x[i] *= gv;
    const file = `wav/${c.id}${v.tag}.wav`; rendered.set(`${c.id}${v.tag}`, x); files.push(file);
    if (!v.tag) { m0 = measure(x); wave = wavePoints(x); }
  }
  meta.push({ id: c.id, group: c.group, name: c.name, desc: c.desc, method: c.method, files, target: TARGET[c.group], ceil: CEIL[c.group], overCeil: m0.peakDb > CEIL[c.group] + 0.05, ...m0, wave });
}
for (const l of LEGACY) {
  const file = `wav/${l.id}.wav`; rendered.set(l.id, l.data);
  meta.push({ id: l.id, group: 'legacy', name: l.name, desc: l.desc, method: 'src/platform/sound.js synthesize() 原样移植（44.1k）', files: [file], ...measure(l.data), wave: wavePoints(l.data) });
}

// ───────────────────────── 写文件 ─────────────────────────
// 入选的两个（判断 3 个轮换变体 + 盖章 1 个）：WAV（网页）+ CAF（iOS 包）写进 OUT；候选全集只在 --candidates 时写。
const RECOMMENDED = { judge: 'j1_page_settle', seal: 's1_wood_muted' };
const selected = [];
for (const id of Object.values(RECOMMENDED)) for (const f of meta.find(x => x.id === id).files) selected.push(path.basename(f, '.wav'));
const written = [];
for (const name of selected) {
  const pcm = encodePcm(rendered.get(name));
  fs.writeFileSync(path.join(OUT, `${name}.wav`), wavBytes(pcm));
  fs.writeFileSync(path.join(OUT, `${name}.caf`), cafBytes(pcm));
  written.push(`${name}.wav`, `${name}.caf`);
}
if (CAND) {
  for (const [name, x] of rendered) fs.writeFileSync(path.join(CAND, 'wav', `${name}.wav`), wavBytes(encodePcm(x)));
  fs.writeFileSync(path.join(CAND, 'meta.json'), JSON.stringify({ sampleRate: SR, target: TARGET, ceil: CEIL, recommended: RECOMMENDED, items: meta.map(({ wave, ...m }) => m) }, null, 1));
}

// ───────────────────────── 控制台报告 ─────────────────────────
const G = { judge: '判断', seal: '盖章', stroke: '笔触', legacy: '现状' };
console.log('| 组 | id | 名称 | 时长 | 起音 / 峰值点 | 可闻结束 | 峰值 dBFS | LUFS-M | 外放估 LUFS-M | 质心 Hz | >4k % | <250Hz % | 300–3k % |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const m of meta) console.log(`| ${G[m.group]} | ${m.id} | ${m.name} | ${m.durMs}ms | ${m.onsetMs} / ${m.peakAtMs}ms | ${m.audibleEndMs}ms | ${m.peakDb}${m.overCeil ? ' ⚠' : ''} | ${m.lufsM} | ${m.spkLufs} | ${m.centroid} | ${m.hf4k} | ${m.lf250} | ${m.mid} |`);
console.log(`written to ${path.relative(ROOT, OUT) || '.'}: ${written.join(', ')}`);
