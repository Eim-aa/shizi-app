// 字库墨墙四档墨色（阶段 1 P1-E1b，设计系统 v1 设计说明 16）：四个独立色值 --wall1…--wall4（tokens.json color.*.wall1–4）取代原来的透明度四档
// （阶段 0 P0-A·B5 的 .55 最淡档与深色提亮 DARK_OLDEST_TONE 随之作废）。这里核对：
//   · wall.js 只用令牌取色（TONE_COLOR_VARS / toneColor），不再导出透明度常量；
//   · 四档颜色对纸色的对比度逐档递减（档位仍可分辨）且最淡一档 ≥ 3:1（WCAG 1.4.11 非文字），浅深各一套；
//   · 对比度与 tokens.json 的 contrast 表（wall4/paper 3.52 / 4.72）一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as wall from '../../src/ui/screens/library/wall.js';
import { TONE_COLOR_VARS, toneColor } from '../../src/ui/screens/library/wall.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokens = JSON.parse(readFileSync(join(ROOT, 'docs/design/design-system-v1/tokens.json'), 'utf8'));
const css = readFileSync(join(ROOT, 'src/config/tokens.css'), 'utf8');

const rgb = hex => [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16));
function luminance(c) {
  const [r, g, b] = c.map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('墨墙取色只走令牌：四档 → --wall1…--wall4，没有透明度四档常量', () => {
  assert.deepEqual([...TONE_COLOR_VARS], ['--wall1', '--wall2', '--wall3', '--wall4']);
  assert.equal(toneColor(0), 'var(--wall1)');
  assert.equal(toneColor(3), 'var(--wall4)');
  assert.equal(toneColor(null), 'var(--wall4)', '没有档位按最淡一档');
  assert.equal('TONE_OPACITY' in wall, false, 'the opacity encoding is gone');
  assert.equal('DARK_OLDEST_TONE' in wall, false, 'the dark brighten-the-oldest hack is gone');
  const rules = wall.WALL_CSS;
  assert.ok(!/--lib-t[0-3]/.test(rules), 'no --lib-tN opacity variables in the wall CSS');
  for (const n of [1, 2, 3, 4]) assert.ok(rules.includes(`var(--wall${n})`), `wall CSS uses --wall${n}`);
  for (const n of [1, 2, 3, 4]) {
    for (const theme of ['light', 'dark']) assert.ok(css.includes(`--wall${n}: ${tokens.color[theme][`wall${n}`]};`), `tokens.css has ${theme} wall${n}`);
  }
});

for (const theme of ['light', 'dark']) {
  test(`${theme}：四档对纸的对比度逐档递减，最淡档 ≥ 3:1，与 tokens.json 的 contrast 表一致`, () => {
    const c = tokens.color[theme];
    const r = [1, 2, 3, 4].map(n => ratio(c[`wall${n}`], c.paper));
    for (let i = 1; i < r.length; i += 1) assert.ok(r[i] < r[i - 1], `${theme} tone ${i} (${r[i].toFixed(2)}) < tone ${i - 1} (${r[i - 1].toFixed(2)})`);
    assert.ok(r[3] >= 3, `${theme} oldest tone contrast ${r[3].toFixed(2)} ≥ 3`);
    assert.ok(Math.abs(r[3] - tokens.color.contrast[theme]['wall4/paper']) < 0.02, `${theme} wall4/paper matches the token table`);
    assert.ok(r[0] - r[1] > 1 && r[1] - r[2] > 1, `${theme}: the first three steps are at least 1:1 apart (distinguishable)`);
  });
}
