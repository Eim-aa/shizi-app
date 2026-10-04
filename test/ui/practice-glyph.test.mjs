// 练习字字形单一来源（阶段 1 P1-E2；decisions D33 8a 方案 B、D43、D44）单测：
// - 几何：SVG 视图框与 canvas 轮廓（ui/canvas/glyph.js glyphTransform、core/images/render.js paintOutline）同一个仿射；
// - 字面比例取 tokens.json typography.glyph；
// - 视图四态（加载中 / 轮廓 / 回退 / 非汉字）、颜色、双钩、装饰性；
// - 取数调度：并发上限、合并、取消、确无数据记忆、瞬时失败；
// - 加载器容量（LRU）够一屏几百格；
// - 图片导出：有数据画轮廓，没数据才回退楷体文字。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PracticeGlyph, PracticeGlyphView, createGlyphScheduler, glyphStatus, glyphViewBox, isPracticeChar, setGlyphGate,
  DEFAULT_FACE, FACE_FULL, FACE_TO_BOX, MAX_INFLIGHT, GLYPH_UNITS, GLYPH_BASELINE, HOLLOW_STROKE,
} from '../../src/ui/components/PracticeGlyph.js';
import { glyphTransform, mapPoint, GLYPH_PAD_RATIO } from '../../src/ui/canvas/glyph.js';
import { paintOutline, paintCellContent } from '../../src/core/images/render.js';
import { createStrokesLoader, STROKES_LRU_SIZE } from '../../src/data/strokes.js';
import { TIE_CELL_FACE } from '../../src/ui/screens/home/copybook.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/design/design-system-v1/tokens.json'), 'utf8'));
const DATA = { strokes: ['M 0 0 L 100 0 L 100 100 Z', 'M 200 200 L 300 200 L 300 300 Z'], medians: [[[0, 0], [100, 100]], [[200, 200], [300, 300]]] };

/** 展开 vnode 树（函数组件直接调用；PracticeGlyph 本身带 hooks，不在这里展开）。 */
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
const view = p => walk(PracticeGlyphView(p));

test('face ratio: tokens.json typography.glyph is the single source of the face ratios', () => {
  assert.equal(DEFAULT_FACE, tokens.typography.glyph.faceRatioOfCell, 'default face = faceRatioOfCell = wallCellFace');
  assert.equal(DEFAULT_FACE, tokens.typography.glyph.wallCellFace);
  assert.equal(TIE_CELL_FACE, tokens.typography.glyph.tieCellFace);
  // face 0.8 ⇒ 1024 方框占 0.88 ⇒ 内边 0.06，与旧版 canvas 的 PAD = .06 同一几何
  assert.ok(Math.abs((1 - DEFAULT_FACE * FACE_TO_BOX) / 2 - GLYPH_PAD_RATIO) < 1e-9);
  assert.ok(Math.abs(FACE_FULL * FACE_TO_BOX - 1) < 1e-9, 'FACE_FULL fills the element with the 1024 box');
});

test('geometry: the SVG viewBox + flip maps data points exactly where glyphTransform / paintOutline put them', () => {
  for (const face of [0.7, 0.76, 0.8, 0.84, FACE_FULL]) {
    const vb = glyphViewBox(face);
    const size = 345;
    const t = glyphTransform({ size, padding: (size * (1 - face * FACE_TO_BOX)) / 2 });
    for (const [x, y] of [[0, 0], [512, 450], [1024, 900], [100, 800], [900, -50]]) {
      // SVG：g 变换 y' = 900 − y，再按 viewBox 缩放到 size
      const sx = ((x - vb.x) / vb.w) * size;
      const sy = ((GLYPH_BASELINE - y - vb.y) / vb.h) * size;
      const [cx, cy] = mapPoint([x, y], t);
      assert.ok(Math.abs(sx - cx) < 0.05 && Math.abs(sy - cy) < 0.05, `face ${face} (${x},${y}) → svg ${sx.toFixed(2)},${sy.toFixed(2)} vs canvas ${cx.toFixed(2)},${cy.toFixed(2)}`);
    }
  }
  const full = glyphViewBox(FACE_FULL);
  assert.deepEqual([full.x, full.y, full.w, full.h], [0, 0, GLYPH_UNITS, GLYPH_UNITS]);
});

