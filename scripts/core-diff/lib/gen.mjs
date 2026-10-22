// 种子化随机操作序列（B4.0；计划 §4.3 ④）。同一种子 + 同一组可用 op + 同一时区 → 同一序列。
// 各域在 scripts/core-diff/domains/*.mjs 里登记「op → { weight, args(g) }」；B4.x 每移植一个域就加一个文件并登记到 DOMAINS。
// 生成器只造请求，不知道任何规则；可用 op = 两个引擎 hello 回的 op 表的交集（Swift 还没移植的 op 自动不出）。
import protocolDomain from '../domains/protocol.mjs';
import datesDomain from '../domains/dates.mjs';
import configDomain from '../domains/config.mjs';
import schemaDomain from '../domains/schema.mjs';

export const DOMAINS = [protocolDomain, datesDomain, configDomain, schemaDomain];

/** mulberry32（与 scripts/sim/lib/env.mjs 同一算法）。 */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STR_ATOMS = ['a', 'z', 'Z', '0', '9', ' ', '"', '\\', '/', '\n', '\t', '\u0000', '\u0001', '\u001f', '\u007f', ' ', ' ',
  'é', 'é', 'Å', 'Å', '拾', '字', '永', '𠀀', '😀', '👍🏽', '﻿', '￿', '-', '.', 'shizi', '__proto__', 'constructor'];
const KEY_ATOMS = ['a', 'b', 'k', 'records', 'shizi.records.v2', 'shizi.sched.v1', '0', '1', '2', '10', '01', '4294967294', '4294967295', '-1', '1.5',
  'é', 'é', '拾', '😀', '__proto__', 'toString', ''];

/** 生成器上下文：随机工具 + 各域共用的「有意思的值」。 */
export function makeCtx(r) {
  const g = {
    r,
    float: () => r(),
    int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
    chance: (p) => r() < p,
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    weighted(entries) {
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let x = r() * total;
      for (const [v, w] of entries) {
        x -= w;
        if (x < 0) return v;
      }
      return entries[entries.length - 1][0];
    },
    /** 任意有限 double：整数、小数、极大极小、次正规、随机位型。 */
    number() {
      return g.weighted([
        [() => g.int(-1000, 1000), 4],
        [() => g.int(-(2 ** 31), 2 ** 31), 2],
        [() => g.pick([0, -0, 1, -1, 0.1, 0.2, 0.30000000000000004, 1 / 3, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 1e21, 1e21 - 65536, 999999999999999900000, 1e-6, 1e-7, 1.5e-7, 123e-20,
          5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, 4.35, 0.000001234, 1234567.891, 100, 1e100, -1e-100]), 3],
        [() => (r() - 0.5) * 10 ** g.int(-30, 30), 3],
        [() => {
          const buf = new DataView(new ArrayBuffer(8));
          buf.setUint32(0, Math.floor(r() * 2 ** 32));
          buf.setUint32(4, Math.floor(r() * 2 ** 32));
          const x = buf.getFloat64(0);
          return Number.isFinite(x) ? x : 0.5;
        }, 2],
      ])();
    },
    string(max = 6) {
      let s = '';
      const n = g.int(0, max);
      for (let i = 0; i < n; i += 1) s += g.pick(STR_ATOMS);
      return s;
    },
    key: () => (g.chance(0.85) ? g.pick(KEY_ATOMS) : g.string(3)),
    /** 任意 JSON 值（无孤立代理项）。 */
    value(depth = 3) {
      const leaf = [[() => null, 1], [() => g.chance(0.5), 1], [() => g.number(), 4], [() => g.string(), 3]];
      const kinds = depth > 0 ? [...leaf, [() => Array.from({ length: g.int(0, 4) }, () => g.value(depth - 1)), 2], [() => {
        const o = {};
        const n = g.int(0, 4);
        for (let i = 0; i < n; i += 1) Object.defineProperty(o, g.key(), { value: g.value(depth - 1), enumerable: true, configurable: true, writable: true });
        return o;
      }, 2]] : leaf;
      return g.weighted(kinds)();
    },
  };
  return g;
}

/**
 * 生成一条序列。
 * @param {number} seed
 * @param {number} steps
 * @param {Set<string>} available  两个引擎都支持的 op
 * @returns {Array<object>}  请求对象（{ __raw } 表示原样发送的坏行）
 */
export function generate(seed, steps, available) {
  const g = makeCtx(rng(seed));
  g.available = available;
  for (const d of DOMAINS) if (d.prepare) d.prepare(g);
  const table = [];
  for (const d of DOMAINS) for (const [op, spec] of Object.entries(d.ops)) if (spec.always || available.has(op)) table.push([op, spec]);
  const entries = table.map(([op, spec]) => [[op, spec], spec.weight]);
  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const [op, spec] = g.weighted(entries);
    const req = spec.request ? spec.request(g) : { op, args: spec.args ? spec.args(g) : {} };
    out.push(req);
  }
  return out;
}

/** 请求对象 → 线上的一行。 */
export function lineOf(req) {
  return req && Object.prototype.hasOwnProperty.call(req, '__raw') ? req.__raw : JSON.stringify(req);
}
