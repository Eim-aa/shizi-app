// M0-3 设计令牌回归：src/config/tokens.css 必须等于原型四张 TH 表的并集，来源注释的文件与行号必须对得上；
// 深色两遍（prefers-color-scheme / data-theme）逐字一致；base.css / tokens.css 每个声明都带「来源：」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseTokenDecls } from '../src/ui/dev/palette.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROTO = 'docs/design/v10/extracted';
const TABLES = [
  '首页壳-v3-第十稿交接版.dc.html',
  'ShiziScreen-第十稿交接版.dc.html',
  '字库墨墙屏-第十稿交接版.dc.html',
  'ShiziWriteScreen-第十稿交接版.dc.html',
];
const REQUIRED = ['--p', '--c', '--sh', '--off', '--i1', '--i2', '--i3', '--i4', '--i5', '--a', '--ar', '--g',
  '--st1', '--st2', '--scrim', '--hi', '--ref', '--tf', '--tl', '--o', '--ln', '--seal'];

const read = rel => readFileSync(join(ROOT, rel), 'utf8');

/** 原型 TH 表 → { '--key': { light: [{file, line, value}], dark: [...] } } */
function protoUnion() {
  const union = {};
  for (const file of TABLES) {
    const lines = read(`${PROTO}/${file}`).split('\n');
    const start = lines.findIndex(l => /^const TH=\{/.test(l));
    assert.ok(start >= 0, `${file}: no TH table`);
    let end = start;
    while (!/^\};/.test(lines[end])) end++;
    const src = lines.slice(start, end + 1).join('\n').replace(/^const TH=/, '').replace(/;\s*$/, '');
    const TH = vm.runInNewContext(`(${src})`);
    for (const theme of ['light', 'dark']) {
      const from = lines.findIndex((l, i) => i >= start && i <= end && l.trim().startsWith(`${theme}:`));
      for (const [key, value] of Object.entries(TH[theme])) {
        const name = key.startsWith('--') ? key : `--${key}`;
        const re = new RegExp(`(^|[{,])\\s*'?${key.replace(/-/g, '\\-')}'?\\s*:`);
        let line = -1;
        for (let i = from; i <= end; i++) if (re.test(lines[i])) { line = i + 1; break; }
        ((union[name] ??= {})[theme] ??= []).push({ file, line, value: String(value) });
      }
    }
  }
  return union;
}

function normValue(v) {
  const s = String(v).trim().toLowerCase();
  return /^0\.\d+$/.test(s) ? s.slice(1) : s; // 0.6 与 .6 同值
}

function declsByContext(cssText) {
  const ctx = { base: {}, large: {}, light: {}, dark: {}, darkMedia: {} };
  for (const d of parseTokenDecls(cssText)) {
    const s = d.selectors;
    let key = null;
    if (s.length === 1 && s[0] === ':root') key = 'base';
    else if (s.length === 1 && s[0] === ':root[data-large]') key = 'large';
    else if (s.length === 1 && s[0] === ':root, :root[data-theme="light"]') key = 'light';
    else if (s.length === 1 && s[0] === ':root[data-theme="dark"]') key = 'dark';
    else if (s.length === 2 && /prefers-color-scheme: dark/.test(s[0]) && s[1] === ':root:not([data-theme="light"])') key = 'darkMedia';
    assert.ok(key, `unexpected selector context for ${d.name}: ${s.join(' › ')}`);
    ctx[key][d.name] = d;
  }
  return ctx;
}

const tokensCss = read('src/config/tokens.css');
const baseCss = read('src/config/base.css');

test('tokens.css equals the union of the four prototype TH tables, sources cite file + line', () => {
  const union = protoUnion();
  const ctx = declsByContext(tokensCss);
  for (const name of REQUIRED) assert.ok(union[name], `required key ${name} missing from prototype union`);
  for (const [name, byTheme] of Object.entries(union)) {
    for (const theme of ['light', 'dark']) {
      const hits = byTheme[theme];
      const values = new Set(hits.map(h => normValue(h.value)));
      assert.equal(values.size, 1, `${name} ${theme}: prototype tables disagree ${[...values]}`);
      const decl = ctx[theme][name];
      assert.ok(decl, `${name} missing from tokens.css ${theme} block`);
      assert.equal(normValue(decl.value), [...values][0], `${name} ${theme} value`);
      for (const h of hits) {
        assert.ok(h.line > 0, `${name} ${theme}: line not found in ${h.file}`);
        assert.ok(decl.note.includes(`${h.file} L${h.line}`), `${name} ${theme}: note must cite ${h.file} L${h.line}; got ${decl.note}`);
      }
    }
  }
});

test('dark block is written twice identically (prefers-color-scheme and data-theme)', () => {
  const ctx = declsByContext(tokensCss);
  assert.deepEqual(Object.keys(ctx.darkMedia), Object.keys(ctx.dark));
  for (const [name, d] of Object.entries(ctx.dark)) {
    assert.equal(ctx.darkMedia[name].value, d.value, name);
    assert.equal(ctx.darkMedia[name].note, d.note, name);
  }
  assert.deepEqual(Object.keys(ctx.light).sort(), Object.keys(ctx.dark).sort(), 'light and dark define the same keys');
});

test('--hint follows --ar, --k is 1 / 1.3 (data-large), lamp default .05', () => {
  const ctx = declsByContext(tokensCss);
  assert.equal(ctx.base['--hint'].value, 'var(--ar)');
  assert.equal(ctx.base['--k'].value, '1');
  assert.equal(ctx.large['--k'].value, '1.3');
  assert.equal(ctx.base['--lamp'].value, '.05');
});

test('every token declaration carries a 来源 note', () => {
  for (const [file, text] of [['tokens.css', tokensCss], ['base.css', baseCss]]) {
    const decls = parseTokenDecls(text);
    assert.ok(decls.length > 0, file);
    for (const d of decls) assert.match(d.note, /来源：\S/, `${file} ${d.name} has no source note`);
  }
  for (const name of ['--kai', '--serif', '--sans', '--tap', '--safe-top', '--safe-bottom'])
    assert.ok(parseTokenDecls(baseCss).some(d => d.name === name), `base.css defines ${name}`);
});

test('index.html links tokens.css then base.css before any script', () => {
  const html = read('index.html');
  const t = html.indexOf('<link rel="stylesheet" href="src/config/tokens.css">');
  const b = html.indexOf('<link rel="stylesheet" href="src/config/base.css">');
  const s = html.indexOf('<script');
  assert.ok(t > 0 && b > t && (s < 0 || b < s), 'stylesheet order');
});
