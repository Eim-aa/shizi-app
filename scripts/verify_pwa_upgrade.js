#!/usr/bin/env node
"use strict";

// PWA 升级与版本一致性门禁（M5-1 重写；01-架构设计 §8.3 / §11 第 1 层）。在 verify:web、CI web job 与 iOS verify-local.sh 里运行。
//
// 两代真实旧 PWA 回放到 v14（LEGACY_GENERATIONS = [v10, v13]），外加 v14 自身的 BUILD A → B：
//   预检   只读生成物：sw-manifest.js（build / shell / bestEffort / coreStrokes）、src/build-info.js、index.html 的
//          meta[shizi-asset-build] 与 <script defer src="…?v=…">；三处 BUILD 相同、?v= 等于文件内容指纹、清单里每项都存在、
//          生成物新鲜（build_shell_manifest.mjs --check）。
//   每一代（v10 / v13）在一个全新浏览器 context 里：
//     1. 真实旧 App（从 LEGACY_COMMIT 逐字节回放，SHA-256 钉死，与 scripts/fixtures/pwa-legacy-<gen>/ 冻结副本一致）装好并接管；
//     2. v14 安装时核心壳一项 503 → 新 worker redundant，不留半成品缓存；
//     3. 断网刷新：旧缓存仍是一套完整自洽的旧 App；
//     4. 恢复后升级：v14 激活，旧页面**不被强刷**（旧页面不认「有新版本」消息，v14 也不再 client.navigate），
//        worker 应答 hello 报出新 BUILD；新缓存逐字节持有 deck；安装请求绕过 HTTP 缓存；旧缓存保留到窗口刷新；
//     5. 用户刷新 → 整页是 v14：meta、build-info.js、data-shizi-ready 同一 BUILD，经典脚本全局（SEED / CONTEXT_OVERRIDES /
//        SHIZI_CORE_STROKES / SHIZI_STROKE_DATA）齐全、四库数字正确；旧缓存随即删除，只剩 shizi-v14-<BUILD>；
//     6. 已激活 v14 遇 deck / 语境覆盖 / core-strokes 503 → 回落本版缓存（页面照常启动、直接 fetch 拿到缓存字节）；
//        入口 HTML 503 → 导航根本不走网络（同版本缓存）；
//     7. 反例：缓存里删掉 deck 后 503 必须真失败（SEED 不存在），证明回落不是吞异常的自证循环；
//     8. 服务恢复后重新填回缓存。
//   v14 BUILD A → B（服务端改 sw-manifest.js / index.html / build-info.js 里的 BUILD）：
//     9.  非写字页：收到「有新版本」立即自动刷新，刷新后 meta 与 build-info.js 都是 B、只剩 B 的缓存；
//     10. 写字页：收到后不刷新（页面不导航、仍在写字页、data-shizi-update=pending），点返回离开写字页后自动刷新到 B。
//   11. 启动 BUILD 比对：HTML meta 与 build-info.js 不一致（无 worker）→ 带防循环标记只 reload 一次，之后标记不一致；恢复一致后标记清除。
//
// 探针不依赖 window.__shiziTest：读经典脚本全局、meta、<html data-shizi-ready> / data-shizi-update / data-shizi-build-mismatch
// 只读标记、import('/src/build-info.js')（经 worker 取，正好验证同版本）。
//
// 旧一代的 git 回放：需要本地有（或能按 SHA 从 origin 取到）两个 LEGACY_COMMIT；取不到直接失败，不静默跳过。
// verifyUnicodeLegacyReplay 每次真建 depth-1 克隆，验证中文路径的 data 漂移能被发现并逐字节回放。

const fs = require("fs");
const os = require("os");
const vm = require("vm");
const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "scripts", "fixtures");

const GENERATIONS = {
  // main 上真实的 v10 一代（PR #153 合并后的 main）。
  v10: {
    commit: "4d6e8e59d499e968c398ce662aff69eaff714f9d",
    files: ["sw.js", "core-strokes.js", "index.html", "deck-data.js",
      "hanzi-writer.min.js", "fsrs6.min.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"],
    sha256: {
      "sw.js": "f545da4108ebaeb68b1ed0a11666a8ac127c3a8d7c06ee779f9d0225877d0d70",
      "core-strokes.js": "9396de0433dd03e642c6c71224ec731faef4c843aac0ffc6b6b9c54ff16e02ee",
      "index.html": "723666c3da3aeefaff487d17df0e2f41cc3d7252849edc531b0e9fbbb1b8fd2b",
      "deck-data.js": "972e20a9d30f627b69acd1df1021d14a2a529fd6bdf911d342449d385bd03e97",
    },
    fixtureDir: path.join(FIXTURES, "pwa-legacy-v10"),
    cache: "shizi-v10",
    seed: 6854,
    isWorker: source => /网络优先/.test(source) && source.includes("const VERSION = 'shizi-v10'"),
  },
  // main 639f592：第十稿切出前线上的 v13 一代。
  v13: {
    commit: "639f5921779fb28f8275e68efc84fd0c53b1ffce",
    files: ["sw.js", "core-strokes.js", "index.html", "deck-data.js", "hanzi-writer.min.js", "fsrs6.min.js",
      "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "icon-512-maskable.png"],
    sha256: {
      "sw.js": "c568182102adafc4397e5833bd74c2edaa421096f279c79300b7ad03003e9c22",
      "core-strokes.js": "13f7db4fa836bbee9876537e003247d35e8a7dd4a33ceb4e16b14b954572abcf",
      "index.html": "d97888b285655f9f8f49eac9c913672c45e39774721d1293995329a8a5bd6e45",
      "deck-data.js": "3ac0637e30ecf187e5a979b6e5f3212760b23aabed03928ee33b31a8d82c1b81",
    },
    fixtureDir: path.join(FIXTURES, "pwa-legacy-v13"),
    cache: "shizi-v13-8105-3ac0637e30ec-icon-red-hand-20260928",
    seed: 7294,
    isWorker: source => source.includes("const VERSION = `shizi-v13-${BUILD}`") && source.includes("client.navigate(client.url)"),
  },
};
const LEGACY_GENERATIONS = ["v10", "v13"];
// 冻结副本：让"被回放的旧缓存策略"在代码评审里可见。
const FROZEN_FIXTURES = ["sw.js", "core-strokes.js"];
const CURRENT_SEED_CHARS = 7294;
const EXPECTED_LIBRARIES = [
  { id: "core3500", total: 3500 },
  { id: "adv3000", total: 2976 },
  { id: "rare", total: 818 },
  { id: "curriculum2500", total: 2500 },
];

function check(value, message, details) {
  if (!value) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
}

function note(message) {
  process.stdout.write(`[pwa-upgrade] ${message}\n`);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileSha256(relativePath) {
  return sha256(fs.readFileSync(path.join(ROOT, relativePath)));
}

// ------------------------------------------------------------------ 预检：只读生成物

const htmlSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const workerSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const manifestSource = fs.readFileSync(path.join(ROOT, "sw-manifest.js"), "utf8");
const buildInfoSource = fs.readFileSync(path.join(ROOT, "src", "build-info.js"), "utf8");

function readSwManifest(source) {
  const sandbox = { self: {} };
  vm.runInNewContext(source, sandbox, { filename: "sw-manifest.js" });
  return sandbox.self.SHIZI_SW_MANIFEST;
}

const SW_MANIFEST = readSwManifest(manifestSource);
const BUILD = buildInfoSource.match(/export const BUILD = '([^']+)'/)?.[1];
const META_BUILD = htmlSource.match(/<meta name="shizi-asset-build" content="([^"]+)">/)?.[1];
const DEFER_SCRIPTS = [...htmlSource.matchAll(/<script defer src="([^"?]+)\?v=([0-9a-f]+)"><\/script>/g)]
  .map(m => ({ file: m[1], v: m[2], src: `${m[1]}?v=${m[2]}` }));

