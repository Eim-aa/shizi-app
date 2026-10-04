// 印只有一种（R2-R1 / D51 ③；V2-05 / T2-22）：作品里（结果页、月字帖、我的缩略图）都是 marks.js 的 <Seal/>，24pt 正放，与字数无关；
// 导出图里的印同样一个尺寸、不倾斜。
// R2-S2（D51 ③）：印文是白文「拾」——朱底上 --on-seal 色的品牌字形（shi.js 的小尺寸加粗版 SHI_BOLD_PATHS），屏上是内联 svg、导出图是 Path2D；
// 不再用楷体字，也没有印字的文案键。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEAL_PT, Seal, SealGlyph, WORK_MARK_CSS, MARK_CSS } from '../../src/ui/components/marks.js';
import { SHI_BOLD_PATHS, SHI_BOLD_TRANSFORM, SHI_SEAL_VIEW, SHI_BOLD_CENTER } from '../../src/ui/brand/shi.js';
import { WorkPaper, MonthPaper } from '../../src/ui/components/work.js';
import { drawSeal } from '../../src/core/images/render.js';
import { glyphLayout } from '../../src/core/images/glyph-layout.js';

function find(vnode, pred, out = []) {
  if (!vnode || typeof vnode !== 'object') return out;
  if (Array.isArray(vnode)) {
    vnode.forEach(v => find(v, pred, out));
    return out;
  }
  if (pred(vnode)) out.push(vnode);
  const kids = vnode.props && vnode.props.children;
  if (kids !== undefined) find(kids, pred, out);
  return out;
}

/** 展开 vnode 树（函数组件直接调用）。 */
function expand(vnode, out = { nodes: [], texts: [] }) {
  if (vnode === null || vnode === undefined || typeof vnode === 'boolean') return out;
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    out.texts.push(String(vnode));
    return out;
  }
  if (Array.isArray(vnode)) {
    vnode.forEach(v => expand(v, out));
    return out;
  }
  const { type, props } = vnode;
  if (typeof type === 'function') return expand(type(props), out);
  out.nodes.push({ type, props: props || {} });
  expand(props && props.children, out);
  return out;
}
const src = rel => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const cellsOf = n => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, ch: String.fromCodePoint(0x4e00 + i), ink: null, mode: 'under', label: 'x' }));

test('Seal: one component, 24pt, the seal face is the white-on-vermilion brand 拾 (svg), taken in this one place', () => {
  assert.equal(SEAL_PT, 24);
  const v = Seal({});
  assert.equal(v.props.class, 'sz-seal');
  assert.equal(v.props['data-testid'], 'work-seal');
  const tree = expand(v);
  assert.deepEqual(tree.texts.filter(x => x.trim()), [], 'no text node: the seal is a drawing, not a font glyph');
  const svg = tree.nodes.filter(n => n.type === 'svg');
  assert.equal(svg.length, 1);
  assert.equal(svg[0].props.fill, 'currentColor', 'colour comes from --on-seal via CSS color');
  assert.equal(svg[0].props['aria-hidden'], 'true');
  assert.deepEqual(tree.nodes.filter(n => n.type === 'path').map(n => n.props.d), [...SHI_BOLD_PATHS], 'same nine bold outlines as shi.js / the archived master');
  assert.equal(expand(SealGlyph({})).nodes.filter(n => n.type === 'path').length, 9, 'SealGlyph is the face the home / about seals reuse');
  assert.match(WORK_MARK_CSS, /\.sz-seal\{[^}]*width:24px;height:24px/);
  assert.doesNotMatch(WORK_MARK_CSS, /\.sz-seal\{[^}]*(transform|rotate)/, 'not tilted');
  assert.doesNotMatch(WORK_MARK_CSS + MARK_CSS, /font-family|font-size|--kai|T\.kai/, 'no typeface: the seal text is not set in ShiziKai any more');
  assert.match(WORK_MARK_CSS, /\.sz-seal\{[^}]*color:var\(--on-seal\)/, 'ink colour of the seal face = --on-seal');
  for (const css of [WORK_MARK_CSS, MARK_CSS]) {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/.test(css), 'no colour literal in the seal CSS');
  }
  assert.equal(Seal({ cls: 'sz-seal--land' }).props.class, 'sz-seal sz-seal--land');
});

test('WorkPaper / MonthPaper: every count uses the same <Seal/> — no size prop, no big variant', () => {
  const grid = n => ({ cols: Math.min(n, 3), rows: Math.ceil(n / 3), c: 100 });
  for (const n of [1, 2, 3, 4, 5]) {
    const v = WorkPaper({ cells: cellsOf(n), grid: grid(n), kuan: 'k' });
    const seals = find(v, x => x.type === Seal);
    assert.equal(seals.length, 1, `n=${n}: exactly one seal`);
    assert.deepEqual(Object.keys(seals[0].props).filter(k => k !== 'children' && k !== 'style').sort(), [], `n=${n}: the seal takes no size / variant props`);
  }
  const m = MonthPaper({ cells: cellsOf(7), cols: 6, c: 60, kuan: 'k' });
  assert.equal(find(m, x => x.type === Seal).length, 1);
});

