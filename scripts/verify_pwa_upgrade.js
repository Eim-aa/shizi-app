#!/usr/bin/env node
"use strict";

const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const htmlSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const workerSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const build = htmlSource.match(/<meta name="shizi-asset-build" content="([^"]+)">/)?.[1];
const deckSrc = htmlSource.match(/<script src="(deck-data\.js\?v=[^"]+)"><\/script>/)?.[1];

function check(value, message, details) {
  if (!value) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
}

function findChromeExecutable() {
  return [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find(candidate => candidate && fs.existsSync(candidate));
}

function fileSha256(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relativePath))).digest("hex");
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

check(build && deckSrc, "Production HTML must expose a fingerprinted corpus build");
check(workerSource.includes(`const BUILD = '${build}'`) && workerSource.includes(`'${deckSrc}'`),
  "Production HTML and service worker must pin the same corpus build", { build, deckSrc });
check(fingerprintedPath(htmlSource, /<script src="(deck-data\.js)\?v=([a-f0-9]+)"><\/script>/, "deck-data") === deckSrc,
  "Production HTML deck fingerprint disagrees with its parsed script source");
fingerprintedPath(htmlSource, /<script src="(data\/context-overrides\.js)\?v=([a-f0-9]+)"><\/script>/, "context overrides");
fingerprintedPath(workerSource, /importScripts\('\.\/(core-strokes\.js)\?v=([a-f0-9]+)'\)/, "core strokes");

const legacyHtml = `<!doctype html><meta charset="utf-8"><div id="state"></div>
<script src="deck-data.js"></script><script>
state.textContent=window.CORPUS;
navigator.serviceWorker.register("sw.js");
</script>`;
const legacyWorker = `
const CACHE="shizi-v10";
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(["./","index.html","deck-data.js"])).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("fetch",event=>{ if(event.request.method==="GET") event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request))); });
`;
const currentHtml = `<!doctype html><meta charset="utf-8"><meta name="shizi-asset-build" content="${build}">
<div id="state"></div><script src="${deckSrc}"></script><script>
state.textContent=window.CORPUS;
navigator.serviceWorker.register("sw.js");
</script>`;

let generation = "legacy";
let failShellPath = "";
let workerRevision = 0;
const requests = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  requests.push({ generation, path: url.pathname + url.search, cacheControl: request.headers["cache-control"] || "", pragma: request.headers.pragma || "" });
  response.setHeader("Cache-Control", "public, max-age=31536000");
  if (url.pathname === "/sw.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(generation === "legacy" ? legacyWorker : `${workerSource}\n// upgrade-fixture-revision:${workerRevision}\n`);
    return;
  }
  if (generation === "current" && failShellPath && url.pathname === failShellPath) {
    response.statusCode = 503;
    response.end("upgrade fixture failure");
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    response.setHeader("Content-Type", "text/html");
    response.end(generation === "legacy" ? legacyHtml : currentHtml);
    return;
  }
  if (url.pathname === "/deck-data.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(`window.CORPUS="${generation === "legacy" ? "old-6854" : "new-7294"}";`);
    return;
  }
  if (url.pathname === "/core-strokes.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end("self.SHIZI_CORE_STROKES=[];");
    return;
  }
  if (url.pathname.endsWith(".js")) {
    response.setHeader("Content-Type", "application/javascript");
    response.end("");
    return;
  }
  if (url.pathname.endsWith(".json") || url.pathname.endsWith(".webmanifest")) {
    response.setHeader("Content-Type", "application/json");
    response.end("{}");
    return;
  }
  response.end("asset");
});

