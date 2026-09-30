#!/usr/bin/env node
// sw.js 最小单测（M0-2）：在 node:vm 里求值真实 sw.js，注入假 caches/fetch，按 fetch 事件驱动。
// 移植自旧 scripts/legacy/verify_8105_app.js verifyServiceWorkerCacheFailureIsolation，并补三条：
//   1. 配额隔离：cache.put 抛 QuotaExceededError 时，HTML/关键资源/笔顺仍返回新鲜响应，已有核心字离线副本不被删。
//   2. 关键资源（带指纹的 deck）服务端 503 → 回落同版本缓存；缓存里没有时把 503 交回而不是伪造成功。
//   3. HTML 4xx 不拿缓存冒充（只有 5xx/408/429/断网才回落）。
//   4. 笔顺缓存超过上限时只淘汰运行时条目，核心 600 字（此处为「水」）永不淘汰。
// sw.js 归 M5-1（v14 重写）；本测试只依赖 fetch 事件行为契约（01-架构设计 §8.3 沿用的策略），
// 若 M5-1 改动了这些契约，应同步更新本文件。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swSource = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const ORIGIN = 'http://127.0.0.1:8000';
const results = [];

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ''}`);
}

const requestURL = request => (request && request.url ? request.url : new URL(String(request), `${ORIGIN}/`).href);

// 可配置的假环境：stored = 当前版本缓存内容（url → body）；putError = put 时抛出的异常；network(url) → Response。
function loadWorker({ stored = new Map(), putError = null, network, core = ['水'] } = {}) {
  const listeners = {};
  let deleteCalls = 0;
  const cache = {
    addAll: async () => {},
    keys: async () => Array.from(stored.keys(), url => new Request(url)),
    delete: async request => { deleteCalls += 1; return stored.delete(requestURL(request)); },
    match: async request => (stored.has(requestURL(request)) ? new Response(stored.get(requestURL(request))) : undefined),
    put: async (request, response) => {
      if (putError) throw putError;
      stored.set(requestURL(request), await response.text());
    },
  };
  const context = {
    self: {
      SHIZI_CORE_STROKES: core,
      location: { href: `${ORIGIN}/sw.js`, origin: ORIGIN },
      addEventListener: (name, handler) => { listeners[name] = handler; },
      skipWaiting: async () => {},
      clients: { claim: async () => {}, matchAll: async () => [] },
    },
    caches: { open: async () => cache, match: request => cache.match(request), keys: async () => [], delete: async () => true },
    fetch: async request => network(new URL(requestURL(request)).pathname),
    importScripts: () => {},
    Request, Response, URL, DOMException, Promise, Set, Map, console,
  };
  vm.runInNewContext(swSource, context, { filename: 'sw.js' });
  assert(typeof listeners.fetch === 'function', 'sw.js must register a fetch listener');
  async function dispatch(pathname, accept = 'application/javascript') {
    let responsePromise;
    const waits = [];
    listeners.fetch({
      request: new Request(`${ORIGIN}${pathname}`, { headers: { accept } }),
      respondWith: promise => { responsePromise = Promise.resolve(promise); },
      waitUntil: promise => waits.push(Promise.resolve(promise)),
    });
    const response = await responsePromise;
    await Promise.all(waits);
    return response ? { status: response.status, type: response.type, body: response.type === 'error' ? null : await response.text() } : null;
  }
  return { dispatch, stored, deleteCalls: () => deleteCalls };
}

async function run(name, fn) {
  await fn();
  results.push(name);
}

const fresh = pathname => new Response(`fresh:${pathname}`, { status: 200 });
const coreURL = `${ORIGIN}/data/%E6%B0%B4.json`;

await run('quota failures keep fresh responses and the existing offline core copy', async () => {
  const worker = loadWorker({
    stored: new Map([[coreURL, 'cached-core']]),
    putError: new DOMException('quota', 'QuotaExceededError'),
    network: fresh,
  });
  const got = {
    html: (await worker.dispatch('/', 'text/html')).body,
    critical: (await worker.dispatch('/deck-data.js')).body,
    stroke: (await worker.dispatch('/data/%E7%81%AB.json', 'application/json')).body,
    core: (await worker.dispatch('/data/%E6%B0%B4.json', 'application/json')).body,
  };
  assert(got.html === 'fresh:/' && got.critical === 'fresh:/deck-data.js' && got.stroke === 'fresh:/data/%E7%81%AB.json'
    && got.core === 'cached-core' && worker.stored.get(coreURL) === 'cached-core' && worker.deleteCalls() === 0,
  'cache quota failures must preserve successful responses and existing offline core copies', { got, deleteCalls: worker.deleteCalls() });
});

await run('critical fingerprinted resource 503 falls back to the same-version cache only', async () => {
  const deck = `${ORIGIN}/deck-data.js?v=abc`;
  const unavailable = () => new Response('Service Unavailable', { status: 503 });
  const withCache = loadWorker({ stored: new Map([[deck, 'cached-deck']]), network: unavailable });
  const hit = await withCache.dispatch('/deck-data.js?v=abc');
  assert(hit.status === 200 && hit.body === 'cached-deck', 'a 503 for a cached critical resource must serve the cached copy', hit);
  const withoutCache = loadWorker({ network: unavailable });
  const miss = await withoutCache.dispatch('/deck-data.js?v=abc');
  assert(miss.status === 503, 'without a cached copy the 503 must reach the page instead of a fabricated success', miss);
  assert(!withoutCache.stored.has(deck), 'error responses must never be cached');
});

await run('HTML 4xx is not masked by the cache; 5xx falls back to cached index.html', async () => {
  const index = `${ORIGIN}/index.html`;
  const notFound = loadWorker({ stored: new Map([[index, 'cached-index']]), network: () => new Response('nope', { status: 404 }) });
  const four = await notFound.dispatch('/missing.html', 'text/html');
  assert(four.status === 404, 'a 404 page must not be replaced by cached HTML', four);
  const serverError = loadWorker({ stored: new Map([[index, 'cached-index']]), network: () => new Response('down', { status: 502 }) });
  const five = await serverError.dispatch('/', 'text/html');
  assert(five.status === 200 && five.body === 'cached-index', 'a 5xx navigation must fall back to the cached shell', five);
});

await run('stroke cache trimming never evicts core characters', async () => {
  const stored = new Map([[coreURL, 'cached-core']]);
  for (let i = 0; i < 805; i += 1) stored.set(`${ORIGIN}/data/r${i}.json`, `runtime-${i}`);
  const worker = loadWorker({ stored, network: fresh });
  await worker.dispatch('/data/new.json', 'application/json');
  const strokes = [...worker.stored.keys()].filter(url => /\/data\/[^/]+\.json$/.test(url));
  assert(worker.stored.get(coreURL) === 'cached-core', 'the core character copy must survive trimming');
  assert(strokes.length <= 800, 'runtime stroke cache must be bounded', { count: strokes.length });
  assert(worker.deleteCalls() > 0, 'trimming must have evicted runtime entries');
});

process.stdout.write(`${JSON.stringify({ status: 'passed', tests: results }, null, 2)}\n`);
