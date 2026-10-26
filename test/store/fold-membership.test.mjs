// R15：折叠旧月份（store/budget.js recover → foldMonth）不得改变「谁是作品成员」（D51 ⑤ isWorkMember；D27 / D47；P28 / P05）。
// 原因：旧 foldMonth 的 byDay / chars 收了全部 judged（含写错没放进来的），年报 / 月字帖 / 某一天的字读折叠月时把写错的字当成员。
// 修复：折叠时按 isWorkMember 逐条记下 work（/ workJudged），读的一方经 core/records.js foldWorkByDay 只读它；
// 旧折叠（没有 work）按 kept 尽量还原（见 foldWorkByDay 注释）。
//
// 这里：① QA 夹具 annual-past-year 的复现（B3.9 证据）；② 性质测试——许多种子 × 三种墨迹配置，凡是读月份的模型，
// 原始状态与折叠后状态的输出深相等（记录引用按「这条记录在该状态下有没有墨迹」规范化：折叠本来就丢掉中间记录与它们的墨迹，D27）；
// ③ 旧折叠的还原能力与边界（不崩、最好的数）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedGen, foldAll } from './fold-fixture.mjs';
import { record, inkEntry } from './helpers.mjs';
import { indexRecords, recover, retainedIds } from '../../src/store/budget.js';
import { validateRecordsMonth } from '../../src/core/schema.js';
import { foldWorkByDay } from '../../src/core/records.js';
import { storedInkPresent } from '../../src/core/ink-pick.js';
import { annualModel, annualYears } from '../../src/session/views/annual.js';
import { monthCells, monthMembers, imagePlan } from '../../src/core/images/pick.js';
import { recordIndex, recordsModel, mineModel } from '../../src/session/views/mine.js';
import { firstRecordDay, recordsOfState } from '../../src/session/views/library.js';
import { judgedCharsOf, judgedDaysOf } from '../../src/core/backup.js';

const TODAY = '2026-10-22';
const NOW = new Date(`${TODAY}T09:00:00`).getTime();

const ANNUAL_PAST_YEAR = { from: '2025-03-03', days: 90, perDay: 1, chars: '一二三四五六七八九十上下左右前后东西南北春夏秋冬红黄蓝绿白黑', seed: 3, wrongEvery: 11 };

function annualSummary(state) {
  const m = annualModel(state, TODAY, { year: 2025 });
  return {
    months: m.months.map(x => x.n),
    count: m.count,
    first: m.first && { char: m.first.char, day: m.first.day },
    members: ['2025-03', '2025-04', '2025-05'].map(month => monthMembers(state, month, {}).members.length),
  };
}

test('R15 repro (QA annual-past-year): folding 2025-03..05 keeps months 18/19/18 and the first character 东 on 3月4日', () => {
  const raw = seedGen(ANNUAL_PAST_YEAR);
  const march = raw.records['2025-03'];
  assert.equal(march.length, 29);
  const wrong = march.filter(r => r.judgment === 'wrong').map(r => `${r.char}@${r.localDay}`);
  assert.deepEqual(wrong, ['八@2025-03-03', '冬@2025-03-14', '左@2025-03-25']);
  const before = annualSummary(raw);
  assert.deepEqual(before, { months: [18, 19, 18], count: before.count, first: { char: '东', day: '2025-03-04' }, members: [18, 19, 18] });

  const { state: folded, actions } = foldAll(raw, NOW);
  assert.deepEqual(actions.filter(a => a.type === 'fold').map(a => a.month), ['2025-03', '2025-04', '2025-05']);
  for (const month of ['2025-03', '2025-04', '2025-05']) {
    assert.equal(folded.records[month].folded, true);
    assert.equal(validateRecordsMonth(folded.records[month], month), null, 'the new fold passes the schema');
  }
  // 「写过的字」口径（日历 / 字库 / 备份）不变：byDay 仍含写错的字
  assert.equal(folded.records['2025-03'].chars.length, 20);
  assert.ok(folded.records['2025-03'].byDay['2025-03-03'].includes('八'));
  assert.ok(!(folded.records['2025-03'].work['2025-03-03'] || []).includes('八'), 'a wrong, never-added judgment is not a work member');
  assert.deepEqual(annualSummary(folded), before);
});

