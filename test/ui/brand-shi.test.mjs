// 卡 B1：品牌字「拾」的单一来源（src/ui/brand/shi.js）与首页字帖位 BrandShi。
// - 九笔路径、与 docs/design/brand/shi-A1.svg 同源、没有颜色字面量；
// - BrandShi 渲染内联 SVG（currentColor），读屏名称 / data-testid / --cell 不变，不再是文字节点；
// - 图标母版：元素 ID 是 background + shi-glyph（shi-s1…s9），九笔同色，配色取设计令牌。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SHI_PATHS, SHI_VIEWBOX, SHI_VIEW, SHI_UNITS, ShiMark,
  SHI_BOLD_PATHS, SHI_BOLD_TRANSFORM, SHI_BOLD_TRANSFORM_ATTR, SHI_BOLD_CENTER, SHI_SEAL_VIEW, SHI_SEAL_VIEWBOX, ShiSealMark,
} from '../../src/ui/brand/shi.js';
import { BrandShi } from '../../src/ui/screens/home/copybook.js';
import { t } from '../../src/config/copy/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tokens = JSON.parse(read('docs/design/design-system-v1/tokens.json'));

/** 展开 vnode 树（函数组件直接调用）。 */
function walk(vnode, out = { nodes: [], texts: [] }) {
  if (vnode === null || vnode === undefined || typeof vnode === 'boolean') return out;
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    out.texts.push(String(vnode));
    return out;
  }
  if (Array.isArray(vnode)) {
    vnode.forEach(v => walk(v, out));
    return out;
  }
  const { type, props } = vnode;
  if (typeof type === 'function') return walk(type(props), out);
  out.nodes.push({ type, props: props || {} });
  walk(props && props.children, out);
  return out;
}
const find = (tree, type) => tree.nodes.filter(n => n.type === type);

