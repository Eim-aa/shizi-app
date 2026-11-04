// ProMotion：正式包的 Info.plist 带 CADisableMinimumFrameDurationOnPhone = true（否则 iPhone 上 CADisplayLink 一律钳在 60Hz，
// 原生书写面 NativeInkView 请求的 120Hz 不生效）；构建脚本不再在 Debug 包里删 / 加这个键（原先只在 SHIZI_NATIVE_INK_120HZ=YES 时加）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IOS = join(ROOT, 'ios/ShiziApp');
const read = rel => readFileSync(join(IOS, rel), 'utf8');

test('ProMotion: Info.plist lifts the 60Hz display-link cap on iPhone (all configurations)', () => {
  const xml = read('ShiziApp/Info.plist');
  assert.match(xml, /<key>CADisableMinimumFrameDurationOnPhone<\/key>\s*<true\/>/);
});

test('ProMotion: build scripts no longer patch CADisableMinimumFrameDurationOnPhone in or out', () => {
  for (const script of ['scripts/sync-web-assets.sh', 'scripts/run-device.sh']) {
    const src = read(script);
    assert.ok(!src.includes('CADisableMinimumFrameDurationOnPhone'), `${script} does not touch the key`);
    assert.ok(!src.includes('SHIZI_NATIVE_INK_120HZ'), `${script} has no SHIZI_NATIVE_INK_120HZ switch`);
  }
});
