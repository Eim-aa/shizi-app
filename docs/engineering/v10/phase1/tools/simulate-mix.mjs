#!/usr/bin/env node
// 复习 / 新字配比模拟（研究用，配合 ../复习新字配比-研究与推荐.md）。不改 simulate-30d.mjs 的任何默认行为。
//
// 用法（仓库根目录）：
//   node docs/engineering/v10/phase1/tools/simulate-mix.mjs                  # 跑全部网格 + 敏感性，写 simulate-mix.out.json
//   node docs/engineering/v10/phase1/tools/simulate-mix.mjs --only=B --groups=1 --profile=mid --runs=50 --no-write
//   node docs/engineering/v10/phase1/tools/simulate-mix.mjs --verify         # 只做 FSRS 一致性自检（本地引擎 vs src/core/fsrs.js）
//
// 读：../易忘度字表-1.0.json、vendor/fsrs6.min.js、src/core/fsrs.js（FSRS_CONFIG 与 --verify 对照）。
// 写：tools/simulate-mix.out.json。
//
// 阶段 1 P1-E4：本文件现在也可以被 import（test/core/mix.test.mjs 用它对照 src/core/mix.js）：导出 RULES、planGroup、groupOrder；
// 命令行直接运行的行为不变（只有被当作入口脚本时才跑下面的主程序）。--verify 里的 App 侧 reviewCard 调用关掉了 D41 的
// 「首见写对记 Easy / 热身字写对记 Easy」，因为本文件的本地引擎一律「写对 = Good」（--easy 开关单独模拟 Easy）。
//
// 调度：与 App 同一份 ts-fsrs（FSRS-6 默认参数、保留率 0.9、最长间隔 365、fuzz 开、无学习步）。为了速度，模拟直接
// 用库的卡对象和「从开始日起的第几天」做 due（due = max(明天, FSRS due 所在日)，与 src/core/fsrs.js reviewCard 同口径），
// --verify 会把同一串判断分别喂给本地引擎和 src/core/fsrs.js reviewCard，核对 due 日一致。时间一律按 UTC 计日。
//
// 用户模型（假设，不是用户数据；与 simulate-30d.mjs 同源）：
//   - 新策划字第一次写对概率 p0 = clamp(0.95 − 0.006 × 易忘度分, 0.30, 0.90) + newShift；热身字 0.97；
//     500 字清单用完后按「易忘度 60」的虚拟字补（只为不断档，单独计数）；
//   - 复习（含提前复习）写对概率 = clamp(FSRS 可提取率 R + revShift, 0.02, 0.99)；
//   - 能力档：low（newShift −0.15，revShift −0.05）/ mid（0, 0）/ high（+0.15, +0.03）；
//   - 第 1 天：首练 3 字（组合 A）后「再写一组」1 组；之后每天按使用模式写若干组，组内 5 个字都写完；
//     看答案、跳过、中途结束不模拟；写对 → Good，写错 → Again（P34 带提示写对也是 Good，这里不区分）。
//
// 规则（详见文档 §4）：
//   R0  现行：到期复习优先、可占满一组（每日复习上限 30），剩余补新字。
//   F32 固定 3 旧 + 2 新：每组复习最多 3 个（易忘度字表 §8.2 的敏感性设定），不足补新字。
//   A   保底一新：每组复习最多 4 个，至少 1 个新字；没有到期时全组新字。
//   B   二新三旧 + 积压刹车 + 提前复习补位：目标 2 新 3 旧；到期积压 ≥ brake（默认 8）时 1 新 4 旧；
//       到期不足时新字最多 3 个，再不足用「最快到期」的字提前复习补位，仍不足才再补新字。
//   C   自适应：在 B 的基础上，目标新字数按「积压可在几天内清掉」与「最近新字写对率」在 1–3 之间调。
//   D   保底一新 + 积压阀（文档推荐）：积压天数 p = 到期未写数 ÷ (4 × 近期每天组数)；p < 0.5 且最近新字写对率 ≥ 0.6 → 3 新，
//       p < 1.5 → 2 新，p < valve（默认 4）→ 1 新，p ≥ valve → 上一组有新字则本组 0 新（全复习）、否则 1 新
//       （不会连续两组全是复习；离开 ≥ 7 天回来的第一组照常有 1 个新字）；复习可到 5 − 新字数；到期不足时同 B 的提前复习补位；热身字 warm=gated。
// 热身字（D28）：每组至多 1 个高频字（新热身字或热身字复习二选一），放组首；新热身字占一个新字位，只在新字位 ≥ 2 时放。
//   warm=legacy（R0/F32/A/B 默认，与 simulate-30d.mjs 相同）；C、D 用 warm=gated：只在前 7 天或最近写对率 < 0.6 时放。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const JSON_PATH = path.resolve(HERE, '..', '易忘度字表-1.0.json'); // 与 App 同一份字表（src/config/char-order.js 由 1.0 生成）
const OUT_PATH = path.join(HERE, 'simulate-mix.out.json');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const args = Object.fromEntries(argv.filter((a) => a.includes('=')).map((a) => a.replace(/^--/, '').split('=')));

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'vendor/fsrs6.min.js'), 'utf8'), { filename: 'fsrs6.min.js' });
const L = globalThis.FSRS;
const appFsrs = await import(path.join(ROOT, 'src/core/fsrs.js'));
const policy = await import(path.join(ROOT, 'src/config/policy.js'));
const { addDays } = await import(path.join(ROOT, 'src/core/dates.js'));

