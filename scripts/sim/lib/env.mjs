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
