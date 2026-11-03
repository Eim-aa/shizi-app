#!/usr/bin/env node
// A7（G19）：Assets.xcassets/Paper.colorset 从 ShiziKit/Generated/ShiziKitTokens.json 的 colors.light.paper / colors.dark.paper 生成（D84：该 JSON 是手改的唯一真相源，
// 不再读网页的 tokens.css），浅 / 深各一份。启动屏（Info.plist UILaunchScreen.UIColorName = Paper）与原生根视图的底色都读这个颜色集，
// 所以纸色改了，只要重跑本脚本（或 --check 报不一致）就能让原生底色跟上，冷启动不会出现底色跳变。
//   node ios/ShiziApp/scripts/generate-paper-colorset.mjs          写 Contents.json
//   node ios/ShiziApp/scripts/generate-paper-colorset.mjs --check  只核对，不一致退出码 1（verify-local.sh 用）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, '..', 'ShiziApp', 'ShiziKit', 'Generated', 'ShiziKitTokens.json');
const OUT = join(HERE, '..', 'ShiziApp', 'Assets.xcassets', 'Paper.colorset', 'Contents.json');

const HEX = /^#([0-9A-Fa-f]{6})$/;

/** ShiziKitTokens.json（已解析）→ { light, dark }（#RRGGBB，大写）。 */
export function paperFromTokens(tokens) {
  const light = String(tokens?.colors?.light?.paper ?? '').toUpperCase();
  const dark = String(tokens?.colors?.dark?.paper ?? '').toUpperCase();
  for (const v of [light, dark]) if (!HEX.test(v)) throw new Error(`ShiziKitTokens.json: colors.*.paper is not #RRGGBB: ${v}`);
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
  const text = render(paperFromTokens(JSON.parse(readFileSync(TOKENS, 'utf8'))));
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== text) {
      console.error('Paper.colorset is out of date with ShiziKitTokens.json; run: node ios/ShiziApp/scripts/generate-paper-colorset.mjs');
      process.exit(1);
    }
    console.log('Paper.colorset matches ShiziKitTokens.json paper');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
  }
}