function preflight() {
  check(SW_MANIFEST && typeof SW_MANIFEST.build === "string" && Array.isArray(SW_MANIFEST.shell)
    && Array.isArray(SW_MANIFEST.bestEffort) && Array.isArray(SW_MANIFEST.coreStrokes),
  "sw-manifest.js must define self.SHIZI_SW_MANIFEST {build, shell, bestEffort, coreStrokes}");
  check(/^\d{8}-[0-9a-f]{12}$/.test(BUILD || ""), "src/build-info.js BUILD must be <yyyymmdd>-<12 hex>", { BUILD });
  check(BUILD === META_BUILD && BUILD === SW_MANIFEST.build,
    "index.html meta, src/build-info.js and sw-manifest.js must carry the same BUILD", { BUILD, META_BUILD, sw: SW_MANIFEST.build });
  check(workerSource.includes("importScripts('./sw-manifest.js')") && workerSource.includes("const VERSION = `shizi-v14-${BUILD}`"),
    "sw.js must be the v14 worker reading sw-manifest.js");
  for (const file of ["core-strokes.js", "deck-data.js", "data/context-overrides.js"]) {
    const tag = DEFER_SCRIPTS.find(row => row.file === file);
    check(tag, `index.html must load ${file} as a fingerprinted <script defer>`, { DEFER_SCRIPTS });
    check(fileSha256(file).startsWith(tag.v), `${file} ?v= must match the file content`, { tag, sha256: fileSha256(file) });
    check(SW_MANIFEST.shell.includes(tag.src) || SW_MANIFEST.bestEffort.includes(tag.src),
      `sw-manifest.js must precache ${tag.src}`);
  }
  const missing = [...SW_MANIFEST.shell, ...SW_MANIFEST.bestEffort].map(p => p.split("?")[0]).filter(p => !fs.existsSync(path.join(ROOT, p)));
  check(missing.length === 0, "every sw-manifest.js entry must exist", missing.slice(0, 10));
  check(["index.html", "src/app.js", "src/build-info.js", "vendor/ui.js"].every(p => SW_MANIFEST.shell.includes(p)),
    "the atomic shell must hold index.html, src/app.js, src/build-info.js and vendor/ui.js");
  check(SW_MANIFEST.coreStrokes.length === 600, "sw-manifest.js must list the 600 core stroke characters");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "build_shell_manifest.mjs"), "--check"], { stdio: "pipe" });
  } catch (error) {
    throw new Error(`Generated shell files are stale (run pnpm run build:manifest): ${String(error.stderr || error.message).trim()}`);
  }
  note(`preflight: BUILD ${BUILD}, shell ${SW_MANIFEST.shell.length}, best-effort ${SW_MANIFEST.bestEffort.length}`);
}

preflight();

const DECK_SRC = DEFER_SCRIPTS.find(row => row.file === "deck-data.js").src;
const OVERRIDES_SRC = DEFER_SCRIPTS.find(row => row.file === "data/context-overrides.js").src;
const CORE_SRC = DEFER_SCRIPTS.find(row => row.file === "core-strokes.js").src;
const DECK_SHA256 = fileSha256("deck-data.js");
const OVERRIDES_SHA256 = fileSha256("data/context-overrides.js");
const CORE_SHA256 = fileSha256("core-strokes.js");
const CURRENT_CACHE = `shizi-v14-${BUILD}`;
// v14 的下一版：只换 BUILD（sw-manifest.js / index.html meta / build-info.js），其余字节相同。
const NEXT_BUILD = `${BUILD.slice(0, 8)}-${sha256(`next:${BUILD}`).slice(0, 12)}`;
const NEXT_CACHE = `shizi-v14-${NEXT_BUILD}`;
const NEXT_FILES = new Set(["sw-manifest.js", "index.html", "src/build-info.js"]);

// ------------------------------------------------------------------ git 回放

function gitIn(repoRoot, args, options = {}) {
  return execFileSync("git", ["-C", repoRoot, ...args], { maxBuffer: 64 * 1024 * 1024, ...options });
}

