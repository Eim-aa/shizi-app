// M5-2 字体接入（决定-D13；01-架构设计 §8.4；03 P22）：
//   fonts/ 运行包（三份 WOFF2 + fonts.css swap + coverage-manifest）、子集覆盖（第十稿文案全文 / 题记 / 四库名 / 题库 word·py·提示 / 字源，
//   缺字为 0，读 coverage-manifest）、语料与构建报告和随包字体一致、许可随包；src/data/font-loader.js 精确字重、降级、canvas 注入口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import {
  FACES, FontError, MANIFEST_URL, checkFont, faceKey, firstFamily, inspectText, loadCoverageManifest,
  requireCanvasFont, requireFont, resetFontLoader, validManifest,
} from '../../src/data/font-loader.js';
import { FACE_SOURCES, appTexts, codepointsOf, parseUnicodes } from '../../scripts/fonts/build_corpus.mjs';
import { FONTS, renderSingleGlyph } from '../../src/core/images/render.js';

const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const sha = buf => createHash('sha256').update(buf).digest('hex');
const manifest = JSON.parse(read('fonts/coverage-manifest.json'));
const texts = await appTexts();

// ---------------------------------------------------------------- 运行包

test('fonts/ ships exactly the web runtime payload (3 WOFF2 + fonts.css + coverage manifest), no TTF / scripts / reports', () => {
  const names = readdirSync(join(ROOT, 'fonts')).filter(n => !n.startsWith('.')).sort();
  assert.deepEqual(names, ['ShiziKai-Regular.woff2', 'ShiziSerifSC-Medium.woff2', 'ShiziSerifSC-Regular.woff2', 'coverage-manifest.json', 'fonts.css']);
  for (const face of Object.values(FACES)) {
    const buf = readFileSync(join(ROOT, 'fonts', face.file));
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', `${face.file} is WOFF2`);
  }
  const shell = read('scripts/shell-manifest.txt').split('\n');
  for (const n of names) assert.ok(shell.includes(`fonts/${n}`), `fonts/${n} is in the shell manifest (run pnpm run build:manifest)`);
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
    assert.equal(FACES[`${f.family}:${f.weight}`].file, f.url, 'file name matches font-loader FACES');
  }
  assert.doesNotMatch(css, /font-weight:\s*\d+\s+\d+/, 'no weight ranges: exact static faces only');
});

test('index.html links fonts/fonts.css after base.css and before any script', () => {
  const html = read('index.html');
  const base = html.indexOf('<link rel="stylesheet" href="src/config/base.css">');
  const fonts = html.indexOf('<link rel="stylesheet" href="fonts/fonts.css">');
  assert.ok(base > 0 && fonts > base, 'fonts.css after base.css');
  assert.ok(fonts < html.indexOf('<script'), 'before scripts');
  assert.equal(html.split('fonts/fonts.css').length, 2, 'linked once');
});

test('tokens.css font stacks (P1-E1a: --kai / --song / --hei, moved from base.css) lead with the shipped families; --hei stays system', () => {
  const css = read('src/config/tokens.css');
  assert.match(css, /--kai:\s*"ShiziKai",/);
  assert.match(css, /--song:\s*"ShiziSerifSC",/);
  assert.doesNotMatch(/--hei:[^;]*;/.exec(css)[0], /Shizi/);
  assert.equal(firstFamily(FONTS.kai), 'ShiziKai', 'canvas kai stack (core/images/render.js) leads with ShiziKai');
});

// ---------------------------------------------------------------- 覆盖（缺字为 0）

test('coverage manifest: three faces, sorted unique codepoints, file names served from fonts/', () => {
  assert.ok(validManifest(manifest));
  assert.deepEqual(Object.keys(manifest).sort(), Object.keys(FACES).sort());
  for (const [key, entry] of Object.entries(manifest)) {
    assert.equal(entry.file, FACES[key].file);
    const cps = entry.codepoints;
    assert.ok(cps.every((cp, i) => i === 0 || cp > cps[i - 1]), `${key} codepoints sorted and unique`);
  }
  assert.equal(MANIFEST_URL, 'fonts/coverage-manifest.json');
});

for (const [face, sources] of Object.entries(FACE_SOURCES)) {
  for (const source of sources) {
    test(`coverage ${face} ⊇ ${source}: 0 missing glyphs`, () => {
      const text = texts[source];
      assert.ok(codepointsOf(text).size > 0, `${source} is not empty`);
      const { missing } = inspectText(manifest, face, text);
      assert.deepEqual(missing, [], `${face} lacks ${missing.map(m => `${m.char}(${m.codepoint})`).join(' ')} — run node scripts/fonts/build_corpus.mjs and rebuild (scripts/fonts/README.md)`);
    });
  }
}

