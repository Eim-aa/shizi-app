// R3-K1（ADA A3-01 后半，P241）：AX 档格下说明位按实际高度算进可用高度。
// 旧实现把说明位固定成 56：说明折成三行（看答案的后果说明、AX 字号的结果行）时多出来的一行落到底栏下面；
// 现在 axWriteLayout 收量到的说明位高度 N：格子先缩（不低于 220）。R4-F1（P261）：「⋯」菜单没有了，格子缩到下限仍放不下时 tight=true，
// 写字页先收起「在纸上写」（文字行折行时），仍放不下则 g 取下限、整组可能超出主区（fits=false）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { axWriteLayout, AX_NOTE_H, AX_GRID_MIN } from '../../src/ui/screens/write/layout.js';

const SE_AX5 = { width: 375, mainHeight: 494, promptHeight: 112 }; // SE 3 AX5 的一组量到的数（正文区 494、题面 112）

test('default note slot is the 56pt minimum (unchanged when nothing taller is measured)', () => {
  const r = axWriteLayout(SE_AX5);
  assert.equal(r.g, 494 - 112 - 16 - AX_NOTE_H - 16);
  assert.equal(r.toolsHeight, AX_NOTE_H);
  assert.equal(r.tight, false);
  assert.equal(axWriteLayout({ ...SE_AX5, noteHeight: 30 }).g, r.g, 'a shorter measurement never shrinks the slot below the minimum');
});

test('a taller note (three lines) shrinks the grid so the whole note stays above the foot', () => {
  const r = axWriteLayout({ ...SE_AX5, noteHeight: 98 });
  assert.equal(r.g, 494 - 112 - 16 - 98 - 16);
  assert.equal(r.toolsHeight, 98);
  assert.equal(r.tight, false);
  assert.ok(r.fits && r.top + 112 + 16 + r.g + 98 <= 494, 'grid + note fit in the main area');
});

test('when the grid would go under 220 it is flagged tight (the page then drops 在纸上写) and the grid stays at 220; exactly 220 is not tight (P261)', () => {
  const r = axWriteLayout({ ...SE_AX5, noteHeight: 150 });
  assert.equal(r.tight, true);
  assert.equal(r.g, AX_GRID_MIN, 'never below the floor');
  assert.equal(r.toolsHeight, 150, 'the note stays under the grid: there is no menu to move it into any more');
  assert.equal(r.fits, false, 'with nothing left to give up the group runs past the main area (the page body scrolls)');
  const edge = axWriteLayout({ ...SE_AX5, noteHeight: 494 - 112 - 16 - 220 - 16 });
  assert.equal(edge.tight, false, 'exactly 220 is fine');
  assert.equal(edge.g, 220);
  assert.ok(!('noteInMenu' in r), 'the 「⋯」 menu is gone (R4-F1)');
});

test('write page wires it: noteKey per card + phase, note measured from .sz-write__below, tight + wrapped text row → 在纸上写 collapses', () => {
  const compact = readFileSync(new URL('../../src/ui/screens/write/compact.js', import.meta.url), 'utf8');
  assert.match(compact, /axWriteLayout\(\{ width, mainHeight, promptHeight, noteHeight \}\)/);
  assert.match(compact, /el\.querySelector\('\.sz-write__below'\)/);
  assert.match(compact, /querySelector\('\.sz-write__links'\)/, 'the text row height is measured to know whether it wrapped');
  const index = readFileSync(new URL('../../src/ui/screens/write/index.js', import.meta.url), 'utf8');
  assert.match(index, /noteKey: cardKey \? `\$\{cardKey\}\|\$\{phase\}` : null/);
  assert.match(index, /const hasNote = !!\(row\.node \|\| suggest\.node \|\| noteBody\);/);
  assert.match(index, /if \(layout\.linksWrapped && !paperCollapsed\) setPaperGone\(viewKey\);/, 'only a wrapped row that is also tight gives up 在纸上写');
  assert.match(index, /else if \(!footCompact\) setFootCompactKey\(viewKey\);/, 'still tight with nothing to fold: the main button is capped at 34pt (P261 ②)');
  assert.doesNotMatch(index, /noteInMenu|write-menu-note|write-more/);
});