test('PracticeGlyphView outline: one <path> per stroke, filled with currentColor, flipped group, readable text only for AT', () => {
  const tree = view({ char: '字', status: 'outline', data: DATA });
  const [root] = find(tree, 'span');
  assert.equal(root.props['data-glyph-src'], 'outline');
  assert.match(root.props.class, /^sz-pg/);
  const [svg] = find(tree, 'svg');
  assert.equal(svg.props['aria-hidden'], 'true');
  const [g] = find(tree, 'g');
  assert.equal(g.props.transform, `translate(0 ${GLYPH_BASELINE}) scale(1 -1)`);
  const paths = find(tree, 'path');
  assert.deepEqual(paths.map(p => p.props.d), DATA.strokes);
  assert.ok(paths.every(p => p.props.fill === 'currentColor' && p.props.stroke === undefined));
  assert.deepEqual(tree.texts, ['字'], 'textContent keeps the char (sz-pg__sr span), nothing visible in a kai font');
  assert.ok(find(tree, 'span').some(n => n.props.class === 'sz-pg__sr'));
  assert.ok(!find(tree, 'span').some(n => String(n.props.class).includes('sz-pg__fb')), 'no ShiziKai text while the outline is shown');
});

test('PracticeGlyphView hollow: double-hook outline (stroke only, no fill), 1px non-scaling', () => {
  const tree = view({ char: '字', status: 'outline', data: DATA, variant: 'hollow' });
  const paths = find(tree, 'path');
  assert.equal(paths.length, 2);
  for (const p of paths) {
    assert.equal(p.props.fill, 'none');
    assert.equal(p.props.stroke, 'currentColor');
    assert.equal(p.props['stroke-width'], HOLLOW_STROKE);
    assert.equal(p.props['vector-effect'], 'non-scaling-stroke');
  }
  assert.equal(find(tree, 'span')[0].props['data-glyph-variant'], 'hollow');
});

test('PracticeGlyphView loading: nothing visible (no ShiziKai flash), same box; fallback / text: ShiziKai char', () => {
  const loading = view({ char: '字', status: 'loading' });
  assert.equal(find(loading, 'svg').length, 0);
  assert.ok(!find(loading, 'span').some(n => String(n.props.class).includes('sz-pg__fb')));
  assert.equal(find(loading, 'span')[0].props['data-glyph-src'], 'loading');
  assert.deepEqual(loading.texts, ['字'], 'sz-pg__sr char only');

  for (const status of ['fallback', 'text']) {
    const tree = view({ char: status === 'text' ? '，' : '𠀀', status, face: 0.76 });
    const spans = find(tree, 'span');
    const fb = spans.find(n => n.props.class === 'sz-pg__fb');
    assert.ok(fb, `${status}: fallback text node`);
    assert.equal(spans[0].props['data-glyph-src'], status);
    assert.equal(spans[0].props.lang, 'zh-CN');
    assert.equal(spans[0].props.style['--pg-face'], '0.76', 'fallback font-size = face × box width (CSS cqw)');
    assert.equal(find(tree, 'svg').length, 0);
    assert.equal(tree.texts.length, 1);
  }
});

test('PracticeGlyphView: colour and decorative flag are passed through; class is merged', () => {
  const tree = view({ char: '字', status: 'outline', data: DATA, color: 'var(--danzhu)', hidden: true, class: 'sz-x', testid: 'tid' });
  const [root] = find(tree, 'span');
  assert.equal(root.props.class, 'sz-pg sz-x');
  assert.equal(root.props.style.color, 'var(--danzhu)');
  assert.equal(root.props['aria-hidden'], 'true');
  assert.equal(root.props['data-testid'], 'tid');
  const plain = view({ char: '字', status: 'outline', data: DATA });
  assert.equal(find(plain, 'span')[0].props['aria-hidden'], null);
});