function nulTerminatedPaths(output, label) {
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output || "");
  check(bytes.length === 0 || bytes[bytes.length - 1] === 0, `${label} did not return NUL-terminated paths`);
  return bytes.toString("utf8").split("\0").filter(Boolean);
}

function driftedLegacyDataPaths(commit, repoRoot = ROOT) {
  // 不得用默认的逐行输出：core.quotePath=true 会把中文路径变成带引号的 C 转义串，
  // 这个显示串不能再交给 cat-file 当真实路径。-z 同时安全覆盖中文、空格和换行。
  return nulTerminatedPaths(gitIn(repoRoot, ["diff", "--name-only", "-z", commit, "--", "data/"]), "git diff --name-only -z");
}

function legacyDataPaths(commit, repoRoot = ROOT) {
  return new Set(nulTerminatedPaths(gitIn(repoRoot, ["ls-tree", "-r", "--name-only", "-z", commit, "--", "data/"]),
    "git ls-tree --name-only -z"));
}

function refsSnapshot(repoRoot) {
  return gitIn(repoRoot, ["for-each-ref", "--format=%(refname)%00%(objectname)%00"]);
}

function gitFileSnapshot(repoRoot, name) {
  const rawPath = gitIn(repoRoot, ["rev-parse", "--git-path", name], { encoding: "utf8" }).trim();
  const file = path.isAbsolute(rawPath) ? rawPath : path.resolve(repoRoot, rawPath);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function equalOptionalBuffers(left, right) {
  return left === null ? right === null : right !== null && left.equals(right);
}

function hasCommit(commit, repoRoot = ROOT) {
  try {
    gitIn(repoRoot, ["cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
}

function ensureLegacyCommit(commit, repoRoot = ROOT) {
  if (!hasCommit(commit, repoRoot)) {
    // 浅克隆（CI 默认 fetch-depth: 1）里没有这个 commit。先按 SHA 单独取一次，取不到就直接失败——绝不静默跳过。
    note(`legacy commit not present locally, fetching ${commit.slice(0, 12)}`);
    const refsBefore = refsSnapshot(repoRoot);
    const fetchHeadBefore = gitFileSnapshot(repoRoot, "FETCH_HEAD");
    try {
      // 只取对象，不写 FETCH_HEAD，也不为验证脚本制造持久 ref。
      gitIn(repoRoot, ["fetch", "--no-write-fetch-head", "--no-tags", "--depth=1", "origin", commit], { stdio: "ignore" });
    } catch (error) {
      // 忽略：下面统一判定
    }
    check(refsSnapshot(repoRoot).equals(refsBefore), "Fetching the legacy object must not create or mutate repository refs");
    check(equalOptionalBuffers(gitFileSnapshot(repoRoot, "FETCH_HEAD"), fetchHeadBefore),
      "Fetching the legacy object must not overwrite FETCH_HEAD");
  }
  if (!hasCommit(commit, repoRoot)) {
    throw new Error(`This gate replays real legacy generations and needs commit ${commit}. `
      + `Fetch it (git fetch --depth=1 origin ${commit}) or check out with fetch-depth: 0.`);
  }
}

// 旧一代的 data/ 默认用当前工作区提供，但先证明它逐字节相同（跟「工作区」比，不是跟 HEAD 比）。
// 漂移的文件从旧 commit 取回单独提供。
function materializeDriftedLegacyData(dir, commit, repoRoot = ROOT, emitNote = true) {
  const drifted = driftedLegacyDataPaths(commit, repoRoot);
  const existedInLegacy = legacyDataPaths(commit, repoRoot);
  const restored = [], newOnly = [];
  for (const file of drifted) {
    if (!existedInLegacy.has(file)) { newOnly.push(file); continue; } // 旧 App 不会请求后来新增的文件
    // 路径已由 ls-tree 证明在旧提交中存在；此后 cat-file 失败是仓库/对象错误，必须让门禁红。
    const bytes = gitIn(repoRoot, ["cat-file", "blob", `${commit}:${file}`]);
    const target = path.join(dir, file);
    check(target.startsWith(dir + path.sep), "Refusing to materialize a data path outside the legacy tree", { file });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    check(fs.readFileSync(target).equals(bytes), "Legacy data replay was not written byte-for-byte", { file });
    restored.push(file);
  }
  const expected = drifted.filter(file => existedInLegacy.has(file));
  check(restored.length === expected.length && restored.every((file, index) => file === expected[index]),
    "Not every drifted data file that existed in legacy was replayed", { expected: expected.length, restored: restored.length });
  if (emitNote) note(`legacy ${commit.slice(0, 12)} data/: ${restored.length} drifted file(s) replayed`
    + (restored.length ? ` (${restored.slice(0, 5).join(", ")}${restored.length > 5 ? ", …" : ""})` : ""));
  return { drifted, restored, newOnly, existedInLegacy };
}

// 负向自测：真的让一个旧提交中存在的中文文件发生工作区漂移（真 depth-1 克隆，按 SHA 无 ref 取回 legacy 对象）。
function verifyUnicodeLegacyReplay(commit) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "shizi-pwa-unicode-replay-"));
  const repo = path.join(sandbox, "repo"), replayDir = path.join(sandbox, "legacy");
  const file = "data/水.json";
  try {
    gitIn(ROOT, ["clone", "--no-local", "--depth=1", "--no-tags", "--origin=origin", "--quiet", ROOT, repo]);
    const shallow = gitIn(repo, ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim();
    check(shallow === "true", "Unicode replay control must use an actual depth-1 clone", { shallow });
    check(!hasCommit(commit, repo), "Depth-1 control unexpectedly inherited the pinned legacy commit");
    ensureLegacyCommit(commit, repo);
    gitIn(repo, ["config", "core.quotePath", "true"]);
    const current = fs.readFileSync(path.join(repo, file));
    fs.writeFileSync(path.join(repo, file), Buffer.concat([current, Buffer.from("\n ")]));
    const drifted = driftedLegacyDataPaths(commit, repo);
    check(drifted.includes(file), "Unicode mutation control was not discovered as its raw path", { file, drifted: drifted.slice(0, 10) });
    const replay = materializeDriftedLegacyData(replayDir, commit, repo, false);
    const expected = gitIn(repo, ["cat-file", "blob", `${commit}:${file}`]);
    const actual = fs.readFileSync(path.join(replayDir, file));
    check(replay.restored.includes(file) && actual.equals(expected) && !actual.equals(fs.readFileSync(path.join(repo, file))),
      "Unicode mutation control did not replay the legacy blob", { file });
    note(`unicode path control: ${file} mutation discovered and replayed byte-for-byte`);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function materializeLegacyTree(id) {
  const gen = GENERATIONS[id];
  ensureLegacyCommit(gen.commit);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `shizi-pwa-legacy-${id}-`));
  for (const file of gen.files) fs.writeFileSync(path.join(dir, file), gitIn(ROOT, ["cat-file", "blob", `${gen.commit}:${file}`]));
  for (const [file, expected] of Object.entries(gen.sha256)) {
    const actual = sha256(fs.readFileSync(path.join(dir, file)));
    check(actual === expected, `Replayed ${id} ${file} does not match its pinned digest`, { file, expected, actual });
  }
  for (const file of FROZEN_FIXTURES) {
    const frozen = fs.readFileSync(path.join(gen.fixtureDir, file));
    check(frozen.equals(fs.readFileSync(path.join(dir, file))),
      `Frozen fixture ${file} drifted from the real ${id} generation it documents`,
      { fixture: path.relative(ROOT, path.join(gen.fixtureDir, file)), commit: gen.commit });
  }
  check(gen.isWorker(fs.readFileSync(path.join(dir, "sw.js"), "utf8")),
    `Replayed ${id} worker is not the generation this gate claims to exercise`);
  const dataReplay = materializeDriftedLegacyData(dir, gen.commit);
  note(`replaying real ${id} from ${gen.commit.slice(0, 12)} at ${dir}`);
  return { id, gen, dir, dataReplay, fallbacks: new Set() };
}

for (const id of LEGACY_GENERATIONS) ensureLegacyCommit(GENERATIONS[id].commit);
verifyUnicodeLegacyReplay(GENERATIONS.v10.commit);
const legacyTrees = Object.fromEntries(LEGACY_GENERATIONS.map(id => [id, materializeLegacyTree(id)]));
process.on("exit", () => {
  for (const tree of Object.values(legacyTrees)) {
    try { fs.rmSync(tree.dir, { recursive: true, force: true }); } catch (error) { /* best effort */ }
  }
});

// ------------------------------------------------------------------ 静态服务器

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// generation: {kind:'legacy', tree} | 'current' | 'next' | 'mismatch' | 'offline'
let generation = "current";
let failPaths = new Set();
let mark = "boot";
const requests = [];

function generationName() {
  return typeof generation === "string" ? generation : `legacy-${generation.tree.id}`;
}

function resolveFile(pathname) {
  const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname).replace(/^\/+/, "");
  if (!relative || relative.split("/").includes("..")) return null;
  const legacy = typeof generation === "object" ? generation.tree : null;
  const roots = legacy ? [legacy.dir, ROOT] : [ROOT];
  for (const base of roots) {
    const file = path.join(base, relative);
    if (!file.startsWith(base + path.sep)) continue;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      if (legacy && base === ROOT) legacy.fallbacks.add(relative);
      return { file, relative };
    }
  }
  return null;
}

