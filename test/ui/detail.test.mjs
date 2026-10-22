// M3-6 单字详情的纯逻辑单测（04 R-D01–R-D10；决定-D21 / D23；03 P10b / P12；01 §3.5 / §4）。
// 模型（记录 / 写错过 / 快忘了 / 下次练习 / 做图片状态 / 自选 / 换掉的词语 / 旧照片）、换词卡片（data/deck.js withWordOff）、
// 格下标签、字源加载、四个写入（wordOff 加 / 撤、自选移除 / 放回）的成功、幂等与失败不发布。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import { MemoryStorage } from '../store/helpers.mjs';
import { createStore } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { KEYS } from '../../src/core/schema.js';
import { makeRecord } from '../../src/core/records.js';
import { promptModel } from '../../src/core/cards.js';
import { hasContextWord, withWordOff } from '../../src/data/deck.js';
import { t } from '../../src/config/copy/index.js';
import * as policy from '../../src/config/policy.js';
import {
  detailModel, listOf, cellCopy as cellCopyRaw, wordView, recordsOfChar, loadEtymology, setEtymology, etymologyOf, ETYMOLOGY_URL,
} from '../../src/ui/screens/detail/records.js';
import { renderRefs } from '../../src/config/copy/index.js';

const cellCopy = record => renderRefs(cellCopyRaw(record));
import {
  commitWordOff, commitWordOn, commitRemoveCustom, commitRestoreCustom, LABELS,
} from '../../src/ui/screens/detail/actions.js';
import { photoOf } from '../../src/ui/screens/detail/photos.js';
import { promptCopy } from '../../src/ui/screens/write/prompt.js';

loadFSRSGlobal();

const NOW = new Date(2026, 9, 1, 12, 0).getTime();
const TODAY = '2026-10-01';

const CARDS = {
  'base:静': { word: '平静', chars: ['平', '静'], ci: 1, target: '静', py: 'jìng', hint: 'x', strokes: 14, ctx: 'dict' },
  'base:永': { word: '永远', chars: ['永', '远'], ci: 0, target: '永', py: 'yǒng', hint: 'x', strokes: 5, ctx: 'dict', promptHint: '远' },
  'base:欤': { word: '欤字', chars: ['欤', '字'], ci: 0, target: '欤', py: 'yú', hint: 'x', strokes: 7, ctx: 'fallback' },
  'base:兢': { word: '兢', chars: ['兢'], ci: 0, target: '兢', py: 'jīng', hint: '小心谨慎、非常认真的样子', strokes: 14, ctx: 'gloss' },
};
const lookup = key => CARDS[key] || null;

let serial = 0;
function rec(char, judgment, day, { kind = 'judged' } = {}) {
  serial += 1;
  const [y, m, d] = day.split('-').map(Number);
  return makeRecord({
    id: `r${serial}`, cardKey: `base:${char}`, sessionId: 's1', kind, judgment: kind === 'judged' ? judgment : undefined,
    at: new Date(y, m - 1, d, 10).getTime(), help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false },
  });
}

function stateWith(records, extra = {}) {
  const byMonth = {};
  for (const r of records) (byMonth[r.localDay.slice(0, 7)] || (byMonth[r.localDay.slice(0, 7)] = [])).push(r);
  return { records: byMonth, sched: {}, custom: null, wordOff: null, photos: null, ...extra };
}

// ---------------------------------------------------------------- withWordOff（写字页题面口径）

test('withWordOff: only cards with a context word and a wordOff entry become pinyin-only; input untouched', () => {
  const card = CARDS['base:永'];
  assert.equal(hasContextWord(card), true);
  assert.equal(hasContextWord(CARDS['base:欤']), false, 'fallback 「X字」 is not a context word');
  assert.equal(hasContextWord(CARDS['base:兢']), false, 'gloss card has no word');
  assert.equal(withWordOff(card, null), card);
  assert.equal(withWordOff(card, {}), card);
  assert.equal(withWordOff(card, { 'base:静': 1 }), card, 'other card unaffected');
  const off = withWordOff(card, { 'base:永': 1 });
  assert.deepEqual(off.chars, ['永']);
  assert.equal(off.word, '永');
  assert.equal(off.ci, 0);
  assert.equal(off.ctx, 'fallback');
  assert.equal('promptHint' in off, false, 'word-specific prompt hint dropped');
  assert.equal(off.py, 'yǒng');
  assert.deepEqual(card.chars, ['永', '远'], 'input not mutated');
  const m = promptModel(off, promptCopy());
  assert.deepEqual(m.segments, [{ kind: 'blank', text: 'yǒng' }]);
  assert.equal(m.visibleHint, t('X-PROMPT.fallbackHint'));
  assert.equal(withWordOff(CARDS['base:兢'], { 'base:兢': 1 }), CARDS['base:兢'], 'gloss card stays');
});

