/* 拾字 service worker —— 让它能像 app 一样离线打开、秒开。
   策略：
   - 页面/HTML：网络优先，断网或服务端 5xx 回落缓存（这样我每次更新都能落到你手机，不会卡旧版）
   - 关键资源（题库/核心笔顺/语境覆盖）：带内容指纹，网络优先，任何非 ok 都回落同版本缓存
   - 笔顺数据：缓存优先并后台刷新，核心 600 字固定保留，运行时缓存最多 800 项
   - 其余同源静态资源：缓存优先；安装时一次性原子写入 shell
   - 跨源（CDN 兜底字）：不拦截，照常走网络
*/
importScripts('./core-strokes.js?v=13f7db4fa836');

const BUILD = '8105-3ac0637e30ec';
const VERSION = `shizi-v13-${BUILD}`;
const SHELL = ['./', 'index.html', 'deck-data.js?v=3ac0637e30ec', 'hanzi-writer.min.js', 'fsrs6.min.js', 'manifest.webmanifest',
  'core-strokes.js?v=13f7db4fa836', 'data/etymology.json', 'data/context-overrides.js?v=11516601699b', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const CORE_STROKE_PATHS = (self.SHIZI_CORE_STROKES || []).map(ch => `./data/${encodeURIComponent(ch)}.json`);
const CORE_STROKE_URLS = new Set(CORE_STROKE_PATHS.map(path => new URL(path, self.location.href).href));
const INSTALL_BATCH_SIZE = 40;
const STROKE_CACHE_LIMIT = 800;

function isStrokeRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && /\/data\/[^/]+\.json$/.test(url.pathname)
    && !url.pathname.endsWith('/data/etymology.json');
}

// 笔顺按需缓存，不设上限就会跟用户自己的练习数据抢配额。核心 600 字永远不淘汰。
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

// 写缓存失败（配额满、隐私模式）不该打断一个本来成功的响应，也不该先把已有的离线副本删掉。
async function cacheResponseBestEffort(request, response) {
  try {
    await putCachedResponse(await caches.open(VERSION), request, response);
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

// 只认当前这一代的缓存：失败安装留下的空缓存、或还没清掉的旧版本，都不该被当成兜底内容
async function cachedFromVersion(request) {
  const cache = await caches.open(VERSION);
  return (await cache.match(request)) || null;
}

function cacheIfOk(req, res) {
  // clone 必须在 body 被页面消费前同步调用；错误响应不能写进缓存，否则污染离线兜底
  if (res && res.ok) cacheResponseBestEffort(req, res.clone());
  return res;
}

async function networkThenCache(req, fallback) {
  let res = null;
  try { res = await fetch(new Request(req, { cache: 'reload' })); } catch (err) { res = null; }
  if (res && res.ok) return cacheIfOk(req, res);
  // fetch() 只在网络层面失败时 reject。服务器返回 503 时它照样 resolve，
  // 把这个响应交给页面就等于让浏览器把一段错误正文当脚本执行（SEED is not defined）。
  // 所以非 ok 一律按“这次没取到”处理，先回落缓存。
  const cached = await fallback(req, res);
  return cached || res || Response.error();
}

async function cacheCoreStrokes(cache) {
  for (let start = 0; start < CORE_STROKE_PATHS.length; start += INSTALL_BATCH_SIZE) {
    const batch = CORE_STROKE_PATHS.slice(start, start + INSTALL_BATCH_SIZE);
    await Promise.allSettled(batch.map(async path => {
      const request = new Request(new URL(path, self.location.href), { cache: 'reload' });
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response);
    }));
  }
  await trimStrokeCache(cache).catch(() => 0);
}

async function cacheFreshShell(cache) {
  const requests = SHELL.map(path => new Request(new URL(path, self.location.href), { cache: 'reload' }));
  // Cache.addAll commits the batch atomically. A failed response therefore
  // cannot expose a partly populated new-version cache to an older worker.
  await cache.addAll(requests);
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cacheFreshShell(cache);
    await cacheCoreStrokes(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const obsolete = keys.filter(key => key !== VERSION && key.startsWith('shizi-'));
    await Promise.all(obsolete.map(key => caches.delete(key)));
    await self.clients.claim();
    if (obsolete.length) {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Waiting for navigate here deadlocks activation: navigation itself waits for
      // this worker to become active. Start it, then let the activate event finish.
      windows.forEach(client => { client.navigate(client.url).catch(() => null); });
    }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨源（jsdelivr 兜底）不拦

  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // 网络优先：更新随时能落地；断网或服务端抽风才用缓存。
    // 4xx 是“这个地址真的没有”，不拿缓存冒充；5xx / 408 / 429 跟断网同一类。
    e.respondWith(networkThenCache(req, async (request, res) => {
      if (res && res.status < 500 && res.status !== 408 && res.status !== 429) return null;
      return (await cachedFromVersion(request)) || (await cachedFromVersion('index.html'));
    }));
    return;
  }

  const critical = ['/deck-data.js', '/core-strokes.js', '/data/context-overrides.js'];
  if (critical.some(path => url.pathname.endsWith(path))) {
    // 关键资源都带内容指纹：同一个 URL 的缓存副本就是它应有的内容，
    // 任何非 ok（503、以及指纹文件被清掉后的 404）都优先用缓存，取不到才把错误响应交回去。
    e.respondWith(networkThenCache(req, request => cachedFromVersion(request)));
    return;
  }

  if (isStrokeRequest(req)) {
    // 笔顺要立等可取，所以缓存优先；同时后台刷一次，让上游修过的字形能自己更新。
    const refresh = fetch(req);
    e.waitUntil(updateCacheFromNetwork(req, refresh));
    e.respondWith(cachedFromVersion(req).then(cached => cached || refresh));
    return;
  }

  // 其余静态资源：缓存优先，缺了再取并存
  e.respondWith(cachedFromVersion(req).then(cached => cached || fetch(req).then(res => cacheIfOk(req, res))));
});
