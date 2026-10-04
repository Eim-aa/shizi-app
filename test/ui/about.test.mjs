// M4-6 关于：credits 生成器（从 NOTICES + 许可全文逐字生成、幂等、生成物与仓库一致）、关于页三行与三个子页的视图、屏幕注册。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildCredits, renderModule, generate, splitTitle, detectLicense, detectKind, plainNotice, OUT_PATH,
} from '../../scripts/build_credits.mjs';
import { CREDITS, LICENSE_TEXTS } from '../../src/config/credits.js';
import {
  ABOUT_SCREEN, ABOUT_PRIVACY_SCREEN, ABOUT_CREDITS_SCREEN, ABOUT_LETTER_SCREEN,
  aboutRows, privacyParagraphs, creditGroups, creditFullText, creditName, stripArrow,
  AboutView, PrivacyView, CreditsView, LetterView, BuildLineView, buildDay, versionTexts,
} from '../../src/ui/screens/mine/about.js';
import { getScreen } from '../../src/ui/router.js';
import { t } from '../../src/config/copy/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(n => walk(n, visit));
    return;
  }
  visit(node);
  walk(node.props && node.props.children, visit);
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props && node.props.children);
}

function allByTestid(vnode, id) {
  const out = [];
  walk(vnode, n => {
    if (n.props && n.props['data-testid'] === id) out.push(n);
  });
  return out;
}

const SAMPLE = `# Third-Party Notices

## Foo Lib 1.2.3 (core)

\`vendor/foo.js\` vendors [\`acme/foo\`](https://github.com/acme/foo).

Foo is licensed under the MIT License. The complete license text is included at
\`licenses/foo-LICENSE.txt\`.

## Bar data

Data from [bar](https://example.org/bar), licensed under Apache License
2.0. A copy is included at \`sources/LICENSE-APACHE-2.0.txt\` and again \`sources/LICENSE-APACHE-2.0.txt\`.

## ShiziKai 1.0

SIL OPEN FONT LICENSE Version 1.1 text follows.
`;

test('buildCredits: one item per ## section, name / version / url / license / kind / license files read verbatim', () => {
  const files = { 'licenses/foo-LICENSE.txt': 'MIT text\r\n\n', 'sources/LICENSE-APACHE-2.0.txt': 'Apache text' };
  const { credits, licenseTexts } = buildCredits(SAMPLE, p => (p in files ? files[p] : null));
  assert.deepEqual(credits.map(c => c.id), ['foo-lib-1-2-3', 'bar-data', 'shizikai-1-0']);
  assert.deepEqual(credits.map(c => [c.name, c.version]), [['Foo Lib', '1.2.3'], ['Bar data', ''], ['ShiziKai', '1.0']]);
  assert.deepEqual(credits.map(c => c.kind), ['code', 'data', 'font']);
  assert.deepEqual(credits.map(c => c.license), ['MIT License', 'Apache License 2.0', 'SIL Open Font License 1.1'],
    'license names detected across a line break');
  assert.deepEqual(credits.map(c => c.url), ['https://github.com/acme/foo', 'https://example.org/bar', '']);
  assert.deepEqual(credits[1].licenseFiles, ['sources/LICENSE-APACHE-2.0.txt'], 'a file referenced twice is listed once');
  assert.deepEqual(Object.keys(licenseTexts), ['licenses/foo-LICENSE.txt', 'sources/LICENSE-APACHE-2.0.txt']);
  assert.equal(licenseTexts['licenses/foo-LICENSE.txt'], 'MIT text\n', 'CRLF normalised, trailing blank lines trimmed');
  assert.ok(credits[0].notice.startsWith('vendor/foo.js vendors acme/foo (https://github.com/acme/foo).'),
    'markdown links and code spans flattened for display');
  // 不存在的许可文件不收
  const missing = buildCredits(SAMPLE, () => null);
  assert.deepEqual(missing.credits[0].licenseFiles, []);
  assert.deepEqual(missing.licenseTexts, {});
  // 渲染确定：同输入同输出
  assert.equal(renderModule(buildCredits(SAMPLE, p => files[p] ?? null)), renderModule(buildCredits(SAMPLE, p => files[p] ?? null)));
});

test('helpers: splitTitle / detectLicense / detectKind / plainNotice', () => {
  assert.deepEqual(splitTitle('Preact 10.29.8 (core and hooks)'), { name: 'Preact', version: '10.29.8' });
  assert.deepEqual(splitTitle('LXGW WenKai 1.522'), { name: 'LXGW WenKai', version: '1.522' });
  assert.deepEqual(splitTitle('Shuowen.org data'), { name: 'Shuowen.org data', version: '' });
  assert.equal(detectLicense('under GNU LGPL version 3'), 'GNU LGPL 3.0 or later');
  assert.equal(detectLicense('the Arphic Public\nLicense'), 'Arphic Public License');
  assert.equal(detectLicense('nothing here'), '');
  assert.equal(detectKind('X 1.0', 'uses `vendor/x.js`', 'MIT License'), 'code');
  assert.equal(detectKind('Data 2.0', 'derived from Arphic fonts', 'Arphic Public License'), 'data');
  assert.equal(detectKind('ShiziSerifSC 1.0', 'fonts', ''), 'font');
  assert.equal(plainNotice('\n\n`a` [b](https://c.d)\n\n'), 'a b (https://c.d)');
  assert.equal(plainNotice('one\ntwo\n\n- x\n  y\n- z'), 'one two\n\n- x y\n- z', 'soft line breaks joined, paragraphs and list items kept');
});

