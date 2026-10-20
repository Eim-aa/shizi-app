// 模拟环境：加载真实题库、真实 FSRS，建一个内存里的真实 store。不复制任何调度逻辑。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadFSRSGlobal } from '../../../test/core/helpers.mjs';
import { MemoryStorage } from '../../../test/store/helpers.mjs';
import { createStore } from '../../../src/store/store.js';
import { createStorage } from '../../../src/store/storage.js';
import { setDeckSource } from '../../../src/data/deck.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let booted = false;
/** 加载 FSRS 库与真实题库（deck-data.js + data/context-overrides.js），只做一次。 */
export function bootDeck() {
  if (booted) return;
  loadFSRSGlobal();
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'deck-data.js'), 'utf8')}\n;globalThis.__seed = SEED;`, ctx);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'data/context-overrides.js'), 'utf8')}\n;globalThis.__ov = CONTEXT_OVERRIDES;`, ctx);
  setDeckSource({ seed: ctx.__seed, overrides: ctx.__ov });
  booted = true;
}

/** 可复现的随机数（mulberry32）。 */
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

/** 一个内存 store，时钟由 clock.t 驱动。 */
export function makeStore(clock, { budgets = null, freeze = true } = {}) {
  const storage = createStorage(new MemoryStorage(), { now: () => clock.t });
  const store = createStore({ storage, now: () => clock.t, budgets, freeze });
  store.load();
  return store;
}

export const STROKES = Object.freeze([[{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }]]);

// ---- 真实格式的笔迹（D66 ⑭ 实测存储用；cfg.realInk）----
// 按 data/<字>.json 的笔顺中线模拟一次书写（与 test/core/ink-math.test.mjs writeChar 同一做法）：120Hz 取点、起收慢中段快
// （0.15–0.7 单位/ms）、±0.4 单位手抖、笔间 350ms，坐标是 345 单位的书写格。返回原始笔画 [[{x,y,t}]]（判断提交时再 buildStroke + encodeInk）。
const HZ120 = 1000 / 120;
const GRID = 345;
const rawCache = new Map();
export function realStrokesOf(ch, variant = 0) {
  const key = ch + '|' + variant;
  if (rawCache.has(key)) return rawCache.get(key);
  const file = path.join(ROOT, 'data', ch + '.json');
  let out = STROKES;
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    out = [];
    let t = 1000;
    for (const median of data.medians || []) {
      const pts = median.map(([x, y]) => ({ x: (x / 1024) * GRID + variant * 0.7, y: ((900 - y) / 1024) * GRID }));
      const cum = [0];
      for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const L = cum[cum.length - 1];
      const raw = [];
      let s = 0;
      let k = 0;
      while (s < L) {
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i += 1;
        const f = cum[i] > cum[i - 1] ? (s - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
        raw.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f + Math.sin(k * 1.7 + variant) * 0.4, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f + Math.cos(k * 2.3) * 0.4, t: t + k * HZ120 });
        s += (0.15 + 0.55 * Math.sin(Math.PI * Math.min(1, (s / L) * 1.1))) * HZ120;
        k += 1;
      }
      const end = pts[pts.length - 1];
      raw.push({ x: end.x, y: end.y, t: t + k * HZ120 });
      t += k * HZ120 + 350;
      out.push(raw);
    }
    if (!out.length) out = STROKES;
  }
  rawCache.set(key, out);
  return out;
}
