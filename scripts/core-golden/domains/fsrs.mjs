// 金标准 · FSRS（src/core/fsrs.js + vendor/fsrs6.min.js；计划 §4.3 ①「每档评分 × 间隔 × fuzz 种子」）。
// 期望值就是参考引擎的回包。网格：新卡 / 学习中 / 复习中 / 重学中 × 稳定度 × 难度 × 间隔天数 × 四档评分（写错 Again、带提示 Hard、写对 Good、
// 热身字写对 Easy）× 多个判断时刻（fuzz 种子 = 时刻_次数_难度×稳定度，时刻不同种子就不同），另有 D65 #3 时钟回拨、D66 ① 看答案、
// 重放序列、评级表、可提取率。三个时区（日界 4 点、夏令时）。
import { rng } from '../../core-diff/lib/gen.mjs';

const DAY = 86400000;
const BASE = Date.UTC(2026, 2, 1, 12, 0, 0); // 2026-03-01T12:00Z

const iso = (t) => new Date(t).toISOString();

function card({ s, d, state = 2, reps = 3, lapses = 0, lastAt, scheduled = 5 }) {
  return {
    due: iso(lastAt + scheduled * DAY), stability: s, difficulty: d, elapsed_days: 2, scheduled_days: scheduled, learning_steps: 0,
    reps, lapses, state, last_review: iso(lastAt),
  };
}

