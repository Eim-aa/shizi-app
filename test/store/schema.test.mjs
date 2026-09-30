// core/schema.js：键覆盖不变量、各键形状、备份 v2 外壳整单校验。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_EXCLUDED, BACKUP_WHITELIST, DOMAINS, KEYS, KEY_SPECS,
  isBackupKey, isLocalDay, parseAndValidate, parseBackupV2, recordsKey, specForKey, validateRecord, validateValue,
} from '../../src/core/schema.js';
import { baselineState, record, plain } from './helpers.mjs';

test('key coverage invariant: schema key table = backup whitelist ∪ exclusion table, disjoint', () => {
  const ids = KEY_SPECS.map(spec => spec.id).sort();
  const union = BACKUP_WHITELIST.concat(BACKUP_EXCLUDED).sort();
  assert.deepEqual(ids, union, 'every schema key must be listed exactly once in whitelist or exclusion table');
  for (const id of BACKUP_WHITELIST) assert.ok(BACKUP_EXCLUDED.indexOf(id) < 0, `${id} is in both tables`);
  assert.equal(new Set(ids).size, ids.length, 'schema ids unique');
});

test('key coverage invariant: every store domain maps to a schema key, and 01 §3.6 backup column holds', () => {
  for (const domain of DOMAINS) {
    const spec = KEY_SPECS.find(s => s.domain === domain);
    assert.ok(spec, `domain ${domain} has no schema entry`);
  }
  // 01 §3.6：sessions/funnel/safety/txn 不进备份；其余 v2 键进备份。
  assert.deepEqual([...BACKUP_EXCLUDED].sort(), ['funnel', 'safety', 'sessions', 'txn']);
  assert.equal(isBackupKey(KEYS.sessions), false);
  assert.equal(isBackupKey(KEYS.meta), true);
  assert.equal(isBackupKey(recordsKey('2026-09')), true);
  assert.equal(isBackupKey('shizi.corrupt.shizi.v2.meta'), false);
  assert.equal(isBackupKey('shizi.nativeSmoke.v1'), false);
  assert.equal(specForKey('shizi.v2.records.2026-13'), null, 'bad month is not a records key');
  assert.equal(specForKey('shizi.v2.whatever'), null);
});

test('baseline fixture passes every key shape', () => {
  const state = baselineState();
  for (const domain of DOMAINS) {
    if (domain === 'records') {
      for (const month of Object.keys(state.records)) assert.equal(validateValue(recordsKey(month), state.records[month]), null);
    } else if (state[domain] !== null) {
      assert.equal(validateValue(KEYS[domain], state[domain]), null, domain);
    }
  }
});

test('record shape rules (judged needs judgment; char matches cardKey; month ownership; ascending ids)', () => {
  assert.equal(validateRecord(record(1, '人')), null);
  const noJudgment = plain(record(1, '人'));
  delete noJudgment.judgment;
  assert.match(validateRecord(noJudgment), /judgment/);
  assert.match(validateRecord(plain(record(1, '人', { kind: 'skipped', extra: { judgment: 'wrong' } }))), /judgment/);
  assert.match(validateRecord(Object.assign(plain(record(1, '人')), { char: '口' })), /char/);
  assert.match(validateRecord(Object.assign(plain(record(1, '人')), { help: { hints: 3, answerSeen: false, traced: false } })), /hints/);
  assert.match(validateRecord(Object.assign(plain(record(1, '人')), { extraField: 1 })), /unknown field/);
  const noSession = plain(record(1, '人'));
  delete noSession.sessionId;
  assert.match(validateRecord(noSession), /sessionId/);
  assert.equal(validateRecord(Object.assign(noSession, { legacy: true })), null, 'legacy records may lack sessionId');
  assert.match(validateValue(recordsKey('2026-10'), [record(1, '人')]), /not in month/);
  assert.match(validateValue(recordsKey('2026-09'), [record(2, '人'), record(1, '口')]), /ascending/);
  assert.equal(validateValue(recordsKey('2026-09'), [record(1, '𠮷')]), null, 'supplementary-plane char is one char');
  assert.equal(isLocalDay('2026-02-30'), false);
  assert.equal(isLocalDay('2028-02-29'), true);
});

test('folded month shape', () => {
  const folded = { folded: true, month: '2025-01', byDay: { '2025-01-03': ['人'] }, chars: ['人'], kept: [record(1, '人', { day: '2025-01-03' })] };
  assert.equal(validateValue(recordsKey('2025-01'), folded), null);
  assert.match(validateValue(recordsKey('2025-02'), folded), /month/);
});

test('session shape: slot/kind pairing, cursor bound', () => {
  const s = baselineState().sessions;
  assert.equal(validateValue(KEYS.sessions, s), null);
  const bad = plain(s);
  bad.A.kind = 'picked';
  assert.match(validateValue(KEYS.sessions, bad), /slot A/);
  const bad2 = plain(s);
  bad2.A.cursor = 99;
  assert.match(validateValue(KEYS.sessions, bad2), /cursor/);
});

test('parseAndValidate: invalid JSON and bad shape are reported', () => {
  assert.equal(parseAndValidate(KEYS.meta, '{').ok, false);
  assert.equal(parseAndValidate(KEYS.meta, JSON.stringify({ schema: 1, serial: 0, createdAt: 1, months: [] })).ok, false);
  assert.equal(parseAndValidate(KEYS.meta, JSON.stringify({ schema: 2, serial: 0, createdAt: 1, months: [] })).ok, true);
});

function backupOf(state) {
  const data = {};
  for (const domain of BACKUP_WHITELIST) {
    if (domain === 'records') for (const m of Object.keys(state.records)) data[recordsKey(m)] = JSON.stringify(state.records[m]);
    else if (state[domain] !== null) data[KEYS[domain]] = JSON.stringify(state[domain]);
  }
  data[KEYS.sessions] = JSON.stringify(state.sessions);
  return { app: 'shizi', version: 2, date: '2026-09-15T01:00:00.000Z', data };
}

test('backup v2 envelope: good file parses, sessions ignored', () => {
  const parsed = parseBackupV2(backupOf(baselineState()));
  assert.equal(parsed.ok, true);
  assert.ok(parsed.ignored.indexOf(KEYS.sessions) >= 0);
  assert.ok(parsed.entries.every(([key]) => isBackupKey(key)));
});

test('backup v2 envelope: any single bad key rejects the whole file', () => {
  const base = backupOf(baselineState());
  for (const key of Object.keys(base.data)) {
    if (!isBackupKey(key)) continue;
    const broken = plain(base);
    broken.data[key] = '{"not":"the right shape"}';
    const parsed = parseBackupV2(broken);
    assert.equal(parsed.ok, false, `${key} broken should reject`);
    assert.equal(parsed.key, key);
    assert.equal(parsed.entries, undefined, 'no partial result');
    const notJson = plain(base);
    notJson.data[key] = '{oops';
    assert.equal(parseBackupV2(notJson).ok, false);
    const notString = plain(base);
    notString.data[key] = { raw: true };
    assert.equal(parseBackupV2(notString).reason, 'value');
  }
  assert.equal(parseBackupV2({ app: 'shizi', version: 1, data: {} }).reason, 'v1');
  assert.equal(parseBackupV2({ app: 'other', version: 2, data: {} }).reason, 'format');
  const noMeta = plain(base);
  delete noMeta.data[KEYS.meta];
  assert.equal(parseBackupV2(noMeta).reason, 'empty');
});
