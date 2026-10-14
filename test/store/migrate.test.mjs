// store/migrate.js（M5-4）：v1 → v2 转换规则（01 §12，P35 / P53 / P07 / P31）、单次 writeAll、失败路径、旧键处理、v1 备份导入。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIGRATION_LABEL, V1_KEYS, bootMigration, canonicalCardKey, convertV1, detectV1, legacyBackupToV2, readV1,
  releaseLegacyKeys, runMigration, spreadLegacyDue, spreadPerDayOf,
} from '../../src/store/migrate.js';
import { createStore } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { estimateUsage, BUDGET_DEFAULTS } from '../../src/store/budget.js';
import { importLegacyBackup, inspectBackup, markExported } from '../../src/core/backup.js';
import { KEYS, V2_PREFIX, parseBackupV2, validateRecordsMonth, validateValue, recordsKey } from '../../src/core/schema.js';
import { localDay, addDays } from '../../src/core/dates.js';
import { decodeInk, isInkV3 } from '../../src/core/ink-math.js';
import * as realPolicy from '../../src/config/policy.js';
import { MemoryStorage } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_DIR = path.join(ROOT, 'scripts/fixtures/legacy-v1');
const BACKUP_TEXT = fs.readFileSync(path.join(FIXTURE_DIR, 'backup-300.json'), 'utf8');
const BACKUP = JSON.parse(BACKUP_TEXT);
const DEVICE_ONLY = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'device-only.json'), 'utf8'));
const NOW = Date.parse('2026-10-01T10:00:00+08:00');
const DAY = 86400000;

function policyWith(migration = {}, features = {}) {
  return {
    ...realPolicy,
    migration: { ...realPolicy.migration, ...migration },
    features: { ...realPolicy.features, ...features },
  };
}

const ev = (i, cardKey, iso, rating, reason, hintCount = 0, extra = {}) => ({
  eventId: `a${i}:fsrs`, attemptId: `a${i}`, cardKey, target: cardKey.slice(-1), reviewedAt: iso, localDay: localDay(Date.parse(iso)),
  rating, reason, hintCount, traced: false, teaching: reason === 'dontKnow', plannedDue: '2026-09-01', ...extra,
});
const card = (dueIso, lastIso) => ({ due: dueIso, stability: 3.2, difficulty: 5.1, elapsed_days: 0, scheduled_days: 3, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: lastIso });

