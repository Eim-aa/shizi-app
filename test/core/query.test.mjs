// M2-0 查字 / 自己选字的纯逻辑（src/core/query.js；决定-D21；04 R-Q03 / R-Q04 / R-Q06；03 P42 / P43 / P45）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAN_RE, isHan, filterInput, filterNotes, flattenRecords, isPracticable, customChars, isCustom, withCustomAdded,
  charSummary, rowStatus, cardStat, queryView, selectedChars, pickBar, normalizeMode, baseKey,
} from '../../src/core/query.js';
import * as policy from '../../src/config/policy.js';
import { validateValue, KEYS } from '../../src/core/schema.js';
import { t, has } from '../../src/config/copy/index.js';

const DAY = '2026-09-24';
const AT = new Date(2026, 8, 24, 10).getTime();

function rec(id, char, kind = 'judged', judgment = 'correct', localDay = DAY) {
  const r = { id, cardKey: `base:${char}`, char, sessionId: 's1', kind, at: AT, localDay, help: { hints: 0, answerSeen: false, traced: false } };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

// ---------------------------------------------------------------- 输入过滤（R-Q03 / P45）

test('filterInput: keeps Han only, dedupes in first-seen order, counts removed code points and duplicates', () => {
  const f = filterInput('永a和!永');
  assert.deepEqual(f.chars, ['永', '和']);
  assert.equal(f.removed, 2);
  assert.deepEqual(f.duplicates, ['永']);
  assert.equal(f.hanCount, 3);
  assert.equal(f.total, 5);
  assert.equal(f.overLimit, 0);
  const letters = filterInput('abc 12');
  assert.deepEqual(letters.chars, []);
  assert.equal(letters.removed, 6, 'letters, digits and the space all count as removed');
  assert.deepEqual(filterInput('').chars, []);
  assert.equal(filterInput(null).total, 0, 'non-string input → empty');
  assert.deepEqual(filterInput('好好好').duplicates, ['好'], 'each repeated char listed once');
});

test('filterInput: supplementary-plane Han counts as one char; punctuation / kana are removed', () => {
  const f = filterInput('𠀀，永。あ');
  assert.deepEqual(f.chars, ['𠀀', '永']);
  assert.equal(f.removed, 3);
  assert.ok(isHan('𠀀') && isHan('永') && !isHan('あ') && !isHan('永和') && !isHan(''));
  assert.ok(HAN_RE.test('〇'), 'Script=Han (same predicate as the prototype)');
});

test('filterInput: no hard cap by default (P45 queryInputMax=null); an explicit cap truncates the list and reports overLimit', () => {
  assert.equal(policy.queryInputMax, null);
  const long = '一二三四五六七八九十百千万';
  assert.equal(filterInput(long).chars.length, 13, 'default: nothing truncated');
  const capped = filterInput(long, { max: 5 });
  assert.deepEqual(capped.chars, ['一', '二', '三', '四', '五']);
  assert.equal(capped.overLimit, 8);
  assert.equal(filterInput(long, { max: 0 }).chars.length, 13, 'non-positive cap = no cap');
});

test('filterNotes: the three R-Q03 notes, duplicates only in the rows view, several duplicates in one line', () => {
  assert.deepEqual(filterNotes(filterInput('abc'), 'hint'), [{ key: 'R-Q03.onlyHanzi' }]);
  assert.deepEqual(filterNotes(filterInput('永a和!永'), 'rows'), [
    { key: 'R-Q03.removed', vars: { n: 2 } },
    { key: 'R-Q03.duplicate', vars: { char: '永' } },
  ]);
  assert.deepEqual(filterNotes(filterInput('永和永'), 'card'), [], 'no duplicate note outside rows (prototype L428)');
  assert.deepEqual(filterNotes(filterInput('永和永和'), 'rows'), [{ key: 'X-QUERY.duplicateMany', vars: { chars: '「永」「和」' } }]);
  assert.deepEqual(filterNotes(filterInput('永和'), 'rows'), []);
  assert.deepEqual(filterNotes(null, 'rows'), []);
  // 文案
  assert.equal(t('R-Q03.onlyHanzi'), '只能输入汉字。');
  assert.equal(t('R-Q03.removed', { n: 2 }), '只能输入汉字，已去掉 2 个字母或符号。');
  assert.equal(t('R-Q03.duplicate', { char: '永' }), '重复的「永」只算一次。');
  assert.equal(t('X-QUERY.duplicateMany', { chars: '「永」「和」' }), '重复的「永」「和」只算一次。');
});

// ---------------------------------------------------------------- 能不能练、自选

test('isPracticable: 不能练 = not in the current library AND not in the deck; non-Han never practicable', () => {
  const inDeck = c => c === '永' || c === '犇';
  const inLibrary = c => c === '永';
  assert.equal(isPracticable('永', { inDeck, inLibrary }), true);
  assert.equal(isPracticable('犇', { inDeck, inLibrary }), true, 'in deck, outside the current library → still practicable');
  assert.equal(isPracticable('龘', { inDeck, inLibrary }), false);
  assert.equal(isPracticable('a', { inDeck: () => true, inLibrary: () => true }), false);
  assert.equal(isPracticable('永'), false, 'no predicates → not practicable');
});

test('withCustomAdded: appends {char, at}; no-op (null) when already added; never mutates; result passes the schema', () => {
  const empty = withCustomAdded(null, '永', AT);
  assert.deepEqual(empty, { added: [{ char: '永', at: AT }] });
  assert.equal(validateValue(KEYS.custom, empty), null, 'custom shape valid');
  const frozen = Object.freeze({ added: Object.freeze([Object.freeze({ char: '永', at: 1 })]), note: 'x' });
  assert.equal(withCustomAdded(frozen, '永', AT), null, 'already in custom → null, nothing to write');
  const next = withCustomAdded(frozen, '和', AT);
  assert.deepEqual(next, { added: [{ char: '永', at: 1 }, { char: '和', at: AT }], note: 'x' });
  assert.deepEqual(frozen.added.map(e => e.char), ['永'], 'input untouched');
  assert.throws(() => withCustomAdded(null, 'ab', AT), TypeError);
  assert.throws(() => withCustomAdded(null, '永', NaN), TypeError);
  assert.deepEqual(customChars(next), ['永', '和']);
  assert.ok(isCustom(next, '和') && !isCustom(next, '春') && !isCustom(null, '永'));
});

// ---------------------------------------------------------------- 记录情况（R-Q04 / R-Q05 / P43）

test('flattenRecords: month arrays and folded months (kept)', () => {
  const recs = flattenRecords({ '2026-08': [rec('r1', '永')], '2026-09': { folded: true, kept: [rec('r2', '和')] }, bad: null });
  assert.deepEqual(recs.map(r => r.id), ['r1', 'r2']);
  assert.deepEqual(flattenRecords(null), []);
});

test('charSummary: counts judged only; latest by id; custom flag; sched due', () => {
  const records = [
    rec('r1', '永', 'judged', 'wrong', '2026-09-20'),
    rec('r2', '永', 'answer-seen'),
    rec('r3', '永', 'skipped'),
    rec('r4', '永', 'judged', 'correct', '2026-09-24'),
    rec('r5', '和', 'answer-seen'),
  ];
  const custom = { added: [{ char: '和', at: AT }] };
  const sched = { 'base:永': { fsrs: {}, due: '2026-10-01', lastJudgedAt: AT } };
  const s = charSummary('永', { records, sched, custom, practicable: true });
  assert.equal(s.cardKey, baseKey('永'));
  assert.equal(s.count, 2, 'answer-seen / skipped are not records (01 §3.2)');
  assert.equal(s.latest.id, 'r4');
  assert.equal(s.latestDay, '2026-09-24');
  assert.equal(s.due, '2026-10-01');
  assert.equal(s.custom, false);
  const h = charSummary('和', { records, sched, custom, practicable: true });
  assert.equal(h.count, 0);
  assert.equal(h.latest, null);
  assert.equal(h.custom, true);
});

test('rowStatus: 记录了 N 次 / 还没有记录 / 暂时不能练 / 自选的字 · … (P43 transitional wording)', () => {
  const base = { char: '永', practicable: true, custom: false, count: 0 };
  assert.deepEqual(rowStatus({ ...base, count: 3 }), { key: 'R-Q04.rowCount', vars: { n: 3 } });
  assert.deepEqual(rowStatus(base), { key: 'R-Q04.rowNone' });
  assert.deepEqual(rowStatus({ ...base, custom: true }), { key: 'R-Q04.rowCustomNone' });
  assert.deepEqual(rowStatus({ ...base, custom: true, count: 2 }), { key: 'R-Q04.rowCustomCount', vars: { n: 2 } });
  assert.deepEqual(rowStatus({ ...base, practicable: false, custom: true, count: 2 }), { key: 'R-Q04.rowUnavailable' },
    'unavailable wins');
  assert.equal(t('R-Q04.rowCustomCount', { n: 2 }), '自选的字 · 记录了 2 次');
  assert.equal(t('R-Q04.rowCustomNone'), '自选的字 · 还没有记录');
});

test('cardStat: record line with date day, or 还没有记录', () => {
  assert.deepEqual(cardStat({ count: 2, latestDay: DAY }), { key: 'R-Q05.cardStat', vars: { n: 2, day: DAY } });
  assert.deepEqual(cardStat({ count: 0, latestDay: null }), { key: 'R-Q04.rowNone' });
});

// ---------------------------------------------------------------- 视图与 pick 底栏（R-Q06）

test('queryView: hint → rows → card / bad; a single char opens its card; cur must still be in the input', () => {
  const practicable = c => c !== '龘';
  assert.deepEqual(queryView({ chars: [], practicable }), { view: 'hint', cur: '' });
  assert.deepEqual(queryView({ chars: ['永', '和'], practicable }), { view: 'rows', cur: '' });
  assert.deepEqual(queryView({ chars: ['永'], practicable }), { view: 'card', cur: '永' });
  assert.deepEqual(queryView({ chars: ['龘'], practicable }), { view: 'bad', cur: '龘' });
  assert.deepEqual(queryView({ chars: ['永', '龘'], cur: '龘', practicable }), { view: 'bad', cur: '龘' });
  assert.deepEqual(queryView({ chars: ['永', '和'], cur: '春', practicable }), { view: 'rows', cur: '' }, 'stale cur ignored');
});

test('selectedChars: only chars still typed and practicable, in input order; nothing selected by default', () => {
  const practicable = c => c !== '龘';
  assert.deepEqual(selectedChars(['永', '和'], new Set(), practicable), [], 'typing selects nothing');
  assert.deepEqual(selectedChars(['永', '和', '龘'], new Set(['和', '永', '龘', '春']), practicable), ['永', '和']);
  assert.deepEqual(selectedChars(['永'], ['永']), ['永']);
});

test('pickBar: 0 →「先选一个字」disabled; 1 →「练这个字」; N →「练这 N 个字」', () => {
  assert.deepEqual(pickBar(0), { key: 'R-Q06.btnNone', vars: undefined, disabled: true });
  assert.deepEqual(pickBar(1), { key: 'R-Q05.btnPractice', vars: undefined, disabled: false });
  assert.deepEqual(pickBar(3), { key: 'R-Q06.btnPracticeN', vars: { n: 3 }, disabled: false });
  assert.equal(t('R-Q06.btnNone'), '先选一个字');
  assert.equal(t('R-Q06.btnPracticeN', { n: 3 }), '练这 3 个字');
});

test('normalizeMode: only lookup / pick (P42: no add mode)', () => {
  assert.deepEqual([...policy.queryModes], ['lookup', 'pick']);
  assert.equal(normalizeMode('lookup'), 'lookup');
  assert.equal(normalizeMode('pick'), 'pick');
  assert.throws(() => normalizeMode('add'), RangeError);
  assert.throws(() => normalizeMode(undefined), RangeError);
});

test('copy: every R-Q key the component uses exists (R-Q01–R-Q06 filled)', () => {
  const keys = [
    'R-Q01.titleLookup', 'R-Q01.titlePick', 'R-Q01.placeholder', 'R-Q02.pickNote', 'R-Q02.lookupNote',
    'R-Q03.onlyHanzi', 'R-Q03.removed', 'R-Q03.duplicate', 'R-Q04.rowCount', 'R-Q04.rowNone', 'R-Q04.rowUnavailable',
    'R-Q04.rowCustomNone', 'R-Q04.rowCustomCount', 'R-Q05.cardStat', 'R-Q05.btnPractice', 'R-Q05.btnAdd',
    'R-Q05.alreadyAdded', 'R-Q05.addFailed', 'R-Q05.retry', 'R-Q05.cancel', 'R-Q05.backToList',
    'R-Q05.unavailableTitle', 'R-Q05.unavailableReason', 'R-Q05.unavailableSource', 'R-Q05.viewRecords',
    'R-Q06.btnPracticeN', 'R-Q06.btnNone', 'R-H06.saveFailed', 'R-H06.cancel', 'R-H06.retry',
    'X-QUERY.selectAria', 'X-QUERY.unselectAria', 'X-QUERY.cardMeta', 'X-QUERY.duplicateMany',
  ];
  for (const k of keys) assert.ok(has(k), `copy key ${k}`);
});
