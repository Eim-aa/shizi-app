// 设计令牌回归（M0-3，P1-E1a 起改为对 docs/design/design-system-v1/tokens.json 逐键核对，D43）：
// src/config/tokens.css 的颜色（浅 / 深）、字阶、字体栈、间距、圆角、线、触控、动效、纸纹强度必须等于 tokens.json；
// mapping 里标「删除」的旧变量不得再出现；深色三处（媒体查询 / data-theme / .t-dark）逐字一致；每个声明带「来源：」；
// index.html 与 manifest 的 theme-color 同源 --paper。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTokenDecls } from '../src/ui/dev/palette.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const tokens = JSON.parse(read('docs/design/design-system-v1/tokens.json'));
const tokensCss = read('src/config/tokens.css');
const baseCss = read('src/config/base.css');

const LIGHT = ':root, :root[data-theme="light"], .t-light';
const DARK = ':root[data-theme="dark"], .t-dark';

const kebab = s => s.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);

function declsByContext(cssText) {
  const ctx = { base: {}, light: {}, dark: {}, darkMedia: {}, ax: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} } };
  for (const d of parseTokenDecls(cssText)) {
    const s = d.selectors;
    let key = null;
    const axLevel = s.length === 1 ? /^:root\[data-ax="([1-5])"\]$/.exec(s[0]) : null; // D49：AX1–AX5 分级字阶块
    if (axLevel) {
      ctx.ax[axLevel[1]][d.name] = d;
      continue;
    }
    if (s.length === 1 && s[0] === ':root') key = 'base';
    else if (s.length === 1 && s[0] === LIGHT) key = 'light';
    else if (s.length === 1 && s[0] === DARK) key = 'dark';
    else if (s.length === 2 && /prefers-color-scheme: dark/.test(s[0]) && s[1] === ':root:not([data-theme="light"])') key = 'darkMedia';
    assert.ok(key, `unexpected selector context for ${d.name}: ${s.join(' › ')}`);
    ctx[key][d.name] = d;
  }
  return ctx;
}

const ctx = declsByContext(tokensCss);
const norm = v => String(v).replace(/\s+/g, '').toLowerCase();

test('tokens.css colors equal tokens.json color.light / color.dark, key by key', () => {
  for (const theme of ['light', 'dark']) {
    const table = tokens.color[theme];
    for (const [key, value] of Object.entries(table)) {
      const name = `--${kebab(key)}`;
      const decl = ctx[theme][name];
      assert.ok(decl, `${name} missing from the ${theme} block`);
      assert.equal(norm(decl.value), norm(value), `${name} ${theme}`);
      assert.match(decl.note, new RegExp(`tokens\\.json color\\.${theme}\\.${key}$`), `${name} ${theme}: note cites its tokens.json path`);
    }
    // 反向：CSS 里每个颜色令牌都在 tokens.json 里（--elev-shadow / --tex-img 是派生项，另测）
    const derived = new Set(['--elev-shadow', '--tex-img']);
    const known = new Set(Object.keys(table).map(k => `--${kebab(k)}`));
    for (const name of Object.keys(ctx[theme])) if (!derived.has(name)) assert.ok(known.has(name), `${name} (${theme}) is not in tokens.json`);
  }
});

