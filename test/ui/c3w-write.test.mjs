// R3-C3W 写字页手艺（第三轮审查）的纯逻辑单测：AX3+ 主按钮短文案（P259）。底栏结构的单测在 f1-foot.test.mjs（R4-F1：「⋯」菜单已被文字行取代）。
// 其余条目的单测在各自模块的测试文件里（trace-composite / hint-layer / contrast / compare / write-layout / policy）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { traceDoneLabel } from '../../src/ui/screens/write/answer.js';
import { t } from '../../src/config/copy/index.js';
import * as policy from '../../src/config/policy.js';

test('traceDoneLabel：AX3 起描一遍阶段主按钮用短文案「自己写」，AX1–AX2 与常规字号用长文案（D61 Q13 起与短文案同为「自己写」）（P259）', () => {
  assert.equal(t('X-ANSWER.btnTraceDone'), '自己写'); // D61 Q13：长短两版都叫「自己写」
  assert.equal(t('X-ANSWER.btnTraceDoneShort'), '自己写');
  assert.equal(policy.axShortPrimaryFrom, 3);
  for (const ax of [0, 1, 2]) assert.equal(traceDoneLabel(ax), t('X-ANSWER.btnTraceDone'), `ax ${ax}`);
  for (const ax of [3, 4, 5]) assert.equal(traceDoneLabel(ax), '自己写', `ax ${ax}`);
  assert.equal(traceDoneLabel(), t('X-ANSWER.btnTraceDone'), 'no ax = normal');
});
