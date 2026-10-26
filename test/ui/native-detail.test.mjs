// B3.7 App API 契约（字详情）：网页路径 == API 路径。
//   1. view.detail / view.detail-photo 返回网页页面渲染用的同一组模型函数的结果（文案引用渲染出的字与网页 t() 一字不差，笔画只在有墨时给）；
//   2. 写入 op（detail.wordOff / wordOn / addCustom / removeCustom / restoreCustom / correct）与网页路径同一批提交函数：整份 store deepEqual、commit 序列一致；
//   3. D07：失败不写、重试只记一次；stale（记录已不在）不写；
//   4. 去处（练这个字 / 做成图片）经网页页面注册的同一个函数；
//   5. 提交函数在 src/session（边界门禁），网页模块转出的是同一个函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from '../core/helpers.mjs';
import { MemoryStorage } from '../store/helpers.mjs';
import { createStore } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { KEYS } from '../../src/core/schema.js';
import { makeRecord } from '../../src/core/records.js';
import { encodeInk, buildStroke } from '../../src/core/ink-math.js';
import { setInk, getInk } from '../../src/store/store.js';
import { createAppApi } from '../../src/session/api/index.js';
import { detailHooks, setDetailHooks } from '../../src/session/api/detail.js';
import { baseKey, cellCopy, detailHero, detailModel, detailView, hasInkPoints, inkOf, photoView } from '../../src/session/views/detail.js';
import * as ops from '../../src/session/ops/detail.js';
import * as webActions from '../../src/ui/screens/detail/actions.js';
import * as webCorrect from '../../src/ui/screens/detail/correct.js';
import { setEtymology } from '../../src/data/etymology.js';
import { renderRefs, t, tRef } from '../../src/config/copy/index.js';

loadFSRSGlobal();

const NOW = new Date(2026, 9, 1, 12, 0).getTime();
const TODAY = '2026-10-01';
let serial = 0;

function rec(char, judgment, day, kind = 'judged') {
  serial += 1;
  const [y, m, d] = day.split('-').map(Number);
  return makeRecord({
    id: `r${serial}`, cardKey: `base:${char}`, sessionId: 's1', kind, judgment: kind === 'judged' ? judgment : undefined,
    at: new Date(y, m - 1, d, 10).getTime(), help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false },
  });
}

function freshStore(seed) {
  const backend = new MemoryStorage();
  const storage = createStorage(backend, { now: () => NOW });
  const store = createStore({ storage, now: () => NOW });
  store.load();
  if (seed) store.seed(seed);
  const labels = [];
  store.subscribe((state, info) => { if (info && info.type === 'commit') labels.push(info.label); });
  return { store, storage, backend, labels };
}

function seedState() {
  serial = 0;
  const rs = [rec('永', 'correct', '2026-08-01'), rec('永', 'wrong', '2026-08-09'), rec('永', 'correct', '2026-09-02'), rec('永', 'correct', '2026-09-20'), rec('木', 'correct', '2026-09-30')];
  const records = {};
  for (const r of rs) (records[r.localDay.slice(0, 7)] || (records[r.localDay.slice(0, 7)] = [])).push(r);
  return { records, custom: { added: [{ char: '山', at: 1 }, { char: '木', at: 2 }] } };
}

const api = (store, extra = {}) => createAppApi({ getStore: () => store, now: () => NOW, ...extra });

test('B3.7 view.detail = detailView over the same detailModel the web page renders; copy refs render to the web sentences', async () => {
  setEtymology([{ char: '永', gloss: '水长流', source: '《说文》' }]);
  const { store } = freshStore(seedState());
  const r = await api(store).call('view.detail', { char: '永' });
  assert.equal(r.ok, true);
  const v = r.view;
  const model = detailModel(store.getState(), '永', { today: TODAY, hasInk: rr => hasInkPoints(inkOf(store, rr)) });
  assert.deepEqual(v, detailView(store, '永', { today: TODAY, etymology: { gloss: '水长流', source: '《说文》' }, imageAction: false }));
  assert.equal(v.records.count, model.count);
  assert.equal(v.pinyin, model.pinyin);
  assert.equal(v.source.gloss, '水长流');
  // 头图两格 = detailHero；其余历次格不重画头图那两次
  const hero = detailHero(model);
  assert.deepEqual(v.hero.cells.map(c => c.recordId), hero.cells.map(c => c.record.id));
  assert.equal(v.records.cells.length, model.cells.length - hero.cells.length);
  // 文案引用渲染 = 网页 t() 的句子
  const first = hero.cells[0].record;
  assert.equal(tRef(v.hero.cells[0].caption), t('X-DETAIL.heroCaption', { label: t('X-DETAIL.heroFirst'), date: tRef(cellCopy(first).date) }));
  for (const c of v.records.cells) {
    const record = model.cells.find(x => x.id === c.recordId);
    const cc = renderRefs(cellCopy(record));
    assert.equal(tRef(c.date), cc.date);
    assert.equal(tRef(c.caption), cc.caption);
    assert.equal(tRef(c.aria), t('X-DETAIL.cellNoInkLabel', { text: cc.title }), 'no stored ink → reader name says so');
    assert.equal(c.hasInk, false);
    assert.deepEqual(c.strokes, []);
  }
  assert.equal(tRef(v.title), t('X-DETAIL.pageTitle', { char: '永' }));
  assert.equal(tRef(v.records.countLabel), t('R-D03.count', { n: model.count }));
  // 行：下次复习只在有 sched.due 时（这里没有）；没记录的字不出现做图片；加入自选 / 换词语按模型
  assert.deepEqual(v.rows.map(x => x.key), [...(model.canSwapWord ? ['swap'] : []), ...(model.custom ? ['remove'] : []), ...(!model.custom && model.practicable ? ['add'] : [])]);
  // 没有 imageAction（M4-5 没注册）时不出现做成图片这一行；注册后出现
  const withImage = detailView(store, '永', { today: TODAY, imageAction: true });
  assert.ok(withImage.rows.some(x => x.key === 'image'));
  // 自选字：移出自选行，没有「加入自选」
  const custom = detailView(store, '山', { today: TODAY });
  assert.ok(custom.rows.some(x => x.key === 'remove') && !custom.rows.some(x => x.key === 'add'));
  setEtymology(null);
});

