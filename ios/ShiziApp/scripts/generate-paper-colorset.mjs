#!/usr/bin/env node
// A7（G19）：Assets.xcassets/Paper.colorset 从 src/config/tokens.css 的 --p（纸色）生成，浅 / 深各一份。
// 启动屏（Info.plist UILaunchScreen.UIColorName = Paper）与 WebViewController 的底色都读这个颜色集，
// 所以网页纸色改了，只要重跑本脚本（或 --check 报不一致）就能让原生底色跟上，冷启动不会出现底色跳变。
//   node ios/ShiziApp/scripts/generate-paper-colorset.mjs          写 Contents.json
//   node ios/ShiziApp/scripts/generate-paper-colorset.mjs --check  只核对，不一致退出码 1（verify-local.sh 用）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const TOKENS = join(REPO_ROOT, 'src/config/tokens.css');
const OUT = join(HERE, '..', 'ShiziApp', 'Assets.xcassets', 'Paper.colorset', 'Contents.json');

const HEX = /^#([0-9A-Fa-f]{6})$/;

/** 取一个 CSS 块（从 needle 起到配对的右花括号）里第一个 `name:` 的值。 */
function blockValue(css, needle, name) {
  const start = css.indexOf(needle);
  if (start < 0) throw new Error(`tokens.css: ${needle} not found`);
  let depth = 0;
  let end = css.length;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const block = css.slice(start, end);
  const m = block.match(new RegExp(`(^|[\\s{;])${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`tokens.css: ${name} not found in ${needle}`);
  return m[2].trim().replace(/\s*\/\*.*$/, '').toUpperCase();
}

/** tokens.css → { light, dark }（#RRGGBB）。深色取 prefers-color-scheme 那一份，并要求 data-theme="dark" 那份一致。 */
export function paperFromTokens(css) {
  const light = blockValue(css, ':root[data-theme="light"]', '--p');
  const dark = blockValue(css, '@media (prefers-color-scheme: dark)', '--p');
  const darkForced = blockValue(css, ':root[data-theme="dark"]', '--p');
  if (dark !== darkForced) throw new Error(`tokens.css: dark --p differs (${dark} vs ${darkForced})`);
  for (const v of [light, dark]) if (!HEX.test(v)) throw new Error(`tokens.css: --p is not #RRGGBB: ${v}`);
  return { light, dark };
}

function entry(hex, dark) {
  const n = hex.slice(1).toUpperCase();
  const e = {
    color: {
      'color-space': 'srgb',
      components: { alpha: '1.000', blue: `0x${n.slice(4, 6)}`, green: `0x${n.slice(2, 4)}`, red: `0x${n.slice(0, 2)}` },
    },
    idiom: 'universal',
  };
  if (dark) e.appearances = [{ appearance: 'luminosity', value: 'dark' }];
  return e;
}

export function colorsetContents({ light, dark }) {
  return { colors: [entry(light, false), entry(dark, true)], info: { author: 'xcode', version: 1 } };
}

export function render(paper) {
  return `${JSON.stringify(colorsetContents(paper), null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = render(paperFromTokens(readFileSync(TOKENS, 'utf8')));
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== text) {
      console.error('Paper.colorset is out of date with src/config/tokens.css; run: node ios/ShiziApp/scripts/generate-paper-colorset.mjs');
      process.exit(1);
    }
    console.log('Paper.colorset matches tokens.css --p');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
  }
}
