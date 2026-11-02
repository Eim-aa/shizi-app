// 生成物新鲜度：scripts/shell-manifest.txt 与 src/build-info.js 必须与重新生成的结果一致
// （改了壳文件先跑 `pnpm run build:manifest`）；deck-meta.js 与 deck-data.js 指纹一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT, MANIFEST_PATH, APP_MANIFEST_PATH, APP_BUNDLE_ROOTS, BUILD_INFO_PATH, plan, parseBuild, buildInfoText, readVersion } from '../scripts/build_shell_manifest.mjs';

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
  assert.ok(lines.filter(rel => /^data\/.+\.json$/.test(rel)).length >= 7218, 'all stroke JSON listed');
});

test('B4.9: the iOS bundle manifest lists only what native code reads (data / fonts / licenses) — no JS, no web shell', () => {
  const app = readFileSync(join(ROOT, APP_MANIFEST_PATH), 'utf8').split('\n').filter(Boolean);
  const shell = new Set(readFileSync(join(ROOT, MANIFEST_PATH), 'utf8').split('\n').filter(Boolean));
  assert.deepEqual(APP_BUNDLE_ROOTS, ['data/', 'fonts/', 'licenses/']);
  for (const rel of app) {
    assert.ok(APP_BUNDLE_ROOTS.some(root => rel.startsWith(root)), `not an app-bundle root: ${rel}`);
    assert.ok(shell.has(rel), `app-bundle file is a shell file: ${rel}`);
  }
  assert.equal(app.length, [...shell].filter(rel => APP_BUNDLE_ROOTS.some(root => rel.startsWith(root))).length, 'every shell file under the roots is in the bundle');
  for (const rel of ['fonts/ShiziKai-Regular.woff2', 'fonts/ShiziSerifSC-Medium.woff2', 'fonts/ShiziSerifSC-Regular.woff2', 'data/etymology.json']) assert.ok(app.includes(rel), rel);
  assert.ok(app.filter(rel => /^data\/.+\.json$/.test(rel)).length >= 7218, 'all stroke JSON in the bundle');
  assert.ok(readFileSync(join(ROOT, 'ios/ShiziApp/ShiziApp/Branding/icon-512.png')).equals(readFileSync(join(ROOT, 'icon-512.png'))), 'about-page logo (native resource) = icon-512.png');
  assert.ok(!app.some(rel => /^(src|vendor)\//.test(rel) || /\.(js|html|webmanifest)$/.test(rel) && !rel.startsWith('data/')), 'no JS / web shell in the bundle');
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

// Q3：首屏模块预载。index.html 里紧跟 app.js 入口的 <link rel="modulepreload"> 块 = app.js 静态依赖 + mountApp 的
// import() 目标及其全部静态依赖；冷启动时整张图在解析 HTML / 执行 deck-data.js 时就取好，不再逐层发现。
test('Q3: moduleSpecifiers reads static, re-export, side-effect and dynamic imports (not strings or comments)', async () => {
  const { moduleSpecifiers } = await import('../scripts/build_shell_manifest.mjs');
  const src = [
    "import { a,\n  b } from './a.js';",
    "import './side.js';",
    "import * as ns from '../ns.js';",
    "export { c } from './c.js';",
    "export * from './star.js';",
    "export const s = 'import x from \"./fake.js\"';",
    "// import y from './comment.js';",
    "const lazy = () => import('./lazy.js');",
    'const meta = import.meta.url;',
    "import ext from 'node:fs';",
    "function f() { return Array.from('from'); }",
  ].join('\n');
  assert.deepEqual(moduleSpecifiers(src), {
    statics: ['./a.js', './side.js', '../ns.js', './c.js', './star.js'],
    dynamics: ['./lazy.js'],
  });
});

test('Q3: index.html modulepreloads exactly the boot module graph, right after the app.js entry', async () => {
  const { bootModules, BOOT_ENTRY } = await import('../scripts/build_shell_manifest.mjs');
  const boot = bootModules();
  for (const rel of ['src/store/store.js', 'src/store/migrate.js', 'src/ui/root.js', 'src/ui/screens/home/index.js', 'vendor/ui.js', 'vendor/preact.module.js']) {
    assert.ok(boot.includes(rel), `boot graph includes ${rel}`);
  }
  assert.ok(!boot.includes(BOOT_ENTRY), 'the entry itself is loaded by its <script type="module">');
  assert.ok(!boot.some(rel => rel.startsWith('src/ui/dev/')), 'the ?dev=1 palette is not part of the boot graph');
  assert.ok(!boot.some(rel => rel.startsWith('src/ui/screens/_demo/')), 'test-host-only screens are not preloaded');
  assert.equal(new Set(boot).size, boot.length, 'no duplicates');
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const links = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]);
  assert.deepEqual(links, boot, 'index.html lists the boot graph in discovery order');
  const entryAt = html.indexOf('<script type="module" src="src/app.js"></script>');
  assert.ok(entryAt > 0 && entryAt < html.indexOf('<link rel="modulepreload"'), 'preload block follows the module entry');
  const manifest = new Set(readFileSync(join(ROOT, MANIFEST_PATH), 'utf8').split('\n').filter(Boolean));
  for (const rel of links) assert.ok(manifest.has(rel), `preloaded module ${rel} ships in the shell manifest`);
});

test('Q3: patchIndexModulePreload inserts once and replaces in place (idempotent)', async () => {
  const { patchIndexModulePreload } = await import('../scripts/build_shell_manifest.mjs');
  const base = '<head>\n<script type="module" src="src/app.js"></script>\n</head>\n';
  const once = patchIndexModulePreload(base, ['src/a.js', 'vendor/b.js']);
  assert.match(once, /src\/app\.js"><\/script>\n<!-- shizi:modulepreload[^\n]*-->\n<link rel="modulepreload" href="src\/a\.js">\n<link rel="modulepreload" href="vendor\/b\.js">\n<!-- \/shizi:modulepreload -->\n<\/head>/);
  assert.equal(patchIndexModulePreload(once, ['src/a.js', 'vendor/b.js']), once, 'same list → same bytes');
  const next = patchIndexModulePreload(once, ['src/c.js']);
  assert.equal((next.match(/rel="modulepreload"/g) || []).length, 1, 'old block replaced, not appended');
  assert.throws(() => patchIndexModulePreload('<head></head>', []), /src\/app\.js/);
});
