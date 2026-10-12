// R4-G1（P270）：滑动返回与页头左上键做同一件事——ui/back-action.js 的登记表、根组件门控把「顶层能否返回」算进去、
// 写字页不再整页关掉左缘返回。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backActionAllowed,
  clearBackAction,
  getBackAction,
  resetBackActions,
  runBackAction,
  setBackAction,
  subscribeBackActions,
} from '../../src/ui/back-action.js';
import { backGestureAllowed, createBackGestureSync } from '../../src/ui/router.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('registry: undefined when unregistered (falls back), null disables, a function is what the header button does', () => {
  resetBackActions();
  assert.equal(getBackAction('e1'), undefined);
  assert.equal(backActionAllowed('e1'), true, 'unregistered pages can still go back (router.back fallback)');
  let fell = 0;
  assert.equal(runBackAction('e1', () => { fell += 1; }), true);
  assert.equal(fell, 1, 'fallback ran');

  let ran = 0;
  const fn = () => { ran += 1; };
  setBackAction('e1', fn);
  assert.equal(backActionAllowed('e1'), true);
  assert.equal(runBackAction('e1', () => { fell += 1; }), true);
  assert.deepEqual([ran, fell], [1, 1], 'the registered action ran, not the fallback');

  setBackAction('e1', null);
  assert.equal(backActionAllowed('e1'), false, 'custom lead (「接着写」) → cannot swipe back');
  assert.equal(runBackAction('e1', () => { fell += 1; }), false);
  assert.equal(fell, 1, 'nothing ran');
  resetBackActions();
});

test('registry: listeners hear availability changes only; clear removes only the caller\'s own entry', () => {
  resetBackActions();
  const heard = [];
  const off = subscribeBackActions(id => heard.push(id));
  const a = () => {};
  const b = () => {};
  setBackAction('e2', a);
  setBackAction('e2', b); // 可用 → 可用：不通知
  assert.deepEqual(heard, ['e2'], 'first registration notifies; a swap of function does not');
  setBackAction('e2', null);
  assert.deepEqual(heard, ['e2', 'e2'], 'enabled → disabled notifies');
  clearBackAction('e2', a);
  assert.equal(getBackAction('e2'), null, 'clearing someone else\'s handler is a no-op');
  clearBackAction('e2', null);
  assert.equal(getBackAction('e2'), undefined);
  assert.equal(heard.length, 3, 'clear notifies');
  off();
  setBackAction('e3', a);
  assert.equal(heard.length, 3, 'unsubscribed');
  resetBackActions();
});

test('gate: a sub page whose header has no back button (custom lead) sends false; it flips back to true', () => {
  const sent = [];
  const sync = createBackGestureSync({ send: v => sent.push(v), screenOf: () => ({}) });
  const snap = { stack: [{ k: 's', id: 'e1', n: 'home' }, { k: 's', id: 'e2', n: 'write' }], top: { id: 'e2', n: 'write' } };
  sync.update(snap, false, true);
  sync.update(snap, false, false); // 进判断阶段：左上是「接着写」
  sync.update(snap, false, false);
  sync.update(snap, false, true); // 回到回忆阶段
  assert.deepEqual(sent, [true, false, true], 'sent on each availability change only');
  assert.equal(backGestureAllowed(snap, false, false), false);
  assert.equal(backGestureAllowed(snap, false, true), true);
  assert.equal(backGestureAllowed({ stack: [{ k: 's', id: 'e1', n: 'home' }] }, false, true), false, 'tab root stays false');
});

test('the write screen no longer owns (disables) the back gesture; Page registers its header action', () => {
  const write = readFileSync(join(ROOT, 'src/ui/screens/write/index.js'), 'utf8');
  assert.doesNotMatch(write, /ownsBackGesture:\s*true/, 'write screen does not declare ownsBackGesture');
  assert.doesNotMatch(write, /setBackGestureEnabled\(/, 'write screen does not send backGestureEnabled itself');
  const page = readFileSync(join(ROOT, 'src/ui/components/Page.js'), 'utf8');
  // R5-I2（N3-2）：自定义左上（判断页「‹ 接着写」）也登记它的动作（种类 phase），不再登记 null
  assert.match(page, /const backAction = pageBackAction\(\{ leading, goBack, lead: customLead, onLead \}\);\n  useBackAction\(backAction\.fn, backAction\.kind\);/, 'Page registers the same action as its header element');
});
