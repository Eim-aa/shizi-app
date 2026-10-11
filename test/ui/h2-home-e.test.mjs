// H2（D55，首页方向 E 极静）：首页数据模型与文案的单测。
//   首页只有日期、墨「拾」、竖排题记、按钮：模型里不再有字帖行 / 最近写的字 / 进行中格子 / 「拾」交接；
//   六态只在按钮字与两处各多一句上不同（homeCtaKey / homeNoteOf）；特别组那天「自己选字」仍在（旁边多一个「这次先写平常的字」）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homeModel, homeCtaKey, homeNoteOf } from '../../src/ui/screens/home/today.js';
import { COPY, t } from '../../src/config/copy/index.js';
import { validateValue, KEYS } from '../../src/core/schema.js';

const DAY = '2026-09-24';
const YDAY = '2026-09-23';
const at = (day, h = 9) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime();
const CAP_DECK = { newCandidates: () => [], practicable: key => key.startsWith('base:') };

function rec(n, c, { kind = 'judged', judgment = 'correct', day = DAY } = {}) {
  const r = { id: `r${n}`, cardKey: `base:${c}`, char: c, sessionId: 's9', kind, at: at(day, 8) + n, localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}
function sess(slot, kind, n, cursor) {
  return { id: `s${slot}`, slot, kind, source: { view: 'home' }, queue: Array.from({ length: n }, (_, i) => `base:${'一二三四五六七八'[i]}`),
    cursor, items: [], current: { phase: 'recall', strokes: [] }, lastLine: null, startedAt: at(DAY, 7), startedDay: DAY, updatedAt: at(DAY, 7) };
}
function state({ records = [], A = null, B = null } = {}) {
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: months, sessions: { A, B, lastEnded: {} }, backupMeta: null };
}
const history10 = () => Array.from({ length: 10 }, (_, i) => ({ ...rec(i + 1, String.fromCodePoint(0x6100 + i), { day: `2026-09-${String(23 - i).padStart(2, '0')}` }), sessionId: `s${i + 1}` }));

const STATES = {
  first: () => homeModel(state(), at(DAY), { deck: CAP_DECK }),
  fresh: () => homeModel(state({ records: [rec(1, '永', { day: YDAY })] }), at(DAY), { deck: CAP_DECK }),
  progress: () => homeModel(state({ records: [rec(1, '永')], A: sess('A', 'daily', 5, 2) }), at(DAY)),
  today: () => homeModel(state({ records: [rec(1, '永'), rec(2, '和')] }), at(DAY), { deck: CAP_DECK }),
  back: () => homeModel(state({ records: [rec(1, '醋', { day: '2026-09-10' }), rec(2, '膝', { day: '2026-09-10' }), rec(3, '醋', { day: '2026-09-11' })] }), at(DAY), { deck: CAP_DECK }),
  special: () => homeModel(state({ records: history10() }), at(DAY), { deck: CAP_DECK }),
};

test('the home model carries no copybook, no recent row, no progress cells, no handoff, no count (D55)', () => {
  for (const [name, make] of Object.entries(STATES)) {
    const m = make();
    for (const key of ['hero', 'inkRow', 'recentRow', 'progress', 'shiHandoff', 'count']) {
      assert.equal(key in m, false, `${name}: no ${key}`);
    }
  }
});

test('six states: the main button word (homeCtaKey)', () => {
  const words = Object.fromEntries(Object.entries(STATES).map(([name, make]) => [name, t(homeCtaKey(make()))]));
  assert.deepEqual(words, { first: '开始写字', fresh: '开始写字', progress: '继续写字', today: '再写一组', back: '开始写字', special: '开始写字' });
});

test('the two extra lines: back = 「你写过的 N 个字都还在。」 with the real N, special = the special-group sentence; nothing else has one', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(STATES).map(([name, make]) => [name, homeNoteOf(make())])),
    { first: null, fresh: null, progress: null, today: null, back: { key: 'X-HOME.backNote', vars: { n: 2 } }, special: { key: 'X-HOME.capitalBody', vars: {} } });
  assert.equal(t('X-HOME.backNote', { n: 46 }), '你写过的 46 个字都还在。');
  assert.equal(t('X-HOME.capitalBody'), '今天写两组大写数字，借条、红包上用得着。');
});

test('自己选字 stays on the special-group day, next to 这次先写平常的字; hidden only on the first open and during the first practice', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(STATES).map(([name, make]) => [name, make().showPick])),
    { first: false, fresh: true, progress: true, today: true, back: true, special: true });
  assert.equal(homeModel(state({ A: sess('A', 'first', 3, 1) }), at(DAY)).showPick, false, 'first practice not finished');
  assert.equal(t('X-HOME.capitalDefer'), '这次先写平常的字');
});

test('removed: the recent-row / handoff modules, their copy keys and test hooks are gone', () => {
  for (const f of ['recent.js', 'handoff.js', 'handoff-ink.js']) assert.equal(existsSync(new URL(`../../src/ui/screens/home/${f}`, import.meta.url)), false, `${f} is deleted`);
  for (const key of ['X-HOME.recentRowLabel', 'X-HOME.recentYesterday', 'X-HOME.recentDayBefore', 'X-HOME.recentDaysAgo', 'X-HOME.recentMixed',
    'X-HOME.shiHandoffLabel', 'X-HOME.shiFirstLine', 'X-HOME.inkRowLabel', 'X-HOME.progressLabel', 'X-HOME.libraryCount', 'R-H07.todayCount']) {
    assert.equal(COPY[key], undefined, `${key} is gone`);
  }
});

test('settings.shiHandoffDone stays in the schema for old data and backups (still a boolean) but nothing on the home reads it any more (D55 / P267)', () => {
  assert.equal(validateValue(KEYS.settings, { shiHandoffDone: true }), null);
  assert.notEqual(validateValue(KEYS.settings, { shiHandoffDone: 'yes' }), null);
});

test('「拾回」 now appears in one place only — the annual cover line (D53, N2-14); the result page keeps 「你写下的第一个「拾」。」', () => {
  const hits = Object.entries(COPY).filter(([, v]) => typeof v === 'string' && v.includes('拾回'));
  assert.deepEqual(hits.map(([k]) => k), ['X-WORK.annualCoverLine']);
  assert.equal(t('X-FIRST.shiWritten'), '你写下的第一个「拾」。');
});
