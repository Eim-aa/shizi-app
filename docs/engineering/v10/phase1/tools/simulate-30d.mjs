#!/usr/bin/env node
// 30 天日常队列模拟（P1-C1 自检，D28）。
//
// 用法（仓库根目录）：
//   node docs/engineering/v10/phase1/tools/simulate-30d.mjs            # 默认：首练组合 A、每天 1 组、200 次随机
//   node docs/engineering/v10/phase1/tools/simulate-30d.mjs --combo=B --groups=2 --runs=500 --seed=7
// 读：易忘度字表-初稿.json（先跑 build-yiwang.mjs）、vendor/fsrs6.min.js、src/core/fsrs.js（真实调度参数）。
// 写：tools/simulate-30d.out.json（供 render-doc.mjs 填进文档）。
//
// 选字规则（这是给 P1-E4 的提议，不是现行代码）：
//   1. 到期复习优先（与 src/core/sessions.js selectDaily 同序：逾期天数降序、稳定度升序），最多占满一组；
//      但热身字的复习每组最多 1 个，多出的顺延（高频字晚一天复习无碍）；
//   2. 剩余空位填新字：空位 ≥ 2 且本组没有「热身字的复习」时，放 1 个热身字在组首，其余按易忘度排序取；
//      空位只有 1 个时只放策划字。→ 每组至多 1 个高频字（新热身字或热身字复习二选一）。
//   3. 已有调度的字（含首练 3 字）不再作新字出。
// 用户模型（假设，不是用户数据）：
//   - 新策划字写对概率 p = clamp(0.95 − 0.006 × 易忘度分, 0.30, 0.90)（分 55 → 0.62，分 85 → 0.44）；
//   - 热身字 0.97；
//   - 复习字 = FSRS 可提取率 R（ts-fsrs，与 App 同参数）；
//   - 每天打开 1 次、写 groups 组；第 1 天写首练 3 字后「再写一组」1 组。看答案/跳过不模拟。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const JSON_PATH = path.resolve(HERE, '..', '易忘度字表-初稿.json');
const NO_WRITE = process.argv.includes('--no-write');
const OUT_PATH = path.join(HERE, 'simulate-30d.out.json');

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'vendor/fsrs6.min.js'), 'utf8'), { filename: 'fsrs6.min.js' });
const { reviewCard, retrievability, overdueDays } = await import(path.join(ROOT, 'src/core/fsrs.js'));
const { addDays } = await import(path.join(ROOT, 'src/core/dates.js'));
// 阶段 1 P1-E4：App 现行评级含 D41「首见写对 / 热身字写对记 Easy」；本脚本沿旧口径「写对 = Good」，所以关掉这两条，输出不变。
const appPolicy = await import(path.join(ROOT, 'src/config/policy.js'));
const GOOD_ONLY = { ...appPolicy, ratingFirstCorrect: 'Good', warmup: { ...appPolicy.warmup, easyOnCorrect: false } };

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.replace(/^--/, '').split('=')));
const DATA = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const COMBO_ID = args.combo || DATA.defaultCombo;
const GROUPS = Number(args.groups || 1);
const RUNS = Number(args.runs || 200);
const SEED = Number(args.seed || 1);
const DAYS = 30;
const SIZE = 5; // policy.groupSize（P03）
// 每组复习上限（敏感性参数）：默认 5 = 现行口径（复习可占满一组）；设 3 表示每组至少留 2 个新字位。
const REVIEW_CAP = Number(args['review-cap'] || SIZE);
const START = '2026-10-05';
const SHOW_DAYS = [1, 2, 3, 7, 30];

const combo = DATA.firstCombos.find((c) => c.id === COMBO_ID);
if (!combo) throw new Error('unknown combo ' + COMBO_ID);
const WARM = DATA.warmup.order;
const WARM_SET = new Set(WARM);
const ORDER = DATA.order;
const info = (ch) => DATA.entries[ch] || DATA.warmup.entries[ch] || combo.rows.find((r) => r.char === ch) || {};
const rankOf = (ch) => info(ch).freqRank ?? info(ch).rank ?? null;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function atMs(day, hour, minute) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).getTime();
}

