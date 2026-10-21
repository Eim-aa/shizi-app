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
  'btnFg/btnBg': 'text', 'toastFg/toastBg': 'text', 'toastBg/btnBg': 'toastVsPrimary',
  'ink4/paper': 'largeTextAndGraphics', 'hand/sheet': 'largeTextAndGraphics', 'ref/sheet': 'largeTextAndGraphics',
  'under/sheet': 'largeTextAndGraphics', 'frame/sheet': 'largeTextAndGraphics', 'frame/paper': 'largeTextAndGraphics', 'wall4/paper': 'largeTextAndGraphics',
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

// ---- 求助梯子：帮助层 × 笺面 / 本人墨，三种色觉模拟（D53 ①，第三轮 V3-01 / T3-02；取代 W1 的「淡填充 + ink3 外廓」口径）
// 屏上真实的一对：帮助层 = --danzhu **不透明**实填（没有整层 .4、没有灰外廓）画在笺面上，本人墨 = --hand 不压暗（inkOpacity 恒 1）压在它上面。
// 要求：淡朱实填对笺面 ≥ 3:1（看得见）、对本人墨 ≥ 3:1（本人墨压上去仍分得清），浅 / 深、正常 / 红色盲 / 绿色盲；
// 再要求本人墨比淡朱更「深」（对笺面的对比度更高），灰度下第一眼看到的只能是本人的墨。
import { HINT_DRAW } from '../../src/ui/screens/write/hint-layer.js';
import * as glyphMod from '../../src/ui/canvas/glyph.js';

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

for (const theme of ['light', 'dark']) {
  for (const vision of Object.keys(VISIONS)) {
    test(`${theme} · ${vision}: opaque danzhu wash × sheet ≥ 3:1 and × own ink ≥ 3:1; own ink stands out more than the wash (D53 ①)`, () => {
      const sheet = colorOf(theme, 'sheet');
      const hand = colorOf(theme, 'hand');
      const fill = colorOf(theme, 'danzhu'); // 不透明实填：屏上的颜色就是令牌本身
      assert.ok(th.hintAndTrace >= 3 && th.hintVsHand >= 3, 'thresholds are 3:1');
      const fillSheet = contrastUnder(fill, sheet, vision);
      assert.ok(fillSheet >= th.hintAndTrace, `${theme}/${vision}: wash × sheet ${fillSheet.toFixed(2)} < ${th.hintAndTrace}`);
      const fillInk = contrastUnder(fill, hand, vision);
      assert.ok(fillInk >= th.hintVsHand, `${theme}/${vision}: wash × own ink ${fillInk.toFixed(2)} < ${th.hintVsHand}`);
      const inkSheet = contrastUnder(hand, sheet, vision);
      assert.ok(inkSheet > fillSheet + 3, `${theme}/${vision}: own ink × sheet ${inkSheet.toFixed(2)} must clearly beat the wash × sheet ${fillSheet.toFixed(2)} (own ink is the first focus)`);
    });
  }
}

test('the hint never dims the writer\'s ink and draws no grey ring: opaque wash only (D53 ①)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/screens/write/hint-layer.js'), 'utf8');
  assert.ok(!/INK_DIM_OPACITY\s*=/.test(src), 'INK_DIM_OPACITY is removed');
  assert.ok(/inkOpacity:\s*1,/.test(src), 'inkOpacity is a constant 1');
  assert.equal(HINT_DRAW.opacity, 1, 'the whole hint group is shown at full strength');
  assert.equal(glyphMod.TRACE_FILL_ALPHA, undefined, 'no whole-layer 0.4 any more: the wash is opaque');
  assert.equal(glyphMod.drawGlyphRing, undefined, 'the ink3 outer ring is gone');
  assert.equal(glyphMod.RING_OUTER_UNITS, undefined);
  const wash = fs.readFileSync(path.join(ROOT, 'src/ui/canvas/glyph-wash.js'), 'utf8');
  assert.ok(!/--ink3/.test(wash.replace(/\/\/.*$/gm, '')), 'glyph-wash.js paints with --danzhu only (no ink3)');
});

// ---- R2-A1（A2-12）：格框直接画在纸面上时（题面目标格、结果作品外框）也要 ≥ 3:1——不只对笺面
for (const theme of ['light', 'dark']) {
  test(`${theme}: frame on paper (a frame drawn straight on the page) and on the sheet are both ≥ 3:1`, () => {
    const frame = colorOf(theme, 'frame');
    assert.ok(contrast(frame, colorOf(theme, 'paper')) >= th.largeTextAndGraphics, `${theme} frame/paper ${contrast(frame, colorOf(theme, 'paper')).toFixed(2)}`);
    assert.ok(contrast(frame, colorOf(theme, 'sheet')) >= th.largeTextAndGraphics, `${theme} frame/sheet`);
  });
}

test('light frame is no longer the 2.91:1 value #9C8A74 on paper (A2-12)', () => {
  assert.ok(contrast(colorOf('light', 'frame'), colorOf('light', 'paper')) >= 3.2, 'light frame/paper ≥ 3.2');
  assert.notEqual(tokens.color.light.frame.toUpperCase(), '#9C8A74');
});

// ---- R2-A1（A2-07）：小字保底——--fs11 / --fs13（和它们的行高）在系统字号偏小档不缩到 11 / 12px 以下
test('--fs11 / --fs13 carry a max() floor of 11px / 12px, line heights 16px / 18px (A2-07)', () => {
  const base = parseTokenDecls(read('src/config/tokens.css')).filter(x => x.selectors.length === 1 && x.selectors[0] === ':root');
  const val = name => (base.find(x => x.name === name) || {}).value;
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  assert.equal(norm(val('--fs11')), 'max(11px, calc(11px * var(--k)))');
  assert.equal(norm(val('--fs13')), 'max(12px, calc(13px * var(--k)))');
  assert.equal(norm(val('--lh11')), 'max(16px, calc(16px * var(--k)))');
  assert.equal(norm(val('--lh13')), 'max(18px, calc(20px * var(--k)))');
  const scale = Object.fromEntries(tokens.typography.scale.map(s => [s.level, s]));
  assert.deepEqual([scale[11].minSize, scale[13].minSize], [11, 12]);
  // 其余字阶不加保底（它们在 xS 档本来就 ≥ 12px 的系统最小值）
  for (const level of [34, 28, 22, 17, 15]) assert.equal(scale[level].minSize, undefined, `level ${level} has no floor`);
});
