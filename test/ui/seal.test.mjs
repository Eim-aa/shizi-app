// 印只有一种（R2-R1 / D51 ③；V2-05 / T2-22）：作品里（结果页、月字帖、我的缩略图）都是 marks.js 的 <Seal/>，24pt 正放，与字数无关；
// 导出图里的印同样一个尺寸、不倾斜。印文暂不改（D51 ③ 的「拾」印由品牌模块的卡做），所以印字只在 Seal 这一处取（X-IMAGES.seal）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEAL_PT, Seal, WORK_MARK_CSS } from '../../src/ui/components/marks.js';
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

const cellsOf = n => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, ch: String.fromCodePoint(0x4e00 + i), ink: null, mode: 'under', label: 'x' }));

test('Seal: one component, 24pt, the seal text is taken in this one place', () => {
  assert.equal(SEAL_PT, 24);
  const v = Seal({});
  assert.equal(v.props.class, 'sz-seal');
  assert.equal(v.props['data-testid'], 'work-seal');
  assert.equal(v.props.children, '字');
  assert.match(WORK_MARK_CSS, /\.sz-seal\{[^}]*width:24px;height:24px/);
  assert.doesNotMatch(WORK_MARK_CSS, /\.sz-seal\{[^}]*(transform|rotate)/, 'not tilted');
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
  drawSeal(ctx, { x: 0, y: 0, size: 64 }, { text: '字', palette: { seal: 's', onSeal: 'o' } });
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