test('DoD scope: every character of src/config/copy/ and deck word/py is in all three faces or in ShiziKai as specified', () => {
  const copyKai = inspectText(manifest, 'ShiziKai:400', texts.copy).missing;
  // 宋体要覆盖的文案不含只用黑体显示的键（build_corpus.mjs HEI_ONLY_COPY，P1-E5）
  const copySerif = inspectText(manifest, 'ShiziSerifSC:400', texts.copySerif).missing;
  const copySerifM = inspectText(manifest, 'ShiziSerifSC:500', texts.copySerif).missing;
  const deckKai = inspectText(manifest, 'ShiziKai:400', texts.deckWords + texts.deckPinyin).missing;
  assert.deepEqual([copyKai.length, copySerif.length, copySerifM.length, deckKai.length], [0, 0, 0, 0]);
  assert.ok(codepointsOf(texts.deckWords).size > 3000, 'deck text actually loaded');
});

test('manifest "missing" lists only source-absent combining marks that no app text needs', () => {
  const needed = new Set([...codepointsOf(Object.values(texts).join('\n'))]);
  for (const [key, entry] of Object.entries(manifest)) {
    for (const m of entry.missing) {
      assert.match(m.name, /^COMBINING /, `${key} missing ${m.cp}`);
      assert.ok(!needed.has(parseInt(m.cp.slice(2), 16)), `${key}: ${m.cp} is needed by app text`);
    }
  }
});

// ---------------------------------------------------------------- 语料、报告、许可

test('font corpus is current (scripts/fonts/build_corpus.mjs --check) and contains the frozen #180 F8 corpus', () => {
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

test('THIRD_PARTY_NOTICES + credits list both fonts with OFL texts and the renaming notice', async () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /^## LXGW WenKai GB 1\.522 \(renamed ShiziKai\)$/m);
  assert.match(notices, /^## Noto Serif SC 2\.003 \(renamed ShiziSerifSC\)$/m);
  const { CREDITS, LICENSE_TEXTS } = await import('../../src/config/credits.js');
  const fonts = CREDITS.filter(c => c.kind === 'font');
  assert.deepEqual(fonts.map(c => c.name), ['LXGW WenKai GB', 'Noto Serif SC']);
  for (const c of fonts) {
    assert.equal(c.license, 'SIL Open Font License 1.1');
    assert.ok(c.licenseFiles.includes('licenses/Shizi-fonts-COPYRIGHT-NOTICES.md'));
    for (const f of c.licenseFiles) assert.ok(LICENSE_TEXTS[f], `${f} text embedded`);
  }
});

// ---------------------------------------------------------------- font-loader

function fakeFonts({ loaded = null, reject = null } = {}) {
  const calls = [];
  return {
    calls,
    ready: Promise.resolve(),
    load(font, text) {
      calls.push([font, text]);
      if (reject) return Promise.reject(reject);
      const m = /^(\d+) 32px "([^"]+)"$/.exec(font);
      const face = loaded ? loaded(m[2], Number(m[1])) : { family: m[2], weight: m[1], style: 'normal', status: 'loaded' };
      return Promise.resolve(face ? [face] : []);
    },
    check: () => true,
  };
}

test('faceKey: key / object / CSS stack forms; non-Shizi and undeclared weights → null', () => {
  assert.equal(faceKey('ShiziSerifSC:500'), 'ShiziSerifSC:500');
  assert.equal(faceKey({ family: 'ShiziSerifSC', weight: 400 }), 'ShiziSerifSC:400');
  assert.equal(faceKey('"ShiziKai","LXGW WenKai GB","Kaiti SC",serif'), 'ShiziKai:400');
  assert.equal(faceKey("'ShiziSerifSC', serif", 500), 'ShiziSerifSC:500');
  assert.equal(faceKey(FONTS.label), null, 'system sans stack');
  assert.equal(faceKey('ShiziKai:500'), null, 'no ShiziKai 500');
  assert.equal(faceKey('ShiziSerifSC:700'), null);
});

test('requireFont: exact weight loaded → resolves with NFC text; checks coverage before loading', async () => {
  const fonts = fakeFonts();
  const r = await requireFont('ShiziSerifSC:500', '拾字', { fonts, manifest });
  assert.deepEqual(r, { face: 'ShiziSerifSC:500', family: 'ShiziSerifSC', weight: 500, text: '拾字', normalized: false, degraded: false });
  assert.deepEqual(fonts.calls, [['500 32px "ShiziSerifSC"', '拾字']]);
  const nfc = await requireFont('ShiziKai:400', 'à', { fonts: fakeFonts(), manifest });
  assert.equal(nfc.text, 'à');
  assert.equal(nfc.normalized, true);
});