async function main() {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = findChromeExecutable();
  check(executablePath, "No Chrome or Chromium executable is available");
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const context = await browser.newContext({ serviceWorkers: "allow" });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await page.reload({ waitUntil: "networkidle" });
    check(await page.locator("#state").textContent() === "old-6854", "Legacy worker fixture did not hold the old corpus");

    generation = "current";
    failShellPath = "/fsrs6.min.js";
    workerRevision = 1;
    const failedLifecycle = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const states = [];
      const terminal = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("failed upgrade did not reach a terminal state")), 15000);
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
      return { terminal: await terminal, states, active: registration.active?.state || "" };
    });
    check(failedLifecycle.terminal === "redundant", "A 503 shell response must reject the new worker installation", failedLifecycle);
    const failedCacheState = await page.evaluate(async expectedBuild => {
      const names = await caches.keys();
      const rows = [];
      for (const name of names) {
        const cache = await caches.open(name);
        rows.push({ name, entries: (await cache.keys()).length });
      }
      return { names, rows, current: rows.find(row => row.name === `shizi-v13-${expectedBuild}`) || null };
    }, build);
    check(await page.locator("#state").textContent() === "old-6854",
      "A failed update must leave the legacy page and corpus intact", failedLifecycle);
    check(failedCacheState.names.includes("shizi-v10") && (!failedCacheState.current || failedCacheState.current.entries === 0),
      "A failed shell install exposed a partially populated current cache", failedCacheState);
    check(requests.some(row => row.generation === "current" && row.path === failShellPath),
      "The failed-upgrade fixture did not exercise the 503 shell response");
    await page.reload({ waitUntil: "networkidle" });
    check(await page.locator("#state").textContent() === "old-6854",
      "An ordinary reload after a failed update mixed current resources into the legacy cache");

    failShellPath = "";
    workerRevision = 2;
    const upgradedNavigation = page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
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
          new Promise(resolve => setTimeout(resolve, 15000)),
        ]);
      }
      return {
        states,
        installing: registration.installing?.state || "",
        waiting: registration.waiting?.state || "",
        active: registration.active?.state || "",
      };
    }).catch(error => ({ contextChanged: true, error: error.message }));
    const [lifecycle, navigation] = await Promise.all([updateRequest, upgradedNavigation]);
    check(navigation.navigated, "Activated worker did not navigate the legacy client", {
      lifecycle,
      navigation,
      currentRequests: requests.filter(row => row.generation === "current").slice(-20),
    });
    const upgradedPage = await page.evaluate(() => ({
      build: document.querySelector('meta[name="shizi-asset-build"]')?.content || "",
      corpus: document.querySelector("#state")?.textContent || "",
    }));
    check(upgradedPage.build === build && upgradedPage.corpus === "new-7294",
      "Activated worker did not atomically navigate to the current HTML and corpus", upgradedPage);

    const cacheState = await page.evaluate(async ({ expectedBuild, expectedDeck }) => {
      const names = await caches.keys();
      const current = names.find(name => name === `shizi-v13-${expectedBuild}`);
      const cache = current ? await caches.open(current) : null;
      const deck = cache ? await cache.match(expectedDeck) : null;
      return { names, current, deckText: deck ? await deck.text() : "" };
    }, { expectedBuild: build, expectedDeck: deckSrc });
    check(cacheState.names.length === 1 && cacheState.current && cacheState.deckText.includes("new-7294"),
      "Activated cache must contain only the fingerprinted current corpus", cacheState);

    await page.reload({ waitUntil: "networkidle" });
    check(await page.locator("#state").textContent() === "new-7294", "Ordinary reload regressed to the legacy corpus");
    const freshDeckRequest = requests.find(row => row.generation === "current" && row.path === `/${deckSrc}`);
    check(freshDeckRequest && (/no-cache/i.test(freshDeckRequest.cacheControl) || /no-cache/i.test(freshDeckRequest.pragma)),
      "Worker installation did not bypass the browser HTTP cache for the corpus", freshDeckRequest);
    process.stdout.write(JSON.stringify({
      status: "PASS",
      failed_upgrade: { terminal: failedLifecycle.terminal, cacheState: failedCacheState },
      upgrade: "shizi-v10 -> " + cacheState.current,
      deckSrc,
      cacheState,
    }, null, 2) + "\n");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