test('isPracticeChar / glyphStatus: only single Han characters get an outline request; known-missing and out-of-deck chars fall back', () => {
  assert.ok(isPracticeChar('字') && isPracticeChar('𠮷'));
  for (const bad of ['', 'ab', '，', 'A', '1', '字字', null, undefined]) assert.ok(!isPracticeChar(bad), String(bad));

  const scheduler = createGlyphScheduler({ load: async () => ({ data: null, reason: 'not-found' }) });
  const peek = c => (c === '甲' ? DATA : undefined);
  setGlyphGate(() => true);
  try {
    assert.equal(glyphStatus('，', { scheduler, peek }).status, 'text');
    assert.equal(glyphStatus('甲', { scheduler, peek }).status, 'outline');
    assert.equal(glyphStatus('乙', { scheduler, peek }).status, 'loading');
    setGlyphGate(() => false);
    assert.equal(glyphStatus('乙', { scheduler, peek }).status, 'fallback', 'not in the deck → no request, ShiziKai fallback');
    assert.equal(glyphStatus('甲', { scheduler, peek }).status, 'outline', 'already-loaded data wins over the gate');
  } finally {
    setGlyphGate(null);
  }
  assert.equal(typeof PracticeGlyph, 'function');
});

test('scheduler: at most MAX_INFLIGHT requests in flight, same char merged, cancelled queued requests dropped, outcomes classified', async () => {
  assert.equal(MAX_INFLIGHT, 6);
  const pending = [];
  let active = 0;
  let peak = 0;
  const load = char => {
    active += 1;
    peak = Math.max(peak, active);
    return new Promise(resolve => {
      pending.push({ char, finish: detail => { active -= 1; resolve(detail); } });
    });
  };
  const tick = () => new Promise(r => setImmediate(r));
  const s = createGlyphScheduler({ load, maxInflight: 6 });
  const outcomes = {};
  const chars = Array.from({ length: 20 }, (_, i) => String.fromCodePoint(0x4e00 + i));
  const cancels = chars.map(c => s.request(c, o => { outcomes[c] = o; }));
  s.request(chars[0], o => { outcomes[`${chars[0]}#2`] = o; }); // 与第一个合并
  assert.equal(pending.length, 6, 'only 6 started');
  assert.equal(s.stats().queued, 14);
  cancels[18](); // 排队中被取消、没有别的订阅者：永远不会真的发请求
  cancels[19]();
  const details = [{ data: DATA, reason: null }, { data: null, reason: 'not-found' }, { data: null, reason: 'timeout' }];
  const started = [];
  let i = 0;
  while (pending.length) {
    const p = pending.shift();
    started.push(p.char);
    p.finish(details[i % 3]);
    i += 1;
    await tick();
  }
  assert.ok(peak <= 6, `peak in-flight ${peak}`);
  assert.equal(started.length, 18, '20 requested − 2 cancelled in the queue');
  assert.ok(!started.includes(chars[18]) && !started.includes(chars[19]));
  assert.equal(outcomes[`${chars[0]}#2`], outcomes[chars[0]], 'merged subscribers see the same outcome');
  assert.equal(outcomes[chars[0]], 'ready');
  assert.equal(outcomes[chars[1]], 'missing');
  assert.equal(outcomes[chars[2]], 'transient');
  assert.equal(s.stats().dropped, 2);
});

test('scheduler: permanent misses are remembered (no second request), transient failures are not', async () => {
  const reasons = { 甲: 'not-found', 乙: 'invalid', 丙: 'timeout', 丁: 'network' };
  const seen = [];
  const s = createGlyphScheduler({ load: async c => { seen.push(c); return { data: null, reason: reasons[c] }; } });
  const out = {};
  for (const c of Object.keys(reasons)) s.request(c, o => { out[c] = o; });
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(out, { 甲: 'missing', 乙: 'missing', 丙: 'transient', 丁: 'transient' });
  assert.ok(s.isMissing('甲') && s.isMissing('乙'));
  assert.ok(!s.isMissing('丙') && !s.isMissing('丁'), 'a timeout is only this time; online retries it');
  // loader 抛 / reject 也只是瞬时失败，不会抛出
  const bad = createGlyphScheduler({ load: () => { throw new Error('boom'); } });
  let got = null;
  bad.request('戊', o => { got = o; });
  await new Promise(r => setImmediate(r));
  assert.equal(got, 'transient');
});

