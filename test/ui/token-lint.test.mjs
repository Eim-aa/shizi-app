// 设计令牌门禁（P1-E1a，D43）：scripts/verify_tokens.mjs 对 src/ui 与 src/config 的检查在这里也跑一遍，并测扫描器自己。
// 并入阶段 0 的 font-floor 单测（A10：字号下限 11px）：字阶最小一级就是 11，而 font-size 只许取字阶，下限自然成立；
// 字格里随格宽变化的字面（cqw / 比例）与装饰字都登记在 EXCEPTIONS（写明理由，过期也报错）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scan, scanText, stripComments, fontSizeOk, radiusOk, findKaiUses, EXCEPTIONS, ZHU_ALLOW, DANZHU_ALLOW_DIRS, FONT_SCALE,
} from '../../scripts/verify_tokens.mjs';
import { T, TEX } from '../../src/ui/components/styles.js';
import { parseTokenDecls } from '../../src/ui/dev/palette.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tokens = JSON.parse(read('docs/design/design-system-v1/tokens.json'));

test('the repository is clean: no off-scale font-size, off-tier radius, stray letter-spacing, colour literal, zhu or legacy token outside the allow-lists', () => {
  const { violations, stale, checked, counts } = scan();
  assert.ok(checked > 80, `scanned ${checked} files`);
  assert.deepEqual(violations.map(v => `${v.rule} ${v.file}:${v.line} ${v.snippet}`), [], JSON.stringify(counts));
  assert.deepEqual(stale.map(e => `${e.rule} ${e.file} ${e.snippet}`), [], 'stale exceptions: delete them from EXCEPTIONS');
});

