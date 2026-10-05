// 首页数据模型单测（M2-1；01 §2 records × resume；决定-D12；03 P16 / P23 / P46；R-H02 / R-H04）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import {
  BACK_AFTER_DAYS, PROGRESS_MAX, homeModel, homeViewOf, heroOf, libraryCountOf, progressCells, recordsStateOf,
  resumeOf, resumeKeyOf, resumeLineText, resumeLineAria, INK_ROW_MAX,
} from '../../src/ui/screens/home/today.js';
import { AX_TIE_MIN, axTieCellSize, firstShiSize, shiCellSize, tieCellSize, tieCols } from '../../src/ui/screens/home/copybook.js';
import { EPIGRAPHS, epigraphAuthor } from '../../src/config/epigraphs.js';
import { COPY, t } from '../../src/config/copy/index.js';

const DAY = '2026-09-24';
const YDAY = '2026-09-23';
const at = (day, h = 9) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime();

function rec(n, c, { kind = 'judged', judgment = 'correct', day = DAY } = {}) {
  const r = { id: `r${n}`, cardKey: `base:${c}`, char: c, sessionId: 's9', kind, at: at(day, 8) + n, localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

function sess(slot, kind, n, cursor, day = DAY) {
  return { id: `s${slot}`, slot, kind, source: { view: 'home' }, queue: Array.from({ length: n }, (_, i) => `base:${'一二三四五六七八'[i]}`),
    cursor, items: [], current: { phase: 'recall', strokes: [] }, lastLine: null, startedAt: at(day, 7), startedDay: day, updatedAt: at(day, 7) };
}

function state({ records = [], A = null, B = null, backupMeta = null } = {}) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, sessions: { A, B, lastEnded: {} }, backupMeta };
}

test('records dimension: first / empty / record (K06: cleared → empty, not first)', () => {
  assert.equal(recordsStateOf(state(), DAY), 'first');
  assert.equal(recordsStateOf(state({ records: [rec(1, '永', { day: YDAY })] }), DAY), 'empty');
  assert.equal(recordsStateOf(state({ records: [rec(1, '永', { kind: 'answer-seen' })] }), DAY), 'first', 'answer-seen is not a record');
  assert.equal(recordsStateOf(state({ records: [rec(1, '永')] }), DAY), 'record');
  const cleared = state({ backupMeta: { lastExportAt: null, lastExportSig: null, lastConclusion: { kind: 'clear', date: YDAY, count: 3 } } });
  assert.equal(recordsStateOf(cleared, DAY), 'empty');
  assert.equal(recordsStateOf(null, DAY), 'first', 'store not booted');
});

test('resume dimension: none / A / B / A+B; B is the primary line, A the other (D05 / S01)', () => {
  const now = at(DAY);
  assert.deepEqual(resumeOf(state(), now), { resume: 'none', primary: null, other: null });
  assert.deepEqual(resumeOf(state({ A: sess('A', 'daily', 5, 2) }), now),
    { resume: 'A', primary: { slot: 'A', kind: 'daily', remaining: 3 }, other: null });
  assert.deepEqual(resumeOf(state({ B: sess('B', 'picked', 2, 0) }), now),
    { resume: 'B', primary: { slot: 'B', kind: 'picked', remaining: 2 }, other: null });
  assert.deepEqual(resumeOf(state({ A: sess('A', 'first', 5, 1), B: sess('B', 'picked', 2, 1) }), now),
    { resume: 'A+B', primary: { slot: 'B', kind: 'picked', remaining: 1 }, other: { slot: 'A', kind: 'first', remaining: 4 } });
  assert.equal(resumeOf(state({ A: sess('A', 'daily', 5, 5) }), now).resume, 'none', 'written-out group is not resumable');
  assert.equal(resumeOf(state({ A: sess('A', 'daily', 5, 2, YDAY) }), now).resume, 'none', 'yesterday’s daily expires (P37)');
  assert.equal(resumeOf(state({ B: sess('B', 'picked', 2, 0, YDAY) }), now).resume, 'B', 'picked never expires (P61)');
});

