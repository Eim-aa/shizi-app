// P1-E1a：结果 / 详情 / 记录页的原生 <button> 字帖格补按压反馈——与 Button 同一机制（pressFeedbackHandlers → data-pressed），
// 样式里有对应的 [data-pressed]。真实按下 / 松手由 e2e 65-p0a-shell 在浏览器里验证（阶段 0 遗留，D43）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('native <button> cells (sz-dcell / sz-scell) get the same pointer press handlers and a [data-pressed] style', () => {
  const cells = [
    ['src/ui/screens/detail/records.js', 'sz-dcell'],
    ['src/ui/screens/mine/records.js', 'sz-scell'],
  ];
  for (const [file, cls] of cells) {
    const src = read(file);
    assert.match(src, /import \{[^}]*pressFeedbackHandlers[^}]*\} from '\.\.\/\.\.\/components\/Button\.js'/, `${file} imports pressFeedbackHandlers`);
    assert.match(src, /const CELL_PRESS = pressFeedbackHandlers\(/, `${file} builds the handlers once`);
    assert.match(src, new RegExp(`class="${cls}" \\.\\.\\.\\$\\{CELL_PRESS\\}`), `${file}: <button class="${cls}"> spreads the handlers`);
    assert.match(src, new RegExp(`\\.${cls}\\[data-pressed\\]\\{background:\\$\\{T\\.field\\}\\}`), `${file}: .${cls}[data-pressed] style`);
  }
});

test('Button press styles: scale from the token, primary → --btn-down, secondary → --field, reduced motion keeps the scale', () => {
  const src = read('src/ui/components/Button.js');
  assert.match(src, /\.sz-btn\[data-pressed\]\{transform:scale\(\$\{T\.pressScale\}\)/);
  assert.match(src, /\.sz-btn--primary\[data-pressed\]\{background:\$\{T\.btnDown\}/);
  assert.match(src, /\.sz-btn--secondary\[data-pressed\]\{background:\$\{T\.field\}/);
  const reduce = /@media \(prefers-reduced-motion: reduce\)\{([^]*?)\n\}/.exec(src);
  assert.ok(reduce, 'reduced-motion block');
  assert.ok(!/transform:\s*none/.test(reduce[1]), 'D43: the press scale stays under reduced motion; only the easing is flattened to 120ms');
});

test('no :active press styles anywhere under src/ui (iOS WebKit needs data-pressed)', () => {
  const files = [
    'src/ui/components/Button.js', 'src/ui/screens/home/index.js', 'src/ui/screens/write/compare.js', 'src/ui/screens/result/index.js',
    'src/ui/screens/library/index.js', 'src/ui/screens/library/all.js',
  ];
  for (const f of files) {
    const css = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/[\w\]\)]:active\b/.test(css), `${f}: no :active rule`);
  }
  // P1-E5：首页主按钮是普通的 primary 按钮（宽 240），按压样式就是 Button 的 .sz-btn--primary[data-pressed]，首页不再自带一份
  const home = read('src/ui/screens/home/index.js');
  assert.match(home, /variant="primary" class="sz-home__cta"/);
  assert.ok(!/sz-home__cta[^\n]*\[data-pressed\]/.test(home), 'no home-specific press style on the CTA');
});
