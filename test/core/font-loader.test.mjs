// 随包字体门禁（M5-2 字体接入，决定-D13；01-架构设计 §8.4；03 P22；D84 改读原生资源）：
//   fonts/ 运行包（三份 WOFF2 + fonts.css + coverage-manifest，都进 App 包）、子集覆盖（文案 copy.json / ShiziKitCopy.json、
//   题记、四库名、题库 word·py·提示（ShiziCore 展开）、字源，缺字为 0，读 coverage-manifest）、语料与构建报告和随包字体一致、许可随包。
//   这是「文案 / 题库新增汉字不在随包字体里」的唯一门禁（Swift 一侧没有等价检查）。
//   D84 删了网页字体加载器 src/data/font-loader.js 的精确字重 / 降级 / canvas 注入测试与 index.html / tokens.css 的网页断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACE_SOURCES, appTexts, codepointsOf, parseUnicodes } from '../../scripts/fonts/build_corpus.mjs';
import { NEEDS_SWIFT } from './helpers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const sha = buf => createHash('sha256').update(buf).digest('hex');
const manifest = JSON.parse(read('fonts/coverage-manifest.json'));
const texts = NEEDS_SWIFT.skip ? {} : await appTexts();

/** 三个随包 face（文件名 = fonts/ 下的 WOFF2；App 的 NativeType 按 PostScript 名注册同一批文件）。 */
const FACES = Object.freeze({
  'ShiziKai:400': Object.freeze({ key: 'ShiziKai:400', family: 'ShiziKai', weight: 400, file: 'ShiziKai-Regular.woff2' }),
  'ShiziSerifSC:400': Object.freeze({ key: 'ShiziSerifSC:400', family: 'ShiziSerifSC', weight: 400, file: 'ShiziSerifSC-Regular.woff2' }),
  'ShiziSerifSC:500': Object.freeze({ key: 'ShiziSerifSC:500', family: 'ShiziSerifSC', weight: 500, file: 'ShiziSerifSC-Medium.woff2' }),
});

/** 文本（NFC）里不在 face 覆盖表中的字（换行 / 制表除外）。 */
function missingGlyphs(face, raw) {
  const supported = new Set(manifest[face].codepoints);
  const chars = Array.from(String(raw ?? '').normalize('NFC'));
  return [...new Set(chars.filter(c => !/[\n\r\t]/u.test(c) && !supported.has(c.codePointAt(0))))]
    .map(char => ({ char, codepoint: `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` }));
}

// ---------------------------------------------------------------- 运行包

test('fonts/ ships exactly the runtime payload (3 WOFF2 + fonts.css + coverage manifest), all in the app bundle manifest', () => {
  const names = readdirSync(join(ROOT, 'fonts')).filter(n => !n.startsWith('.')).sort();
  assert.deepEqual(names, ['ShiziKai-Regular.woff2', 'ShiziSerifSC-Medium.woff2', 'ShiziSerifSC-Regular.woff2', 'coverage-manifest.json', 'fonts.css']);
  for (const face of Object.values(FACES)) {
    const buf = readFileSync(join(ROOT, 'fonts', face.file));
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', `${face.file} is WOFF2`);
  }
  const bundle = read('scripts/app-bundle-manifest.txt').split('\n');
  for (const n of names) assert.ok(bundle.includes(`fonts/${n}`), `fonts/${n} is in the app bundle manifest (run pnpm run build:manifest)`);
});