const DATA = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const SIZE = (policy.groupMix && policy.groupMix.baseSize) || 5; // P03：D41 研究按 5 字一组（D65 起用户可选每组字数，缺省 20；配比按 5 字一组换算，见 src/core/mix.js scaledCount）
const DAILY_REVIEW_CAP = policy.dailyReviewCap; // P03
const COMBO = DATA.firstCombos.find((c) => c.id === DATA.defaultCombo);
const WARM = DATA.warmup.order;
const WARM_SET = new Set(WARM);
const ORDER = DATA.order;
const TAIL = 2000; // 清单用完后的虚拟字
const START_UTC = Date.UTC(2026, 9, 5); // 2026-10-05 00:00 UTC
const DAY_MS = 86400000;

const PROFILES = {
  low: { newShift: -0.15, revShift: -0.05 },
  mid: { newShift: 0, revShift: 0 },
  high: { newShift: 0.15, revShift: 0.03 },
};

function scoreOf(ch) {
  if (DATA.entries[ch]) return DATA.entries[ch].score;
  const row = COMBO.rows.find((r) => r.char === ch);
  if (row && row.score != null) return row.score;
  return 60;
}
function baseP0(ch) {
  if (WARM_SET.has(ch)) return 0.97;
  return Math.max(0.3, Math.min(0.9, 0.95 - 0.006 * scoreOf(ch)));
}

// ---------------------------------------------------------------- FSRS（本地，与 App 同参数）
const engines = new Map();
function engine(retention) {
  let e = engines.get(retention);
  if (!e) {
    e = L.fsrs(L.generatorParameters({
      request_retention: retention,
      maximum_interval: appFsrs.FSRS_CONFIG.maximumInterval,
      enable_fuzz: appFsrs.FSRS_CONFIG.enableFuzz,
      enable_short_term: true,
      learning_steps: [],
      relearning_steps: [],
    }));
    engines.set(retention, e);
  }
  return e;
}
const dayOfMs = (ms) => Math.floor((ms - START_UTC) / DAY_MS);
function step(eng, card, at, rating) {
  const c = eng.next(card || L.createEmptyCard(at), at, rating).card;
  const today = dayOfMs(at);
  const fd = dayOfMs(+new Date(c.due));
  return { card: c, dueDay: Math.max(today + 1, fd) };
}

// App 现行评级含 D41 的 Easy 规则；--verify 要对照「写对 = Good」的本地引擎，所以用关掉 Easy 的 policy。
const GOOD_ONLY = { ...policy, ratingFirstCorrect: 'Good', warmup: { ...policy.warmup, easyOnCorrect: false } };