test('N and ink row: judged today deduped by char, latest 8 by id (D12)', () => {
  const chars = '一二三四五六七八九';
  const records = [...chars].map((c, i) => rec(i + 1, c));
  records.push(rec(10, '一', { judgment: 'correct' }), rec(11, '十', { day: YDAY }), rec(12, '二', { kind: 'skipped' }), rec(13, '赢', { judgment: 'wrong' }));
  const m = homeModel(state({ records }), at(DAY));
  assert.equal(m.count, 10, 'N counts the wrong 赢 too: the number is true');
  assert.deepEqual(m.inkRow.map(r => r.char), [...'三四五六七八九一'], '赢 (wrong) is not in the row — the row is today’s work (D51 ⑤)');
  assert.equal(m.inkRow.length, INK_ROW_MAX);
  assert.equal(m.count, 10, 'number stays N');
  assert.equal(INK_ROW_MAX, 8);
});

test('P16 (decided by the stage-1 home design): with an unfinished group the home shows that group, not today’s chars', () => {
  const s = state({ records: [rec(1, '永')], A: sess('A', 'daily', 5, 1) });
  const m = homeModel(s, at(DAY));
  assert.equal(m.view, 'progress');
  assert.equal(m.hero, 'progress');
  assert.equal(m.showRecord, false);
  assert.deepEqual(m.inkRow, [], 'today’s chars are not drawn next to the group');
  assert.equal(m.count, 1, 'count is still computed');
});

test('first-visit tip only when first and no group; period / date / epigraph from the clock', () => {
  assert.equal(homeModel(state(), at(DAY)).showFirstTip, true);
  assert.equal(homeModel(state({ A: sess('A', 'first', 5, 0) }), at(DAY)).showFirstTip, false);
  const m = homeModel(state(), at(DAY, 16));
  assert.equal(m.period, 'dusk');
  assert.deepEqual(m.dateParts, { month: 9, day: 24 });
  assert.equal(m.epigraph, EPIGRAPHS[0], '2026-09-24 = day 267 → 267 % 3 = 0');
  assert.equal(homeModel(state(), at('2026-09-25', 4)).period, 'night');
  assert.equal(homeModel(state(), at('2026-09-25', 4)).epigraph, EPIGRAPHS[1]);
});

test('R-H04 keys and the epigraph line (D49: one horizontal line, author name only)', () => {
  assert.equal(resumeKeyOf('picked'), 'R-H04.resumePicked');
  assert.equal(resumeKeyOf('first'), 'R-H04.resumeFirst');
  assert.equal(resumeKeyOf('daily'), 'R-H04.resumeDaily');
  assert.deepEqual(EPIGRAPHS.map(epigraphAuthor), ['孙过庭', '杜甫', '苏轼'], 'the line shows the author only; the full 《篇名》 stays in the source (read aloud by the screen reader)');
  assert.equal(epigraphAuthor({ source: '佚名' }), '佚名', 'no 《》 → the whole source');
  assert.equal(epigraphAuthor(null), '');
});