test('fonts.css: one @font-face per exact face, font-display: swap, url next to the css', () => {
  const css = read('fonts/fonts.css');
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(m => m[1]);
  assert.equal(faces.length, 3);
  const parsed = faces.map(body => ({
    family: /font-family:\s*"([^"]+)"/.exec(body)[1],
    url: /src:\s*url\("\.\/([^"]+)"\)\s*format\("woff2"\)/.exec(body)[1],
    weight: Number(/font-weight:\s*(\d+)/.exec(body)[1]),
    style: /font-style:\s*(\w+)/.exec(body)[1],
    display: /font-display:\s*(\w+)/.exec(body)[1],
  }));
  assert.deepEqual(parsed.map(f => `${f.family}:${f.weight}`).sort(), Object.keys(FACES).sort());
  for (const f of parsed) {
    assert.equal(f.display, 'swap', `${f.family} ${f.weight} font-display swap (01 §8.4)`);
    assert.equal(f.style, 'normal');
    assert.equal(FACES[`${f.family}:${f.weight}`].file, f.url, 'file name matches FACES');
  }
  assert.doesNotMatch(css, /font-weight:\s*\d+\s+\d+/, 'no weight ranges: exact static faces only');
});

// ---------------------------------------------------------------- 覆盖（缺字为 0）

test('coverage manifest: three faces, sorted unique codepoints, file names served from fonts/', () => {
  assert.deepEqual(Object.keys(manifest).sort(), Object.keys(FACES).sort());
  for (const [key, entry] of Object.entries(manifest)) {
    assert.equal(entry.file, FACES[key].file);
    const cps = entry.codepoints;
    assert.ok(Array.isArray(cps) && cps.every(Number.isInteger), `${key} codepoints are integers`);
    assert.ok(cps.every((cp, i) => i === 0 || cp > cps[i - 1]), `${key} codepoints sorted and unique`);
  }
});

for (const [face, sources] of Object.entries(FACE_SOURCES)) {
  for (const source of sources) {
    test(`coverage ${face} ⊇ ${source}: 0 missing glyphs`, NEEDS_SWIFT, () => {
      const text = texts[source];
      assert.ok(codepointsOf(text).size > 0, `${source} is not empty`);
      const missing = missingGlyphs(face, text);
      assert.deepEqual(missing, [], `${face} lacks ${missing.map(m => `${m.char}(${m.codepoint})`).join(' ')} — run node scripts/fonts/build_corpus.mjs and rebuild (scripts/fonts/README.md)`);
    });
  }
}

test('DoD scope: every character of the copy and deck word/py is in all three faces or in ShiziKai as specified', NEEDS_SWIFT, () => {
  const copyKai = missingGlyphs('ShiziKai:400', texts.copy);
  // 宋体要覆盖的文案不含只用黑体显示的键（build_corpus.mjs HEI_ONLY_COPY，P1-E5）
  const copySerif = missingGlyphs('ShiziSerifSC:400', texts.copySerif);
  const copySerifM = missingGlyphs('ShiziSerifSC:500', texts.copySerif);
  const deckKai = missingGlyphs('ShiziKai:400', texts.deckWords + texts.deckPinyin);
  assert.deepEqual([copyKai.length, copySerif.length, copySerifM.length, deckKai.length], [0, 0, 0, 0]);
  assert.ok(codepointsOf(texts.deckWords).size > 3000, 'deck text actually loaded');
  assert.ok(codepointsOf(texts.copy).size > 300, 'copy text actually loaded');
});

test('manifest "missing" lists only source-absent combining marks that no app text needs', NEEDS_SWIFT, () => {
  const needed = new Set([...codepointsOf(Object.values(texts).join('\n'))]);
  for (const [key, entry] of Object.entries(manifest)) {
    for (const m of entry.missing) {
      assert.match(m.name, /^COMBINING /, `${key} missing ${m.cp}`);
      assert.ok(!needed.has(parseInt(m.cp.slice(2), 16)), `${key}: ${m.cp} is needed by app text`);
    }
  }
});

// ---------------------------------------------------------------- 语料、报告、许可

