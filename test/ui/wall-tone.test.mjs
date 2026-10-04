// 阶段 0 卡 P0-A · B5（G30 部分，D36）：字库墨墙四档墨色最淡档 .4 → .55，浅色下与纸色的对比度 ≥ 3:1（WCAG 1.4.11 非文字），
// 深色最淡档同样 ≥ 3:1。对比度按令牌实际取值计算（墨色以该档透明度叠在纸色上）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TONE_OPACITY, DARK_OLDEST_TONE } from '../../src/ui/screens/library/wall.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokens = readFileSync(join(ROOT, 'src/config/tokens.css'), 'utf8');

function hexOf(block, name) {
  const m = new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})\\b`).exec(block);
  assert.ok(m, `${name} not found`);
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const blend = (ink, paper, alpha) => ink.map((v, i) => Math.round(v * alpha + paper[i] * (1 - alpha)));

const darkStart = tokens.indexOf('@media (prefers-color-scheme: dark)');
const lightBlock = tokens.slice(0, darkStart);
const darkBlock = tokens.slice(darkStart);

test('墨墙四档透明度：最淡档 .55（D36），档位仍单调递减', () => {
  assert.deepEqual([...TONE_OPACITY], [1, 0.78, 0.58, 0.55]);
  for (let i = 1; i < TONE_OPACITY.length; i += 1) assert.ok(TONE_OPACITY[i] < TONE_OPACITY[i - 1], `tone ${i} < tone ${i - 1}`);
});

test('浅色：最淡档墨色叠在纸色上 ≥ 3:1（旧值 .4 不到 3:1）', () => {
  const ink = hexOf(lightBlock, '--ink1');
  const paper = hexOf(lightBlock, '--paper');
  const oldest = ratio(blend(ink, paper, TONE_OPACITY[3]), paper);
  assert.ok(oldest >= 3, `light oldest tone contrast ${oldest.toFixed(2)}`);
  assert.ok(ratio(blend(ink, paper, 0.4), paper) < 3, 'the old .4 was below 3:1');
});

test('深色：最淡档（DARK_OLDEST_TONE）叠在深纸色上 ≥ 3:1', () => {
  const ink = hexOf(darkBlock, '--ink1');
  const paper = hexOf(darkBlock, '--paper');
  const oldest = ratio(blend(ink, paper, DARK_OLDEST_TONE), paper);
  assert.ok(oldest >= 3, `dark oldest tone contrast ${oldest.toFixed(2)}`);
});
