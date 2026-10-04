// H1-7（D51 ⑥、V2-07、T2-16）：纸纹去掉低频「云絮」层，只留细颗粒；导出图片用平涂笺色（不带纹理）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTextureUrls } from '../../src/core/images/palette.js';

const css = readFileSync(new URL('../../src/config/tokens.css', import.meta.url), 'utf8');
const tokens = JSON.parse(readFileSync(new URL('../../docs/design/design-system-v1/tokens.json', import.meta.url), 'utf8'));
const palette = readFileSync(new URL('../../src/core/images/palette.js', import.meta.url), 'utf8');

function decl(name) {
  const m = new RegExp(`^\\s*${name}:\\s*(.*?);\\s*/\\*`, 'm').exec(css);
  assert.ok(m, `${name} declared`);
  return m[1];
}

test('tokens.css：--tex-light / --tex-dark 只剩细颗粒一层（没有 baseFrequency .016 的低频云絮），--tex-size 只有一个尺寸', () => {
  for (const name of ['--tex-light', '--tex-dark']) {
    const value = decl(name);
    assert.equal(parseTextureUrls(value).length, 1, `${name}: one layer (fine grain)`);
    assert.ok(!value.includes('baseFrequency=\'.016\''), `${name}: no low-frequency cloud`);
    assert.ok(value.includes('baseFrequency=\'.9\''), `${name}: the fine grain stays`);
  }
  assert.equal(decl('--tex-size'), '240px 240px');
});

test('tokens.json：placeholderStrength 没有 cloud，颗粒强度不变（浅 .055 / 深 .035）', () => {
  const s = tokens.texture.placeholderStrength;
  assert.deepEqual(s, { light: { grain: 0.055 }, dark: { grain: 0.035 } });
});

test('导出图的调色板不带纹理：readLightPalette 的 textures 恒为空（平涂笺色），瓦片尺寸只剩颗粒的 240', () => {
  assert.doesNotMatch(palette, /parseTextureUrls\(cs\.getPropertyValue\('--tex-img'\)\)\s*;?\s*\n\s*cached/, 'the export palette no longer reads the screen paper texture');
  assert.match(palette, /const textures = \[\]/, 'flat sheet colour for exports');
});
