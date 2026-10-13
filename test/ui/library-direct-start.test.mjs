// I3 · P0-05 / P0-06 / P1-17（规范 B3，D58 ⑤）：字库「练这些字」一次点击直接开始一组，选的就是清单页默认勾选的那些字；
// 清单页的入口改名「看这些字 ›」，是去处不是动作。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFSRSGlobal, rec } from '../core/helpers.mjs';
import { startListDefault } from '../../src/ui/screens/library/list.js';
import { listModel } from '../../src/ui/screens/library/list-model.js';
import { t } from '../../src/config/copy/index.js';
import * as policy from '../../src/config/policy.js';

loadFSRSGlobal();

const TODAY = '2026-09-30';
const CHARS = [...'永和春大山中人天'];
const cardFor = key => ({ word: key.slice(5) });
const practicable = key => key.startsWith('base:');

function stateWrong(chars) {
  const records = chars.map((ch, i) => rec(i + 1, ch, 'judged', 'wrong', `2026-09-${String(10 + i).padStart(2, '0')}`));
  const byMonth = { '2026-09': records };
  return { records: byMonth, sched: {}, sessions: { A: null, B: null, lastEnded: {} }, ink: {} };
}

test('startListDefault: starts the default selection (the first listDefaultSelect practicable chars) with the list as the source — no list page in between', () => {
  const state = stateWrong(CHARS);
  const expected = listModel(state, { kind: 'wrong', sel: null, today: TODAY, policy, cardFor, practicable }).selectedKeys;
  assert.equal(expected.length, policy.listDefaultSelect, 'default N comes from policy.listDefaultSelect');
  const calls = [];
  const result = startListDefault('wrong', { state, today: TODAY, cardFor, practicable, start: (keys, opts) => { calls.push({ keys, opts }); return { ok: true, started: true }; } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1, 'exactly one start call for one tap');
  assert.deepEqual(calls[0].keys, expected);
  assert.deepEqual(calls[0].opts, { source: { view: 'wrongList' } });
});

test('startListDefault: forget uses the forgetList source; an empty list starts nothing and reports a failure the caller can show', () => {
  const calls = [];
  const none = startListDefault('forget', { state: stateWrong([]), today: TODAY, cardFor, practicable, start: () => { calls.push(1); return { ok: true }; } });
  assert.equal(none.ok, false);
  assert.equal(calls.length, 0);
});

test('failure of the start is passed back untouched (the screen keeps its place and says so)', () => {
  const r = startListDefault('wrong', { state: stateWrong(CHARS), today: TODAY, cardFor, practicable, start: () => ({ ok: false, error: { kind: 'write' } }) });
  assert.deepEqual(r, { ok: false, error: { kind: 'write' } });
});

test('copy: the written-chars entry is 「全部 ›」 (a place); the zone page action stays 「练这些字」', () => {
  assert.equal(t('X-LIBFOUR.writtenAll'), '全部 ›');
  assert.equal(t('R-E02.btnMany'), '练这些字');
  assert.equal(t('X-ALL.viewThese'), '看这些字 ›');
});

test('library home (D60): a zone row opens the zone list; 今天要写 calls the home main-button function with the library as source', () => {
  const src = readFileSync(new URL('../../src/ui/screens/library/index.js', import.meta.url), 'utf8');
  assert.match(src, /data-testid="library-zone"[^>]*\n?[^>]*onClick=\$\{\(\) => openList\(zone\.kind\)\}/);
  assert.match(src, /startMain\(\{ source: LIBRARY_TODAY_SOURCE \}\)/);
  assert.match(src, /import \{ startMain \} from '\.\.\/home\/index\.js'/);
  assert.doesNotMatch(src, /startListDefault|library-card-practice|library-wall/);
});