function bodyFor({ file, relative }) {
  const bytes = fs.readFileSync(file);
  if (generation === "next" && NEXT_FILES.has(relative)) return Buffer.from(bytes.toString("utf8").split(BUILD).join(NEXT_BUILD));
  if (generation === "mismatch" && relative === "index.html") return Buffer.from(bytes.toString("utf8").split(BUILD).join(NEXT_BUILD));
  return bytes;
}

const server = http.createServer((request, response) => {
  if (generation === "offline") {
    // 真断网：让 fetch() 在网络层 reject，跟 503（resolve 出一个错误响应）区分开。
    requests.push({ mark, generation: "offline", path: request.url, pathname: request.url.split("?")[0], status: "offline" });
    request.socket.destroy();
    return;
  }
  const url = new URL(request.url, "http://127.0.0.1");
  const record = {
    mark,
    generation: generationName(),
    path: url.pathname + url.search,
    pathname: url.pathname,
    cacheControl: request.headers["cache-control"] || "",
    pragma: request.headers.pragma || "",
    status: 200,
  };
  requests.push(record);
  response.setHeader("Cache-Control", "public, max-age=31536000");
  if (failPaths.has(url.pathname)) {
    record.status = 503;
    response.statusCode = 503;
    response.setHeader("Content-Type", MIME[".txt"]);
    response.end("upgrade fixture failure");
    return;
  }
  const found = resolveFile(url.pathname);
  if (!found) {
    record.status = 404;
    response.statusCode = 404;
    response.end("not found");
    return;
  }
  response.setHeader("Content-Type", MIME[path.extname(found.file)] || "application/octet-stream");
  response.end(bodyFor(found));
});

// ------------------------------------------------------------------ 页面探针（不依赖 __shiziTest）

// 旧一代 index.html 的内联脚本一旦抛错，后面的 const 会停在 TDZ，typeof 也会抛，所以探针都包一层。
const LEGACY_READY = () => { try { return typeof CARDS !== "undefined" && Array.isArray(CARDS) && CARDS.length > 0; } catch (error) { return false; } };
const V14_READY = () => document.documentElement.hasAttribute("data-shizi-ready") && !!document.querySelector(".sz-app");

async function legacyState(page) {
  return page.evaluate(async () => {
    const probe = (read, fallback) => { try { const value = read(); return value === undefined ? fallback : value; } catch (error) { return fallback; } };
    return {
      seed: probe(() => SEED.length, -1),
      unique: probe(() => new Set(SEED.map(row => row.target)).size, -1),
      cards: probe(() => CARDS.length, -1),
      build: document.querySelector('meta[name="shizi-asset-build"]')?.content || "",
      ready: document.documentElement.getAttribute("data-shizi-ready") || "",
      startButton: !!document.getElementById("startBtn"),
      cacheNames: await caches.keys(),
      controlled: !!navigator.serviceWorker.controller,
    };
  });
}