test('brand shi: nine strokes, closed outlines, no colour literal anywhere in the module', () => {
  assert.equal(SHI_PATHS.length, 9);
  for (const d of SHI_PATHS) {
    assert.match(d, /^M[\d.\s,CLZ-]+Z$/, 'a single closed cubic outline per stroke');
    assert.ok(!/[#]|rgb|hsl|white|black/i.test(d));
  }
  const source = read('src/ui/brand/shi.js');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(source), 'no #hex colour in src/ui/brand/shi.js');
  assert.ok(!/\b(rgba?|hsla?)\(/.test(source), 'no rgb()/hsl() in src/ui/brand/shi.js');
  assert.ok(!/\bfill=["'][^"']*["']/.test(source.replace(/fill="currentColor"/g, '')), 'fill is only currentColor');
});

test('brand shi: SHI_PATHS is the same data as the archived master docs/design/brand/shi-A1.svg', () => {
  const svg = read('docs/design/brand/shi-A1.svg');
  const ds = [...svg.matchAll(/<path id="shi-s(\d)" d="([^"]+)"/g)];
  assert.deepEqual(ds.map(m => m[1]), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(ds.map(m => m[2]), [...SHI_PATHS]);
  assert.match(svg, /viewBox="0 0 1024 1024"/);
  assert.equal(SHI_UNITS, 1024);
});

test('brand shi: the viewBox is a square centred on the optical centre of the ink (box 125–911 × 146–818)', () => {
  const [x, y, w, h] = SHI_VIEWBOX.split(' ').map(Number);
  assert.equal(w, SHI_VIEW);
  assert.equal(h, SHI_VIEW);
  assert.ok(x < 125 && x + w > 911 && y < 146 && y + h > 818, 'the whole ink box fits inside the viewBox');
  const cx = x + w / 2;
  const cy = y + h / 2;
  assert.ok(Math.abs(cx - 502) < 1 && Math.abs(cy - 494) < 1, 'optical centre: half-way between ink-box centre (518, 482) and centroid (485, 505)');
  assert.ok(Math.abs(788 / SHI_VIEW - 0.62) < 0.005, 'ink long side is 62% of the cell');
});

test('brand shi: SHI_BOLD_PATHS + SHI_BOLD_TRANSFORM are the same data as docs/design/brand/shi-A1-bold-small.svg (the small-size master used by the seal)', () => {
  const svg = read('docs/design/brand/shi-A1-bold-small.svg');
  const ds = [...svg.matchAll(/<path id="shi-s(\d)" d="([^"]+)"/g)];
  assert.deepEqual(ds.map(m => m[1]), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(ds.map(m => m[2]), [...SHI_BOLD_PATHS]);
  assert.match(svg, /viewBox="0 0 1024 1024"/);
  assert.equal(svg.match(/<g id="shi-glyph"[^>]*transform="([^"]+)"/)[1], SHI_BOLD_TRANSFORM_ATTR);
  assert.deepEqual({ ...SHI_BOLD_TRANSFORM }, { tx: -21.24, ty: -19.48, scale: 1.04 });
  for (const d of SHI_BOLD_PATHS) assert.match(d, /^M[\d.\s,CLZ-]+Z$/);
  assert.notDeepEqual([...SHI_BOLD_PATHS], [...SHI_PATHS], 'a second, bolder set — not the regular one');
});

test('brand shi: the seal viewBox is a square centred on the optical centre of the bold ink (box 88–973 × 138–835 after the master transform)', () => {
  const [x, y, w, h] = SHI_SEAL_VIEWBOX.split(' ').map(Number);
  assert.equal(w, SHI_SEAL_VIEW);
  assert.equal(h, SHI_SEAL_VIEW);
  assert.ok(x < 88 && x + w > 973 && y < 138 && y + h > 835, 'the whole bold ink box fits inside the viewBox');
  assert.deepEqual({ ...SHI_BOLD_CENTER }, { x: 510, y: 499 });
  assert.ok(Math.abs(x + w / 2 - 510) < 1 && Math.abs(y + h / 2 - 499) < 1);
  const share = 885 / SHI_SEAL_VIEW;
  assert.ok(share > 0.6 && share < 0.7, `ink long side is ${(share * 100).toFixed(0)}% of the seal — leaves clear room inside the 7% inset line`);
});

test('ShiSealMark: inline svg, nine bold paths inside the master transform, currentColor, decorative, no text', () => {
  const tree = walk(ShiSealMark({ class: 'x' }));
  const svg = find(tree, 'svg');
  assert.equal(svg.length, 1);
  assert.equal(svg[0].props.fill, 'currentColor');
  assert.equal(svg[0].props['aria-hidden'], 'true');
  assert.equal(svg[0].props.viewBox, SHI_SEAL_VIEWBOX);
  assert.equal(find(tree, 'g')[0].props.transform, SHI_BOLD_TRANSFORM_ATTR);
  assert.deepEqual(find(tree, 'path').map(n => n.props.d), [...SHI_BOLD_PATHS]);
  assert.deepEqual(tree.texts.filter(s => s.trim()), []);
});

test('ShiMark: inline svg, nine paths, currentColor, decorative', () => {
  const tree = walk(ShiMark({ class: 'x' }));
  const svg = find(tree, 'svg');
  assert.equal(svg.length, 1);
  assert.equal(svg[0].props.fill, 'currentColor');
  assert.equal(svg[0].props['aria-hidden'], 'true');
  assert.equal(svg[0].props.viewBox, SHI_VIEWBOX);
  assert.equal(find(tree, 'path').length, 9);
  assert.deepEqual(tree.texts.filter(s => s.trim()), [], 'no text node');
});

test('BrandShi: svg inside the same box — read-aloud name, role, testid and --cell unchanged, no text node', () => {
  const tree = walk(BrandShi({ size: 172 }));
  const box = find(tree, 'div')[0];
  assert.equal(box.props.role, 'img');
  assert.equal(box.props['aria-label'], t('X-HOME.shiLabel'));
  assert.equal(box.props['aria-label'], '拾');
  assert.equal(box.props['data-testid'], 'home-brand-shi');
  assert.equal(box.props.style['--cell'], '172px');
  assert.equal(find(tree, 'svg').length, 1);
  assert.equal(find(tree, 'path').length, 9);
  assert.deepEqual(tree.texts.filter(s => s.trim()), [], 'the brand 拾 is no longer a text node (no ShiziKai glyph)');
});

test('app icon masters: background + shi-glyph (shi-s1…s9), one ink colour, token colours, no stroke / old ids', () => {
  const light = tokens.color.light;
  const dark = tokens.color.dark;
  const expected = {
    'app-icon-source.svg': [light.paper, light.hand],
    'app-icon-source-small.svg': [light.paper, light.hand],
    'app-icon-maskable.svg': [light.paper, light.hand],
    'app-icon-dark.svg': [dark.paper, dark.hand],
  };
  for (const [file, [paper, ink]] of Object.entries({ ...expected, 'app-icon-tinted.svg': ['#000000', '#FFFFFF'] })) {
    const svg = read(`assets/branding/${file}`);
    assert.match(svg, /<rect id="background"[^>]*fill="([^"]+)"/i, file);
    assert.equal(svg.match(/<rect id="background"[^>]*fill="([^"]+)"/i)[1].toUpperCase(), paper.toUpperCase(), `${file} paper`);
    assert.equal(svg.match(/<g id="shi-glyph"[^>]*fill="([^"]+)"/i)[1].toUpperCase(), ink.toUpperCase(), `${file} ink`);
    assert.deepEqual([...svg.matchAll(/<path id="(shi-s\d)"/g)].map(m => m[1]), ['shi-s1', 'shi-s2', 'shi-s3', 'shi-s4', 'shi-s5', 'shi-s6', 'shi-s7', 'shi-s8', 'shi-s9'], file);
    assert.ok(!/shi-hand|shi-he\b|stroke/.test(svg), `${file}: no old ids, no stroke`);
    assert.ok(!/<image|<text|<filter|<script|href=/.test(svg), `${file}: only vector outlines`);
  }
});
