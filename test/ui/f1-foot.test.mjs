// R4-F1（D55，P260 / P261）：写字页求助操作一次点击直达——底栏 = 主按钮 + 一行文字按钮，没有「⋯」菜单。
// 产品负责人真机试用后推翻了 R3-C3W 把「提示 / 看答案 / 跳过」收进菜单（P258）。真实排版（首屏、不相交、一次点击生效）在 scripts/e2e/99-f1-foot.spec.js。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { WriteFoot, Slot, LinkButton } from '../../src/ui/screens/write/foot.js';
import { Button } from '../../src/ui/components/Button.js';
import * as policy from '../../src/config/policy.js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
function walk(node, fn) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, fn)); return; }
  fn(node);
  if (node.props && node.props.children !== undefined) walk(node.props.children, fn);
}

test('WriteFoot：主按钮在前，其下一行文字按钮（write-links），左右两组；没有「⋯」', () => {
  const left = LinkButton({ testid: 'write-hint', label: '提示', onClick() {} });
  const right = LinkButton({ testid: 'write-skip', label: '跳过', onClick() {} });
  const foot = WriteFoot({ primary: { testid: 'write-done', label: '写好了', onClick() {} }, left, right, stage: 'recall' });
  const seen = [];
  walk(foot, n => {
    if (n.type === Button) seen.push([n.props['data-testid'], n.props.variant]);
    if (n.props && n.props['data-testid'] === 'write-links') seen.push(['write-links', 'row']);
  });
  assert.deepEqual(seen, [['write-done', 'primary'], ['write-links', 'row'], ['write-hint', 'text'], ['write-skip', 'text']], 'primary first, then the text row with 提示 on the left and 跳过 at the end');
  assert.ok(!seen.some(([id]) => id === 'write-more'), 'no 「⋯」');
  assert.equal(foot.props['data-stage'], 'recall');
  const slot = Slot({ testid: 'write-hint-slot', cls: 'sz-write__hint', children: null });
  assert.equal(slot.props['data-testid'], 'write-hint-slot');
});

test('写字页回忆阶段底栏：左 提示 / 看答案 / 在纸上写，右端 结束这组（picked）+ 跳过，全是文字行里的槽；没有菜单、没有 write-more / write-ax-menu', () => {
  const src = read('src/ui/screens/write/index.js');
  const iHint = src.indexOf('testid="write-hint-slot"');
  const iAns = src.indexOf('testid="write-answer-slot"');
  const iPaper = src.indexOf('testid="write-paper-slot"');
  const iEnd = src.indexOf('testid="write-end-slot"');
  const iSkip = src.indexOf('testid="write-skip-slot"');
  assert.ok(iHint > 0 && iHint < iAns && iAns < iPaper && iPaper < iEnd && iEnd < iSkip, 'order: 提示 / 看答案 / 在纸上写 | 结束这组 / 跳过');
  assert.match(src, /import \{ LinkButton, Slot, WriteFoot \} from '\.\/foot\.js';/);
  assert.doesNotMatch(src.replace(/\/\/[^\n]*/g, ''), /write-more|write-ax-menu|AxFoot|openAxMenu|noteInMenu/, 'the menu is gone from the write page');
  assert.ok(src.includes('max(8px, env(safe-area-inset-bottom, 0px))'), 'the foot bottom padding is max(8, safe area) again (the main button sits one text row higher than on the home page)');
  assert.ok(!src.replace(/\/\/[^\n]*/g, '').includes('policy.mainButtonLine'), 'the write page no longer uses the single-row main-button line');
});

test('看答案 / 描一遍 / 自己写 / 保存失败：次要操作是文字行里的文字按钮，不进菜单', () => {
  const ans = read('src/ui/screens/write/answer.js');
  assert.match(ans, /import \{ LinkButton, Slot, WriteFoot \} from '\.\/foot\.js';/);
  for (const id of ['write-answer-self', 'write-answer-next', 'write-retrace-trace', 'write-answer-show', 'write-answer-fail-cancel']) {
    assert.ok(ans.includes(`link2('${id}'`), `${id} is a visible text button`);
  }
  assert.ok(ans.includes('<${WriteFoot} primary=${primary} left=${left} right=${right}'), 'answer / trace / retrace share the same foot');
  assert.doesNotMatch(ans.replace(/\/\/[^\n]*/g, ''), /AxFoot|items\b|write-more/);
});

test('判断页底栏留空的文字行占位（两键与写字页主按钮同一个位置），AX 档不占', () => {
  const cmp = read('src/ui/screens/write/compare.js');
  assert.ok(cmp.includes('<div class="sz-write__links sz-write__links--ghost" aria-hidden="true"></div>'));
  const foot = read('src/ui/screens/write/foot.js');
  assert.match(foot, /\.sz-write__links--ghost\{visibility:hidden\}/);
  assert.match(foot, /:root\[data-ax\] \.sz-write__links--ghost\{display:none\}/);
});

test('policy：名义按钮行回到 116（上 12 + 主按钮 54 + 间 6 + 文字行 44），下内边距 max(8, 下安全区)；主按钮底线常量仍是 24（首页用）', () => {
  assert.equal(policy.writeGrid.nominalFoot, 116);
  assert.equal(policy.writeGrid.footBottomMin, 8);
  assert.equal(policy.mainButtonLine.gapAboveEdge, 24);
  assert.deepEqual([...policy.writeGrid.axAux.links], [17, 22], 'P261: the AX text row is capped by tier like the other aux text');
});

test('AX 档文字行字号分层封顶（P261）：AX1–AX2 17pt、AX3–AX5 22pt，与 policy.writeGrid.axAux.links 一致', () => {
  const foot = read('src/ui/screens/write/foot.js');
  const [lo, hi] = policy.writeGrid.axAux.links;
  const LH = { 17: 24, 22: 30 };
  assert.ok(foot.includes(`:root[data-ax] .sz-write__links .sz-btn--text,:root[data-ax] .sz-write__links .sz-nohint{font-size:calc(${lo}px * 1);line-height:${LH[lo]}px}`));
  assert.ok(foot.includes(`{font-size:calc(${hi}px * 1);line-height:${LH[hi]}px}`));
  for (const n of [3, 4, 5]) assert.ok(foot.includes(`:root[data-ax="${n}"] .sz-write__links .sz-btn--text`), `AX${n} uses the upper tier`);
  assert.ok(foot.includes('flex-wrap:wrap'), 'a row that does not fit folds onto the next line (按词折: the Button text goes through Words)');
  assert.match(foot, /\.sz-write__foot\[data-compact="true"\] \.sz-btn--primary\{font-size:calc\(34px \* 1\);line-height:40px;min-height:60px/, 'P261 ②: still too tight → the main button is capped at 34pt (the rule is more specific than ax.js\'s foot rule)');
});

test('ax-menu.js 已删除（写字页不再有菜单，也没有别处复用）', () => {
  assert.ok(!existsSync(new URL('../../src/ui/screens/write/ax-menu.js', import.meta.url)));
  const copy = read('src/config/copy/write.js');
  assert.ok(!copy.includes("'X-WRITE.moreLabel'"), 'the 「更多」 screen-reader label for 「⋯」 is gone');
});
