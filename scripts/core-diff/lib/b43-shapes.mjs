// B4.3 随机差分 / 金标准共用的值工厂：记录列表（小字池、小日期池，让「同字多次」「同日」「同序号」经常发生）、sched、墨迹、笔点、题库行等。
// `g` 是 gen.mjs 的上下文。各函数偏向边界值；变异（非法值）走 shapes.mjs 的 mutate。
import { shapes } from './shapes.mjs';

export const CHARS = ['人', '口', '拾', '静', '亦', '𠮷', '大', '一', 'a'];
export const DAYS = ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-08-30', '2026-10-01', '2026-02-28'];
export const MONTHS = ['2026-09', '2026-08', '2026-10', '2026-02'];

export function b43(g) {
  if (g.b43) return g.b43;
  const S = shapes(g);
  const B = { S };
  const pick = (a) => g.pick(a);
  if (typeof g.time !== 'function') g.time = () => g.pick([1789000000000, 1789434000000, 1790000000123, 0, 1.5e12 + 0.5, 1789488000000, 1789459200000]);

  B.char = () => pick(CHARS);
  B.day = () => pick(DAYS);
  B.cardKey = (c) => `base:${c ?? B.char()}`;

  /** 一条合法记录（字池 / 日池里取）。 */
  B.record = (serial, extra = {}) => {
    const ch = extra.char ?? B.char();
    const kind = extra.kind ?? g.weighted([['judged', 6], ['answer-seen', 2], ['skipped', 2]]);
    const r = { id: `r${serial}`, cardKey: g.chance(0.93) ? `base:${ch}` : `custom:${ch}`, char: ch };
    const legacy = g.chance(0.05);
    if (!legacy) r.sessionId = `s${g.int(1, 9)}`;
    r.kind = kind;
    r.at = extra.at ?? g.time();
    r.localDay = extra.localDay ?? B.day();
    r.help = { hints: g.pick([0, 0, 0, 1, 2, 64]), answerSeen: kind === 'answer-seen', traced: g.chance(0.2) };
    if (kind === 'judged') r.judgment = extra.judgment ?? g.pick(['correct', 'wrong']);
    if (kind === 'judged' && g.chance(0.12)) r.corrections = Array.from({ length: g.int(0, 2) }, () => ({ from: g.pick(['correct', 'wrong']), at: g.time() }));
    if (kind === 'judged' && g.chance(0.12)) r.source = 'paper';
    else if (g.chance(0.05)) r.source = 'screen';
    if (r.source !== 'paper' && g.chance(0.2)) r.inkId = `r${g.int(1, 30)}`;
    if (legacy) r.legacy = true;
    return S.maybeShuffle(r, 0.1);
  };

  /** 记录列表：序号不重复（偶尔重复），顺序偶尔打乱。 */
  B.records = (max = 9) => {
    const n = g.int(0, max);
    const serials = Array.from({ length: 30 }, (_, i) => i + 1);
    for (let i = serials.length - 1; i > 0; i -= 1) {
      const j = g.int(0, i);
      [serials[i], serials[j]] = [serials[j], serials[i]];
    }
    const list = [];
    for (let i = 0; i < n; i += 1) list.push(B.record(g.chance(0.04) && list.length ? Number(list[0].id.slice(1)) : serials[i]));
    if (g.chance(0.5)) list.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    return list;
  };

  B.cardKeyOfList = (list) => (list.length && g.chance(0.85) ? pick(list).cardKey : B.cardKey());

  /** sched：cardKey → {due, fsrs, lastJudgedAt, stoppedAt?}；key 取自记录里出现过的字。 */
  B.schedFor = (list) => {
    const o = {};
    const keys = [...new Set(list.map((r) => r.cardKey))];
    for (const k of keys) {
      if (g.chance(0.25)) continue;
      const e = { fsrs: g.pick([{ stability: g.pick([0, 1, 2.5, 9, 40, -1]) }, { stability: g.pick(['3', null, 'x']) }, {}, null, [], { stability: g.int(1, 30) + 0.5 }]), due: g.weighted([[() => B.day(), 8], [() => null, 1], [() => '2026-9-24', 1], [() => 'x', 1]])(), lastJudgedAt: g.time() };
      if (g.chance(0.15)) e.stoppedAt = g.time();
      o[k] = S.maybeShuffle(e, 0.1);
    }
    if (g.chance(0.05)) o['base:ghost'] = { fsrs: {}, due: B.day(), lastJudgedAt: 0 };
    return o;
  };

  // ------------------------------------------------------------ 笔点
  B.raw = (opts = {}) => {
    // 一笔原始采样：随机游走；t 递增（含零间隔 / 乱序 / 缺 t）；p 可选
    const n = g.weighted([[() => 1, 2], [() => 2, 2], [() => g.int(3, 12), 4], [() => g.int(13, 60), 3], [() => g.int(61, 140), 1]])();
    const pen = g.chance(0.3);
    let x = g.int(-20, 365);
    let y = g.int(-20, 365);
    let t = g.pick([0, 1000, 123456.5, 1789000000000]);
    const speed = g.pick([0.3, 1, 3, 8, 25]);
    const dtBase = g.pick([4, 8, 16.7, 33, 1]);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      x += (g.float() - 0.5) * speed * 2;
      y += (g.float() - 0.5) * speed * 2;
      if (g.chance(0.04)) x = g.pick([0, 345, -5, 400]);
      t += g.chance(0.08) ? 0 : g.chance(0.02) ? -3 : g.float() * dtBase * 2;
      const q = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
      if (!(opts.noT || g.chance(0.02))) q.t = Math.round(t * 100) / 100;
      if (pen && g.chance(0.9)) q.p = g.pick([0, 0.05, g.float(), g.float(), 1, 1.2]);
      out.push(S.maybeShuffle(q, 0.05));
    }
    return out;
  };

  /** 管线输出风格的点（x,y,w,t,p?）：用于 encodeInk / 抽点。 */
  B.built = () => {
    const n = g.weighted([[() => 0, 1], [() => 1, 2], [() => 2, 2], [() => g.int(3, 30), 5], [() => g.int(31, 90), 2]])();
    let x = g.int(0, 345);
    let y = g.int(0, 345);
    let t = g.pick([0, 500, 123456]);
    const out = [];
    const withP = g.chance(0.25);
    for (let i = 0; i < n; i += 1) {
      x += (g.float() - 0.5) * g.pick([1, 5, 30]);
      y += (g.float() - 0.5) * g.pick([1, 5, 30]);
      t += g.float() * g.pick([2, 10, 60, 300]);
      const q = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
      if (!g.chance(0.05)) q.w = Math.round((3 + g.float() * 14) * 1000) / 1000;
      if (!g.chance(0.05)) q.t = Math.round(t * 10) / 10;
      if (withP && g.chance(0.8)) q.p = g.pick([0, g.float(), 1]);
      out.push(S.maybeShuffle(q, 0.05));
    }
    return out;
  };

  B.strokes = (gen, max = 5) => Array.from({ length: g.int(0, max) }, gen);

  g.b43 = B;
  return B;
}
