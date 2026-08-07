/* 拾字 service worker
   - 页面与壳资源网络优先，断网回落缓存，不依赖人工发布版本号
   - 笔顺数据缓存优先并后台刷新，核心 600 字固定保留
   - 笔顺缓存最多 800 项，避免与用户练习数据无限争抢配额
*/
importScripts('./deck-data.js', './core-strokes.js');

// 这里只表示缓存结构版本。普通内容更新由网络优先/后台刷新策略自动落地。
const CACHE_NAME = 'shizi-cache-v2';
const CACHE_PREFIX = 'shizi-';
const SHELL = ['./', 'index.html', 'deck-data.js', 'hanzi-writer.min.js', 'fsrs6.min.js', 'manifest.webmanifest',
  'core-strokes.js', 'data/etymology.json', 'data/context-overrides.js', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const CORE_STROKE_PATHS = (self.SHIZI_CORE_STROKES || []).map(ch => `./data/${encodeURIComponent(ch)}.json`);
const CORE_STROKE_URLS = new Set(CORE_STROKE_PATHS.map(path => new URL(path, self.location.href).href));
const INSTALL_BATCH_SIZE = 40;
const STROKE_CACHE_LIMIT = 800;

function isStrokeRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && /\/data\/[^/]+\.json$/.test(url.pathname)
    && !url.pathname.endsWith('/data/etymology.json');
}

async function trimStrokeCache(cache) {
  const strokes = (await cache.keys()).filter(isStrokeRequest);
  const excess = strokes.length - STROKE_CACHE_LIMIT;
  if (excess <= 0) return 0;
  const runtime = strokes.filter(request => !CORE_STROKE_URLS.has(new URL(request.url).origin + new URL(request.url).pathname));
  const victims = runtime.slice(0, excess);
  await Promise.all(victims.map(request => cache.delete(request)));
  return victims.length;
}

async function putCachedResponse(cache, request, response) {
  await cache.put(request, response);
  if (isStrokeRequest(request)) await trimStrokeCache(cache);
}

async function cacheResponseBestEffort(request, response) {
  try {
    await putCachedResponse(await caches.open(CACHE_NAME), request, response);
    return true;
  } catch (_) {
    return false;
  }
}

function updateCacheFromNetwork(request, network) {
  return network.then(response => response && response.ok
    ? cacheResponseBestEffort(request, response.clone())
    : false).catch(() => false);
}

async function cacheCoreStrokes(cache) {
  for (let start = 0; start < CORE_STROKE_PATHS.length; start += INSTALL_BATCH_SIZE) {
    const batch = CORE_STROKE_PATHS.slice(start, start + INSTALL_BATCH_SIZE);
    await Promise.allSettled(batch.map(async path => {
      const request = new Request(path, { cache: 'reload' });
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response);
    }));
  }
  await trimStrokeCache(cache).catch(() => 0);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL);
    await cacheCoreStrokes(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isHTML = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    const network = fetch(request);
    event.waitUntil(updateCacheFromNetwork(request, network));
    event.respondWith(network.catch(() => caches.match(request).then(response => response || caches.match('index.html'))));
    return;
  }

  if (isStrokeRequest(request)) {
    const refresh = fetch(request);
    event.waitUntil(updateCacheFromNetwork(request, refresh));
    event.respondWith(caches.match(request).then(cached => cached || refresh));
    return;
  }

  const network = fetch(request);
  event.waitUntil(updateCacheFromNetwork(request, network));
  event.respondWith(network.catch(() => caches.match(request)));
});