function verify() {
  // 同一串判断：本地 step vs App reviewCard（CompactCard 往返），比较 due 日。时区：两边都用 UTC 中午，避开日界。
  let mismatches = 0, n = 0;
  const eng = engine(appFsrs.FSRS_CONFIG.requestRetention);
  appFsrs.setFSRSLibrary(L);
  const rnd = mulberry32(42);
  for (let k = 0; k < 200; k++) {
    let local = null, app = null, day = 0;
    for (let i = 0; i < 8; i++) {
      const at = START_UTC + day * DAY_MS + 12 * 3600000;
      const ok = rnd() < 0.7;
      const s = step(eng, local, at, ok ? L.Rating.Good : L.Rating.Again);
      const a = appFsrs.reviewCard(app, { judgment: ok ? 'correct' : 'wrong', at }, { policy: GOOD_ONLY });
      local = s.card; app = a.card;
      const appDay = Math.round((Date.parse(a.due + 'T00:00:00Z') - START_UTC) / DAY_MS);
      n++; if (appDay !== s.dueDay && Math.abs(appDay - s.dueDay) > 1) mismatches++; // 本地日 vs UTC 日最多差 1
      day = s.dueDay + Math.floor(rnd() * 3);
    }
  }
  return { checked: n, mismatchesOverOneDay: mismatches };
}

// ---------------------------------------------------------------- 随机
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 使用模式
// 返回第 d 天（1 起）写几组（第 1 天另有首练，首练后固定「再写一组」1 组）。
function groupsOn(pattern, d, rnd) {
  if (typeof pattern === 'number') return pattern;
  if (pattern === 'irregular') { // 平均约 1.5 组/天，三成的天不打开
    const x = rnd();
    return x < 0.3 ? 0 : x < 0.6 ? 1 : x < 0.85 ? 2 : 4;
  }
  const m = /^break(\d)$/.exec(pattern); // breakN：每天 N 组，第 21–34 天两周不打开
  if (m) return d >= 21 && d <= 34 ? 0 : Number(m[1]);
  const w = /^weekend(\d)$/.exec(pattern); // 工作日 1 组，周末（第 6、7 天…）N 组
  if (w) return (d % 7 === 6 || d % 7 === 0) ? Number(w[1]) : 1;
  throw new Error('unknown pattern ' + pattern);
}

// ---------------------------------------------------------------- 规则
export const RULES = {
  R0: { label: '现行：复习可占满', revMax: 5, newTarget: () => 0, newMax: 5, early: false, warm: 'legacy' },
  F32: { label: '固定 3 旧 2 新', revMax: 3, newTarget: () => 2, newMax: 5, early: false, warm: 'legacy' },
  A: { label: '保底一新', revMax: 4, newTarget: () => 1, newMax: 5, early: false, warm: 'legacy' },
  B: {
    label: '二新三旧+积压刹车+提前复习补位', revMax: 4, newMax: 3, early: true, warm: 'legacy',
    newTarget: (s, o) => (s.backlog >= (o.brake ?? 8) ? 1 : 2),
  },
  C: {
    label: '自适应（积压天数 × 新字写对率）', revMax: 4, newMax: 3, early: true, warm: 'gated',
    newTarget: (s) => {
      let t = 2;
      const clearDays = s.backlog / Math.max(1, 3 * s.groupsPerDayEma); // 按每组 3 个复习，几天能清掉
      if (clearDays > 2 || s.newAcc < 0.35) t = 1;
      else if (clearDays < 0.5 && s.newAcc >= 0.6) t = 3;
      return t;
    },
  },
  D: {
    label: '保底一新+积压阀（推荐候选）', revMax: 5, newMax: 3, early: true, warm: 'gated', returnNew: true,
    newTarget: (s, o) => {
      // 积压折算成「按每组 4 个复习、照最近的打开频率要几天清掉」
      const p = s.backlog / Math.max(1, 4 * s.groupsPerDayEma);
      if (p >= (o.valve ?? 4)) return s.lastHadNew ? 0 : 1; // 积压阀：最多隔一组没有新字，不会连续两组全是复习
      if (p >= 1.5) return 1;
      if (p < 0.5 && s.newAcc >= 0.6) return 3;
      return 2;
    },
  },
};

