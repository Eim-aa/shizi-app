/* 拾字 service worker v14 —— 离线打开、秒开，并且 HTML 与壳资源永远是同一版（01-架构设计 §8.3）。
   版本：sw-manifest.js（scripts/build_shell_manifest.mjs 生成）给出 BUILD、核心壳 SHELL、尽力批次与核心 600 字。
   升级唯一入口是 sw.js / sw-manifest.js 的字节变化：新 worker 原子预缓存核心壳（失败 = 安装失败，旧 worker 继续）→
   尽力缓存 deck / 字源 / 字体 / 核心笔顺 → skipWaiting → 激活后 clients.claim 并 postMessage「有新版本」；
   页面（src/platform/sw.js）按规则 reload：非写字页立即，写字页等离开后。
   策略：
   - 应用入口导航（scope 根 / index.html）：从当前版本缓存返回 index.html，后台 registration.update()（stale-while-revalidate：
     「revalidate」的是 worker 本身，不把网络上新版 HTML 塞进旧版缓存，否则 HTML 与模块会跨版本混搭）。
     缓存里没有（安装尚未完成）才走网络。其它导航：网络优先，4xx 照交，5xx / 408 / 429 / 断网回落缓存的 index.html。
   - 带指纹的关键资源（deck-data.js / core-strokes.js / data/context-overrides.js 的 ?v=）：网络优先，
     任何非 ok 或内容与 ?v= 指纹不符都按「这次没取到」回落本版缓存（503 正文绝不交给页面当脚本执行）。
   - 笔顺 data/<字>.json：缓存优先 + 后台刷新，上限 800，核心 600 字永不淘汰；升级时把旧版缓存里的笔顺搬进新版。
   - 其余同源静态资源：先查发起页面那一版的缓存（页面还没刷新时不混进新版模块），再查本版缓存，缺了才走网络。
   - 旧缓存的删除推迟到所有窗口都已是本版（页面 hello 报上 BUILD）或已没有窗口。
   - 跨源：不拦截。
*/
importScripts('./sw-manifest.js');

const MANIFEST = self.SHIZI_SW_MANIFEST || {};
const BUILD = String(MANIFEST.build || '');
const VERSION = `shizi-v14-${BUILD}`;
const CACHE_PREFIX = 'shizi-';
const SHELL = Array.isArray(MANIFEST.shell) ? MANIFEST.shell : [];
const BEST_EFFORT = Array.isArray(MANIFEST.bestEffort) ? MANIFEST.bestEffort : [];
const CORE_STROKE_PATHS = (Array.isArray(MANIFEST.coreStrokes) ? MANIFEST.coreStrokes : []).map(ch => `data/${encodeURIComponent(ch)}.json`);
const CORE_STROKE_URLS = new Set(CORE_STROKE_PATHS.map(path => new URL(path, self.location.href).href));
const INSTALL_BATCH_SIZE = 40;
const STROKE_CACHE_LIMIT = 800;
const CRITICAL_PATHS = ['/deck-data.js', '/core-strokes.js', '/data/context-overrides.js'];
const MSG_ACTIVATED = 'shizi-sw-activated';
const MSG_VERSION = 'shizi-sw-version';
const MSG_HELLO = 'shizi-hello';

const SCOPE_URL = new URL('./', self.location.href);
const INDEX_URL = new URL('index.html', SCOPE_URL).href;
// 本版预缓存里的地址（含 ?v=）：只有这些才会在「缓存缺失 → 网络取回」时写进本版缓存，免得把别的版本内容写进来。
const OWN_URLS = new Set([...SHELL, ...BEST_EFFORT].map(path => new URL(path, SCOPE_URL).href));

// 页面 clientId → 该页面的 BUILD（页面 hello 时登记）。worker 被回收后会丢，页面在回到前台时会再报一次。
const clientBuilds = new Map();

function isStrokeRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && /\/data\/[^/]+\.json$/.test(url.pathname)
    && !url.pathname.endsWith('/data/etymology.json');
}

