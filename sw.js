/* 拾字 service worker —— 让它能像 app 一样离线打开、秒开。
   策略：
   - 页面/HTML：网络优先，断网回落缓存（这样我每次更新都能落到你手机，不会卡旧版）
   - 同源静态资源（库、图标、data/*.json 笔画数据）：缓存优先（不可变，秒开 + 离线可用）
   - 跨源（CDN 兜底字）：不拦截，照常走网络
*/
const VERSION = 'shizi-v5';
const SHELL = ['./', 'index.html', 'deck-data.js', 'hanzi-writer.min.js', 'manifest.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
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
      fetch(req).then(res => {
        // clone 必须在 body 被页面消费前同步调用；错误响应不能写进缓存，否则污染离线兜底
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
    );
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