// ---------------------------------------------------------------- 一组怎么配（纯函数；runOnce 的 selectGroup 与 App 的对照测试共用）
/**
 * 一组里各类字的人选与数量（不含组内排序）。
 * @param {object} a
 * @param {string} a.ruleName   RULES 的键
 * @param {{backlog:number,newAcc:number,allAcc:number,groupsPerDayEma:number,day:number,lastHadNew:boolean}} a.state
 * @param {{brake?:number,valve?:number}} [a.opts]
 * @param {number} a.budget     今日还能做几个到期复习
 * @param {Array<{ch:string}>} a.due   到期字，已排好序
 * @param {string[]} a.early    提前复习候选（R.early 才用），已排好序
 * @param {string|null} a.warmPeek 下一个新热身字（没有 = null）
 * @param {number} a.day        第几天（1 起，热身字门控用）
 * @returns {{newTarget:number, revKeys:string[], earlyKeys:string[], newSlots:number, newCount:number, warmNew:string|null, warmRev:number}}
 *   newSlots = 新字位总数（含热身新字）；newCount = 其中不是热身新字的个数。
 */
export function planGroup({ ruleName, state, opts = {}, budget, due, early, warmPeek, day }) {
  const R = RULES[ruleName];
  const newT = Math.min(SIZE, R.newTarget(state, opts));
  const revSlots = Math.min(R.revMax, SIZE - newT, budget);
  // 热身字复习每组最多 1 个
  const revKeys = [];
  let warmRev = 0;
  for (const d of due) {
    if (revKeys.length >= revSlots) break;
    if (WARM_SET.has(d.ch)) { if (warmRev >= 1) continue; warmRev++; }
    revKeys.push(d.ch);
  }
  let newSlots = Math.min(R.newMax, SIZE - revKeys.length);
  let earlyKeys = [];
  if (R.early && revKeys.length + newSlots < SIZE) earlyKeys = early.slice(0, SIZE - revKeys.length - newSlots);
  newSlots = SIZE - revKeys.length - earlyKeys.length; // 仍不足就再补新字
  const warmAllowed = R.warm === 'legacy' || (R.warm === 'gated' && (day <= 7 || state.allAcc < 0.6));
  let warmNew = null;
  if (newSlots >= 2 && warmRev === 0 && warmAllowed && warmPeek) warmNew = warmPeek;
  return { newTarget: newT, revKeys, earlyKeys, newSlots, newCount: newSlots - (warmNew ? 1 : 0), warmNew, warmRev };
}

