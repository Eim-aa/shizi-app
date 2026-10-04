// Q3 冷启动首帧（Chromium 口径；01 §8.8「Q3 冷启动到首页首帧」；03 P179 / P180）。
//
// 一次「冷启动」= 全新 browser context（没有 HTTP 缓存、内存、history.state）+ 给定的 localStorage，打开 /?test=1 到首页首帧。
// 计时的冷启动都装假原生桥（helpers installNativeStub：window.webkit.messageHandlers.shiziNative），走 App 里的路径；
// 另开一次不装桥的网页冷启动，只核对网页不预热字体。
// 两种数据量：首次安装（空存储）、一年量级约 300 字 + 墨迹（61-perf 的 seedPerf('year')，真实 mutator 造数）。
// 读 src/app.js 的 performance.mark（shizi:app-eval / store-modules / store / migrate / ui-modules / mounted / first-frame / ready）
// 与 paint first-contentful-paint（没有 FCP 的环境退回 shizi:first-frame）。
//
// 断言：
//   1. 打点齐全且有序；首个内容帧在 mounted 之后（body 起初是空的 #app，首帧就是挂好的首页），首帧时首页已在 DOM 里。
//   2. 首屏模块图（scripts/build_shell_manifest.mjs bootModules()：app.js 的静态依赖 + mountApp 里 import() 的模块及其静态依赖）
//      每一个的请求都在 app.js 求值之前就发出（index.html 的 <link rel="modulepreload">）。旧实现逐层发现：root.js 要等
//      store 起来后才请求、它的 130 多个子模块要等 root.js 解析后才请求 → 这条红。
//   2b. 原生壳里三种网页字体在 app.js 求值时就开始取（src/app.js warmFonts）：iOS WebKit 的首帧要等首屏用到的网页字体
//      载完，旧实现要到挂载后第一次排版才请求 → 这条红。网页（无原生桥）不预热：UI 渲染前不请求任何 WOFF2。
//   3. 首帧：每种数据量 3 次，最快一次 ≤ P180（并行负载只会让它变慢，最快一次最接近固有耗时；中位数与各次一并打印）；
//      分段表打印出来（报告 / 01 §8.8 引用）。
//   4. 首帧前的底色：html 背景就是纸色（tokens --paper），不是白底（无白闪的网页一侧）。

import { bootModules } from '../build_shell_manifest.mjs';
import { FACES, FONT_DIR } from '../../src/data/font-loader.js';
import { seedPerf } from './61-perf.spec.js';
import { installNativeStub } from './helpers.mjs';

export const LIMITS = Object.freeze({
  firstFrameMs: 400, // P180：Chromium 口径冷启动到首页首帧（3 次里最快一次）
});
const RUNS = 3;
const FONT_FILES = Object.values(FACES).map(f => `${FONT_DIR}${f.file}`);
const MARKS = ['app-eval', 'store-modules', 'store', 'migrate', 'ui-modules', 'mounted', 'first-frame', 'ready'];

const median = list => {
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

async function coldBoot(browser, ctx, storageState, { native = true } = {}) {
  const context = await browser.newContext({ viewport: ctx.viewport, deviceScaleFactor: 2, locale: 'zh-CN', storageState });
  const page = await context.newPage();
  if (native) await installNativeStub(page);
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e && e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  try {
    await page.goto(`${ctx.baseURL}/?test=1`);
    await page.waitForFunction(() => ['shizi:first-frame', 'shizi:ready'].every(n => performance.getEntriesByName(n).length > 0), null, { timeout: 20_000 });
    return await page.evaluate(async names => {
      const fcp = await new Promise(resolve => {
        const found = performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint');
        if (found) return resolve(found.startTime);
        let done = false;
        const finish = value => {
          if (!done) {
            done = true;
            resolve(value);
          }
        };
        try {
          new PerformanceObserver(list => {
            const hit = list.getEntries().find(e => e.name === 'first-contentful-paint');
            if (hit) finish(hit.startTime);
          }).observe({ type: 'paint', buffered: true });
        } catch (error) {
          // 没有 paint 观察：退回 first-frame
        }
        setTimeout(() => finish(null), 1500);
      });
      const marks = {};
      for (const n of names) {
        const e = performance.getEntriesByName(`shizi:${n}`)[0];
        marks[n] = e ? e.startTime : null;
      }
      const resources = performance.getEntriesByType('resource').map(e => ({ path: new URL(e.name).pathname.slice(1), start: e.fetchStart }));
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        marks,
        fcp,
        resources,
        responseEnd: nav ? nav.responseEnd : null,
        home: !!document.querySelector('[data-testid="screen-home"]'),
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
      };
    }, MARKS);
  } finally {
    await context.close();
    if (errors.length) throw new Error(`cold boot errors: ${errors.join(' | ')}`);
  }
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : hex;
}