// ---------------------------------------------------------------- 性质测试

/** 小的线性同余（可复现）。 */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const POOL = '人口手山水火木大小中';

/**
 * 随机原始状态：2024-11 .. 2025-04 每天 0–3 条记录，字从 10 个里抽（多重复）；判断写对 / 写错 / 纸上、看过答案、跳过混在一起；
 * 同一天同一个字可以先错后对、先对后错。inkMode：
 *   'none'      没有任何墨迹（成员只看判断）；
 *   'retained'  只有折叠后仍会留下的记录（D27 每字第一次 / 最近一次判断）有墨——折叠前后能画的格子一样多，连取到的记录都要一样；
 *   'seen'      另给全部看过答案的记录留墨（看后自写成员，Q1）——折叠会删掉它们的墨（D27 / Q1 的本意），所以只比成员与计数。
 */
function randomState(seed, inkMode) {
  const rnd = rng(seed * 7919 + 13);
  const records = {};
  let serial = 1;
  let sessionN = 1;
  const start = new Date('2024-11-01T09:00:00');
  const end = new Date('2025-04-30T09:00:00');
  for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
    const day = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const n = Math.floor(rnd() * 4);
    for (let k = 0; k < n; k += 1) {
      const char = POOL[Math.floor(rnd() * POOL.length)];
      const roll = rnd();
      const opts = { day, session: sessionN, at: dt.getTime() + k * 60000 };
      let rec;
      if (roll < 0.55) rec = record(serial, char, { ...opts, judgment: 'correct' });
      else if (roll < 0.75) rec = record(serial, char, { ...opts, judgment: 'wrong' });
      else if (roll < 0.83) rec = record(serial, char, { ...opts, judgment: rnd() < 0.5 ? 'correct' : 'wrong', extra: { source: 'paper' } });
      else if (roll < 0.94) rec = record(serial, char, { ...opts, kind: 'answer-seen' });
      else rec = record(serial, char, { ...opts, kind: 'skipped' });
      serial += 1;
      if (rnd() < 0.5) sessionN += 1;
      const month = day.slice(0, 7);
      (records[month] || (records[month] = [])).push(rec);
    }
  }
  const state = { records, ink: {}, sessions: { A: null, B: null, lastEnded: {} } };
  if (inkMode === 'none') return state;
  const keep = retainedIds(indexRecords(records, { sessions: state.sessions, now: NOW }));
  for (const [month, list] of Object.entries(records)) {
    for (const r of list) {
      const inked = (r.kind === 'judged' && r.source !== 'paper' && keep.has(r.id)) || (inkMode === 'seen' && r.kind === 'answer-seen');
      if (inked) (state.ink[month] || (state.ink[month] = {}))[r.id] = inkEntry(4, 1);
    }
  }
  return state;
}

/** 记录引用 → 'id'（这条记录在该状态下有墨）或 '-'（没有墨 / 没有记录）；byRecord=false 时一律 '-'。 */
function normalize(value, state, byRecord) {
  if (Array.isArray(value)) return value.map(v => normalize(v, state, byRecord));
  if (value instanceof Set) return [...value].sort();
  if (value instanceof Map) return normalize(Object.fromEntries(value), state, byRecord);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'record') out[k] = byRecord && v && storedInkPresent(state, v) ? v.id : '-';
    else if (k === 'ink' || k === 'cardKey' || k === 'recordIds' || k === 'missing') continue; // 墨迹点列（比 mode 就够）、卡键（衬底格是 base:字）、缺墨清单（折叠后不知道）
    else if (k === 'folded') continue; // 练习记录页的 data-folded 标记本来就说明这个月折叠了
    else if (!byRecord && (k === 'mode' || k === 'inked' || k === 'drawn')) continue;
    else out[k] = normalize(v, state, byRecord);
  }
  return out;
}