test('B6 (G45, D36): a current char that has seen its answer (still tracing / writing it) is not counted in 「还有 N 个字没写」', () => {
  const now = at(DAY);
  const withCurrent = (session, current) => ({ ...session, current: { phase: 'answer', strokes: [], ...current } });
  // 5 个字，写到第 3 个（cursor 2）：没看过答案 → 还有 3 个没写
  const plain = resumeOf(state({ A: sess('A', 'daily', 5, 2) }), now).primary;
  assert.deepEqual(plain, { slot: 'A', kind: 'daily', remaining: 3 });
  assert.equal(resumeLineText(plain, t), '今天的练习 · 接着写', 'E9d / P196: the visible line carries no count');
  assert.equal(resumeLineAria(plain, t), '今天的练习 · 接着写，还有 3 个字没写', 'the count is only in the screen-reader name (D49 ⑦)');
  // 第 3 个字看过答案：正在写第 3 个字 · 还有 2 个
  for (const phase of ['answer', 'trace', 'retrace']) {
    const seen = resumeOf(state({ A: withCurrent(sess('A', 'daily', 5, 2), { phase, answerSeen: true }) }), now).primary;
    assert.deepEqual(seen, { slot: 'A', kind: 'daily', remaining: 2, position: 3 }, phase);
    assert.equal(resumeLineText(seen, t), '今天的练习 · 接着写', phase);
    assert.equal(resumeLineAria(seen, t), '今天的练习 · 接着写，正在写第 3 个字，还有 2 个', phase);
  }
  // 三种来源
  const first = resumeOf(state({ A: withCurrent(sess('A', 'first', 5, 0), { answerSeen: true }) }), now).primary;
  assert.equal(resumeLineText(first, t), '第一次练习 · 接着写');
  assert.equal(resumeLineAria(first, t), '第一次练习 · 接着写，正在写第 1 个字，还有 4 个');
  const picked = resumeOf(state({ B: withCurrent(sess('B', 'picked', 3, 1), { answerSeen: true }) }), now).primary;
  assert.equal(resumeLineText(picked, t), '这次选的字 · 接着写');
  assert.equal(resumeLineAria(picked, t), '这次选的字 · 接着写，正在写第 2 个字，还有 1 个');
  // 最后一个字：不写「还有 0 个」
  const last = resumeOf(state({ B: withCurrent(sess('B', 'picked', 2, 1), { answerSeen: true }) }), now).primary;
  assert.deepEqual(last, { slot: 'B', kind: 'picked', remaining: 0, position: 2 });
  assert.equal(resumeLineAria(last, t), '这次选的字 · 接着写，正在写第 2 个字，这是最后一个');
  // 两组都没写完：other 行同口径
  const both = resumeOf(state({ A: withCurrent(sess('A', 'daily', 5, 1), { answerSeen: true }), B: sess('B', 'picked', 2, 0) }), now);
  assert.deepEqual(both.primary, { slot: 'B', kind: 'picked', remaining: 2 });
  assert.deepEqual(both.other, { slot: 'A', kind: 'daily', remaining: 3, position: 2 });
  assert.equal(resumeLineText(both.other, t), '今天的练习 · 接着写');
  assert.equal(resumeLineAria(both.other, t), '今天的练习 · 接着写，正在写第 2 个字，还有 3 个');
  assert.equal(resumeLineText(null, t), '');
  assert.equal(resumeLineAria(null, t), '');
});

test('D40 (P129): the home model says which special group is next — only with a deck, no unfinished group, and the conditions met', () => {
  // 10 组历史：每天一组（昨天起往前 10 天），每组一个字
  const records = Array.from({ length: 10 }, (_, i) => ({ ...rec(i + 1, String.fromCodePoint(0x6100 + i), { day: `2026-09-${String(23 - i).padStart(2, '0')}` }), sessionId: `s${i + 1}` }));
  const deck = { newCandidates: () => [], practicable: key => key.startsWith('base:') };
  const base = state({ records });
  assert.equal(homeModel(base, at(DAY), { deck }).capital, 'capital1');
  assert.equal(homeModel(base, at(DAY)).capital, null, 'no deck → never');
  assert.equal(homeModel(state({ records: records.slice(0, 9) }), at(DAY), { deck }).capital, null, 'fewer than 10 groups');
  assert.equal(homeModel(state({ records, A: sess('A', 'daily', 5, 1) }), at(DAY), { deck }).capital, null, 'an unfinished group is on the home page instead');
  assert.equal(homeModel(state(), at(DAY), { deck }).capital, null, 'first visit');
  const after = [...records, ...[...'壹贰叁肆伍'].map((c, i) => ({ ...rec(50 + i, c, { day: YDAY }), sessionId: 's20' }))];
  assert.equal(homeModel(state({ records: after }), at(DAY), { deck }).capital, 'capital2');
  const done = [...after, ...[...'陆柒捌玖'].map((c, i) => ({ ...rec(60 + i, c, { day: YDAY }), sessionId: 's21' }))];
  assert.equal(homeModel(state({ records: done }), at(DAY), { deck }).capital, null, 'both groups have appeared');
  assert.equal(COPY['X-HOME.capitalLead'], undefined, 'D49: the first sentence 「「拾」也是大写的十。」 is gone, one sentence left');
  assert.equal(t('X-HOME.capitalBody'), '今天写两组大写数字，借条、红包上用得着。');
  assert.equal(t('R-H03.firstVisit'), '先写三个大家常忘的字。', 'stage-1 design §一: the line under 开始写字 (D38: 3 chars)');
});

