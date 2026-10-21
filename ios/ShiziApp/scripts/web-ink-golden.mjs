// R11-A（D72 ②）金标准：用网页 src/core/ink-math.js buildStroke 对一组固定原始点生成参考输出，
// Swift WebInk.buildStroke 逐点对比（ShiziWriteTests/WebInkTests.swift，容差见那里：位置 / 宽 1e-3 单位，时间 1e-6 ms）。
//
// usage: node ios/ShiziApp/scripts/web-ink-golden.mjs [--check]
//   写 ios/ShiziApp/ShiziWriteTests/Fixtures/web-ink-golden.json；--check 只比对（不一致退出 1）。
//   node 单测 test/core/web-ink-golden.test.mjs 也核它与代码 / policy 同步：改了 buildStroke 或 policy.ink 要重新生成。
// 原始点全部由确定的公式生成（无随机数），覆盖：快 / 慢、60 / 120 / 240Hz、手指 / Pencil 压力、极短笔（点画）、单点、
// 同一时刻的重复采样、抬笔前停顿、大时间戳（原生 UITouch.timestamp × 1000）、书写中（final = false）与抬笔后（final = true）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStroke, inkParams } from '../../../src/core/ink-math.js';
import * as policy from '../../../src/config/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
export const goldenPath = join(here, '..', 'ShiziWriteTests', 'Fixtures', 'web-ink-golden.json');

const r6 = x => Math.round(x * 1e6) / 1e6;
const withP = (q, p, u) => {
  const pp = typeof p === 'function' ? p(u) : p;
  if (pp !== null && pp !== undefined) q.p = r6(pp);
  return q;
};
/** 匀速折线：from → to，hz 采样，speed 单位 / ms。 */
function line([x0, y0], [x1, y1], { hz = 60, speed = 0.5, t0 = 1000, p = null } = {}) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const dt = 1000 / hz;
  const n = Math.max(1, Math.round(len / speed / dt));
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    return withP({ x: r6(x0 + (x1 - x0) * u), y: r6(y0 + (y1 - y0) * u), t: r6(t0 + i * dt) }, p, u);
  });
}
/** 圆弧（撇 / 弯钩一类曲线），速度先快后慢。 */
function arc({ cx, cy, r, a0, a1, hz = 120, ms = 300, t0 = 5000, p = null }) {
  const dt = 1000 / hz;
  const n = Math.max(2, Math.round(ms / dt));
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const a = a0 + (a1 - a0) * (1 - (1 - u) * (1 - u));
    return withP({ x: r6(cx + r * Math.cos(a)), y: r6(cy + r * Math.sin(a)), t: r6(t0 + i * dt) }, p, u);
  });
}

const CASES = [
  { id: 'finger-fast-60hz', raw: line([60, 150], [285, 160], { hz: 60, speed: 1.4 }) },
  { id: 'finger-slow-60hz', raw: line([60, 150], [285, 160], { hz: 60, speed: 0.12 }) },
  { id: 'finger-mid-120hz', raw: line([172, 60], [176, 290], { hz: 120, speed: 0.6 }) },
  { id: 'finger-curve-120hz', raw: arc({ cx: 172, cy: 172, r: 110, a0: -2.6, a1: 0.4, hz: 120, ms: 320 }) },
  // 逐屏对比（NativeQAHarness 注入）的两笔
  { id: 'qa-harness-horizontal', raw: Array.from({ length: 14 }, (_, i) => ({ x: 70 + 15 * i, y: 150 + i, t: 1000 + i * 16 })) },
  { id: 'qa-harness-vertical', raw: Array.from({ length: 14 }, (_, i) => ({ x: 172 + 0.5 * i, y: 60 + 17 * i, t: 2000 + i * 16 })) },
  { id: 'pencil-pressure-240hz', raw: line([80, 80], [260, 250], { hz: 240, speed: 0.5, p: u => 0.15 + 0.7 * Math.sin(Math.PI * u) }) },
  { id: 'pencil-light-120hz', raw: arc({ cx: 150, cy: 200, r: 90, a0: 3.4, a1: 5.9, hz: 120, ms: 260, p: u => 0.08 + 0.1 * u }) },
  { id: 'pencil-mixed-zero-pressure', raw: line([60, 300], [290, 280], { hz: 120, speed: 0.8, p: u => (u < 0.2 ? 0 : 0.6) }) },
  { id: 'short-dot-stroke', raw: line([170, 170], [180, 176], { hz: 60, speed: 0.15 }) },
  { id: 'short-dot-pencil', raw: line([170, 170], [176, 178], { hz: 120, speed: 0.1, p: 0.5 }) },
  { id: 'single-point', raw: [{ x: 120, y: 130, t: 3000 }] },
  { id: 'single-point-pencil', raw: [{ x: 120, y: 130, t: 3000, p: 0.42 }] },
  { id: 'same-place-tap', raw: [{ x: 50, y: 60, t: 100 }, { x: 50, y: 60, t: 140 }] },
  {
    id: 'same-time-duplicates',
    raw: line([40, 40], [300, 90], { hz: 60, speed: 0.9 }).flatMap((q, i) => (i % 3 === 1 ? [{ ...q, x: q.x - 2 }, q] : [q])),
  },
  { id: 'pause-before-lift', raw: [...line([40, 100], [200, 100], { hz: 60, speed: 1 }), { x: 200, y: 100, t: 1460 }] },
  { id: 'big-native-timestamps', raw: line([60, 200], [280, 120], { hz: 120, speed: 1.1, t0: 123456789.25 }) },
  {
    id: 'slow-then-flick',
    raw: [...line([80, 220], [200, 220], { hz: 120, speed: 0.3 }), ...line([204, 221], [300, 230], { hz: 120, speed: 2.2, t0: 1400 + 1000 / 120 })],
  },
];

export function goldenText() {
  const out = {
    '//': 'R11-A（D72 ②）：网页 buildStroke 的参考输出，由 ios/ShiziApp/scripts/web-ink-golden.mjs 生成，勿手改。raw = [x, y, t, p?]；out = [x, y, w, t, p?]。Swift WebInkTests 逐点对比。',
    params: { ...inkParams(policy) },
    cases: [],
  };
  const num = x => (x === null || x === undefined ? null : r6(x));
  for (const c of CASES) {
    for (const final of [true, false]) {
      const pts = buildStroke(c.raw, { final });
      out.cases.push({
        id: `${c.id}${final ? '' : ' (live)'}`,
        final,
        raw: c.raw.map(q => (q.p !== undefined ? [q.x, q.y, q.t, q.p] : [q.x, q.y, q.t])),
        out: pts.map(q => (q.p !== undefined ? [r6(q.x), r6(q.y), r6(q.w), r6(q.t), r6(q.p)] : [r6(q.x), r6(q.y), r6(q.w), r6(q.t)])),
        v30: num(pts.v30),
        dot: pts.dot,
        single: pts.single,
        endK: num(pts.endK),
        pressure: pts.pressure,
      });
    }
  }
  return JSON.stringify(out).replace(/,\{"id"/g, ',\n{"id"') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = goldenText();
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(goldenPath, 'utf8'); } catch { /* 没有文件 */ }
    if (cur !== text) {
      console.error(`web-ink golden is stale: run node ios/ShiziApp/scripts/web-ink-golden.mjs (${goldenPath})`);
      process.exit(1);
    }
    console.log('web-ink golden up to date');
  } else {
    writeFileSync(goldenPath, text);
    console.log(`wrote ${goldenPath}`);
  }
}
