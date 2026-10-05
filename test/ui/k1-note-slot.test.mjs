// R3-K1（ADA A3-01 后半，P241）：AX 档格下说明位按实际高度算进可用高度。
// 旧实现把说明位固定成 56：说明折成三行（看答案的后果说明、AX 字号的结果行）时多出来的一行落到底栏下面；
// 现在 axWriteLayout 收量到的说明位高度 N：格子先缩（不低于 220），仍放不下时说明位并入「⋯」菜单顶部（noteInMenu），格下不画。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { axWriteLayout, AX_NOTE_H, AX_GRID_MIN } from '../../src/ui/screens/write/layout.js';

const SE_AX5 = { width: 375, mainHeight: 494, promptHeight: 112 }; // 门禁里量到的 SE 3 AX5（正文区 494、题面 112）

test('default note slot is the 56pt minimum (unchanged when nothing taller is measured)', () => {
  const r = axWriteLayout(SE_AX5);
  assert.equal(r.g, 494 - 112 - 16 - AX_NOTE_H - 16);
  assert.equal(r.toolsHeight, AX_NOTE_H);
  assert.equal(r.noteInMenu, false);
  assert.equal(axWriteLayout({ ...SE_AX5, noteHeight: 30 }).g, r.g, 'a shorter measurement never shrinks the slot below the minimum');
});

test('a taller note (three lines) shrinks the grid so the whole note stays above the foot', () => {
  const r = axWriteLayout({ ...SE_AX5, noteHeight: 98 });
  assert.equal(r.g, 494 - 112 - 16 - 98 - 16);
  assert.equal(r.toolsHeight, 98);
  assert.equal(r.noteInMenu, false);
  assert.ok(r.fits && r.top + 112 + 16 + r.g + 98 <= 494, 'grid + note fit in the main area');
});

test('when the grid would go under 220 the note goes into the 「⋯」 menu and the grid is laid out without it', () => {
  const r = axWriteLayout({ ...SE_AX5, noteHeight: 150 });
  assert.equal(r.noteInMenu, true);
  assert.equal(r.toolsHeight, 0);
  assert.equal(r.g, Math.min(375 - 40, 494 - 112 - 16 - 16));
  assert.ok(r.g >= AX_GRID_MIN && r.fits);
  const edge = axWriteLayout({ ...SE_AX5, noteHeight: 494 - 112 - 16 - 220 - 16 });
  assert.equal(edge.noteInMenu, false, 'exactly 220 still keeps the note under the grid');
  assert.equal(edge.g, 220);
});

test('write page wires it: noteKey per card + phase, note measured from .sz-write__below, menu head + dot on 「⋯」', () => {
  const compact = readFileSync(new URL('../../src/ui/screens/write/compact.js', import.meta.url), 'utf8');
  assert.match(compact, /axWriteLayout\(\{ width, mainHeight, promptHeight, noteHeight \}\)/);
  assert.match(compact, /el\.querySelector\('\.sz-write__below'\)/);
  const index = readFileSync(new URL('../../src/ui/screens/write/index.js', import.meta.url), 'utf8');
  assert.match(index, /noteKey: cardKey \? `\$\{cardKey\}\|\$\{phase\}` : null/);
  assert.match(index, /data-in-menu=\$\{noteInMenu \? 'true' : null\}/);
  const menu = readFileSync(new URL('../../src/ui/screens/write/ax-menu.js', import.meta.url), 'utf8');
  assert.match(menu, /data-testid="write-menu-note"/);
  assert.match(menu, /\.sz-write__more\[data-note="true"\]::after/);
});
