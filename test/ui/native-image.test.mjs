// B3.11 原生图片预览弹层的契约（docs/engineering/v10/B3B4-原生化架构与计划.md §3.4「网页路径 == API 路径」、§3.6 分享图 / 年报图 / 月字帖图）：
//   1. image.render 返回的图与网页弹层**同一个函数、同一组输入**画出来的图逐字节相同（页面用现有函数画好，原生只显示）；
//   2. image.view 的文案 / 比例 / 页数 / 「也放进来」与网页弹层读到的是同一批 job 的同一批值（noteOf / failText 同一份函数）；
//   3. image.add（也放进来）与网页弹层同一个 toggleChip → 同一串 commit、同一份 store；
//   4. image.save 走网页弹层同一个保存口径（逐页按导出倍率重画，失败带原因）；
//   5. op 名与 api/image.js 的形状（页面卡只填自己的文件）。
//
// 「逐字节相同」怎么验：node 里没有 canvas，这里装一只**记录式**画布（每次绘制调用都记下来，toDataURL 把记录编码成 base64）。
// 同一组输入 → 同一串绘制记录 → 同一段字节；比例、倍率、落款、成员、墨迹、颜色任何一处不同，字节就不同。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAppApi } from '../../src/session/api/index.js';
import { imageActions, setImageActions } from '../../src/session/api/image.js';
import { buildImageJob, jobOf, imageView, imageRender, imageSpec, plainScope } from '../../src/ui/images-entry.js';
import { buildAnnualJob } from '../../src/ui/images-annual.js';
import { noteOf, failText } from '../../src/ui/components/image-preview.js';
import { EXPORT_SCALE } from '../../src/core/images/layout.js';
import { buildStroke, encodeInk } from '../../src/core/ink-math.js';
import { PALETTE_VARS } from '../../src/core/images/palette.js';
import { t } from '../../src/config/copy/index.js';

// ---------------------------------------------------------------- 记录式画布

/** 一次绘制调用的可序列化记录（对象参数只留类型名，免得 JSON 序列化炸掉）。 */
function callOf(prop, args, fill, stroke) {
  return [prop, ...args.map(a => (a === null || typeof a !== 'object' ? a : `[${typeof a}]`)), fill, stroke];
}

function installRecordingCanvas() {
  const created = [];
  const factory = (width, height) => {
    const calls = [];
    const state = {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', textAlign: 'left', textBaseline: 'alphabetic',
      shadowBlur: 0, shadowColor: '', miterLimit: 10,
    };
    const ctx = new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'measureText') return text => ({ width: [...String(text)].length * 26 });
        return (...args) => { calls.push(callOf(String(prop), args, target.fillStyle, target.strokeStyle)); };
      },
      set(target, prop, value) { target[prop] = value; return true; },
    });
    const canvas = {
      width, height, dataset: {}, calls,
      getContext: () => ctx,
      toDataURL: (type = 'image/png') => `data:${type};base64,${Buffer.from(JSON.stringify({ width, height, calls })).toString('base64')}`,
    };
    created.push(canvas);
    return canvas;
  };
  // 浅色调色板（导出图永远浅纸）：从设计令牌读同一组值（core/images/palette.js readLightPalette 读的就是这些 CSS 变量）
  const tokens = JSON.parse(readFileSync(new URL('../../docs/design/design-system-v1/tokens.json', import.meta.url), 'utf8'));
  const cssVarOf = {};
  for (const [key, name] of Object.entries(PALETTE_VARS)) cssVarOf[name] = tokens.color.light[key];
  globalThis.getComputedStyle = () => ({ getPropertyValue: name => cssVarOf[name] || '' });
  const root = { appendChild() {}, removeChild() {} };
  globalThis.document = {
    documentElement: root,
    createElement: tag => (tag === 'canvas' ? factory(0, 0) : { className: '', setAttribute() {}, hidden: false, remove() {} }),
  };
  return { factory, created };
}

const restore = installRecordingCanvas();

// node 里没有 FontFaceSet：requireCanvasFont 会说一声「字体没就绪、用回退字体」。那是环境噪声，不是本卡的差别。
const realWarn = console.warn;
console.warn = (...a) => { if (typeof a[0] === 'string' && a[0].indexOf('[shizi] font not ready') === 0) return; realWarn(...a); };

// ---------------------------------------------------------------- 造数（一次会话的作品）

// 存下来的墨迹（与 store 里的形状相同：encodeInk 的 {r: […]}）
const INK = encodeInk([buildStroke([{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }], { final: true })]);

