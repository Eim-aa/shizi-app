// M5-1 离线场景（02 §7 M5-1 完成定义；01 §8.3 / §8.5）。
//
// 生产地址（不带 test=1，测试宿主默认不注册 worker）：
//   1. 注册 sw.js → 安装激活后接管页面；只有一个缓存 shizi-v14-<BUILD>，里面有入口 index.html、app.js、带指纹的 deck、核心笔顺；
//      <html data-shizi-ready> 与 meta[shizi-asset-build]、src/build-info.js 的 BUILD 一致。
//   2. context.setOffline(true) 后刷新：首页照常打开（导航由本版缓存返回），题库经典脚本全局在。
//   3. 离线点「开始」→ 第一次练习的写字页：首练字笔顺来自内嵌（core-strokes.js 的 SHIZI_STROKE_DATA，P09），没有失败。
//   4. 离线取一个核心字（非首练字）的笔顺：命中 worker 缓存（缓存里有 + 离线 fetch 成功 + strokes 加载器拿到数据）。
//   5. 离线返回首页仍正常；恢复联网。

import { tid, waitNavIdle } from './helpers.mjs';

const CORE_NOT_FIRST = '痿'; // core-strokes.js 第 6 个字：核心 600 字之一、不在首练 5 字里

async function buildInfo(page) {
  return page.evaluate(async () => {
    const { BUILD } = await import('/src/build-info.js');
    return {
      BUILD,
      meta: document.querySelector('meta[name="shizi-asset-build"]')?.content || '',
      ready: document.documentElement.getAttribute('data-shizi-ready') || '',
      controlled: !!navigator.serviceWorker.controller,
      seed: (() => { try { return typeof SEED !== 'undefined' && Array.isArray(SEED) ? SEED.length : -1; } catch (e) { return -1; } })(),
      coreList: Array.isArray(self.SHIZI_CORE_STROKES) ? self.SHIZI_CORE_STROKES.length : -1,
    };
  });
}

