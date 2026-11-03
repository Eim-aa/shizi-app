// 审查整改 P0-C / A7（G19）：iOS 启动底色。Assets 里的 Paper 颜色集与 ShiziKitTokens.json 的 colors.*.paper（浅 / 深）同源（D84：该 JSON 是手改的真相源）；
// UILaunchScreen.UIColorName = Paper；RootViewController（B4.9 前是 WebViewController）用 UIColor(named: "Paper")，不再写死 RGB。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paperFromTokens, colorsetContents } from '../ios/ShiziApp/scripts/generate-paper-colorset.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IOS = join(ROOT, 'ios/ShiziApp');
const read = rel => readFileSync(join(IOS, rel), 'utf8');

/** 取 Info.plist 顶层 <key>name</key> 后面的 dict 原文。 */
function plistDict(xml, name) {
  const m = xml.match(new RegExp(`<key>${name}</key>\\s*(<dict/>|<dict>[\\s\\S]*?</dict>)`));
  assert.ok(m, `Info.plist has ${name}`);
  return m[1];
}

test('A7: Paper colorset equals the --paper token (light #F4EFE6 / dark #1B1814; P1-E1a, design system v1)', () => {
  const tokens = JSON.parse(readFileSync(join(IOS, 'ShiziApp/ShiziKit/Generated/ShiziKitTokens.json'), 'utf8'));
  const paper = paperFromTokens(tokens);
  assert.deepEqual(paper, { light: '#F4EFE6', dark: '#1B1814' }, 'ShiziKitTokens.json paper');
  const file = JSON.parse(read('ShiziApp/Assets.xcassets/Paper.colorset/Contents.json'));
  assert.deepEqual(file, colorsetContents(paper), 'Paper.colorset/Contents.json is exactly what the generator emits from ShiziKitTokens.json');
  const [light, dark] = file.colors;
  assert.equal(light.appearances, undefined);
  assert.deepEqual(light.color.components, { alpha: '1.000', red: '0xF4', green: '0xEF', blue: '0xE6' });
  assert.deepEqual(dark.appearances, [{ appearance: 'luminosity', value: 'dark' }]);
  assert.deepEqual(dark.color.components, { alpha: '1.000', red: '0x1B', green: '0x18', blue: '0x14' });
});

test('A7: launch screen uses the Paper colour; the native root background reads the same colour set', () => {
  const xml = read('ShiziApp/Info.plist');
  const launch = plistDict(xml, 'UILaunchScreen');
  assert.match(launch, /<key>UIColorName<\/key>\s*<string>Paper<\/string>/, 'UILaunchScreen.UIColorName = Paper');
  const swift = read('ShiziApp/RootViewController.swift');
  assert.match(swift, /UIColor\(named: "Paper"\)/, 'RootViewController uses UIColor(named: "Paper")');
  assert.ok(!/UIColor\(red: 0\.(937|106)/.test(swift), 'no hard-coded paper RGB left (#EFE7D3 / #1B1813)');
  assert.match(read('scripts/verify-local.sh'), /generate-paper-colorset\.mjs" --check/, 'verify-local.sh checks the colorset against ShiziKitTokens.json');
});

test('A7: verify-bundle-assets.sh checks the launch colour and the colorset in the built app', () => {
  const sh = read('scripts/verify-bundle-assets.sh');
  assert.match(sh, /UILaunchScreen\.UIColorName/);
  assert.match(sh, /generate-paper-colorset\.mjs" --check/);
});