async function v14State(page) {
  return page.evaluate(async () => {
    const probe = (read, fallback) => { try { const value = read(); return value === undefined ? fallback : value; } catch (error) { return fallback; } };
    let buildInfo = "";
    try { buildInfo = (await import("/src/build-info.js")).BUILD; } catch (error) { buildInfo = `error:${error.message}`; }
    let libraries = [];
    try {
      const { LIBRARIES } = await import("/src/core/cards.js");
      libraries = LIBRARIES.map(lib => ({ id: lib.id, total: new Set(SEED.filter(row => lib.test(row)).map(row => row.target)).size }));
    } catch (error) {
      libraries = [];
    }
    const root = document.documentElement;
    return {
      seed: probe(() => SEED.length, -1),
      unique: probe(() => new Set(SEED.map(row => row.target)).size, -1),
      overrides: probe(() => Object.keys(CONTEXT_OVERRIDES).length, -1),
      coreStrokes: probe(() => self.SHIZI_CORE_STROKES.length, -1),
      embedded: probe(() => Object.keys(self.SHIZI_STROKE_DATA).length, -1),
      meta: document.querySelector('meta[name="shizi-asset-build"]')?.content || "",
      buildInfo,
      ready: root.getAttribute("data-shizi-ready") || "",
      update: root.getAttribute("data-shizi-update") || "",
      mismatch: root.getAttribute("data-shizi-build-mismatch") || "",
      topScreen: document.querySelector(".sz-app")?.getAttribute("data-top-screen") || "",
      alive: window.__pwaAlive || "",
      libraries,
      cacheNames: (await caches.keys()).sort(),
      controlled: !!navigator.serviceWorker.controller,
    };
  });
}

// worker 当前 BUILD：页面 hello，worker 以 shizi-sw-version 应答。
async function workerBuild(page) {
  return page.evaluate(() => new Promise(resolve => {
    const container = navigator.serviceWorker;
    if (!container.controller) { resolve(""); return; }
    const timer = setTimeout(() => resolve("timeout"), 5000);
    container.addEventListener("message", function onMessage(event) {
      if (event.data && event.data.type === "shizi-sw-version") {
        clearTimeout(timer);
        container.removeEventListener("message", onMessage);
        resolve(event.data.build);
      }
    });
    container.controller.postMessage({ type: "shizi-hello", build: "probe" });
  }));
}

async function cacheDigest(page, cacheName, resource) {
  return page.evaluate(async ({ cacheName: name, resource: url }) => {
    if (!(await caches.has(name))) return { present: false, sha256: "" };
    const hit = await (await caches.open(name)).match(url);
    if (!hit) return { present: false, sha256: "" };
    const digest = await crypto.subtle.digest("SHA-256", await hit.arrayBuffer());
    return { present: true, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("") };
  }, { cacheName, resource });
}

async function cacheEntries(page) {
  return page.evaluate(async () => {
    const entries = {};
    for (const name of await caches.keys()) entries[name] = (await (await caches.open(name)).keys()).length;
    return entries;
  });
}

async function waitForCaches(page, expected, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let names = [];
  while (Date.now() < deadline) {
    names = (await page.evaluate(() => caches.keys())).sort();
    if (JSON.stringify(names) === JSON.stringify([...expected].sort())) return names;
    await page.waitForTimeout(250);
  }
  return names;
}

function servedStatus(roundMark, pathname) {
  return requests.filter(row => row.mark === roundMark && row.pathname === pathname).map(row => row.status);
}

function roundRequests(roundMark) {
  return requests.filter(row => row.mark === roundMark).map(row => `${row.status} ${row.path}`).slice(0, 40);
}

// 触发一次 worker 更新检查并等新 worker 到达终态（activated / redundant）。页面可能在等待中被刷新：返回 {contextChanged}。
async function updateAndSettle(page, timeout = 90000) {
  return page.evaluate(async ms => {
    const registration = await navigator.serviceWorker.getRegistration();
    const states = [];
    const terminal = new Promise(resolve => {
      const timer = setTimeout(() => resolve("timeout"), ms);
      const observe = worker => {
        if (!worker) return;
        const record = () => {
          states.push(worker.state);
          if (["activated", "redundant"].includes(worker.state)) { clearTimeout(timer); resolve(worker.state); }
        };
        record();
        worker.addEventListener("statechange", record);
      };
      registration.addEventListener("updatefound", () => observe(registration.installing), { once: true });
    });
    await registration.update();
    const installing = registration.installing || registration.waiting;
    if (!installing && states.length === 0) return { terminal: "no-update", states };
    return { terminal: await terminal, states };
  }, timeout).catch(error => ({ contextChanged: true, error: error.message }));
}

// ------------------------------------------------------------------ 场景

async function newPage(browser, options = {}) {
  const context = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 393, height: 852 }, locale: "zh-CN", ...options });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(String(error.message || error)));
  return { context, page, pageErrors };
}

async function installV14(page, url = "/") {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(V14_READY, null, { timeout: 60000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 120000 });
}

