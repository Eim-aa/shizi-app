// 首页数据模型单测（M2-1；01 §2 records × resume；决定-D12；03 P16 / P23 / P46；R-H02 / R-H04）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import {
  BACK_AFTER_DAYS, homeModel, homeViewOf, libraryCountOf, recordsStateOf,
  resumeOf, resumeKeyOf, resumeLineText, resumeLineAria, homeCtaKey, progressText, ctaAria,
} from '../../src/session/views/home.js';
import { firstShiSize } from '../../src/ui/screens/home/copybook.js';
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

test('resume dimension: none / A / B / A+B; B is the primary line, A the other (D05 / S01); D66 ⑧ lines carry done / total, `daily` is A whatever B does', () => {
  const now = at(DAY);
  assert.deepEqual(resumeOf(state(), now), { resume: 'none', primary: null, other: null, daily: null });
  assert.deepEqual(resumeOf(state({ A: sess('A', 'daily', 5, 2) }), now),
    { resume: 'A', primary: { slot: 'A', kind: 'daily', remaining: 3, done: 0, total: 5 }, other: null, daily: { slot: 'A', kind: 'daily', remaining: 3, done: 0, total: 5 } });
  assert.deepEqual(resumeOf(state({ B: sess('B', 'picked', 2, 0) }), now),
    { resume: 'B', primary: { slot: 'B', kind: 'picked', remaining: 2, done: 0, total: 2 }, other: null, daily: null });
  assert.deepEqual(resumeOf(state({ A: sess('A', 'first', 5, 1), B: sess('B', 'picked', 2, 1) }), now),
    { resume: 'A+B', primary: { slot: 'B', kind: 'picked', remaining: 1, done: 0, total: 2 }, other: { slot: 'A', kind: 'first', remaining: 4, done: 0, total: 5 },
      daily: { slot: 'A', kind: 'first', remaining: 4, done: 0, total: 5 } });
  assert.equal(resumeOf(state({ A: sess('A', 'daily', 5, 5) }), now).resume, 'none', 'written-out group is not resumable');
  assert.equal(resumeOf(state({ A: sess('A', 'daily', 5, 2, YDAY) }), now).resume, 'none', 'yesterday’s daily expires (P37)');
  assert.equal(resumeOf(state({ B: sess('B', 'picked', 2, 0, YDAY) }), now).resume, 'B', 'picked never expires (P61)');
});

test('D66 ⑧ done / total: items written (judged or answer-seen) over the queue; skipped ones are not counted as written', () => {
  const g = sess('A', 'daily', 20, 9);
  g.items = [
    ...Array.from({ length: 7 }, (_, i) => ({ cardKey: `base:${i}`, kind: 'judged', recordId: `r${i}` })),
    { cardKey: 'base:7', kind: 'answer-seen', recordId: 'r7' },
    { cardKey: 'base:8', kind: 'skipped', recordId: 'r8' },
  ];
  const line = resumeOf(state({ A: g }), at(DAY)).primary;
  assert.deepEqual([line.done, line.total, line.remaining], [8, 20, 11]);
  assert.equal(progressText(line, t), '8 / 20');
  assert.equal(resumeLineText(line, t), '今天的字 · 8 / 20');
  assert.equal(resumeLineAria(line, t), '接着写今天的字，已写 8 个，共 20 个');
});

test('D66 ⑧ two entries, two wordings: the main button continues 「继续写字」 / 「继续写自选字」 with 「· 已写 / 总数」 in its name; the line says 「今天的字 · n / total」 and is a › row', () => {
  const now = at(DAY);
  const both = homeModel(state({ A: sess('A', 'daily', 20, 7), B: sess('B', 'picked', 5, 2) }), now);
  assert.equal(t(homeCtaKey(both)), '继续写自选字', 'B is the main button: said so, so it cannot be mistaken for today’s group');
  assert.equal(ctaAria(both, t), '继续写自选字，已写 0 个，共 5 个');
  assert.equal(resumeLineText(both.other, t), '今天的字 · 0 / 20');
  const onlyA = homeModel(state({ A: sess('A', 'daily', 20, 7) }), now);
  assert.equal(t(homeCtaKey(onlyA)), '继续写字');
  assert.equal(ctaAria(onlyA, t), '继续写字，已写 0 个，共 20 个');
  const idle = homeModel(state(), now);
  assert.equal(ctaAria(idle, t), '开始写字', 'no group in progress: the plain label, no count');
  assert.equal(both.daily.total, 20, 'daily is A even while B is the primary line');
});