const PSHIFT = Number(args.pshift || 0); // 敏感性：新策划字写对概率整体平移
function pNew(ch) {
  if (WARM_SET.has(ch)) return 0.97;
  const s = info(ch).score;
  return Math.max(0.3, Math.min(0.9, 0.95 - 0.006 * (s ?? 70))) + PSHIFT;
}

function selectGroup(sched, today, cursor) {
  const due = [];
  for (const [ch, e] of Object.entries(sched)) {
    const od = overdueDays(e, today);
    if (od === null || od < 0 || e.doneToday === today) continue;
    due.push({ ch, od, st: e.fsrs ? Number(e.fsrs.stability) || 0 : 0 });
  }
  due.sort((a, b) => b.od - a.od || a.st - b.st || (a.ch < b.ch ? -1 : 1));
  const dueKeys = [];
  let warmReview = 0;
  for (const d of due) {
    if (dueKeys.length >= REVIEW_CAP) break;
    if (WARM_SET.has(d.ch)) { if (warmReview >= 1) continue; warmReview++; }
    dueKeys.push(d.ch);
  }
  let slots = SIZE - dueKeys.length;
  const items = [];
  const dueHasWarm = dueKeys.some((ch) => WARM_SET.has(ch));
  if (slots >= 2 && !dueHasWarm) {
    while (cursor.w < WARM.length && sched[WARM[cursor.w]]) cursor.w++;
    if (cursor.w < WARM.length) { items.push({ ch: WARM[cursor.w++], kind: '热身' }); slots--; }
  }
  // 热身字的复习也放组首（与新热身字同位），保证高频字只在组首出现
  dueKeys.sort((a, b) => (WARM_SET.has(b) ? 1 : 0) - (WARM_SET.has(a) ? 1 : 0));
  for (const ch of dueKeys) items.push({ ch, kind: '复习' });
  while (slots > 0 && cursor.o < ORDER.length) {
    const ch = ORDER[cursor.o++];
    if (sched[ch]) continue;
    items.push({ ch, kind: '新' });
    slots--;
  }
  return items;
}

function runOnce(seed, keepLog) {
  const rnd = mulberry32(seed);
  const sched = {};
  const cursor = { o: 0, w: 0 };
  const log = [];
  let minute = 0;
  const judge = (ch, kind, day) => {
    const at = atMs(day, 20, minute++ % 60);
    const e = sched[ch];
    let p;
    if (e) {
      const r = retrievability(e, at);
      p = typeof r === 'number' && Number.isFinite(r) ? r : 0.8;
    } else p = pNew(ch);
    const correct = rnd() < p;
    const step = reviewCard(e ? e.fsrs : null, { judgment: correct ? 'correct' : 'wrong', at }, { policy: GOOD_ONLY });
    sched[ch] = { fsrs: step.card, due: step.due, doneToday: day };
    return correct;
  };
  for (let d = 1; d <= DAYS; d++) {
    const day = addDays(START, d - 1);
    const groups = [];
    if (d === 1) {
      const first = combo.chars.map((ch) => ({ ch, kind: '首练' }));
      for (const it of first) it.ok = judge(it.ch, it.kind, day);
      groups.push(first);
    }
    const n = d === 1 ? 1 : GROUPS;
    for (let g = 0; g < n; g++) {
      const items = selectGroup(sched, day, cursor);
      if (!items.length) break;
      for (const it of items) it.ok = judge(it.ch, it.kind, day);
      groups.push(items);
    }
    log.push({ day: d, date: day, groups });
  }
  return { log, curatedSeen: cursor.o, warmSeen: cursor.w };
}

