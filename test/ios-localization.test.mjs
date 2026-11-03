// 审查整改 P0-C / A6（G18）：iOS 壳的中文本地化。不编译 Xcode 工程，只对 ios/ShiziApp 里的源文件做静态核对；
// 构建产物由 verify-bundle-assets.sh 另行核对。
//   A6：developmentRegion / knownRegions / Info.plist 的 CFBundleDevelopmentRegion + CFBundleLocalizations 都是 zh-Hans；
//       zh-Hans.lproj/InfoPlist.strings 存在、进了工程资源，显示名与相册说明按 03 P100。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IOS = join(ROOT, 'ios/ShiziApp');
const read = rel => readFileSync(join(IOS, rel), 'utf8');

const PHOTO_USAGE = '用于把你保存的练字图片存进系统相册。'; // 03 P100

/** 取 Info.plist 顶层 <key>name</key> 后面的值（string / true / false / array of string / dict 原文）。 */
function plistValue(xml, name) {
  const m = xml.match(new RegExp(`<key>${name}</key>\\s*(<string>([^<]*)</string>|<true/>|<false/>|<array>[\\s\\S]*?</array>|<dict/>|<dict>[\\s\\S]*?</dict>)`));
  assert.ok(m, `Info.plist has ${name}`);
  const raw = m[1];
  if (raw.startsWith('<string>')) return m[2];
  if (raw === '<true/>') return true;
  if (raw === '<false/>') return false;
  if (raw.startsWith('<array>')) return [...raw.matchAll(/<string>([^<]*)<\/string>/g)].map(x => x[1]);
  return raw;
}

function stringsEntries(text) {
  const out = {};
  for (const m of text.matchAll(/^\s*"([^"]+)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/gm)) out[m[1]] = m[2];
  return out;
}

test('A6: Xcode project develops in zh-Hans and knows the zh-Hans region', () => {
  const pbx = read('ShiziApp.xcodeproj/project.pbxproj');
  assert.match(pbx, /developmentRegion = "?zh-Hans"?;/, 'developmentRegion');
  const regions = pbx.match(/knownRegions = \(([\s\S]*?)\);/);
  assert.ok(regions, 'knownRegions block');
  assert.ok(/"?zh-Hans"?,/.test(regions[1]), 'knownRegions includes zh-Hans');
});

test('A6: Info.plist declares zh-Hans as the development region and the only localization', () => {
  const xml = read('ShiziApp/Info.plist');
  assert.equal(plistValue(xml, 'CFBundleDevelopmentRegion'), 'zh-Hans');
  assert.deepEqual(plistValue(xml, 'CFBundleLocalizations'), ['zh-Hans']);
  assert.equal(plistValue(xml, 'CFBundleDisplayName'), '拾字');
});

test('A6: zh-Hans.lproj/InfoPlist.strings carries the display name and the P100 photo usage text, and ships as a resource', () => {
  const rel = 'ShiziApp/zh-Hans.lproj/InfoPlist.strings';
  assert.ok(existsSync(join(IOS, rel)), `${rel} exists`);
  const strings = stringsEntries(read(rel));
  assert.equal(strings.CFBundleDisplayName, '拾字');
  assert.equal(strings.CFBundleName, '拾字');
  assert.equal(strings.NSPhotoLibraryAddUsageDescription, PHOTO_USAGE);
  const xml = read('ShiziApp/Info.plist');
  assert.equal(plistValue(xml, 'NSPhotoLibraryAddUsageDescription'), PHOTO_USAGE, 'Info.plist base value matches (single source: P100)');
  assert.ok(!/NSCameraUsageDescription/.test(xml + read(rel)), 'no camera usage string (P100)');

  const pbx = read('ShiziApp.xcodeproj/project.pbxproj');
  assert.match(pbx, /isa = PBXVariantGroup;[\s\S]*?name = InfoPlist\.strings;/, 'InfoPlist.strings is a variant group');
  assert.match(pbx, /path = "zh-Hans\.lproj\/InfoPlist\.strings"/, 'zh-Hans variant file reference');
  const resources = pbx.match(/\/\* Begin PBXResourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXResourcesBuildPhase section \*\//)[1];
  assert.match(resources, /InfoPlist\.strings in Resources/, 'InfoPlist.strings is in the Resources build phase');
});

test('A6: verify-bundle-assets.sh checks the localization in the built app', () => {
  const sh = read('scripts/verify-bundle-assets.sh');
  assert.match(sh, /zh-Hans\.lproj\/InfoPlist\.strings/);
  assert.match(sh, /CFBundleLocalizations/);
});
