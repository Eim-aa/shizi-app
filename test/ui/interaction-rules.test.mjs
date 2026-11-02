// 交互合规的单测侧（交互与动效规范 §8b，D58 ⑥；03 P294）：
//   · Page 收到 lead 时仍登记返回动作（N3-2）——审计 P0-01 归卡 I2，未修前按待修清单跳过并打印；
//   · COMMIT_FEEDBACK 与规范 F1 表一致；页面直接发的触觉点位在 F1 表里；
//   · Swift BackGestureThreshold 与 tokens.json gesture 逐值一致；
//   · 待修清单里每一条都在审计清单里、都属于别的卡（I1 自己的条目不许挂在清单上）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMIT_FEEDBACK, HAPTIC_KINDS } from '../../src/platform/haptics.js';
import { M } from '../../src/config/motion.js';
import { PENDING, pendingFor, logPending } from '../../scripts/e2e/interaction-pending.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tokens = JSON.parse(read('docs/design/design-system-v1/tokens.json'));

test('N3-2: Page registers its back action even with a custom lead (pending P0-01 until card I2 lands)', t => {
  const page = read('src/ui/components/Page.js');
  const blocked = /useBackAction\(customLead[^)]*\? null/.test(page);
  const hits = pendingFor('IC-02', { phases: ['compare'] });
  if (blocked && hits.length) {
    logPending(m => t.diagnostic(m), 'IC-02', hits, 'Page.js lead → useBackAction(null)');
    t.skip('pending P0-01 (I2)');
    return;
  }
  assert.equal(blocked, false, 'a custom lead must not turn the back gesture off (N3-2); useBackAction(null) only on tab roots / the block page');
});

test('F1: the commit → haptic table is exactly the spec (judge / light / select); every page-level haptic is an F1 kind', () => {
  assert.deepEqual([...HAPTIC_KINDS].sort(), ['judge', 'light', 'seal', 'select']);
  const want = {
    'write:judge': 'judge', 'write:correct': 'judge', 'result:correct': 'judge',
    hint: 'select', 'write:answer-trace': 'select', 'write:answer-retrace': 'select', 'write:answer-next': 'select',
    'write:skip': 'select', 'write:skip-undo': 'select', 'result:skip-undo': 'select',
    'write:answer-seen': 'light', 'write:answer-answer': 'light',
  };
  assert.deepEqual(Object.fromEntries(Object.entries(COMMIT_FEEDBACK).map(([k, v]) => [k, v.haptic])), want);
  for (const [k, v] of Object.entries(COMMIT_FEEDBACK)) {
    if (v.sound) assert.equal(v.haptic, 'judge', `${k}: the judge sound only rides with the judge haptic (F2)`);
  }
  // 页面直接发的点位（不写记录的操作）：写好了 light、结束这组（有判断）light、落印 seal；别处（字库 / 详情 / 我的 / 设置 / 图片）不发（F1-4）
  assert.match(read('src/ui/screens/write/index.js'), /haptic\('light'\); \/\/ F1：「写好了」/);
  assert.match(read('src/ui/screens/write/end.js'), /if \(result\.judgedCount > 0\) \{\n\s*haptic\('light'\)/);
  assert.match(read('src/ui/screens/result/work.js'), /haptic\('seal'\)/);
  for (const dir of ['src/ui/screens/library', 'src/ui/screens/detail', 'src/ui/screens/mine', 'src/ui/components']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter(n => n.endsWith('.js'))) {
      assert.doesNotMatch(read(`${dir}/${f}`), /\bhaptic\(/, `${dir}/${f}: no haptics outside the writing flow (F1-4)`);
    }
  }
});

test('gesture: Swift BackGestureThreshold equals tokens.json gesture value by value', () => {
  const swift = read('ios/ShiziApp/ShiziApp/RootViewController.swift');
  const body = /enum BackGestureThreshold \{([\s\S]*?)\n\}/.exec(swift)[1];
  const num = name => Number(new RegExp(`static let ${name}: CGFloat = ([-\\d. /]+)\\n`).exec(body)[1].split('/').map(Number).reduce((a, b) => a / b));
  assert.ok(Math.abs(num('commitRatio') - tokens.gesture.commitRatio) < 5e-4);
  assert.equal(num('commitVelocity'), tokens.gesture.commitVelocity);
  assert.equal(num('returnVelocity'), tokens.gesture.returnVelocity);
  assert.equal(num('marginWidth'), tokens.gesture.edgeZoneNative);
  assert.equal(num('marginSlope'), tokens.gesture.marginSlope);
  assert.equal(M.gesture.edgeZoneWeb, tokens.gesture.edgeZoneWeb);
});

test('pending list: every entry is an audit id in the checklist, owned by another card, with assertions and a reason', t => {
  const audit = read('docs/design/交互规范-审计清单.md');
  for (const [id, p] of Object.entries(PENDING)) {
    assert.match(id, /^P[0-2]-\d\d$/);
    assert.ok(audit.includes(`| ${id} |`), `${id} is in the audit checklist`);
    assert.ok(['I2', 'I3'].includes(p.card), `${id}: pending items belong to I2 / I3, not I1`);
    assert.ok(Array.isArray(p.ic) && p.ic.length && p.ic.every(x => /^IC-\d\d$/.test(x)), id);
    assert.ok(p.why && p.why.length >= 4, id);
  }
  t.diagnostic(`interaction pending list: ${Object.keys(PENDING).join(', ') || '(empty)'}`);
  // R5M：三张卡合并后清单为空，任何断言都不再跳过
  assert.deepEqual(Object.keys(PENDING), [], 'the pending list is empty');
  assert.deepEqual(pendingFor('IC-12', { copy: ['X-WORK.saved'] }), []);
  assert.deepEqual(pendingFor('IC-10', { screens: ['write'] }), []);
});