// ---------------------------------------------------------------- 阶段 1 P1-E5：首页五态与首次打开

const CAP_DECK = { newCandidates: () => [], practicable: key => key.startsWith('base:') };
const history10 = () => Array.from({ length: 10 }, (_, i) => ({ ...rec(i + 1, String.fromCodePoint(0x6100 + i), { day: `2026-09-${String(23 - i).padStart(2, '0')}` }), sessionId: `s${i + 1}` }));

test('homeViewOf: first / fresh / today / progress / special / back, with this priority (03 P155)', () => {
  assert.equal(homeViewOf({ records: 'first', resume: 'none', capital: null, gapDays: null }), 'first');
  assert.equal(homeViewOf({ records: 'empty', resume: 'none', capital: null, gapDays: 1 }), 'fresh');
  assert.equal(homeViewOf({ records: 'empty', resume: 'none', capital: null, gapDays: BACK_AFTER_DAYS - 1 }), 'fresh', '6 days away is not 「回来」');
  assert.equal(homeViewOf({ records: 'empty', resume: 'none', capital: null, gapDays: BACK_AFTER_DAYS }), 'back', '≥7 days (D41)');
  assert.equal(homeViewOf({ records: 'empty', resume: 'none', capital: null, gapDays: 30 }), 'back');
  assert.equal(homeViewOf({ records: 'record', resume: 'none', capital: null, gapDays: 0 }), 'today');
  assert.equal(homeViewOf({ records: 'record', resume: 'A', capital: null, gapDays: 0 }), 'progress', 'a group in progress wins over 今天写过');
  assert.equal(homeViewOf({ records: 'first', resume: 'A', capital: null, gapDays: null }), 'progress', 'a first practice written halfway is a group in progress');
  assert.equal(homeViewOf({ records: 'empty', resume: 'B', capital: null, gapDays: 20 }), 'progress');
  assert.equal(homeViewOf({ records: 'record', resume: 'none', capital: 'capital1', gapDays: 0 }), 'special');
  assert.equal(homeViewOf({ records: 'empty', resume: 'none', capital: 'capital2', gapDays: 12 }), 'special', 'the next group is the special one: say so instead of 「写旧字」');
  assert.equal(homeViewOf({ records: 'empty', resume: 'A', capital: 'capital1', gapDays: 3 }), 'progress');
  assert.equal(heroOf('first', 'first'), 'shi');
  assert.equal(heroOf('fresh', 'empty'), 'shi');
  assert.equal(heroOf('back', 'empty'), 'shi');
  assert.equal(heroOf('today', 'record'), 'today');
  assert.equal(heroOf('progress', 'record'), 'progress');
  assert.equal(heroOf('special', 'record'), 'today', 'special day with chars already written: the chars stay the hero (design §四 ④)');
  assert.equal(heroOf('special', 'empty'), 'shi');
});