/** 小而全的 v1 值（readV1 之后的形状）。 */
function smallV1() {
  return {
    memory: {
      'base:大': { seen: 2, fast: 1, slow: 1, last: Date.parse('2026-09-10T20:00:00+08:00'), lastOutcome: 'fast', lastHints: 0, traced: false, fsrsCard: card('2026-09-15T12:00:00.000Z', '2026-09-10T12:00:00.000Z'), dueDay: '2026-09-15', pendingLearning: false },
      'base:小': { seen: 1, slow: 1, last: Date.parse('2026-09-11T20:00:00+08:00'), lastOutcome: 'slow', fsrsCard: card('2026-09-12T12:00:00.000Z', '2026-09-11T12:00:00.000Z'), dueDay: null, pendingLearning: true },
      'base:看': { seen: 1, misses: 1, last: Date.parse('2026-09-12T20:00:00+08:00'), lastOutcome: 'miss', fsrsCard: card('2026-09-13T12:00:00.000Z', '2026-09-12T12:00:00.000Z'), pendingLearning: true },
      'base:疑': { seen: 1, hints: 1, last: Date.parse('2026-09-13T20:00:00+08:00'), lastOutcome: 'hinted', fsrsCard: card('2026-09-14T12:00:00.000Z', '2026-09-13T12:00:00.000Z'), pendingLearning: true },
      // 120 天外的字（事件已折叠）：按 memory 合成
      'base:古': { seen: 3, fast: 3, last: Date.parse('2026-03-02T20:00:00+08:00'), lastOutcome: 'fast', lastHints: 1, traced: true, fsrsCard: card('2026-11-20T12:00:00.000Z', '2026-03-02T12:00:00.000Z'), dueDay: '2026-11-20', pendingLearning: false },
      'base:旧': { seen: 1, slow: 1, last: Date.parse('2026-03-03T20:00:00+08:00'), lastOutcome: 'slow', fsrsCard: card('2026-03-04T12:00:00.000Z', '2026-03-03T12:00:00.000Z'), pendingLearning: true },
      'base:忘': { seen: 1, misses: 1, last: Date.parse('2026-03-04T20:00:00+08:00'), lastOutcome: 'miss', fsrsCard: card('2026-03-05T12:00:00.000Z', '2026-03-04T12:00:00.000Z'), pendingLearning: true },
      'base:提': { seen: 1, hints: 1, last: Date.parse('2026-03-05T20:00:00+08:00'), lastOutcome: 'hinted', lastHints: 2, fsrsCard: card('2026-03-06T12:00:00.000Z', '2026-03-05T12:00:00.000Z'), pendingLearning: true },
      // 加字残留：练过（有 fsrsCard + lastEpisode）后又被加字改成 miss
      'base:拍': { seen: 4, fast: 2, misses: 1, last: Date.parse('2026-08-20T13:00:00+08:00'), lastOutcome: 'miss', queuedFront: true, queuedFrontAt: Date.parse('2026-08-20T13:00:00+08:00'), source: 'wild', dueDay: '2026-08-20', pendingLearning: false, lastEpisode: { firstOutcome: 'fast', attempts: 1, assistanceUsed: false, independentlyRecovered: true }, fsrsCard: card('2026-12-01T12:00:00.000Z', '2026-02-01T12:00:00.000Z'), recentInk: { version: 2, day: '2026-02-01', at: 1, dataURL: 'data:image/webp;base64,AAAA', strokes: [[{ x: 0.2, y: 0.3, w: 1, v: 0 }, { x: 0.6, y: 0.3, w: 1.1, v: 0.5 }], [{ x: 0.5, y: 0.1, w: 1 }, { x: 0.5, y: 0.9, w: 1 }]] } },
      // 只被加过、从没练过（旧版 addWord：miss 但没有 FSRS）
      'custom:鱻': { seen: 1, misses: 1, last: Date.parse('2026-05-03T20:00:00+08:00'), lastOutcome: 'miss', queuedFront: true, queuedFrontAt: Date.parse('2026-05-03T20:00:00+08:00'), dueDay: '2026-05-03' },
      'custom:3:骉': { seen: 1, fast: 1, last: Date.parse('2026-06-12T20:00:00+08:00'), lastOutcome: 'fast', fsrsCard: card('2026-06-20T12:00:00.000Z', '2026-06-12T12:00:00.000Z'), dueDay: '2026-06-20' },
    },
    fsrsLog: {
      version: 2,
      events: [
        ev(1, 'base:大', '2026-09-01T12:00:00.000Z', 'Again', 'wrong'),
        ev(2, 'base:大', '2026-09-10T12:00:00.000Z', 'Good', 'independent', 0, { traced: true }),
        ev(3, 'base:小', '2026-09-11T12:00:00.000Z', 'Again', 'wrong', 1),
        ev(4, 'base:看', '2026-09-12T12:00:00.000Z', 'Again', 'dontKnow', 0, { traced: true }),
        ev(5, 'base:疑', '2026-09-13T12:00:00.000Z', 'Again', 'hinted', 0),
        ev(6, 'base:疑', '2026-09-13T12:05:00.000Z', 'Again', 'hinted', 3),
        ev(6, 'base:疑', '2026-09-13T12:05:00.000Z', 'Again', 'hinted', 3), // 重复 eventId
        ev(7, 'legacy:4', '2026-09-13T12:06:00.000Z', 'Good', 'independent'),
        { eventId: 'bad', cardKey: 'base:大', reviewedAt: 'not a date', localDay: '2026-09-13' },
        ev(8, 'custom:骉', '2026-09-14T12:00:00.000Z', 'Good', 'independent'),
      ],
      monthly: { '2026-02': { reviews: 3, good: 3, again: 0, hinted: 0, traced: 0, firstAt: '', lastAt: '', lastReviewByDay: { '2026-02-01': { cardKey: 'base:拍', reviewedAt: '2026-02-01T12:00:00.000Z' } } } },
    },
    wild: { version: 1, captures: { 拍: { day: '2026-08-20', at: Date.parse('2026-08-20T13:00:00+08:00'), dataURL: 'data:image/jpeg;base64,' + 'A'.repeat(400) } }, wishes: { 猋: { day: '2026-09-01', at: 1 } } },
    added: ['鱻', '拍', 'x'],
    custom: ['骉鱻'],
    quality: { 'base:大': { badWord: 1, last: 5 }, 'base:小': { hide: true }, 'base:看': { easy: 1 } },
    library: 'junior',
    sound: { enabled: false, tipShown: true, scene: 'rain' },
    reminder: { enabled: true, permission: 'granted', milestonesShown: [] },
    fontScale: true,
    backupMeta: { lastExportAt: Date.parse('2026-08-01T10:00:00+08:00'), summaryPromptShown: true },
    activity: { version: 2, practiceDays: ['2026-01-05', '2026-09-10', 'bad-day'], daily: {}, monthly: {} },
  };
}

function flatRecords(records) {
  return Object.keys(records).sort().flatMap(m => records[m]);
}

test('canonicalCardKey: base/custom 收敛，旧 custom:<n>: 去序号，legacy / 多字丢弃', () => {
  assert.equal(canonicalCardKey('base:大'), 'base:大');
  assert.equal(canonicalCardKey('custom:12:骉'), 'custom:骉');
  assert.equal(canonicalCardKey('legacy:4'), null);
  assert.equal(canonicalCardKey('base:大小'), null);
  assert.equal(canonicalCardKey(7), null);
});

