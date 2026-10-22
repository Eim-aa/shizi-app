// 造记录（夹具生成器，种子化、可复现）：每条经 judgeInDraft——与真人判断同一个函数（records + FSRS 调度表 + 墨迹），时间戳全部来自夹具里写死的 at / day，
// 所以同一份夹具在任何一天跑出同一份数据。累积进 ctx.draft，之后由 seed 提交（可与 patch 混用）。
//   a.entries: [{char | chars, at: 'YYYY-MM-DDTHH:mm:ss'（本地时间；也可以是毫秒数） | day: 'YYYY-MM-DD'（当天 09:00）, judgment: 'correct'|'wrong', kind: 'daily'|'first'|'picked', ink: true|false, variant: 0|1|2}]
//              chars 是一串字时每个字一个会话、每字隔 1 秒；ink 缺省 true（留墨）
//   a.groups:  [{slot: 'A'|'B', kind, at, chars: [字], steps: ['correct'|'wrong'…]}]  保留在槽里的进行中的组（steps 是已判断的前几个字）
//   a.lib:     {id: 'core3500', n: 90, from: 'YYYY-MM-DD', perDay: 3}  取这个库的前 n 个字、每字只写一次（>80 字的月字帖 / 年报分页用；留墨完整）
//   a.skips:   [{char, at | day}]  点过「跳过」的字（kind='skipped'）
//   a.gen:     {from: 'YYYY-MM-DD', days: n, perDay: m, chars: '字串', seed: 整数, wrongEvery: k}  批量：从 from 起 n 天、每天 m 个字，字按种子轮换（小的线性同余，可复现）
const { judgeInDraft } = await import('/src/session/write-ops.js');
const { createSession } = await import('/src/core/sessions.js');
const d = ctx.draft || (ctx.draft = { records: {}, sched: {}, ink: {}, sessions: { A: null, B: null, lastEnded: {} } });
ctx.idN = ctx.idN || 100;
const nextId = (p) => p + (ctx.idN += 1);
const VARIANTS = [
  [[{ x: 60, y: 170, t: 0 }, { x: 170, y: 168, t: 60 }, { x: 290, y: 172, t: 120 }]],
  [[{ x: 60, y: 120, t: 0 }, { x: 170, y: 118, t: 60 }, { x: 290, y: 122, t: 120 }], [{ x: 172, y: 50, t: 300 }, { x: 170, y: 170, t: 360 }, { x: 174, y: 300, t: 420 }]],
  [[{ x: 70, y: 70, t: 0 }, { x: 170, y: 170, t: 60 }, { x: 290, y: 290, t: 120 }], [{ x: 290, y: 70, t: 250 }, { x: 180, y: 180, t: 310 }, { x: 70, y: 290, t: 370 }]],
];
const atOf = (e, i) => (typeof e.at === 'number' ? e.at : e.at ? Date.parse(e.at) : new Date(`${e.day}T09:00:00`).getTime()) + i * 1000;
let n = 0;
const one = (e) => {
  [...(e.chars || e.char)].forEach((ch, i) => {
    const at = atOf(e, i);
    d.sessions.A = createSession({ id: nextId('s'), kind: e.kind || 'daily', source: { view: 'home' }, queue: ['base:' + ch], at });
    const strokes = VARIANTS[(e.variant === undefined ? n : e.variant) % 3];
    n += 1;
    judgeInDraft(d, { slot: 'A', cardKey: 'base:' + ch, judgment: e.judgment || 'correct', strokes, at, nextId, perRecordInk: e.ink !== false });
    d.sessions.A = null;
  });
};
for (const e of a.entries || []) one(e);
if (a.gen) {
  const g = a.gen;
  let s = (g.seed === undefined ? 1 : g.seed) >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const pool = [...g.chars];
  const start = new Date(`${g.from}T09:00:00`).getTime();
  for (let day = 0; day < g.days; day += 1) {
    const dt = new Date(start + day * 86400000);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    for (let k = 0; k < g.perDay; k += 1) {
      const ch = pool[Math.floor(rnd() * pool.length)];
      const judgment = g.wrongEvery && (day * g.perDay + k) % g.wrongEvery === 0 ? 'wrong' : 'correct';
      one({ char: ch, at: `${iso}T09:${String(10 + k).padStart(2, '0')}:00`, judgment, ink: g.ink });
    }
  }
}
if (a.lib) {
  const { libraryOf, isPracticable } = await import('/src/data/deck.js');
  const keys = libraryOf(a.lib.id || 'core3500').keys.filter(k => isPracticable(k)).slice(0, a.lib.n);
  const start = new Date(`${a.lib.from}T09:00:00`).getTime();
  keys.forEach((k, i) => {
    const day = Math.floor(i / (a.lib.perDay || 3));
    const dt = new Date(start + day * 86400000);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    one({ char: k.slice('base:'.length), at: `${iso}T09:${String(10 + (i % (a.lib.perDay || 3))).padStart(2, '0')}:00` });
  });
}
for (const sk of a.skips || []) {
  // 点过「跳过」的字（一条 kind='skipped' 记录；至今没判断过的字出现在字库「已跳过」）
  const { skipInDraft } = await import('/src/session/ops/skip.js');
  const at = atOf(sk, 0);
  d.sessions.A = createSession({ id: nextId('s'), kind: 'daily', source: { view: 'home' }, queue: ['base:' + sk.char], at });
  skipInDraft(d, { slot: 'A', cardKey: 'base:' + sk.char, at, nextId });
  d.sessions.A = null;
}
d.sessions = { A: null, B: null, lastEnded: {} };
for (const g of a.groups || []) {
  const at = Date.parse(g.at);
  const s = createSession({ id: nextId('s'), kind: g.kind || 'daily', source: { view: 'home' }, queue: g.chars.map(c => 'base:' + c), at });
  d.sessions[g.slot || 'A'] = s;
  (g.steps || []).forEach((step, i) => {
    judgeInDraft(d, { slot: g.slot || 'A', cardKey: 'base:' + g.chars[i], judgment: step, strokes: VARIANTS[(i + 1) % 3], at: at + i * 1000, nextId });
  });
}