export default async function offline(page, ctx) {
  const { assert } = ctx;
  // 断网探针（见下）会产生一条 requestfailed 与一条不带地址的「Failed to load resource」console.error；
  // 只放行这两条，并在结尾核对所有这类 console.error 都出自探针地址。
  const loadFailures = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && /^Failed to load resource/.test(msg.text())) loadFailures.push(msg.location().url || '');
  });
  ctx.allowConsoleError(/^requestfailed: \S+offline-probe=1 /);
  ctx.allowConsoleError(/^console\.error: Failed to load resource: net::ERR_FAILED$/);

  ctx.step('production URL registers the v14 worker, which takes control after installing');
  await page.goto(`${ctx.baseURL}/`);
  await page.waitForSelector(tid('screen-home'));
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-shizi-ready'));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 });
  let info = await buildInfo(page);
  assert.ok(/^\d{8}-[0-9a-f]{12}$/.test(info.BUILD), `BUILD has the <yyyymmdd>-<12 hex> shape (${info.BUILD})`);
  assert.equal(info.meta, info.BUILD, 'index.html meta equals src/build-info.js BUILD');
  assert.equal(info.ready, info.BUILD, 'data-shizi-ready carries the same BUILD');
  const version = `shizi-v14-${info.BUILD}`;
  const cache = await page.evaluate(async ({ version: name, core }) => {
    const names = await caches.keys();
    const c = await caches.open(name);
    const urls = (await c.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search);
    return {
      names,
      index: urls.includes('/index.html'),
      app: urls.includes('/src/app.js'),
      deck: urls.some(u => /^\/deck-data\.js\?v=[0-9a-f]{12}$/.test(u)),
      coreStrokes: urls.some(u => /^\/core-strokes\.js\?v=[0-9a-f]{12}$/.test(u)),
      core: urls.includes(`/data/${encodeURIComponent(core)}.json`),
      strokes: urls.filter(u => /^\/data\/[^/]+\.json$/.test(u) && u !== '/data/etymology.json').length,
    };
  }, { version, core: CORE_NOT_FIRST });
  assert.deepEqual(cache.names, [version], 'exactly one cache: the current v14 version');
  assert.ok(cache.index && cache.app && cache.deck && cache.coreStrokes, 'entry, app module, fingerprinted deck and core-strokes are precached');
  assert.ok(cache.core && cache.strokes >= 600, `core stroke JSON precached (${cache.strokes})`);

  ctx.step('offline reload: home opens from the version cache');
  await page.context().setOffline(true);
  await page.reload();
  await page.waitForSelector(tid('screen-home'));
  await waitNavIdle(page);
  info = await buildInfo(page);
  // navigator.onLine 在 SW 接管的页面里不可靠；用一个不在缓存里的同源地址证明网络真的断了。
  const probe = await page.evaluate(async () => {
    try {
      const res = await fetch('scripts/shell-manifest.txt?offline-probe=1');
      return { reached: true, status: res.status };
    } catch (error) {
      return { reached: false };
    }
  });
  assert.deepEqual(probe, { reached: false }, 'an uncached same-origin request fails: the context really is offline');
  assert.ok(info.controlled, 'the offline page is controlled by the worker');
  assert.equal(info.ready, info.BUILD, 'offline page is the same build (ready marker)');
  assert.equal(info.meta, info.BUILD, 'offline HTML and modules agree on BUILD');
  assert.ok(info.seed > 7000, `deck classic global SEED loaded offline (${info.seed})`);
  assert.equal(info.coreList, 600, 'core-strokes.js classic global loaded offline');

  ctx.step('offline: 开始 opens the first-practice write page with embedded stroke data');
  await page.click(tid('home-start'));
  await page.waitForFunction(() => document.querySelector('.sz-app')?.dataset.topScreen === 'write', null, { timeout: 15000 });
  await waitNavIdle(page);
  const strokes = await page.evaluate(async () => {
    const m = await import('/src/data/strokes.js');
    const first = await m.loadStrokesDetailed('尴');
    return { stats: m.getStrokesLoader().stats(), first: { source: first.source, ok: !!first.data } };
  });
  // P1-E2：题面词语里的其他字（尴尬的「尬」）也是轮廓，不在内嵌表里、也没进过缓存时离线取不到——这一个字回退 ShiziKai（10.13 语义），
  // 请求失败的日志是预期的；要写的字本身仍来自内嵌表，不走网络。
  ctx.allowConsoleError(/%E5%B0%AC\.json/);
  assert.ok(strokes.stats.embedded > 0, `write page read first-practice strokes from the embedded table (${JSON.stringify(strokes.stats)})`);
  const partner = await page.evaluate(() => [...document.querySelectorAll('.sz-layer[data-top="true"] [data-testid="write-prompt-cell"] .sz-pg')].map(g => [g.textContent, g.dataset.glyphSrc]));
  assert.ok(partner.length > 0 && partner.every(([, src]) => src === 'fallback' || src === 'outline'), `word partner chars settle as outline or ShiziKai fallback offline (${JSON.stringify(partner)})`);
  assert.deepEqual(strokes.first, { source: 'embedded', ok: true }, '尴 comes from SHIZI_STROKE_DATA');

  ctx.step('offline: a core character that is not embedded is a worker cache hit');
  const hit = await page.evaluate(async ch => {
    const m = await import('/src/data/strokes.js');
    const detail = await m.loadStrokesDetailed(ch);
    const res = await fetch(`data/${encodeURIComponent(ch)}.json`);
    return { source: detail.source, ok: !!detail.data, reason: detail.reason, fetchOk: res.ok };
  }, CORE_NOT_FIRST);
  assert.deepEqual(hit, { source: 'network', ok: true, reason: null, fetchOk: true },
    `${CORE_NOT_FIRST} loads offline through the worker cache`);

  ctx.step('offline: back to home still works; then reconnect');
  await page.click(`.sz-layer[data-top="true"] ${tid('page-back')}`);
  await page.waitForFunction(() => document.querySelector('.sz-app')?.dataset.topScreen === 'home', null, { timeout: 15000 });
  await waitNavIdle(page);
  assert.ok(await page.locator(tid('screen-home')).count() > 0, 'home visible after leaving the write page offline');
  await page.context().setOffline(false);
  // P1-E2：除了离线探针，只有题面词语里那个没内嵌也没缓存的「尬」（取一次 + 重试一次，随后回退 ShiziKai）
  const unexpected = loadFailures.filter(url => !url.includes('offline-probe=1') && !url.includes('%E5%B0%AC.json'));
  assert.ok(unexpected.length === 0 && loadFailures.filter(url => url.includes('offline-probe=1')).length === 1,
    `the only failed resource loads are the offline probe and the uncached word partner (${JSON.stringify(loadFailures)})`);
}