test('convertV1: 事件 → 记录（Good/wrong/dontKnow；不太确定与 P35 hinted 不生成判断），ids 按时间先后，全部 legacy', () => {
  const { state, report } = convertV1(smallV1(), { now: NOW });
  const recs = flatRecords(state.records);
  for (const m of Object.keys(state.records)) assert.equal(validateRecordsMonth(state.records[m], m), null, `month ${m} valid`);
  assert.deepEqual(recs.map(r => r.id), recs.map((_, i) => `r${i + 1}`), 'ids r1..rN');
  assert.ok(recs.every((r, i) => i === 0 || recs[i - 1].at <= r.at), 'ids follow time');
  assert.ok(recs.every(r => r.legacy === true && !('sessionId' in r)), 'all legacy, no session');
  const of = ch => recs.filter(r => r.char === ch).map(r => r.kind === 'judged' ? r.judgment : r.kind);
  assert.deepEqual(of('大'), ['wrong', 'correct']);
  assert.equal(recs.find(r => r.char === '大' && r.judgment === 'correct').help.traced, true);
  assert.deepEqual(of('小'), ['wrong']);
  assert.equal(recs.find(r => r.char === '小').help.hints, 1);
  assert.deepEqual(of('看'), ['answer-seen']);
  assert.equal(recs.find(r => r.char === '看').help.answerSeen, true);
  assert.deepEqual(of('疑'), [], 'hinted: uncertain and hintCount>0 both produce no judged (P35 none)');
  assert.deepEqual(of('骉'), ['correct'], 'custom:<n>: key converges');
  assert.deepEqual(
    [report.events.total, report.events.correct, report.events.wrong, report.events.answerSeen, report.events.uncertain, report.events.hintedWithHints, report.events.duplicate, report.events.badKey],
    [10, 2, 2, 1, 1, 1, 1, 2],
  );
  assert.equal(report.hintedAs, 'none');
  assert.ok(state.legacy.days.includes(localDay(Date.parse('2026-09-13T12:00:00.000Z'))), 'uncertain day kept in legacy.days');
});

test('convertV1: P35 legacyHintedAs correct / wrong 把 hintCount>0 的 hinted 变成判断（帮助事实照实），hints 照实（D64：不再夹到 2）', () => {
  for (const judgment of ['correct', 'wrong']) {
    const { state } = convertV1(smallV1(), { now: NOW, policy: policyWith({ legacyHintedAs: judgment }) });
    const recs = flatRecords(state.records).filter(r => r.char === '疑');
    assert.deepEqual(recs.map(r => r.judgment), [judgment], `hinted → ${judgment}`);
    assert.equal(recs[0].help.hints, 3, 'hintCount 3 kept (D64 ①: shape max is 64, no longer 2)');
    const synth = flatRecords(state.records).filter(r => r.char === '提');
    assert.deepEqual(synth.map(r => r.judgment), [judgment], 'synthesized hinted follows P35 too');
  }
});

test('convertV1: 有 memory 无事件的字按 memory 合成；加字残留不算练习；从没练过不合成', () => {
  const { state, report } = convertV1(smallV1(), { now: NOW });
  const recs = flatRecords(state.records);
  const one = ch => recs.filter(r => r.char === ch);
  assert.deepEqual(one('古').map(r => [r.judgment, r.help.hints, r.help.traced, r.localDay]), [['correct', 1, true, localDay(Date.parse('2026-03-02T20:00:00+08:00'))]]);
  assert.deepEqual(one('旧').map(r => r.judgment), ['wrong']);
  assert.deepEqual(one('忘').map(r => r.kind), ['answer-seen']);
  assert.deepEqual(one('提'), [], 'synthesized hinted → none');
  const pai = one('拍');
  assert.equal(pai.length, 1);
  assert.equal(pai[0].judgment, 'correct', 'add artifact → last real review from lastEpisode');
  assert.equal(pai[0].at, Date.parse('2026-02-01T12:00:00.000Z'), 'at = fsrsCard.last_review, not the add moment');
  assert.deepEqual(one('鱻'), [], 'added only, never practiced');
  assert.deepEqual(
    [report.synthesized.correct, report.synthesized.wrong, report.synthesized.answerSeen, report.synthesized.hinted, report.synthesized.fromLastReview, report.synthesized.addedOnly],
    [2, 1, 1, 1, 1, 1],
  );

  const off = convertV1(smallV1(), { now: NOW, policy: policyWith({ synthesizeFromMemory: false }) });
  const offRecs = flatRecords(off.state.records);
  assert.equal(offRecs.some(r => ['古', '旧', '拍'].includes(r.char)), false, 'P35 B: no synthesis');
  assert.equal('base:古' in off.state.sched, false, 'and no sched for them (invariant)');
});

