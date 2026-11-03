// App 包资源清单（scripts/app-bundle-manifest.txt，`pnpm run build:manifest` 生成）与关于页版本行的来源（D84 卡 B）。
// 网页壳清单 / sw-manifest.js / src/build-info.js / index.html 的生成与测试已停（文件冻结，删网页时一起删）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, APP_MANIFEST_PATH, APP_BUNDLE_ROOTS, plan } from '../scripts/build_shell_manifest.mjs';

const read = rel => readFileSync(join(ROOT, rel), 'utf8');

test('app bundle manifest is up to date (pnpm run build:manifest)', () => {
  for (const { rel, text } of plan().outputs) {
    const onDisk = existsSync(join(ROOT, rel)) ? read(rel) : null;
    assert.equal(onDisk, text, `${rel} is stale — run: pnpm run build:manifest`);
  }
});

test('B4.9: the iOS bundle manifest lists only what native code reads (data / fonts / licenses) — no JS, no web shell, no private content', () => {
  const app = read(APP_MANIFEST_PATH).split('\n').filter(Boolean);
  assert.deepEqual(APP_BUNDLE_ROOTS, ['data/', 'fonts/', 'licenses/']);
  for (const rel of app) {
    assert.ok(APP_BUNDLE_ROOTS.some(root => rel.startsWith(root)), `not an app-bundle root: ${rel}`);
    assert.ok(existsSync(join(ROOT, rel)), `listed but missing: ${rel}`);
  }
  for (const rel of ['fonts/ShiziKai-Regular.woff2', 'fonts/ShiziSerifSC-Medium.woff2', 'fonts/ShiziSerifSC-Regular.woff2', 'data/etymology.json', 'data/LICENSE.md']) {
    assert.ok(app.includes(rel), rel);
  }
  assert.ok(app.filter(rel => /^data\/.+\.json$/.test(rel)).length >= 7218, 'all stroke JSON in the bundle');
  assert.ok(!app.some(rel => /^(src|vendor)\//.test(rel) || /\.(js|mjs|html|webmanifest)$/.test(rel)), 'no JS / web shell in the bundle');
  assert.ok(!app.some(rel => rel.includes('context-overrides')), 'the context overrides live in scripts/content/ (D84), not data/');
});

test('D84: the about-page version line comes from MARKETING_VERSION and git HEAD, not src/build-info.js', () => {
  const sync = read('ios/ShiziApp/scripts/sync-web-assets.sh');
  assert.doesNotMatch(sync.replace(/^#.*$/gm, ''), /build-info\.js\b|src\//, 'sync-web-assets.sh reads nothing from src/');
  assert.match(sync, /MARKETING_VERSION/);
  assert.match(sync, /rev-parse --short=12 HEAD/);
  assert.match(sync, /\^\[0-9\]\{8\}-\[0-9a-f\]\{12\}\$/, 'BUILD keeps the <yyyymmdd>-<12 hex> shape the about page parses');
  assert.match(read('ios/ShiziApp/Config/Shared.xcconfig'), /^MARKETING_VERSION = \d+\.\d+\.\d+$/m);
});
