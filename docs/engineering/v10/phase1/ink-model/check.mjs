// 断言：对 vectors.json 跑参考实现，逐条检查「可断言特征」（规格 §8），再查全局不变量（规格 §8.3）。
// 原生端照同一份 vectors.json 与同样的断言口径实现自己的 check（XCTest），结果须同样全部通过。
// 用法：node check.mjs  （全部通过退出码 0；有失败退出码 1）
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, geometry, unionArea, widthAt, params, prepare, oneEuro, provisionalZone, sizeComp, pressureFactor, PARAMS } from './reference.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(HERE, 'vectors.json'), 'utf8'));
const B = PARAMS.base;
let pass = 0;
let fail = 0;
const fails = [];
function ok(cond, what, detail = '') {
  if (cond) pass += 1;
  else {
    fail += 1;
    fails.push(`${what}${detail ? ' — ' + detail : ''}`);
  }
}
const inR = (x, [lo, hi], eps = 1e-9) => x >= lo - eps && x <= hi + eps;
const fx = x => (typeof x === 'number' ? x.toFixed(3) : String(x));

const results = new Map();
function run(v) {
  if (results.has(v.id)) return results.get(v.id);
  const profile = analyze(v.points);
  const geom = geometry(profile);
  const area = unionArea(geom, 0.1);
  const r = { profile, geom, area };
  results.set(v.id, r);
  return r;
}