export default async function q3Boot(page, ctx) {
  const { assert, step } = ctx;
  const browser = page.context().browser();
  const boot = bootModules();

  step('seed the 300-char + ink data set in the runner page (61-perf seedPerf year)');
  await page.goto(`${ctx.baseURL}/?test=1`);
  await page.waitForFunction(() => typeof window.__shiziTest === 'object');
  const seeded = await seedPerf(page, 'year');
  assert.equal(seeded.chars, 300, `seeded 300 chars (${seeded.records} records, ${seeded.inks} inks)`);
  const rich = await page.context().storageState();
  assert.ok(rich.origins.some(o => o.localStorage.some(kv => kv.name.startsWith('shizi.v2.ink'))), 'storage snapshot carries ink buckets');

  const table = [];
  for (const [label, state] of [['首次安装（空存储）', undefined], ['约 300 字 + 墨迹', rich]]) {
    step(`cold boot × ${RUNS}: ${label}`);
    const runs = [];
    for (let k = 0; k < RUNS; k += 1) runs.push(await coldBoot(browser, ctx, state));
    const first = runs[0];
    const m = first.marks;
    assert.ok(MARKS.every(n => typeof m[n] === 'number'), `all boot marks present (${MARKS.join(', ')})`);
    const order = ['app-eval', 'store-modules', 'store', 'migrate', 'ui-modules', 'mounted'];
    assert.ok(order.every((n, i) => i === 0 || m[order[i - 1]] <= m[n]), `boot marks in order: ${order.map(n => `${n}=${m[n].toFixed(0)}`).join(' ≤ ')}`);
    assert.ok(m.mounted <= m['first-frame'], 'first-frame mark comes after mount');
    assert.ok(first.home, 'home screen is in the DOM at first frame');
    for (const r of runs) {
      if (typeof r.fcp === 'number') assert.ok(r.fcp >= r.marks.mounted - 1, `first contentful paint (${r.fcp.toFixed(0)}ms) is the mounted home (mounted ${r.marks.mounted.toFixed(0)}ms)`);
    }

    // 2. 首屏模块图在 app.js 求值前就已全部发出请求
    const starts = new Map(first.resources.map(r => [r.path, r.start]));
    const missing = boot.filter(rel => !starts.has(rel));
    assert.deepEqual(missing, [], 'every boot module is fetched during a cold boot');
    const late = boot.filter(rel => starts.get(rel) > m['app-eval']).map(rel => `${rel}@${starts.get(rel).toFixed(0)}`);
    assert.deepEqual(late, [], `all ${boot.length} boot modules are requested before app.js evaluates (modulepreload, app-eval=${m['app-eval'].toFixed(0)}ms)`);

    // 2b. 原生壳：首屏字体在 app.js 求值时就开始取（不等挂载后的第一次排版；iOS WebKit 首帧要等它们载完）
    const fontStarts = FONT_FILES.map(rel => [rel, starts.get(rel)]);
    assert.ok(fontStarts.every(([, t]) => typeof t === 'number' && t >= m['app-eval'] - 1 && t <= m['ui-modules']),
      `native shell: the three WOFF2 faces are requested from app.js evaluation on, before the UI mounts (${fontStarts.map(([r, t]) => `${r.replace('fonts/', '')}@${t == null ? '—' : t.toFixed(0)}`).join(', ')}; app-eval=${m['app-eval'].toFixed(0)}, ui-modules=${m['ui-modules'].toFixed(0)}, mounted=${m.mounted.toFixed(0)})`);

    // 4. 底色
    assert.equal(first.htmlBg, hexToRgb(first.paper), `html background is paper (${first.paper}) before any content — no white frame`);

    // 3. 首帧
    const frames = runs.map(r => (typeof r.fcp === 'number' ? r.fcp : r.marks['first-frame']));
    const med = median(frames);
    const seg = name => median(runs.map(r => r.marks[name]));
    table.push({
      label,
      responseEnd: median(runs.map(r => r.responseEnd)),
      app: seg('app-eval'),
      store: seg('store'),
      migrate: seg('migrate'),
      ui: seg('ui-modules'),
      mounted: seg('mounted'),
      frame: med,
      all: frames.map(v => v.toFixed(0)).join(' / '),
    });
    const best = Math.min(...frames);
    assert.ok(best <= LIMITS.firstFrameMs, `${label}: cold boot → home first frame, best of ${RUNS} ${best.toFixed(0)}ms ≤ ${LIMITS.firstFrameMs}ms (P180; median ${med.toFixed(0)}ms; runs ${frames.map(v => v.toFixed(0)).join(' / ')})`);
  }

  step('web (no native bridge) cold boot: fonts are not warmed — no WOFF2 request before the UI renders');
  const web = await coldBoot(browser, ctx, rich, { native: false });
  const early = web.resources.filter(r => FONT_FILES.includes(r.path) && r.start < web.marks['ui-modules']).map(r => `${r.path}@${r.start.toFixed(0)}`);
  assert.deepEqual(early, [], `web: no WOFF2 requested at app.js evaluation — only once the UI renders (ui-modules=${web.marks['ui-modules'].toFixed(0)}ms)`);
  assert.ok(web.home, 'web: home screen at first frame');

  console.log('    | 数据量 | index 响应 | app.js 求值 | store 就绪 | 迁移完 | UI 模块就绪 | 挂载 | 首帧（中位） | 各次首帧 |');
  console.log('    |---|---|---|---|---|---|---|---|---|');
  for (const r of table) {
    const f = v => `${v.toFixed(0)}ms`;
    console.log(`    | ${r.label} | ${f(r.responseEnd)} | ${f(r.app)} | ${f(r.store)} | ${f(r.migrate)} | ${f(r.ui)} | ${f(r.mounted)} | ${f(r.frame)} | ${r.all} |`);
  }
}