test('300 glyphs through the scheduler never exceed 6 in flight (the 3s timeout is measured from the real request)', async () => {
  let active = 0;
  let peak = 0;
  const s = createGlyphScheduler({
    load: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(r => setImmediate(r));
      active -= 1;
      return { data: DATA, reason: null };
    },
  });
  let n = 0;
  for (let i = 0; i < 300; i += 1) s.request(String.fromCodePoint(0x4e00 + i), () => { n += 1; });
  for (let i = 0; i < 400 && n < 300; i += 1) await new Promise(r => setImmediate(r));
  assert.equal(n, 300);
  assert.ok(peak <= 6, `peak ${peak}`);
});

test('stroke loader LRU holds a whole screen of glyphs: 512 distinct chars stay cached, the 513th evicts the oldest', async () => {
  assert.equal(STROKES_LRU_SIZE, 512);
  const fetchImpl = async url => ({ ok: true, status: 200, json: async () => ({ strokes: ['M 0 0 L 1 1 Z'], medians: [[[0, 0], [1, 1]]], _u: url }) });
  const loader = createStrokesLoader({ fetch: fetchImpl, embedded: {} });
  const chars = Array.from({ length: 513 }, (_, i) => String.fromCodePoint(0x4e00 + i));
  for (const c of chars.slice(0, 512)) await loader.load(c);
  assert.equal(loader.cachedChars().length, 512);
  assert.ok(loader.peek(chars[0]), 'the first one is still there');
  await loader.load(chars[512]);
  assert.equal(loader.cachedChars().length, 512);
  assert.equal(loader.peek(chars[0]), undefined, 'least recently used evicted');
  assert.ok(loader.peek(chars[512]));
});

/** 记录 ctx 调用的假 canvas 上下文：只关心变换与有没有画文字。 */
function fakeCtx() {
  const log = { ops: [], filled: 0, text: [] };
  const ctx = {
    save: () => log.ops.push('save'), restore: () => log.ops.push('restore'),
    translate: (x, y) => log.ops.push(['translate', x, y]), scale: (x, y) => log.ops.push(['scale', x, y]),
    fill: () => { log.filled += 1; }, fillText: (s) => log.text.push(s),
    set fillStyle(v) { log.fillStyle = v; }, set font(v) { log.font = v; }, set textAlign(v) {}, set textBaseline(v) {},
  };
  return { ctx, log };
}

test('image export: paintOutline draws the same outline data with the same geometry; the ShiziKai fallback only runs when there is no data', () => {
  const g = globalThis.Path2D;
  globalThis.Path2D = class { constructor(d) { this.d = d; } };
  try {
    const { ctx, log } = fakeCtx();
    assert.ok(paintOutline(ctx, DATA, { x: 10, y: 20, size: 100, color: '#000' }));
    assert.equal(log.filled, DATA.strokes.length, 'one fill per stroke, like the SVG');
    const pad = 100 * GLYPH_PAD_RATIO;
    const k = (100 - 2 * pad) / GLYPH_UNITS;
    assert.deepEqual(log.ops.find(o => o[0] === 'translate'), ['translate', 10 + pad, 20 + pad + GLYPH_BASELINE * k]);
    assert.deepEqual(log.ops.find(o => o[0] === 'scale'), ['scale', k, -k], 'y flipped, same as the SVG group');

    const withData = fakeCtx();
    paintCellContent(withData.ctx, { ch: '字', ink: null, mode: 'under' }, { x: 0, y: 0, c: 100 }, { palette: { under: '#999', hand: '#000' }, unit: 1, glyphs: new Map([['字', DATA]]) });
    assert.equal(withData.log.text.length, 0, 'data present → outline, no fillText');
    assert.ok(withData.log.filled > 0);
    const noData = fakeCtx();
    paintCellContent(noData.ctx, { ch: '𠀀', ink: null, mode: 'under' }, { x: 0, y: 0, c: 100 }, { palette: { under: '#999', hand: '#000' }, unit: 1, glyphs: new Map() });
    assert.deepEqual(noData.log.text, ['𠀀'], 'no data → ShiziKai fallback');
    assert.match(noData.log.font, /ShiziKai/);
  } finally {
    if (g) globalThis.Path2D = g;
    else delete globalThis.Path2D;
  }
});