function isAppEntry(url) {
  return url.origin === SCOPE_URL.origin && (url.pathname === SCOPE_URL.pathname || url.pathname === `${SCOPE_URL.pathname}index.html`);
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
async function cachedFromVersion(request, cacheName = VERSION) {
  const cache = await caches.open(cacheName);
  return (await cache.match(request)) || null;
}

// 发起请求的页面若还是旧版（还没刷新），先从它那一版的缓存取，保证同一页面的模块同版。
async function cachedForClient(request, clientId) {
  const build = clientId ? clientBuilds.get(clientId) : null;
  if (build && build !== BUILD) {
    const name = `shizi-v14-${build}`;
    if (await caches.has(name)) {
      const hit = await cachedFromVersion(request, name);
      if (hit) return hit;
    }
  }
  return cachedFromVersion(request);
}

function cacheIfOk(req, res) {
  // clone 必须在 body 被页面消费前同步调用；错误响应不能写进缓存，否则污染离线兜底
  if (res && res.ok) cacheResponseBestEffort(req, res.clone());
  return res;
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}

// ?v= 是文件内容 SHA-256 前 12 位。静态服务器不认查询串，服务端已换了下一版时同一个 URL 会拿到别版内容——
// 那不是这一版该有的字节，按「这次没取到」处理。没有 crypto.subtle 时不校验。
async function matchesFingerprint(req, res) {
  const expected = new URL(req.url).searchParams.get('v');
  if (!expected || !/^[0-9a-f]{12}$/.test(expected)) return true;
  if (!self.crypto || !self.crypto.subtle) return true;
  try {
    const digest = await self.crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer());
    return hex(digest).startsWith(expected);
  } catch (_) {
    return true;
  }
}

async function networkThenCache(req, fallback, { verify = false } = {}) {
  let res = null;
  try { res = await fetch(new Request(req, { cache: 'reload' })); } catch (err) { res = null; }
  const good = res && res.ok && (!verify || await matchesFingerprint(req, res));
  if (good) return cacheIfOk(req, res);
  // fetch() 只在网络层面失败时 reject。服务器返回 503 时它照样 resolve，
  // 把这个响应交给页面就等于让浏览器把一段错误正文当脚本执行（SEED is not defined）。
  // 所以非 ok 一律按“这次没取到”处理，先回落缓存。
  const cached = await fallback(req, res);
  return cached || res || Response.error();
}

async function cacheBestEffortList(cache, paths) {
  for (let start = 0; start < paths.length; start += INSTALL_BATCH_SIZE) {
    const batch = paths.slice(start, start + INSTALL_BATCH_SIZE);
    await Promise.allSettled(batch.map(async path => {
      const request = new Request(new URL(path, SCOPE_URL), { cache: 'reload' });
      const response = await fetch(request);
      if (response && response.ok && await matchesFingerprint(request, response)) await cache.put(request, response);
    }));
  }
}

async function cacheCoreStrokes(cache) {
  await cacheBestEffortList(cache, CORE_STROKE_PATHS);
  await trimStrokeCache(cache).catch(() => 0);
}

async function cacheFreshShell(cache) {
  const requests = SHELL.map(path => new Request(new URL(path, SCOPE_URL), { cache: 'reload' }));
  // Cache.addAll commits the batch atomically. A failed response therefore
  // cannot expose a partly populated new-version cache to an older worker.
  await cache.addAll(requests);
}

// 旧版缓存里用户练过的字的笔顺搬进新版（上限照旧），升级后这些字离线仍可写。
async function carryStrokesForward(cache) {
  const have = new Set((await cache.keys()).map(request => request.url));
  for (const name of await caches.keys()) {
    if (name === VERSION || !name.startsWith(CACHE_PREFIX)) continue;
    const old = await caches.open(name);
    for (const request of (await old.keys()).filter(isStrokeRequest)) {
      if (have.has(request.url)) continue;
      const response = await old.match(request);
      if (response) {
        await cache.put(request, response);
        have.add(request.url);
      }
    }
  }
  await trimStrokeCache(cache);
}

async function windowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

