// 阶段 1 P1-E8「在纸上写，回来自判」的数据层（D46 ⑬ / D47；实现交接 §10.1；03 P165 / P166 / P169）：
// 记录 source（缺省 = screen，旧数据不重写）、纸上记录照常进判断 / FSRS / 清单 / 字库字数、schema 与备份往返、
// 保护副本与 v1 迁移兼容、D27 留存不让纸上那次占「最近一次」、作品共用判定 isPaperRecord / isWorkRecord。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFSRSGlobal } from './helpers.mjs';
import {
  makeRecord, validateRecord as coreValidate, recordSource, isPaperRecord, isWorkRecord, withoutPaper, RECORD_SOURCES,
  wrongList, forgetList, writtenCardKeys, todayCount, latestJudged,
} from '../../src/core/records.js';
import { writeModeOf, paperOf, WRITE_MODES } from '../../src/core/paper.js';
import { recoverSession, createSession, withCurrent } from '../../src/core/sessions.js';
import { applyJudgment } from '../../src/core/fsrs.js';
import { KEYS, recordsKey, validateRecord, validateValue, parseBackupV2 } from '../../src/core/schema.js';
import { indexRecords, inkTier, pruneInkOfCards, recover } from '../../src/store/budget.js';
import { buildBackupV2, inspectBackup, makeSafety, restoreFromBackup, serializeBackup } from '../../src/core/backup.js';
import { createStore } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { MemoryStorage, record, inkEntry, flatInk, session, baselineState, plain } from '../store/helpers.mjs';

loadFSRSGlobal();

const NOW = new Date(2026, 9, 4, 20).getTime(); // 本地 2026-10-04
const DAY = '2026-10-04';

const paper = (serial, char, opts = {}) => record(serial, char, { ...opts, extra: { ...(opts.extra || {}), source: 'paper' } });

test('P166: source 缺省视为 screen——旧记录不带 source、不重写；只有纸上记录写 source:"paper"', () => {
  assert.deepEqual(RECORD_SOURCES, ['screen', 'paper']);
  const old = record(1, '人', { day: DAY });
  assert.equal('source' in old, false);
  assert.equal(recordSource(old), 'screen');
  assert.equal(isPaperRecord(old), false);
  assert.equal(recordSource(paper(2, '人', { day: DAY })), 'paper');
  assert.equal(isPaperRecord(paper(2, '人', { day: DAY })), true);
  assert.equal(recordSource({ ...old, source: 'screen' }), 'screen', 'explicit screen is the same as missing');
  assert.equal(isPaperRecord(null), false);

  const at = new Date(2026, 9, 4, 9).getTime();
  const onPaper = makeRecord({ id: 'r3', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'correct', at, help: {}, source: 'paper' });
  assert.equal(onPaper.source, 'paper');
  assert.equal('inkId' in onPaper, false, 'paper record has no ink (ink = null)');
  const onScreen = makeRecord({ id: 'r4', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'correct', at, help: {}, source: 'screen' });
  assert.equal('source' in onScreen, false, 'screen is the default: not written');
  assert.throws(() => makeRecord({ id: 'r5', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'correct', at, source: 'ipad' }), /source/);
  assert.throws(() => makeRecord({ id: 'r6', cardKey: 'base:静', sessionId: 's1', kind: 'skipped', at, source: 'paper' }), /paper/,
    'only judged records can be on paper');
  assert.deepEqual(coreValidate({ ...onPaper, inkId: 'r1' }).filter(e => /paper/.test(e)).length, 1, 'paper record never points to ink');
});

test('P169: 作品共用判定——isWorkRecord = judged 且不在纸上；withoutPaper 去掉纸上记录（图片、月字帖、年报与其字数用）', () => {
  const list = [record(1, '人', { day: DAY }), paper(2, '口', { day: DAY }), record(3, '永', { day: DAY, kind: 'answer-seen' })];
  assert.deepEqual(list.map(isWorkRecord), [true, false, false]);
  assert.deepEqual(withoutPaper(list).map(r => r.id), ['r1', 'r3']);
  assert.deepEqual(withoutPaper(null), []);
});

