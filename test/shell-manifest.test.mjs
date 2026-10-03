// 生成物新鲜度：scripts/shell-manifest.txt 与 src/build-info.js 必须与重新生成的结果一致
// （改了壳文件先跑 `pnpm run build:manifest`）；deck-meta.js 与 deck-data.js 指纹一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT, MANIFEST_PATH, BUILD_INFO_PATH, plan, parseBuild, buildInfoText, readVersion } from '../scripts/build_shell_manifest.mjs';

test('shell manifest and build-info are up to date', () => {
  for (const { rel, text } of plan().outputs) {
    const onDisk = existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null;
    assert.equal(onDisk, text, `${rel} is stale — run: pnpm run build:manifest`);
  }
});

test('every manifest line exists and required shell files are listed', () => {
  const lines = readFileSync(join(ROOT, MANIFEST_PATH), 'utf8').split('\n').filter(Boolean);
  for (const rel of lines) assert.ok(existsSync(join(ROOT, rel)), `listed but missing: ${rel}`);
  for (const rel of ['index.html', 'deck-data.js', 'core-strokes.js', 'manifest.webmanifest', 'src/app.js',
    'vendor/ui.js', 'vendor/fsrs6.min.js', 'vendor/hanzi-writer.min.js', 'data/context-overrides.js', 'icon-180.png']) {
    assert.ok(lines.includes(rel), `manifest must list ${rel}`);
  }
  assert.ok(lines.filter(rel => /^data\/.+\.json$/.test(rel)).length >= 7294, 'all stroke JSON listed');
});

test('BUILD has the <yyyymmdd>-<12 hex> shape', async () => {
  const { BUILD } = await import('../src/build-info.js');
  const parsed = parseBuild(readFileSync(join(ROOT, BUILD_INFO_PATH), 'utf8'));
  assert.ok(parsed, BUILD);
  assert.equal(BUILD, `${parsed.day}-${parsed.fingerprint}`);
});

test('deck-meta.js fingerprint matches deck-data.js', async () => {
  const { DECK_KEY, DECK_FINGERPRINT } = await import('../src/config/deck-meta.js');
  assert.equal(DECK_KEY, 'shizi.deck.v8105.context2');
  const sha = createHash('sha256').update(readFileSync(join(ROOT, 'deck-data.js'))).digest('hex');
  assert.equal(DECK_FINGERPRINT, sha.slice(0, 12));
});

test('B7: build-info.js carries VERSION (MARKETING_VERSION → package.json fallback → 0.0.0) next to BUILD', () => {
  const info = readFileSync(join(ROOT, BUILD_INFO_PATH), 'utf8');
  assert.match(info, /^export const VERSION = '\d+\.\d+\.\d+';$/m, 'VERSION line is written');
  assert.equal(parseBuild(info).fingerprint.length, 12, 'BUILD still parses');
  assert.equal(info.match(/^export const VERSION = '([^']+)';$/m)[1], readVersion(ROOT));
  assert.equal(buildInfoText('20261001', 'abcdef123456', '1.0').split('\n').slice(-3).join('\n'), "export const BUILD = '20261001-abcdef123456';\nexport const VERSION = '1.0';\n");
  assert.match(buildInfoText('20261001', 'abcdef123456', 'x"; evil'), /VERSION = '0\.0\.0';/, 'an unsafe version string is not written');

  const dir = mkdtempSync(join(tmpdir(), 'shizi-version-'));
  try {
    assert.equal(readVersion(dir), '0.0.0', 'nothing to read');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '2.3.4' }));
    assert.equal(readVersion(dir), '2.3.4', 'package.json fallback');
    mkdirSync(join(dir, 'ios/ShiziApp/Config'), { recursive: true });
    writeFileSync(join(dir, 'ios/ShiziApp/Config/Shared.xcconfig'), 'CURRENT_PROJECT_VERSION = 1\nMARKETING_VERSION = 1.5.0\n');
    assert.equal(readVersion(dir), '1.5.0', 'xcconfig beats package.json');
    mkdirSync(join(dir, 'ios/ShiziApp/ShiziApp.xcodeproj'), { recursive: true });
    writeFileSync(join(dir, 'ios/ShiziApp/ShiziApp.xcodeproj/project.pbxproj'), '\t\t\t\tMARKETING_VERSION = 1.0;\n\t\t\t\tMARKETING_VERSION = 1.0;\n');
    assert.equal(readVersion(dir), '1.0', 'pbxproj beats xcconfig');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
