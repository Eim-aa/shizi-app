// R2-A1（A2-05；D29 / D51）：所有底部弹层有可见的「完成」文字按钮（H1 文字按钮规格），读屏可达；Esc 与原生 Z 形手势同走关闭。
// 渲染后的真实可见性 / AX5 下的位置见 e2e 88-a1-sheet-done；这里看源码约定（单测没有 DOM）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY } from '../../src/config/copy/index.js';

const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const sheetSrc = read('src/ui/components/Sheet.js');

test('Sheet 标题行右端画「完成」：文字按钮、文案来自 X-COMMON.done、点了走 onClose、默认就有', () => {
  assert.equal(COPY['X-COMMON.done'], '完成');
  assert.match(sheetSrc, /<\$\{Button\} variant="text" class="sz-sheet__done"/);
  assert.match(sheetSrc, /t\('X-COMMON\.done'\)/);
  assert.match(sheetSrc, /dismiss = 'done'/, '默认画完成');
  assert.match(sheetSrc, /const done = dismiss !== 'own'/);
  assert.match(sheetSrc, /onClick=\$\{close\}/);
  assert.match(sheetSrc, /data-dismiss=\$\{done \? 'done' : 'own'\}/, 'e2e 逐个核对用的标记');
});

test('没有标题的弹层（写字页「⋯」菜单）这一行也有「完成」', () => {
  assert.match(sheetSrc, /\$\{title \|\| done/);
});

test('只有弹层自己已有等价可见出口的决策弹层才传 dismiss="own"（修改判断、对照弹层、清空确认），其余沿用默认', () => {
  const own = [
    ['src/ui/screens/write/result-row.js', 'write-change-sheet'],
    ['src/ui/screens/result/index.js', 'result-sheet'],
    ['src/ui/screens/mine/backup.js', 'backup-clear-sheet'],
  ];
  for (const [f, id] of own) assert.match(read(f), new RegExp(`testid="${id}" dismiss="own"`), `${f}`);
  const withDone = [
    'src/ui/screens/write/ax-menu.js', 'src/ui/screens/library/all.js', 'src/ui/screens/detail/records.js',
    'src/ui/screens/mine/settings.js', 'src/ui/components/query/QuerySheet.js', 'src/ui/components/image-preview.js',
  ];
  for (const f of withDone) assert.doesNotMatch(read(f), /dismiss="own"/, `${f}: 沿用默认的「完成」`);
});

test('字库菜单、字详情放大弹层不再另画底部「关闭」，分享弹层的「完成」就是 Sheet 的那一个（testid 沿用 image-done）', () => {
  assert.doesNotMatch(read('src/ui/screens/library/all.js'), /all-menu-close/);
  assert.doesNotMatch(read('src/ui/screens/detail/records.js'), /sz-dzoom__close/);
  const img = read('src/ui/components/image-preview.js');
  assert.match(img, /doneTestid="image-done"/);
  assert.doesNotMatch(img, /sz-img__done/);
});

test('Esc 与原生读屏 Z 形手势（shizi-native-escape）都只关最上层遮罩', () => {
  const router = read('src/ui/router.js');
  assert.match(router, /export const NATIVE_ESCAPE_EVENT = 'shizi-native-escape'/);
  const root = read('src/ui/root.js');
  assert.match(root, /win\.addEventListener\(NATIVE_ESCAPE_EVENT, onNativeEscape\)/);
  assert.match(root, /const onNativeEscape = \(\) => \{\s*if \(!router\.getState\(\)\.topIsOverlay\) return;\s*router\.back\(\);/);
});
