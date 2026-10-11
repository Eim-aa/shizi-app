// 字帖格（D57 / 方案 C1「字帖格 · 按字数排」）：格数 = 字数、列数规则、日期位置、没有空格。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MINE_SHEET_MAX_CHARS, sheetColumns, sheetGrid, sheetPageLayout, sheetTags, withDayTags } from '../../src/core/images/layout.js';

test('column rule: 1-4 chars one row (n columns), 5-12 -> 4, 13-24 -> 6, 25+ -> 8', () => {
  const want = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4, 12: 4, 13: 6, 24: 6, 25: 8, 72: 8, 80: 8, 900: 8 };
  for (const [n, cols] of Object.entries(want)) assert.equal(sheetColumns(Number(n)), cols, `n=${n}`);
  assert.equal(sheetColumns(0), 0);
});

test('cell count equals char count for every n — no empty cells, ever', () => {
  for (let n = 1; n <= 100; n += 1) {
    const g = sheetGrid(n, 350);
    assert.equal(g.cells.length, n, `n=${n}`);
    assert.equal(new Set(g.cells.map(c => `${c.x},${c.y}`)).size, n, 'cells are distinct');
    assert.ok(g.rows * g.cols - n < g.cols, 'last row is never empty');
  }
});

test('3 chars: one row of 110pt cells; 72 chars: 8 columns, 9 rows, cells fit the width', () => {
  const a = sheetGrid(3, 350);
  assert.deepEqual([a.cols, a.rows, a.c, a.W, a.full], [3, 1, 110, 330, true]);
  const b = sheetGrid(72, 350);
  assert.deepEqual([b.cols, b.rows, b.c, b.lastN, b.full], [8, 9, 43, 8, true]);
  assert.ok(b.W <= 350);
  const c = sheetGrid(72, 335); // 375 wide screen
  assert.equal(c.c, 41);
});

test('short last row: the outline is a staircase (one frame), the inner lines stop at the last cell', () => {
  const g = sheetGrid(18, 350); // 6 cols x 3 rows, last row 6 -> full
  assert.equal(g.full, true);
  const s = sheetGrid(19, 350); // last row has 1
  assert.equal(s.full, false);
  assert.equal(s.lastN, 1);
  assert.match(s.outline, /^M0 0H\d+V\d+H\d+V\d+H0Z$/, 'stair outline: 6 corners');
  assert.ok(!s.inner.includes(`M${2 * s.c} ${3 * s.c}`), 'no vertical line past the last cell');
  assert.equal(sheetGrid(8, 350).full, true);
});

test('maxHeight shrinks the cell so the grid fits (export on 1:1)', () => {
  const g = sheetGrid(80, 974, { unit: 2.69, maxHeight: 700 });
  assert.ok(g.H <= 700);
  assert.equal(g.cells.length, 80);
});

test('date tag: only the first char of each day; a page with one day has none', () => {
  const cells = [
    { ch: '甲', day: '2026-09-01' }, { ch: '乙', day: '2026-09-01' }, { ch: '丙', day: '2026-09-03' }, { ch: '丁', day: '2026-09-03' },
  ];
  assert.deepEqual(sheetTags(withDayTags(cells)), ['1', '', '3', '']);
  assert.deepEqual(sheetTags(withDayTags(cells.slice(0, 2))), ['', '']);
  assert.deepEqual(sheetTags([]), []);
});

test('mine page cap is one sheet (80 chars)', () => {
  assert.equal(MINE_SHEET_MAX_CHARS, 80);
});

test('export page layout uses the same column rule and staircase as the screen (D31)', () => {
  for (const n of [1, 3, 4, 5, 12, 13, 24, 25, 72, 80]) {
    for (const ratio of ['3:4', '1:1']) {
      const L = sheetPageLayout(n, ratio);
      const screen = sheetGrid(n, 350);
      assert.equal(L.grid.cols, screen.cols, `${n} ${ratio}: columns`);
      assert.equal(L.grid.rows, screen.rows, `${n} ${ratio}: rows`);
      assert.equal(L.grid.full, screen.full, `${n} ${ratio}: staircase or not`);
      assert.equal(L.cells.length, n);
      assert.ok(L.top >= 0 && L.top + L.grid.H <= L.H, `${n} ${ratio}: the grid is on the canvas`);
      assert.ok(L.kuan.top + L.kuan.lineHeight <= L.H && L.seal.y + L.seal.size <= L.H, `${n} ${ratio}: signature and seal are on the canvas`);
    }
  }
  const three = sheetPageLayout(3, '1:1');
  assert.ok(Math.abs(three.grid.c / 2.69 - 110) <= 1.5, '3 chars: ~110pt cells on the export too');
});

test('export signature: full last row -> seal under the last cell, right edge aligned; short last row -> seal right of the last cell, bottoms aligned', () => {
  const full = sheetPageLayout(8, '3:4');
  assert.equal(full.below, true);
  assert.equal(full.seal.x + full.seal.size, full.left + full.grid.W);
  assert.ok(full.seal.y > full.top + full.grid.H);
  const short = sheetPageLayout(10, '3:4'); // 4 cols: 3 rows, last row has 2
  assert.equal(short.below, false);
  const last = short.cells[9];
  assert.equal(short.seal.y + short.seal.size, last.y + short.grid.c, 'seal bottom = last cell bottom');
  assert.ok(short.seal.x > last.x + short.grid.c, 'seal is right of the last cell');
  assert.equal(short.kuan.right, short.left + short.grid.W, 'signature right-aligned to the grid');
});