test('src/config/credits.js is exactly what the generator produces from the repo (idempotent, not stale)', () => {
  const committed = fs.readFileSync(path.join(ROOT, OUT_PATH), 'utf8');
  assert.equal(generate(ROOT), committed, 'run node scripts/build_credits.mjs');
  assert.equal(generate(ROOT), generate(ROOT));
  // --check 退出码 0，且不改文件
  const before = fs.statSync(path.join(ROOT, OUT_PATH)).mtimeMs;
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build_credits.mjs'), '--check'], { stdio: 'pipe' });
  assert.equal(fs.statSync(path.join(ROOT, OUT_PATH)).mtimeMs, before);
});

test('--check fails on a stale output without touching it (copy of the repo inputs in a temp dir)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credits-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'src/config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/build_credits.mjs'), path.join(dir, 'scripts/build_credits.mjs'));
    fs.writeFileSync(path.join(dir, 'THIRD_PARTY_NOTICES.md'), SAMPLE);
    const run = args => execFileSync(process.execPath, [path.join(dir, 'scripts/build_credits.mjs'), ...args], { stdio: 'pipe' });
    assert.throws(() => run(['--check']), 'missing output → --check fails');
    assert.ok(!fs.existsSync(path.join(dir, OUT_PATH)));
    run([]);
    const first = fs.readFileSync(path.join(dir, OUT_PATH), 'utf8');
    run([]);
    assert.equal(fs.readFileSync(path.join(dir, OUT_PATH), 'utf8'), first, 'second run: no diff');
    run(['--check']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('credits data: Preact / htm / Hanzi Writer / ts-fsrs and the data sources are listed, license texts from licenses/ embedded', () => {
  const names = CREDITS.map(c => c.name);
  for (const n of ['Preact', 'htm', 'Hanzi Writer', 'ts-fsrs', 'Hanzi Writer Data', 'Shuowen.org data']) assert.ok(names.includes(n), n);
  const preact = CREDITS.find(c => c.name === 'Preact');
  assert.equal(preact.kind, 'code');
  assert.equal(preact.license, 'MIT License');
  assert.equal(LICENSE_TEXTS['licenses/preact-LICENSE.txt'], fs.readFileSync(path.join(ROOT, 'licenses/preact-LICENSE.txt'), 'utf8').replace(/\s+$/, '') + '\n');
  assert.equal(CREDITS.find(c => c.name === 'htm').license, 'Apache License 2.0');
  assert.equal(CREDITS.find(c => c.name === 'Hanzi Writer Data').license, 'Arphic Public License');
  assert.ok(creditFullText(preact).includes('Copyright (c) 2015-present Jason Miller'));
  assert.equal(creditName(preact), `Preact ${preact.version}`);
  for (const c of CREDITS) {
    assert.ok(c.license, `${c.name} has a license`);
    for (const f of c.licenseFiles) assert.ok(LICENSE_TEXTS[f], f);
  }
});

test('about page: three rows (隐私 / 开源资料 · 致谢 / 给我们写信) from R-AB01, each a button with a readable name, pushing its sub-page', () => {
  const rows = aboutRows();
  assert.deepEqual(rows.map(r => r.to), [ABOUT_PRIVACY_SCREEN, ABOUT_CREDITS_SCREEN, ABOUT_LETTER_SCREEN]);
  assert.deepEqual(rows.map(r => r.label), ['隐私', '开源资料 · 致谢', '给我们写信']);
  assert.equal(rows[0].value, '记录只存在这台手机上 ›');
  assert.deepEqual(rows.map(r => r.aria), ['隐私，记录只存在这台手机上', '开源资料 · 致谢', '给我们写信']);
  assert.equal(stripArrow(t('R-AB01.openSourceRow')), t('X-ABOUT.creditsTitle'));

  const opened = [];
  const vnode = AboutView({ onOpen: to => opened.push(to) });
  assert.equal(vnode.props.title, '关于拾字');
  assert.equal(vnode.props.testid, 'about-screen');
  assert.equal(textOf(allByTestid(vnode, 'about-name')[0]), '拾字');
  assert.equal(textOf(allByTestid(vnode, 'about-motto')[0]), '提笔忘字，不是忘了，只是很久没写。');
  assert.equal(allByTestid(vnode, 'about-seal')[0].props['aria-hidden'], 'true');
  for (const key of ['privacy', 'credits', 'letter']) {
    const [btn] = allByTestid(vnode, `about-row-${key}`);
    assert.ok(btn, key);
    assert.ok(btn.props['aria-label'], `${key} has an accessible name`);
    btn.props.onClick({ timeStamp: 1e9 });
  }
  assert.deepEqual(opened, [ABOUT_PRIVACY_SCREEN, ABOUT_CREDITS_SCREEN, ABOUT_LETTER_SCREEN]);
});

test('sub-pages: privacy paragraphs, credits groups (code → data → font), letter transitional note (P21)', () => {
  const priv = PrivacyView();
  assert.equal(priv.props.title, '隐私');
  assert.deepEqual(allByTestid(priv, 'about-privacy-p').map(textOf), privacyParagraphs());
  assert.equal(privacyParagraphs().length, 4);

  const groups = creditGroups();
  assert.deepEqual(groups.map(g => g.kind), ['code', 'data', 'font']);
  assert.deepEqual(groups.map(g => g.title), ['程序', '字形和字源', '字体']);
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), CREDITS.length);
  assert.deepEqual(creditGroups(CREDITS.filter(c => c.kind === 'code')).map(g => g.kind), ['code'], 'empty groups are left out');
  const cred = CreditsView();
  assert.equal(cred.props.title, '开源资料 · 致谢');
  assert.equal(allByTestid(cred, 'about-credits-group').length, 3);

  const letter = LetterView();
  assert.equal(letter.props.title, '给我们写信');
  const [addr] = allByTestid(letter, 'about-letter-address');
  assert.equal(textOf(addr), t('R-AB01.letterAddressPending'));
  assert.equal(addr.props['data-pending'], 'P21');
});