test('font corpus is current (scripts/fonts/build_corpus.mjs --check) and contains the frozen #180 F8 corpus', NEEDS_SWIFT, () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts/fonts/build_corpus.mjs'), '--check'], { stdio: 'pipe' });
  for (const name of ['kai', 'serif']) {
    const f8 = parseUnicodes(read(`scripts/fonts/corpus/f8/${name}-unicodes.txt`));
    const v10 = parseUnicodes(read(`scripts/fonts/corpus/${name}-unicodes.txt`));
    for (const cp of f8) assert.ok(v10.has(cp), `${name} v10 corpus keeps F8 U+${cp.toString(16)}`);
  }
  // P22：Kai 补 ” □
  const kai = parseUnicodes(read('scripts/fonts/corpus/kai-unicodes.txt'));
  assert.ok(kai.has(0x201d) && kai.has(0x25a1));
});

test('build report matches the shipped WOFF2 bytes and the manifest cmap sizes', () => {
  const report = JSON.parse(read('scripts/fonts/reports/build-manifest.json'));
  for (const face of Object.values(FACES)) {
    const row = report.files.find(r => r.path === `assets/${face.file}`);
    assert.ok(row, `${face.file} in build report`);
    const buf = readFileSync(join(ROOT, 'fonts', face.file));
    assert.equal(buf.length, row.bytes);
    assert.equal(sha(buf), row.sha256, `${face.file} bytes = scripts/fonts/reports/build-manifest.json`);
    assert.equal(manifest[face.key].codepoints.length, row.cmap_count);
    assert.equal(row.family, face.family);
    assert.equal(row.weight, face.weight);
  }
});

test('build scripts are the #180 originals; upstream licenses shipped unmodified (SHA = download lock)', () => {
  const lock = JSON.parse(read('scripts/fonts/provenance/download-lock.json'));
  for (const [file, lockPath] of [['licenses/LXGW-WenKai-GB-OFL.txt', 'licenses/LXGW-WenKai-GB-OFL.txt'], ['licenses/Noto-Serif-SC-OFL.txt', 'licenses/Noto-Serif-SC-OFL.txt']]) {
    const row = lock.find(r => r.path === lockPath);
    assert.equal(sha(readFileSync(join(ROOT, file))), row.sha256, `${file} unmodified`);
  }
  assert.ok(existsSync(join(ROOT, 'licenses/Shizi-fonts-COPYRIGHT-NOTICES.md')));
  // origin/pr-180:handoff/r8-foundation/fonts/scripts/* 的 SHA-256（逐字节沿用，只扩大语料）
  const PR180 = {
    'build-fonts.py': '9e7d6f17ec94e6944570824c92eb0a0a0e3a3b90e506806cbbe0506dce1be98e',
    'font_options.py': '3a06ed75a634670f109274a775cf7bb55583b20399301d3f1bd276d286e62bec',
    'diagnose-gpos.py': '6674515b3c3d74f1ee223719d196d189226d7ea5df7bb780a0e9087e2035ee91',
  };
  for (const [name, want] of Object.entries(PR180)) {
    assert.equal(sha(readFileSync(join(ROOT, 'scripts/fonts/scripts', name))), want, `scripts/fonts/scripts/${name} = #180`);
  }
});

test('THIRD_PARTY_NOTICES + credits (ShiziCore Bundled/credits.json) list both fonts with OFL texts and the renaming notice', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /^## LXGW WenKai GB 1\.522 \(renamed ShiziKai\)$/m);
  assert.match(notices, /^## Noto Serif SC 2\.003 \(renamed ShiziSerifSC\)$/m);
  const { CREDITS, LICENSE_TEXTS } = JSON.parse(read('ios/ShiziCore/Sources/ShiziCore/Bundled/credits.json'));
  const fonts = CREDITS.filter(c => c.kind === 'font');
  assert.deepEqual(fonts.map(c => c.name), ['LXGW WenKai GB', 'Noto Serif SC']);
  for (const c of fonts) {
    assert.equal(c.license, 'SIL Open Font License 1.1');
    assert.ok(c.licenseFiles.includes('licenses/Shizi-fonts-COPYRIGHT-NOTICES.md'));
    for (const f of c.licenseFiles) assert.ok(LICENSE_TEXTS[f], `${f} text embedded`);
  }
});