// ---------------------------------------------------------------- 一次运行
function runOnce({ rule, pattern, profile, days, seed, retention = 0.9, firstCorrectEasy = false, brake, valve, keepGroups = false }) {
  const R = RULES[rule];
  const prof = PROFILES[profile];
  const eng = engine(retention);
  const rnd = mulberry32(seed);
  const patRnd = mulberry32(seed * 7919 + 13);
  const sched = new Map(); // ch -> {card, dueDay, doneDay, p0}
  const cursor = { o: 0, w: 0, tail: 0 };
  const recentNew = []; // 最近 10 个新策划字的对错
  const recentAll = []; // 最近 10 个判断
  let groupsPerDayEma = 1;
  let lastHadNew = true;
  let warmReviews = 0;
  let minute = 0;
  const groupsLog = []; // {day, idx, nNew, nCur, nWarm, nRev, nEarly, nOk, firstBack}
  const backlogByDay = [];
  const reviewsByDay = [];
  const checkpoints = {};
  const lateness = { n: 0, sumOverdue: 0, sumR: 0 };

  const p0Of = (ch) => Math.max(0.02, Math.min(0.99, baseP0(ch) + (WARM_SET.has(ch) ? 0 : prof.newShift)));
  function judge(ch, day, kind) {
    const at = START_UTC + day * DAY_MS + 20 * 3600000 + (minute++ % 180) * 60000;
    const e = sched.get(ch);
    let p;
    if (e) {
      const r = eng.get_retrievability(e.card, at, false);
      p = Math.max(0.02, Math.min(0.99, r + prof.revShift));
      if (WARM_SET.has(ch)) warmReviews++;
      if (kind === 'rev') { lateness.n++; lateness.sumOverdue += day - e.dueDay; lateness.sumR += r; }
    } else p = p0Of(ch);
    const ok = rnd() < p;
    let rating = ok ? L.Rating.Good : L.Rating.Again;
    if (!e && ok && firstCorrectEasy && !WARM_SET.has(ch)) rating = L.Rating.Easy;
    const s = step(eng, e ? e.card : null, at, rating);
    sched.set(ch, { card: s.card, dueDay: s.dueDay, doneDay: day, p0: e ? e.p0 : p0Of(ch), cur: e ? e.cur : !WARM_SET.has(ch) });
    recentAll.push(ok); if (recentAll.length > 10) recentAll.shift();
    if (!e && !WARM_SET.has(ch)) { recentNew.push(ok); if (recentNew.length > 10) recentNew.shift(); }
    return ok;
  }
  const nextCurated = () => {
    while (cursor.o < ORDER.length && sched.has(ORDER[cursor.o])) cursor.o++;
    if (cursor.o < ORDER.length) return ORDER[cursor.o++];
    return '虚' + cursor.tail++;
  };
  const peekWarm = () => {
    while (cursor.w < WARM.length && sched.has(WARM[cursor.w])) cursor.w++;
    return cursor.w < WARM.length ? WARM[cursor.w] : null;
  };
  const accOf = (xs, prior) => (xs.length ? (xs.reduce((a, b) => a + (b ? 1 : 0), 0) + prior * 2) / (xs.length + 2) : prior);

  function selectGroup(day, reviewsDoneToday) {
    const due = [];
    for (const [ch, e] of sched) {
      if (e.doneDay === day || e.dueDay > day) continue;
      due.push({ ch, od: day - e.dueDay, st: e.card.stability });
    }
    due.sort((a, b) => b.od - a.od || a.st - b.st || (a.ch < b.ch ? -1 : 1));
    const budget = Math.max(0, DAILY_REVIEW_CAP - reviewsDoneToday);
    const state = { backlog: due.length, newAcc: accOf(recentNew, 0.5), allAcc: accOf(recentAll, 0.7), groupsPerDayEma, day, lastHadNew };
    const early = [];
    if (R.early) {
      // 提前复习补位候选：未到期、今天没写过、最快到期（同日按稳定度升序）；热身字不提前
      const cand = [];
      for (const [ch, e] of sched) {
        if (e.doneDay === day || e.dueDay <= day || WARM_SET.has(ch)) continue;
        cand.push({ ch, dd: e.dueDay, st: e.card.stability });
      }
      cand.sort((a, b) => a.dd - b.dd || a.st - b.st);
      for (const c of cand) early.push(c.ch);
    }
    const warmPeeked = peekWarm();
    const g = planGroup({ ruleName: rule, state, opts: { brake, valve }, budget, due, early, warmPeek: warmPeeked, day });
    if (g.warmNew) cursor.w++;
    const items = [];
    if (g.warmNew) items.push({ ch: g.warmNew, kind: 'warm' });
    // 组内顺序：热身（新或复习）在组首；其余「复习、新、复习、新…」交错，提前复习放在最后
    const revs = [...g.revKeys].sort((a, b) => (WARM_SET.has(b) ? 1 : 0) - (WARM_SET.has(a) ? 1 : 0)).map((ch) => ({ ch, kind: 'rev' }));
    const news = [];
    for (let i = 0; i < g.newCount; i++) news.push({ ch: nextCurated(), kind: 'new' });
    if (revs.length && WARM_SET.has(revs[0].ch)) items.push(revs.shift());
    while (revs.length || news.length) { if (revs.length) items.push(revs.shift()); if (news.length) items.push(news.shift()); }
    for (const ch of g.earlyKeys) items.push({ ch, kind: 'early' });
    return items;
  }

  function checkpoint(day) {
    const at = START_UTC + day * DAY_MS + 23 * 3600000;
    let n = 0, sumR = 0, gain = 0, strong = 0;
    for (const [, e] of sched) {
      if (!e.cur) continue;
      const r = eng.get_retrievability(e.card, at, false);
      n++; sumR += r; gain += r - e.p0; if (r >= 0.9) strong++;
    }
    return { introduced: n, meanR: n ? sumR / n : null, sumR, netGain: gain, rAtLeast90: strong };
  }

  let lastActiveDay = 0;
  for (let day = 0; day < days; day++) {
    const d = day + 1;
    let reviewsToday = 0;
    let groupsToday = 0;
    if (d === 1) {
      for (const ch of COMBO.chars) judge(ch, day, 'first');
    }
    const n = d === 1 ? 1 : groupsOn(pattern, d, patRnd);
    const firstBack = n > 0 && lastActiveDay > 0 && d - lastActiveDay >= 7;
    if (firstBack && R.returnNew) lastHadNew = false; // D：离开 ≥ 7 天回来的第一组不走「全复习」
    for (let g = 0; g < n; g++) {
      const items = selectGroup(day, reviewsToday);
      let ok = 0, nNew = 0, nCur = 0, nWarm = 0, nRev = 0, nEarly = 0;
      for (const it of items) {
        const isNew = !sched.has(it.ch);
        if (it.kind === 'rev') { nRev++; reviewsToday++; }
        else if (it.kind === 'early') { nEarly++; reviewsToday++; }
        else if (isNew) { nNew++; if (WARM_SET.has(it.ch)) nWarm++; else nCur++; }
        if (judge(it.ch, day, it.kind)) ok++;
      }
      groupsToday++;
      const rec = { d, g, nNew, nCur, nWarm, nRev, nEarly, nOk: ok, size: items.length, firstBack: firstBack && g === 0 };
      if (keepGroups) rec.items = items.map((it) => it.ch + (it.kind === 'new' ? '' : it.kind === 'warm' ? '〔热〕' : it.kind === 'rev' ? '〔复〕' : '〔提〕'));
      groupsLog.push(rec);
      lastHadNew = nNew > 0;
    }
    if (n > 0) lastActiveDay = d;
    groupsPerDayEma = 0.8 * groupsPerDayEma + 0.2 * n;
    let backlog = 0;
    for (const [, e] of sched) if (e.dueDay <= day && e.doneDay !== day) backlog++;
    backlogByDay.push(backlog);
    reviewsByDay.push(n > 0 ? reviewsToday : null); // 没打开的天记 null
    if (d === 30 || d === 60 || d === 90 || d === 180 || d === days) checkpoints[d] = checkpoint(day);
  }
  return { groupsLog, backlogByDay, reviewsByDay, checkpoints, curated: [...sched.values()].filter((e) => e.cur).length, warm: cursor.w, tail: cursor.tail, lateness, warmReviews };
}