test('screens registered: about + three sub-pages', () => {
  for (const name of [ABOUT_SCREEN, ABOUT_PRIVACY_SCREEN, ABOUT_CREDITS_SCREEN, ABOUT_LETTER_SCREEN]) {
    const def = getScreen(name);
    assert.ok(def, name);
    assert.equal(def.tab, false);
  }
});

test('B7 (G43, D36): version line 「版本 1.0（20261001）」 from VERSION + the date part of BUILD; full BUILD on tap, selectable', () => {
  assert.equal(buildDay('20261001-abcdef123456'), '20261001');
  assert.equal(buildDay('weird'), 'weird');
  const v = versionTexts('1.0', '20261001-abcdef123456');
  assert.equal(v.line, '版本 1.0（20261001）');
  assert.equal(v.full, '构建号 20261001-abcdef123456');
  assert.equal(v.aria, '版本 1.0，构建日期 20261001，点按显示完整构建号');
  // 折叠：只有版本行按钮，没有完整 BUILD
  const closed = BuildLineView({ open: false, onToggle: () => {}, version: '1.0', build: '20261001-abcdef123456' });
  const [btn] = allByTestid(closed, 'about-build');
  assert.equal(btn.props['aria-expanded'], 'false');
  assert.equal(textOf(btn), '版本 1.0（20261001）');
  assert.equal(allByTestid(closed, 'about-build-full').length, 0);
  // 展开：完整 BUILD 一行
  const open = BuildLineView({ open: true, onToggle: () => {}, version: '1.0', build: '20261001-abcdef123456' });
  assert.equal(allByTestid(open, 'about-build')[0].props['aria-expanded'], 'true');
  assert.equal(textOf(allByTestid(open, 'about-build-full')[0]), '构建号 20261001-abcdef123456');
  // 点按触发 onToggle
  let n = 0;
  allByTestid(BuildLineView({ open: false, onToggle: () => { n += 1; } }), 'about-build')[0].props.onClick({ timeStamp: 1e9 });
  assert.equal(n, 1);
  // 默认值取 build-info.js 的 VERSION / BUILD
  const live = versionTexts();
  assert.match(live.line, /^版本 \d+\.\d+\.\d+（\d{8}）$/);
  assert.ok(live.full.startsWith('构建号 ') && /\d{8}-[0-9a-f]{12}$/.test(live.full));
});

test('C1 / P197: the privacy network sentence depends on the platform (iOS shell never goes online; web says what it fetches)', () => {
  const ios = privacyParagraphs({ native: true });
  const web = privacyParagraphs({ native: false });
  assert.equal(ios.length, 4);
  assert.equal(ios[2], '拾字不联网，你的记录不会离开这台手机。');
  assert.equal(web[2], '网页版联网只用来更新拾字和取字的笔顺，不会带上你的记录。');
  assert.ok(!ios.some(p => p.includes('联网只用来')), 'the iOS page never claims it goes online');
  assert.deepEqual(ios.filter((_, i) => i !== 2), web.filter((_, i) => i !== 2), 'the other three paragraphs are the same');
  assert.deepEqual(privacyParagraphs(), web, 'node / browser without the native bridge = web');
  const prev = globalThis.webkit;
  globalThis.webkit = { messageHandlers: { shiziNative: {} } };
  try {
    assert.equal(privacyParagraphs()[2], ios[2], 'the native bridge selects the iOS sentence');
    assert.equal(textOf(allByTestid(PrivacyView(), 'about-privacy-p')[2]), ios[2]);
  } finally {
    if (prev === undefined) delete globalThis.webkit;
    else globalThis.webkit = prev;
  }
});