test('homeModel five states from a real state: first / fresh / today / progress / special / back (+ 自己选字 only after the first practice)', () => {
  const first = homeModel(state(), at(DAY), { deck: CAP_DECK });
  assert.deepEqual([first.view, first.hero, first.showPick, first.libraryCount], ['first', 'shi', false, 0], 'first open hides 自己选字 (D46 ②)');
  const half = homeModel(state({ A: sess('A', 'first', 3, 1) }), at(DAY));
  assert.deepEqual([half.view, half.showPick], ['progress', false], 'first practice not finished: still no 自己选字');
  const halfJudged = homeModel(state({ records: [rec(1, '尴')], A: sess('A', 'first', 3, 1) }), at(DAY));
  assert.deepEqual([halfJudged.view, halfJudged.records, halfJudged.showPick], ['progress', 'record', false], 'one char judged but the first practice is not finished: still hidden');
  const fresh = homeModel(state({ records: [rec(1, '永', { day: YDAY })] }), at(DAY), { deck: CAP_DECK });
  assert.deepEqual([fresh.view, fresh.hero, fresh.showPick, fresh.libraryCount], ['fresh', 'shi', true, 1], 'after the first practice 自己选字 is there');
  const today = homeModel(state({ records: [rec(1, '永'), rec(2, '和', { judgment: 'correct' }), rec(3, '赢', { judgment: 'wrong' })] }), at(DAY), { deck: CAP_DECK });
  assert.deepEqual([today.view, today.hero, today.inkRow.map(r => r.char), today.showPick], ['today', 'today', ['永', '和'], true]);
  const progress = homeModel(state({ records: [rec(1, '永')], A: sess('A', 'daily', 5, 2) }), at(DAY));
  assert.deepEqual([progress.view, progress.hero, progress.progress.cells.length, progress.primary.remaining, progress.showPick], ['progress', 'progress', 5, 3, true]);
  const special = homeModel(state({ records: history10() }), at(DAY), { deck: CAP_DECK });
  assert.deepEqual([special.view, special.capital, special.showPick], ['special', 'capital1', false], 'the defer button takes the place of 自己选字 (D46 ④)');
  const back = homeModel(state({ records: [rec(1, '醋', { day: '2026-09-10' })] }), at(DAY), { deck: CAP_DECK });
  assert.deepEqual([back.view, back.gapDays], ['back', 14]);
  const cleared = homeModel(state({ backupMeta: { lastExportAt: null, lastExportSig: null, lastConclusion: { kind: 'clear', date: YDAY, count: 3 } } }), at(DAY));
  assert.deepEqual([cleared.view, cleared.showPick], ['fresh', true], 'cleared records: not the first-open screen again (K06), no gap');
});

test('progressCells: written ones carry their record, passed ones have no char, the next one is marked, the rest are blank (nothing leaks)', () => {
  const r1 = rec(1, '一');
  const session = { ...sess('A', 'daily', 5, 3), items: [
    { cardKey: 'base:一', recordId: 'r1', kind: 'judged' },
    { cardKey: 'base:二', recordId: 'r2', kind: 'skipped' },
    { cardKey: 'base:三', recordId: 'r3', kind: 'answer-seen' },
  ] };
  const { cells, total, start } = progressCells(session, [r1, rec(2, '二', { kind: 'skipped' }), rec(3, '三', { kind: 'answer-seen' })]);
  assert.deepEqual(cells.map(c => c.state), ['done', 'passed', 'passed', 'next', 'empty']);
  assert.deepEqual([total, start], [5, 0]);
  assert.equal(cells[0].char, '一');
  assert.equal(cells[0].record.id, 'r1');
  for (const c of cells.slice(1)) assert.equal(c.char, undefined, `cell ${c.index} ${c.state} has no char`);
  assert.deepEqual(progressCells(null, []), { cells: [], total: 0, start: 0 });
  assert.equal(progressCells({ ...sess('A', 'daily', 2, 2), items: [] }, []).cells.some(c => c.state === 'next'), false, 'written out: no next');
  const long = { ...sess('B', 'picked', 8, 0), queue: Array.from({ length: 12 }, (_, i) => `base:${String.fromCodePoint(0x4e00 + i)}`), cursor: 9 };
  const w = progressCells(long, []);
  assert.equal(w.cells.length, PROGRESS_MAX);
  assert.deepEqual([w.start, w.cells.map(c => c.index).includes(9), w.cells.find(c => c.index === 9).state, w.total], [4, true, 'next', 12]);
  const head = progressCells({ ...long, cursor: 1 }, []);
  assert.equal(head.start, 0);
});