async function replayLegacy(browser, origin, tree, report) {
  const { gen, id } = tree;
  const { context, page, pageErrors } = await newPage(browser);
  const out = { commit: gen.commit, cache: gen.cache };
  try {
    // ---- 1. 真实旧一代装好并接管 ----
    mark = `${id}-install`;
    generation = { kind: "legacy", tree };
    failPaths = new Set();
    await page.goto(origin, { waitUntil: "load" });
    await page.waitForFunction(LEGACY_READY, null, { timeout: 60000 });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 120000 });
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(LEGACY_READY, null, { timeout: 60000 });
    const legacy = await legacyState(page);
    check(legacy.controlled && legacy.cacheNames.length === 1 && legacy.cacheNames[0] === gen.cache,
      `Real ${id} must control the page from exactly its own cache`, legacy);
    check(legacy.seed === gen.seed && legacy.unique === gen.seed, `Real ${id} fixture must hold the ${gen.seed}-character corpus`, legacy);
    check(legacy.build !== BUILD && legacy.ready === "" && legacy.startButton, `Real ${id} page must be the pre-upgrade single-file app`, legacy);
    note(`real ${id} active: ${legacy.seed} seed rows, cache ${gen.cache}`);
    out.legacy = { seed: legacy.seed, unique: legacy.unique };

    // ---- 2. v14 安装失败：核心壳一项 503 → 不激活、不留半成品缓存 ----
    mark = `${id}-failed-install`;
    generation = "current";
    failPaths = new Set(["/src/app.js"]);
    const failed = await updateAndSettle(page, 60000);
    check(failed.terminal === "redundant", "A 503 core-shell response must reject the new worker installation", failed);
    check(servedStatus(mark, "/src/app.js").includes(503), "The failed-upgrade round did not actually exercise the 503 shell response",
      roundRequests(mark));
    const failedEntries = await cacheEntries(page);
    check(failedEntries[gen.cache] > 0 && Object.entries(failedEntries).every(([name, count]) => name === gen.cache || count === 0),
      "A failed shell install exposed a partially populated v14 cache", failedEntries);

    // ---- 3. 失败安装之后断网：旧缓存仍是一套完整、自洽的旧 App ----
    mark = `${id}-offline-after-failure`;
    generation = "offline";
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(LEGACY_READY, null, { timeout: 60000 });
    const offline = await legacyState(page);
    check(offline.seed === gen.seed && offline.startButton && offline.ready === "",
      "After a failed upgrade the offline cache must still serve one coherent legacy app", offline);

    // ---- 4. 恢复联网后升级：v14 激活，旧页面不被强刷，旧缓存保留到窗口刷新 ----
    mark = `${id}-upgrade`;
    generation = { kind: "legacy", tree }; // 先让旧页面在线加载一次，再换成 v14 服务端
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(LEGACY_READY, null, { timeout: 60000 });
    await page.evaluate(() => { window.__pwaAlive = "legacy"; });
    generation = "current";
    failPaths = new Set();
    let navigated = false;
    const onNav = frame => { if (frame === page.mainFrame()) navigated = true; };
    page.on("framenavigated", onNav);
    const upgrade = await updateAndSettle(page);
    await page.waitForTimeout(1500);
    page.off("framenavigated", onNav);
    check(upgrade.terminal === "activated", "The v14 worker must install and activate over the legacy one", upgrade);
    check(!navigated && (await page.evaluate(() => window.__pwaAlive)) === "legacy",
      "v14 must not force-navigate a legacy page (it cannot hear the new-version message)", { navigated });
    check(await workerBuild(page) === BUILD, "The controlling worker must answer hello with the current BUILD");
    const afterActivate = await cacheEntries(page);
    check(afterActivate[CURRENT_CACHE] > 0 && afterActivate[gen.cache] > 0,
      "Old caches must survive until the legacy window has reloaded", afterActivate);
    const cachedDeck = await cacheDigest(page, CURRENT_CACHE, DECK_SRC);
    check(cachedDeck.present && cachedDeck.sha256 === DECK_SHA256,
      "The activated cache must hold the real production corpus byte-for-byte", { cachedDeck, expected: DECK_SHA256 });
    const freshDeck = requests.find(row => row.mark === mark && row.path === `/${DECK_SRC}`);
    check(freshDeck && (/no-cache/i.test(freshDeck.cacheControl) || /no-cache/i.test(freshDeck.pragma)),
      "Worker installation did not bypass the browser HTTP cache for the corpus", freshDeck);

    // ---- 5. 用户刷新 → 整页 v14；旧缓存随即删除 ----
    mark = `${id}-reload-into-v14`;
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(V14_READY, null, { timeout: 60000 });
    const upgraded = await v14State(page);
    check(upgraded.meta === BUILD && upgraded.buildInfo === BUILD && upgraded.ready === BUILD && !upgraded.mismatch,
      "After reload the page must be one coherent v14 build (meta, build-info.js, ready marker)", upgraded);
    check(upgraded.seed === CURRENT_SEED_CHARS && upgraded.unique === CURRENT_SEED_CHARS && upgraded.overrides > 0
      && upgraded.coreStrokes === 600 && upgraded.embedded === 5,
    "The upgraded page must expose the classic-script globals (deck, overrides, core strokes + embedded first practice)", upgraded);
    check(JSON.stringify(upgraded.libraries) === JSON.stringify(EXPECTED_LIBRARIES),
      "The upgraded app must expose the four governed libraries", { got: upgraded.libraries, want: EXPECTED_LIBRARIES });
    check(servedStatus(mark, "/").length === 0 && servedStatus(mark, "/index.html").length === 0,
      "The reload navigation must be served from the v14 cache, not the network", roundRequests(mark));
    const cleaned = await waitForCaches(page, [CURRENT_CACHE]);
    check(JSON.stringify(cleaned) === JSON.stringify([CURRENT_CACHE]), "Once every window is v14 only the current cache may remain", cleaned);
    note(`${id} → ${CURRENT_CACHE}: legacy page untouched until reload, then ${upgraded.seed} seed rows`);
    out.upgrade = `${gen.cache} -> ${CURRENT_CACHE}`;

    // ---- 6. 已激活 v14 遇到关键资源 503：回落缓存 ----
    // 关键资源带一年期 Cache-Control，Chrome 自己的 HTTP 缓存会在刷新时直接复用它、fetch handler 根本不会被调用；
    // 关掉浏览器缓存，让"页面能不能拿到内容"只由 worker 的回落逻辑决定。
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    const rounds = [
      { mark: `${id}-503-deck`, pathname: "/deck-data.js", resource: DECK_SRC, sha256: DECK_SHA256 },
      { mark: `${id}-503-overrides`, pathname: "/data/context-overrides.js", resource: OVERRIDES_SRC, sha256: OVERRIDES_SHA256 },
      { mark: `${id}-503-core-strokes`, pathname: "/core-strokes.js", resource: CORE_SRC, sha256: CORE_SHA256 },
    ];
    const critical = [];
    for (const round of rounds) {
      mark = round.mark;
      failPaths = new Set([round.pathname]);
      pageErrors.length = 0;
      await page.reload({ waitUntil: "load" });
      // 不直接 await：回落缺失时页面会卡住，裸 timeout 会把真正的失败原因藏起来。
      const booted = await page.waitForFunction(V14_READY, null, { timeout: 20000 }).then(() => true).catch(() => false);
      const state = await v14State(page);
      const servedDuringLoad = servedStatus(round.mark, round.pathname);
      const direct = await page.evaluate(async url => {
        const res = await fetch(url, { cache: "reload" });
        const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
        return { ok: res.ok, status: res.status, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("") };
      }, round.resource);
      check(state.controlled, `The ${round.mark} round must run against a controlled page`, state);
      check(booted && state.seed === CURRENT_SEED_CHARS && state.coreStrokes === 600 && state.overrides > 0 && state.ready === BUILD,
        `A ${round.pathname} 503 must fall back to the cached copy instead of reaching the page`,
        { round: round.mark, booted, state, pageErrors, servedDuringLoad });
      check(direct.ok && direct.sha256 === round.sha256, `A ${round.pathname} 503 must resolve to the cached production bytes`,
        { round: round.mark, direct, expected: round.sha256 });
      check(servedDuringLoad.includes(503), `The ${round.mark} round did not exercise the 503 on the page-load path`, roundRequests(round.mark));
      critical.push({ round: round.mark, servedDuringLoad, seed: state.seed });
    }
    // 入口 HTML：导航从本版缓存返回，503 的源站根本不会被问到。
    mark = `${id}-503-html`;
    failPaths = new Set(["/", "/index.html"]);
    await page.reload({ waitUntil: "load" });
    const htmlBooted = await page.waitForFunction(V14_READY, null, { timeout: 20000 }).then(() => true).catch(() => false);
    const htmlState = await v14State(page);
    check(htmlBooted && htmlState.ready === BUILD && htmlState.meta === BUILD && htmlState.seed === CURRENT_SEED_CHARS,
      "An origin 503 for the app entry must not affect the cached v14 navigation", htmlState);
    check(servedStatus(mark, "/").length === 0 && servedStatus(mark, "/index.html").length === 0,
      "The app-entry navigation must not hit the network (same-version cache)", roundRequests(mark));
    critical.push({ round: mark, servedDuringLoad: servedStatus(mark, "/"), seed: htmlState.seed });
    out.critical_503 = critical;

    // ---- 7. 反例：缓存里没有 deck 时，503 必须照旧失败 ----
    mark = `${id}-control-missing-cache`;
    failPaths = new Set(["/deck-data.js"]);
    await page.evaluate(async ({ cacheName, resource }) => {
      await (await caches.open(cacheName)).delete(resource);
    }, { cacheName: CURRENT_CACHE, resource: DECK_SRC });
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1500);
    const control = await v14State(page);
    check(control.seed === -1 && servedStatus(mark, "/deck-data.js").includes(503),
      "With no cached corpus a 503 must still surface as a real failure (SEED missing)", { control, served: roundRequests(mark) });
    out.control_missing_cache = { seed: control.seed };

    // ---- 8. 服务恢复后重新填回缓存 ----
    mark = `${id}-recovered`;
    failPaths = new Set();
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(V14_READY, null, { timeout: 60000 });
    const recovered = await v14State(page);
    const recoveredDeck = await cacheDigest(page, CURRENT_CACHE, DECK_SRC);
    check(recovered.seed === CURRENT_SEED_CHARS && recoveredDeck.present && recoveredDeck.sha256 === DECK_SHA256,
      "Recovering the origin must repopulate the corpus cache", { recovered, recoveredDeck });

    const strayFallbacks = [...tree.fallbacks].filter(file => !file.startsWith("data/"));
    check(strayFallbacks.length === 0, `The ${id} generation served non-data assets from the current tree`, { strayFallbacks });
    const driftedFallbacks = [...tree.fallbacks].filter(file => tree.dataReplay.drifted.includes(file));
    check(driftedFallbacks.length === 0, `A drifted data file fell back to the current working tree for ${id}`, { driftedFallbacks });
    out.legacy_data = {
      drifted: tree.dataReplay.drifted.length,
      replayed: tree.dataReplay.restored.length,
      newOnly: tree.dataReplay.newOnly.length,
      workingCopyFallbacks: [...tree.fallbacks].filter(file => file.startsWith("data/")).length,
    };
    report.legacy[id] = out;
  } finally {
    failPaths = new Set();
    await context.close();
  }
}

