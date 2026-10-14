// 每组字数（D65 #2，P03 / P314）：core/group-size.js + 配比按组大小换算（core/mix.js scaledCount）+ settings / 备份。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../src/config/policy.js';
import { dailyReviewCapOf, groupSizeOf, isGroupSizeOption, validGroupSize } from '../../src/core/group-size.js';
import { scaledCount } from '../../src/core/mix.js';
import { selectDaily } from '../../src/core/sessions.js';
import { buildBackupV2 } from '../../src/core/backup.js';
import { KEYS, parseBackupV2, validateValue } from '../../src/core/schema.js';
import { addDays } from '../../src/core/dates.js';
import { rec } from './helpers.mjs';

const TODAY = '2026-09-24';
const K = (s) => [...s].map((c) => 'base:' + c);
const sched = (due, stability = 5) => ({ fsrs: { stability }, due, lastJudgedAt: 0 });
const mix = policy.groupMix;

test('groupSizeOf: 5 / 10 / 20 / 30 kept, anything else (missing, old users, junk) → 20', () => {
  for (const n of [5, 10, 20, 30]) assert.equal(groupSizeOf({ groupSize: n }), n);
  for (const s of [null, undefined, {}, { groupSize: 7 }, { groupSize: '20' }, { groupSize: 0 }]) assert.equal(groupSizeOf(s), 20);
  assert.equal(isGroupSizeOption(10), true);
  assert.equal(isGroupSizeOption(15), false);
  assert.equal(validGroupSize(null), policy.groupSize);
});

test('scaledCount: counts written for groups of 5 scale with size (round, at least 1); the daily review cap follows', () => {
  assert.deepEqual([5, 10, 20, 30].map((s) => scaledCount(mix.newMax, s, mix)), [3, 6, 12, 18]);
  assert.deepEqual([5, 10, 20, 30].map((s) => scaledCount(1, s, mix)), [1, 2, 4, 6]);
  assert.deepEqual([5, 10, 20, 30].map((s) => scaledCount(mix.returnGroupSize, s, mix)), [3, 6, 12, 18]);
  assert.equal(scaledCount(0, 20, mix), 0);
  assert.deepEqual([5, 10, 20, 30].map((s) => dailyReviewCapOf(s)), [30, 60, 120, 180]);
});

test('selectDaily at 20: a fresh user gets a full group; the review/new mix is the 5-char mix × 4', () => {
  const cands = K('甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒');
  // 到期 8 个（p = 8 / 16 = 0.5 → 2 份新字 = 8 个），复习位 12 个、到期只有 8 个 → 提前复习 / 新字补满
  const s = {};
  const records = [];
  const old = '一二三四五六七八';
  [...old].forEach((c, i) => { s['base:' + c] = sched(addDays(TODAY, -1 - (i % 3))); records.push(rec(i + 1, c, 'judged', 'correct', '2026-09-01')); });
  records.push(rec(99, '九', 'judged', 'correct', addDays(TODAY, -1)));
  s['base:九'] = sched(addDays(TODAY, 20));
  const r = selectDaily({ sched: s, records, today: TODAY, newCandidates: cands, groupSize: 20 });
  assert.equal(r.queue.length, 20);
  assert.equal(r.groupSize, 20);
  assert.equal(r.dueKeys.length, 8);
  assert.equal(r.newTarget, 8);
  assert.equal(new Set(r.queue).size, 20);
  // 同样的输入按 5 字一组：p = 8 / 4 = 2 → 1 个新字
  const r5 = selectDaily({ sched: s, records, today: TODAY, newCandidates: cands, groupSize: 5 });
  assert.equal(r5.queue.length, 5);
  assert.equal(r5.newTarget, 1);
});

test('settings.groupSize: schema accepts the four options only; it rides along in backups', () => {
  for (const n of [5, 10, 20, 30]) assert.equal(validateValue(KEYS.settings, { groupSize: n }), null);
  for (const bad of [7, '20', null]) assert.notEqual(validateValue(KEYS.settings, { groupSize: bad }), null, String(bad));
  assert.deepEqual([...policy.groupSizeOptions], [5, 10, 20, 30], 'schema list and policy list agree');
  const file = buildBackupV2({ settings: { groupSize: 10, library: 'core3500' } }, { now: Date.parse('2026-09-24T12:00:00Z') });
  const parsed = parseBackupV2(JSON.parse(JSON.stringify(file)));
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.equal(JSON.parse(file.data[KEYS.settings]).groupSize, 10);
});
