// src/data/strokes.js：超时 + 重试 + LRU + 内嵌优先 + 无数据返回 null（01 §8.5，02 M1-2）。
// fetch 全部注入（不碰网络）；超时用很短的 timeoutMs 跑真计时器。
// 末尾顺带测 src/ui/canvas/glyph.js 的纯函数（坐标变换与 hanzi-writer 一致、颜色规整）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createStrokesLoader,
  isSingleChar,
  strokesURL,
  validateStrokes,
  watchStrokes,
  EMBEDDED_GLOBAL,
  STROKES_TIMEOUT_MS,
  STROKES_RETRIES,
} from '../../src/data/strokes.js';
import { glyphTransform, mapPoint, mediansInBox, normalizeColor, GLYPH_PAD_RATIO } from '../../src/ui/canvas/glyph.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readData = ch => JSON.parse(readFileSync(`${ROOT}data/${ch}.json`, 'utf8'));
const YI = readData('一');
const WO = readData('我');

const ok = json => ({ ok: true, status: 200, json: async () => json });
const status = code => ({ ok: false, status: code, json: async () => ({}) });

/** 可编排的假 fetch：script 是按调用次序的动作；超出部分重复最后一个。 */
function scriptedFetch(script) {
  const calls = [];
  const fn = (url, init) => {
    const i = calls.length;
    calls.push({ url, signal: init && init.signal });
    const step = script[Math.min(i, script.length - 1)];
    if (step === 'hang') {
      return new Promise((resolve, reject) => {
        if (init && init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (step === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
    if (typeof step === 'function') return Promise.resolve(step(url));
    return Promise.resolve(step);
  };
  fn.calls = calls;
  return fn;
}

const fast = extra => ({ timeoutMs: 25, retryDelayMs: 0, embedded: {}, ...extra });

test('strokes: defaults follow 01 §8.5 (3s timeout, 1 retry)', () => {
  assert.equal(STROKES_TIMEOUT_MS, 3000);
  assert.equal(STROKES_RETRIES, 1);
});

test('strokes: URL is data/<encodeURIComponent(字)>.json, incl. supplementary plane', () => {
  assert.equal(strokesURL('一'), 'data/%E4%B8%80.json');
  assert.equal(strokesURL('𠮷'), 'data/' + encodeURIComponent('𠮷') + '.json');
  assert.ok(isSingleChar('𠮷'));
  assert.ok(isSingleChar('一'));
  for (const bad of ['', 'ab', '一二', null, undefined, 3, '越来越']) assert.equal(isSingleChar(bad), false, String(bad));
});

test('strokes: validateStrokes accepts real data files and rejects broken shapes', () => {
  const yi = validateStrokes(YI);
  assert.equal(yi.strokes.length, 1);
  assert.equal(yi.medians.length, 1);
  const wo = validateStrokes(WO);
  assert.equal(wo.strokes.length, 7);
  assert.deepEqual([...wo.radStrokes], [1, 4, 5, 6]);
  assert.ok(Object.isFrozen(wo) && Object.isFrozen(wo.strokes) && Object.isFrozen(wo.medians[0]));
  assert.equal(validateStrokes(null), null);
  assert.equal(validateStrokes({}), null);
  assert.equal(validateStrokes({ strokes: [], medians: [] }), null, 'empty');
  assert.equal(validateStrokes({ strokes: ['M 0 0 Z'], medians: [] }), null, 'length mismatch');
  assert.equal(validateStrokes({ strokes: [''], medians: [[[1, 2]]] }), null, 'empty path');
  assert.equal(validateStrokes({ strokes: ['M 0 0 Z'], medians: [[[1, 'x']]] }), null, 'bad point');
  assert.equal(validateStrokes({ strokes: ['M 0 0 Z'], medians: [[]] }), null, 'empty median');
  const noRad = validateStrokes({ strokes: ['M 0 0 Z'], medians: [[[1, 2]]], radStrokes: [5] });
  assert.equal(noRad.radStrokes, undefined, 'out-of-range radStrokes dropped');
});

test('strokes: success is cached (second load does not fetch)', async () => {
  const f = scriptedFetch([ok(YI)]);
  const loader = createStrokesLoader(fast({ fetch: f }));
  const a = await loader.loadDetailed('一');
  assert.equal(a.source, 'network');
  assert.equal(a.attempts, 1);
  assert.equal(a.data.strokes.length, 1);
  assert.equal(f.calls[0].url, strokesURL('一'));
  const b = await loader.loadDetailed('一');
  assert.equal(b.source, 'cache');
  assert.equal(b.data, a.data);
  assert.equal(f.calls.length, 1);
  assert.equal(loader.peek('一'), a.data);
});

test('strokes: first attempt times out → retried once → data', async () => {
  const f = scriptedFetch(['hang', ok(WO)]);
  const loader = createStrokesLoader(fast({ fetch: f }));
  const t0 = Date.now();
  const d = await loader.loadDetailed('我');
  assert.ok(d.data, 'retry succeeded');
  assert.equal(d.attempts, 2);
  assert.equal(d.source, 'network');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].signal.aborted, true, 'timed-out request was aborted');
  assert.ok(Date.now() - t0 >= 20, 'waited for the timeout');
});

test('strokes: both attempts time out → null (never rejects), not cached, next call fetches again', async () => {
  const f = scriptedFetch(['hang', 'hang', ok(WO)]);
  const loader = createStrokesLoader(fast({ fetch: f }));
  const d = await loader.loadDetailed('我');
  assert.equal(d.data, null);
  assert.equal(d.reason, 'timeout');
  assert.equal(d.attempts, 2, '1 try + 1 retry');
  assert.equal(loader.peek('我'), undefined, 'failure not cached');
  assert.equal(await loader.load('我') !== null, true, 'later call (e.g. back online) succeeds');
  assert.equal(f.calls.length, 3);
});

test('strokes: a fetch that ignores abort still resolves at the timeout', async () => {
  const f = () => new Promise(() => {}); // 永不结束、不理 signal
  const loader = createStrokesLoader(fast({ fetch: f }));
  const d = await loader.loadDetailed('我');
  assert.equal(d.data, null);
  assert.equal(d.reason, 'timeout');
});

test('strokes: a hanging body (json never resolves) counts as timeout', async () => {
  const f = scriptedFetch([{ ok: true, status: 200, json: () => new Promise(() => {}) }]);
  const loader = createStrokesLoader(fast({ fetch: f }));
  const d = await loader.loadDetailed('我');
  assert.equal(d.reason, 'timeout');
  assert.equal(f.calls.length, 2);
});

test('strokes: network error and HTTP 5xx are retried', async () => {
  const f1 = scriptedFetch(['throw', ok(YI)]);
  assert.ok(await createStrokesLoader(fast({ fetch: f1 })).load('一'));
  assert.equal(f1.calls.length, 2);
  const f2 = scriptedFetch([status(503), ok(YI)]);
  assert.ok(await createStrokesLoader(fast({ fetch: f2 })).load('一'));
  assert.equal(f2.calls.length, 2);
  const f3 = scriptedFetch(['throw']);
  const d3 = await createStrokesLoader(fast({ fetch: f3 })).loadDetailed('一');
  assert.equal(d3.data, null);
  assert.equal(d3.reason, 'network');
  assert.equal(f3.calls.length, 2);
  const f4 = scriptedFetch([status(500)]);
  const d4 = await createStrokesLoader(fast({ fetch: f4 })).loadDetailed('一');
  assert.equal(d4.reason, 'http');
});

test('strokes: 404 means no data — null without retry', async () => {
  const f = scriptedFetch([status(404), ok(YI)]);
  const d = await createStrokesLoader(fast({ fetch: f })).loadDetailed('丟');
  assert.equal(d.data, null);
  assert.equal(d.reason, 'not-found');
  assert.equal(f.calls.length, 1);
});

test('strokes: corrupt JSON or wrong shape → null without retry', async () => {
  const f = scriptedFetch([{ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }]);
  const d = await createStrokesLoader(fast({ fetch: f })).loadDetailed('一');
  assert.equal(d.reason, 'invalid');
  assert.equal(f.calls.length, 1);
  const g = scriptedFetch([ok({ strokes: ['M0 0Z'], medians: [] })]);
  const e = await createStrokesLoader(fast({ fetch: g })).loadDetailed('一');
  assert.equal(e.reason, 'invalid');
  assert.equal(g.calls.length, 1);
});

test('strokes: bad char never fetches', async () => {
  const f = scriptedFetch([ok(YI)]);
  const loader = createStrokesLoader(fast({ fetch: f }));
  for (const bad of ['', 'ab', null, undefined, '一二']) {
    const d = await loader.loadDetailed(bad);
    assert.equal(d.data, null);
    assert.equal(d.reason, 'bad-char');
  }
  assert.equal(f.calls.length, 0);
});

test('strokes: concurrent loads of one char share a single request', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  let n = 0;
  const f = async () => { n += 1; await gate; return ok(WO); };
  const loader = createStrokesLoader(fast({ fetch: f, timeoutMs: 1000 }));
  const p1 = loader.load('我');
  const p2 = loader.load('我');
  assert.equal(loader.isLoading('我'), true);
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(n, 1);
  assert.equal(a, b);
  assert.equal(loader.isLoading('我'), false);
});

test('strokes: LRU keeps the most recently used and evicts the oldest', async () => {
  const f = scriptedFetch([url => ok(url.includes(encodeURIComponent('一')) ? YI : WO)]);
  const loader = createStrokesLoader(fast({ fetch: f, lruSize: 2 }));
  await loader.load('一');
  await loader.load('我');
  await loader.load('一'); // 一 变成最近使用
  assert.deepEqual(loader.cachedChars(), ['我', '一']);
  await loader.load('人'); // 挤掉最久未用的 我
  assert.deepEqual(loader.cachedChars(), ['一', '人']);
  assert.equal(loader.peek('我'), undefined);
  assert.equal(loader.stats().evictions, 1);
  const before = f.calls.length;
  await loader.load('一');
  assert.equal(f.calls.length, before, '一 still cached');
  await loader.load('我');
  assert.equal(f.calls.length, before + 1, '我 was evicted → refetched');
});

test('strokes: embedded data wins over cache and network', async () => {
  const f = scriptedFetch([ok(YI)]);
  const loader = createStrokesLoader({ fetch: f, timeoutMs: 25, embedded: { 一: YI } });
  const d = await loader.loadDetailed('一');
  assert.equal(d.source, 'embedded');
  assert.equal(d.data.strokes.length, 1);
  assert.equal(f.calls.length, 0);
  assert.ok(loader.peek('一'));
  const fnLoader = createStrokesLoader({ fetch: f, timeoutMs: 25, embedded: ch => (ch === '我' ? WO : null) });
  assert.equal((await fnLoader.loadDetailed('我')).source, 'embedded');
  assert.equal(f.calls.length, 0);
  // 内嵌表坏了：跳过内嵌走网络
  const badEmb = createStrokesLoader({ fetch: f, timeoutMs: 25, retryDelayMs: 0, embedded: { 一: { strokes: 1 } } });
  assert.equal((await badEmb.loadDetailed('一')).source, 'network');
});

test('strokes: global SHIZI_STROKE_DATA is the default embedded table', async () => {
  const f = scriptedFetch([ok(YI)]);
  globalThis[EMBEDDED_GLOBAL] = { 我: WO };
  try {
    const loader = createStrokesLoader({ fetch: f, timeoutMs: 25 });
    assert.equal((await loader.loadDetailed('我')).source, 'embedded');
    assert.equal(f.calls.length, 0);
  } finally {
    delete globalThis[EMBEDDED_GLOBAL];
  }
});

function fakeWin() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.has(type)) listeners.get(type).delete(fn);
    },
    fire(type) {
      for (const fn of [...(listeners.get(type) || [])]) fn({ type });
    },
    count: type => (listeners.get(type) || new Set()).size,
  };
}

