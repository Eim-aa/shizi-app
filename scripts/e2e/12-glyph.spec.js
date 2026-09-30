// M1-2 完成定义（02 §3 M1-2；01 §6.4–6.5、§8.5；10.13）：
// - page.route 让 data/<字>.json 先失败后成功：灰字「暂时没有提示」+ 楷体 DOM 整字 → 联网恢复后正常字形、按钮「提示 · 还有 N 次」；
// - 断网（route abort）不卡死、立刻进 10.13 分支；请求挂起时 3s 超时 + 1 次重试后进 10.13 分支；
// - hanzi-writer：看答案播放、描一遍（轮廓 + 先播一遍可跳过）、减少动态效果直接终态；静态字形与 hanzi-writer 同一变换；
// - 控制台无未捕获错误（pageerror / Uncaught 一律不放行；只放行本 spec 故意制造的笔顺请求失败日志）。
// 挂载点：src/ui/dev/glyph-demo.js（只在 ?test=1 的测试主机注册 'glyph-demo' 路由），由本 spec 动态 import。

const tid = id => `.sz-layer[data-top="true"] [data-testid="${id}"]`;

async function idle(page) {
  await page.waitForFunction(() => {
    const app = document.querySelector('.sz-app');
    return !!app && app.dataset.navAnim === 'idle';
  });
  await page.waitForTimeout(450); // 新页面 / 新状态后 0.4s 按钮不响应（01 §6.6）
}

async function openDemo(page, char) {
  await page.evaluate(async c => {
    await import('/src/ui/dev/glyph-demo.js');
    const { nav } = await import('/src/ui/router.js');
    nav.push('glyph-demo', { char: c });
  }, char);
  await page.waitForSelector(tid('write-glyph-state'));
  await idle(page);
}

async function back(page) {
  await page.evaluate(async () => {
    const { nav } = await import('/src/ui/router.js');
    nav.back();
  });
  await idle(page);
}

function state(page) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    return el ? { ...el.dataset } : null;
  }, tid('write-glyph-state'));
}

async function waitState(page, key, value, timeout = 15000) {
  await page.waitForFunction(({ sel, key, value }) => {
    const el = document.querySelector(sel);
    return !!el && el.dataset[key] === value;
  }, { sel: tid('write-glyph-state'), key, value }, { timeout });
}

function inkPixels(page) {
  return page.evaluate(sel => {
    const c = document.querySelector(sel);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1;
    return n;
  }, tid('write-glyph-canvas'));
}

function text(page, id) {
  return page.locator(tid(id)).innerText();
}

async function click(page, id) {
  await page.locator(tid(id)).click();
  await page.waitForTimeout(450); // 同一按钮两次按下间隔 0.4s 防连点
}

function animInfo(page) {
  return page.evaluate(sel => {
    const host = document.querySelector(sel);
    const svg = host && host.querySelector('svg');
    return { hosts: host ? host.children.length : 0, svg: !!svg, paths: svg ? svg.querySelectorAll('path').length : 0 };
  }, tid('write-glyph-anim'));
}

