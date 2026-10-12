// I3 · P0-04 / P1-23（规范 B3）：月字帖「保存图片」一次点击直接保存、「分享」直接调系统分享；预览弹层只在调整图片（比例 / 分张）时进入。
// 这里测直接导出的纯逻辑（src/ui/image-quick.js，保存 / 分享函数注入）；页面接线在 scripts/e2e/46-annual、73-p1e7-works、40-mine。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quickSave, quickShare, quickExportCanvas } from '../../src/ui/image-quick.js';

const fakeCanvas = (tag = 'x') => ({ toDataURL: type => `data:${type};base64,${Buffer.from(tag).toString('base64')}` });

function makeJob({ pages = 1, status = 'ready', ratio = '1:1', fail = false } = {}) {
  const calls = [];
  return {
    calls,
    kind: 'month',
    initialRatio: ratio,
    status: () => status,
    pageCount: () => pages,
    renderPage: async (i, r, opts) => {
      calls.push({ i, r, scale: opts && opts.scale });
      if (fail) return { status: 'renderFailed', canvas: null };
      return { status: 'ready', canvas: fakeCanvas(`p${i}`) };
    },
    fileName: (r, i, n) => `m-${r.replace(':', 'x')}-${i + 1}of${n}.jpg`,
  };
}

test('quickSave: renders every page at the job default ratio and export scale and saves each — one call, no preview', async () => {
  const job = makeJob({ pages: 2, ratio: '3:4' });
  const saved = [];
  const res = await quickSave(job, { save: async file => { saved.push(file); return { ok: true, via: 'download' }; } });
  assert.equal(res.ok, true);
  assert.deepEqual(job.calls.map(c => [c.i, c.r]), [[0, '3:4'], [1, '3:4']]);
  assert.ok(job.calls.every(c => c.scale === 2 || c.scale > 1), 'exported at the export scale, not the preview scale');
  assert.deepEqual(saved.map(f => f.name), ['m-3x4-1of2.jpg', 'm-3x4-2of2.jpg']);
  assert.ok(saved.every(f => /^data:image\/jpeg/.test(f.dataURL) && f.kind === 'month'));
});

test('quickSave: stops at the first failed page and reports failure; a job that is not ready saves nothing', async () => {
  const job = makeJob({ pages: 3 });
  let n = 0;
  const res = await quickSave(job, { save: async () => { n += 1; return { ok: n < 2 }; } });
  assert.equal(res.ok, false);
  assert.equal(n, 2);
  const none = makeJob({ status: 'empty' });
  assert.equal((await quickSave(none, { save: async () => { throw new Error('should not save'); } })).ok, false);
  const broken = makeJob({ fail: true });
  assert.equal((await quickSave(broken, { save: async () => ({ ok: true }) })).ok, false);
});

test('quickShare: shares the first page directly when there is one page; with several pages it asks the caller to open the preview (the page to share is a choice)', async () => {
  const shared = [];
  const one = await quickShare(makeJob({ pages: 1 }), { share: async file => { shared.push(file); return { via: 'share', done: true }; } });
  assert.equal(one.ok, true);
  assert.equal(shared.length, 1);
  const many = await quickShare(makeJob({ pages: 3 }), { share: async () => { throw new Error('should not share'); } });
  assert.deepEqual([many.ok, many.needsPreview], [false, true]);
});

test('quickShare: a cancelled system sheet is not a failure; an exception is', async () => {
  assert.equal((await quickShare(makeJob(), { share: async () => ({ via: 'share', done: false, cancelled: true }) })).ok, true);
  assert.equal((await quickShare(makeJob(), { share: async () => { throw new Error('x'); } })).ok, false);
});

test('quickExportCanvas exposes the shared render step', async () => {
  const c = await quickExportCanvas(makeJob(), 0);
  assert.equal(typeof c.toDataURL, 'function');
});

test('month page: footer is 分享 (secondary) + 保存图片 (primary), both direct; the preview is reached only through 调整图片 ›; no header share icon', () => {
  const src = readFileSync(new URL('../../src/ui/screens/mine/month.js', import.meta.url), 'utf8');
  assert.match(src, /data-testid="month-save"[\s\S]*?onClick=\$\{flow\.save\}/);
  assert.match(src, /data-testid="month-share-btn"[\s\S]*?onClick=\$\{shareNow\}/);
  assert.match(src, /data-testid="month-adjust"/);
  assert.ok(!/data-testid="month-share"[^-]/.test(src.replace(/month-share-btn/g, '')), 'the header share icon is gone');
  assert.ok(!/title=""/.test(src), 'P1-36: the page has a title for screen readers');
});