// 所有窗口都已报上本版 BUILD（或已没有窗口）才删旧缓存：没刷新的旧页面可能还要从它那一版取模块。
async function cleanupIfAllCurrent() {
  const windows = await windowClients();
  if (!windows.every(client => clientBuilds.get(client.id) === BUILD)) return false;
  const live = new Set(windows.map(client => client.id));
  for (const id of [...clientBuilds.keys()]) if (!live.has(id)) clientBuilds.delete(id);
  const obsolete = (await caches.keys()).filter(key => key !== VERSION && key.startsWith(CACHE_PREFIX));
  await Promise.all(obsolete.map(key => caches.delete(key)));
  return true;
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cacheFreshShell(cache);
    await cacheBestEffortList(cache, BEST_EFFORT);
    await cacheCoreStrokes(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await carryStrokesForward(await caches.open(VERSION)).catch(() => null);
    await self.clients.claim();
    // 不在这里强刷任何页面（v13 的 client.navigate 会打断正在写的字）：告诉页面有新版本，由页面按规则 reload。
    // 旧代（v10 / v13）页面不认这条消息，会在用户下次打开时从本版缓存拿到新 HTML。
    for (const client of await windowClients()) {
      try { client.postMessage({ type: MSG_ACTIVATED, build: BUILD }); } catch (_) { /* 窗口已关 */ }
    }
    await cleanupIfAllCurrent().catch(() => false);
  })());
});

self.addEventListener('message', e => {
  const data = e.data || {};
  if (data.type !== MSG_HELLO) return;
  const source = e.source;
  if (source && source.id && typeof data.build === 'string') clientBuilds.set(source.id, data.build);
  try { if (source) source.postMessage({ type: MSG_VERSION, build: BUILD }); } catch (_) { /* 窗口已关 */ }
  e.waitUntil(cleanupIfAllCurrent().catch(() => false));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨源不拦

  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML && isAppEntry(url)) {
    // 同版本：导航只从本版缓存返回 index.html；后台检查 worker 有没有新版（stale-while-revalidate）。
    e.waitUntil(Promise.resolve().then(() => self.registration && self.registration.update()).catch(() => null));
    e.respondWith(cachedFromVersion(INDEX_URL).then(cached => cached || networkThenCache(req, async (request, res) => {
      if (res && res.status < 500 && res.status !== 408 && res.status !== 429) return null;
      return cachedFromVersion(INDEX_URL);
    })));
    return;
  }

  if (isHTML) {
    // 应用入口以外的页面：网络优先。4xx 是“这个地址真的没有”，不拿缓存冒充；5xx / 408 / 429 跟断网同一类。
    e.respondWith(networkThenCache(req, async (request, res) => {
      if (res && res.status < 500 && res.status !== 408 && res.status !== 429) return null;
      return (await cachedFromVersion(request)) || (await cachedFromVersion(INDEX_URL));
    }));
    return;
  }

  if (CRITICAL_PATHS.some(path => url.pathname.endsWith(path))) {
    // 关键资源都带内容指纹：同一个 URL 的缓存副本就是它应有的内容，
    // 任何非 ok（503、以及指纹文件被清掉后的 404）或内容与指纹不符都优先用缓存，取不到才把错误响应交回去。
    e.respondWith(networkThenCache(req, request => cachedForClient(request, e.clientId), { verify: true }));
    return;
  }

  if (isStrokeRequest(req)) {
    // 笔顺要立等可取，所以缓存优先；同时后台刷一次，让上游修过的字形能自己更新。
    const refresh = fetch(req);
    e.waitUntil(updateCacheFromNetwork(req, refresh));
    e.respondWith(cachedFromVersion(req).then(cached => cached || refresh));
    return;
  }

  // 其余静态资源：先查页面那一版、再查本版缓存；缺了再取，只有本版清单里的地址才写回缓存。
  e.respondWith(cachedForClient(req, e.clientId).then(cached => cached || fetch(req).then(res => (OWN_URLS.has(url.href) ? cacheIfOk(req, res) : res))));
});