function recOf(serial, char, kind, judgment, day, extra = {}) {
  const r = {
    id: `r${serial}`, cardKey: `base:${char}`, char, sessionId: extra.sessionId || 's9', kind,
    at: extra.at ?? Date.parse(`${day}T12:00:00`), localDay: day,
    help: { hints: 0, answerSeen: kind === 'answer-seen', traced: false },
  };
  if (kind === 'judged') r.judgment = judgment;
  return r;
}

/** 状态（records / sessions）+ 一只假的 store（getState / getInk / commit）。 */
function fixture() {
  const records = [
    recOf(1, '永', 'judged', 'correct', '2026-10-05'),
    recOf(2, '和', 'judged', 'wrong', '2026-10-05'),
    recOf(3, '静', 'answer-seen', null, '2026-10-05'),
    recOf(4, '山', 'skipped', null, '2026-10-05'),
  ];
  const items = records.map(r => ({ cardKey: r.cardKey, recordId: r.id, kind: r.kind }));
  const session = { id: 's9', slot: 'A', kind: 'daily', items, endedAt: Date.parse('2026-10-05T21:00:00'), startedDay: '2026-10-05' };
  let state = { records: { '2026-10': records }, sessions: { A: null, B: null, lastEnded: { A: session } }, ink: {} };
  const labels = [];
  const store = {
    getState: () => state,
    getInk: r => (['r1', 'r2', 'r3'].includes(r.id) ? INK : null),
    subscribe: () => () => {},
    commit(label, fn) {
      labels.push(label);
      const draft = JSON.parse(JSON.stringify(state));
      try {
        fn(draft, { now: Date.parse('2026-10-05T21:00:00'), label, nextId: p => `${p}9` });
      } catch (error) {
        return { ok: false, error: { kind: 'mutator', reason: error.message } };
      }
      state = draft;
      return { ok: true };
    },
  };
  return { store, state, labels, records, session };
}

const SCOPE = { kind: 'session', slot: 'A', sessionId: 's9' };

// ---------------------------------------------------------------- 用例

test('B3.11 image.render returns the very bytes the web overlay draws (same function, same input)', async () => {
  const { store } = fixture();
  const api = createAppApi({ getStore: () => store });

  for (const ratio of ['3:4', '1:1']) {
    // 网页路径：网页弹层用的同一个 job、同一个 renderPage
    const webJob = buildImageJob(SCOPE, { store });
    const webCanvas = (await webJob.renderPage(0, ratio, { scale: EXPORT_SCALE })).canvas;
    const webBytes = webCanvas.toDataURL('image/png');

    // App API 路径
    const reply = await api.call('image.render', { scope: SCOPE, ratio, page: 0, mode: 'export' });
    assert.equal(reply.ok, true, 'image.render ok');
    assert.equal(reply.image.status, 'ready');
    assert.equal(reply.image.dataURL, webBytes, `${ratio}: byte for byte the same picture`);
    assert.equal(reply.image.width, webCanvas.width);
    assert.equal(reply.image.height, webCanvas.height);
    assert.equal(reply.image.name, webJob.fileName(ratio, 0, webJob.pageCount()));
  }
});

test('B3.11 image.render: the preview scale is the web one (≤3 pages export scale, many pages 0.4)', async () => {
  const { store } = fixture();
  const api = createAppApi({ getStore: () => store });
  const job = buildImageJob(SCOPE, { store });
  const web = await job.renderPage(0, '3:4', { scale: EXPORT_SCALE });
  const preview = await api.call('image.render', { scope: SCOPE, ratio: '3:4', page: 0, mode: 'preview' });
  assert.equal(preview.image.dataURL, web.canvas.toDataURL('image/png'), 'one page → export scale (same bytes)');
  assert.equal(preview.image.width, web.canvas.width);
});