function cases() {
  const R = [];
  const r = rng(424242);
  // 评级表
  for (const judgment of ['correct', 'wrong', 'skipped', '']) {
    for (const hints of [0, 1, 2, 3, 4, 7, 1.5, -1]) {
      for (const first of [false, true]) {
        for (const warmup of [false, true]) R.push({ op: 'fsrs.ratingFor', args: { judgment, help: { hints }, first, warmup } });
      }
    }
  }
  R.push({ op: 'fsrs.ratingFor', args: { judgment: 'correct', help: { hints: 1 }, policy: { ratingWithHint: 'Easy' } } });
  R.push({ op: 'fsrs.ratingFor', args: { judgment: 'correct', first: true, policy: { ratingFirstCorrect: 'Hard' } } });
  R.push({ op: 'fsrs.ratingFor', args: { judgment: 'correct', help: { hints: 2 }, policy: { ratingWithHint: { first: ['Good'], review: ['Hard'] } } } });

  // 新卡：四档 × 时刻（种子随时刻变）
  const reviews = [
    { judgment: 'wrong' }, { judgment: 'correct', help: { hints: 1 } }, { judgment: 'correct', help: { hints: 2 } }, { judgment: 'correct', help: { hints: 3 } },
    { judgment: 'correct' },
  ];
  for (let i = 0; i < 40; i += 1) {
    const at = BASE + Math.floor(r() * 400) * DAY + Math.floor(r() * DAY);
    for (const rv of reviews) {
      R.push({ op: 'fsrs.reviewCard', args: { review: { ...rv, at, cardKey: 'base:x' } } });
      if (rv.judgment === 'correct' && !rv.help) R.push({ op: 'fsrs.reviewCard', args: { review: { ...rv, at, cardKey: 'base:x' }, warmup: true } });
    }
  }
  // 复习中 / 学习中 / 重学中的卡：稳定度 × 难度 × 间隔 × 四档
  const stabs = [0.1, 0.212, 1, 2.3065, 5.5, 8.2956, 15, 33.3, 72, 150, 300, 800, 3000, 36500];
  const diffs = [1, 2.4, 4.01, 5.5, 7.02698957, 9.3, 10];
  const gaps = [0, 1, 2, 3, 7, 12, 30, 60, 120, 365, 900];
  for (const s of stabs) {
    for (const d of diffs) {
      for (const gap of gaps) {
        if (r() < 0.55) continue; // 抽一半，夹具不至于太大
        const lastAt = BASE + Math.floor(r() * 200) * DAY + Math.floor(r() * DAY);
        const at = lastAt + gap * DAY + Math.floor(r() * 7200000);
        const state = r() < 0.8 ? 2 : r() < 0.5 ? 1 : 3;
        const before = card({ s, d, state, reps: 1 + Math.floor(r() * 9), lapses: Math.floor(r() * 3), lastAt, scheduled: Math.max(1, Math.round(s)) });
        for (const rv of [{ judgment: 'wrong' }, { judgment: 'correct', help: { hints: 1 } }, { judgment: 'correct' }]) {
          R.push({ op: 'fsrs.reviewCard', args: { before, review: { ...rv, at, cardKey: 'base:x' } } });
        }
        R.push({ op: 'fsrs.reviewCard', args: { before, review: { judgment: 'correct', at, cardKey: 'base:x' }, warmup: true } });
        R.push({ op: 'fsrs.retrievability', args: { entry: { fsrs: before }, now: at } });
      }
    }
  }
  // D65 #3：判断时刻早于上次复习（时钟回拨）
  for (let i = 0; i < 30; i += 1) {
    const lastAt = BASE + Math.floor(r() * 300) * DAY;
    const before = card({ s: 1 + r() * 60, d: 1 + r() * 9, lastAt });
    const at = lastAt - Math.floor(r() * 40 * DAY) - 1;
    R.push({ op: 'fsrs.reviewCard', args: { before, review: { judgment: r() < 0.5 ? 'correct' : 'wrong', at, cardKey: 'base:x' } } });
  }
  // D66 ①：看答案的 Again、当天判断不再评级、新字看过答案不给 Easy
  for (let i = 0; i < 40; i += 1) {
    const lastAt = BASE + Math.floor(r() * 300) * DAY;
    const before = card({ s: 1 + r() * 60, d: 1 + r() * 9, lastAt, reps: Math.floor(r() * 4) });
    const at = lastAt + Math.floor(r() * 30) * DAY + 3600000;
    const day = new Date(at).toISOString().slice(0, 10);
    const entry = { fsrs: before, due: day, lastJudgedAt: lastAt };
    const seen = { id: 'r9', cardKey: 'base:x', char: 'x', sessionId: 's1', kind: 'answer-seen', at, localDay: day, help: { hints: 0, answerSeen: true, traced: true } };
    R.push({ op: 'fsrs.answerSeenAgainApplies', args: { entry, record: seen } });
    R.push({ op: 'fsrs.applyAnswerSeen', args: { entry, record: seen } });
    const judged = { ...seen, id: 'r10', kind: 'judged', judgment: r() < 0.6 ? 'correct' : 'wrong', at: at + 60000, help: { hints: 0, answerSeen: false, traced: false } };
    R.push({ op: 'fsrs.applyJudgment', args: { entry: { ...entry, seenAgainDay: day }, record: judged } });
    R.push({ op: 'fsrs.applyJudgment', args: { record: judged, records: [seen] } });
    R.push({ op: 'fsrs.applyJudgment', args: { entry, record: judged } });
  }
  // 重放：随机序列（判断 / 看答案 / 跳过，跨天），从空卡与从 fsrsBefore
  for (let i = 0; i < 60; i += 1) {
    const records = [];
    let t = BASE + Math.floor(r() * 100) * DAY + 3600000 * 8;
    const n = 1 + Math.floor(r() * 9);
    for (let k = 0; k < n; k += 1) {
      t += Math.floor(r() * 12) * DAY + Math.floor(r() * 3600000);
      const kind = r() < 0.75 ? 'judged' : r() < 0.6 ? 'answer-seen' : 'skipped';
      const rec = { id: 'r' + (k + 1), cardKey: 'base:x', char: 'x', sessionId: 's1', kind, at: t, localDay: new Date(t + 8 * 3600000).toISOString().slice(0, 10), help: { hints: kind === 'judged' && r() < 0.3 ? 1 + Math.floor(r() * 3) : 0, answerSeen: kind === 'answer-seen', traced: false } };
      if (kind === 'judged') rec.judgment = r() < 0.7 ? 'correct' : 'wrong';
      records.push(rec);
    }
    R.push({ op: 'fsrs.replay', args: { records } });
    R.push({ op: 'fsrs.replay', args: { fsrsBefore: card({ s: 3 + r() * 20, d: 2 + r() * 6, lastAt: BASE - 10 * DAY }), records, stoppedAt: r() < 0.2 ? 123 : undefined } });
  }
  // 卡形状
  R.push({ op: 'fsrs.emptyCard', args: { at: BASE } });
  R.push({ op: 'fsrs.emptyCard', args: { at: 'x' } });
  R.push({ op: 'fsrs.isCompactCard', args: { value: card({ s: 1, d: 1, lastAt: BASE }) } });
  R.push({ op: 'fsrs.isCompactCard', args: { value: { ...card({ s: 1, d: 1, lastAt: BASE }), last_review: null } } });
  R.push({ op: 'fsrs.isCompactCard', args: { value: { ...card({ s: 1, d: 1, lastAt: BASE }), due: 'x' } } });
  return R.map((c) => (c.args && c.args.stoppedAt === undefined ? { op: c.op, args: Object.fromEntries(Object.entries(c.args).filter(([, v]) => v !== undefined)) } : c));
}

export default {
  id: 'fsrs',
  source: 'src/core/fsrs.js、vendor/fsrs6.min.js（ts-fsrs 5.2.0）',
  build({ withTZ, opCases }) {
    const R = cases();
    const groups = ['Asia/Shanghai', 'America/New_York', 'Pacific/Chatham'].map((tz) => withTZ(tz, () => ({ tz, cases: opCases(R) })));
    return { groups };
  },
};
