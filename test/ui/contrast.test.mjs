// 对比度矩阵（P1-E1a，D43）：按 tokens.json color.contrast 的配对，用 tokens.css 里的实际取值（浅 / 深两套）按 WCAG 2.x 公式实算，
// 低于阈值即失败；表里写的数也要和实算对得上（±0.5：表里的数是设计稿四舍五入的，实算为准；差得更多就是漂开了），免得 tokens.json 和 CSS 悄悄漂开。
// 输入框占位文字用 ink2（tokens.json 已注明的例外：ink3 在 field 上浅色只有 4.2:1）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTokenDecls } from '../../src/ui/dev/palette.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tokens = JSON.parse(read('docs/design/design-system-v1/tokens.json'));
const decls = parseTokenDecls(read('src/config/tokens.css'));

const SELECTOR = {
  light: ':root, :root[data-theme="light"], .t-light',
  dark: ':root[data-theme="dark"], .t-dark',
};
const kebab = s => s.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);

function colorOf(theme, key) {
  const d = decls.find(x => x.name === `--${kebab(key)}` && x.selectors.length === 1 && x.selectors[0] === SELECTOR[theme]);
  assert.ok(d, `--${kebab(key)} in the ${theme} block`);
  const m = /^#([0-9a-fA-F]{6})$/.exec(d.value.trim());
  assert.ok(m, `${key} ${theme} is #RRGGBB: ${d.value}`);
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const th = tokens.color.contrast.thresholds;

/** 每个配对属于哪一类要求（tokens.json thresholds）：正文 4.5、大字与图形 3、提示 / 描红 3、提示对本人墨 3。 */
const KIND = {
  'ink1/paper': 'text', 'ink2/paper': 'text', 'ink3/paper': 'text', 'ink3/sheet': 'text',
  'btnFg/btnBg': 'text', 'toastFg/toastBg': 'text',
  'ink4/paper': 'largeTextAndGraphics', 'hand/sheet': 'largeTextAndGraphics', 'ref/sheet': 'largeTextAndGraphics',
  'under/sheet': 'largeTextAndGraphics', 'frame/sheet': 'largeTextAndGraphics', 'wall4/paper': 'largeTextAndGraphics',
  'zhu/paper': 'largeTextAndGraphics', 'zhu/sheet': 'largeTextAndGraphics', 'onSeal/seal': 'largeTextAndGraphics',
  'danzhu/sheet': 'hintAndTrace', 'danzhu/hand': 'hintVsHand',
  'field/paper': 'surface',
};

test('every pair in tokens.json color.contrast is classified by this test (no silently unchecked pair)', () => {
  for (const theme of ['light', 'dark']) {
    for (const key of Object.keys(tokens.color.contrast[theme])) assert.ok(KIND[key], `${theme} ${key}: add it to KIND`);
  }
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: key pairs computed from tokens.css meet their thresholds and match the table in tokens.json`, () => {
    for (const [pair, listed] of Object.entries(tokens.color.contrast[theme])) {
      const [fg, bg] = pair.split('/');
      const ratio = contrast(colorOf(theme, fg), colorOf(theme, bg));
      assert.ok(Math.abs(ratio - listed) <= 0.5, `${theme} ${pair}: tokens.json says ${listed}, tokens.css gives ${ratio.toFixed(2)}`);
      const kind = KIND[pair];
      const need = kind === 'surface' ? (theme === 'light' ? th.groupSurfaceLight : th.groupSurfaceDark) : th[kind];
      assert.ok(ratio >= need - 0.005, `${theme} ${pair}: ${ratio.toFixed(2)} < ${need} (${kind})`);
    }
  });
}

test('field surfaces: ink2 text on field stays ≥ 4.5 in both themes (the placeholder exception); ink3 on field is the known exception', () => {
  for (const theme of ['light', 'dark']) {
    assert.ok(contrast(colorOf(theme, 'ink2'), colorOf(theme, 'field')) >= th.text, `${theme} ink2/field`);
  }
  assert.ok(contrast(colorOf('light', 'ink3'), colorOf('light', 'field')) < th.text, 'light ink3/field is below 4.5, hence the exception');
  assert.match(tokens.color.contrast.knownExceptions, /占位文字改用 ink2/);
});

test('input placeholders use ink2 (not ink3 / ink4) on the field surface', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
  let seen = 0;
  for (const file of walk(path.join(ROOT, 'src/ui'))) {
    const text = read(path.relative(ROOT, file));
    for (const m of text.matchAll(/::placeholder\{((?:\$\{[^}]*\}|[^}])*)\}/g)) {
      seen += 1;
      const color = /(?:^|;)\s*color:\s*((?:\$\{[^}]*\}|[^;}])+)/.exec(m[1]);
      assert.ok(color, `${path.relative(ROOT, file)}: ::placeholder sets a colour`);
      assert.equal(color[1].trim(), '${T.ink2}', `${path.relative(ROOT, file)}: ::placeholder colour`);
    }
  }
  assert.ok(seen >= 2, `placeholders found: ${seen}`);
  assert.match(read('src/ui/screens/library/query-entry.js'), /\.sz-libq__text\{(?:\$\{[^}]*\}|[^}])*color:\$\{T\.ink2\}/, 'the 查字 entry button is an input look-alike on field');
});

test('seal: white-letter seal keeps ≥ 3:1 in light (5.7) and the documented 3.7 in dark (logotype exemption, P101)', () => {
  assert.ok(contrast(colorOf('light', 'onSeal'), colorOf('light', 'seal')) >= 4.5);
  assert.ok(contrast(colorOf('dark', 'onSeal'), colorOf('dark', 'seal')) >= 3);
});