test('convertV1: sched 不变式（sched 存在 ⇒ 有 judged 记录）与 due 口径', () => {
  const { state, report } = convertV1(smallV1(), { now: NOW });
  const judged = new Set(flatRecords(state.records).filter(r => r.kind === 'judged').map(r => r.cardKey));
  for (const key of Object.keys(state.sched)) assert.ok(judged.has(key), `sched ${key} has a judged record`);
  assert.equal(validateValue(KEYS.sched, state.sched), null, 'sched shape');
  for (const key of ['base:看', 'base:疑', 'base:忘', 'base:提']) assert.equal(key in state.sched, false, `${key}: no judged → no sched`);
  assert.equal(report.sched.droppedNoJudged, 4);
  assert.equal(state.sched['base:大'].due, '2026-09-15', 'dueDay kept');
  assert.equal(state.sched['base:小'].due, addDays(localDay(NOW), 1), 'pendingLearning → tomorrow');
  assert.equal(state.sched['base:拍'].due, localDay(Date.parse('2026-12-01T12:00:00.000Z')), 'add artifact: due from fsrs card, not the add day');
  assert.equal(state.sched['base:大'].lastJudgedAt, Date.parse('2026-09-10T12:00:00.000Z'));
  assert.equal(state.sched['base:大'].fsrs.last_review, '2026-09-10T12:00:00.000Z');
  const base = Date.parse('2026-09-20T12:00:00+08:00');
  const due = convertV1(smallV1(), { now: NOW, dueBase: base }).state.sched['base:小'].due;
  assert.equal(due, addDays(localDay(base), 1), 'dueBase moves 「明天」');
});

test('convertV1: 照片（沿旧预算）、自选、wordOff、设置（scene 丢弃）、上次导出、练习日', () => {
  const v = smallV1();
  const { state, report } = convertV1(v, { now: NOW, present: Object.values(V1_KEYS).filter(k => k !== V1_KEYS.safety) });
  assert.deepEqual(Object.keys(state.photos), ['拍']);
  assert.equal(validateValue(KEYS.photos, state.photos), null);
  assert.equal(report.photos.wishesDropped, 1);
  assert.deepEqual(state.custom.added.map(a => a.char), ['鱻', '拍'], 'non-CJK dropped');
  assert.equal(state.custom.added[1].at, Date.parse('2026-08-20T13:00:00+08:00'), 'added at = queuedFrontAt');
  assert.deepEqual(state.wordOff, { 'base:大': 5, 'base:小': NOW });
  assert.deepEqual(state.settings, { library: 'core3500', sound: false, remind: { enabled: true, permission: 'granted' }, large: true });
  assert.equal(validateValue(KEYS.settings, state.settings), null);
  assert.equal(report.dropped.soundScene, true);
  assert.deepEqual(state.backupMeta, { lastExportAt: Date.parse('2026-08-01T10:00:00+08:00'), lastExportSig: null });
  assert.ok(state.legacy.days.includes('2026-01-05') && state.legacy.days.includes('2026-02-01'), 'practiceDays ∪ folded months');
  assert.ok(!state.legacy.days.includes('bad-day'));
  assert.equal(validateValue(KEYS.legacy, state.legacy), null);
  assert.ok(report.dropped.keys.includes(V1_KEYS.session) && report.dropped.keys.includes(V1_KEYS.tuning));

  // 缺 added 时按旧版由 custom 词推导
  const noAdded = convertV1({ ...v, added: undefined }, { now: NOW }).state.custom.added.map(a => a.char);
  assert.deepEqual(noAdded, ['骉', '鱻']);

  // 照片预算：≤30 张、合计 ≤420KiB（dataURL.length×2）、单张解码 ≤64KiB、只收 webp/jpeg、字须为汉字
  const caps = {};
  const chars = Array.from('一二三四五六七八九十上下左右中大小多少天地人口手足山水火木金土日月星云风雨');
  chars.forEach((ch, i) => { caps[ch] = { day: '2026-09-01', at: 1000 + i, dataURL: 'data:image/jpeg;base64,' + 'B'.repeat(4000) }; });
  caps['A'] = { day: '2026-09-01', at: 99999, dataURL: 'data:image/jpeg;base64,AAAA' };
  caps['图'] = { day: '2026-09-01', at: 99998, dataURL: 'data:image/png;base64,AAAA' };
  caps['大'] = { day: '2026-09-01', at: 99997, dataURL: 'data:image/jpeg;base64,' + 'C'.repeat(90000) };
  const many = convertV1({ wild: { captures: caps } }, { now: NOW });
  assert.equal(many.report.photos.kept, 30, 'at most 30 photos');
  assert.equal(many.report.photos.evicted, chars.length - 1 - 30 + 3, '大 replaced by an oversized photo; A non-CJK; 图 png');
  assert.ok(!many.state.photos['一'] && many.state.photos['雨'], 'newest kept first');
  const big = {};
  for (let i = 0; i < 10; i += 1) big[chars[i]] = { day: '2026-09-01', at: 10 + i, dataURL: 'data:image/webp;base64,' + 'D'.repeat(60000) };
  const budget = convertV1({ wild: { captures: big } }, { now: NOW });
  assert.equal(budget.report.photos.kept, 3, '420KiB / (60000×2) → 3');
});