/** 第一处不同（断言消息用）。 */
function firstDiff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return { path, folded: JSON.stringify(a), raw: JSON.stringify(b) };
}

const inkOfState =state => record => (storedInkPresent(state, record) ? [[{ x: 1, y: 1 }]] : null);

/** 读月份的全部模型（年报、月字帖、月字帖图片、某一天的字与这天的图片、练习记录页、我的、字库首日、备份统计）。 */
function readers(state, { byRecord, ink }) {
  const index = recordIndex(state);
  const months = Object.keys(state.records).sort();
  const days = [...index.days].sort();
  const years = annualYears(state);
  const out = { years };
  out.annual = years.map(year => {
    const m = annualModel(state, TODAY, { year });
    // 'seen'：年报卷尾「同一个字，两次」与首字的取墨日期都看墨迹——折叠删掉看后自写的墨是 Q1 / D27 本意，不比
    return ink === 'seen' ? { ...m, twice: null, first: m.first && { char: m.first.char } } : m;
  });
  const hasInk = record => storedInkPresent(state, record);
  out.monthMembers = months.map(month => monthMembers(state, month, {}).members.map(m => ({ char: m.char, firstDay: m.firstDay, dot: m.dot })));
  out.monthMembersD42 = months.map(month => monthMembers(state, month, { hasInk }));
  out.monthCells = months.map(month => monthCells(state, month, { inkOf: inkOfState(state) }));
  out.monthImages = months.map(month => imagePlan(state, { kind: 'month', month }, { inkOf: inkOfState(state) }));
  out.records = months.map(month => recordsModel(state, TODAY, { month, day: days.find(d => d.startsWith(month)) }));
  out.dayRows = days.map(day => recordsModel(state, TODAY, { month: day.slice(0, 7), day }).selected);
  if (ink !== 'seen') out.dayImages = days.map(day => imagePlan(state, { kind: 'day', day }, { inkOf: inkOfState(state) }).cells);
  out.mine = mineModel(state, TODAY);
  const lib = recordsOfState(state);
  out.libraryFirstDay = firstRecordDay(lib.records, lib.foldedDays);
  out.backup = { chars: [...judgedCharsOf(state.records)].sort(), days: judgedDaysOf(state.records) };
  return normalize(out, state, byRecord);
}

for (const ink of ['none', 'retained', 'seen']) {
  test(`R15 property (${ink} ink): every model that reads months gives the same output before and after folding (60 seeds)`, () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const raw = randomState(seed, ink);
      const { state: folded, actions } = foldAll(raw, NOW);
      assert.ok(actions.filter(a => a.type === 'fold').length >= 5, `seed ${seed}: the old months fold`);
      for (const [month, value] of Object.entries(folded.records)) assert.equal(validateRecordsMonth(value, month), null, `seed ${seed} ${month}: schema`);
      const byRecord = ink === 'retained';
      const got = readers(folded, { byRecord, ink });
      const want = readers(raw, { byRecord, ink });
      assert.deepEqual(got, want, `seed ${seed} ${JSON.stringify(firstDiff(got, want))}`);
    }
  });
}

test('R15 property: folding in several steps (one month per recover) gives the same output as the raw state', () => {
  for (let seed = 61; seed <= 80; seed += 1) {
    const raw = randomState(seed, 'retained');
    let state = JSON.parse(JSON.stringify(raw));
    for (const month of Object.keys(raw.records).sort()) {
      recover(state, { now: NOW, budgets: { inkBudgetBytes: Infinity }, limit: { months: [month], inkMonths: Object.keys(state.ink) } });
      assert.deepEqual(readers(state, { byRecord: true, ink: 'retained' }), readers(raw, { byRecord: true, ink: 'retained' }), `seed ${seed} after ${month}`);
    }
  }
});

// ---------------------------------------------------------------- 旧折叠（R15 之前的数据）

/** 把新折叠退回 R15 之前的形状（去掉 work / workJudged）。 */
function legacyOf(state) {
  const out = JSON.parse(JSON.stringify(state));
  for (const value of Object.values(out.records)) if (value && value.folded) { delete value.work; delete value.workJudged; }
  return out;
}