test('A10 (merged from font-floor): the scale is exactly tokens.json typography.scale and its floor is 11', () => {
  assert.deepEqual([...FONT_SCALE], tokens.typography.scale.map(s => s.size).sort((a, b) => a - b));
  assert.equal(Math.min(...FONT_SCALE), 11);
  assert.equal(tokens.typography.rules.minSize, 11);
  for (const e of EXCEPTIONS) {
    assert.ok(e.why && e.why.length > 8, `exception ${e.file} (${e.rule}) needs a reason`);
    const text = read(e.file);
    assert.ok(text.includes(e.snippet), `exception ${e.file}: snippet no longer in the source (${e.snippet.slice(0, 40)})`);
  }
  for (const [file, why] of Object.entries(ZHU_ALLOW)) {
    assert.ok(why.length > 8, file);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} exists`);
  }
});

test('fontSizeOk: only the seven scale steps, as token or calc(N px * --k)', () => {
  for (const ok of ['${T.fs15}', 'var(--fs34)', 'calc(15px * ${T.k})', 'calc(11px * var(--k))', 'calc(11px * var(--k, 1))', 'calc(11px * ${TAB_SCALE_CAP})', 'inherit']) {
    assert.ok(fontSizeOk(ok), ok);
  }
  for (const bad of ['14px', '15px', '20px', 'calc(14px * ${T.k})', 'calc(26px * var(--k))', 'var(--fs12)', '${T.fs20}', '34cqw', 'clamp(9px, 13cqw, 12px)', '1.1em']) {
    assert.ok(!fontSizeOk(bad), bad);
  }
});

test('radiusOk: 0 / 12 / 24 / 50% and nested calc(radius - inset) only', () => {
  for (const ok of ['0', '12px', '24px', '50%', '${T.rCtl}', 'var(--r-box)', '${T.rBox} ${T.rBox} 0 0', 'calc(var(--r-ctl) - 3px)', 'calc(${T.rCtl} - 3px)', '0 0 12px 12px']) {
    assert.ok(radiusOk(ok), ok);
  }
  for (const bad of ['2px', '4px', '6px', '9px', '14px', '16px', '18px', '20px', '28px', '32px', '13px']) {
    assert.ok(!radiusOk(bad), bad);
  }
});

test('scanText: colour literals are only allowed in tokens.css; comments are ignored', () => {
  assert.equal(scanText('src/config/tokens.css', 'a{color:#A6533F;background:rgba(0,0,0,.5)}').length, 0);
  const hits = scanText('src/ui/screens/x.js', 'const css = `a{color:#A6533F;background:rgba(0,0,0,.5);border:1px solid white}`;');
  assert.deepEqual(hits.map(h => h.rule), ['color', 'color', 'color']);
  assert.equal(scanText('src/ui/screens/x.js', '// color:#A6533F in a comment\n/* rgba(0,0,0,.5) */\nconst a = 1;').length, 0);
  assert.equal(scanText('src/ui/screens/x.js', 'a{color:${T.ink1};background:transparent;fill:currentColor}').length, 0);
});

test('scanText: zhu is allowed only in the allow-listed marks component', () => {
  const css = 'a{background:${T.zhu};color:var(--on-seal);border-color:var(--seal)}';
  assert.equal(scanText('src/ui/components/marks.js', css).filter(h => h.rule === 'zhu').length, 0);
  assert.equal(scanText('src/ui/screens/write/index.js', css).filter(h => h.rule === 'zhu').length, 3);
  // D49 ⑤：朱色只表示写错；淡朱 --danzhu 只许提示 / 描一遍（写字页与字形 canvas），字库墙的空心字等别处不许再用
  assert.equal(scanText('src/ui/screens/write/index.js', 'a{color:${T.danzhu};background:var(--danzhu)}').length, 0, 'danzhu is allowed in the write page (hints, trace)');
  assert.equal(scanText('src/ui/canvas/glyph.js', "glyphColor('--danzhu')").length, 0, 'and in the glyph canvas');
  const wall = scanText('src/ui/screens/library/wall.js', '.sz-lib__g--hollow .sz-lib__char{color:${T.danzhu}}.sz-lib__box{border:1px solid var(--danzhu)}');
  assert.deepEqual(wall.map(h => h.rule), ['zhu', 'zhu'], 'danzhu is rejected in the library wall (hollow chars are ink4 now)');
  assert.equal(scanText('src/ui/screens/library/wall.js', '.sz-lib__g--hollow .sz-lib__char{color:${T.ink4}}').length, 0);
  for (const [dir, why] of Object.entries(DANZHU_ALLOW_DIRS)) {
    assert.ok(why.length > 8, dir);
    assert.ok(fs.existsSync(path.join(ROOT, dir)), `${dir} exists`);
  }
});

test('scanText: letter-spacing must be 0 except in a vertical inscription rule; font-size and radius literals are reported', () => {
  assert.deepEqual(scanText('src/ui/screens/x.js', 'a{letter-spacing:.04em;color:${T.ink1}}').map(h => h.rule), ['letterSpacing']);
  assert.equal(scanText('src/ui/screens/x.js', 'a{writing-mode:vertical-rl;letter-spacing:.2em}').length, 0);
  assert.equal(scanText('src/ui/screens/x.js', 'a{letter-spacing:0}').length, 0);
  assert.deepEqual(scanText('src/ui/screens/x.js', 'a{font-size:15px;border-radius:16px}').map(h => h.rule), ['fontSize', 'radius']);
  assert.deepEqual(scanText('src/ui/dev/x.js', "el('p', { fontSize: '14px', borderRadius: '4px' })").map(h => h.rule), ['fontSize', 'radius']);
  assert.equal(scanText('src/ui/screens/x.js', 'a{font-size:${T.fs15};border-radius:${T.rCtl};line-height:${T.lh15}}').length, 0);
});

test('scanText: pre-D43 token names are reported (var(--i1), T.ar, --serif …)', () => {
  const hits = scanText('src/ui/screens/x.js', 'a{color:var(--i1, #3B2F28);background:${T.c};font-family:var(--serif);outline:2px solid ${T.ar}}');
  assert.deepEqual([...new Set(hits.map(h => h.rule))].sort(), ['color', 'legacy']);
  assert.equal(hits.filter(h => h.rule === 'legacy').length, 4);
});

test('stripComments keeps line numbers and does not eat :// inside strings', () => {
  const src = "const a = 'http://x.test'; // note\n/* two\nlines */ const b = 2;";
  const out = stripComments(src);
  assert.equal(out.split('\n').length, 3);
  assert.ok(out.includes("'http://x.test'"));
  assert.ok(!out.includes('note'));
});

test('T (styles.js) only names tokens that tokens.css defines; TEX is the sheet texture', () => {
  const defined = new Set(parseTokenDecls(read('src/config/tokens.css')).map(d => d.name));
  for (const [key, value] of Object.entries(T)) {
    const m = /^var\((--[\w-]+)\)$/.exec(value);
    assert.ok(m, `T.${key} is a plain var() reference without a fallback`);
    assert.ok(defined.has(m[1]), `T.${key} → ${m[1]} is defined in tokens.css`);
  }
  assert.match(TEX, /background-color:var\(--sheet\)/);
  assert.match(TEX, /background-image:var\(--tex-img\)/);
  assert.match(TEX, /background-size:var\(--tex-size\)/);
});

test('every var(--x) used under src/ui is a token, a base.css variable or a component-local variable', () => {
  const defined = new Set([...parseTokenDecls(read('src/config/tokens.css')), ...parseTokenDecls(read('src/config/base.css'))].map(d => d.name));
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src/ui'));
  const local = new Set();
  const used = new Map();
  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/(?:^|[\s{;(,'"`])(--[\w-]+)\s*:/g)) local.add(m[1]);
    for (const m of text.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) local.add(m[1]);
    for (const m of text.matchAll(/['"`](--[\w-]+)['"`]\s*:/g)) local.add(m[1]);
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) used.set(m[1], path.relative(ROOT, file));
  }
  const unknown = [...used].filter(([name]) => !defined.has(name) && !local.has(name) && !/^--lib-t/.test(name));
  assert.deepEqual(unknown, [], 'var(--x) with no definition anywhere');
});

// ---- 阶段 1 P1-E2：练习字字形单一来源（glyph 规则）
test('glyph rule: every use of the kai font in src/ui and src/core/images is a registered exception (practice chars use PracticeGlyph / paintOutline)', () => {
  const { violations, stale } = scan();
  assert.deepEqual(violations.filter(v => v.rule === 'glyph').map(v => `${v.file}:${v.line} ${v.snippet}`), [], 'unregistered kai-font rule: practice chars must render through PracticeGlyph');
  const registered = EXCEPTIONS.filter(e => e.rule === 'glyph');
  assert.ok(registered.length >= 15, 'the registry lists the seals, words, inputs, brand 拾 and the fallback branches');
  assert.deepEqual(stale.filter(e => e.rule === 'glyph'), [], 'no stale glyph exceptions');
});

test('glyph rule: findKaiUses sees kai CSS rules (selector reported), canvas FONTS.kai code and look-alike practice-glyph rules; ignores other fonts', () => {
  const css = 'a{x:1}\n.sz-foo__char{font-family:${T.kai};font-size:${T.fs28}}\n.sz-bar{font-family:${T.song}}\n@media (x){ .sz-baz .sz-pg{font-family:var(--kai)} }';
  assert.deepEqual(findKaiUses(css).map(u => u.snippet), ['.sz-foo__char', '.sz-baz .sz-pg']);
  assert.deepEqual(findKaiUses('ctx.font = `400 ${size}px ${FONTS.kai}`;\nconst x = 1;').map(u => u.snippet), ['ctx.font = `400 ${size}px ${FONTS.kai}`;']);
  assert.deepEqual(findKaiUses('`.sz-x__glyph{font-family:${T.hei};color:red}\n.sz-y{font-family:${T.hei}}').map(u => u.snippet), ['.sz-x__glyph'], 'a glyph-named rule in another font is flagged too');
  assert.equal(findKaiUses('`.sz-p{font-family:${T.song}}').length, 0);
  const hits = scanText('src/ui/screens/x.js', 'const css = `.sz-lib__char{font-family:${T.kai};color:${T.ink1}}`;');
  assert.deepEqual(hits.map(h => [h.rule, h.snippet]), [['glyph', '.sz-lib__char']]);
  assert.equal(scanText('src/ui/screens/x.js', 'a{font-family:${T.song}}').length, 0);
  // 登记过的例外放行（同一选择器在登记的文件里）
  assert.equal(scanText('src/ui/components/PracticeGlyph.js', 'x`.sz-pg__fb{font-family:${T.kai}}`').filter(h => h.rule === 'glyph').length, 0);
});
