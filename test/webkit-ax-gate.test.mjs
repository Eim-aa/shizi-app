// R3-K1 / K2：结果行「修改 ›」的盒与热区（网页 CSS，冻结在仓库里）与规范条文。
// B4.9：WebKit AX 版式门禁（verify:webkit-ax、探针、DEBUG 壳的 probe 阶段）随 WKWebView 退役，AX 门禁由 XCUITest AccessibilityAuditTests 接管。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('K2: 结果行「修改 ›」按钮盒不比点击区窄、热区多出的高度只伸向上方（WebKit 下会触发 scrollWidth / 可滚动量）', () => {
  const src = read('src/ui/screens/write/result-row.js');
  const rule = src.match(/^\.sz-line__change\{(.*?)\} \/\*/m);
  assert.ok(rule, 'rule exists');
  assert.match(rule[1], /min-width:\$\{T\.hit\}/, '按钮盒至少 44 宽（xS 下文字更窄时点击区也不伸出按钮盒）');
  assert.match(rule[1], /padding:4px var\(--bx\) 0/, '左右内边距 4：按钮盒 >= 44 宽，上内边距 4 把字抵回行中线');
  assert.match(rule[1], /margin:-4px calc\(-1 \* var\(--bx\)\) 0/, '下外边距 0：热区不伸向下方');
  assert.doesNotMatch(rule[1], /margin:-2px 0/);
});

test('K2: 规范 N3-6 与 §8d 已写明', () => {
  const doc = read('docs/design/交互与动效规范.md');
  assert.match(doc, /\*\*随手指跟手\*\*.*\*\*过阈值（同下「判定取值」）才关闭\*\*/);
  assert.match(doc, /覆盖四档字号\*\*：L、XXXL、AX3、AX5/);
});
