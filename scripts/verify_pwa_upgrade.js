#!/usr/bin/env node
"use strict";

// 真实 main v10 → 本分支 v13 的 PWA 升级门禁。
//
// 这里刻意不再用手写的"迷你 v10"：真 v10 对 HTML 是网络优先、对同源静态资源是缓存优先、
// 缓存键是不带指纹的裸路径，跟随手复刻的 cache-first 版本行为完全不同，
// 用复刻版做回归会把"关键资源 503 不回落缓存"这类问题假绿。
// 因此 legacy 一代直接回放 LEGACY_COMMIT 的真实文件，current 一代直接用工作区的真实 App，
// 断言也落在真实数字上（6854 / 7294 唯一字、四库 3500/2976/818/2500、deck 文件 SHA-256）。

const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_DIR = path.join(ROOT, "scripts", "fixtures", "pwa-legacy-v10");

// main 上真实的 v10 一代（PR #153 合并后的 main）。
const LEGACY_COMMIT = "4d6e8e59d499e968c398ce662aff69eaff714f9d";
const LEGACY_FILES = ["sw.js", "core-strokes.js", "index.html", "deck-data.js",
  "hanzi-writer.min.js", "fsrs6.min.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
const LEGACY_SHA256 = {
  "sw.js": "f545da4108ebaeb68b1ed0a11666a8ac127c3a8d7c06ee779f9d0225877d0d70",
  "core-strokes.js": "9396de0433dd03e642c6c71224ec731faef4c843aac0ffc6b6b9c54ff16e02ee",
  "index.html": "723666c3da3aeefaff487d17df0e2f41cc3d7252849edc531b0e9fbbb1b8fd2b",
  "deck-data.js": "972e20a9d30f627b69acd1df1021d14a2a529fd6bdf911d342449d385bd03e97",
};
// scripts/fixtures/pwa-legacy-v10/ 里冻结了这两份文件，让"被回放的旧缓存策略"在代码评审里可见。
const FROZEN_FIXTURES = ["sw.js", "core-strokes.js"];
const LEGACY_CACHE = "shizi-v10";
const LEGACY_SEED_CHARS = 6854;
const CURRENT_SEED_CHARS = 7294;
const EXPECTED_LIBRARIES = [
  { id: "core3500", total: 3500, officialTotal: 3500 },
  { id: "adv3000", total: 2976, officialTotal: 3000 },
  { id: "rare", total: 818, officialTotal: 1605 },
  { id: "curriculum2500", total: 2500, officialTotal: 2500 },
];

const htmlSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const workerSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const build = htmlSource.match(/<meta name="shizi-asset-build" content="([^"]+)">/)?.[1];
const deckSrc = htmlSource.match(/<script src="(deck-data\.js\?v=[^"]+)"><\/script>/)?.[1];
const overrideSrc = htmlSource.match(/<script src="(data\/context-overrides\.js\?v=[^"]+)"><\/script>/)?.[1];
const coreStrokeSrc = workerSource.match(/importScripts\('\.\/(core-strokes\.js\?v=[^']+)'\)/)?.[1];
const CURRENT_CACHE = `shizi-v13-${build}`;

function check(value, message, details) {
  if (!value) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
}

function note(message) {
  process.stdout.write(`[pwa-upgrade] ${message}\n`);
}