test('convertV1: perRecordInk 开启时 recentInk → 最近一次 correct 记录的 v3 墨迹（P31）；关闭时跳过', () => {
  const off = convertV1(smallV1(), { now: NOW, policy: policyWith({}, { perRecordInk: false }) });
  assert.deepEqual(off.state.ink, {});
  assert.equal(off.report.ink.skipped, 1);
  // D27（阶段 1 P1-E3）起默认开启：不传 policy 与显式开启同一结果
  const byDefault = convertV1(smallV1(), { now: NOW });
  assert.equal(byDefault.report.ink.migrated, 1, 'default policy (D27) migrates the v1 recent ink');
  const on = convertV1(smallV1(), { now: NOW, policy: policyWith({}, { perRecordInk: true }) });
  assert.deepEqual(byDefault.state.ink, on.state.ink);
  const target = flatRecords(on.state.records).find(r => r.char === '拍');
  const month = target.localDay.slice(0, 7);
  const ink = on.state.ink[month][target.id];
  assert.ok(isInkV3(ink), 'v3 packed ink');
  assert.equal(validateValue(`shizi.v2.ink.${month}`, on.state.ink[month]), null);
  assert.equal(decodeInk(ink).length, 2, 'two strokes');
  assert.equal(on.report.ink.migrated, 1);
});

test('readV1: 严格模式整单拒绝坏键；宽松模式跳过并登记', () => {
  assert.deepEqual(readV1({ 'shizi.memory.v1': '{"base:大":{}}', 'shizi.quality.v1': '{oops' }, { strict: true }), { ok: false, reason: 'shape', key: 'shizi.quality.v1' });
  assert.deepEqual(readV1({ 'shizi.memory.v1': '[1]' }, { strict: true }), { ok: false, reason: 'shape', key: 'shizi.memory.v1' });
  assert.deepEqual(readV1({ 'shizi.memory.v1': 5 }, { strict: true }), { ok: false, reason: 'value', key: 'shizi.memory.v1' });
  const loose = readV1({ 'shizi.memory.v1': '{}', 'shizi.wild.v1': 'nope', 'shizi.other': '1' });
  assert.deepEqual([loose.ok, loose.present, loose.bad], [true, ['shizi.memory.v1', 'shizi.wild.v1'], ['shizi.wild.v1']]);
});

test('legacyBackupToV2 / importLegacyBackup / inspectBackup：真实 v1 fixture（300 字）→ 合法 v2 备份与报告', () => {
  const r = legacyBackupToV2(BACKUP, { now: NOW });
  assert.equal(r.ok, true);
  const parsed = parseBackupV2(r.backup);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.equal(r.backup.date, BACKUP.date, 'keeps the v1 export date');
  assert.ok(!Object.keys(r.backup.data).some(k => /sessions|funnel|safety/.test(k)), 'no sessions / funnel / safety');
  const state = {};
  for (const [key, raw] of parsed.entries) state[key] = JSON.parse(raw);
  assert.equal(state[KEYS.meta].migratedAt, undefined, 'backup import is not a device migration');
  assert.ok(Object.keys(state[KEYS.photos]).length >= 1, 'photos from wild.captures');
  assert.ok(r.report.events.uncertain > 0 && r.report.events.hintedWithHints > 0, 'fixture has hinted / uncertain events');
  assert.ok(r.report.synthesized.correct > 0 && r.report.synthesized.fromLastReview > 0 && r.report.synthesized.addedOnly > 0, 'fixture exercises synthesis paths');
  assert.equal(r.report.dropped.soundScene, true);
  const judged = new Set();
  for (const key of Object.keys(state)) if (key.indexOf('shizi.v2.records.') === 0) for (const rec of state[key]) if (rec.kind === 'judged') judged.add(rec.cardKey);
  for (const key of Object.keys(state[KEYS.sched])) assert.ok(judged.has(key), `invariant: ${key}`);
  assert.ok(judged.size >= 290, `300 字量级 (${judged.size})`);
  assert.ok(r.report.sched.droppedNoJudged > 0, 'fixture has chars whose only events never produced a judgment');

  const viaCore = importLegacyBackup(BACKUP_TEXT, { now: NOW });
  assert.equal(viaCore.ok, true);
  assert.equal(viaCore.report.records.chars, judged.size);
  const report = inspectBackup(BACKUP_TEXT);
  assert.deepEqual([report.ok, report.fromLegacy, report.version, report.count], [true, true, 2, judged.size]);

  const broken = { ...BACKUP, data: { ...BACKUP.data, 'shizi.memory.v1': '[1,2]' } };
  assert.deepEqual([inspectBackup(JSON.stringify(broken)).reason, inspectBackup(JSON.stringify(broken)).kind], ['shape', 'restoreFailed']);
  assert.equal(legacyBackupToV2({ app: 'shizi', version: 1, data: {} }).reason, 'empty');
  assert.equal(legacyBackupToV2({ app: 'other', version: 1, data: {} }).reason, 'format');
});