async function replayBuildAtoB(browser, origin, report) {
  // ---- 9. 非写字页：收到有新版本 → 立即刷新 ----
  {
    const { context, page } = await newPage(browser);
    try {
      mark = "v14-a-home";
      generation = "current";
      await installV14(page, origin);
      check(await workerBuild(page) === BUILD, "Build A worker must control the page");
      await page.evaluate(() => { window.__pwaAlive = "A"; });
      mark = "v14-b-home";
      generation = "next";
      const reloaded = page.waitForEvent("load", { timeout: 120000 }).then(() => true).catch(() => false);
      await updateAndSettle(page);
      check(await reloaded, "Receiving the new version on a non-write page must reload it automatically");
      await page.waitForFunction(V14_READY, null, { timeout: 60000 });
      const state = await v14State(page);
      check(state.alive === "" && state.meta === NEXT_BUILD && state.buildInfo === NEXT_BUILD && state.ready === NEXT_BUILD && !state.mismatch,
        "After the automatic reload index.html meta and build-info.js must both be build B", state);
      check(state.topScreen === "home", "The reloaded page stays on home", state);
      const names = await waitForCaches(page, [NEXT_CACHE]);
      check(JSON.stringify(names) === JSON.stringify([NEXT_CACHE]), "After every window reloaded only build B's cache remains", names);
      check(await workerBuild(page) === NEXT_BUILD, "Build B worker controls the reloaded page");
      report.build_a_to_b = { from: BUILD, to: NEXT_BUILD, nonWritePage: "reloaded", meta: state.meta, buildInfo: state.buildInfo };
      note(`BUILD ${BUILD} → ${NEXT_BUILD}: home page reloaded automatically, meta = build-info.js = B`);
    } finally {
      await context.close();
    }
  }
  // ---- 10. 写字页：不刷新，离开后刷新 ----
  {
    const { context, page } = await newPage(browser);
    try {
      mark = "v14-a-write";
      generation = "current";
      await installV14(page, origin);
      await page.waitForFunction(() => document.querySelector(".sz-app")?.getAttribute("data-nav-anim") === "idle");
      await page.waitForTimeout(500);
      await page.click('[data-testid="home-start"]');
      const opened = await page.waitForFunction(() => document.querySelector(".sz-app")?.getAttribute("data-top-screen") === "write",
        null, { timeout: 20000 }).then(() => true).catch(() => false);
      if (!opened) {
        await page.screenshot({ path: path.join(os.tmpdir(), "shizi-pwa-write-open.png") });
        check(false, "home-start must open the first-practice write page", await v14State(page));
      }
      await page.waitForFunction(() => document.querySelector(".sz-app")?.getAttribute("data-nav-anim") === "idle");
      await page.waitForTimeout(500);
      await page.evaluate(() => { window.__pwaAlive = "A-write"; });
      mark = "v14-b-write";
      generation = "next";
      let navigations = 0;
      const onNav = frame => { if (frame === page.mainFrame()) navigations += 1; };
      page.on("framenavigated", onNav);
      const settled = await updateAndSettle(page);
      check(settled.terminal === "activated", "Build B must activate while the write page is open", settled);
      const pending = await page.waitForFunction(() => document.documentElement.getAttribute("data-shizi-update") === "pending",
        null, { timeout: 20000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(2000);
      await page.waitForFunction(V14_READY, null, { timeout: 30000 }).catch(() => null);
      const writing = await v14State(page);
      check(pending && navigations === 0 && writing.alive === "A-write" && writing.topScreen === "write" && writing.meta === BUILD
        && writing.update === "pending",
      "The write page must not reload when the new version arrives", { pending, navigations, writing });
      check(writing.cacheNames.includes(CURRENT_CACHE) && writing.cacheNames.includes(NEXT_CACHE),
        "Build A's cache must survive while the write page (build A) is open", writing.cacheNames);
      const reloaded = page.waitForEvent("load", { timeout: 60000 }).then(() => true).catch(() => false);
      await page.click('.sz-layer[data-top="true"] [data-testid="page-back"]');
      check(await reloaded, "Leaving the write page must trigger the pending reload");
      page.off("framenavigated", onNav);
      await page.waitForFunction(V14_READY, null, { timeout: 60000 });
      const after = await v14State(page);
      check(after.alive === "" && after.meta === NEXT_BUILD && after.buildInfo === NEXT_BUILD && after.ready === NEXT_BUILD,
        "After leaving the write page the page reloads into build B", after);
      check(after.topScreen !== "write", "The reload happened after leaving the write page", after);
      const names = await waitForCaches(page, [NEXT_CACHE]);
      check(JSON.stringify(names) === JSON.stringify([NEXT_CACHE]), "Build A's cache is deleted after the write page reloaded", names);
      report.build_a_to_b.writePage = { heldWhileWriting: true, reloadedAfterLeaving: after.topScreen };
      note("write page held build A until it was left, then reloaded into build B");
    } finally {
      await context.close();
    }
  }
}

async function replayBuildMismatch(browser, origin, report) {
  // ---- 11. 启动 BUILD 比对：不一致 reload 一次（防循环），不再多刷 ----
  const { context, page } = await newPage(browser, { serviceWorkers: "block" });
  try {
    mark = "mismatch";
    generation = "mismatch";
    let loads = 0;
    page.on("load", () => { loads += 1; });
    await page.goto(origin, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-shizi-build-mismatch")
      && document.documentElement.hasAttribute("data-shizi-ready"), null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    const state = await v14State(page);
    check(loads === 2, "A BUILD mismatch must reload exactly once (anti-loop flag)", { loads, state });
    check(state.meta === NEXT_BUILD && state.buildInfo === BUILD && state.mismatch === `${NEXT_BUILD}|${BUILD}`,
      "The mismatch marker names the HTML and module builds", state);
    generation = "current";
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(V14_READY, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    const healed = await v14State(page);
    const flag = await page.evaluate(() => sessionStorage.getItem("shizi.buildReload"));
    check(loads === 3 && healed.mismatch === "" && healed.meta === BUILD && healed.buildInfo === BUILD && flag === null,
      "A consistent load clears the mismatch marker and the anti-loop flag", { loads, healed, flag });
    report.build_mismatch = { loadsWhileMismatched: 2, healed: true };
    note("BUILD mismatch reloaded once, then stopped; consistent load cleared the flag");
  } finally {
    await context.close();
  }
}

function findChromeExecutable() {
  return [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find(candidate => candidate && fs.existsSync(candidate));
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
  const report = { status: "FAIL", build: BUILD, cache: CURRENT_CACHE, legacy: {} };
  try {
    // SHIZI_PWA_ONLY=legacy|build|mismatch 只跑一段（本地排查用；门禁运行不设，报告 status 标 PARTIAL）。
    const only = process.env.SHIZI_PWA_ONLY || "";
    if (!only || only === "legacy") for (const id of LEGACY_GENERATIONS) await replayLegacy(browser, origin, legacyTrees[id], report);
    if (!only || only === "build") await replayBuildAtoB(browser, origin, report);
    if (!only || only === "mismatch") await replayBuildMismatch(browser, origin, report);
    report.status = only ? `PARTIAL(${only})` : "PASS";
    report.current = { build: BUILD, deckSrc: DECK_SRC, deckSha256: DECK_SHA256 };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