test('requireFont: a 400 fallback hit for a 500 request is rejected (no implicit fallback)', async () => {
  const fonts = fakeFonts({ loaded: family => ({ family: `"${family}"`, weight: '400', style: 'normal', status: 'loaded' }) });
  await assert.rejects(() => requireFont('ShiziSerifSC:500', '拾', { fonts, manifest }), e => e instanceof FontError && e.code === 'FONT_UNAVAILABLE');
  await assert.rejects(() => requireFont('ShiziKai:400', '拾', { fonts: fakeFonts({ loaded: () => null }), manifest }), /FONT_UNAVAILABLE/);
  await assert.rejects(() => requireFont('ShiziKai:400', '拾', { fonts: fakeFonts({ loaded: f => ({ family: f, weight: 'normal', style: 'normal', status: 'error' }) }), manifest }), /FONT_UNAVAILABLE/);
});

test('requireFont: missing glyph / unreviewed combining mark reject before any load; load failure → FONT_LOAD_FAILED', async () => {
  const fonts = fakeFonts();
  await assert.rejects(() => requireFont('ShiziSerifSC:400', '𠮷', { fonts, manifest }), e => e.code === 'FONT_MISSING_GLYPHS' && e.missing[0].codepoint === 'U+20BB7');
  await assert.rejects(() => requireFont('ShiziKai:400', 'ê̌', { fonts, manifest }), e => e.code === 'FONT_COMBINING_UNREVIEWED');
  assert.equal(fonts.calls.length, 0);
  await assert.rejects(() => requireFont('ShiziKai:400', '字', { fonts: fakeFonts({ reject: new Error('net') }), manifest }), e => e.code === 'FONT_LOAD_FAILED');
  await assert.rejects(() => requireFont('Helvetica', '字', { fonts, manifest }), e => e.code === 'FONT_UNKNOWN_FACE');
});

test('requireFont: manifest unavailable → degraded to document.fonts.load only (still exact-weight checked)', async () => {
  resetFontLoader();
  const fonts = fakeFonts();
  let fetched = 0;
  const failing = async () => { fetched += 1; return { ok: false, status: 404 }; };
  const r = await requireFont('ShiziKai:400', '𠮷', { fonts, fetch: failing });
  assert.equal(r.degraded, true, 'coverage check skipped');
  assert.equal(fetched, 1);
  assert.equal(fonts.calls.length, 1);
  assert.equal(await loadCoverageManifest({ fetch: async () => { throw new Error('offline'); } }), null);
  assert.equal(await loadCoverageManifest({ fetch: async () => ({ ok: true, json: async () => ({ bogus: 1 }) }) }), null, 'bad shape → null');
  const ok = await loadCoverageManifest({ fetch: async url => ({ ok: url === MANIFEST_URL, json: async () => manifest }) });
  assert.equal(ok, manifest);
});

test('checkFont asks document.fonts.check with the exact weight', () => {
  const seen = [];
  const fonts = { check: f => { seen.push(f); return true; } };
  assert.equal(checkFont('ShiziSerifSC:500', { fonts }), true);
  assert.equal(checkFont('Arial', { fonts }), false);
  assert.deepEqual(seen, ['500 16px "ShiziSerifSC"']);
});

test('requireCanvasFont: system stacks pass without loading; Shizi failures warn and resolve (fallback drawing)', async () => {
  const fonts = fakeFonts();
  assert.deepEqual(await requireCanvasFont(FONTS.label, '拾字', { fonts, manifest }), { ok: true, skipped: true });
  assert.equal(fonts.calls.length, 0);
  const ok = await requireCanvasFont(FONTS.kai, '字', { fonts, manifest });
  assert.equal(ok.ok, true);
  assert.equal(ok.face, 'ShiziKai:400');
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a);
  try {
    const bad = await requireCanvasFont(FONTS.kai, '字', { fonts: fakeFonts({ reject: new Error('offline') }), manifest });
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, 'FONT_LOAD_FAILED');
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1);
});

test('core/images/render.js awaits the injected requireFont (seal = ShiziKai 400) before creating the canvas', async () => {
  const order = [];
  const fonts = fakeFonts();
  const fakeCanvas = (width, height) => {
    order.push('canvas');
    const ctx = new Proxy({ font: '' }, {
      get: (t, p) => (p in t ? t[p] : p === 'measureText' ? s => ({ width: [...s].length * 26 }) : () => {}),
      set: (t, p, v) => { t[p] = v; return true; },
    });
    return { width, height, dataset: {}, getContext: () => ctx };
  };
  const points = [[{ x: 100, y: 100, w: 12 }, { x: 240, y: 240, w: 12 }]];
  const out = await renderSingleGlyph({
    points, caption: 'yǒng · 9 月 22 日', signatureText: '拾字', sealText: '字', canvasFactory: fakeCanvas,
    requireFont: async (stack, text) => {
      const r = await requireCanvasFont(stack, text, { fonts, manifest });
      order.push(r.skipped ? 'skip' : `load:${r.face}`);
      return r;
    },
  });
  assert.equal(out.status, 'ready');
  assert.deepEqual(order, ['skip', 'load:ShiziKai:400', 'canvas']);
  assert.deepEqual(fonts.calls, [['400 32px "ShiziKai"', '字']]);
});