test('export: the seal is not tilted anywhere (page, annual, single glyph) and drawSeal defaults to upright', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : (...a) => calls.push([p, ...a])), set: () => true });
  drawSeal(ctx, { x: 0, y: 0, size: 64 }, { palette: { seal: 's', onSeal: 'o' } });
  assert.deepEqual(calls.find(c => c[0] === 'rotate'), ['rotate', 0]);
  const g = glyphLayout({ x: 50, y: 50, width: 200, height: 200 }, 'portrait');
  assert.equal(g.seal.rotate, 0);
  const root = fileURLToPath(new URL('../../src/core/images', import.meta.url));
  for (const f of readdirSync(root)) assert.ok(!/rotate:\s*-\d/.test(readFileSync(join(root, f), 'utf8')), `${f}: no negative seal rotation`);
});

test('no leftover second seal style: .sz-wseal / .sz-mseal / WorkSeal are gone from src', () => {
  const root = fileURLToPath(new URL('../../src', import.meta.url));
  const hits = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js') && /sz-wseal|sz-mseal|WorkSeal/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length));
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

test('home / about seals use the same SealGlyph face — no text node, no seal copy key, no ShiziKai for the seal', () => {
  const home = src('src/ui/screens/home/index.js');
  const about = src('src/ui/screens/mine/about.js');
  assert.equal([...home.matchAll(/data-testid="home-seal"><\$\{SealGlyph\} \/>/g)].length, 2, 'both first-open seals (normal and AX) draw SealGlyph');
  assert.match(about, /data-testid="about-seal"><\$\{SealGlyph\} \/>/);
  for (const [name, text] of [['home', home], ['about', about]]) assert.doesNotMatch(text, /sealGlyph|X-ABOUT\.seal|X-IMAGES\.seal/, `${name}: no seal text key`);
  assert.doesNotMatch(home, /\.sz-home__seal>span/);
  assert.doesNotMatch(about, /\.sz-about__seal\{[^}]*font-/);
  for (const f of ['home.js', 'about.js', 'images.js']) {
    assert.doesNotMatch(src(`src/config/copy/${f}`), /'X-(HOME\.sealGlyph|ABOUT\.seal|IMAGES\.seal)'/, `${f}: seal copy keys are gone`);
  }
  assert.ok(!/"sealGlyph"|"seal":\s*\{/.test(src('docs/engineering/v10/copy-source.json')), 'copy-source.json: no seal key');
});

test('export: drawSeal paints the same nine bold outlines with Path2D (no fillText, no font), centred through the shared transform', () => {
  const made = [];
  const saved = globalThis.Path2D;
  globalThis.Path2D = class { constructor(d) { this.d = d; made.push(d); } };
  try {
    const calls = [];
    const state = { fillStyle: '' };
    const ctx = new Proxy(state, {
      get: (t, p) => (p in t ? t[p] : (...a) => calls.push([p, ...a, t.fillStyle])),
      set: (t, p, v) => { t[p] = v; return true; },
    });
    drawSeal(ctx, { x: 10, y: 20, size: 78 }, { palette: { seal: 'S', onSeal: 'O' } });
    assert.deepEqual(made, [...SHI_BOLD_PATHS]);
    assert.equal(calls.filter(c => c[0] === 'fillText').length, 0, 'no fillText: the seal is not typeset');
    assert.ok(!('font' in state), 'no ctx.font set');
    const fills = calls.filter(c => c[0] === 'fill');
    assert.equal(fills.length, 9);
    assert.ok(fills.every(c => c[1] instanceof globalThis.Path2D && c[2] === 'O'), 'each outline is a Path2D filled with onSeal');
    const rect = calls.find(c => c[0] === 'fillRect');
    assert.equal(rect[rect.length - 1], 'S', 'seal ground uses the seal colour');
    const k = 78 / SHI_SEAL_VIEW;
    const scales = calls.filter(c => c[0] === 'scale').map(c => c[1]);
    assert.ok(scales.some(v => Math.abs(v - k) < 1e-9), 'view box → seal size');
    assert.ok(scales.includes(SHI_BOLD_TRANSFORM.scale), 'master transform scale');
    assert.ok(calls.some(c => c[0] === 'translate' && c[1] === -SHI_BOLD_CENTER.x && c[2] === -SHI_BOLD_CENTER.y), 'optical centre of the bold ink sits in the centre of the seal');
    assert.ok(calls.some(c => c[0] === 'translate' && c[1] === SHI_BOLD_TRANSFORM.tx && c[2] === SHI_BOLD_TRANSFORM.ty), 'master transform translate');
  } finally {
    if (saved === undefined) delete globalThis.Path2D;
    else globalThis.Path2D = saved;
  }
});

test('export renderers: no sealText, no ShiziKai wait for the seal', () => {
  for (const f of ['src/core/images/render.js', 'src/core/images/annual-render.js', 'src/ui/images-entry.js', 'src/ui/images-annual.js']) {
    assert.doesNotMatch(src(f), /sealText/, `${f}: seal text is gone`);
  }
  const render = src('src/core/images/render.js');
  const fn = render.slice(render.indexOf('export function drawSeal'), render.indexOf('/** 落款：'));
  assert.doesNotMatch(fn, /fillText|ctx\.font|FONTS\.kai/);
  assert.match(fn, /new Path2D/);
});
