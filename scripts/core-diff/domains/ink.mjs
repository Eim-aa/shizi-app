// 墨域（src/core/ink-math.js；B4.3）：随机笔画（原始采样 / 管线输出风格）喂 buildStroke、抽点、v3 打包编码、v4 原始点编码；
// 随机墨迹（JS 现编的合法 v3 / v4、手造的 v2、再变异）喂解码与形状判定；V8 的 Math.hypot / Math.exp 复刻单独逐位比。
import { b43 } from '../lib/b43-shapes.mjs';
import * as ink from '../../../src/core/ink-math.js';
import * as policy from '../../../src/config/policy.js';

/** 一张完整的 policy.ink 表（14 个键）的随机变化。 */
function inkTable(g) {
  const base = { ...policy.ink };
  if (g.chance(0.5)) return base;
  const out = { ...base };
  for (const k of Object.keys(out)) if (g.chance(0.35)) out[k] = Math.round(out[k] * (0.5 + g.float()) * 1000) / 1000;
  if (g.chance(0.1)) delete out[g.pick(Object.keys(out))];
  return out;
}

export default {
  id: 'ink',
  prepare(g) {
    const B = b43(g);
    g.policyInk = () => {
      const p = { ink: inkTable(g) };
      if (g.chance(0.5)) p.inkMaxPointsPerStroke = g.pick([2, 3, 6, 12, 24, 100, 2.7, 1]);
      if (g.chance(0.5)) p.inkMaxStrokes = g.pick([0, 1, 3, 36, 2.5]);
      if (g.chance(0.5)) p.inkStoreTolerance = g.pick([null, { xy: 0.3, w: 0.3, t: 24 }, { xy: 1, w: 1, t: 50 }, { xy: 0, w: -1 }, {}]);
      return p;
    };
    g.inkOptsArgs = () => {
      const a = {};
      if (g.chance(0.3)) a.policy = g.policyInk();
      if (g.chance(0.2)) a.base = g.pick([11.5, 8, 14, 0.5]);
      for (const k of ['lo', 'hi', 'step', 'tapMax', 'tapRatio', 'euroBeta', 'pressureGain']) if (g.chance(0.04)) a[k] = Math.round(policy.ink[k] * (0.5 + g.float()) * 100) / 100;
      return a;
    };
    g.rawStrokes = (max = 4) => B.strokes(() => B.raw(), max);
    g.builtStrokes = (max = 4) => B.strokes(() => B.built(), max);
    /** 一份合法的存下的墨迹：v3（从管线输出编码）/ v4（从原始点编码）/ v2（手造）。 */
    g.storedInk = () => g.weighted([
      [() => ink.encodeInkRaw(g.rawStrokes(), { maxStrokes: g.pick([36, 2]) }), 5],
      [() => ink.encodeInk(g.rawStrokes(3).map((s) => ink.buildStroke(s, { final: true })), { tolerance: g.pick([undefined, null]) }), 4],
      [() => {
        const row = (n) => Array.from({ length: n * 3 }, (_, i) => (i % 3 === 2 ? g.int(0, 255) : g.int(0, 1023)));
        const ns = Array.from({ length: g.int(0, 3) }, () => g.int(0, 5));
        const o = { v: 2, c: 345, s: ns.map(row) };
        if (g.chance(0.5)) o.dt = ns.map((n) => Array.from({ length: n }, () => g.int(0, 40)));
        if (g.chance(0.5)) o.p = ns.map((n) => Array.from({ length: n }, () => g.int(0, 100)));
        return o;
      }, 3],
      [() => ({ v: 4, c: g.pick([345, 690, 100]), r: ['AAAA'], g: [0] }), 1],
    ])();
    g.storedInkMaybeBad = () => (g.chance(0.3) ? B.S.mutate(g.storedInk()) : g.storedInk());
    g.packedRow = () => {
      const stride = g.pick([3, 4]);
      const n = g.int(1, 6);
      const row = [stride];
      for (let i = 0; i < n; i += 1) {
        row.push(g.int(-3000, 4000), g.int(-3000, 4000), g.int(0, 400));
        if (stride === 4) row.push(g.int(0, 1000));
      }
      return row;
    };
  },
  ops: {
    'jsmath.hypot': { weight: 3, args: (g) => ({ a: g.pick([0, 3, 1e-300, 1e300, 0.1, 345, -2.5, g.float() * 400 - 200, g.float() * 5]), b: g.pick([0, 4, 1e-300, 1e300, 0.2, 345, -1.5, g.float() * 400 - 200, g.float() * 5]) }) },
    'jsmath.exp': { weight: 3, args: (g) => ({ x: g.pick([0, 1, -1, -0.5, -g.float() * 2, g.float() * 40 - 20, g.float() * 1500 - 750, -dtOverTau(g), 709.78, -745.13]) }) },
    'ink.params': { weight: 0.3, args: (g) => (g.chance(0.5) ? { policy: g.policyInk() } : {}) },
    'ink.mergeSameTime': { weight: 1.5, args: (g) => ({ raw: B(g).raw() }) },
    'ink.liftSpeed': { weight: 1.5, args: (g) => { const m = ink.mergeSameTime(B(g).raw()); return { merged: m, ...(g.chance(0.3) ? { window: g.pick([30, 10, 100]) } : {}) }; } },
    'ink.catmullRom': { weight: 2, args: (g) => ({ points: g.chance(0.6) ? B(g).built() : B(g).raw(), ...(g.chance(0.3) ? { step: g.pick([3, 1, 10, 0.5]) } : {}) }) },
    'ink.buildStroke': { weight: 6, args: (g) => ({ raw: B(g).raw(), final: g.chance(0.7), ...g.inkOptsArgs() }) },
    'ink.strokeLength': { weight: 0.5, args: (g) => ({ points: B(g).built() }) },
    'ink.thinStroke': { weight: 2, args: (g) => ({ points: B(g).built(), ...(g.chance(0.6) ? { max: g.pick([2, 3, 5, 12, 24, 2.5, 1]) } : {}) }) },
    'ink.simplifyStroke': { weight: 4, args: (g) => ({ points: B(g).built(), ...(g.chance(0.6) ? { max: g.pick([2, 3, 6, 12, 24, 100]) } : {}), ...(g.chance(0.6) ? { tolerance: g.pick([null, { xy: 0.3, w: 0.3, t: 24 }, { xy: 2, w: 2, t: 100 }, { xy: 0.05, w: 0.05, t: 4 }, {}, { xy: -1, w: 'x' }]) } : {}) }) },
    'ink.quantizeDt': { weight: 1.5, args: (g) => ({ ms: g.pick([0, 1, 2, 3, 5, 6, 10, 14, 20, 28, 40, 56, 80, 112, 160, 224, 384, 700, 1500, 3000, 99999, -5, 0.5, 2.9, g.float() * 400]) }) },
    'ink.bytesToBase64': { weight: 1, args: (g) => ({ bytes: Array.from({ length: g.int(0, 10) }, () => g.int(0, 255)) }) },
    'ink.base64ToBytes': { weight: 2, args: (g) => ({ str: g.weighted([[() => B(g).S.base64(g.int(0, 4)), 4], [() => g.pick(['', 'AA==', 'AAA=', 'A===', '=AAA', 'AAA', 'AB==', 'AAB=', 'AAAA\n', 'ＡＡＡＡ', 'AA==AA==', 'A A=', 'AAAAAA==', '+/+/', '-_-_']), 4]])() }) },
    'ink.isBase64': { weight: 1, args: (g) => ({ str: g.weighted([[() => B(g).S.base64(g.int(0, 4)), 3], [() => g.pick(['', 'AA==', 'AAA=', 'A===', '=AAA', 'AAA', 'AAAA\n', 'AA==AA==', 'ÀAAA']), 4]])() }) },
    'ink.encodeInk': {
      weight: 6,
      args: (g) => {
        const a = { strokes: g.builtStrokes() };
        if (g.chance(0.2)) a.base = g.pick([11.5, 8, 0.5]);
        if (g.chance(0.3)) a.maxPoints = g.pick([2, 3, 6, 12, 24, 2.7]);
        if (g.chance(0.2)) a.maxStrokes = g.pick([0, 1, 2, 36, 1.5]);
        if (g.chance(0.4)) a.tolerance = g.pick([null, { xy: 0.3, w: 0.3, t: 24 }, { xy: 1, w: 1, t: 50 }, {}]);
        if (g.chance(0.2)) a.policy = g.policyInk();
        return a;
      },
    },
    'ink.isInk': { weight: 2, args: (g) => ({ ink: g.weighted([[() => g.storedInkMaybeBad(), 8], [() => g.pick([null, 5, 'x', [], {}, { v: 3 }, { v: 2, c: 345, s: [[1.5, 2, 3]] }, { v: 2, c: 345, s: [[1, 2, 3]], dt: [[0, 1]] }, { v: 3, c: 345, s: ['AAAA'], dt: [] }]), 2]])() }) },
    'ink.decodeInk': { weight: 6, args: (g) => ({ ink: g.storedInkMaybeBad(), ...(g.chance(0.3) ? g.inkOptsArgs() : {}) }) },
    'ink.resampleForReplay': { weight: 1.5, args: (g) => ({ decoded: g.builtStrokes(3), ...(g.chance(0.3) ? { step: g.pick([3, 5, 1]) } : {}) }) },
    'ink.encodeRawStrokes': { weight: 3, args: (g) => ({ strokes: g.rawStrokes() }) },
    'ink.decodeRawStrokes': { weight: 2, args: (g) => ({ rows: [...Array.from({ length: g.int(0, 3) }, () => g.packedRow()), ...(g.chance(0.4) ? [g.pick([[3], [5, 1, 2, 3], [4, 1, 2, 3], [3, 1, 2], [], [3, 1.5, 2, 3], [3, 1, 2, 'x'], null, [4, 1, 2, 3, -5, 1, 2, 3, 4]])] : [])] }) },
    'ink.rawRowToPacked': { weight: 3, args: (g) => ({ row: g.chance(0.85) ? g.packedRow() : g.pick([[], [3], [3, 1, 2], [5, 1, 2, 3], [3, 1.5, 2, 3], [3, 1, 2, 3, 4], [4, 1, 2, 3, 4], [3, -1, -1, -5], [3, 1e15, 2, 3], [3, 1e300, 2, 3]]) }) },
    'ink.packedToRawRow': { weight: 3, args: (g) => ({ str: g.weighted([[() => ink.rawRowToPacked(g.packedRow()), 5], [() => g.pick(['', 'AAAA', 'AwAAAA==', 'BAAAAA==', 'AwAAAAA=', 'A/////8A', 'AwGAgICAgAE=', 'AwGAgICAgIA=']), 2], [() => B(g).S.base64(g.int(1, 3)), 1]])() }) },
    'ink.encodeInkRaw': { weight: 5, args: (g) => ({ strokes: g.rawStrokes(5), ...(g.chance(0.2) ? { maxStrokes: g.pick([0, 1, 2, 36, 2.5]) } : {}), ...(g.chance(0.1) ? { policy: g.policyInk() } : {}) }) },
    'ink.inkRawRows': { weight: 2, args: (g) => ({ ink: g.storedInkMaybeBad() }) },
    'ink.decodeInkRaw': { weight: 3, args: (g) => ({ ink: g.storedInkMaybeBad() }) },
    'ink.encodeStoredInk': { weight: 3, args: (g) => ({ strokes: g.rawStrokes(3), ...(g.chance(0.5) ? { format: g.pick(['raw', 'v3', 'x']) } : {}), ...(g.chance(0.1) ? { policy: g.policyInk() } : {}) }) },
  },
};

function B(g) {
  return b43(g);
}

function dtOverTau(g) {
  return g.pick([4, 8, 16.7, 33, 1, 0.5, 120]) / 35;
}
