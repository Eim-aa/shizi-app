// D49：AX1–AX5 字阶按层级分别取值（实现交接 §0.3、减法修稿 §5-1 取值表；阶段 1 E9a）。
// 取值表在这里照设计稿原文再抄一遍；tokens.json typography.dynamicType.ax 与 tokens.css 的 :root[data-ax="N"] 块都必须等于它。
// xS–XXXL 仍是 calc(Npx * var(--k)) 连续倍率（test/tokens.test.mjs 另测）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTokenDecls } from '../src/ui/dev/palette.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const tokens = JSON.parse(read('docs/design/design-system-v1/tokens.json'));
const decls = parseTokenDecls(read('src/config/tokens.css'));

const AX_TABLE = Object.freeze({
  11: [20, 24, 29, 34, 40],
  13: [23, 27, 33, 38, 44],
  15: [25, 30, 36, 42, 49],
  17: [28, 33, 40, 47, 53],
  22: [34, 39, 44, 50, 56],
  28: [38, 43, 48, 53, 58],
  34: [44, 48, 52, 56, 60],
});
const LEVELS = [11, 13, 15, 17, 22, 28, 34];
const DEFAULT_LH = Object.freeze({ 11: 16, 13: 20, 15: 22, 17: 26, 22: 30, 28: 36, 34: 42 });
// 行高 = 字号 × 1.18 取整到偶数，且不小于该级默认行高
const axLineHeight = (level, size) => Math.max(DEFAULT_LH[level], Math.round((size * 1.18) / 2) * 2);

/** :root[data-ax="N"] 块里的声明：{ '--fs13': decl, … }。 */
function axBlock(n) {
  const out = {};
  for (const d of decls) if (d.selectors.length === 1 && d.selectors[0] === `:root[data-ax="${n}"]`) out[d.name] = d;
  return out;
}

test('AX tier: tokens.json typography.dynamicType.ax equals the design table (减法修稿 §5-1)', () => {
  const ax = tokens.typography.dynamicType.ax;
  for (const level of LEVELS) assert.deepEqual(ax[`t${level}`], AX_TABLE[level], `t${level}`);
});

test('AX tier: tokens.css has one :root[data-ax="N"] block per level and each type step takes its own value', () => {
  for (let i = 0; i < 5; i += 1) {
    const block = axBlock(i + 1);
    for (const level of LEVELS) {
      const size = AX_TABLE[level][i];
      assert.equal(block[`--fs${level}`].value, `${size}px`, `AX${i + 1} --fs${level}`);
      assert.equal(block[`--lh${level}`].value, `${axLineHeight(level, size)}px`, `AX${i + 1} --lh${level}`);
      assert.match(block[`--fs${level}`].note, new RegExp(`tokens\\.json typography\\.dynamicType\\.ax\\.t${level}\\[${i}\\]$`), `AX${i + 1} --fs${level} cites its source`);
    }
    assert.equal(block['--lh17s'].value, block['--lh17'].value, `AX${i + 1}: single-line 17 line height = multi-line`);
    assert.equal(block['--btn-h'].value, `${Math.max(54, axLineHeight(17, AX_TABLE[17][i]) + 26)}px`, `AX${i + 1} --btn-h = max(54, lh17 + 26)`);
  }
  assert.equal(axBlock(6)['--fs13'], undefined, 'only AX1–AX5');
});

test('AX tier: absolute values (no --k), hierarchy never inverts, spot checks from the design (AX5: 13 → 44 / 52, 28 → 58 / 68, button 88)', () => {
  for (let i = 0; i < 5; i += 1) {
    for (const d of Object.values(axBlock(i + 1))) assert.ok(!/--k/.test(d.value), `${d.name}: AX values do not multiply --k`);
    const sizes = LEVELS.map(l => AX_TABLE[l][i]);
    for (let j = 1; j < sizes.length; j += 1) assert.ok(sizes[j] > sizes[j - 1], `AX${i + 1}: t${LEVELS[j]} (${sizes[j]}) > t${LEVELS[j - 1]} (${sizes[j - 1]})`);
  }
  const ax5 = axBlock(5);
  assert.deepEqual([ax5['--fs13'].value, ax5['--lh13'].value], ['44px', '52px']);
  assert.deepEqual([ax5['--fs28'].value, ax5['--lh28'].value], ['58px', '68px']);
  assert.deepEqual([ax5['--fs34'].value, ax5['--lh34'].value], ['60px', '70px']);
  assert.equal(ax5['--btn-h'].value, '88px');
  // 旧做法的对照：统一乘 --k（AX5 = 2.4）会让 t28 比 t17 放大得更多，层级倒置
  assert.ok(28 * 2.4 > 17 * 2.4 && 28 * 2.4 - 17 * 2.4 > AX_TABLE[28][4] - AX_TABLE[17][4], 'tier values narrow the old gap between title and body');
});

test('AX tier: xS–XXXL are untouched — the :root block still scales every step by --k and the button stays 54', () => {
  const base = {};
  for (const d of decls) if (d.selectors.length === 1 && d.selectors[0] === ':root') base[d.name] = d;
  for (const s of tokens.typography.scale) {
    assert.equal(base[`--fs${s.level}`].value.replace(/\s+/g, ''), `calc(${s.size}px*var(--k))`);
    assert.equal(base[`--lh${s.level}`].value.replace(/\s+/g, ''), `calc(${s.lineHeight}px*var(--k))`);
  }
  assert.equal(base['--btn-h'].value, '54px');
});
