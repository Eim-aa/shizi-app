// R2-X1（D51 ⑦，P225）：写字页 AX 专属版式的静态检查——底栏「主按钮 + ⋯」的结构、题面 AX 规则（汉字放大、辅助字封顶）、
// 进度的读屏名称、策略取值。AX 档书写格尺寸的纯函数测试在 write-layout.test.mjs，真实排版（首屏、不滚动）在 scripts/e2e/82–84-x1-write-ax-*.spec.js（共用 x1-write-ax.mjs）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as policy from '../../src/config/policy.js';
import { AxFoot } from '../../src/ui/screens/write/ax-menu.js';
import { Button } from '../../src/ui/components/Button.js';
import { t } from '../../src/config/copy/index.js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

function walk(node, fn) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(n => walk(n, fn));
    return;
  }
  fn(node);
  if (node.props && node.props.children !== undefined) walk(node.props.children, fn);
}

test('policy.writeGrid (P225 / P243): AX floor 220, note slot ≥ 56, tiered aux caps, prompt scale cap 1.6; the old AX toolsHeight is gone', () => {
  const g = policy.writeGrid;
  assert.equal(g.axMin, 220);
  assert.equal(g.axNoteHeight, 56);
  assert.ok(!('axAuxMax' in g), 'R3-K1 P243: the flat 17pt cap is replaced by tiers');
  assert.deepEqual(g.axAux, { pinyin: [22, 28], note: [17, 22], progress: [17, 22], title: [17, 22], paper: [22, 28] });
  assert.equal(g.axPromptScaleMax, 1.6);
  assert.ok(!('toolsHeightAx' in g), 'AX tools moved to the header: no AX tools row any more');
  assert.equal(g.min, 258, 'xS–XXXL keep the 258 floor');
});

test('AxFoot: one row — the primary button plus 「⋯」 (aria-label 更多); with no items the primary button stands alone', () => {
  const buttons = [];
  walk(AxFoot({ primary: { testid: 'write-done', label: '写好了', onClick: () => {} }, items: [{ testid: 'write-skip', label: '跳过', onSelect: () => {} }], stage: 'recall' }), n => {
    if (n.type === Button) buttons.push(n.props);
  });
  assert.deepEqual(buttons.map(b => b['data-testid']), ['write-done', 'write-more']);
  assert.equal(buttons[0].variant, 'primary');
  assert.equal(buttons[1]['aria-label'], t('X-WRITE.moreLabel'));
  assert.equal(buttons[1]['aria-haspopup'], 'dialog');
  const alone = [];
  walk(AxFoot({ primary: { testid: 'write-answer-next', label: '下一个', onClick: () => {} }, items: [] }), n => {
    if (n.type === Button) alone.push(n.props['data-testid']);
  });
  assert.deepEqual(alone, ['write-answer-next']);
});

test('prompt.js AX rules: the cell grows with min(--k, 1.6) (the word is the biggest thing), pinyin / hint line are capped by tier (P243)', () => {
  const src = read('src/ui/screens/write/prompt.js');
  assert.match(src, /:root\[data-ax\] \.sz-prompt\{--cw:calc\(52px \* min\(var\(--k\), \$\{AX_SCALE_MAX\}\)\)\}/);
  assert.match(src, /const AX_SCALE_MAX = policy\.writeGrid\.axPromptScaleMax;/);
  assert.match(src, new RegExp(`:root\\[data-ax\\] \\.sz-prompt__py\\{font-size:calc\\(${policy.writeGrid.axAux.pinyin[0]}px \\* 1\\)`));
  assert.match(src, new RegExp(`:root\\[data-ax\\] \\.sz-prompt__hint\\{[^}]*font-size:calc\\(${policy.writeGrid.axAux.note[0]}px \\* 1\\)`));
  assert.ok(!/--cw:64px/.test(src), 'the old 64px AX cell is gone');
});

test('write/index.js AX rules: progress / notes capped at 17pt, undo + clear icons 28pt in the header, the title never wraps into its own row', () => {
  const src = read('src/ui/screens/write/index.js');
  assert.match(src, /\.sz-write__progress\{font-size:calc\(17px \* 1\);line-height:24px\}/);
  assert.match(src, /\.sz-write__axhead \.sz-write__ibtn svg\{width:28px;height:28px\}/);
  assert.match(src, /\.sz-page__head\{flex-wrap:nowrap\}/);
  assert.match(src, /role="img"\s+aria-label=\$\{t\('R-W01\.progressLabel'/, 'A2-09: the counter has a screen-reader name, not a slash');
});

test('copy: the progress reads 「第 n 个字，共 m 个」 for screen readers (A2-09)', () => {
  assert.equal(t('R-W01.progressLabel', { n: 2, total: 5 }), '第 2 个字，共 5 个');
  assert.equal(t('R-W01.progress', { n: 2, total: 5 }), '2 / 5', 'the visible text is unchanged');
});
