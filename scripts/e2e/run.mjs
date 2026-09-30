#!/usr/bin/env node
// 端到端运行器（01-架构设计 §11 第 3 层）。
// - 用 python3 -m http.server 在 127.0.0.1 的随机空闲端口起静态服务（与 iOS 壳 / GitHub Pages 同为纯静态）；
// - 依次 import 本目录下的 *.spec.js（按文件名排序），每个 spec 导出 `export default async function (page, ctx)`；
// - 每个 spec 一个新的 browser context（393×852），自动收集 console.error / pageerror，spec 结束后断言为零；
// - 用 playwright 库（不是 @playwright/test）；逐条打印断言；有失败则退出码 1。
//
// 用法：
//   node scripts/e2e/run.mjs                 跑全部 spec
//   node scripts/e2e/run.mjs 00-shell        只跑文件名包含该串的 spec
// 环境变量：
//   SHIZI_E2E_CHROMIUM=<path>   指定 Chromium 可执行文件（本机 playwright 浏览器版本不匹配时用）
//   SHIZI_E2E_HEADED=1          有界面运行

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SPEC_TIMEOUT_MS = 90_000;
export const VIEWPORT = { width: 393, height: 852 };

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const baseURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`http.server exited early (${child.exitCode}): ${stderr}`);
    try {
      const res = await fetch(`${baseURL}/index.html`);
      if (res.ok) return { child, baseURL };
    } catch (error) {
      // 还没起来
    }
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`http.server did not come up on ${baseURL}: ${stderr}`);
}

function cachedHeadlessShell() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean);
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      const m = /^chromium_headless_shell-(\d+)$/.exec(dir);
      if (!m) continue;
      for (const sub of readdirSync(join(root, dir))) {
        const exe = join(root, dir, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
        if (existsSync(exe)) found.push({ rev: Number(m[1]), exe });
      }
    }
  }
  found.sort((a, b) => b.rev - a.rev);
  return found.length ? found[0].exe : null;
}

async function launchBrowser() {
  const headless = process.env.SHIZI_E2E_HEADED !== '1';
  if (process.env.SHIZI_E2E_CHROMIUM) return chromium.launch({ headless, executablePath: process.env.SHIZI_E2E_CHROMIUM });
  try {
    return await chromium.launch({ headless });
  } catch (error) {
    const alt = cachedHeadlessShell();
    if (!alt || !/Executable doesn't exist|executable/i.test(String(error && error.message))) throw error;
    console.log(`(playwright's bundled chromium is missing; using ${alt})`);
    return chromium.launch({ headless, executablePath: alt });
  }
}

class AssertionFailed extends Error {}

function makeCtx(baseURL, counters, consoleErrors) {
  const pass = msg => {
    counters.pass += 1;
    console.log(`    ok   ${msg}`);
  };
  const fail = (msg, detail) => {
    counters.fail += 1;
    console.log(`    FAIL ${msg}${detail ? `\n         ${detail}` : ''}`);
    throw new AssertionFailed(msg);
  };
  const fmt = v => {
    try {
      return JSON.stringify(v);
    } catch (error) {
      return String(v);
    }
  };
  const assert = {
    ok(cond, msg) {
      if (cond) pass(msg);
      else fail(msg, `got ${fmt(cond)}`);
    },
    equal(actual, expected, msg) {
      if (Object.is(actual, expected)) pass(msg);
      else fail(msg, `expected ${fmt(expected)}, got ${fmt(actual)}`);
    },
    deepEqual(actual, expected, msg) {
      if (fmt(actual) === fmt(expected)) pass(msg);
      else fail(msg, `expected ${fmt(expected)}, got ${fmt(actual)}`);
    },
  };
  const allowed = [];
  return {
    baseURL,
    assert,
    root: ROOT,
    viewport: VIEWPORT,
    step(name) {
      console.log(`  - ${name}`);
    },
    // 允许某条已知的 console.error（正则）；默认一条都不允许。
    allowConsoleError(re) {
      allowed.push(re);
    },
    consoleErrors() {
      return consoleErrors.filter(text => !allowed.some(re => re.test(text)));
    },
  };
}

async function runSpec(browser, file, baseURL, counters) {
  const name = file.replace(/\.spec\.js$/, '');
  console.log(`\n# ${name}`);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error && error.message}`));
  page.on('requestfailed', req => consoleErrors.push(`requestfailed: ${req.url()} ${req.failure() && req.failure().errorText}`));
  page.on('response', res => {
    if (res.status() >= 400) consoleErrors.push(`http ${res.status()}: ${res.url()}`);
  });
  const ctx = makeCtx(baseURL, counters, consoleErrors);
  let ok = true;
  try {
    const mod = await import(pathToFileURL(join(HERE, file)).href);
    if (typeof mod.default !== 'function') throw new Error(`${file} has no default export function`);
    let timer;
    await Promise.race([
      mod.default(page, ctx),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`spec timed out after ${SPEC_TIMEOUT_MS}ms`)), SPEC_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    const errors = ctx.consoleErrors();
    ctx.assert.deepEqual(errors, [], 'no console errors, page errors, failed requests or HTTP errors');
  } catch (error) {
    ok = false;
    if (!(error instanceof AssertionFailed)) {
      counters.fail += 1;
      console.log(`    FAIL ${error && error.stack ? error.stack : error}`);
    }
    const errors = ctx.consoleErrors();
    if (errors.length) console.log(`         console: ${errors.join(' | ')}`);
  } finally {
    await context.close();
  }
  return ok;
}

async function main() {
  const filter = process.argv[2] || '';
  const specs = readdirSync(HERE).filter(f => f.endsWith('.spec.js') && f.includes(filter)).sort();
  if (!specs.length) {
    console.error(`no spec matches "${filter}" in ${HERE}`);
    process.exit(1);
  }
  const counters = { pass: 0, fail: 0 };
  const failedSpecs = [];
  let server = null;
  let browser = null;
  const cleanup = () => {
    if (server && server.child.exitCode === null) server.child.kill();
  };
  // 任何退出路径（含 stdout 管道被关、未捕获异常、Ctrl-C、SIGTERM）都要带走 http.server 子进程。
  process.on('exit', cleanup);
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(signal, () => {
      cleanup();
      process.exit(code);
    });
  }
  process.stdout.on('error', () => {
    cleanup();
    process.exit(1);
  });
  try {
    server = await startServer();
    console.log(`e2e: serving ${ROOT} at ${server.baseURL}`);
    browser = await launchBrowser();
    console.log(`e2e: chromium ${browser.version()}`);
    for (const file of specs) {
      const ok = await runSpec(browser, file, server.baseURL, counters);
      if (!ok) failedSpecs.push(file);
    }
  } finally {
    if (browser) await browser.close();
    cleanup();
  }
  console.log(`\ne2e: ${specs.length} spec(s), ${counters.pass} assertion(s) passed, ${counters.fail} failed`);
  if (failedSpecs.length) {
    console.log(`e2e: FAILED ${failedSpecs.join(', ')}`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