test('B3.7 view.detail: stored ink travels as compact strokes (only with ink); photo view is read-only', () => {
  serial = 0;
  const ink = encodeInk([buildStroke([{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }], { final: true })]);
  const first = rec('永', 'wrong', '2026-03-03');
  const middle = rec('永', 'correct', '2026-07-08');
  const latest = rec('永', 'correct', '2026-09-20');
  const state = { records: { '2026-03': [first], '2026-07': [middle], '2026-09': [latest] }, ink: {}, sched: {}, custom: null, wordOff: null, photos: { 永: { day: '2026-05-01', at: 1, dataURL: 'data:image/png;base64,AAAA' }, 木: { dataURL: 'nope' } } };
  setInk(state, first, ink);
  setInk(state, latest, ink);
  const store = { getState: () => state, getInk: r => getInk(state, r) };
  const v = detailView(store, '永', { today: TODAY });
  assert.deepEqual(v.hero.cells.map(c => [c.kind, c.hasInk, c.wrong]), [['first', true, true], ['latest', true, false]]);
  assert.ok(v.hero.cells.every(c => c.strokes.length === 1 && c.strokes[0].length >= 2 && c.strokes[0][0].length >= 3));
  assert.deepEqual(v.records.cells.map(c => [c.hasInk, c.strokes.length]), [[false, 0]], 'the recycled middle one is honestly no ink (D27)');
  assert.ok(v.rows.some(x => x.key === 'legacy'), 'photos[字] → 旧记录行');
  // 旧记录页
  const p = photoView(state, '永');
  assert.equal(p.photo, 'data:image/png;base64,AAAA');
  assert.equal(tRef(p.title), t('R-D10.title', { char: '永' }));
  assert.deepEqual(renderRefs(p.body), t('R-D10.body'));
  assert.equal(photoView(state, '木').photo, null, 'not an image data URL → 照片没了');
  assert.equal(photoView(state, '日').photo, null);
});

test('B3.7 write ops: API path == web path (whole store deepEqual, same commit sequence); D07 failure writes nothing and the retry records once', async () => {
  const seed = seedState();
  const web = freshStore(seed);
  const app = freshStore(seed);
  const a = api(app.store);
  // 换个词语 → 撤销
  webActions.commitWordOff(web.store, baseKey('永'));
  assert.deepEqual(await a.call('detail.wordOff', { char: '永' }), { ok: true });
  webActions.commitWordOn(web.store, baseKey('永'));
  assert.deepEqual(await a.call('detail.wordOn', { char: '永' }), { ok: true });
  // 加入自选 / 移出自选 / 撤销
  webActions.commitAddCustom(web.store, '日');
  assert.deepEqual(await a.call('detail.addCustom', { char: '日' }), { ok: true });
  const wr = webActions.commitRemoveCustom(web.store, '山');
  const ar = await a.call('detail.removeCustom', { char: '山' });
  assert.equal(ar.ok, true);
  assert.deepEqual(ar.removed, wr.removed);
  webActions.commitRestoreCustom(web.store, wr.removed);
  assert.deepEqual(await a.call('detail.restoreCustom', { removed: ar.removed }), { ok: true });
  // 改判（缺省反过来；再点改回去）
  const rid = Object.values(web.store.getState().records).flat().find(r => r.char === '永' && r.judgment === 'wrong').id;
  webCorrect.commitCorrectRecord(web.store, { recordId: rid });
  assert.deepEqual(await a.call('detail.correct', { recordId: rid }), { ok: true });
  assert.deepEqual(app.store.getState(), web.store.getState());
  assert.deepEqual(app.labels, web.labels, 'same commit sequence');
  assert.deepEqual(app.labels, ['detail:word-off', 'detail:word-off-undo', 'query:add', 'detail:custom-remove', 'detail:custom-restore', 'detail:correct']);
  webCorrect.commitCorrectRecord(web.store, { recordId: rid });
  await a.call('detail.correct', { recordId: rid });
  assert.deepEqual(app.store.getState(), web.store.getState(), 'second tap flips it back');
  // D07：失败不写，重试成功只记一次
  const before = JSON.stringify(app.store.getState());
  const w0 = app.backend.writeCount;
  app.storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.wordOff });
  const bad = await a.call('detail.wordOff', { char: '木' });
  assert.equal(bad.ok, false);
  assert.equal(typeof bad.error.kind, 'string');
  assert.equal(JSON.stringify(app.store.getState()), before, 'nothing published');
  const w0b = app.backend.writeCount;
  assert.equal((await a.call('detail.wordOff', { char: '木' })).ok, true);
  const w1 = web.backend.writeCount;
  webActions.commitWordOff(web.store, baseKey('木'));
  assert.equal(app.backend.writeCount - w0b, web.backend.writeCount - w1, 'retry records exactly what one web commit records');
  assert.deepEqual(app.store.getState().wordOff, { 'base:木': NOW });
  assert.deepEqual(Object.keys(app.store.getState().wordOff), ['base:木']);
});