test('R15 legacy folds: on the QA fixture the repair from kept fixes 2025-03 / 05 and 今年第一个字; 2025-04 keeps one unprovable wrong char', () => {
  const raw = seedGen(ANNUAL_PAST_YEAR);
  const legacy = legacyOf(foldAll(raw, NOW).state);
  assert.equal(legacy.records['2025-03'].work, undefined);
  // R15 之前读到 20 / 21 / 20、首字 八 @2025-05-16。现在 3 月、5 月的写错都是该字第一次判断（D27 留在 kept 里）→ 证得出；
  // 4 月有一个写错是中间那次（记录已折掉）→ 证不出，仍按成员算（多 1）。
  const got = annualSummary(legacy);
  assert.deepEqual(got.months, [18, 20, 18]);
  assert.deepEqual(got.members, [18, 20, 18]);
  assert.deepEqual(got.first, { char: '东', day: '2025-03-04' });
});

test('R15 legacy folds: kept proves a day wrong-only only when every kept screen judgment of that char that day is wrong', () => {
  const fold = {
    folded: true,
    month: '2025-01',
    byDay: { '2025-01-02': ['人', '口', '手'], '2025-01-03': ['人', '山'] },
    chars: ['人', '口', '手', '山'],
    paperOnly: { '2025-01-03': ['山'] },
    kept: [
      record(1, '人', { day: '2025-01-02', judgment: 'wrong' }),
      record(2, '口', { day: '2025-01-02', judgment: 'wrong' }),
      record(3, '口', { day: '2025-01-02', judgment: 'correct' }),
      record(4, '人', { day: '2025-01-03', judgment: 'wrong', extra: { source: 'paper' } }),
    ],
  };
  assert.equal(validateRecordsMonth(fold, '2025-01'), null);
  // 人@02：kept 里只有写错 → 去掉；口@02：kept 里有一条写对 → 留；手@02：kept 里没有那天的记录 → 分不出，按成员（旧行为）；
  // 人@03：kept 里只有纸上那条，不算证据 → 留；山@03：只在纸上 → 去掉（paperOnly）
  assert.deepEqual(foldWorkByDay(fold), { '2025-01-02': ['口', '手'], '2025-01-03': ['人'] });
  assert.deepEqual(foldWorkByDay(fold, { order: 'last' }), foldWorkByDay(fold), 'order has no effect on legacy folds');
  assert.deepEqual(foldWorkByDay(fold, { judgedOnly: true }), foldWorkByDay(fold));
});

test('R15 legacy folds: never crash on odd shapes and fall back to byDay', () => {
  for (const fold of [null, undefined, 1, 'x', [], {}, { folded: true }, { folded: true, byDay: null, kept: null }, { folded: true, byDay: { '2025-01-02': 'x' }, kept: [null, 1, {}] },
    { folded: true, byDay: { '2025-01-02': ['人'] }, work: [], kept: 'x' }, { folded: true, byDay: { '2025-01-02': ['人'] }, work: { '2025-01-02': 'x' } }]) {
    assert.doesNotThrow(() => foldWorkByDay(fold));
  }
  assert.deepEqual(foldWorkByDay({ folded: true, byDay: { '2025-01-02': ['人'] }, kept: [null, 1, {}] }), { '2025-01-02': ['人'] });
  assert.deepEqual(foldWorkByDay({ folded: true, byDay: { '2025-01-02': ['人'] }, work: { '2025-01-02': 'x' } }), {}, 'a malformed work day is skipped, not guessed');
});