// ---------------------------------------------------------------- 检查
const HIGH_FREQ = 500; // 「成年人不会忘的高频字」= 热身表里的字 ∪ 字频序 < 500 的字
function check(log) {
  const v = { groupsWithMoreThanOneHighFreq: 0, top100Appear: [], adjacentHighFreq: 0, groups: 0 };
  let prevHigh = false;
  for (const day of log) { prevHigh = false; for (const g of day.groups) {
    v.groups++;
    const isHi = (ch) => WARM_SET.has(ch) || (rankOf(ch) ?? 99999) < HIGH_FREQ;
    const hi = g.filter((it) => isHi(it.ch));
    if (hi.length > 1) v.groupsWithMoreThanOneHighFreq++;
    for (const it of g) {
      const r = rankOf(it.ch);
      if (r !== null && r <= 100) v.top100Appear.push(it.ch);
      const isHigh = isHi(it.ch);
      if (isHigh && prevHigh) v.adjacentHighFreq++;
      prevHigh = isHigh;
    }
  } }
  return v;
}

const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(runOnce(SEED + i));
const rep = runs[0];
const agg = {
  runs: RUNS,
  violations: runs.reduce((a, r) => {
    const c = check(r.log);
    a.groupsWithMoreThanOneHighFreq += c.groupsWithMoreThanOneHighFreq;
    a.top100Appear += c.top100Appear.length;
    a.adjacentHighFreq += c.adjacentHighFreq;
    a.groups += c.groups;
    return a;
  }, { groupsWithMoreThanOneHighFreq: 0, top100Appear: 0, adjacentHighFreq: 0, groups: 0 }),
  curatedIntroducedBy30: stats(runs.map((r) => r.curatedSeen)),
  warmIntroducedBy30: stats(runs.map((r) => r.warmSeen)),
  kindsPerDay: [2, 3, 7, 14, 30].map((d) => {
    const k = { 热身: 0, 复习: 0, 新: 0 };
    for (const r of runs) for (const g of r.log[d - 1].groups) for (const it of g) if (k[it.kind] !== undefined) k[it.kind]++;
    return { day: d, avg: Object.fromEntries(Object.entries(k).map(([x, n]) => [x, Math.round((n / RUNS) * 10) / 10])) };
  }),
  correctRateNew: rate(runs, (it) => it.kind === '新'),
  correctRateReview: rate(runs, (it) => it.kind === '复习'),
};
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}
function rate(rs, pred) {
  let n = 0, ok = 0;
  for (const r of rs) for (const d of r.log) for (const g of d.groups) for (const it of g) if (pred(it)) { n++; if (it.ok) ok++; }
  return n ? Math.round((ok / n) * 1000) / 1000 : null;
}

const fmt = (it) => it.ch + (it.kind === '新' ? '' : '〔' + it.kind + '〕') + (it.ok ? '' : '✗');
const out = {
  params: { combo: COMBO_ID, groupsPerDay: GROUPS, runs: RUNS, seed: SEED, size: SIZE, reviewCap: REVIEW_CAP, start: START, highFreqRank: HIGH_FREQ, pshift: PSHIFT },
  representative: rep.log.filter((d) => SHOW_DAYS.includes(d.day)).map((d) => ({
    day: d.day, date: d.date, groups: d.groups.map((g) => g.map((it) => ({ ch: it.ch, kind: it.kind, ok: it.ok, rank: rankOf(it.ch) }))),
    text: d.groups.map((g) => g.map(fmt).join(' ')).join(' ｜ '),
  })),
  representativeCheck: check(rep.log),
  aggregate: agg,
};
if (!NO_WRITE) fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1) + '\n');
if (process.argv.includes('--stdout-json')) { process.stdout.write(JSON.stringify(out)); process.exit(0); }
console.log(`combo ${COMBO_ID} groups/day ${GROUPS} runs ${RUNS} seed ${SEED}`);
for (const d of out.representative) console.log(`第${d.day}天 ${d.date}: ${d.text}`);
console.log('representative check', JSON.stringify(out.representativeCheck));
console.log('aggregate', JSON.stringify(agg));
