// R3-K1（ADA A3-01 后半，P241）：AX 档格下说明位按实际高度算进可用高度。
// 旧实现把说明位固定成 56：说明折成三行（看答案的后果说明、AX 字号的结果行）时多出来的一行落到底栏下面；
// 现在 axWriteLayout 收量到的说明位高度 N：格子先缩（不低于 220）。R4-F1（P261）：「⋯」菜单没有了，格子缩到下限仍放不下时 tight=true，
// 写字页把主按钮字号封顶（P278），仍放不下则 g 取下限、整组可能超出主区（fits=false）。W2（A7，P280）起 N 是格下总高 = 撤销 / 清空行 48 + 说明位。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { axWriteLayout, AX_BELOW_H, AX_GRID_MIN } from '../../src/ui/screens/write/layout.js';

const SE_AX5 = { width: 375, mainHeight: 494, promptHeight: 112 }; // SE 3 AX5 的一组量到的数（正文区 494、题面 112）

test('default below-grid slot is the 104pt minimum (撤销 / 清空行 48 + 说明位 56, A7; unchanged when nothing taller is measured)', () => {
  const r = axWriteLayout(SE_AX5);
  assert.equal(r.g, 494 - 112 - 16 - AX_BELOW_H - 16);
  assert.equal(r.toolsHeight, AX_BELOW_H);
  assert.equal(r.tight, false);
  assert.equal(axWriteLayout({ ...SE_AX5, noteHeight: 30 }).g, r.g, 'a shorter measurement never shrinks the slot below the minimum');
});

test('a taller note (three lines) shrinks the grid so the whole note stays above the foot', () => {
  const r = axWriteLayout({ ...SE_AX5, noteHeight: 122 });
  assert.equal(r.g, 494 - 112 - 16 - 122 - 16);
  assert.equal(r.toolsHeight, 122);
  assert.equal(r.tight, false);
  assert.ok(r.fits && r.top + 112 + 16 + r.g + 122 <= 494, 'grid + note fit in the main area');
});

test('when the grid would go under 220 it is flagged tight (the page then caps the main button, P278); still short → the grid goes under 220 (≥ 180), then the prompt shrinks (≥ 0.6, P299); exactly 220 is not tight (P261)', () => {
  const r = axWriteLayout({ ...SE_AX5, noteHeight: 198 });
  assert.equal(r.tight, true);
  assert.equal(r.g, 180, 'P299 ①: the grid gives way first, down to 180');
  assert.equal(r.promptScale, 0.75, 'P299 ②: then the prompt shrinks: (494 − 16 − 198 − 16 − 180) ÷ 112 = 0.75');
  assert.equal(r.toolsHeight, 198, 'the note stays under the grid: there is no menu to move it into any more');
  assert.equal(r.fits, true, 'P299: the group fits — the write page does not scroll');
  const edge = axWriteLayout({ ...SE_AX5, noteHeight: 494 - 112 - 16 - 220 - 16 });
  assert.equal(edge.tight, false, 'exactly 220 is fine');
  assert.equal(edge.g, 220);
  assert.ok(!('noteInMenu' in r), 'the 「⋯」 menu is gone (R4-F1)');
});

test('write page wires it: noteKey per card + phase, note measured from .sz-write__below, tight → the main button is capped at 34pt (no 在纸上写 to give up, P278)', () => {
  const compact = readFileSync(new URL('../../src/ui/screens/write/compact.js', import.meta.url), 'utf8');
  assert.match(compact, /axWriteLayout\(\{ width, mainHeight, promptHeight, noteHeight \}\)/);
  assert.match(compact, /el\.querySelector\('\.sz-write__below'\)/);
  const index = readFileSync(new URL('../../src/ui/screens/write/index.js', import.meta.url), 'utf8');
  assert.match(index, /noteKey: cardKey \? `\$\{cardKey\}\|\$\{phase\}` : null/);
  assert.match(index, /const hasNote = !!\(row\.node \|\| noteBody\);/);
  assert.match(index, /if \(ax > 0 && layout\.tight && !footCompact\) setFootCompactKey\(viewKey\);/, 'tight: the main button is capped at 34pt straight away (P261 ②; nothing else gives way first)');
  const code = src => src.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code(index), /paperGone|paperCollapsed|setPaperGone|linksWrapped/, 'D56 / P278: no 在纸上写 to collapse any more');
  assert.doesNotMatch(code(compact), /linksWrapped|sz-write__links/, 'the text row is no longer measured for wrapping');
  const layoutSrc = readFileSync(new URL('../../src/ui/screens/write/layout.js', import.meta.url), 'utf8');
  assert.doesNotMatch(layoutSrc, /收起跳过之外最不常用|先收起「在纸上写」/, 'the layout notes no longer describe giving up 在纸上写');
  assert.doesNotMatch(index, /noteInMenu|write-menu-note|write-more/);
});