// ---------------------------------------------------------------- 设备迁移（store + storage）

function deviceBackend(extra = {}) {
  return new MemoryStorage({ initial: { ...BACKUP.data, ...DEVICE_ONLY, ...extra } });
}

function boot(backend, now = NOW) {
  const clock = () => now;
  const storage = createStorage(backend, { now: clock });
  const store = createStore({ storage, now: clock });
  store.load();
  return { store, storage, clock };
}

function v1Snapshot(backend) {
  const out = {};
  for (const [k, v] of Object.entries(backend.snapshot())) if (k.indexOf(V2_PREFIX) !== 0) out[k] = v;
  return out;
}

test('bootMigration: 一次 writeAll 写全部 v2 键（meta 在数据键之后）、核对 meta.migratedAt、即删大键、其余 v1 键保留', () => {
  const backend = deviceBackend();
  const { store } = boot(backend);
  assert.equal(detectV1(store.storage), true);
  const txnWrites = [];
  const order = [];
  backend.failWhen(({ op, key }) => {
    if (op === 'set' && key === KEYS.txn) txnWrites.push(key);
    if (op === 'set' && key.indexOf(V2_PREFIX) === 0 && key !== KEYS.txn) order.push(key);
    return null;
  });
  const r = bootMigration({ store, now: () => NOW });
  backend.failWhen(null);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.action, 'migrated');
  assert.equal(r.metaVerified, true);
  assert.equal(txnWrites.length, 1, 'exactly one transaction (single writeAll)');
  assert.equal(order[order.length - 1], KEYS.meta, 'meta is written after every data key');
  assert.ok(order.indexOf(KEYS.legacy) < order.indexOf(KEYS.meta));
  const snap = backend.snapshot();
  assert.equal(snap[KEYS.txn], undefined, 'no txn left');
  const meta = JSON.parse(snap[KEYS.meta]);
  assert.equal(meta.migratedAt, NOW);
  assert.equal(meta.serial, store.serial, 'store serial advanced with the migrated ids');
  for (const key of Object.keys(snap)) if (key.indexOf(V2_PREFIX) === 0) assert.equal(validateValue(key, JSON.parse(snap[key])), null, `${key} valid`);
  // 旧键
  assert.deepEqual(r.removed.sort(), ['shizi.corrupt.shizi.topic.v1', 'shizi.safety.v1', 'shizi.session.v1']);
  for (const key of Object.keys(BACKUP.data)) {
    if (key === 'shizi.session.v1') assert.equal(snap[key], undefined);
    else assert.equal(snap[key], BACKUP.data[key], `${key} kept for the rollback window`);
  }
  // 状态与报告
  const state = store.getState();
  const recs = Object.values(state.records).flat();
  const judged = new Set(recs.filter(x => x.kind === 'judged').map(x => x.cardKey));
  for (const key of Object.keys(state.sched)) assert.ok(judged.has(key), `invariant ${key}`);
  assert.equal(state.legacy.report.source, 'device');
  assert.equal(state.funnel.legacyImport.records, recs.length);
  assert.equal(state.sessions, null, 'no session migrated');
  const usage = estimateUsage(Object.entries(snap));
  assert.ok(usage.total < BUDGET_DEFAULTS.totalTargetBytes, `total ${usage.total} < 3.2MiB`);
  // 之后的提交从迁移过的序号接着分配
  const c = store.commit('next', (draft, ctx) => {
    draft.custom = { added: [...draft.custom.added, { char: '新', at: NOW }] };
    ctx.nextId('r');
  });
  assert.equal(c.ok, true);
  assert.equal(store.serial, meta.serial + 1);
  // 再启动：已迁移，不再写
  const again = boot(backend);
  const before = backend.writeCount;
  const r2 = bootMigration({ store: again.store, now: () => NOW + DAY });
  assert.equal(r2.action, 'none');
  assert.deepEqual(r2.released, []);
  assert.equal(backend.writeCount, before, 'no writes on later boots inside the window');
});