function findChromeExecutable() {
  return [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find(candidate => candidate && fs.existsSync(candidate));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileSha256(relativePath) {
  return sha256(fs.readFileSync(path.join(ROOT, relativePath)));
}

function fingerprintedPath(source, pattern, label) {
  const match = source.match(pattern);
  check(match, `Missing fingerprinted ${label}`);
  const [, relativePath, fingerprint] = match;
  check(fileSha256(relativePath).startsWith(fingerprint), `${label} fingerprint does not match file content`, {
    relativePath,
    fingerprint,
    sha256: fileSha256(relativePath),
  });
  return `${relativePath}?v=${fingerprint}`;
}

check(build && deckSrc && overrideSrc && coreStrokeSrc, "Production HTML and worker must expose fingerprinted critical resources",
  { build, deckSrc, overrideSrc, coreStrokeSrc });
check(workerSource.includes(`const BUILD = '${build}'`) && workerSource.includes(`'${deckSrc}'`),
  "Production HTML and service worker must pin the same corpus build", { build, deckSrc });
check(fingerprintedPath(htmlSource, /<script src="(deck-data\.js)\?v=([a-f0-9]+)"><\/script>/, "deck-data") === deckSrc,
  "Production HTML deck fingerprint disagrees with its parsed script source");
check(fingerprintedPath(htmlSource, /<script src="(data\/context-overrides\.js)\?v=([a-f0-9]+)"><\/script>/, "context overrides") === overrideSrc,
  "Production HTML context-override fingerprint disagrees with its parsed script source");
check(fingerprintedPath(workerSource, /importScripts\('\.\/(core-strokes\.js)\?v=([a-f0-9]+)'\)/, "core strokes") === coreStrokeSrc,
  "Service worker core-stroke fingerprint disagrees with its parsed import");

const DECK_SHA256 = fileSha256("deck-data.js");
const CORE_STROKES_SHA256 = fileSha256("core-strokes.js");
const OVERRIDES_SHA256 = fileSha256(path.join("data", "context-overrides.js"));

function git(args, options = {}) {
  return execFileSync("git", ["-C", ROOT, ...args], { maxBuffer: 64 * 1024 * 1024, ...options });
}

function hasLegacyCommit() {
  try {
    git(["cat-file", "-e", `${LEGACY_COMMIT}^{commit}`], { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
}

// legacy 一代的 data/ 默认用当前工作区提供，但必须先证明它逐字节相同。
// 注意要跟「工作区」比，不是跟 HEAD 比：门禁服务的是工作区文件，
// 只比 HEAD 会让未提交的改动在本机悄悄通过、到 CI 才红。
// 真正漂移的那几个文件从 legacy commit 取回来单独提供，而不是直接判失败——
// 分支往前走，data/ 出现合理差异是必然的。
function materializeDriftedLegacyData(dir) {
  const drifted = git(["diff", "--name-only", LEGACY_COMMIT, "--", "data/"], { encoding: "utf8" })
    .split("\n").map(line => line.trim()).filter(Boolean);
  const restored = [];
  for (const file of drifted) {
    let bytes = null;
    try { bytes = git(["cat-file", "blob", `${LEGACY_COMMIT}:${file}`]); }
    catch (error) { continue; } // 旧一代里本就不存在的文件，旧 App 不会请求
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    restored.push(file);
  }
  note(`legacy data/: ${restored.length} drifted file(s) replayed from ${LEGACY_COMMIT.slice(0, 12)}`
    + (restored.length ? ` (${restored.slice(0, 5).join(", ")}${restored.length > 5 ? ", …" : ""})` : ""));
  return restored;
}

function materializeLegacyTree() {
  if (!hasLegacyCommit()) {
    // 浅克隆（CI 默认 fetch-depth: 1）里没有这个 commit。先按 SHA 单独取一次，
    // 取不到就直接失败——绝不把门禁降级成静默跳过。
    note(`legacy commit not present locally, fetching ${LEGACY_COMMIT.slice(0, 12)}`);
    try {
      git(["fetch", "--no-tags", "--depth=1", "origin", LEGACY_COMMIT], { stdio: "ignore" });
    } catch (error) {
      // 忽略：下面统一判定
    }
  }
  if (!hasLegacyCommit()) {
    throw new Error(`This gate replays the real v10 generation and needs commit ${LEGACY_COMMIT}. `
      + `Fetch it (git fetch --depth=1 origin ${LEGACY_COMMIT}) or check out with fetch-depth: 0.`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shizi-pwa-legacy-"));
  for (const file of LEGACY_FILES) {
    const bytes = git(["cat-file", "blob", `${LEGACY_COMMIT}:${file}`]);
    fs.writeFileSync(path.join(dir, file), bytes);
  }
  for (const [file, expected] of Object.entries(LEGACY_SHA256)) {
    const actual = sha256(fs.readFileSync(path.join(dir, file)));
    check(actual === expected, `Replayed legacy ${file} does not match its pinned digest`, { file, expected, actual });
  }
  for (const file of FROZEN_FIXTURES) {
    const frozen = fs.readFileSync(path.join(FIXTURE_DIR, file));
    const replayed = fs.readFileSync(path.join(dir, file));
    check(frozen.equals(replayed),
      `Frozen fixture ${file} drifted from the real v10 generation it documents`,
      { fixture: path.relative(ROOT, path.join(FIXTURE_DIR, file)), commit: LEGACY_COMMIT });
  }
  const legacyWorker = fs.readFileSync(path.join(dir, "sw.js"), "utf8");
  check(/网络优先/.test(legacyWorker) && legacyWorker.includes("const VERSION = 'shizi-v10'"),
    "Replayed legacy worker is not the network-first v10 this gate claims to exercise");
  materializeDriftedLegacyData(dir);
  note(`replaying real v10 from ${LEGACY_COMMIT.slice(0, 12)} at ${dir}`);
  return dir;
}

const legacyDir = materializeLegacyTree();
process.on("exit", () => { try { fs.rmSync(legacyDir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

let generation = "legacy"; // legacy | current | offline
let failPaths = new Set();
let workerRevision = 0;
let mark = "boot";
const requests = [];
const legacyFallbacks = new Set();

function resolveFile(pathname) {
  const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname).replace(/^\/+/, "");
  if (!relative || relative.split("/").includes("..")) return null;
  const roots = generation === "legacy" ? [legacyDir, ROOT] : [ROOT];
  for (const base of roots) {
    const file = path.join(base, relative);
    if (!file.startsWith(base + path.sep)) continue;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      if (generation === "legacy" && base === ROOT) legacyFallbacks.add(relative);
      return file;
    }
  }
  return null;
}

const server = http.createServer((request, response) => {
  if (generation === "offline") {
    // 真断网：让 fetch() 在网络层 reject，跟 503（resolve 出一个错误响应）区分开。
    requests.push({ mark, generation, path: request.url, status: "offline" });
    request.socket.destroy();
    return;
  }
  const url = new URL(request.url, "http://127.0.0.1");
  const record = {
    mark,
    generation,
    path: url.pathname + url.search,
    pathname: url.pathname,
    cacheControl: request.headers["cache-control"] || "",
    pragma: request.headers.pragma || "",
    status: 200,
  };
  requests.push(record);
  response.setHeader("Cache-Control", "public, max-age=31536000");

  if (url.pathname === "/sw.js") {
    const source = generation === "legacy"
      ? fs.readFileSync(path.join(legacyDir, "sw.js"), "utf8")
      : `${workerSource}\n// upgrade-fixture-revision:${workerRevision}\n`;
    response.setHeader("Content-Type", MIME[".js"]);
    response.end(source);
    return;
  }
  if (failPaths.has(url.pathname)) {
    record.status = 503;
    response.statusCode = 503;
    response.setHeader("Content-Type", MIME[".txt"]);
    response.end("upgrade fixture failure");
    return;
  }
  const file = resolveFile(url.pathname);
  if (!file) {
    record.status = 404;
    response.statusCode = 404;
    response.end("not found");
    return;
  }
  response.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
  response.end(fs.readFileSync(file));
});

// index.html 的内联脚本一旦在 SEED.forEach 处抛错，后面的 const 会停在 TDZ，
// 连 typeof 都会再抛一次 ReferenceError，所以所有页面探针都要包一层。
const APP_READY = () => { try { return typeof CARDS !== "undefined" && Array.isArray(CARDS) && CARDS.length > 0; } catch (error) { return false; } };

async function waitForApp(page, timeout = 60000) {
  await page.waitForFunction(APP_READY, null, { timeout });
}

async function corpusState(page) {
  return page.evaluate(async () => {
    const probe = (read, fallback) => { try { const value = read(); return value === undefined ? fallback : value; } catch (error) { return fallback; } };
    return {
      seed: probe(() => SEED.length, -1),
      unique: probe(() => new Set(SEED.map(row => row.target)).size, -1),
      cards: probe(() => CARDS.length, -1),
      overrides: probe(() => Object.keys(OVERRIDES).length, -1),
      build: document.querySelector('meta[name="shizi-asset-build"]')?.content || "",
      libraries: probe(() => LIBRARIES.map(lib => {
        const counts = libraryCounts(lib);
        return { id: lib.id, total: counts.total, officialTotal: counts.officialTotal };
      }), []),
      cacheNames: await caches.keys(),
      controlled: !!navigator.serviceWorker.controller,
      startBound: probe(() => typeof startBtn.onclick === "function", false),
    };
  });
}

async function cacheDigest(page, cacheName, resource) {
  return page.evaluate(async ({ cacheName: name, resource: url }) => {
    const cache = await caches.open(name);
    const hit = await cache.match(url);
    if (!hit) return { present: false, sha256: "" };
    const digest = await crypto.subtle.digest("SHA-256", await hit.arrayBuffer());
    return { present: true, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("") };
  }, { cacheName, resource });
}

function servedStatus(roundMark, pathname) {
  return requests.filter(row => row.mark === roundMark && row.pathname === pathname).map(row => row.status);
}

async function main() {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // 本机用装好的 Chrome；CI 上没有系统 Chrome 时回落到 playwright 自带的 chromium。
  const executablePath = findChromeExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const report = {};
  try {
    const context = await browser.newContext({ serviceWorkers: "allow" });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(String(error.message || error)));

    // ---- 1. 真实 v10 装好并接管 ----
    mark = "legacy-install";
    await page.goto(origin, { waitUntil: "load" });
    await waitForApp(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 120000 });
    await page.reload({ waitUntil: "load" });
    await waitForApp(page);
    const legacy = await corpusState(page);
    check(legacy.controlled && legacy.cacheNames.length === 1 && legacy.cacheNames[0] === LEGACY_CACHE,
      "Real v10 must control the page from exactly its own cache", legacy);
    check(legacy.seed === LEGACY_SEED_CHARS && legacy.unique === LEGACY_SEED_CHARS,
      `Real v10 fixture must hold the ${LEGACY_SEED_CHARS}-character corpus`, legacy);
    check(legacy.build === "" && legacy.startBound,
      "Real v10 page must be the pre-upgrade build and still reach a bound Home", legacy);
    note(`real v10 active: ${legacy.seed} seed rows / ${legacy.unique} unique characters`);

    // ---- 2. v13 安装失败：不激活、不留半成品缓存 ----
    mark = "failed-install";
    generation = "current";
    failPaths = new Set(["/fsrs6.min.js"]);
    workerRevision = 1;
    const failedLifecycle = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const states = [];
      const terminal = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("failed upgrade did not reach a terminal state")), 60000);
        const observe = worker => {
          if (!worker) return;
          const record = () => {
            states.push(worker.state);
            if (["activated", "redundant"].includes(worker.state)) {
              clearTimeout(timeout);
              resolve(worker.state);
            }
          };
          record();
          worker.addEventListener("statechange", record);
        };
        registration.addEventListener("updatefound", () => observe(registration.installing), { once: true });
        if (registration.installing) observe(registration.installing);
      });
      await registration.update();
      return { terminal: await terminal, states };
    });
    check(failedLifecycle.terminal === "redundant", "A 503 shell response must reject the new worker installation", failedLifecycle);
    check(servedStatus("failed-install", "/fsrs6.min.js").includes(503),
      "The failed-upgrade round did not actually exercise the 503 shell response");
    const failedCacheState = await page.evaluate(async ({ legacyCache, currentCache }) => {
      const names = await caches.keys();
      const entries = {};
      for (const name of names) entries[name] = (await (await caches.open(name)).keys()).length;
      return { names, entries, legacy: entries[legacyCache] || 0, current: entries[currentCache] ?? null };
    }, { legacyCache: LEGACY_CACHE, currentCache: CURRENT_CACHE });
    check(failedCacheState.legacy > 0 && (failedCacheState.current === null || failedCacheState.current === 0),
      "A failed shell install exposed a partially populated current cache", failedCacheState);

    // ---- 3. 失败安装之后断网：v10 缓存仍是一套完整、自洽的旧 App ----
    // 注意：真 v10 对 HTML 是网络优先，所以"失败升级后普通刷新仍然是旧页面"在真实路径上并不成立
    //（联网刷新会正常拿到新一代 HTML）。真正要守住的是：不激活、不留半成品缓存、离线仍是完整旧版。
    mark = "offline-after-failure";
    generation = "offline";
    await page.reload({ waitUntil: "load" });
    await waitForApp(page);
    const offline = await corpusState(page);
    check(offline.seed === LEGACY_SEED_CHARS && offline.unique === LEGACY_SEED_CHARS && offline.build === "" && offline.startBound,
      "After a failed upgrade the offline cache must still serve one coherent legacy app", offline);
    const offlineEntries = await page.evaluate(async () => {
      const entries = {};
      for (const name of await caches.keys()) entries[name] = (await (await caches.open(name)).keys()).length;
      return entries;
    });
    // 失败的安装会留下一个 caches.open() 建出来的空 v13 缓存，这是允许的；不允许的是它里面有东西。
    check(offlineEntries[LEGACY_CACHE] > 0
      && Object.entries(offlineEntries).every(([name, count]) => name === LEGACY_CACHE || count === 0),
      "A failed upgrade must not leave any populated cache besides the legacy one", offlineEntries);

    // ---- 4. 恢复联网后重试：真实 v10 → v13 完整升级 ----
    mark = "successful-upgrade";
    generation = "current";
    failPaths = new Set();
    workerRevision = 2;
    const upgradedNavigation = page.waitForNavigation({ waitUntil: "load", timeout: 120000 })
      .then(() => ({ navigated: true }))
      .catch(error => ({ navigated: false, error: error.message }));
    const updateRequest = page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const states = [];
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        states.push(worker.state);
        worker.addEventListener("statechange", () => states.push(worker.state));
      });
      await registration.update();
      const worker = registration.installing || registration.waiting;
      if (worker && !["activated", "redundant"].includes(worker.state)) {
        await Promise.race([
          new Promise(resolve => worker.addEventListener("statechange", () => {
            if (["activated", "redundant"].includes(worker.state)) resolve();
          })),
          new Promise(resolve => setTimeout(resolve, 60000)),
        ]);
      }
      return { states, active: registration.active?.state || "" };
    }).catch(error => ({ contextChanged: true, error: error.message }));
    const [lifecycle, navigation] = await Promise.all([updateRequest, upgradedNavigation]);
    check(navigation.navigated, "Activated worker did not navigate the legacy client", { lifecycle, navigation });
    await waitForApp(page);
    const upgraded = await corpusState(page);
    check(upgraded.build === build, "Activated worker did not navigate to the current build", upgraded);
    check(upgraded.seed === CURRENT_SEED_CHARS && upgraded.unique === CURRENT_SEED_CHARS,
      `The upgraded app must expose the ${CURRENT_SEED_CHARS}-character corpus`, upgraded);
    check(JSON.stringify(upgraded.libraries) === JSON.stringify(EXPECTED_LIBRARIES),
      "The upgraded app must expose the four governed libraries", { got: upgraded.libraries, want: EXPECTED_LIBRARIES });
    check(upgraded.overrides > 0 && upgraded.startBound, "The upgraded app must load its context overrides and bind Home", upgraded);
    check(upgraded.cacheNames.length === 1 && upgraded.cacheNames[0] === CURRENT_CACHE,
      "Activation must leave exactly the current cache", upgraded);
    const cachedDeck = await cacheDigest(page, CURRENT_CACHE, deckSrc);
    check(cachedDeck.present && cachedDeck.sha256 === DECK_SHA256,
      "The activated cache must hold the real production corpus byte-for-byte", { cachedDeck, expected: DECK_SHA256 });
    const freshDeckRequest = requests.find(row => row.mark === "successful-upgrade" && row.path === `/${deckSrc}`);
    check(freshDeckRequest && (/no-cache/i.test(freshDeckRequest.cacheControl) || /no-cache/i.test(freshDeckRequest.pragma)),
      "Worker installation did not bypass the browser HTTP cache for the corpus", freshDeckRequest);
    note(`upgraded to ${CURRENT_CACHE}: ${upgraded.seed} seed rows, deck sha256 ${cachedDeck.sha256.slice(0, 12)}`);

    // ---- 5. 已激活的 v13 遇到关键资源 503：必须回落缓存，而不是把 503 正文当脚本执行 ----
    const criticalRounds = [
      { mark: "critical-503-deck", pathname: "/deck-data.js", resource: deckSrc, sha256: DECK_SHA256, pageLoads: true },
      { mark: "critical-503-overrides", pathname: "/data/context-overrides.js", resource: overrideSrc, sha256: OVERRIDES_SHA256, pageLoads: true },
      // core-strokes.js 只被 worker 的 importScripts 用，已安装的 worker 不会再从页面请求它，
      // 所以这一轮靠页面直接 fetch 打 fetch handler，不要求它出现在页面加载里。
      { mark: "critical-503-core-strokes", pathname: "/core-strokes.js", resource: coreStrokeSrc, sha256: CORE_STROKES_SHA256, pageLoads: false },
      { mark: "critical-503-html", pathname: "/", resource: "", sha256: "", pageLoads: true },
    ];
    // 关键资源带一年期 Cache-Control，Chrome 自己的 HTTP 缓存会在刷新时直接复用它，
    // fetch handler 根本不会被调用。这里把浏览器缓存关掉，让"页面能不能拿到内容"这件事
    // 只由 service worker 的回落逻辑决定 —— 否则 503 断言测的是浏览器缓存，不是本次修复。
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

    const criticalResults = [];
    for (const round of criticalRounds) {
      mark = round.mark;
      failPaths = new Set([round.pathname]);
      pageErrors.length = 0;
      await page.reload({ waitUntil: "load" });
      // 这里不能直接 await：回落缺失时页面会卡在 SEED is not defined，
      // 让它超时抛裸 timeout 会把真正的失败原因藏起来。
      const booted = await waitForApp(page, 20000).then(() => true).catch(() => false);
      const state = await corpusState(page);
      const servedDuringLoad = servedStatus(round.mark, round.pathname);
      // HTML 走导航请求，路径是 "/"；其余关键资源用页面直接 fetch 覆盖，确保 fetch handler 真的被打到。
      const direct = round.resource
        ? await page.evaluate(async url => {
            const res = await fetch(url, { cache: "reload" });
            const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
            return { ok: res.ok, status: res.status, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("") };
          }, round.resource)
        : null;
      const served = servedStatus(round.mark, round.pathname);
      const seedFailure = pageErrors.filter(message => /SEED is not defined/.test(message));
      check(state.controlled, `The ${round.mark} round must run against a controlled page`, { round: round.mark, state });
      check(booted && state.seed === CURRENT_SEED_CHARS && state.unique === CURRENT_SEED_CHARS && state.startBound && seedFailure.length === 0,
        `A ${round.pathname} 503 must fall back to the cached copy instead of reaching the page`,
        { round: round.mark, booted, state, pageErrors, servedDuringLoad });
      check(JSON.stringify(state.libraries) === JSON.stringify(EXPECTED_LIBRARIES),
        `A ${round.pathname} 503 must not degrade the governed libraries`, { round: round.mark, libraries: state.libraries });
      if (direct) {
        check(direct.ok && direct.sha256 === round.sha256,
          `A ${round.pathname} 503 must resolve to the cached production bytes`, { round: round.mark, direct, expected: round.sha256 });
      }
      check(served.includes(503), `The ${round.mark} round never actually served a 503`,
        { round: round.mark, served, roundRequests: requests.filter(row => row.mark === round.mark).map(row => `${row.status} ${row.path}`).slice(0, 40) });
      check(!round.pageLoads || servedDuringLoad.includes(503),
        `The ${round.mark} round did not exercise the 503 on the page-load path`,
        { round: round.mark, servedDuringLoad, roundRequests: requests.filter(row => row.mark === round.mark).map(row => `${row.status} ${row.path}`).slice(0, 40) });
      criticalResults.push({ round: round.mark, servedDuringLoad, served, seed: state.seed, direct });
    }

    // ---- 6. 反例：缓存里没有那份关键资源时，503 必须照旧失败 ----
    // 否则"回落缓存"这条断言就成了吞异常的自证循环。
    mark = "control-missing-cache";
    failPaths = new Set(["/deck-data.js"]);
    await page.evaluate(async ({ cacheName, resource }) => {
      const cache = await caches.open(cacheName);
      await cache.delete(resource);
    }, { cacheName: CURRENT_CACHE, resource: deckSrc });
    pageErrors.length = 0;
    await page.reload({ waitUntil: "load" });
    const controlBooted = await waitForApp(page, 8000).then(() => true).catch(() => false);
    const controlState = await corpusState(page);
    check(!controlBooted && controlState.seed === -1 && pageErrors.some(message => /SEED is not defined/.test(message)),
      "With no cached corpus a 503 must still surface as a real failure", { controlBooted, controlState, pageErrors });

    // ---- 7. 服务恢复后重新填回缓存 ----
    mark = "recovered";
    failPaths = new Set();
    await page.reload({ waitUntil: "load" });
    await waitForApp(page);
    const recovered = await corpusState(page);
    const recoveredDeck = await cacheDigest(page, CURRENT_CACHE, deckSrc);
    check(recovered.seed === CURRENT_SEED_CHARS && recoveredDeck.present && recoveredDeck.sha256 === DECK_SHA256,
      "Recovering the origin must repopulate the corpus cache", { recovered, recoveredDeck });

    const strayFallbacks = [...legacyFallbacks].filter(file => !file.startsWith("data/"));
    check(strayFallbacks.length === 0,
      "The legacy generation served non-data assets from the current tree", { strayFallbacks });

    report.status = "PASS";
    report.legacy = { commit: LEGACY_COMMIT, cache: LEGACY_CACHE, seed: legacy.seed, unique: legacy.unique };
    report.failed_upgrade = { terminal: failedLifecycle.terminal, cacheState: failedCacheState, offline };
    report.upgrade = `${LEGACY_CACHE} -> ${CURRENT_CACHE}`;
    report.current = { build, deckSrc, deckSha256: DECK_SHA256, seed: upgraded.seed, unique: upgraded.unique, libraries: upgraded.libraries };
    report.critical_503 = criticalResults;
    report.control_missing_cache = { booted: controlBooted, seed: controlState.seed };
    report.legacy_data_from_working_copy = [...legacyFallbacks].length;
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
