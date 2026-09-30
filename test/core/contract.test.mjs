// 契约测试：core（M0-6）产出的记录 / 会话 / 调度项必须通过 store 形状表（src/core/schema.js，M0-5）。
// schema.js 对未知字段一律拒绝，所以这里能抓住两边字段漂移。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord as schemaRecord, validateValue, recordsKey, KEYS } from '../../src/core/schema.js';
import { makeRecord, correctRecord } from '../../src/core/records.js';
import {
  emptySessions,
  createSession,
  withCurrent,
  advance,
  undoSkip,
  startInSlot,
  endSlot,
  endAndStartPicked,
  expireDaily,
  markLineChanged,
} from '../../src/core/sessions.js';
import { applyJudgment, replay } from '../../src/core/fsrs.js';
import { loadFSRSGlobal, at, policyWith } from './helpers.mjs';

loadFSRSGlobal();
const TODAY = '2026-09-24';
const K = (s) => [...s].map((c) => 'base:' + c);

test('contract: records built and corrected by core pass the schema', () => {
  const judged = makeRecord({ id: 'r1', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'wrong', at: at(TODAY, 20), help: { hints: 2, traced: false } });
  const seen = makeRecord({ id: 'r2', cardKey: 'base:亦', sessionId: 's1', kind: 'answer-seen', at: at(TODAY, 20, 1) });
  const skipped = makeRecord({ id: 'r3', cardKey: 'base:慢', sessionId: 's1', kind: 'skipped', at: at(TODAY, 20, 2) });
  const corrected = correctRecord(judged, 'correct', at(TODAY, 20, 5));
  for (const r of [judged, seen, skipped, corrected]) assert.equal(schemaRecord(r), null, JSON.stringify(schemaRecord(r)));
  assert.equal(validateValue(recordsKey('2026-09'), [judged, seen, skipped]), null);
});

test('contract: sched entries from applyJudgment / replay pass the schema', () => {
  const r1 = makeRecord({ id: 'r1', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'correct', at: at('2026-09-01', 20) });
  const r2 = makeRecord({ id: 'r2', cardKey: 'base:静', sessionId: 's2', kind: 'judged', judgment: 'wrong', at: at(TODAY, 20) });
  const first = applyJudgment(undefined, r1);
  const second = applyJudgment(first.entry, r2);
  const fixed = replay(second.fsrsBefore, [correctRecord(r2, 'correct', at(TODAY, 21))]);
  const sched = { 'base:静': fixed, 'base:亦': applyJudgment(undefined, { ...r1, id: 'r3', cardKey: 'base:亦', char: '亦' }).entry };
  assert.equal(validateValue(KEYS.sched, sched), null, JSON.stringify(validateValue(KEYS.sched, sched)));
});

test('contract: sessions through their whole lifecycle pass the schema', async () => {
  const check = (sessions, label) => {
    const err = validateValue(KEYS.sessions, sessions);
    assert.equal(err, null, label + ': ' + JSON.stringify(err));
  };
  let sessions = emptySessions();
  check(sessions, 'empty');
  const r1 = makeRecord({ id: 'r2', cardKey: 'base:静', sessionId: 's1', kind: 'judged', judgment: 'wrong', at: at(TODAY, 8) });
  const { fsrsBefore } = applyJudgment(undefined, r1);
  let a = createSession({ id: 's1', kind: 'daily', source: { view: 'home' }, queue: K('静亦慢'), at: at(TODAY, 8) });
  a = withCurrent(a, { strokes: [[1, 2, 3]], hints: 1, hintRange: { from: 0, count: 1, index: 1 } }, at(TODAY, 8, 1));
  sessions = startInSlot(sessions, a);
  check(sessions, 'A started with current');
  a = advance(sessions.A, { cardKey: 'base:静', recordId: 'r2', kind: 'judged', fsrsBefore, at: at(TODAY, 8, 2) });
  a = markLineChanged(a, 'r2');
  a = advance(a, { cardKey: 'base:亦', recordId: 'r3', kind: 'skipped', at: at(TODAY, 8, 3) });
  a = undoSkip(a, 'r3', at(TODAY, 8, 4));
  sessions = { ...sessions, A: a };
  check(sessions, 'A advanced');
  let b = createSession({ id: 's4', kind: 'picked', source: { view: 'detail', char: '鲜' }, queue: K('鲜境'), at: at(TODAY, 9) });
  b = advance(b, { cardKey: 'base:鲜', recordId: 'r5', kind: 'answer-seen', at: at(TODAY, 9, 1) });
  sessions = startInSlot(sessions, b);
  check(sessions, 'A + B');
  const s02 = endAndStartPicked(sessions, createSession({ id: 's6', kind: 'picked', source: { view: 'wrongList' }, queue: K('额'), at: at(TODAY, 10) }), { at: at(TODAY, 10) });
  check(s02.sessions, 'after S02');
  check(endSlot(s02.sessions, 'A', { at: at(TODAY, 11), early: true }), 'A ended');
  const yesterday = { ...s02.sessions, A: createSession({ id: 's7', kind: 'daily', queue: K('主'), at: at('2026-09-23', 8) }) };
  check(expireDaily(yesterday, TODAY).sessions, 'expired (discard)');
  check(expireDaily(yesterday, TODAY, await policyWith({ dailyExpiry: 'result' })).sessions, 'expired (result)');
});

test('contract: cards.js placeholder prompt copy (M0-2) equals the copy table', async () => {
  const { PROMPT_COPY } = await import('../../src/core/cards.js');
  const { t } = await import('../../src/config/copy/index.js');
  assert.equal(PROMPT_COPY.repeatInstruction, t('R-W28.repeatBlankNote'));
  assert.equal(PROMPT_COPY.fallbackHint, t('X-PROMPT.fallbackHint'));
  assert.equal(PROMPT_COPY.repeatBlankLabel, t('X-PROMPT.repeatBlankLabel'));
});
