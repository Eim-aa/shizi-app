// 阶段 1 P1-E6b（D29 / P130）：系统字号在页面开始加载前注入，冷启动首帧没有字号跳动。
//
// 原生（WebViewController.swift）在 WKUserScript(.atDocumentStart) 里写 window.__shiziInitialContentSize = {category, scale}，
// pageReady 时再调 window.shiziContentSize({category, scale})。这里用 page.addInitScript 模拟这两步（假原生通道，与 54-native-bridge 同法）：
//   ?e2eInject=<档位>:<scale>   文档开始时注入（可缺省 = 没有注入脚本，即网页 / 旧行为）；
//   ?e2eNative=<档位>:<scale>   假原生在收到 pageReady 后调用 shiziContentSize 的载荷（可缺省 = 没有原生调用）。
// 场景：
//   1. XXXL / AX3 注入 + pageReady 后原生发同一档位：
//      a. DOMContentLoaded 时 <html> 的 --k、data-ax、data-text-large、data-text-size 已是目标值（模块求值时就应用，早于 UI 挂载）；
//      b. 首页关键元素（开始练习、字库 tab…）第一次出现时 --k 已是目标值，位置在 pageReady 前后一个像素都没变；
//      c. 原生同值的调用到达后 <html> 的 style / data-* 一次属性变更都没有（不重复写、不触发重排）。
//   2. 对照（旧行为）：同样的 XXXL 只经 pageReady 后的桥——首帧 --k 为 1，原生调用到达后版式变了。证明上面的断言真能抓到跳动。
//   3. 注入 AX3、pageReady 时系统已变成 XXXL（App 在加载期间被调了字号）：最终是 XXXL，不卡在注入值。
//   4. 网页（既无注入也无原生）：--k 一直是 1，<html> 没有 data-text-size / data-ax / data-text-large。
// 全程零 console.error / pageerror；54-native-bridge 的 pageReady 时序另测。

/* eslint-disable no-undef */
function installFakeNativeAndInject() {
  const params = new URLSearchParams(location.search);
  const parse = raw => {
    if (!raw) return null;
    const [category, scale] = raw.split(':');
    return { category, scale: Number(scale) };
  };
  const inject = parse(params.get('e2eInject'));
  const native = parse(params.get('e2eNative'));
  if (inject) window.__shiziInitialContentSize = inject;

  // 文档开始时 documentElement 还不存在（WKUserScript atDocumentStart 同样）：用时再取，属性观察器等 <html> 出现后再挂。
  const state = { dcl: null, first: null, ready: false, readyAt: null, attrMutationsAfterReady: [], sizeCalls: 0 };
  window.__e2eInject = state;
  const read = () => {
    const root = document.documentElement;
    return {
      k: getComputedStyle(root).getPropertyValue('--k').trim(),
      inlineK: root.style.getPropertyValue('--k'),
      ax: root.getAttribute('data-ax'),
      large: root.hasAttribute('data-text-large'),
      size: root.getAttribute('data-text-size'),
    };
  };
  const rects = () => {
    const out = {};
    // E9a（D49）：Tab 栏与首页按钮不再随字号变（Tab 固定 49 / 24 / 11，按钮锚在 Tab 上 119），旧版靠它们的位置变化证明「首帧跳动」；
    // 这里再量两个随字号变的文字块（首次打开的题跋、按钮下的说明句），对照断言（版式在桥调用后会动）才仍然抓得到跳动。
    for (const id of ['home-start', 'home-pick', 'home-motto', 'home-first-tip', 'tab-home', 'tab-library', 'tab-mine']) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out[id] = [r.left, r.top, r.width, r.height].map(v => Math.round(v * 100) / 100);
    }
    return out;
  };
  window.__e2eRects = rects;
  window.__e2eRead = read;

  document.addEventListener('DOMContentLoaded', () => { state.dcl = read(); }, { once: true, capture: true });

  new MutationObserver(() => {
    if (state.first || !document.querySelector('[data-testid="home-start"]')) return;
    state.first = { env: read(), rects: null };
    requestAnimationFrame(() => { state.first.rects = rects(); });
  }).observe(document, { childList: true, subtree: true });

  const attrObserver = new MutationObserver(records => {
    if (!state.ready) return;
    for (const r of records) if (r.attributeName === 'style' || /^data-(text|ax)/.test(r.attributeName)) state.attrMutationsAfterReady.push(r.attributeName);
  });
  const waitRoot = new MutationObserver(() => {
    if (!document.documentElement) return;
    attrObserver.observe(document.documentElement, { attributes: true });
    waitRoot.disconnect();
  });
  waitRoot.observe(document, { childList: true });

  window.webkit = {
    messageHandlers: {
      shiziNative: {
        postMessage(msg) {
          if (!msg || msg.type !== 'pageReady') return;
          state.ready = true;
          state.readyAt = read();
          // 与 Swift handlePageReady 同序：pageReady 之后原生发当前档位（evaluateJavaScript，晚一拍）。
          if (native) {
            setTimeout(() => {
              state.sizeCalls += 1;
              window.shiziContentSize(native);
            }, 30);
          }
        },
      },
    },
  };
}
/* eslint-enable no-undef */