test('libraryCountOf: distinct chars with a judged record (the count now lives only in the screen-reader label, D49-7)', () => {
  assert.equal(libraryCountOf([rec(1, '一'), rec(2, '一'), rec(3, '二'), rec(4, '三', { kind: 'skipped' })]), 2, 'distinct chars with a judged record');
});

test('D49: the 「昨天写的字」 row, the epigraph reserve and the intrusion test are gone from the home model (nothing left to leak a count or a vertical epigraph)', async () => {
  const today = await import('../../src/ui/screens/home/today.js');
  for (const name of ['lastWrittenRow', 'LAST_ROW_MAX', 'epigraphReserve', 'tieIntrudesEpigraph', 'epigraphColumnHeight', 'EPIGRAPH_COLUMN']) {
    assert.equal(name in today, false, `${name} removed`);
  }
});

test('axTieCellSize (AX tiers, 实现交接 §1.4): the normal cell width is the ceiling; a short remaining height shrinks it, never below 44', () => {
  assert.equal(AX_TIE_MIN, 44);
  assert.equal(axTieCellSize(107, 1, 0), 107, 'height unknown → unchanged');
  assert.equal(axTieCellSize(107, 1, 400), 107, 'plenty of room → unchanged (never larger than the normal width)');
  assert.equal(axTieCellSize(107, 1, 90), 90, 'one row, 90 left → 90');
  assert.equal(axTieCellSize(80, 2, 150), 75, 'two rows (6–8 chars) share the height');
  assert.equal(axTieCellSize(80, 2, 60), 44, 'floor 44 — the page scrolls instead');
  assert.equal(axTieCellSize(167, 1, Number.NaN), 167);
});

test('home cell sizes (T3-01 / D53 ③): a copybook row always fills the content width, cell = min(width / n, 160); the single 「拾」 is the same rule', () => {
  const b = 402 - 40; // 362
  assert.deepEqual([1, 2, 3, 4, 5, 6, 8].map(n => tieCellSize(n, b)), [160, 160, 120, 90, 72, 90, 90], 'n ≤ 5 one row: ⌊b / n⌋ capped at 160; 6–8 two rows of four');
  assert.deepEqual([3, 4, 5].map(n => n * tieCellSize(n, b)), [360, 360, 360], 'rows of 3–5 fill the content width (362) to within the rounding');
  assert.deepEqual([1, 3, 4, 5, 6, 8, 9].map(tieCols), [1, 3, 4, 5, 4, 4, 4]);
  assert.equal(tieCellSize(3, 350), 116, '390 wide: ⌊350 / 3⌋');
  assert.equal(tieCellSize(2, 335), 160, '375 wide, two chars: capped at 160');
  assert.equal(shiCellSize(b), 160, 'the single 「拾」 cell = tieCellSize(1, b)');
  assert.equal(shiCellSize(100), 100, 'never wider than the content');
  assert.equal(firstShiSize(402), 201);
  assert.equal(firstShiSize(375), 188);
  assert.equal(firstShiSize(320), 172, 'clamped to 172 on the narrowest');
  assert.equal(firstShiSize(500), 216, 'clamped to 216');
});