test('B3.7 detail.correct: unknown / not-correctable record is stale, nothing written; bad args are invalid', async () => {
  const { store, backend } = freshStore(seedState());
  const a = api(store);
  const w = backend.writeCount;
  assert.deepEqual(await a.call('detail.correct', { recordId: 'nope' }), { ok: false, error: { kind: 'stale' } });
  assert.equal(backend.writeCount, w);
  assert.equal((await a.call('detail.correct', {})).error.kind, 'invalid');
  assert.equal((await a.call('detail.wordOff', {})).error.kind, 'invalid');
  assert.equal((await a.call('detail.restoreCustom', {})).error.kind, 'invalid');
});

test('B3.7 detail.correct: retrying the displayed target never flips the record back', async () => {
  const { store, storage } = freshStore(seedState());
  const a = api(store);
  const record = Object.values(store.getState().records).flat().find(r => r.char === '永' && r.judgment === 'wrong');
  const args = { recordId: record.id, to: 'correct' };
  const before = JSON.stringify(store.getState());
  storage.failNextWrite(1, { kind: 'generic' });
  assert.equal((await a.call('detail.correct', args)).ok, false);
  assert.equal(JSON.stringify(store.getState()), before);
  assert.equal((await a.call('detail.correct', args)).ok, true);
  const once = JSON.stringify(store.getState().records);
  assert.equal((await a.call('detail.correct', args)).ok, true);
  assert.equal(JSON.stringify(store.getState().records), once, 'same target changes this judgment once');
});

test('B3.7 detail.practice / detail.image go through the destinations the web page registers', async () => {
  const { store } = freshStore(seedState());
  const a = api(store);
  const saved = { ...detailHooks() };
  try {
    setDetailHooks({ practice: null, image: null });
    assert.equal((await a.call('detail.practice', { char: '永' })).error.kind, 'unavailable');
    const calls = [];
    setDetailHooks({ practice: (chars, o) => { calls.push(['practice', chars, o]); return { ok: true, opened: 'new' }; }, image: x => calls.push(['image', x]) });
    assert.deepEqual(await a.call('detail.practice', { char: '永' }), { ok: true, opened: 'new' });
    assert.deepEqual(calls[0], ['practice', ['永'], { source: { view: 'detail', char: '永' } }]);
    await a.call('detail.image', { char: '永' });
    assert.equal(calls[1][0], 'image');
    assert.equal(calls[1][1].cardKey, 'base:永');
    assert.equal(calls[1][1].record.char, '永');
    // 开组写入失败 → 三段式（回 {ok:false, error:{kind}}）
    setDetailHooks({ practice: () => ({ ok: false, error: { kind: 'generic' } }) });
    assert.deepEqual(await a.call('detail.practice', { char: '永' }), { ok: false, error: { kind: 'generic' } });
    // S02：回 opened = 's02'
    setDetailHooks({ practice: () => ({ ok: true, started: false, opened: 's02' }) });
    assert.equal((await a.call('detail.practice', { char: '永' })).opened, 's02');
  } finally {
    setDetailHooks({ practice: saved.practice, image: saved.image });
  }
});

test('B3.7 the commit functions live in src/session and the web modules re-export the very same functions', () => {
  for (const n of ['LABELS', 'commitWordOff', 'commitWordOn', 'commitRemoveCustom', 'commitRestoreCustom', 'commitAddCustom']) assert.equal(webActions[n], ops[n], n);
  for (const n of ['CORRECT_LABEL', 'canCorrectHere', 'correctRecordInDraft', 'commitCorrectRecord']) assert.equal(webCorrect[n], ops[n], n);
});