async function launch(page, baseURL, query) {
  await page.goto('about:blank');
  await page.goto(`${baseURL}/?test=1&${query}`);
  await page.waitForSelector('[data-testid="home-start"]');
  await page.waitForFunction(() => window.__e2eInject.ready);
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    state: window.__e2eInject, end: window.__e2eRead(), endRects: window.__e2eRects(),
  }));
}

const CASES = [
  { category: 'XXXL', scale: 1.3529, k: '1.35', ax: null, large: true },
  { category: 'AX3', scale: 2.0, k: '2', ax: '3', large: true },
];

export default async function textSizeInject(page, ctx) {
  const { assert, step, baseURL } = ctx;
  await page.addInitScript(installFakeNativeAndInject);

  for (const c of CASES) {
    const q = `e2eInject=${c.category}:${c.scale}&e2eNative=${c.category}:${c.scale}`;
    step(`${c.category}: injected at document start — target --k at DOMContentLoaded and at the first home frame, nothing moves at pageReady`);
    const r = await launch(page, baseURL, q);
    const want = { k: c.k, inlineK: c.k, ax: c.ax, large: c.large, size: c.category };
    assert.deepEqual(r.state.dcl, want, `${c.category}: <html> already at the target size when DOMContentLoaded fires (--k ${c.k})`);
    assert.deepEqual(r.state.first.env, want, `${c.category}: home first frame is laid out at the target size`);
    assert.deepEqual(r.state.readyAt, want, `${c.category}: still the target size at pageReady`);
    assert.ok(r.state.sizeCalls === 1 && r.end.k === c.k, `${c.category}: the native call after pageReady arrived (${r.state.sizeCalls}) and the size is unchanged`);
    assert.ok(Object.keys(r.state.first.rects).includes('home-start') && Object.keys(r.state.first.rects).includes('tab-library'), `${c.category}: key home elements measured`);
    assert.deepEqual(r.endRects, r.state.first.rects, `${c.category}: home-start / tabs at the same position before and after pageReady`);
    assert.deepEqual(r.state.attrMutationsAfterReady, [], `${c.category}: the same size from the bridge changed no <html> attribute or inline style (no re-layout)`);
  }

  step('control: XXXL only through the bridge after pageReady (pre-injection behaviour) — first frame at --k 1, then the layout jumps');
  const old = await launch(page, baseURL, 'e2eNative=XXXL:1.3529');
  assert.equal(old.state.dcl.k, '1', 'without injection <html> is still at --k 1 at DOMContentLoaded');
  assert.equal(old.state.first.env.k, '1', 'without injection the first home frame is laid out at --k 1');
  assert.equal(old.end.k, '1.35', 'then the bridge call lands');
  assert.ok(JSON.stringify(old.endRects) !== JSON.stringify(old.state.first.rects), 'and the home layout moves (the jump the injection removes)');

  step('AX3 injected, but the system is XXXL when the page reports ready (changed while loading) — ends at XXXL');
  const changed = await launch(page, baseURL, 'e2eInject=AX3:2&e2eNative=XXXL:1.3529');
  assert.equal(changed.state.dcl.size, 'AX3', 'starts at the injected size');
  assert.deepEqual({ k: changed.end.k, ax: changed.end.ax, size: changed.end.size }, { k: '1.35', ax: null, size: 'XXXL' }, 'a different size from the bridge replaces it (AX marker removed)');

  step('web (no injection, no native call): --k stays 1, no text-size attributes');
  const web = await launch(page, baseURL, 'e2eNone=1');
  assert.deepEqual({ k: web.state.dcl.k, inlineK: web.end.inlineK, ax: web.end.ax, large: web.end.large, size: web.end.size },
    { k: '1', inlineK: '', ax: null, large: false, size: null }, 'web: unchanged behaviour');
}