test('P165: 写字方式 settings.writeMode（缺省 screen）+ 本字临时切换 current.paper（优先于设置）', () => {
  assert.deepEqual(WRITE_MODES, ['screen', 'paper']);
  assert.equal(writeModeOf(null), 'screen');
  assert.equal(writeModeOf({ writeMode: 'paper' }), 'paper');
  assert.equal(writeModeOf({ writeMode: 'bogus' }), 'screen');
  assert.equal(paperOf({ settings: { writeMode: 'paper' }, current: { phase: 'recall' } }), true);
  assert.equal(paperOf({ settings: { writeMode: 'paper' }, current: { phase: 'recall', paper: false } }), false, 'this char back on screen');
  assert.equal(paperOf({ settings: {}, current: { phase: 'compare', paper: true } }), true, 'this char on paper');
  assert.equal(paperOf({ settings: { writeMode: 'paper' }, current: { phase: 'answer' } }), false, 'answer / trace stay on screen');
  assert.equal(paperOf({ settings: null, current: null }), false);
});

test('P166: 纸上记录照常进判断、写错过 / 快忘了清单、字库字数、今天的字数与 FSRS', () => {
  const recs = [record(1, '人', { day: '2026-09-01' }), paper(2, '人', { day: DAY, judgment: 'wrong' }), paper(3, '口', { day: DAY })];
  assert.deepEqual(wrongList(recs).map(r => r.id), ['r2'], 'paper wrong → 写错过');
  assert.deepEqual([...writtenCardKeys(recs)].sort(), ['base:人', 'base:口'], '字库字数 counts paper');
  assert.equal(todayCount(recs, DAY), 2);
  assert.equal(latestJudged(recs, 'base:人').id, 'r2');
  const sched = { 'base:口': { fsrs: { stability: 2 }, due: DAY, lastJudgedAt: 0 } };
  assert.deepEqual(forgetList({ records: recs, sched, today: DAY }).items.map(i => i.cardKey), ['base:口'], 'paper correct + due → 快忘了');
  const rec = makeRecord({ id: 'r9', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'correct', at: NOW, help: {}, source: 'paper' });
  const { entry } = applyJudgment(undefined, rec);
  assert.ok(entry && entry.fsrs && typeof entry.due === 'string', 'FSRS schedules a paper judgment like any other');
});

test('P166: schema——record.source 只收 screen | paper，纸上只能是 judged 且不带 inkId；settings.writeMode / paperSuggested；current.paper', () => {
  assert.equal(validateRecord(plain(paper(1, '人'))), null);
  assert.equal(validateRecord(plain(record(1, '人', { extra: { source: 'screen' } }))), null);
  assert.match(validateRecord(plain(record(1, '人', { extra: { source: 'pen' } }))), /source/);
  assert.match(validateRecord(plain(record(1, '人', { kind: 'skipped', extra: { source: 'paper' } }))), /source/);
  assert.match(validateRecord(plain(paper(1, '人', { extra: { inkId: 'r1' } }))), /inkId/);
  assert.equal(validateValue(KEYS.settings, { writeMode: 'paper', paperSuggested: true }), null);
  assert.match(validateValue(KEYS.settings, { writeMode: 'pencil' }), /writeMode/);
  assert.match(validateValue(KEYS.settings, { paperSuggested: 'yes' }), /paperSuggested/);
  const s = baselineState().sessions;
  const withPaper = plain(s);
  withPaper.A.current.paper = true;
  assert.equal(validateValue(KEYS.sessions, withPaper), null);
  withPaper.A.current.paper = 'yes';
  assert.match(validateValue(KEYS.sessions, withPaper), /paper/);
});

test('P166: 恢复幂等——纸上那一字停在判断页（compare，笔画为空、current.paper）刷新后仍在判断页；屏幕上的照旧回 recall', () => {
  const s = createSession({ id: 's1', kind: 'daily', queue: ['base:人', 'base:口'], at: NOW });
  const onPaper = withCurrent(s, { phase: 'compare', strokes: [], paper: true }, NOW);
  assert.equal(recoverSession(onPaper, []).recovered, false);
  assert.equal(recoverSession(onPaper, []).session.current.phase, 'compare');
  const onScreen = withCurrent(s, { phase: 'compare', strokes: [] }, NOW);
  assert.equal(recoverSession(onScreen, []).session.current.phase, 'recall');
});

