// D66 ③ 重写错字页：入口的字表整理、页面本身不碰存储（只读源码约束 + 参数过滤）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setCardResolver } from '../../src/data/deck.js';
import { redoCharsOf, openRedo, REDO_SCREEN } from '../../src/ui/screens/write/redo.js';
import { t } from '../../src/config/copy/index.js';

setCardResolver(key => (['base:永', 'base:和', 'base:春'].includes(key) ? { key, target: key.slice(5), chars: [key.slice(5)], py: 'x', word: key.slice(5), ci: 0 } : null));

test('redoCharsOf: single practicable han chars, in order, no duplicates; junk is dropped', () => {
  assert.deepEqual(redoCharsOf({ chars: ['永', '和', '永', '春'] }), ['永', '和', '春']);
  assert.deepEqual(redoCharsOf({ chars: ['永', 'ab', '', '龘', 3, null, '永和'] }), ['永'], 'not practicable / not a single char / not a string');
  assert.deepEqual(redoCharsOf({}), []);
  assert.deepEqual(redoCharsOf(null), []);
  assert.deepEqual(redoCharsOf({ chars: '永' }), [], 'chars must be a list');
});

test('openRedo: nothing to redo → does not push', () => {
  assert.equal(openRedo([]), false);
  assert.equal(openRedo(['龘']), false, 'not practicable');
  assert.equal(REDO_SCREEN, 'redo');
});

test('the redo page is practice only: it never touches the store (no commit / getStore / sessions / records) and sticks to copy keys', () => {
  const src = readFileSync(new URL('../../src/ui/screens/write/redo.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /store\.commit|getStore|setInk|\.commit\(/, 'no write, no read of the store: the practice leaves nothing behind');
  assert.doesNotMatch(code, /sessions|records|sched/, 'nothing about sessions / records / schedule');
  for (const key of ['X-REDO.title', 'X-REDO.note', 'X-REDO.again']) assert.ok(code.includes(`'${key}'`), `${key} is used`);
  assert.equal(t('X-REDO.title'), '重写错字');
  assert.ok(Array.from(t('X-REDO.title')).length <= 6, 'the name stays within 6 characters (D61)');
});

test('the redo page is not restorable after a cold start (it lives in memory only)', async () => {
  const { RESTORE_GUARDS } = await import('../../src/ui/route-memory.js');
  assert.equal(RESTORE_GUARDS.redo(), false);
});