// ---------------------------------------------------------------- 逐条向量
const rows = [];
for (const v of doc.vectors) {
  const e = v.expect;
  const { profile: pr, area } = run(v);
  const id = v.id;
  const wRelAt = u => widthAt(pr, u * pr.len) / B;
  if ('single' in e) ok(pr.single === e.single, `${id} single`, `${pr.single}`);
  if ('dot' in e) ok(pr.dot === e.dot, `${id} dot`, `${pr.dot}`);
  if ('hook' in e) ok(!!pr.hook === e.hook, `${id} hook`, `${!!pr.hook}`);
  if (e.corners) ok(inR(pr.corners.length, e.corners), `${id} corners`, `${pr.corners.length} ∉ ${e.corners}`);
  if (e.pressure !== undefined) ok(pr.pressure === e.pressure, `${id} pressure`);
  if (e.caps) {
    if (e.caps.start) ok(pr.caps.start.type === e.caps.start, `${id} caps.start`, `${pr.caps.start.type} ≠ ${e.caps.start}`);
    if (e.caps.end) ok(pr.caps.end.type === e.caps.end, `${id} caps.end`, `${pr.caps.end.type} ≠ ${e.caps.end}`);
  }
  for (const w of e.widths || []) {
    const got = wRelAt(w.u);
    ok(inR(got, w.wRel), `${id} w/B @u=${w.u}`, `${fx(got)} ∉ [${w.wRel}]`);
  }
  for (const r of e.ratios || []) {
    const got = wRelAt(r.num) / wRelAt(r.den);
    ok(inR(got, r.range), `${id} ratio w(${r.num})/w(${r.den})`, `${fx(got)} ∉ [${r.range}]`);
  }
  const last = pr.samples[pr.samples.length - 1];
  if (e.tipRel) ok(inR(last.w / B, e.tipRel), `${id} tipRel`, `${fx(last.w / B)} ∉ [${e.tipRel}]`);
  if (e.endRel) ok(inR(last.w / last.body, e.endRel), `${id} endRel`, `${fx(last.w / last.body)} ∉ [${e.endRel}]`);
  if (e.area) ok(inR(area, e.area), `${id} area`, `${fx(area)} ∉ [${e.area}]`);
  if (e.v30) ok(pr.v30 !== null && inR(pr.v30, e.v30), `${id} v30`, `${fx(pr.v30)} ∉ [${e.v30}]`);
  if ('feibai' in e) {
    const dry = Math.max(...pr.samples.map(q => q.dry));
    ok((dry > 0.05) === e.feibai, `${id} feibai`, `max dry ${fx(dry)}`);
  }
  if (e.blooms) ok(inR(pr.blooms.length, e.blooms), `${id} blooms`, `${pr.blooms.length} ∉ [${e.blooms}]`);
  if (e.hookLen) ok(!!pr.hook && inR(pr.hook.len, e.hookLen), `${id} hookLen`, pr.hook ? fx(pr.hook.len) : 'no hook');
  if (e.cornerAt) {
    const c = pr.corners[pr.corners.length - 1];
    ok(!!c && inR(c.s / pr.len, e.cornerAt), `${id} cornerAt`, c ? fx(c.s / pr.len) : 'none');
  }
  if (e.dotPhase) {
    for (const d of e.dotPhase) {
      const s = d.u * pr.len;
      const q = pr.samples.reduce((b, c) => (Math.abs(c.s - s) < Math.abs(b.s - s) ? c : b));
      // 采样点离 u 的弧长偏差 ≤ Δs/2，点画倍数分段线性，斜率 ≤ 0.8/len·… → 容差按斜率给
      const tol = (0.8 / pr.len) * PARAMS.step + 1e-9;
      const uq = q.s / pr.len;
      const want = uq < 0.5 ? 0.7 + (1.1 - 0.7) * (uq / 0.5) : 1.1 + (0.9 - 1.1) * ((uq - 0.5) / 0.5);
      ok(Math.abs(q.fPhase - want) < 1e-9 && Math.abs(q.fPhase - d.f) <= tol * 2 + 0.03, `${id} dotPhase @u=${d.u}`, `${fx(q.fPhase)} vs ${d.f}`);
      // D09：点画倍数乘本体宽（w = body × fPhase）
      ok(Math.abs(q.w - q.body * q.fPhase) < 1e-9, `${id} dot w = body × phase @u=${d.u}`);
    }
  }
  if (e.singleDiameterRel) ok(inR(pr.samples[0].w / B, e.singleDiameterRel, 1e-9), `${id} single diameter`, fx(pr.samples[0].w / B));
  if (e.v30WholeDuration) {
    const m = prepare(v.points);
    let d = 0;
    for (let i = 1; i < m.length; i += 1) d += Math.hypot(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y);
    const dur = m[m.length - 1].t - m[0].t;
    ok(dur < PARAMS.window && Math.abs(pr.v30 - d / dur) < 1e-9, `${id} D09 v30 用整段时长`, `${fx(pr.v30)} vs ${fx(d / dur)} (dur ${fx(dur)}ms)`);
  }
  if (e.sameAs) {
    const ref = doc.vectors.find(x => x.id === e.sameAs);
    const { profile: p2, area: a2 } = run(ref);
    let worst = 0; // |Δw| / 允许值，≤ 1 通过
    for (let u = 0.05; u <= 0.951; u += 0.05) {
      const a = widthAt(pr, u * pr.len);
      const b = widthAt(p2, u * p2.len);
      worst = Math.max(worst, Math.abs(a - b) / Math.max(0.05 * Math.max(a, b), 0.04 * B));
    }
    ok(worst <= 1, `${id} ≈ ${e.sameAs} 宽度`, `最差 |Δw|/允许 = ${fx(worst)}`);
    ok(Math.abs(area - a2) / a2 <= 0.03, `${id} ≈ ${e.sameAs} 面积`, `${fx(area)} vs ${fx(a2)}`);
    ok(pr.caps.start.type === p2.caps.start.type && pr.caps.end.type === p2.caps.end.type, `${id} ≈ ${e.sameAs} 端帽`);
    ok(Math.abs(pr.len - p2.len) / p2.len <= 0.01, `${id} ≈ ${e.sameAs} 弧长`, `${fx(pr.len)} vs ${fx(p2.len)}`);
  }
  rows.push([id, v.points.length, fx(pr.len), [0.25, 0.5, 0.75].map(u => wRelAt(u).toFixed(2)).join('/'), `${pr.caps.start.type}/${pr.caps.end.type}`, pr.hook ? 'Y' : '-', pr.corners.length, pr.v30 === undefined || pr.v30 === null ? '-' : pr.v30.toFixed(2), area.toFixed(0)]);
}

// ---------------------------------------------------------------- 全局不变量
const V = id => doc.vectors.find(x => x.id === id);

// I1 D09 零时间差合并：去掉被覆盖的重复点后结果完全相同
{
  const v = V('V01-heng-slow');
  const dedup = [];
  for (const q of v.points) {
    if (dedup.length && dedup[dedup.length - 1].t === q.t) dedup[dedup.length - 1] = q;
    else dedup.push(q);
  }
  ok(dedup.length < v.points.length, 'I1 V01 确含零时间差重复点');
  const a = analyze(v.points);
  const b = analyze(dedup);
  ok(a.samples.length === b.samples.length && a.samples.every((q, i) => q.w === b.samples[i].w && q.x === b.samples[i].x), 'I1 D09 零时间差合并：结果与去重输入逐样本相同');
}

