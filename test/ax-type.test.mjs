// D49：AX1–AX5 字阶按层级分别取值（实现交接 §0.3、减法修稿 §5-1 取值表；阶段 1 E9a）。
// 取值表在这里照设计稿原文再抄一遍；tokens.json typography.dynamicType.ax 与 ShiziKitTokens.json 的 AX1–AX5 档（D84：手改真相源，不再读 tokens.css）都必须等于它。
// xS–XXXL 仍是 calc(Npx * var(--k)) 连续倍率（test/tokens.test.mjs 另测）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const tokens = JSON.parse(read('docs/design/design-system-v1/tokens.json'));
const kit = JSON.parse(read('ios/ShiziApp/ShiziApp/ShiziKit/Generated/ShiziKitTokens.json'));
const layoutUnit = px => Math.trunc(px * 64 + 1e-9) / 64;

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

/** ShiziKitTokens.json 的 AX{n} 档：{ 'fs13': 数值, … }（pt）。 */
function axBlock(n) {
  const row = kit.type.categories[`AX${n}`];
  return row ? { ...row.values } : {};
}

test('AX tier: tokens.json typography.dynamicType.ax equals the design table (减法修稿 §5-1)', () => {
  const ax = tokens.typography.dynamicType.ax;
  for (const level of LEVELS) assert.deepEqual(ax[`t${level}`], AX_TABLE[level], `t${level}`);
});

test('AX tier: ShiziKitTokens.json has one AX1–AX5 row per level and each type step takes its own value', () => {
  for (let i = 0; i < 5; i += 1) {
    const block = axBlock(i + 1);
    assert.equal(kit.type.categories[`AX${i + 1}`].ax, i + 1);
    for (const level of LEVELS) {
      const size = AX_TABLE[level][i];
      assert.equal(block[`fs${level}`], size, `AX${i + 1} fs${level}`);
      assert.equal(block[`lh${level}`], axLineHeight(level, size), `AX${i + 1} lh${level}`);
    }
    assert.equal(block['lh17s'], block['lh17'], `AX${i + 1}: single-line 17 line height = multi-line`);
    assert.equal(block['btn-h'], Math.max(54, axLineHeight(17, AX_TABLE[17][i]) + 26), `AX${i + 1} btn-h = max(54, lh17 + 26)`);
  }
  assert.equal(kit.type.categories.AX6, undefined, 'only AX1–AX5');
});

test('AX tier: absolute values (no --k), hierarchy never inverts, spot checks from the design (AX5: 13 → 44 / 52, 28 → 58 / 68, button 88)', () => {
  for (let i = 0; i < 5; i += 1) {
    const sizes = LEVELS.map(l => AX_TABLE[l][i]);
    for (let j = 1; j < sizes.length; j += 1) assert.ok(sizes[j] > sizes[j - 1], `AX${i + 1}: t${LEVELS[j]} (${sizes[j]}) > t${LEVELS[j - 1]} (${sizes[j - 1]})`);
  }
  const ax5 = axBlock(5);
  assert.deepEqual([ax5.fs13, ax5.lh13], [44, 52]);
  assert.deepEqual([ax5.fs28, ax5.lh28], [58, 68]);
  assert.deepEqual([ax5.fs34, ax5.lh34], [60, 70]);
  assert.equal(ax5['btn-h'], 88);
  // 旧做法的对照：统一乘 --k（AX5 = 2.4）会让 t28 比 t17 放大得更多，层级倒置
  assert.ok(28 * 2.4 > 17 * 2.4 && 28 * 2.4 - 17 * 2.4 > AX_TABLE[28][4] - AX_TABLE[17][4], 'tier values narrow the old gap between title and body');
});

test('AX tier: xS–XXXL are untouched — every step is the design size × --k (1/64 truncation, with the small-size floor) and the button stays 54', () => {
  for (const cat of ['xS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']) {
    const { k, ax, values } = kit.type.categories[cat];
    assert.equal(ax, 0, cat);
    for (const s of tokens.typography.scale) {
      // 13 / 11 两级在偏小档带 max() 保底（R2-A1 / A2-07）：仍然是 --k 连续缩放，只是不低于 minSize / minLineHeight
      const floor = (v, min) => layoutUnit(min ? Math.max(min, v) : v);
      assert.equal(values[`fs${s.level}`], floor(s.size * k, s.minSize), `${cat} fs${s.level}`);
      assert.equal(values[`lh${s.level}`], floor(s.lineHeight * k, s.minLineHeight), `${cat} lh${s.level}`);
    }
    assert.equal(values['btn-h'], 54, `${cat} btn-h`);
  }
});
