// R3-C3W 写字页手艺（第三轮审查）的纯逻辑 / 源码结构单测：AX3+ 主按钮短文案（P259）、常规字号与 AX 同构的底栏（D53 ②，P258）。
// 其余条目的单测在各自模块的测试文件里（trace-composite / hint-layer / contrast / compare / write-layout / policy）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traceDoneLabel } from '../../src/ui/screens/write/answer.js';
import { AxFoot } from '../../src/ui/screens/write/ax-menu.js';
import { Button } from '../../src/ui/components/Button.js';
import { t } from '../../src/config/copy/index.js';
import * as policy from '../../src/config/policy.js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
function walk(node, fn) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, fn)); return; }
  fn(node);
  if (node.props && node.props.children !== undefined) walk(node.props.children, fn);
}

test('traceDoneLabel：AX3 起描一遍阶段主按钮用短文案「自己写」，AX1–AX2 与常规字号仍是「描好了，自己写」（P259）', () => {
  assert.equal(t('X-ANSWER.btnTraceDone'), '描好了，自己写');
  assert.equal(t('X-ANSWER.btnTraceDoneShort'), '自己写');
  assert.equal(policy.axShortPrimaryFrom, 3);
  for (const ax of [0, 1, 2]) assert.equal(traceDoneLabel(ax), '描好了，自己写', `ax ${ax}`);
  for (const ax of [3, 4, 5]) assert.equal(traceDoneLabel(ax), '自己写', `ax ${ax}`);
  assert.equal(traceDoneLabel(), '描好了，自己写', 'no ax = normal');
});

test('AxFoot：保存失败时常规字号把「先不保存」摆成主按钮左边的次按钮（secondary），AX 档不给 secondary、收进菜单', () => {
  const ids = vnode => {
    const out = [];
    walk(vnode, n => { if (n.type === Button) out.push(n.props['data-testid']); });
    return out;
  };
  const two = AxFoot({ primary: { testid: 'write-skip-fail-retry', label: '再试一次', onClick() {} }, secondary: { testid: 'write-skip-fail-cancel', label: '先不保存', onClick() {} }, items: [], failed: true });
  assert.deepEqual(ids(two), ['write-skip-fail-cancel', 'write-skip-fail-retry'], '[先不保存 / 再试一次], no 「⋯」 when there are no items');
  const ax = AxFoot({ primary: { testid: 'write-skip-fail-retry', label: '再试一次', onClick() {} }, items: [{ testid: 'write-skip-fail-cancel', label: '先不保存', onSelect() {} }], failed: true });
  assert.deepEqual(ids(ax), ['write-skip-fail-retry', 'write-more'], 'AX: the cancel item is in the menu');
});

test('写字页底栏所有字号同构（D53 ②）：回忆阶段菜单第一项是「在纸上写」，撤销 / 清空进页头、判断页不渲染，主按钮底线来自 policy.mainButtonLine', () => {
  const src = read('src/ui/screens/write/index.js');
  const iPaper = src.indexOf("items.push({ testid: 'write-to-paper'");
  const iHint = src.indexOf("testid: 'write-hint', label: hm.text");
  const iAns = src.indexOf("items.push({ testid: 'write-show-answer'");
  const iSkip = src.indexOf("items.push({ testid: 'write-skip'");
  assert.ok(iPaper > 0 && iPaper < iHint && iHint < iAns && iAns < iSkip, 'menu order: 在纸上写 / 提示 / 看答案 / 跳过');
  assert.ok(src.includes('<span class="sz-write__headtools">${compare.active ? null : tools}${progress}</span>'), 'undo / clear live in the header, not rendered on the judge page');
  assert.ok(!src.includes('sz-write__links') && !src.includes('write-hint-slot'), 'the old text row under the main button is gone');
  assert.ok(src.includes('calc(env(safe-area-inset-bottom, 0px) + ${policy.mainButtonLine.gapAboveEdge}px)'), 'the foot bottom padding = safe area + the shared main-button line');
  assert.ok(src.includes(':root[data-ax] ${W} .sz-page__foot{padding-bottom:max(8px, env(safe-area-inset-bottom, 0px))}'), 'AX keeps its compact bottom padding (the only exception)');
  assert.equal(policy.mainButtonLine.gapAboveEdge, 24);
  const cmp = read('src/ui/screens/write/compare.js');
  assert.ok(!cmp.includes('sz-write__links--ghost'), 'the judge foot has no ghost text row any more');
  const ans = read('src/ui/screens/write/answer.js');
  assert.ok(!ans.includes('sz-answer__btns sz-answer__btns') && ans.includes('<${AxFoot} primary=${primary} secondary=${secondary}'), 'answer / trace / retrace use the same one-row foot');
});
