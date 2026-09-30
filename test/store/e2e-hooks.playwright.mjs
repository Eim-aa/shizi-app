#!/usr/bin/env node
// M0-5 最小 e2e：测试钩子 window.__shiziTest 的挂载条件（01-架构设计 §11 isTestHost）。
// 不是 *.test.mjs，verify:unit 不会跑它；scripts/e2e/run.mjs（M0-4）接入前手动运行：
//
//   python3 -m http.server 8765 --bind 127.0.0.1 &      # 在仓库根目录
//   node test/store/e2e-hooks.playwright.mjs [http://127.0.0.1:8765]
//   （本机 Playwright 浏览器版本不匹配时：PW_CHROMIUM=<chrome-headless-shell 路径> node …）
//
// isTestHost() 判定：URL 查询参数 test=1  且  （hostname ∈ {localhost, 127.0.0.1}  或  window.__shiziNativeDev === true）。
// 断言：
//   1. 生产形态 URL（https://eim-aa.github.io/shizi-app/，带或不带 ?test=1；本地文件经 page.route 代答）→ __shiziTest === undefined
//   2. 本地地址但不带 test=1（http://127.0.0.1:PORT/、http://localhost:PORT/）→ undefined
//   3. http://127.0.0.1:PORT/?test=1 与 http://localhost:PORT/?test=1 → 已挂载；seed/getState/getWriteLog 可用，
//      且写日志里没有绕过 storage.js 的写（via==='direct' 为空）
//   4. 各页面零 pageerror
import { chromium } from 'playwright';

const BASE = (process.argv[2] || 'http://127.0.0.1:8765').replace(/\/$/, '');
const PORT = new URL(BASE).port || '80';
const PROD = 'https://eim-aa.github.io/shizi-app';

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
};

const launch = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};
const browser = await chromium.launch(launch);

async function open(url, { proxyProd = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  if (proxyProd) {
    // 生产形态：把 github.io 的请求转给本地静态服务，URL 保持生产主机名。
    await context.route(`${PROD}/**`, async route => {
      const path = route.request().url().slice(PROD.length).split('?')[0] || '/';
      const response = await context.request.get(`${BASE}${path}`);
      await route.fulfill({ response });
    });
  }
  await page.goto(url, { waitUntil: 'load' });
  // app.js 在 DOMContentLoaded 后异步 boot，稍等模块链完成
  await page.waitForFunction(() => document.getElementById('app') && document.getElementById('app').childNodes.length > 0, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { context, page, errors };
}

const absent = [
  [`${PROD}/`, true],
  [`${PROD}/?test=1`, true],
  [`${BASE}/`, false],
  [`http://localhost:${PORT}/`, false],
  [`${BASE}/?test=0`, false],
];
for (const [url, proxyProd] of absent) {
  const { context, page, errors } = await open(url, { proxyProd });
  const type = await page.evaluate(() => typeof window.__shiziTest);
  check(type === 'undefined', `${url} → typeof window.__shiziTest === 'undefined' (got ${type})`);
  check(errors.length === 0, `${url} → no pageerror ${errors.join(' | ')}`);
  await context.close();
}

for (const url of [`${BASE}/?test=1`, `http://localhost:${PORT}/?test=1`]) {
  const { context, page, errors } = await open(url);
  const result = await page.evaluate(() => {
    const t = window.__shiziTest;
    if (!t) return { mounted: false };
    t.reset();
    const seed = t.seed({ meta: { schema: 2, serial: 0, createdAt: Date.now(), months: [] }, settings: { sound: true } });
    const state = t.getState();
    const log = t.getWriteLog();
    return {
      mounted: true,
      hooks: Object.keys(t).sort(),
      seedOk: seed.ok,
      sound: state.settings && state.settings.sound,
      logCount: log.length,
      direct: log.filter(e => e.via === 'direct').map(e => `${e.op}:${e.key}`),
    };
  });
  check(result.mounted, `${url} → window.__shiziTest mounted`);
  if (result.mounted) {
    const required = ['failNextWrite', 'getState', 'getWriteLog', 'interruptAfterWrite', 'reset', 'seed', 'setClock'];
    check(required.every(name => result.hooks.indexOf(name) >= 0), `${url} → hooks present: ${result.hooks.join(',')}`);
    check(result.seedOk === true && result.sound === true, `${url} → seed + getState round-trip`);
    check(result.logCount > 0 && result.direct.length === 0, `${url} → ${result.logCount} writes logged, none bypass storage.js (${result.direct.join(',')})`);
  }
  check(errors.length === 0, `${url} → no pageerror ${errors.join(' | ')}`);
  await page.evaluate(() => window.__shiziTest && window.__shiziTest.reset());
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
