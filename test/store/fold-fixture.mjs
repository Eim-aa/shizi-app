// R15 共用：在 Node 里按 QA 夹具的 seedRecords.gen 造记录（与 ios/ShiziApp/ShiziUITests/States/_ops/seedRecords.js 同一算法：
// 每条经 judgeInDraft，种子化线性同余选字，wrongEvery 定写错），再按需折叠（store/budget.js recover）。
// 不以 .test.mjs 结尾，node --test 不会把它当测试文件跑。
import { judgeInDraft } from '../../src/session/write-ops.js';
import { createSession } from '../../src/core/sessions.js';
import { recover } from '../../src/store/budget.js';
import { loadFSRSGlobal } from '../core/helpers.mjs';

loadFSRSGlobal();

const VARIANTS = [
  [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 168, t: 60 }, { x: 290, y: 172, t: 120 }]],
  [[{ x: 60, y: 120, t: 0 }, { x: 170, y: 118, t: 60 }, { x: 290, y: 122, t: 120 }], [{ x: 172, y: 50, t: 300 }, { x: 170, y: 170, t: 360 }, { x: 174, y: 300, t: 420 }]],
  [[{ x: 70, y: 70, t: 0 }, { x: 170, y: 170, t: 60 }, { x: 290, y: 290, t: 120 }], [{ x: 290, y: 70, t: 250 }, { x: 180, y: 180, t: 310 }, { x: 70, y: 290, t: 370 }]],
];

const isoOf = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

/**
 * gen = {from, days, perDay, chars, seed, wrongEvery, ink?}（同夹具）；extra = {paperEvery?, perRecordInk?}
 * paperEvery：每第 k 条改成纸上记录（source:'paper'，没有墨迹），覆盖 D47 的折叠口径。
 */
export function seedGen(gen, { paperEvery = 0 } = {}) {
  const d = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
  let idN = 100;
  const nextId = p => p + (idN += 1);
  let s = (gen.seed === undefined ? 1 : gen.seed) >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const pool = [...gen.chars];
  const start = new Date(`${gen.from}T09:00:00`).getTime();
  let n = 0;
  for (let day = 0; day < gen.days; day += 1) {
    const iso = isoOf(new Date(start + day * 86400000));
    for (let k = 0; k < gen.perDay; k += 1) {
      const ch = pool[Math.floor(rnd() * pool.length)];
      const idx = day * gen.perDay + k;
      const judgment = gen.wrongEvery && idx % gen.wrongEvery === 0 ? 'wrong' : 'correct';
      const at = new Date(`${iso}T09:${String(10 + k).padStart(2, '0')}:00`).getTime();
      d.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + ch], at });
      const paper = paperEvery && idx % paperEvery === paperEvery - 1;
      judgeInDraft(d, { slot: 'A', cardKey: 'base:' + ch, judgment, strokes: VARIANTS[n % 3], at, nextId, perRecordInk: gen.ink !== false, ...(paper ? { source: 'paper' } : {}) });
      n += 1;
      d.sessions.A = null;
    }
  }
  d.sessions = { A: null, B: null, lastEnded: {} };
  return d;
}

/** 深拷贝后折叠（recover 改 draft；只折记录，不让墨迹预算参与）。返回 {state, actions}。 */
export function foldAll(state, now, { budgets = null } = {}) {
  const draft = JSON.parse(JSON.stringify(state));
  const r = recover(draft, { now, budgets: budgets || { inkBudgetBytes: Infinity } });
  return { state: draft, actions: r.actions };
}