// ---------------------------------------------------------------- 模型

test('detailModel: no records → count 0, noRecord image state, no due / list; swap offered for a context word', () => {
  const m = detailModel(stateWith([]), '静', { today: TODAY, lookup });
  assert.equal(m.count, 0);
  assert.equal(m.first, null);
  assert.equal(m.image, 'noRecord');
  assert.equal(m.due, null);
  assert.equal(m.list, null);
  assert.equal(m.canSwapWord, true);
  assert.equal(m.word.hasWord, true);
  assert.deepEqual(m.word.tiles, [{ ch: '平', blank: false }, { ch: '静', blank: true }]);
  assert.equal(m.pinyin, 'jìng');
  assert.equal(m.strokes, 14);
  assert.equal(m.practicable, true);
  assert.equal(detailModel(stateWith([]), '龘', { today: TODAY, lookup }).practicable, false, 'not in deck → not practicable');
});

test('detailModel: judged records only (answer-seen / skipped excluded), oldest first; first / latest; due only with judged (P12)', () => {
  serial = 0;
  const rs = [
    rec('静', 'correct', '2026-09-01'),
    rec('静', null, '2026-09-02', { kind: 'answer-seen' }),
    rec('静', 'wrong', '2026-09-05'),
    rec('静', null, '2026-09-06', { kind: 'skipped' }),
    rec('静', 'correct', '2026-09-20'),
    rec('永', 'wrong', '2026-09-21'),
  ];
  const state = stateWith(rs, { sched: { 'base:静': { fsrs: {}, due: '2026-10-09', lastJudgedAt: 1 } } });
  const m = detailModel(state, '静', { today: TODAY, lookup });
  assert.deepEqual(m.judged.map(r => r.id), ['r1', 'r3', 'r5']);
  assert.equal(m.count, 3);
  assert.equal(m.first.id, 'r1');
  assert.equal(m.latest.id, 'r5');
  assert.equal(m.due, '2026-10-09');
  assert.equal(m.image, 'noInk', 'no ink stored → noInk');
  assert.equal(detailModel(state, '静', { today: TODAY, lookup, hasInk: r => r.id === 'r5' }).image, 'ok');
  assert.equal(detailModel(state, '静', { today: TODAY, lookup, policy: { ...policy, features: { ...policy.features, nextReviewLine: false } } }).due, null,
    'features.nextReviewLine=false → no line');
  assert.deepEqual(recordsOfChar(state, '静').map(r => r.id), ['r1', 'r2', 'r3', 'r4', 'r5']);
  const none = detailModel(stateWith([], { sched: { 'base:静': { fsrs: {}, due: '2026-10-09', lastJudgedAt: 1 } } }), '静', { today: TODAY, lookup });
  assert.equal(none.due, null, 'sched without judged records → no next-review line');
});

test('listOf / detailModel.list: wrong by latest judged (K15); forget = latest correct and due (K16); mutually exclusive', () => {
  serial = 0;
  const rs = [rec('静', 'correct', '2026-09-01'), rec('静', 'wrong', '2026-09-10'), rec('永', 'correct', '2026-08-01')];
  const sched = { 'base:静': { fsrs: {}, due: '2026-09-11', lastJudgedAt: 1 }, 'base:永': { fsrs: {}, due: '2026-09-20', lastJudgedAt: 1 } };
  const all = rs;
  assert.equal(listOf({ records: all, sched, today: TODAY, cardKey: 'base:静' }), 'wrong', 'latest wrong → wrong even though due');
  assert.equal(listOf({ records: all, sched, today: TODAY, cardKey: 'base:永' }), 'forget');
  assert.equal(listOf({ records: all, sched: { 'base:永': { fsrs: {}, due: '2026-10-20', lastJudgedAt: 1 } }, today: TODAY, cardKey: 'base:永' }), null, 'not due');
  assert.equal(listOf({ records: all, sched, today: TODAY, cardKey: 'base:和' }), null, 'no records');
  // 更正为对：离开写错过（I02）
  const corrected = [rs[0], { ...rs[1], judgment: 'correct', corrections: [{ from: 'wrong', at: 1 }] }, rs[2]];
  assert.equal(listOf({ records: corrected, sched: { 'base:静': { fsrs: {}, due: '2026-10-05', lastJudgedAt: 1 } }, today: TODAY, cardKey: 'base:静' }), null);
  assert.equal(detailModel(stateWith(rs, { sched }), '静', { today: TODAY, lookup }).list, 'wrong');
});