test('P16 (D55): with an unfinished group the home is the \u201Ccontinue\u201D state — no copybook, no today row, just the view and the resume lines', () => {
  const s = state({ records: [rec(1, '永')], A: sess('A', 'daily', 5, 1) });
  const m = homeModel(s, at(DAY));
  assert.equal(m.view, 'progress');
  assert.equal(m.showRecord, false);
  assert.equal(m.primary.remaining, 4);
  for (const key of ['hero', 'inkRow', 'recentRow', 'progress', 'count']) assert.equal(key in m, false, `${key} is gone (D55)`);
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

test('R-H04 keys and the epigraph author (the home shows the author name only, the small vertical line in D55 as in D49)', () => {
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
  assert.deepEqual(plain, { slot: 'A', kind: 'daily', remaining: 3, done: 0, total: 5 });
  assert.equal(resumeLineText(plain, t), '今天的字 · 0 / 5', 'D66 ⑧: the visible line carries 已写 / 总数');
  assert.equal(resumeLineAria(plain, t), '接着写今天的字，已写 0 个，共 5 个');
  // 第 3 个字看过答案：正在写第 3 个字 · 还有 2 个
  for (const phase of ['answer', 'trace', 'retrace']) {
    const seen = resumeOf(state({ A: withCurrent(sess('A', 'daily', 5, 2), { phase, answerSeen: true }) }), now).primary;
    assert.deepEqual(seen, { slot: 'A', kind: 'daily', remaining: 2, done: 0, total: 5, position: 3 }, phase);
    assert.equal(resumeLineText(seen, t), '今天的字 · 0 / 5', phase);
    assert.equal(resumeLineAria(seen, t), '接着写今天的字，正在写第 3 个，共 5 个', phase);
  }
  // 三种来源
  const first = resumeOf(state({ A: withCurrent(sess('A', 'first', 5, 0), { answerSeen: true }) }), now).primary;
  assert.equal(resumeLineText(first, t), '首次练习 · 0 / 5');
  assert.equal(resumeLineAria(first, t), '接着写首次练习，正在写第 1 个，共 5 个');
  const picked = resumeOf(state({ B: withCurrent(sess('B', 'picked', 3, 1), { answerSeen: true }) }), now).primary;
  assert.equal(resumeLineText(picked, t), '自己选的 · 0 / 3');
  assert.equal(resumeLineAria(picked, t), '接着写自己选的字，正在写第 2 个，共 3 个');
  // 最后一个字：不写「还有 0 个」
  const last = resumeOf(state({ B: withCurrent(sess('B', 'picked', 2, 1), { answerSeen: true }) }), now).primary;
  assert.deepEqual(last, { slot: 'B', kind: 'picked', remaining: 0, done: 0, total: 2, position: 2 });
  assert.equal(resumeLineAria(last, t), '接着写自己选的字，正在写最后一个');
  // 两组都没写完：other 行同口径
  const both = resumeOf(state({ A: withCurrent(sess('A', 'daily', 5, 1), { answerSeen: true }), B: sess('B', 'picked', 2, 0) }), now);
  assert.deepEqual(both.primary, { slot: 'B', kind: 'picked', remaining: 2, done: 0, total: 2 });
  assert.deepEqual(both.other, { slot: 'A', kind: 'daily', remaining: 3, done: 0, total: 5, position: 2 });
  assert.equal(resumeLineText(both.other, t), '今天的字 · 0 / 5');
  assert.equal(resumeLineAria(both.other, t), '接着写今天的字，正在写第 2 个，共 5 个');
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
});

test('homeModel five states from a real state: first / fresh / today / progress / special / back (+ 自己选字 only after the first practice)', () => {
  const first = homeModel(state(), at(DAY), { deck: CAP_DECK });
  assert.deepEqual([first.view, first.showPick, first.libraryCount], ['first', false, 0], 'first open hides 自己选字 (D46 ②)');
  const half = homeModel(state({ A: sess('A', 'first', 3, 1) }), at(DAY));
  assert.deepEqual([half.view, half.showPick], ['progress', false], 'first practice not finished: still no 自己选字');
  const halfJudged = homeModel(state({ records: [rec(1, '尴')], A: sess('A', 'first', 3, 1) }), at(DAY));
  assert.deepEqual([halfJudged.view, halfJudged.records, halfJudged.showPick], ['progress', 'record', false], 'one char judged but the first practice is not finished: still hidden');
  const fresh = homeModel(state({ records: [rec(1, '永', { day: YDAY })] }), at(DAY), { deck: CAP_DECK });
  assert.deepEqual([fresh.view, fresh.showPick, fresh.libraryCount], ['fresh', true, 1], 'after the first practice 自己选字 is there');
  const today = homeModel(state({ records: [rec(1, '永'), rec(2, '和', { judgment: 'correct' }), rec(3, '赢', { judgment: 'wrong' })] }), at(DAY), { deck: CAP_DECK });
  assert.deepEqual([today.view, today.showPick], ['today', true]);
  const progress = homeModel(state({ records: [rec(1, '永')], A: sess('A', 'daily', 5, 2) }), at(DAY));
  assert.deepEqual([progress.view, progress.primary.remaining, progress.showPick], ['progress', 3, true]);
  const special = homeModel(state({ records: history10() }), at(DAY), { deck: CAP_DECK });
  assert.deepEqual([special.view, special.capital, special.showPick], ['special', 'capital1', true], 'D55 / design E ⑥: 自己选字 stays, the defer button sits next to it (D46 ④ used to replace it)');
  const back = homeModel(state({ records: [rec(1, '醋', { day: '2026-09-10' })] }), at(DAY), { deck: CAP_DECK });
  assert.deepEqual([back.view, back.gapDays], ['back', 14]);
  const cleared = homeModel(state({ backupMeta: { lastExportAt: null, lastExportSig: null, lastConclusion: { kind: 'clear', date: YDAY, count: 3 } } }), at(DAY));
  assert.deepEqual([cleared.view, cleared.showPick], ['fresh', true], 'cleared records: not the first-open screen again (K06), no gap');
});

test('libraryCountOf: distinct chars with a judged record (the N in 「你写过的 N 个字都还在。」, D55)', () => {
  assert.equal(libraryCountOf([rec(1, '一'), rec(2, '一'), rec(3, '二'), rec(4, '三', { kind: 'skipped' })]), 2, 'distinct chars with a judged record');
});

test('D49: the 「昨天写的字」 row, the epigraph reserve and the intrusion test are gone from the home model (D55 brings back a vertical epigraph, but as the home own markup, not a reserve in the model)', async () => {
  const today = await import('../../src/session/views/home.js');
  for (const name of ['lastWrittenRow', 'LAST_ROW_MAX', 'epigraphReserve', 'tieIntrudesEpigraph', 'epigraphColumnHeight', 'EPIGRAPH_COLUMN']) {
    assert.equal(name in today, false, `${name} removed`);
  }
});

test('firstShiSize: the first-open 「拾」 frame (kept as is, D55): half the width, clamped to [172, 216]', () => {
  assert.equal(firstShiSize(402), 201);
  assert.equal(firstShiSize(375), 188);
  assert.equal(firstShiSize(320), 172, 'clamped to 172 on the narrowest');
  assert.equal(firstShiSize(500), 216, 'clamped to 216');
});