export default async function glyph(page, ctx) {
  const { assert } = ctx;
  const enc = c => encodeURIComponent(c);
  // 本 spec 故意制造的笔顺请求失败（500 / abort / 超时中断）会被 run.mjs 记成 http / requestfailed / console 行，只放行这些。
  const FAILING = ['永', '国', '森'].map(enc).join('|');
  ctx.allowConsoleError(new RegExp(`^http 500: .*/data/(${FAILING})\\.json$`));
  ctx.allowConsoleError(new RegExp(`^requestfailed: .*/data/(${FAILING})\\.json `));
  ctx.allowConsoleError(/^console\.error: Failed to load resource: (the server responded with a status of 500|net::ERR_FAILED)/);

  // 路由表：字 → 'fail'（500）| 'abort' | 'hang'（4s 后才回，超过 3s 超时）| 'pass'
  const plan = new Map([['永', 'fail'], ['国', 'abort'], ['森', 'hang']]);
  const hits = new Map();
  await page.route('**/data/*.json', async route => {
    const url = new URL(route.request().url());
    const char = decodeURIComponent(url.pathname.split('/').pop().replace(/\.json$/, ''));
    hits.set(char, (hits.get(char) || 0) + 1);
    const how = plan.get(char) || 'pass';
    try {
      if (how === 'fail') await route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
      else if (how === 'abort') await route.abort('failed');
      else if (how === 'hang') {
        await new Promise(r => setTimeout(r, 4000));
        await route.fulfill({ status: 500, body: 'late' });
      } else await route.continue();
    } catch (error) {
      // 页面已经因超时中断了这次请求：route 已失效，忽略
    }
  });

  ctx.step('boot ?test=1 and mount the glyph demo route (test host only)');
  await page.goto(`${ctx.baseURL}/?test=1`);
  await page.waitForSelector('.sz-app');
  await idle(page);

  // ------------------------------------------------------------------ 先失败后成功
  ctx.step('永: data/永.json fails (500) → 10.13 branch: 楷体 DOM glyph + 灰字「暂时没有提示」');
  await openDemo(page, '永');
  await waitState(page, 'state', 'missing');
  assert.equal(hits.get('永'), 2, 'one try + one retry, then gave up (01 §8.5)');
  assert.equal(await text(page, 'write-hint-unavailable'), '暂时没有提示', 'gray label replaces the hint button (R-W05.hintUnavailable)');
  assert.equal(await page.locator(tid('write-hint')).count(), 0, 'no hint button without stroke data');
  assert.equal(await page.locator(tid('write-hint-unavailable')).evaluate(el => el.tagName), 'SPAN', 'gray label is not a button');
  const fb = await page.locator(tid('write-glyph-fallback')).evaluate(el => ({
    text: el.textContent.trim(),
    variant: el.dataset.variant,
    font: getComputedStyle(el).fontFamily,
    canvas: el.querySelector('canvas') !== null,
  }));
  assert.equal(fb.text, '永', 'fallback is the whole character as DOM text');
  assert.equal(fb.canvas, false, 'fallback glyph is not canvas');
  assert.ok(/Kai/i.test(fb.font), `fallback uses the Kai stack (${fb.font})`);
  assert.equal(await text(page, 'write-glyph-note'), '这个字暂时没有提示，可以直接看答案。', 'note under the grid (R-W05.noHintNote)');
  assert.equal(await inkPixels(page), 0, 'no canvas glyph without data');

  ctx.step('永: 描一遍 without data → light whole-character fallback + 「浅色是参考字形。」 (R-W08.traceNote)');
  await click(page, 'write-glyph-mode-trace');
  assert.equal(await page.locator(tid('write-glyph-fallback')).getAttribute('data-variant'), 'trace');
  assert.equal(await text(page, 'write-glyph-note'), '浅色是参考字形。');
  assert.equal((await animInfo(page)).svg, false, 'no hanzi-writer without data');
  await click(page, 'write-glyph-mode-play');
  assert.equal(await text(page, 'write-glyph-note'), '这个字记为看过答案，后面再写只算练习。', 'answer note (R-W08.answerNote)');
  await click(page, 'write-glyph-mode-static');

  ctx.step('永: network comes back → online event → refetch → normal glyph and 「提示 · 还有 2 次」');
  plan.set('永', 'pass');
  await page.context().setOffline(true);
  assert.equal(await page.evaluate(() => navigator.onLine), false, 'offline');
  await page.context().setOffline(false);
  await waitState(page, 'state', 'ready');
  assert.equal(hits.get('永'), 3, 'exactly one more request after coming back online');
  assert.equal(await page.locator(tid('write-glyph-fallback')).count(), 0, 'fallback removed');
  assert.equal(await page.locator(tid('write-hint-unavailable')).count(), 0, 'gray label removed');
  assert.equal(await text(page, 'write-hint'), '提示 · 还有 2 次', 'hint button restored (R-W05.hintRemaining, P17 hintMax=2)');
  assert.ok((await inkPixels(page)) > 2000, 'Path2D reference glyph painted on canvas');
  assert.equal(await page.locator(tid('write-glyph-note')).count(), 0, 'no 10.13 note once data is there');

  ctx.step('static glyph uses the same transform as hanzi-writer');
  const tf = await page.evaluate(async () => {
    const { glyphTransform } = await import('/src/ui/canvas/glyph.js');
    const t = glyphTransform({ size: 345 });
    const hw = window.HanziWriter.getScalingTransform(345, 345, 345 * 0.06);
    return { k: t.k, hwScale: hw.scale, ox: t.ox, hwX: hw.x, oy: t.oy, hwY: 345 - hw.y };
  });
  assert.ok(Math.abs(tf.k - tf.hwScale) < 1e-9, `scale ${tf.k} == hanzi-writer ${tf.hwScale}`);
  assert.ok(Math.abs(tf.ox - tf.hwX) < 1e-9, 'x offset matches');
  assert.ok(Math.abs(tf.oy - tf.hwY) < 1e-9, `y offset ${tf.oy} == ${tf.hwY}`);

  ctx.step('看答案: hanzi-writer plays stroke by stroke, ends with the full glyph');
  await click(page, 'write-glyph-mode-play');
  const running = await state(page);
  assert.equal(running.anim, 'running', 'animation running');
  assert.equal(await page.locator(tid('write-glyph-skip')).isEnabled(), true, 'skip is enabled while playing');
  const info = await animInfo(page);
  assert.equal(info.hosts, 1, 'one animation host in the grid');
  assert.ok(info.svg && info.paths >= 5, `hanzi-writer SVG mounted (${info.paths} paths)`);
  assert.equal(await text(page, 'write-glyph-note'), '这个字记为看过答案，后面再写只算练习。', 'answer note while playing');
  await waitState(page, 'anim', 'completed', 20000);
  assert.equal(await page.locator(tid('write-glyph-skip')).isEnabled(), false, 'skip disabled after completion');

  ctx.step('看答案: replay then skip jumps to the end state');
  await click(page, 'write-glyph-replay');
  assert.equal((await state(page)).anim, 'running', 'replay restarts the animation');
  await click(page, 'write-glyph-skip');
  await waitState(page, 'anim', 'skipped');
  const mainOpacity = await page.evaluate(sel => {
    const gs = [...document.querySelector(sel).querySelectorAll('svg g')];
    return gs.map(g => g.getAttribute('opacity') ?? g.style.opacity);
  }, tid('write-glyph-anim'));
  assert.ok(mainOpacity.some(v => v === '1'), `a stroke group is fully visible after skip (${JSON.stringify(mainOpacity)})`);

  ctx.step('描一遍: outline painted, preview plays once and can be skipped');
  await click(page, 'write-glyph-mode-trace');
  assert.equal((await state(page)).anim, 'running', 'preview playing');
  assert.ok((await inkPixels(page)) > 2000, 'trace outline painted under the preview');
  assert.equal((await animInfo(page)).hosts, 1, 'previous animation was torn down (one host only)');
  assert.equal(await text(page, 'write-glyph-note'), '浅色是参考字形。', 'trace note (R-W08.traceNote)');
  await click(page, 'write-glyph-skip');
  await waitState(page, 'anim', 'skipped');

  ctx.step('减少动态效果: 看答案 / 描一遍 go straight to the end state');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await click(page, 'write-glyph-mode-play');
  assert.equal((await state(page)).anim, 'static', 'play → static, no animation');
  assert.ok((await animInfo(page)).svg, 'full glyph still shown by hanzi-writer');
  await click(page, 'write-glyph-mode-trace');
  assert.equal((await state(page)).anim, 'static', 'preview skipped entirely');
  assert.equal((await animInfo(page)).svg, false, 'no preview layer');
  assert.ok((await inkPixels(page)) > 2000, 'trace outline still there');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  ctx.step('提示 button draws median hint strokes and counts down');
  await click(page, 'write-glyph-mode-static');
  const before = await inkPixels(page);
  await click(page, 'write-hint');
  assert.equal(await text(page, 'write-hint'), '提示 · 还有 1 次', 'first hint used');
  assert.ok((await inkPixels(page)) >= before, 'hint medians drawn over the glyph');
  await click(page, 'write-hint');
  assert.equal(await text(page, 'write-hint'), '提示已用完', 'hints used up (R-W05.hintUsedUp)');
  assert.equal(await page.locator(tid('write-hint')).isDisabled(), true, 'used-up hint button is disabled');

  ctx.step('leaving the page while nothing is pending keeps the router healthy');
  await back(page);

  // ------------------------------------------------------------------ 断网：abort
  ctx.step('国: route abort (offline) → 10.13 branch immediately, page stays responsive');
  const t0 = Date.now();
  await openDemo(page, '国');
  await waitState(page, 'state', 'missing', 8000);
  const abortMs = Date.now() - t0;
  assert.ok(abortMs < 6000, `aborted requests do not wait for the 3s timeout (${abortMs}ms)`);
  assert.equal(hits.get('国'), 2, 'abort is retried once');
  assert.equal(await text(page, 'write-hint-unavailable'), '暂时没有提示', 'gray label after abort');
  await click(page, 'write-glyph-mode-play');
  assert.equal(await page.locator(tid('write-glyph-fallback')).getAttribute('data-variant'), 'answer', '看答案 falls back to the Kai glyph');
  await back(page);

  // ------------------------------------------------------------------ 挂起：超时
  ctx.step('森: request hangs → 3s timeout + 1 retry → 10.13 branch (does not hang the page)');
  const t1 = Date.now();
  await openDemo(page, '森');
  assert.equal((await state(page)).state, 'loading', 'loading while the request hangs');
  assert.equal(await page.locator(tid('write-hint')).isDisabled(), true, 'hint disabled while loading');
  await waitState(page, 'state', 'missing', 12000);
  const hangMs = Date.now() - t1;
  assert.ok(hangMs >= 5500 && hangMs < 12000, `gave up after two 3s timeouts (${hangMs}ms)`);
  assert.equal(hits.get('森'), 2, 'timed-out request retried once');
  assert.equal((await state(page)).reason, 'timeout', 'failure reason is timeout');
  // 让挂起的 route 处理器跑完（4s），避免 context 关闭时仍有未结束的 route
  await page.waitForTimeout(1500);
  await back(page);

  ctx.step('a character whose file loads normally never shows the fallback');
  await openDemo(page, '鹰');
  await waitState(page, 'state', 'ready');
  assert.equal((await state(page)).source, 'network', 'first visit fetched from data/');
  assert.equal(await page.locator(tid('write-glyph-fallback')).count(), 0, 'no fallback when data loads');
  await back(page);
  await openDemo(page, '鹰');
  assert.equal((await state(page)).source, 'cache', 'second visit is served from the LRU');
  await back(page);

  ctx.step('production URL never registers the demo route');
  await page.goto(`${ctx.baseURL}/`);
  await page.waitForSelector('.sz-app');
  const prodRegistered = await page.evaluate(async () => {
    await import('/src/ui/dev/glyph-demo.js');
    const { getScreen } = await import('/src/ui/router.js');
    return getScreen('glyph-demo') !== null;
  });
  assert.equal(prodRegistered, false, 'glyph-demo is registered only on the test host');
}