const settle = () => new Promise(r => setTimeout(r, 5));

test('watchStrokes: missing → online event → ready, then stops listening', async () => {
  const f = scriptedFetch(['throw', 'throw', ok(WO)]);
  const loader = createStrokesLoader(fast({ fetch: f }));
  const win = fakeWin();
  const events = [];
  const w = watchStrokes('我', ev => events.push(ev.status), { win, loader });
  assert.deepEqual(events, ['loading']);
  await settle();
  assert.deepEqual(events, ['loading', 'missing']);
  assert.equal(win.count('online'), 1);
  win.fire('online');
  await settle();
  assert.deepEqual(events, ['loading', 'missing', 'ready']);
  assert.equal(win.count('online'), 0, 'listener removed after success');
  w.stop();
});

test('watchStrokes: still failing after online stays missing (no duplicate event); stop() silences', async () => {
  const f = scriptedFetch(['throw']);
  const loader = createStrokesLoader(fast({ fetch: f }));
  const win = fakeWin();
  const events = [];
  const w = watchStrokes('我', ev => events.push(ev.status), { win, loader });
  await settle();
  win.fire('online');
  await settle();
  assert.deepEqual(events, ['loading', 'missing']);
  assert.equal(f.calls.length, 4, 'online triggered a second round (1 try + 1 retry)');
  w.stop();
  assert.equal(win.count('online'), 0);
  win.fire('online');
  await settle();
  assert.equal(f.calls.length, 4);
});

