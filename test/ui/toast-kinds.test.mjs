// 提示条只许两种用途（交互与动效规范 F3 / F5，D58；03 P293）：showToast 的 kind 只能是 'failure' | 'undo'；
// 过渡用的 kind:'legacy'（I1 期间登记在交互合规待修清单里的旧调用）在三张卡合并后（R5M）已全部删除，组件也不再放行 'legacy'。旧实现（10650a2）上：showToast 不收 kind，这里的静态扫描找出 10 处无 kind 的调用（红）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkToastKind, showToast, hideToast, TOAST_KINDS } from '../../src/ui/components/Toast.js';
import { PENDING } from '../../scripts/e2e/interaction-pending.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** 找出每一处 showToast( / show( 调用（Toast.js 自身的定义除外），返回 [{file, line, args}]。 */
function toastCalls() {
  const calls = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (rel === 'src/ui/components/Toast.js') continue;
    const text = fs.readFileSync(file, 'utf8').replace(/\/\/[^\n]*/g, '');
    for (const m of text.matchAll(/\b(?:showToast|show)\s*\(/g)) {
      if (!/showToast/.test(m[0]) && !/show = showToast/.test(text)) continue;
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < text.length && depth; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') depth -= 1;
      }
      const args = text.slice(m.index + m[0].length, i - 1);
      if (/^\s*\)?\s*$/.test(args)) continue;
      calls.push({ file: rel, line: text.slice(0, m.index).split('\n').length, args });
    }
  }
  return calls;
}

test('checkToastKind: only failure / undo; anything else (legacy included) throws', () => {
  assert.deepEqual([...TOAST_KINDS], ['failure', 'undo']);
  assert.equal(checkToastKind('failure'), 'failure');
  assert.equal(checkToastKind('undo'), 'undo');
  for (const bad of [undefined, null, '', 'success', 'info', 'saved']) assert.throws(() => checkToastKind(bad), TypeError, String(bad));
  assert.throws(() => checkToastKind('legacy'), TypeError, 'legacy is no longer accepted (R5M)');
  assert.throws(() => checkToastKind('legacy', 'P0-07'), TypeError, 'not even with an audit id');
  assert.throws(() => showToast('存好了。', { kind: 'legacy', audit: 'P0-07' }), TypeError);
  assert.throws(() => showToast('已保存。'), TypeError, 'a success toast without a kind is refused at runtime');
  assert.throws(() => showToast('已保存。', { kind: 'success' }), TypeError);
  const id = showToast('没保存上。', { kind: 'failure' });
  assert.ok(id > 0);
  hideToast();
});

test('every showToast call in src passes kind failure / undo; the pending list is empty', () => {
  assert.deepEqual(Object.keys(PENDING), [], 'interaction pending list is empty after the three cards merged (R5M)');
  const calls = toastCalls();
  assert.ok(calls.length >= 1, `found ${calls.length} calls`);
  for (const c of calls) {
    const kind = /kind:\s*'([a-z]+)'/.exec(c.args);
    assert.ok(kind, `${c.file}:${c.line} showToast without a kind (F3: only failure / undo)`);
    assert.ok(TOAST_KINDS.includes(kind[1]), `${c.file}:${c.line} kind ${kind[1]}`);
  }
});
