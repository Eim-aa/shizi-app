// R3-K1（ADA A3-01 / A3-02 第 4 条建议）：WebKit AX 版式门禁的接线。门禁本身要 Xcode + iOS 模拟器，单独跑（pnpm run verify:webkit-ax），
// 这里只核对它不会悄悄断线：命令在、不进 pnpm test 默认集合；探针是一个能被壳以参数调用的函数表达式、量的是 A3-01 / A3-02 那三件事；
// DEBUG 壳有 probe 阶段（读 Documents/shizi-smoke-probe.js），Release 归档检查把探针的标记也列进「不得出现」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('verify:webkit-ax is its own command and is not part of pnpm test', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['verify:webkit-ax'], 'node scripts/verify-webkit-ax.mjs');
  assert.doesNotMatch(pkg.scripts.test, /webkit-ax/);
});

test('the probe is a single function expression the shell calls with the state name, and checks square grids / overflow / the note slot', () => {
  const src = read('scripts/webkit-ax-probe.js');
  const body = src.replace(/^\s*\/\/.*$/gm, '').trim();
  assert.match(body, /^\(async function probe\(STATE\) \{/);
  assert.match(body, /\}\)$/);
  // 能被 (源码)(参数) 调用：语法上是一个表达式
  assert.doesNotThrow(() => new Function(`return (${src});`));
  for (const name of ['square ', 'stored stroke keeps its aspect', 'text inside viewport', 'button text inside its button',
    'no text element with scrollWidth > clientWidth', 'no overlapping text', 'body does not scroll', 'note slot under the grid and above the foot']) {
    assert.ok(src.includes(`'${name}`), `probe checks 「${name}」`);
  }
  for (const state of ["'write'", "'trace'", "'judge'", "'detail'"]) assert.ok(src.includes(state), `probe state ${state}`);
});

test('the gate runs the three review simulators × L / XXXL / AX3 / AX5 and restores L + light afterwards', () => {
  const src = read('scripts/verify-webkit-ax.mjs');
  for (const udid of ['F1193537-1696-4C87-8094-E6F24E4F220D', '66BBBA9C-B7FB-4DA0-9D1C-08B729304053', '2247F84A-D0D1-4056-A79A-88B772B35DE3']) assert.ok(src.includes(udid));
  assert.match(src, /process\.env\.SIZES \|\| 'normal,xxxl,ax3,ax5'/, 'default covers L, XXXL, AX3, AX5 (K2)');
  for (const [key, size] of [['normal', 'large'], ['xxxl', 'extra-extra-extra-large'], ['ax3', 'accessibility-extra-large'], ['ax5', 'accessibility-extra-extra-extra-large']]) {
    assert.ok(src.includes(`${key}: '${size}'`), `size ${key} → ${size}`);
  }
  assert.match(src, /'content_size', 'large'/);
  assert.match(src, /'appearance', 'light'/);
  assert.match(src, /'-shizi-smoke', '-shizi-smoke-stage', 'probe', '-shizi-probe-arg'/);
  assert.doesNotMatch(src, /simctl[^\n]*erase/, 'never erases a simulator');
});

test('DEBUG shell: probe stage evaluates Documents/shizi-smoke-probe.js; Release archive check lists the probe markers', () => {
  const swift = read('ios/ShiziApp/ShiziApp/NativeSmoke.swift');
  assert.match(swift, /^#if DEBUG/);
  assert.match(swift, /if Self\.nativeSmokeStage == "probe" \{\s*runSmokeProbe\(\)/);
  assert.match(swift, /appendingPathComponent\("shizi-smoke-probe\.js"\)/);
  assert.match(swift, /argumentValue\(after: "-shizi-probe-arg"\)/);
  const archive = read('ios/ShiziApp/scripts/verify-archive.sh');
  assert.match(archive, /"shizi-smoke-probe\.js" "-shizi-probe-arg"/);
});

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
