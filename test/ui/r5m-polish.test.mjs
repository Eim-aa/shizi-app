// R5M 收尾（交互规范审计 P2-22 / P2-23 / P2-24）：三张交互卡合并后剩下的一致性条目。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t } from '../../src/config/copy/index.js';
import { Icons } from '../../src/ui/components/icons.js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const code = rel => read(rel).replace(/\/\/[^\n]*/g, '');

test('P2-24：描一遍 / 自己写阶段的「‹」读屏名是「离开」（两步圆点是页内步骤，「‹」却是整页离开）；其余阶段仍是「返回」', () => {
  assert.equal(t('X-COMMON.leave'), '离开');
  const page = code('src/ui/components/Page.js');
  assert.match(page, /backLabel === 'leave' \? PAGE_COPY\.leave : PAGE_COPY\.back/);
  const write = code('src/ui/screens/write/index.js');
  assert.match(write, /backLabel=\$\{phase === 'trace' \|\| phase === 'retrace' \? 'leave' : 'back'\}/);
});

test('P2-24：练习记录的月份翻页不与页头返回「‹」同形（带杆的箭头）', () => {
  const svg = icon => JSON.stringify(icon());
  const back = svg(Icons.back);
  assert.notEqual(svg(Icons.prev), back);
  assert.match(svg(Icons.prev), /M14\.5 9h-11/, 'prev has a shaft');
  assert.match(svg(Icons.next), /M3\.5 9h11/, 'next has a shaft');
});

test('P2-22：空状态全 App 一个组件（components/EmptyState.js，规范 S2）——各页不再自己画空格子 / 标题 / 说明', () => {
  const files = [
    'src/ui/screens/library/index.js', 'src/ui/screens/library/all.js', 'src/ui/screens/library/list.js', 'src/ui/screens/mine/annual.js',
    'src/ui/screens/mine/index.js', 'src/ui/screens/mine/month.js', 'src/ui/screens/session/none.js',
  ];
  for (const f of files) {
    const src = code(f);
    assert.match(src, /import \{ EmptyState \} from '\.\.\/\.\.\/components\/EmptyState\.js';/, `${f} uses the shared EmptyState`);
    assert.doesNotMatch(src, /sz-lib__empty|sz-all__empty|sz-list-empty|sz-ann__e(glyph|title|body)|sz-mine__empty|sz-none__|sz-monthpage__blank/, `${f}: no page-local empty-state styles`);
  }
  // 练习记录：没有字的月份不画字帖块（标题已经说了「还没有记录」，不再重复说「没有」）
  assert.match(code('src/ui/screens/mine/records.js'), /if \(!monthView\.n\) return null;/);
});