test('P166: D27 留存——纸上那次不占「第一次 / 最近一次」：之前留墨的最近一次不回收，预算回收也永不回收它', () => {
  // 人：r1 屏幕（首）r2 屏幕 r3 屏幕（屏幕最近）r4 纸上（判断上的最近一次）
  const draft = {
    records: { '2026-10': [record(1, '人', { day: '2026-10-01' }), record(2, '人', { day: '2026-10-02' }), record(3, '人', { day: '2026-10-03' }), paper(4, '人', { day: DAY })] },
    ink: { '2026-10': { r1: inkEntry(8, 2), r2: inkEntry(8, 2), r3: inkEntry(8, 2) } },
  };
  assert.deepEqual(pruneInkOfCards(draft, ['base:人']).map(d => d.id), ['r2'], 'only the middle screen ink goes');
  assert.deepEqual(Object.keys(flatInk(draft.ink)).sort(), ['r1', 'r3'], 'latest inked (r3) stays although r4 is the latest judgment');
  const index = indexRecords(draft.records);
  assert.equal(inkTier('r3', index, '2026-10'), Infinity);
  assert.equal(inkTier('r1', index, '2026-10'), Infinity);
  // 纸上在先：第一次判断在纸上 → 第一份屏幕墨迹算「第一次」，不被回收
  const first = {
    records: { '2026-10': [paper(1, '口', { day: '2026-10-01' }), record(2, '口', { day: '2026-10-02' }), record(3, '口', { day: '2026-10-03' }), record(4, '口', { day: DAY })] },
    ink: { '2026-10': { r2: inkEntry(8, 2), r3: inkEntry(8, 2), r4: inkEntry(8, 2) } },
  };
  assert.deepEqual(pruneInkOfCards(first, ['base:口']).map(d => d.id), ['r3']);
  recover(first, { now: NOW, force: true, needBytes: 1e9, limit: { inkMonths: ['2026-10'], months: [] } });
  assert.deepEqual(Object.keys(flatInk(first.ink)).sort(), ['r2', 'r4'], 'first + latest inked survive a forced recovery');
});

function makeStore(initialState) {
  const backend = new MemoryStorage();
  const storage = createStorage(backend, { now: () => NOW });
  const store = createStore({ storage, now: () => NOW });
  store.load();
  if (initialState) assert.equal(store.seed(initialState).ok, true);
  return { backend, store };
}

function paperState() {
  const base = baselineState();
  return {
    ...base,
    records: { ...base.records, '2026-10': [paper(7, '人', { day: DAY, judgment: 'wrong' })] },
    settings: { ...base.settings, writeMode: 'paper', paperSuggested: true },
    sessions: { ...base.sessions, B: { ...session(8, { slot: 'B', kind: 'picked', queue: ['base:永'] }), current: { phase: 'compare', strokes: [], hints: 0, answerSeen: false, paper: true } } },
  };
}

test('P166: 备份 v2 信封往返、保护副本——纸上记录与写字方式原样带出、原样恢复', () => {
  const { store } = makeStore(paperState());
  const obj = buildBackupV2(store.getState(), { now: NOW, serial: store.serial });
  const parsed = parseBackupV2(JSON.parse(serializeBackup(obj)));
  assert.equal(parsed.ok, true, parsed.detail);
  assert.equal(JSON.parse(obj.data[recordsKey('2026-10')])[0].source, 'paper');
  assert.equal(JSON.parse(obj.data[KEYS.settings]).writeMode, 'paper');
  const safety = makeSafety(store.getState(), { kind: 'restore', now: NOW, backupDate: DAY, count: 1 });
  assert.equal(validateValue(KEYS.safety, safety), null, 'protection copy (with current.paper session) passes schema');
  const target = makeStore(baselineState()).store;
  const report = inspectBackup(serializeBackup(obj));
  assert.equal(report.ok, true);
  assert.equal(restoreFromBackup(target, report, { now: NOW }).ok, true);
  const restored = target.getState();
  assert.deepEqual(plain(restored.records['2026-10']), plain(store.getState().records['2026-10']));
  assert.equal(restored.settings.writeMode, 'paper');
});