// ---------------------------------------------------------------- 汇总
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
function summarize(runs, days) {
  const periods = { 'd2-7': [2, 7], 'd8-30': [8, 30], 'd31-90': [31, 90], 'd91-180': [91, 180] };
  const out = { runs: runs.length };
  const allGroups = runs.flatMap((r) => r.groupsLog.filter((g) => g.d >= 2));
  out.groupsPerRun = r1(allGroups.length / runs.length);
  out.byPeriod = {};
  for (const [name, [a, b]] of Object.entries(periods)) {
    if (a > days) continue;
    const gs = allGroups.filter((g) => g.d >= a && g.d <= Math.min(b, days));
    if (!gs.length) continue;
    const hist = [0, 0, 0, 0, 0, 0];
    for (const g of gs) hist[Math.min(5, g.nNew)]++;
    out.byPeriod[name] = {
      groups: gs.length,
      newCountHist: hist.map((h) => r3(h / gs.length)), // 每组新字数 0..5 的占比（新 = 第一次出现，含热身字）
      meanNewShare: r3(gs.reduce((s, g) => s + g.nNew / g.size, 0) / gs.length),
      meanCuratedNew: r3(gs.reduce((s, g) => s + g.nCur, 0) / gs.length),
      allReviewShare: r3(gs.filter((g) => g.nNew === 0).length / gs.length),
      noRecallShare: r3(gs.filter((g) => g.nRev + g.nEarly === 0).length / gs.length),
      meanCorrect: r3(gs.reduce((s, g) => s + g.nOk / g.size, 0) / gs.length),
      lowGroupShare: r3(gs.filter((g) => g.nOk <= 2).length / gs.length), // 一组 5 字里写对 ≤ 2 个
      earlyPerGroup: r3(gs.reduce((s, g) => s + g.nEarly, 0) / gs.length),
    };
  }
  const cps = {};
  for (const d of [30, 60, 90, 180, days]) {
    const xs = runs.map((r) => r.checkpoints[d]).filter(Boolean);
    if (!xs.length) continue;
    cps[d] = {
      curatedIntroducedMedian: q(xs.map((x) => x.introduced), 0.5),
      curatedIntroducedP10: q(xs.map((x) => x.introduced), 0.1),
      curatedIntroducedP90: q(xs.map((x) => x.introduced), 0.9),
      meanR: r3(xs.reduce((s, x) => s + x.meanR, 0) / xs.length),
      sumRMedian: r1(q(xs.map((x) => x.sumR), 0.5)),
      netGainMedian: r1(q(xs.map((x) => x.netGain), 0.5)),
      rAtLeast90Median: q(xs.map((x) => x.rAtLeast90), 0.5),
    };
  }
  out.checkpoints = cps;
  out.backlog = {};
  for (const d of [3, 7, 14, 30, 45, 60, 90, 120, 180]) {
    if (d > days) continue;
    const xs = runs.map((r) => r.backlogByDay[d - 1]);
    out.backlog[d] = { median: q(xs, 0.5), p90: q(xs, 0.9), max: Math.max(...xs) };
  }
  out.backlogCurveMedian = Array.from({ length: days }, (_, i) => q(runs.map((r) => r.backlogByDay[i]), 0.5));
  { let sum = 0, cnt = 0; for (const r of runs) for (const x of r.reviewsByDay) if (x !== null) { sum += x; cnt++; } out.reviewsPerActiveDay = r1(sum / Math.max(1, cnt)); }
  const late = runs.reduce((a, r) => ({ n: a.n + r.lateness.n, o: a.o + r.lateness.sumOverdue, R: a.R + r.lateness.sumR }), { n: 0, o: 0, R: 0 });
  out.reviewLateness = { meanOverdueDays: r1(late.o / Math.max(1, late.n)), meanRAtReview: r3(late.R / Math.max(1, late.n)) };
  out.firstWeek = [];
  for (let d = 1; d <= Math.min(7, days); d++) {
    const gs = runs.flatMap((r) => r.groupsLog.filter((g) => g.d === d));
    const per = (k) => r1(gs.reduce((s, g) => s + g[k], 0) / Math.max(1, gs.length));
    const g1 = runs.map((r) => r.groupsLog.find((g) => g.d === d && g.g === 0)).filter(Boolean);
    const per1 = (k) => r1(g1.reduce((s, g) => s + g[k], 0) / Math.max(1, g1.length));
    out.firstWeek.push({ day: d, firstGroup: { warm: per1('nWarm'), curNew: per1('nCur'), rev: per1('nRev'), early: per1('nEarly'), correct: per1('nOk') }, allGroups: { warm: per('nWarm'), curNew: per('nCur'), rev: per('nRev'), early: per('nEarly'), correct: per('nOk') } });
  }
  const backs = runs.flatMap((r) => r.groupsLog.filter((g) => g.firstBack));
  if (backs.length) out.returnAfterBreak = { firstGroup: { curNew: r1(backs.reduce((s, g) => s + g.nCur, 0) / backs.length), rev: r1(backs.reduce((s, g) => s + g.nRev, 0) / backs.length), correct: r1(backs.reduce((s, g) => s + g.nOk, 0) / backs.length) } };
  out.tailUsedMedian = q(runs.map((r) => r.tail), 0.5);
  out.warmIntroducedMedian = q(runs.map((r) => r.warm), 0.5);
  out.warmReviewsMedian = q(runs.map((r) => r.warmReviews), 0.5); // 花在热身字复习（含提前复习）上的位数
  return out;
}