test('bootMigration 失败（配额注入）：v1 键完好、没有任何 v2 键、没有 meta；重启可重试', () => {
  for (const inject of [
    s => s.storage.failNextWrite(1, { kind: 'quota' }), // 测试钩子 failNextWrite 路径（txn 写不进）
    s => s.storage.failNextWrite(1, { kind: 'quota', matchKey: KEYS.sched }), // 中途失败 → 已写的 records 回滚
    s => s.storage.failNextWrite(1, { kind: 'quota', matchKey: KEYS.meta }), // 最后一个数据键失败
  ]) {
    const backend = deviceBackend();
    const before = v1Snapshot(backend);
    const env = boot(backend);
    inject(env);
    const r = bootMigration({ store: env.store, now: () => NOW });
    assert.equal(r.ok, false);
    assert.equal(r.error.kind, 'quota');
    assert.equal(r.error.label, MIGRATION_LABEL);
    assert.deepEqual(v1Snapshot(backend), before, 'v1 keys byte-identical (session / safety not deleted)');
    assert.deepEqual(Object.keys(backend.snapshot()).filter(k => k.indexOf(V2_PREFIX) === 0), [], 'no v2 keys, no meta, no txn');
    assert.equal(env.store.getState().meta, null);
    const retry = boot(backend);
    const r2 = bootMigration({ store: retry.store, now: () => NOW + 60000 });
    assert.equal(r2.ok, true, 'retry on next start');
    assert.equal(r2.action, 'migrated');
    assert.equal(JSON.parse(backend.getItem(KEYS.meta)).migratedAt, NOW + 60000);
  }
});

