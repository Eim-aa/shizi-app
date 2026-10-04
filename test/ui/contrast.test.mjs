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

// ---- 求助梯子：提示 × 本人墨（不压暗）与提示 × 纸，三种色觉模拟（W1，A2-02 / V2-01 / D34 / D51 ⑧）
// 旧测试只核对 danzhu/hand 这一对「不会出现在屏幕上的颜色」（本人墨被压到 35% 才是屏上真实的一对），没拦住 v2 的回退。
// 现在按屏上真实合成：提示笔画 = danzhu 以 HINT_DRAW.opacity 压在笺面上、外面一圈 1pt ink3 外廓；本人墨 = hand，不压暗（inkOpacity 恒 1）。
import { HINT_DRAW } from '../../src/ui/screens/write/hint-layer.js';

const VISIONS = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  // Machado, Oliveira & Fernandes 2009，严重度 1.0（在线性 RGB 里乘）
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
};
const toLin = v => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function lumUnder(rgb, vision) {
  const lin = rgb.map(toLin);
  const m = VISIONS[vision];
  const [r, g, b] = m.map(row => Math.max(0, Math.min(1, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastUnder(a, b, vision) {
  const [hi, lo] = [lumUnder(a, vision), lumUnder(b, vision)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const over = (fg, bg, alpha) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));

for (const theme of ['light', 'dark']) {
  for (const vision of Object.keys(VISIONS)) {
    test(`${theme} · ${vision}: hint fill × own ink (not dimmed) ≥ 3:1; hint outline × paper / sheet ≥ 3:1; the hint edge is readable on the sheet`, () => {
      const sheet = colorOf(theme, 'sheet');
      const paper = colorOf(theme, 'paper');
      const hand = colorOf(theme, 'hand');
      const fill = over(colorOf(theme, 'danzhu'), sheet, HINT_DRAW.opacity);
      const outline = colorOf(theme, 'ink3');
      const need = th.hintVsHand;
      assert.ok(need >= 3, 'threshold is 3:1');
      const fillInk = contrastUnder(fill, hand, vision);
      assert.ok(fillInk >= need, `${theme}/${vision}: hint × own ink ${fillInk.toFixed(2)} < ${need}`);
      for (const [name, ground] of [['paper', paper], ['sheet', sheet]]) {
        const edge = contrastUnder(outline, ground, vision);
        assert.ok(edge >= 3, `${theme}/${vision}: hint outline × ${name} ${edge.toFixed(2)} < 3`);
      }
      // 笔画外缘 = 外廓对笺面；填充本身对笺面在正常视觉下 ≥ 3（tokens.json danzhu/sheet），色觉异常时由外廓保证。
      const fillSheet = contrastUnder(fill, sheet, vision);
      if (vision === 'normal') assert.ok(fillSheet >= th.hintAndTrace - 0.005, `${theme}: hint fill × sheet ${fillSheet.toFixed(2)}`);
      assert.ok(Math.max(fillSheet, contrastUnder(outline, sheet, vision)) >= 3, `${theme}/${vision}: the hint stroke is distinguishable from the sheet`);
    });
  }
}

test('the hint never dims the writer\'s ink: the 35% dimming is gone, so the real on-screen pair is hint × hand at full strength (V2-01)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/screens/write/hint-layer.js'), 'utf8');
  assert.ok(!/INK_DIM_OPACITY\s*=/.test(src), 'INK_DIM_OPACITY is removed');
  assert.ok(/inkOpacity:\s*1,/.test(src), 'inkOpacity is a constant 1');
  assert.equal(HINT_DRAW.opacity, 1, 'the hint layer is drawn at the token colour');
});