test('detailModel: custom (index / entry), wordOff (label 释义 + prompt hint, no swap), photo not counted as a record (P10b)', () => {
  const state = stateWith([], {
    custom: { added: [{ char: '山', at: 1 }, { char: '静', at: 2 }] },
    wordOff: { 'base:静': 5 },
    photos: { 静: { day: '2025-01-02', at: 3, dataURL: 'data:image/png;base64,AA==' } },
  });
  const m = detailModel(state, '静', { today: TODAY, lookup });
  assert.equal(m.custom, true);
  assert.equal(m.customIndex, 1);
  assert.deepEqual(m.customEntry, { char: '静', at: 2 });
  assert.equal(m.wordOff, true);
  assert.equal(m.canSwapWord, false, 'already swapped → no row');
  assert.equal(m.word.hasWord, false);
  assert.equal(m.word.gloss, t('X-PROMPT.fallbackHint'));
  assert.equal(m.originalWord, '平静');
  assert.equal(m.count, 0, 'photo is not a record');
  assert.equal(m.image, 'noRecord');
  assert.deepEqual(m.photo, state.photos.静);
  assert.equal(m.photoCountsAsRecord, false, 'P10b policy.legacyPhotoCountsAsRecord=false');
  assert.deepEqual(photoOf(state, '静'), state.photos.静);
  assert.equal(photoOf(state, '永'), null);
  assert.equal(photoOf({ photos: { 永: { day: '2025-01-02', at: 3, dataURL: 'javascript:x' } } }, '永'), null, 'only data:image URLs');
});

test('wordView: gloss cards use the prompt content hint; fallback cards use the fallback hint', () => {
  assert.deepEqual(wordView(CARDS['base:兢']), { hasWord: false, tiles: [], gloss: '小心谨慎、非常认真的样子' });
  assert.equal(wordView(CARDS['base:欤']).gloss, t('X-PROMPT.fallbackHint'));
  assert.deepEqual(wordView(null), { hasWord: false, tiles: [], gloss: '' });
});

test('cellCopy: 记录格下两行「M月D日 / 写对·写错」，读屏名与放大标题「M月D日 · 写错」（H1 / P224）', () => {
  serial = 0;
  const r = rec('静', 'wrong', '2026-09-08');
  assert.deepEqual(cellCopy(r), { date: '9月8日', caption: '写错', title: '9月8日 · 写错' });
  assert.equal(cellCopy({ ...r, judgment: 'correct' }).caption, '写对');
});

// ---------------------------------------------------------------- 字源

test('loadEtymology: fetches once, maps char → {gloss, source}; failure is not cached', async () => {
  setEtymology(null);
  let calls = 0;
  const failing = async () => {
    calls += 1;
    return { ok: false, json: async () => null };
  };
  assert.equal(await loadEtymology(failing), null);
  assert.equal(etymologyOf('静'), null);
  const ok = async url => {
    calls += 1;
    assert.equal(url, ETYMOLOGY_URL);
    return { ok: true, json: async () => [{ char: '静', gloss: '审也。从青争声', source: '《说文解字》' }, { char: '空', gloss: '' }] };
  };
  const map = await loadEtymology(ok);
  assert.equal(calls, 2, 'retried after a failure');
  assert.deepEqual(map.get('静'), { gloss: '审也。从青争声', source: '《说文解字》' });
  assert.equal(etymologyOf('空'), null, 'empty gloss dropped');
  await loadEtymology(ok);
  assert.equal(calls, 2, 'cached after success');
  setEtymology(null);
});

// ---------------------------------------------------------------- 写入

function freshStore() {
  const backend = new MemoryStorage();
  const storage = createStorage(backend, { now: () => NOW });
  const store = createStore({ storage, now: () => NOW });
  store.load();
  return { store, storage, backend };
}