test('迁移不做预算回收（reclaim:false）：真实配额不够时直接失败、不折叠', () => {
  const backend = deviceBackend();
  backend.quotaBytes = backend.usedBytes() + 20000; // 连 records 都写不下
  const env = boot(backend);
  const r = runMigration({ store: env.store, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'quota');
  assert.equal(r.error.recoveredAttempted, false);
  assert.equal(backend.getItem(KEYS.meta), null);
});

test('P53 回退窗口：30 天到期或导出过一次 v2 后删其余 v1 键；窗口内保留', () => {
  const backend = deviceBackend();
  const env = boot(backend);
  assert.equal(bootMigration({ store: env.store, now: () => NOW }).action, 'migrated');
  const inWindow = releaseLegacyKeys({ store: boot(backend).store, now: NOW + 29 * DAY });
  assert.deepEqual(inWindow.released, []);
  assert.notEqual(backend.getItem(V1_KEYS.memory), null);
  const expired = bootMigration({ store: boot(backend).store, now: () => NOW + 30 * DAY });
  assert.equal(expired.action, 'none');
  assert.ok(expired.released.includes(V1_KEYS.memory) && expired.released.includes(V1_KEYS.wild));
  assert.deepEqual(Object.keys(backend.snapshot()).filter(k => k.indexOf(V2_PREFIX) !== 0), [], 'only v2 keys remain');

  // 先到者：窗口内导出一次 v2
  const b2 = deviceBackend();
  const e2 = boot(b2);
  bootMigration({ store: e2.store, now: () => NOW });
  assert.equal(markExported(e2.store, { at: NOW + DAY }).ok, true);
  const released = bootMigration({ store: boot(b2).store, now: () => NOW + 2 * DAY });
  assert.ok(released.released.includes(V1_KEYS.fsrsLog), 'export releases the v1 keys early');
  // 迁移前的 v1 导出时间（早于 migratedAt）不算
  const b3 = deviceBackend();
  const e3 = boot(b3);
  bootMigration({ store: e3.store, now: () => NOW });
  assert.ok(e3.store.getState().backupMeta.lastExportAt < NOW);
  assert.deepEqual(bootMigration({ store: boot(b3).store, now: () => NOW + DAY }).released, []);
});

test('bootMigration: 没有 v1 → none；policy 关闭 → disabled；v2 已有记录却没有 meta → 不覆盖；存储不可用 → 不迁', () => {
  const empty = boot(new MemoryStorage());
  assert.equal(bootMigration({ store: empty.store, now: () => NOW }).action, 'none');
  const disabled = boot(deviceBackend());
  assert.equal(bootMigration({ store: disabled.store, now: () => NOW, policy: policyWith({ importLegacy: false }) }).action, 'disabled');

  const withV2 = deviceBackend({ [recordsKey(localDay(NOW).slice(0, 7))]: JSON.stringify([{ id: 'r1', cardKey: 'base:大', char: '大', sessionId: 's1', kind: 'judged', judgment: 'correct', at: NOW, localDay: localDay(NOW), help: { hints: 0, answerSeen: false, traced: false } }]) });
  const env = boot(withV2);
  const before = withV2.snapshot();
  const r = bootMigration({ store: env.store, now: () => NOW });
  assert.deepEqual([r.ok, r.action, r.reason], [true, 'skipped', 'v2-records']);
  assert.deepEqual(withV2.snapshot(), before);

  const locked = deviceBackend();
  locked.failReads('security');
  const storage = createStorage(locked, { now: () => NOW });
  const store = createStore({ storage, now: () => NOW });
  store.load();
  assert.equal(bootMigration({ store, now: () => NOW }).action, 'unavailable');
});

// ---------------------------------------------------------------- D65 #2：迁移时摊开一次性大量到期的字（P314）

test('spreadLegacyDue: overdue entries spread from today on, at most perDay a day (counting entries already due that day), never earlier, others untouched', () => {
  const e = (due, stability = 5) => ({ fsrs: { stability }, due, lastJudgedAt: 0 });
  const sched = {};
  for (let i = 0; i < 25; i += 1) sched['base:' + String.fromCodePoint(0x4e00 + i)] = e(addDays('2026-10-01', -30 + i), 3 + (i % 4));
  sched['base:未'] = e('2026-10-02');
  sched['base:远'] = e('2026-12-01');
  sched['base:停'] = { ...e('2026-09-01'), stoppedAt: 5 };
  const frozen = JSON.stringify(sched);
  const { sched: out, moved } = spreadLegacyDue(sched, { today: '2026-10-01', perDay: 10 });
  assert.equal(JSON.stringify(sched), frozen, 'pure: input untouched');
  const perDay = new Map();
  for (const [k, v] of Object.entries(out)) {
    if (k === 'base:停') continue;
    perDay.set(v.due, (perDay.get(v.due) || 0) + 1);
    assert.ok(v.due >= sched[k].due, k + ' never moved earlier');
  }
  assert.equal(perDay.get('2026-10-01'), 10);
  assert.equal(perDay.get('2026-10-02'), 10, '9 spread + 未 already due that day');
  assert.equal(perDay.get('2026-10-03'), 6);
  assert.equal(out['base:未'].due, '2026-10-02');
  assert.equal(out['base:远'].due, '2026-12-01');
  assert.equal(out['base:停'].due, '2026-09-01', 'stopped entries are left alone');
  assert.equal(moved, 25, 'every overdue entry got a new day (all were before today)');
  // 最早到期的先排：第一个（逾期 30 天）落在今天，最后一个（逾期 6 天）落在后天
  assert.equal(out['base:' + String.fromCodePoint(0x4e00)].due, '2026-10-01');
  assert.equal(out['base:' + String.fromCodePoint(0x4e00 + 24)].due, '2026-10-03');
  // 字段只改 due，其余原样
  assert.deepEqual({ ...out['base:' + String.fromCodePoint(0x4e00 + 24)], due: null }, { ...sched['base:' + String.fromCodePoint(0x4e00 + 24)], due: null });
  // 不够 perDay 个已到期：不动
  assert.equal(spreadLegacyDue({ 'base:甲': e('2026-09-01') }, { today: '2026-10-01', perDay: 10 }).moved, 0);
  assert.equal(spreadPerDayOf(), 10, 'round(groupSize 20 × 0.5)');
});

test('convertV1: an old user with 60 overdue chars gets them spread over the next days (≤ 10 a day), records and cards unchanged (D65 #2)', () => {
  const today = localDay(NOW);
  const memory = {};
  const events = [];
  for (let i = 0; i < 60; i += 1) {
    const ch = String.fromCodePoint(0x4e00 + 40 + i);
    const key = 'base:' + ch;
    const reviewed = new Date(Date.parse(addDays(today, -40) + 'T12:00:00+08:00') + i * 60000).toISOString();
    const due = addDays(today, -20 + (i % 15));
    memory[key] = {
      seen: 1, fast: 1, last: Date.parse(reviewed), lastOutcome: 'fast', lastHints: 0, traced: false,
      fsrsCard: { due: due + 'T04:00:00.000Z', stability: 5, difficulty: 5, elapsed_days: 1, scheduled_days: 5, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: reviewed },
      dueDay: due, pendingLearning: false,
    };
    events.push({ eventId: `e${i}:fsrs`, attemptId: `e${i}`, cardKey: key, target: ch, reviewedAt: reviewed, localDay: localDay(Date.parse(reviewed)), rating: 'Good', reason: 'independent', hintCount: 0, traced: false, teaching: false, plannedDue: addDays(today, -40) });
  }
  const { state, report } = convertV1({ memory, fsrsLog: { version: 2, events } }, { now: NOW });
  const dues = Object.values(state.sched).map(s => s.due);
  const byDay = new Map();
  for (const d of dues) byDay.set(d, (byDay.get(d) || 0) + 1);
  assert.ok([...byDay.values()].every(n => n <= 10), JSON.stringify([...byDay]));
  assert.equal(dues.filter(d => d <= today).length, 10, 'only 10 left due on the migration day');
  assert.equal(report.sched.spread, 60, 'all were before today: the first 10 move to today, the rest later');
  const noSpread = convertV1({ memory, fsrsLog: { version: 2, events } }, { now: NOW, policy: policyWith({ spreadDuePerDayShare: 0 }) });
  assert.equal(Object.values(noSpread.state.sched).filter(s => s.due <= today).length, 60);
  for (const [k, v] of Object.entries(state.sched)) assert.deepEqual(v.fsrs, noSpread.state.sched[k].fsrs, 'FSRS card unchanged');
  assert.deepEqual(state.records, noSpread.state.records);
});
