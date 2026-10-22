// 调度域的随机状态（B4.2）：差分域 domains/sched.mjs 与金标准 core-golden/domains/schedule.mjs 共用。
// 只造「像真的」形状（形状表能过的记录 / 调度项 / 会话），不算规则：调度项与记录不必自洽（选字规则本来就要容忍旧数据）。
// 用法：const S = schedShapes(r)（r = () => [0,1) 的随机数），S.state() / S.records() / S.sched() / S.session() …
import { deckSources } from '../../build_core_config.mjs';
import { CHAR_ORDER } from '../../../src/config/char-order.js';

const DAY = 86400000;
let keyPool = null;

/** 题库前段 + 热身字 + 大写数字 + 首练字：选字会碰到的字。 */
function keysOf() {
  if (keyPool) return keyPool;
  const seed = deckSources().seed;
  const chars = new Set();
  for (const row of seed.slice(0, 260)) chars.add(row.target || Array.from(row.ans)[row.ci || 0]);
  for (const ch of CHAR_ORDER.order.slice(0, 120)) chars.add(ch);
  for (const ch of CHAR_ORDER.warmup.slice(0, 30)) chars.add(ch);
  for (const ch of [...CHAR_ORDER.capital.groups.flat(), ...CHAR_ORDER.capital.after]) chars.add(ch);
  for (const ch of ['尴', '赢', '拾', '甲', '乙', '丙']) chars.add(ch);
  keyPool = [...chars].map((c) => 'base:' + c);
  return keyPool;
}