test('elevation shadow and paper texture follow tokens.json shadow / texture', () => {
  // tokens.json 的阴影写「0 -10 30 rgba(…)」（pt），CSS 里补 px
  const px = s => s.replace(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) rgba/g, '$1px $2px $3px rgba');
  assert.equal(norm(ctx.light['--elev-shadow'].value), norm(px(tokens.shadow.light.sheet)));
  assert.equal(norm(ctx.dark['--elev-shadow'].value), norm(px(tokens.shadow.dark.sheet)));
  assert.equal(ctx.light['--tex-img'].value, 'var(--tex-light)');
  assert.equal(ctx.dark['--tex-img'].value, 'var(--tex-dark)');
  // 占位强度：颗粒层的 alpha 取 placeholderStrength.grain；低频云絮层 D51 ⑥ 起删掉（只剩一层）
  for (const theme of ['light', 'dark']) {
    const value = ctx.base[`--tex-${theme}`].value;
    const { grain } = tokens.texture.placeholderStrength[theme];
    assert.ok(value.includes(`0 0 0 ${String(grain).replace(/^0/, '')} 0`), `--tex-${theme} grain layer alpha ${grain}`);
    assert.equal((value.match(/url\("data:/g) || []).length, 1, `--tex-${theme}: the fine grain only (no cloud layer, D51 ⑥)`);
  }
  assert.ok(tokens.texture.never.includes('页面底') && tokens.texture.never.includes('按钮'));
  assert.ok(!/--paper-image|--lamp/.test(tokensCss), 'page dot-grid texture and dark warm lamp are gone (D43)');
});

test('type scale, families, space, radius, line, touch, motion equal tokens.json', () => {
  const base = ctx.base;
  for (const s of tokens.typography.scale) {
    assert.equal(norm(base[`--fs${s.level}`].value), norm(`calc(${s.size}px * var(--k))`), `--fs${s.level}`);
    assert.equal(norm(base[`--lh${s.level}`].value), norm(`calc(${s.lineHeight}px * var(--k))`), `--lh${s.level}`);
    if (s.lineHeightSingle) assert.equal(norm(base[`--lh${s.level}s`].value), norm(`calc(${s.lineHeightSingle}px * var(--k))`), `--lh${s.level}s`);
  }
  assert.deepEqual(tokens.typography.scale.map(s => s.level), [34, 28, 22, 17, 15, 13, 11], 'seven levels');
  const fam = list => list.map(n => (n.startsWith('-') || n === 'serif' || n === 'sans-serif' ? n : `"${n}"`)).join(', ');
  for (const k of ['kai', 'song', 'hei']) assert.equal(base[`--${k}`].value, fam(tokens.typography.family[k]), `--${k}`);
  assert.match(base['--kai'].value, /^"ShiziKai",/);
  assert.match(base['--song'].value, /^"ShiziSerifSC",/);
  assert.doesNotMatch(base['--hei'].value, /Shizi/, 'hei stays the system face');
  assert.equal(base['--k'].value, '1', '--k defaults to 1 (D29: system text size drives it, P130)');
  for (const n of tokens.space.scale) assert.equal(base[`--s${n / 4}`].value, `${n}px`, `--s${n / 4}`);
  assert.equal(base['--gutter'].value, `${tokens.space.gutter}px`);
  assert.equal(base['--r-work'].value, `${tokens.radius.work}px`);
  assert.equal(base['--r-ctl'].value, `${tokens.radius.control}px`);
  assert.equal(base['--r-box'].value, `${tokens.radius.container}px`);
  assert.equal(base['--hair'].value, `${tokens.line.hairline}px`);
  assert.equal(base['--frame-w'].value, `${tokens.line.frame}px`);
  assert.equal(base['--guide-w'].value, `${tokens.line.guide}px`);
  assert.equal(base['--target-w'].value, `${tokens.line.targetCellFrame}px`);
  assert.equal(base['--hit'].value, `${tokens.touch.minHit}px`);
  assert.equal(base['--btn-h'].value, `${tokens.touch.buttonHeight}px`);
  assert.equal(Number(base['--press-scale'].value), tokens.motion.pressScale);
  assert.equal(base['--t-press'].value, `${tokens.motion.pressIn}ms`);
  assert.equal(base['--t-release'].value, `${tokens.motion.release}ms`);
  assert.equal(base['--ease-out'].value, tokens.motion.easeOut);
  assert.deepEqual([tokens.radius.work, tokens.radius.control, tokens.radius.container], [0, 12, 24], 'three radius tiers');
});

test('dark block is written three times identically (prefers-color-scheme, data-theme, .t-dark share the data-theme rule)', () => {
  assert.deepEqual(Object.keys(ctx.darkMedia), Object.keys(ctx.dark));
  for (const [name, d] of Object.entries(ctx.dark)) {
    assert.equal(ctx.darkMedia[name].value, d.value, name);
    assert.equal(ctx.darkMedia[name].note, d.note, name);
  }
  assert.deepEqual(Object.keys(ctx.light).sort(), Object.keys(ctx.dark).sort(), 'light and dark define the same keys');
});

test('mapping: every pre-D43 variable is gone from tokens.css (deleted, renamed or split into the new tokens)', () => {
  const names = new Set(parseTokenDecls(tokensCss).map(d => d.name));
  const KEPT = new Set(['--k', '--scrim', '--ref', '--seal']); // 名字沿用，取值换成新令牌
  for (const old of Object.keys(tokens.mapping)) {
    if (old.startsWith('--') && !KEPT.has(old)) assert.ok(!names.has(old), `${old}: replaced by ${JSON.stringify(tokens.mapping[old].to)} (tokens.json mapping)`);
  }
  for (const old of ['--serif', '--sans', '--tap', '--ease']) assert.ok(!names.has(old), `${old} renamed (--song / --hei / --hit / --ease-out)`);
  // mapping 里的新令牌都已建成 CSS 变量
  for (const key of ['hand', 'under', 'wall1', 'wall2', 'wall3', 'wall4', 'onSeal', 'btnFg', 'toastBg', 'toastFg', 'frame', 'guide', 'danzhu']) {
    assert.ok(names.has(`--${kebab(key)}`), `--${kebab(key)} exists`);
  }
});

test('every token declaration carries a 来源 note', () => {
  for (const [file, text] of [['tokens.css', tokensCss], ['base.css', baseCss]]) {
    const decls = parseTokenDecls(text);
    assert.ok(decls.length > 0, file);
    for (const d of decls) assert.match(d.note, /来源：\S/, `${file} ${d.name} has no source note`);
  }
  for (const name of ['--safe-top', '--safe-bottom', '--motion-page'])
    assert.ok(parseTokenDecls(baseCss).some(d => d.name === name), `base.css defines ${name}`);
  const fontFamilies = parseTokenDecls(tokensCss).filter(d => /^--(kai|song|hei)$/.test(d.name)).map(d => d.name);
  assert.deepEqual(fontFamilies.sort(), ['--hei', '--kai', '--song']);
});

test('index.html links tokens.css then base.css before any script; theme-color metas and the manifest follow --paper', () => {
  const html = read('index.html');
  const t = html.indexOf('<link rel="stylesheet" href="src/config/tokens.css">');
  const b = html.indexOf('<link rel="stylesheet" href="src/config/base.css">');
  const s = html.indexOf('<script');
  assert.ok(t > 0 && b > t && (s < 0 || b < s), 'stylesheet order');
  assert.match(html, new RegExp(`<meta name="theme-color" media="\\(prefers-color-scheme: light\\)" content="${tokens.color.light.paper}">`, 'i'));
  assert.match(html, new RegExp(`<meta name="theme-color" media="\\(prefers-color-scheme: dark\\)" content="${tokens.color.dark.paper}">`, 'i'));
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.background_color.toUpperCase(), tokens.color.light.paper.toUpperCase());
  assert.equal(manifest.theme_color.toUpperCase(), tokens.color.light.paper.toUpperCase());
});

test('base.css: page background is plain paper; texture is only the .tex sheet class', () => {
  const css = baseCss.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.paper,\s*\.paper-layer\s*\{\s*background-color:\s*var\(--paper\);\s*\}/);
  assert.match(css, /\.tex\s*\{[^}]*background-image:\s*var\(--tex-img\)/);
  assert.ok(!/radial-gradient/.test(css), 'no dot-grid / lamp gradients');
});