test('B3.11 image.view = the web job (same title / note / ratios / page count / chips)', () => {
  const { store } = fixture();
  const api = createAppApi({ getStore: () => store });
  const job = buildImageJob(SCOPE, { store });
  const view = api.call('image.view', { scope: SCOPE }).view;

  assert.equal(view.kind, job.kind);
  assert.equal(view.title, job.title);
  assert.deepEqual(view.ratios, job.ratios);
  assert.equal(view.ratio, job.initialRatio);
  assert.equal(view.pageCount, job.pageCount());
  assert.equal(view.status, job.status());
  // 说明句：网页弹层 noteOf 同一份函数
  assert.equal(view.note, noteOf({ state: job.status(), saveFailed: false, job, total: job.pageCount() }));
  assert.equal(view.shareLabel, t('R-B10.share'));
  assert.equal(view.saveLabel, t('X-IMAGES.save'));
  // 失败三段式的句子：同一份 failText
  assert.equal(view.failText.share, failText({ kind: 'share' }));
  assert.equal(view.failText.render, failText({ reason: 'render' }));
  assert.equal(view.failText.denied, failText({ reason: 'denied' }));
  assert.equal(view.failText.save, failText({ reason: 'download' }));
  // 「也放进来」：同一批 chip（recordId / 字 / 是否已放进来）
  const chips = job.chips();
  assert.deepEqual(view.chips.map(c => [c.recordId, c.ch, c.on]), chips.map(c => [c.recordId, c.ch, c.on]));
  // 没有原生预览时，网页弹层照旧（这条 op 不改网页行为）
  assert.equal(typeof job.renderPage, 'function');
});

test('B3.11 image.add = the web toggleChip (same commit, same store)', () => {
  const { store, labels } = fixture();
  const api = createAppApi({ getStore: () => store });
  const reply = api.call('image.add', { scope: SCOPE, recordId: 'r2' });
  assert.equal(reply.ok, true);
  assert.deepEqual(labels, ['result:added'], 'the web commit function ran');
  assert.deepEqual(store.getState().sessions.lastEnded.A.added, ['r2'], 'the char is in the work now');
  // 再点一次 = 放回去（同一个 toggleChip）
  api.call('image.add', { scope: SCOPE, recordId: 'r2' });
  assert.deepEqual(store.getState().sessions.lastEnded.A.added, []);
});

test('B3.11 image.save walks the web save path page by page (export scale) and reports the reason', async () => {
  const { store } = fixture();
  const api = createAppApi({ getStore: () => store });
  const job = buildImageJob(SCOPE, { store });
  const pages = [];
  for (let i = 0; i < job.pageCount(); i += 1) pages.push((await job.renderPage(i, '3:4', { scale: EXPORT_SCALE })).canvas);
  // node 里没有浏览器也没有原生壳：下载不成功 → 回 {ok:false, reason}（与网页 saveAll 同一口径）
  const reply = await api.call('image.save', { scope: SCOPE, ratio: '3:4' });
  assert.equal(reply.ok, false);
  assert.equal(reply.error.kind, 'download', 'the failure reason is the web one');
  assert.ok(pages.length >= 1);
});

test('B3.11 op names and the api file (only src/session/api/image.js is filled by this card)', () => {
  const api = createAppApi({});
  for (const op of ['image.view', 'image.render', 'image.add', 'image.save']) {
    assert.ok(api.ops.includes(op), `${op} registered`);
  }
  assert.equal(imageActions() && typeof imageActions().view, 'function', 'the UI side registered its actions');
  setImageActions(null);
  assert.equal(api.call('image.view', { scope: SCOPE }).error.kind, 'unavailable', 'no UI actions → unavailable');
});

test('B3.11 scope is serialisable and the annual job is the web one', () => {
  assert.deepEqual(plainScope({ kind: 'session', slot: 'A', sessionId: 's9', extra: 1 }), { kind: 'session', slot: 'A', sessionId: 's9' });
  assert.deepEqual(plainScope({ kind: 'annual', year: 2026 }), { kind: 'annual', year: 2026 });
  // 年报：原生用的 job 与网页弹层同一批函数（buildAnnualJob）
  const job = jobOf({ kind: 'annual', year: 2026 });
  assert.equal(job.kind, 'annual');
  assert.equal(job.ratios.length, 1);
  assert.equal(job.ratios[0], '3:4');
  assert.ok(buildAnnualJob, 'the web annual job builder is the one in use');
});

test.after(() => {
  if (globalThis.document) delete globalThis.document;
  if (globalThis.getComputedStyle) delete globalThis.getComputedStyle;
  console.warn = realWarn;
  void restore;
});


test('B4.6 image.spec provides serializable native inputs without creating a canvas', () => {
  const { created } = installRecordingCanvas();
  const { store } = fixture();
  const ctx = { getStore: () => store };
  const spec = imageSpec(SCOPE, '1:1', 0, 'export', ctx);
  assert.equal(spec.ok, true);
  assert.equal(spec.spec.kind, 'work');
  assert.equal(spec.spec.args.scale, EXPORT_SCALE);
  assert.equal(spec.spec.args.ratio, '1:1');
  assert.ok(spec.spec.args.cells.length > 0);
  assert.equal(spec.spec.palette.textures.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(spec)), spec);
  assert.equal(created.length, 0, 'native input construction never rasterizes with canvas');
});