// I2 D10 压力替代速度（不叠乘）：同一压力曲线、速度 ×2，中段本体因子 = F_p（与速度无关）
{
  const a = run(V('V13-pencil-shu')).profile;
  const b = run(V('V14-pencil-shu-fast')).profile;
  let worst = 0;
  for (let u = 0.3; u <= 0.701; u += 0.05) {
    const wa = widthAt(a, u * a.len);
    const wb = widthAt(b, u * b.len);
    worst = Math.max(worst, Math.abs(wa - wb) / wa);
  }
  ok(worst <= 0.04, 'I2 D10 压力替代速度：速度 ×2 中段宽差 ≤ 4%', fx(worst));
  const k = params();
  const mid = a.samples[Math.floor(a.samples.length / 2)];
  ok(Math.abs(mid.fBody - pressureFactor(mid.p, k)) < 0.03, 'I2 D10 中段 fBody ≈ F_p(p)（不乘 F_v）', `${fx(mid.fBody)} vs ${fx(pressureFactor(mid.p, k))}`);
}

// I3 采样率无关：60 / 120 / 240Hz（在 sameAs 里逐条断言）；这里补一条 60 vs 240
{
  const a = run(V('V15-rate-60hz'));
  const b = run(V('V17-rate-240hz'));
  ok(Math.abs(a.area - b.area) / b.area <= 0.03, 'I3 60Hz vs 240Hz 面积差 ≤ 3%', `${fx(a.area)} vs ${fx(b.area)}`);
}

// I4 前缀稳定性（规格 §7.2）：书写中任一时刻，距笔尖 ≥ Z 的样本与抬笔后的最终结果一致
for (const id of ['V04-shu-fast-chufeng', 'V07-na-fast', 'V10-hengzhe', 'V11-shugou', 'V15-rate-60hz', 'V13-pencil-shu']) {
  const v = V(id);
  const fin = analyze(v.points);
  let checked = 0;
  let worst = 0;
  for (const frac of [0.4, 0.6, 0.8, 0.95]) {
    const cut = Math.max(3, Math.floor(v.points.length * frac));
    const prefix = v.points.slice(0, cut);
    const live = analyze(prefix, { final: false });
    const Z = provisionalZone(prefix);
    for (const q of live.samples) {
      if (q.s > live.len - Z) break;
      const f = fin.samples[Math.round(q.s / PARAMS.step)];
      if (!f || Math.abs(f.s - q.s) > 1e-9) continue;
      worst = Math.max(worst, Math.abs(f.w - q.w), Math.hypot(f.x - q.x, f.y - q.y));
      checked += 1;
    }
  }
  ok(checked > 20 && worst <= 1e-6, `I4 前缀稳定 ${id}`, `checked ${checked}, worst ${worst.toExponential(2)}`);
}

// I5 滤波滞后上限（规格 §2.3）：匀速直线，120Hz，稳态位置滞后 ≤ max(0.75 单位, v × 8.33ms)
{
  const k = params();
  for (const v of [0.05, 0.1, 0.2, 0.3, 0.6, 1.2, 1.5]) {
    const pts = [];
    for (let i = 0; i <= 60; i += 1) pts.push({ x: 20 + v * i * (1000 / 120), y: 100, t: i * (1000 / 120) });
    const f = oneEuro(pts, k);
    let lag = 0;
    for (let i = 0; i < pts.length; i += 1) if (pts[i].t >= 80) lag = Math.max(lag, Math.hypot(pts[i].x - f[i].x, pts[i].y - f[i].y));
    const bound = Math.max(0.75, v * 8.33);
    ok(lag <= bound, `I5 1€ 滞后 v=${v}`, `${fx(lag)} > ${fx(bound)}`);
  }
}

// I6 平移 / 时间原点无关
{
  const v = V('V11-shugou');
  const a = analyze(v.points);
  const b = analyze(v.points.map(q => ({ ...q, x: q.x + 5.5, y: q.y - 3.25, t: q.t + 123456.789 })));
  const worst = Math.max(...a.samples.map((q, i) => Math.abs(q.w - b.samples[i].w)));
  ok(a.samples.length === b.samples.length && worst < 1e-6 && !!a.hook === !!b.hook, 'I6 平移 + 时间原点无关', fx(worst));
}

