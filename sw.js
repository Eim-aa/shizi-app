/* 拾字 service worker —— 让它能像 app 一样离线打开、秒开。
   策略：
   - 页面/HTML：网络优先，断网回落缓存（这样我每次更新都能落到你手机，不会卡旧版）
   - 同源静态资源：缓存优先；安装时预缓存首日校准 + 高频核心 600 字，其余笔顺按需缓存
   - 跨源（CDN 兜底字）：不拦截，照常走网络
*/
importScripts('./core-strokes.js?v=13f7db4fa836');

const BUILD = '8105-3ac0637e30ec';
const VERSION = `shizi-v13-${BUILD}`;
const SHELL = ['./', 'index.html', 'deck-data.js?v=3ac0637e30ec', 'hanzi-writer.min.js', 'fsrs6.min.js', 'manifest.webmanifest',
  'core-strokes.js?v=13f7db4fa836', 'data/etymology.json', 'data/context-overrides.js?v=11516601699b', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const CORE_STROKE_PATHS = (self.SHIZI_CORE_STROKES || []).map(ch => `./data/${encodeURIComponent(ch)}.json`);
const INSTALL_BATCH_SIZE = 40;

async function cacheCoreStrokes(cache) {
  for (let start = 0; start < CORE_STROKE_PATHS.length; start += INSTALL_BATCH_SIZE) {
    const batch = CORE_STROKE_PATHS.slice(start, start + INSTALL_BATCH_SIZE);
    await Promise.allSettled(batch.map(async path => {
      const request = new Request(new URL(path, self.location.href), { cache: 'reload' });
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response);
    }));
  }
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
    // 网络优先：更新随时能落地；断网才用缓存
    e.respondWith(
      fetch(new Request(req, { cache: 'reload' })).then(res => {
        // clone 必须在 body 被页面消费前同步调用；错误响应不能写进缓存，否则污染离线兜底
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
    );
    return;
  }

  const critical = ['/deck-data.js', '/core-strokes.js', '/data/context-overrides.js'];
  if (critical.some(path => url.pathname.endsWith(path))) {
    e.respondWith(fetch(new Request(req, { cache: 'reload' })).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req)));
    return;
  }

  // 静态资源：缓存优先，缺了再取并存
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(err => {
      if (cached) return cached;
      throw err;
    }))
  );
});