function runConfig(cfg, nRuns, seed0) {
  const runs = [];
  for (let i = 0; i < nRuns; i++) runs.push(runOnce({ ...cfg, seed: seed0 + i }));
  return { runs, summary: summarize(runs, cfg.days) };
}

const IS_MAIN = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (IS_MAIN) {
  // ---------------------------------------------------------------- 主程序
  if (flag('verify')) { console.log(JSON.stringify(verify())); process.exit(0); }
  const RUNS = Number(args.runs || 200);
  const SEED = Number(args.seed || 1);
  const DAYS = Number(args.days || 90);
  const t0 = Date.now();
  const results = [];
  const add = (name, cfg, n = RUNS) => {
    const full = { days: DAYS, ...cfg };
    const { runs, summary } = runConfig(full, n, SEED);
    const rep = runOnce({ ...full, seed: SEED, keepGroups: true });
    const sample = rep.groupsLog.filter((g) => [1, 2, 3, 4, 5, 6, 7, 14, 30, 60, 90].includes(g.d)).map((g) => ({ d: g.d, g: g.g, items: g.items.join(' ') }));
    results.push({ name, cfg: full, summary, sample });
    process.stderr.write(`${name} done ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  };

  if (args.only) {
    add(`${args.only}/${args.groups || 1}/${args.profile || 'mid'}`, {
      rule: args.only, pattern: /^\d+$/.test(args.groups || '1') ? Number(args.groups || 1) : args.groups, profile: args.profile || 'mid',
      retention: Number(args.retention || 0.9), firstCorrectEasy: flag('easy'), brake: args.brake ? Number(args.brake) : undefined, valve: args.valve ? Number(args.valve) : undefined,
    });
  } else {
    for (const rule of Object.keys(RULES)) for (const g of [1, 2, 4]) for (const profile of ['low', 'mid', 'high']) {
      add(`grid/${rule}/${g}/${profile}`, { rule, pattern: g, profile });
    }
    // 敏感性
    for (const rule of ['R0', 'B', 'C', 'D']) for (const pattern of ['irregular', 'break1', 'break2', 'weekend4']) add(`usage/${rule}/${pattern}/mid`, { rule, pattern, profile: 'mid' });
    for (const brake of [5, 12]) for (const g of [1, 4]) add(`brake/B${brake}/${g}/mid`, { rule: 'B', pattern: g, profile: 'mid', brake });
    for (const rule of ['R0', 'B']) for (const g of [1, 2]) {
      add(`easy/${rule}/${g}/mid`, { rule, pattern: g, profile: 'mid', firstCorrectEasy: true });
      add(`ret85/${rule}/${g}/mid`, { rule, pattern: g, profile: 'mid', retention: 0.85 });
    }
    // 180 天：积压是否有界、阀门阈值、两个与配比正交的杠杆（首见写对记 Easy、保留率 0.85）
    for (const g of [1, 2]) {
      for (const valve of [6, 8]) add(`long180/D-valve${valve}/${g}/mid`, { rule: 'D', pattern: g, profile: 'mid', days: 180, valve }, 100);
      add(`long180/D+easy/${g}/mid`, { rule: 'D', pattern: g, profile: 'mid', days: 180, firstCorrectEasy: true }, 100);
      add(`long180/D+ret85/${g}/mid`, { rule: 'D', pattern: g, profile: 'mid', days: 180, retention: 0.85 }, 100);
      add(`long180/D+easy+ret85/${g}/mid`, { rule: 'D', pattern: g, profile: 'mid', days: 180, firstCorrectEasy: true, retention: 0.85 }, 100);
    }
    for (const rule of ['R0', 'B', 'D']) for (const g of [1, 2]) add(`long180/${rule}/${g}/mid`, { rule, pattern: g, profile: 'mid', days: 180 }, 100);
  }

  const out = {
    generatedBy: 'docs/engineering/v10/phase1/tools/simulate-mix.mjs',
    params: { runs: RUNS, seed: SEED, days: DAYS, groupSize: SIZE, dailyReviewCap: DAILY_REVIEW_CAP, combo: COMBO.id, start: addDays('2026-10-05', 0), profiles: PROFILES, fsrs: appFsrs.FSRS_CONFIG },
    verify: verify(),
    rules: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v.label])),
    results,
  };
  if (!flag('no-write')) fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1) + '\n');
  if (flag('print')) console.log(JSON.stringify(out.results.map((r) => ({ name: r.name, summary: r.summary })), null, 1));
  process.stderr.write(`total ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

}