test('watchStrokes: cached data is delivered synchronously as ready', async () => {
  const f = scriptedFetch([ok(YI)]);
  const loader = createStrokesLoader(fast({ fetch: f }));
  await loader.load('一');
  const events = [];
  watchStrokes('一', ev => events.push(ev), { win: fakeWin(), loader });
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'ready');
  assert.equal(events[0].source, 'cache');
});

// ---------------------------------------------------------------- glyph.js 纯函数

test('glyph: transform matches hanzi-writer Positioner (pad + (900 − y)·k)', () => {
  const t = glyphTransform({ size: 345 });
  const pad = 345 * GLYPH_PAD_RATIO;
  const k = (345 - 2 * pad) / 1024;
  assert.ok(Math.abs(t.k - k) < 1e-12);
  const [x, y] = mapPoint([512, 388], t);
  assert.ok(Math.abs(x - (pad + 512 * k)) < 1e-9);
  assert.ok(Math.abs(y - (pad + (900 - 388) * k)) < 1e-9);
  // 数据坐标范围 x 0–1024、y −124–900 正好落满 [pad, size − pad]
  const [x0, yTop] = mapPoint([0, 900], t);
  const [x1, yBottom] = mapPoint([1024, -124], t);
  assert.ok(Math.abs(x0 - pad) < 1e-9 && Math.abs(yTop - pad) < 1e-9);
  assert.ok(Math.abs(x1 - (345 - pad)) < 1e-9 && Math.abs(yBottom - (345 - pad)) < 1e-9);
  // 与原型 glyphT：translate(OFF, OFF+900*KK) scale(KK,−KK)，OFF=20.7、KK=345*(1−.12)/1024
  assert.ok(Math.abs(t.ox - 20.7) < 1e-9);
  assert.ok(Math.abs(t.k - (345 * 0.88) / 1024) < 1e-12);
  // 偏移
  const t2 = glyphTransform({ size: 200, padding: 0, x: 10, y: 20 });
  assert.deepEqual(mapPoint([0, 900], t2), [10, 20]);
});

test('glyph: mediansInBox maps every median point into the box', () => {
  const m = mediansInBox(validateStrokes(WO), { size: 258 });
  assert.equal(m.length, 7);
  for (const stroke of m) for (const [x, y] of stroke) assert.ok(x >= 0 && x <= 258 && y >= 0 && y <= 258, `${x},${y}`);
  assert.deepEqual(mediansInBox(null), []);
});

test('glyph: normalizeColor yields shapes hanzi-writer can parse', () => {
  assert.equal(normalizeColor('#5D5952'), '#5D5952');
  assert.equal(normalizeColor(' #abc '), '#abc');
  assert.equal(normalizeColor('#A6533F47'), 'rgba(166, 83, 63, 0.278)');
  assert.equal(normalizeColor('rgba(200,110,85,.34)'), 'rgba(200, 110, 85, 0.34)');
  assert.equal(normalizeColor('rgb(1, 2, 3)'), 'rgba(1, 2, 3, 1)');
  assert.equal(normalizeColor('var(--ref)'), null);
  assert.equal(normalizeColor(''), null);
  assert.equal(normalizeColor(undefined), null);
});
