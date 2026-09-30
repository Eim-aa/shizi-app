#!/usr/bin/env node
// sw.js 单测（M0-2 起；M5-1 按 v14 契约重写）：在 node:vm 里求值真实 sw.js（importScripts 真实 sw-manifest.js 或注入的清单），
// 注入假 caches（多版本）/ fetch / clients，按 install / activate / message / fetch 事件驱动。
//   1. 配额隔离：cache.put 抛 QuotaExceededError 时，HTML/关键资源/笔顺仍返回新鲜响应，已有核心字离线副本不被删。
//   2. 关键资源（带指纹的 deck）服务端 503 → 回落同版本缓存；缓存里没有时把 503 交回而不是伪造成功；
//      网络 200 但内容与 ?v= 指纹不符（服务端已是下一版）→ 同样回落缓存。
//   3. 应用入口导航从本版缓存返回 index.html（不等网络）并后台 registration.update()；
//      入口以外的 HTML：4xx 不拿缓存冒充，5xx 回落缓存的 index.html。
//   4. 笔顺缓存超过上限时只淘汰运行时条目，核心 600 字（此处为「水」）永不淘汰。
//   5. 安装：核心壳 addAll 原子；尽力批次与核心笔顺逐项失败不阻断安装；skipWaiting。
//   6. 激活：不 navigate 任何窗口，只 postMessage {type:'shizi-sw-activated', build}；旧缓存留到所有窗口 hello 报上本版才删；
//      旧缓存里的笔顺搬进新版。
//   7. 同版本：还没刷新的旧版页面（hello 报旧 BUILD）取模块时先从它那一版的缓存取。
//   8. 生成物一致：sw-manifest.js 的 build 与 src/build-info.js、index.html meta 相同；壳清单不含笔顺 JSON、含入口与 app.js。

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swSource = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const manifestSource = readFileSync(join(ROOT, 'sw-manifest.js'), 'utf8');
const ORIGIN = 'http://127.0.0.1:8000';
const results = [];

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ''}`);
}

const requestURL = request => (request && request.url ? request.url : new URL(String(request), `${ORIGIN}/`).href);
const sha12 = text => createHash('sha256').update(text).digest('hex').slice(0, 12);

function realManifest() {
  const ctx = { self: {} };
  vm.runInNewContext(manifestSource, ctx, { filename: 'sw-manifest.js' });
  return ctx.self.SHIZI_SW_MANIFEST;
}

const TEST_BUILD = '20260101-aaaaaaaaaaaa';
const TEST_MANIFEST = {
  build: TEST_BUILD,
  shell: ['index.html', 'src/app.js', 'core-strokes.js?v=111111111111'],
  bestEffort: ['deck-data.js?v=222222222222', 'data/etymology.json'],
  coreStrokes: ['水'],
};

// 假环境：
//   stores  缓存名 → Map(url → body)；current() 取本版缓存
//   network(pathname, url) → Response | Promise<Response>（抛错 = 断网）
//   putError  put 时抛出的异常
function loadWorker({ stores = {}, putError = null, network = () => new Response('net'), manifest = TEST_MANIFEST, windows = [] } = {}) {
  const listeners = {};
  const cacheMaps = new Map(Object.entries(stores).map(([name, entries]) => [name, new Map(entries)]));
  const counters = { deleteCalls: 0, updateCalls: 0, navigateCalls: 0, fetches: [], skipWaiting: 0, claim: 0 };
  function cacheFor(name) {
    if (!cacheMaps.has(name)) cacheMaps.set(name, new Map());
    const stored = cacheMaps.get(name);
    return {
      stored,
      addAll: async requests => {
        const staged = [];
        for (const request of requests) {
          const res = await context.fetch(request);
          if (!res || !res.ok) throw new TypeError(`addAll: ${requestURL(request)} ${res && res.status}`);
          staged.push([requestURL(request), await res.text()]);
        }
        for (const [url, body] of staged) stored.set(url, body);
      },
      keys: async () => Array.from(stored.keys(), url => new Request(url)),
      delete: async request => { counters.deleteCalls += 1; return stored.delete(requestURL(request)); },
      match: async request => (stored.has(requestURL(request)) ? new Response(stored.get(requestURL(request))) : undefined),
      put: async (request, response) => {
        if (putError) throw putError;
        stored.set(requestURL(request), await response.text());
      },
    };
  }
  const posted = [];
  const clientList = windows.map(id => ({
    id,
    type: 'window',
    url: `${ORIGIN}/`,
    postMessage: message => posted.push({ id, message }),
    navigate: async () => { counters.navigateCalls += 1; },
  }));
  const context = {
    self: {
      location: { href: `${ORIGIN}/sw.js`, origin: ORIGIN },
      addEventListener: (name, handler) => { listeners[name] = handler; },
      skipWaiting: async () => { counters.skipWaiting += 1; },
      clients: { claim: async () => { counters.claim += 1; }, matchAll: async () => clientList.slice() },
      registration: { update: async () => { counters.updateCalls += 1; } },
      crypto: globalThis.crypto,
    },
    caches: {
      open: async name => cacheFor(name),
      has: async name => cacheMaps.has(name),
      keys: async () => [...cacheMaps.keys()],
      delete: async name => cacheMaps.delete(name),
    },
    fetch: async request => {
      const url = new URL(requestURL(request));
      counters.fetches.push(url.pathname + url.search);
      return network(url.pathname, url);
    },
    importScripts: () => { context.self.SHIZI_SW_MANIFEST = manifest; },
    Request, Response, URL, URLSearchParams, DOMException, Promise, Set, Map, Array, Uint8Array, Object, String, console,
  };
  vm.runInNewContext(swSource, context, { filename: 'sw.js' });
  assert(typeof listeners.fetch === 'function', 'sw.js must register a fetch listener');
  const VERSION = `shizi-v14-${manifest.build}`;

  async function dispatch(pathname, { accept = 'application/javascript', clientId = '' } = {}) {
    let responsePromise;
    const waits = [];
    listeners.fetch({
      request: new Request(`${ORIGIN}${pathname}`, { headers: { accept } }),
      clientId,
      respondWith: promise => { responsePromise = Promise.resolve(promise); },
      waitUntil: promise => waits.push(Promise.resolve(promise)),
    });
    if (!responsePromise) return null;
    const response = await responsePromise;
    await Promise.all(waits);
    return response ? { status: response.status, type: response.type, body: response.type === 'error' ? null : await response.text() } : null;
  }
  async function lifecycle(name) {
    let done;
    listeners[name]({ waitUntil: promise => { done = Promise.resolve(promise); } });
    return done;
  }
  async function message(data, sourceId) {
    const waits = [];
    const source = clientList.find(c => c.id === sourceId) || null;
    listeners.message({ data, source, waitUntil: promise => waits.push(Promise.resolve(promise)) });
    await Promise.all(waits);
  }
  return {
    dispatch, lifecycle, message, counters, posted, VERSION, cacheMaps,
    stored: (name = VERSION) => cacheFor(name).stored,
  };
}

async function run(name, fn) {
  await fn();
  results.push(name);
}

const fresh = pathname => new Response(`fresh:${pathname}`, { status: 200 });
const coreURL = `${ORIGIN}/data/%E6%B0%B4.json`;
const V = `shizi-v14-${TEST_BUILD}`;

await run('quota failures keep fresh responses and the existing offline core copy', async () => {
  const worker = loadWorker({
    stores: { [V]: [[coreURL, 'cached-core']] },
    putError: new DOMException('quota', 'QuotaExceededError'),
    network: fresh,
  });
  const got = {
    html: (await worker.dispatch('/', { accept: 'text/html' })).body,
    critical: (await worker.dispatch('/deck-data.js')).body,
    stroke: (await worker.dispatch('/data/%E7%81%AB.json', { accept: 'application/json' })).body,
    core: (await worker.dispatch('/data/%E6%B0%B4.json', { accept: 'application/json' })).body,
  };
  assert(got.html === 'fresh:/' && got.critical === 'fresh:/deck-data.js' && got.stroke === 'fresh:/data/%E7%81%AB.json'
    && got.core === 'cached-core' && worker.stored().get(coreURL) === 'cached-core' && worker.counters.deleteCalls === 0,
  'cache quota failures must preserve successful responses and existing offline core copies', { got, deleteCalls: worker.counters.deleteCalls });
});

await run('critical fingerprinted resource 503 or wrong-version bytes fall back to the same-version cache only', async () => {
  const deckBody = 'const SEED = [1];';
  const v = sha12(deckBody);
  const deck = `${ORIGIN}/deck-data.js?v=${v}`;
  const unavailable = () => new Response('Service Unavailable', { status: 503 });
  const withCache = loadWorker({ stores: { [V]: [[deck, deckBody]] }, network: unavailable });
  const hit = await withCache.dispatch(`/deck-data.js?v=${v}`);
  assert(hit.status === 200 && hit.body === deckBody, 'a 503 for a cached critical resource must serve the cached copy', hit);
  const withoutCache = loadWorker({ network: unavailable });
  const miss = await withoutCache.dispatch(`/deck-data.js?v=${v}`);
  assert(miss.status === 503, 'without a cached copy the 503 must reach the page instead of a fabricated success', miss);
  assert(!withoutCache.stored().has(deck), 'error responses must never be cached');
  const nextVersion = loadWorker({ stores: { [V]: [[deck, deckBody]] }, network: () => new Response('const SEED = [2];') });
  const mismatch = await nextVersion.dispatch(`/deck-data.js?v=${v}`);
  assert(mismatch.body === deckBody && nextVersion.stored().get(deck) === deckBody,
    'a 200 whose bytes do not match ?v= must not replace or bypass the cached copy', mismatch);
  const matching = loadWorker({ network: () => new Response(deckBody) });
  const ok = await matching.dispatch(`/deck-data.js?v=${v}`);
  assert(ok.body === deckBody && matching.stored().get(deck) === deckBody, 'matching bytes are served and cached', ok);
});

await run('app-entry navigation is served from the version cache and revalidates the worker; other HTML keeps 4xx/5xx rules', async () => {
  const index = `${ORIGIN}/index.html`;
  const cached = loadWorker({ stores: { [V]: [[index, 'cached-index']] }, network: fresh });
  for (const path of ['/', '/index.html', '/?source=pwa']) {
    const got = await cached.dispatch(path, { accept: 'text/html' });
    assert(got.status === 200 && got.body === 'cached-index', `navigation ${path} must come from the version cache`, got);
  }
  assert(cached.counters.fetches.length === 0, 'cached app-entry navigation must not hit the network', cached.counters.fetches);
  assert(cached.counters.updateCalls === 3, 'each app-entry navigation revalidates the worker in the background', cached.counters);
  const cold = loadWorker({ network: fresh });
  const coldGot = await cold.dispatch('/', { accept: 'text/html' });
  assert(coldGot.body === 'fresh:/', 'without a cached shell the app entry comes from the network', coldGot);
  const notFound = loadWorker({ stores: { [V]: [[index, 'cached-index']] }, network: () => new Response('nope', { status: 404 }) });
  const four = await notFound.dispatch('/missing.html', { accept: 'text/html' });
  assert(four.status === 404, 'a 404 page must not be replaced by cached HTML', four);
  const serverError = loadWorker({ stores: { [V]: [[index, 'cached-index']] }, network: () => new Response('down', { status: 502 }) });
  const five = await serverError.dispatch('/other.html', { accept: 'text/html' });
  assert(five.status === 200 && five.body === 'cached-index', 'a 5xx navigation must fall back to the cached shell', five);
});

await run('stroke cache trimming never evicts core characters', async () => {
  const entries = [[coreURL, 'cached-core']];
  for (let i = 0; i < 805; i += 1) entries.push([`${ORIGIN}/data/r${i}.json`, `runtime-${i}`]);
  const worker = loadWorker({ stores: { [V]: entries }, network: fresh });
  await worker.dispatch('/data/new.json', { accept: 'application/json' });
  const strokes = [...worker.stored().keys()].filter(url => /\/data\/[^/]+\.json$/.test(url));
  assert(worker.stored().get(coreURL) === 'cached-core', 'the core character copy must survive trimming');
  assert(strokes.length <= 800, 'runtime stroke cache must be bounded', { count: strokes.length });
  assert(worker.counters.deleteCalls > 0, 'trimming must have evicted runtime entries');
});

await run('install: atomic shell, best-effort batch and core strokes never block, then skipWaiting', async () => {
  const failing = loadWorker({ network: path => (path === '/src/app.js' ? new Response('x', { status: 503 }) : fresh(path)) });
  let failed = false;
  await failing.lifecycle('install').catch(() => { failed = true; });
  assert(failed && failing.stored().size === 0 && failing.counters.skipWaiting === 0,
    'a failed shell item must fail installation without a partially populated cache', { size: failing.stored().size });
  const bestEffortFails = loadWorker({
    network: path => (path === '/deck-data.js' || path.startsWith('/data/') ? new Response('x', { status: 503 }) : fresh(path)),
  });
  await bestEffortFails.lifecycle('install');
  const keys = [...bestEffortFails.stored().keys()];
  assert(keys.includes(`${ORIGIN}/index.html`) && keys.includes(`${ORIGIN}/src/app.js`) && !keys.some(k => k.includes('deck-data.js'))
    && bestEffortFails.counters.skipWaiting === 1, 'best-effort failures must not block installation', keys);
  const coreFetched = loadWorker({ network: fresh });
  await coreFetched.lifecycle('install');
  assert(coreFetched.stored().has(coreURL) && coreFetched.stored().has(`${ORIGIN}/deck-data.js?v=222222222222`) === false,
    'core strokes are precached; wrong-fingerprint deck bytes are not', [...coreFetched.stored().keys()]);
});

await run('activate: never navigates, posts the new build, defers old-cache deletion until every window is current', async () => {
  const oldStroke = `${ORIGIN}/data/%E7%81%AB.json`;
  const worker = loadWorker({
    stores: { 'shizi-v13-old': [[oldStroke, 'old-fire'], [`${ORIGIN}/index.html`, 'old-index']], [V]: [[`${ORIGIN}/index.html`, 'new-index']] },
    windows: ['w1', 'w2'],
  });
  await worker.lifecycle('activate');
  assert(worker.counters.navigateCalls === 0 && worker.counters.claim === 1, 'activation must not force-navigate clients', worker.counters);
  assert(worker.posted.length === 2 && worker.posted.every(p => p.message.type === 'shizi-sw-activated' && p.message.build === TEST_BUILD),
    'every window is told about the new build', worker.posted);
  assert(worker.stored().get(oldStroke) === 'old-fire', 'strokes from the previous cache are carried forward');
  assert(worker.cacheMaps.has('shizi-v13-old'), 'old cache survives while windows have not reloaded');
  await worker.message({ type: 'shizi-hello', build: TEST_BUILD }, 'w1');
  assert(worker.cacheMaps.has('shizi-v13-old'), 'old cache survives while one window is still old');
  assert(worker.posted.some(p => p.id === 'w1' && p.message.type === 'shizi-sw-version' && p.message.build === TEST_BUILD),
    'hello is answered with the worker build');
  await worker.message({ type: 'shizi-hello', build: TEST_BUILD }, 'w2');
  assert(!worker.cacheMaps.has('shizi-v13-old') && worker.cacheMaps.has(V), 'old cache is deleted once every window is current',
    [...worker.cacheMaps.keys()]);
  const empty = loadWorker({ stores: { 'shizi-v10': [] } });
  await empty.lifecycle('activate');
  assert(!empty.cacheMaps.has('shizi-v10'), 'with no windows the old cache is deleted at activation');
});

await run('a not-yet-reloaded page keeps reading modules from its own version cache', async () => {
  const OLD = 'shizi-v14-20251231-bbbbbbbbbbbb';
  const worker = loadWorker({
    stores: { [OLD]: [[`${ORIGIN}/src/ui/lazy.js`, 'old-lazy']], [V]: [[`${ORIGIN}/src/ui/lazy.js`, 'new-lazy']] },
    windows: ['old-page', 'new-page'],
  });
  await worker.message({ type: 'shizi-hello', build: '20251231-bbbbbbbbbbbb' }, 'old-page');
  await worker.message({ type: 'shizi-hello', build: TEST_BUILD }, 'new-page');
  const oldGot = await worker.dispatch('/src/ui/lazy.js', { clientId: 'old-page' });
  const newGot = await worker.dispatch('/src/ui/lazy.js', { clientId: 'new-page' });
  const unknown = await worker.dispatch('/src/ui/lazy.js', { clientId: 'someone' });
  assert(oldGot.body === 'old-lazy' && newGot.body === 'new-lazy' && unknown.body === 'new-lazy',
    'module requests follow the requesting page version', { oldGot, newGot, unknown });
  assert(worker.counters.fetches.length === 0, 'cached modules never hit the network', worker.counters.fetches);
});

await run('generated sw-manifest.js agrees with build-info.js and index.html meta', async () => {
  const manifest = realManifest();
  const buildInfo = readFileSync(join(ROOT, 'src', 'build-info.js'), 'utf8').match(/export const BUILD = '([^']+)'/)?.[1];
  const meta = readFileSync(join(ROOT, 'index.html'), 'utf8').match(/<meta name="shizi-asset-build" content="([^"]+)">/)?.[1];
  assert(manifest && manifest.build === buildInfo && buildInfo === meta && /^\d{8}-[0-9a-f]{12}$/.test(buildInfo),
    'BUILD must be identical in sw-manifest.js, src/build-info.js and index.html', { sw: manifest && manifest.build, buildInfo, meta });
  assert(['index.html', 'src/app.js', 'src/build-info.js', 'vendor/ui.js', 'manifest.webmanifest'].every(p => manifest.shell.includes(p)),
    'the atomic shell holds the entry, app modules, vendor and manifest');
  assert(!manifest.shell.some(p => /^data\/[^/]+\.json$/.test(p)) && !manifest.shell.includes('sw.js') && !manifest.shell.includes('sw-manifest.js'),
    'the atomic shell never lists stroke JSON or the worker itself');
  assert(manifest.bestEffort.some(p => /^deck-data\.js\?v=[0-9a-f]{12}$/.test(p)), 'deck is in the best-effort batch with its fingerprint');
  assert(manifest.coreStrokes.length === 600 && new Set(manifest.coreStrokes).size === 600, 'core strokes list has 600 unique characters');
  // 真实清单跑一遍 install：核心壳每一项都被请求。
  const worker = loadWorker({ manifest, network: fresh });
  await worker.lifecycle('install');
  const missing = manifest.shell.filter(p => !worker.stored(`shizi-v14-${manifest.build}`).has(new URL(p, `${ORIGIN}/`).href));
  assert(missing.length === 0, 'installing the real manifest caches every shell entry', missing.slice(0, 5));
});

process.stdout.write(`${JSON.stringify({ status: 'passed', tests: results }, null, 2)}\n`);