test('commitWordOff / commitWordOn: one write each, idempotent; failure publishes nothing', () => {
  const { store, storage, backend } = freshStore();
  const r1 = commitWordOff(store, 'base:静');
  assert.equal(r1.ok, true);
  assert.deepEqual(store.getState().wordOff, { 'base:静': NOW });
  assert.deepEqual(JSON.parse(backend.getItem(KEYS.wordOff)), { 'base:静': NOW });
  const w = backend.writeCount;
  assert.equal(commitWordOff(store, 'base:静').ok, true);
  assert.equal(backend.writeCount, w, 'already off → no write');
  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.wordOff });
  const r2 = commitWordOff(store, 'base:永');
  assert.equal(r2.ok, false);
  assert.deepEqual(store.getState().wordOff, { 'base:静': NOW }, 'nothing published on failure');
  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.wordOff });
  assert.equal(commitWordOn(store, 'base:静').ok, false, 'undo failure');
  assert.deepEqual(store.getState().wordOff, { 'base:静': NOW });
  assert.equal(commitWordOn(store, 'base:静').ok, true);
  assert.deepEqual(store.getState().wordOff, {});
  const w2 = backend.writeCount;
  assert.equal(commitWordOn(store, 'base:静').ok, true);
  assert.equal(backend.writeCount, w2, 'not off → no write');
  assert.equal(LABELS.wordOff, 'detail:word-off');
});

test('commitRemoveCustom / commitRestoreCustom: records untouched; undo restores position and time; failures publish nothing', () => {
  const { store, storage } = freshStore();
  serial = 0;
  const r = rec('木', 'correct', '2026-09-30');
  assert.equal(store.seed({ custom: { added: [{ char: '山', at: 1 }, { char: '木', at: 2 }, { char: '日', at: 3 }] }, records: { '2026-09': [r] } }).ok, true);
  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.custom });
  const f = commitRemoveCustom(store, '木');
  assert.equal(f.ok, false);
  assert.equal(f.removed, undefined);
  assert.deepEqual(store.getState().custom.added.map(e => e.char), ['山', '木', '日']);
  const ok = commitRemoveCustom(store, '木');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.removed, { entry: { char: '木', at: 2 }, index: 1 });
  assert.deepEqual(store.getState().custom.added.map(e => e.char), ['山', '日']);
  assert.deepEqual(store.getState().records['2026-09'].map(x => x.id), [r.id], 'records untouched (R-D06)');
  const none = commitRemoveCustom(store, '木');
  assert.equal(none.ok, true);
  assert.equal(none.removed, null, 'not custom → nothing removed');
  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.custom });
  assert.equal(commitRestoreCustom(store, ok.removed).ok, false);
  assert.deepEqual(store.getState().custom.added.map(e => e.char), ['山', '日']);
  assert.equal(commitRestoreCustom(store, ok.removed).ok, true);
  assert.deepEqual(store.getState().custom.added, [{ char: '山', at: 1 }, { char: '木', at: 2 }, { char: '日', at: 3 }]);
  assert.equal(commitRestoreCustom(store, ok.removed).ok, true, 'already back → no-op');
  assert.equal(store.getState().custom.added.length, 3);
});

// ---------------------------------------------------------------- D27 本人笔迹（阶段 1 P1-E3）

test('D27: detail cells — first and latest judgments draw their stored ink, a recycled middle one is honestly 没有笔迹 (no page-memory stand-in)', async () => {
  const { inkOf, hasInkPoints } = await import('../../src/ui/screens/detail/records.js');
  const { rememberInk, forgetRecentInk } = await import('../../src/ui/screens/write/compare.js');
  const { setInk, getInk } = await import('../../src/store/store.js');
  const { encodeInk, buildStroke } = await import('../../src/core/ink-math.js');
  const ink = encodeInk([buildStroke([{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }], { final: true })]);
  const first = rec('永', 'wrong', '2026-03-03');
  const middle = rec('永', 'correct', '2026-07-08');
  const latest = rec('永', 'correct', '2026-09-20');
  const state = stateWith([first, middle, latest], { ink: {} });
  setInk(state, first, ink);
  setInk(state, latest, ink); // middle 的墨迹已按 D27 回收
  const store = { getInk: r => getInk(state, r) };
  forgetRecentInk();
  rememberInk(middle.id, [[{ x: 1, y: 1, t: 0 }, { x: 9, y: 9, t: 9 }]]); // 本页面刚写过也不补位
  const m = detailModel(state, '永', { today: TODAY, lookup, hasInk: r => !!getInk(state, r) });
  assert.deepEqual([m.first.id, m.latest.id], [first.id, latest.id], 'first / latest available for a later 对照 entry');
  assert.equal(m.image, 'ok', 'latest has ink → image entry ok');
  assert.deepEqual(m.judged.map(r => hasInkPoints(inkOf(store, r))), [true, false, true]);
  forgetRecentInk();
});