export function schedShapes(r) {
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const chance = (p) => r() < p;
  const keys = () => keysOf();
  const T0 = Date.UTC(2026, 2, 2, 12);
  const dayOf = (t) => {
    const d = new Date(t + 8 * 3600000); // 记录的 localDay 只要是合法日键即可（不必与 at 同一时区）
    return d.toISOString().slice(0, 10);
  };
  const iso = (t) => new Date(t).toISOString();

  function compact({ lastAt, s = 0.2 + r() * 120, d = 1 + r() * 9, reps = int(1, 9) }) {
    return {
      due: iso(lastAt + Math.max(1, Math.round(s)) * DAY), stability: Math.round(s * 1e8) / 1e8, difficulty: Math.round(d * 1e8) / 1e8,
      elapsed_days: int(0, 30), scheduled_days: Math.max(1, Math.round(s)), learning_steps: 0, reps, lapses: int(0, 3), state: chance(0.9) ? 2 : pick([1, 3]),
      last_review: iso(lastAt),
    };
  }

  /** 一段历史：n 天、每天 0–3 组，每组若干字（判断 / 看答案 / 跳过）。返回 { records, sched, today, lastSerial }。 */
  function history({ days = int(0, 40), today = null, maxPerGroup = 8 } = {}) {
    const records = [];
    const sched = {};
    let serial = 0;
    const startT = T0 + int(0, 200) * DAY;
    const pool = keys();
    let cursor = int(0, 20);
    for (let day = 0; day < days; day += 1) {
      if (chance(0.25)) continue;
      const groups = int(1, 3);
      for (let g = 0; g < groups; g += 1) {
        serial += 1;
        const sid = 's' + serial;
        const n = int(1, maxPerGroup);
        for (let k = 0; k < n; k += 1) {
          const key = chance(0.6) ? pool[(cursor++) % pool.length] : pick(pool);
          const at = startT + day * DAY + g * 1800000 + k * 40000;
          const kind = chance(0.8) ? 'judged' : chance(0.5) ? 'answer-seen' : 'skipped';
          serial += 1;
          const rec = { id: 'r' + serial, cardKey: key, char: key.slice(5), sessionId: sid, kind, at, localDay: dayOf(at), help: { hints: kind === 'skipped' ? 0 : chance(0.15) ? int(1, 3) : 0, answerSeen: kind === 'answer-seen', traced: false } };
          if (kind === 'judged') {
            rec.judgment = chance(0.75) ? 'correct' : 'wrong';
            const prev = sched[key];
            const lastAt = at;
            const s = prev ? prev.fsrs.stability * (rec.judgment === 'correct' ? 2.3 : 0.4) : 0.2 + r() * 8;
            sched[key] = { fsrs: compact({ lastAt, s: Math.min(36500, s), reps: prev ? prev.fsrs.reps + 1 : 1 }), due: dayOf(lastAt + Math.max(1, Math.round(s)) * DAY), lastJudgedAt: at };
            if (chance(0.03)) sched[key].stoppedAt = at;
            if (chance(0.05)) sched[key].seenAgainDay = dayOf(at);
          }
          records.push(rec);
        }
      }
    }
    const lastT = records.length ? records[records.length - 1].at : startT;
    const todayKey = today || dayOf(lastT + pick([0, 0, 1, 1, 2, 3, 7, 8, 12, 31, 40, 95]) * DAY);
    return { records, sched, today: todayKey, serial, startT };
  }

  function months(records) {
    const out = {};
    for (const rec of records) (out[rec.localDay.slice(0, 7)] || (out[rec.localDay.slice(0, 7)] = [])).push(rec);
    if (chance(0.1)) {
      const m = Object.keys(out)[0];
      if (m) out[m] = { v: 1, folded: true, kept: out[m].slice(-3), byDay: {} };
    }
    return out;
  }

  function session({ id = 's' + int(1, 400), slot = pick(['A', 'B']), kind = null, day = null, queueKeys = null } = {}) {
    const k = kind || (slot === 'B' ? 'picked' : pick(['first', 'daily', 'daily']));
    const q = queueKeys || [...new Set(Array.from({ length: int(1, 8) }, () => pick(keys())))];
    const cursor = int(0, q.length);
    const items = q.slice(0, cursor).map((cardKey, i) => {
      const kindI = pick(['judged', 'judged', 'answer-seen', 'skipped']);
      const it = { cardKey, kind: kindI, recordId: 'r' + (1000 + i) };
      if (kindI === 'judged') it.fsrsBefore = compact({ lastAt: T0 });
      return it;
    });
    const t = T0 + int(0, 300) * DAY;
    const s = {
      id, slot, kind: k, source: { view: 'home' }, queue: q, cursor, items,
      current: { phase: pick(['recall', 'recall', 'compare', 'answer', 'trace']), strokes: chance(0.5) ? [] : ['x'], hints: int(0, 3), answerSeen: chance(0.2), hintRange: null, referenceReady: false },
      lastLine: items.length && chance(0.5) ? { recordId: items[items.length - 1].recordId, kind: 'record' } : null,
      startedAt: t, startedDay: day || dayOf(t), updatedAt: t + 60000,
    };
    if (chance(0.1)) s.current.paper = true;
    return s;
  }

  function sessions(today) {
    const A = chance(0.5) ? session({ slot: 'A', day: chance(0.6) ? today : null }) : null;
    const B = chance(0.3) ? session({ slot: 'B', day: chance(0.6) ? today : null }) : null;
    const lastEnded = {};
    if (chance(0.3)) lastEnded.A = { ...session({ slot: 'A' }), endedAt: T0 };
    if (chance(0.2)) lastEnded.B = { ...session({ slot: 'B' }), endedAt: T0, endedEarly: true };
    return { A, B, lastEnded };
  }

  function settings() {
    const s = {};
    if (chance(0.6)) s.groupSize = pick([5, 10, 20, 30, 7, '20']);
    if (chance(0.3)) s.library = pick(['core3500', 'adv3000', 'rare', 'curriculum2500', 'nope']);
    return s;
  }

  /** 完整的 store 状态（规则读到的各域）。 */
  function state(opts = {}) {
    const h = history(opts);
    const st = { records: months(h.records), sched: h.sched, sessions: sessions(h.today), settings: settings() };
    if (chance(0.15)) st.settings.capitalDeferredDay = h.today;
    if (chance(0.1)) st.settings.returnSpreadFor = h.records.length ? h.records[h.records.length - 1].localDay : '2026-01-01';
    if (chance(0.15)) st.custom = { added: Array.from({ length: int(1, 4) }, () => ({ char: pick(keys()).slice(5), at: T0 })) };
    if (chance(0.08)) st.backupMeta = { lastExportAt: null, lastExportSig: null, lastConclusion: { kind: 'clear', date: h.today, count: 3 } };
    if (chance(0.05)) st.legacy = { importedAt: T0, fromKeys: [], days: [h.today], report: {} };
    if (chance(0.5)) st.meta = { serial: h.serial };
    return { state: st, today: h.today, serial: h.serial, records: h.records, sched: h.sched, nowAt: Date.parse(h.today + 'T12:00:00Z') + int(-6, 14) * 3600000 };
  }

  return { int, pick, chance, keys, compact, history, months, session, sessions, settings, state, T0, DAY, dayOf, iso };
}