// I7 减少动态效果（D10）：飞白 / 洇墨全关，形状（宽度、几何面积）不变
{
  for (const id of ['V02-heng-fast', 'V10-hengzhe']) {
    const v = V(id);
    const a = analyze(v.points);
    const b = analyze(v.points, { reduceMotion: true });
    ok(b.samples.every(q => q.dry === 0) && b.blooms.length === 0, `I7 ${id} 减少动态效果：无飞白 / 洇墨`);
    ok(a.samples.every((q, i) => q.w === b.samples[i].w), `I7 ${id} 减少动态效果：宽度不变`);
    ok(Math.abs(unionArea(geometry(a)) - unionArea(geometry(b))) < 1e-9, `I7 ${id} 减少动态效果：几何不变`);
  }
}

// I8 尺寸补偿（规格 §6）
{
  ok(sizeComp(345) === 1 && sizeComp(400) === 1 && sizeComp(258) === 1, 'I8 书写格 258–400 不补偿');
  ok(Math.abs(sizeComp(166.5) - 1.141) < 0.01, 'I8 对照卡 166.5pt 补偿 ≈1.14（取代 ×1.41）', fx(sizeComp(166.5)));
  ok(sizeComp(64) === PARAMS.sizeCompMax && sizeComp(20) === PARAMS.sizeCompMax, 'I8 小于 ~96pt 封顶 1.5');
  let mono = true;
  for (let S = 20; S < 400; S += 1) if (sizeComp(S + 1) > sizeComp(S) + 1e-12) mono = false;
  ok(mono, 'I8 补偿随尺寸单调不增');
}

// I9 几何健全：并集面积 > 0、≤ 三角形面积和、轮廓不越出「样本 ± 宽度」包络
{
  for (const v of doc.vectors) {
    const { profile, geom, area } = run(v);
    let sum = 0;
    for (const p of geom.polys) {
      let a = 0;
      for (let i = 0; i < p.length; i += 1) a += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
      sum += a / 2;
      if (a < -1e-9) ok(false, `I9 ${v.id} 多边形须逆时针`);
    }
    ok(area > 0 && area <= sum * 1.005 + 0.5, `I9 ${v.id} 并集面积 ≤ 分片面积和（扫描线离散容差 0.5%）`, `${fx(area)} vs ${fx(sum)}`);
    const wMax = Math.max(...profile.samples.map(q => q.w));
    const xs = profile.samples.map(q => q.x);
    const ys = profile.samples.map(q => q.y);
    const pad = wMax * 1.8 + 1;
    const [x0, y0, x1, y1] = geom.bbox;
    ok(x0 >= Math.min(...xs) - pad && x1 <= Math.max(...xs) + pad && y0 >= Math.min(...ys) - pad && y1 <= Math.max(...ys) + pad, `I9 ${v.id} 轮廓在包络内`);
  }
}

// I10 宽度比：同速时竖/横 = dirV/dirH（方向因子连续函数的两个锚点）
{
  const a = run(V('V01-heng-slow')).profile;
  const b = run(V('V03-shu-slow')).profile;
  const r = widthAt(b, 0.5 * b.len) / widthAt(a, 0.5 * a.len);
  ok(r >= 1.45 && r <= 1.75, 'I10 慢竖 / 慢横 中段宽比 ∈ [1.45, 1.75]（横细竖粗）', fx(r));
}

// ---------------------------------------------------------------- 输出
console.log('id                      pts   len    w/B@.25/.5/.75   caps          hook corners v30   area');
for (const r of rows) console.log(`${r[0].padEnd(23)} ${String(r[1]).padStart(4)} ${r[2].padStart(6)}  ${r[3].padEnd(16)} ${r[4].padEnd(13)} ${r[5].padEnd(4)} ${String(r[6]).padEnd(7)} ${r[7].padEnd(5)} ${r[8]}`);
console.log(`\n${doc.vectors.length} vectors · ${pass} assertions passed · ${fail} failed`);
if (fail) {
  for (const f of fails) console.log('  FAIL', f);
  process.exit(1);
}