test('R15 legacy folds across seeds: the repair only removes (day, char) pairs that kept shows as wrong, and cuts the error of the old reading', () => {
  let oldExtra = 0;
  let newExtra = 0;
  let newMissing = 0;
  let exactMonths = 0;
  let totalMonths = 0;
  const pairs = m => new Set(Object.entries(m).flatMap(([d, cs]) => cs.map(c => `${d}|${c}`)));
  for (const perDay of [1, 2]) for (const wrongEvery of [3, 7, 11]) for (let seed = 1; seed <= 10; seed += 1) {
    const raw = seedGen({ ...ANNUAL_PAST_YEAR, from: '2025-01-06', days: 120, perDay, seed, wrongEvery });
    const fresh = foldAll(raw, NOW).state;
    const legacy = legacyOf(fresh);
    for (const [month, value] of Object.entries(legacy.records)) {
      if (!value.folded) continue;
      totalMonths += 1;
      const truth = pairs(foldWorkByDay(fresh.records[month]));
      const repaired = pairs(foldWorkByDay(value));
      const oldReading = pairs(foldWorkByDay({ ...value, kept: [] })); // R15 之前：只去掉 paperOnly
      const wrongKept = new Set(value.kept.filter(r => r.judgment === 'wrong').map(r => `${r.localDay}|${r.char}`));
      for (const x of repaired) assert.ok(oldReading.has(x), 'the repair never adds a pair');
      for (const x of oldReading) if (!repaired.has(x)) assert.ok(wrongKept.has(x), 'a pair is removed only on evidence from kept');
      for (const x of oldReading) if (!truth.has(x)) oldExtra += 1;
      for (const x of repaired) if (!truth.has(x)) newExtra += 1;
      for (const x of truth) if (!repaired.has(x)) newMissing += 1;
      if ([...truth].every(x => repaired.has(x)) && [...repaired].every(x => truth.has(x))) exactMonths += 1;
    }
  }
  // 这批数据（一天一组、每组一字）：一个字同一天先错后对极少，所以证据几乎不会误删
  assert.ok(newExtra < oldExtra, `repair reduces wrong members (${newExtra} < ${oldExtra})`);
  assert.ok(newMissing * 20 < oldExtra - newExtra, `false drops (${newMissing}) are rare next to the fixes (${oldExtra - newExtra})`);
  assert.ok(exactMonths > 0 && exactMonths <= totalMonths);
});

test('R15 fold: after-seen work with ink at fold time stays a member; workJudged keeps 今年第一个字 on a judgment (D18)', () => {
  const records = {
    '2025-01': [
      record(1, '山', { day: '2025-01-02', kind: 'answer-seen' }),
      record(2, '人', { day: '2025-01-03', judgment: 'correct' }),
      record(3, '口', { day: '2025-01-03', judgment: 'wrong' }),
    ],
  };
  const ink = { '2025-01': { r1: inkEntry(4, 1) } };
  const raw = { records, ink, sessions: { A: null, B: null, lastEnded: {} } };
  const { state: folded } = foldAll(raw, NOW);
  const fold = folded.records['2025-01'];
  assert.deepEqual(fold.work, { '2025-01-02': ['山'], '2025-01-03': ['人'] });
  assert.deepEqual(fold.workJudged, { '2025-01-03': ['人'] });
  assert.equal(validateRecordsMonth(fold, '2025-01'), null);
  assert.equal(folded.ink['2025-01'].r1, undefined, 'the after-seen ink still goes with its record (Q1 / D27 unchanged)');
  const a = annualModel(raw, TODAY, { year: 2025 });
  const b = annualModel(folded, TODAY, { year: 2025 });
  assert.equal(b.count, a.count);
  assert.deepEqual(b.chars, a.chars);
  assert.deepEqual(b.months, a.months);
  assert.deepEqual({ char: b.first.char, day: b.first.day }, { char: '人', day: '2025-01-03' });
  assert.deepEqual({ char: a.first.char, day: a.first.day }, { char: '人', day: '2025-01-03' });
});

test('R15 fold: no ink domain at all — after-seen records are not members (same as the raw month)', () => {
  const records = { '2025-01': [record(1, '山', { day: '2025-01-02', kind: 'answer-seen' }), record(2, '人', { day: '2025-01-03' })] };
  const draft = { records };
  recover(draft, { now: NOW, budgets: { inkBudgetBytes: Infinity } });
  assert.deepEqual(draft.records['2025-01'].work, { '2025-01-03': ['人'] });
  assert.equal(draft.records['2025-01'].workJudged, undefined);
});
