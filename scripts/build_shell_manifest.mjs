#!/usr/bin/env node
// 壳清单与版本一致性生成器（M0-1 起；M5-1 扩展到 01-架构设计 §8.3 最终形态）。
//
// 写出下列生成物（内容不变时不重写，重复运行 git diff 为空）：
//   core-strokes.js             self.SHIZI_CORE_STROKES（600 字字表，由 scripts/build_8105_chars.py 生成，这里只读回并
//                               保证 policy.firstQueue 排在最前）+ self.SHIZI_STROKE_DATA（首练 5 字笔顺内嵌，P09；
//                               src/data/strokes.js 的内嵌钩子读它，保证第一次练习离线也有参考字形与提示）。
//                               注意：build_8105_chars.py 重写 core-strokes.js 时只写字表，之后必须再跑本脚本。
//   index.html                  只改两处：meta[name=shizi-asset-build] 的 content = BUILD；
//                               <script defer src="…?v=…"> 的 ?v= = 该文件内容 SHA-256 前 12 位（deck / 语境覆盖 / core-strokes）。
//   scripts/shell-manifest.txt  随包/离线壳的全部文件，逐行一个相对仓库根的路径，按 UTF-8 字节序排序。
//                               data/ 下 7000+ 个笔顺 JSON 也逐个列出（iOS `rsync --files-from=` 与 verify-bundle-assets.sh 用）。
//   src/build-info.js           export const BUILD = '<yyyymmdd>-<壳内容指纹 12 hex>'。
//   sw-manifest.js              self.SHIZI_SW_MANIFEST = {build, shell, bestEffort, coreStrokes}，sw.js importScripts 它：
//                                 shell       核心壳（Cache.addAll 原子预缓存；任何一项失败 = 安装失败，旧 worker 继续）
//                                 bestEffort  题库 deck / 字源 / 字体文件 / 图形资源（逐项尽力，失败不阻断安装）
//                                 coreStrokes 核心 600 字（笔顺 JSON 尽力批次预缓存，运行时淘汰时永不淘汰）
//
// BUILD 指纹 = 清单内全部文件（除 EXCLUDE_FROM_HASH）的「路径 + 内容 SHA-256」再取 SHA-256；index.html 参与哈希时
// meta[shizi-asset-build] 的 content 先置空（否则自指）。指纹不变就保留原日期，指纹变了才用当天本地日期。
// 不是 git sha：生成物入库后 git sha 不可能自洽（01 §8.3）。
//
// 用法：
//   node scripts/build_shell_manifest.mjs          生成/更新
//   node scripts/build_shell_manifest.mjs --check  只检查：生成物与工作区不一致则退出码 1

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstQueue } from '../src/config/policy.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = 'scripts/shell-manifest.txt';
export const BUILD_INFO_PATH = 'src/build-info.js';
export const SW_MANIFEST_PATH = 'sw-manifest.js';
export const CORE_STROKES_PATH = 'core-strokes.js';
export const INDEX_PATH = 'index.html';
export const CORE_STROKE_COUNT = 600;

// 固定根列表：文件或目录（目录递归）。icon-*.png 单独按模式匹配。
export const SHELL_ROOTS = [
  'index.html',
  'deck-data.js',
  'core-strokes.js',
  'manifest.webmanifest',
  'sw.js',
  'sw-manifest.js',
  'data/',
  'src/',
  'vendor/',
  'fonts/',
  'assets/',
  'licenses/',
];
const ROOT_FILE_PATTERNS = [/^icon-[^/]+\.png$/];

// 不参与 BUILD 指纹的清单文件：build-info.js 与 sw-manifest.js 自身内嵌 BUILD（避免自指）。
export const EXCLUDE_FROM_HASH = new Set([BUILD_INFO_PATH, SW_MANIFEST_PATH]);

// index.html 里带内容指纹的 defer 经典脚本（?v= 由本脚本维护）。
export const FINGERPRINTED = ['deck-data.js', 'data/context-overrides.js', 'core-strokes.js'];

const META_RE = /(<meta name="shizi-asset-build" content=")([^"]*)(">)/;

function byUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function walk(root, rel, out) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  const stat = lstatSync(abs);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    out.push(rel);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const name of readdirSync(abs)) {
    if (name.startsWith('.')) continue; // .gitkeep / .DS_Store 等不进包
    if (name === 'package.json' && rel) continue; // src/、vendor/ 的 {"type":"module"} 只给 node 用
    walk(root, rel ? `${rel}/${name}` : name, out);
  }
}

export function collectShellFiles(root = ROOT) {
  const files = [];
  for (const entry of SHELL_ROOTS) walk(root, entry.replace(/\/$/, ''), files);
  for (const name of readdirSync(root)) {
    if (ROOT_FILE_PATTERNS.some(re => re.test(name)) && lstatSync(join(root, name)).isFile()) files.push(name);
  }
  return [...new Set(files)].sort(byUtf8);
}

export function manifestText(files) {
  return files.length ? `${files.join('\n')}\n` : '';
}

/** index.html 参与指纹时的规范形：meta[shizi-asset-build] 的 content 置空。 */
export function htmlForHash(html) {
  return html.replace(META_RE, '$1$3');
}

/**
 * @param {string[]} files
 * @param {string} [root]
 * @param {Record<string,string>} [overrides] 即将写出的生成物（rel → 文本），代替磁盘内容参与哈希
 */
export function shellFingerprint(files, root = ROOT, overrides = {}) {
  const outer = createHash('sha256');
  for (const rel of files) {
    if (EXCLUDE_FROM_HASH.has(rel)) continue;
    let bytes;
    if (Object.prototype.hasOwnProperty.call(overrides, rel)) bytes = Buffer.from(overrides[rel], 'utf8');
    else if (existsSync(join(root, rel))) bytes = readFileSync(join(root, rel));
    else continue;
    if (rel === INDEX_PATH) bytes = Buffer.from(htmlForHash(bytes.toString('utf8')), 'utf8');
    outer.update(`${rel}\0${sha256(bytes)}\n`);
  }
  return outer.digest('hex').slice(0, 12);
}

function localDayStamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

const BUILD_RE = /export const BUILD = '(\d{8})-([0-9a-f]{12})';/;

export function parseBuild(source) {
  const m = BUILD_RE.exec(source || '');
  return m ? { day: m[1], fingerprint: m[2] } : null;
}

export function buildInfoText(day, fingerprint) {
  return '// 由 scripts/build_shell_manifest.mjs 生成，勿手改。\n'
    + '// BUILD = <首次出现该壳内容的本地日期>-<壳内容指纹（shell-manifest.txt 所列文件，除 build-info.js / sw-manifest.js；\n'
    + '// index.html 按 meta 置空计）>。与 index.html meta[shizi-asset-build]、sw-manifest.js 同源（01 §8.3）。\n'
    + `export const BUILD = '${day}-${fingerprint}';\n`;
}

function readIfExists(abs) {
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

// ---------------------------------------------------------------- core-strokes.js

/** 读回 core-strokes.js 里的 600 字字表（build_8105_chars.py 写的 `scope.SHIZI_CORE_STROKES=[…]`）。 */
export function parseCoreStrokeList(source) {
  const m = /SHIZI_CORE_STROKES\s*=\s*(\[[^\]]*\])/.exec(source || '');
  if (!m) throw new Error(`${CORE_STROKES_PATH}: cannot find SHIZI_CORE_STROKES list (run scripts/build_8105_chars.py)`);
  const list = JSON.parse(m[1]);
  if (!Array.isArray(list) || !list.every(ch => typeof ch === 'string' && Array.from(ch).length === 1)) {
    throw new Error(`${CORE_STROKES_PATH}: SHIZI_CORE_STROKES is not a list of single characters`);
  }
  return list;
}

/** 字表：首练字（P09）排最前，其余保持原顺序，去重后截到 600。 */
export function coreStrokeList(existing, first = firstQueue) {
  return [...new Set([...first, ...existing])].slice(0, CORE_STROKE_COUNT);
}

function strokeJSON(root, ch) {
  const file = join(root, 'data', `${ch}.json`);
  if (!existsSync(file)) throw new Error(`policy.firstQueue character ${ch} has no data/${ch}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(json.strokes) || !Array.isArray(json.medians) || json.strokes.length !== json.medians.length) {
    throw new Error(`data/${ch}.json is not hanzi-writer stroke data`);
  }
  return json;
}

export function coreStrokesText(list, embedded) {
  const lines = [
    '// 由 scripts/build_8105_chars.py 生成 600 字字表（首日校准字优先，再按题库字频补满）；',
    '// scripts/build_shell_manifest.mjs 把首练字（policy.firstQueue，P09）排到最前并内嵌它们的笔顺（SHIZI_STROKE_DATA），',
    '// 让第一次练习离线也有参考字形与提示（src/data/strokes.js 内嵌钩子）。勿手改；P09 定稿后重跑两个生成器。',
    '(function(scope){',
    `  scope.SHIZI_CORE_STROKES=${JSON.stringify(list)};`,
    '  var data=scope.SHIZI_STROKE_DATA||(scope.SHIZI_STROKE_DATA={});',
  ];
  for (const [ch, json] of embedded) lines.push(`  data[${JSON.stringify(ch)}]=${JSON.stringify(json)};`);
  lines.push('})(self);', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------- index.html

export function patchIndexFingerprints(html, fingerprintOf) {
  let out = html;
  for (const rel of FINGERPRINTED) {
    const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(<script\\b[^>]*\\bsrc="${escaped}\\?v=)([0-9a-f]*)(")`);
    if (re.test(out)) out = out.replace(re, `$1${fingerprintOf(rel)}$3`);
  }
  return out;
}

export function patchIndexBuild(html, build) {
  if (!META_RE.test(html)) throw new Error(`${INDEX_PATH}: missing <meta name="shizi-asset-build" content="…">`);
  return html.replace(META_RE, `$1${build}$3`);
}

// ---------------------------------------------------------------- sw-manifest.js

function isFontBinary(rel) {
  return /^fonts\/.+\.(woff2?|ttf|otf)$/.test(rel);
}

/**
 * 从清单分出 SW 的核心壳与尽力批次（01 §8.3：核心 SHELL 原子；deck 与字体作「尽力」批次）。
 * 不进 SW 预缓存：sw.js / sw-manifest.js 自身、笔顺 JSON（按 coreStrokes 另批预缓存 + 运行时缓存）、licenses/ 与 *.md。
 */
export function swLists(files, fingerprintOf) {
  const shell = [];
  const bestEffort = [];
  const versioned = rel => `${rel}?v=${fingerprintOf(rel)}`;
  for (const rel of files) {
    if (rel === 'sw.js' || rel === SW_MANIFEST_PATH) continue;
    if (rel.startsWith('licenses/') || rel.endsWith('.md')) continue;
    if (rel === 'deck-data.js') bestEffort.push(versioned(rel));
    else if (rel === 'data/etymology.json') bestEffort.push(rel);
    else if (rel.startsWith('data/') && rel.endsWith('.json')) continue;
    else if (FINGERPRINTED.includes(rel)) shell.push(versioned(rel));
    else if (isFontBinary(rel) || rel.startsWith('assets/')) bestEffort.push(rel);
    else shell.push(rel);
  }
  return { shell, bestEffort };
}

export function swManifestText({ build, shell, bestEffort, coreStrokes }) {
  const list = arr => `[\n${arr.map(item => `    ${JSON.stringify(item)},`).join('\n')}\n  ]`;
  return [
    '// 由 scripts/build_shell_manifest.mjs 生成，勿手改。sw.js 以 importScripts(\'./sw-manifest.js\') 读取（01 §8.3）。',
    '// 升级的唯一入口：本文件或 sw.js 的字节变化 → 浏览器装新 worker。build 与 src/build-info.js、index.html meta 同源。',
    'self.SHIZI_SW_MANIFEST = {',
    `  build: ${JSON.stringify(build)},`,
    '  // 核心壳：Cache.addAll 原子预缓存，任何一项失败 = 安装失败',
    `  shell: ${list(shell)},`,
    '  // 尽力批次：题库 / 字源 / 字体文件 / 图形资源，逐项失败不阻断安装',
    `  bestEffort: ${list(bestEffort)},`,
    '  // 核心笔顺 600 字（首练字在最前）：尽力预缓存，运行时淘汰永不淘汰',
    `  coreStrokes: ${JSON.stringify(coreStrokes)},`,
    '};',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- plan

export function plan(root = ROOT, now = new Date()) {
  const files = collectShellFiles(root);
  // build-info.js / sw-manifest.js 必须在清单里（即使首次运行时还不存在）。
  for (const rel of [BUILD_INFO_PATH, SW_MANIFEST_PATH]) if (!files.includes(rel)) files.push(rel);
  files.sort(byUtf8);

  // 1. core-strokes.js（首练字内嵌）
  const coreList = coreStrokeList(parseCoreStrokeList(readIfExists(join(root, CORE_STROKES_PATH))));
  const embedded = firstQueue.map(ch => [ch, strokeJSON(root, ch)]);
  const coreText = coreStrokesText(coreList, embedded);

  // 2. index.html 的 ?v=（core-strokes 用即将写出的文本算）
  const overrides = { [CORE_STROKES_PATH]: coreText };
  const fingerprintOf = rel => sha256(Object.prototype.hasOwnProperty.call(overrides, rel)
    ? Buffer.from(overrides[rel], 'utf8')
    : readFileSync(join(root, rel))).slice(0, 12);
  const currentHtml = readIfExists(join(root, INDEX_PATH));
  if (currentHtml === null) throw new Error(`${INDEX_PATH} is missing`);
  const htmlWithV = patchIndexFingerprints(currentHtml, fingerprintOf);
  overrides[INDEX_PATH] = htmlWithV;

  // 3. BUILD
  const fingerprint = shellFingerprint(files, root, overrides);
  const parsed = parseBuild(readIfExists(join(root, BUILD_INFO_PATH)));
  const day = parsed && parsed.fingerprint === fingerprint ? parsed.day : localDayStamp(now);
  const build = `${day}-${fingerprint}`;

  const { shell, bestEffort } = swLists(files, fingerprintOf);
  return {
    files,
    fingerprint,
    build,
    shell,
    bestEffort,
    coreStrokes: coreList,
    outputs: [
      { rel: CORE_STROKES_PATH, text: coreText },
      { rel: INDEX_PATH, text: patchIndexBuild(htmlWithV, build) },
      { rel: MANIFEST_PATH, text: manifestText(files) },
      { rel: BUILD_INFO_PATH, text: buildInfoText(day, fingerprint) },
      { rel: SW_MANIFEST_PATH, text: swManifestText({ build, shell, bestEffort, coreStrokes: coreList }) },
    ],
  };
}

function main(argv) {
  const checkOnly = argv.includes('--check');
  const { files, build, outputs } = plan();
  let stale = 0;
  for (const { rel, text } of outputs) {
    const abs = join(ROOT, rel);
    const same = readIfExists(abs) === text;
    if (same) continue;
    stale += 1;
    if (checkOnly) {
      process.stderr.write(`[shell-manifest] stale: ${rel} (run: node scripts/build_shell_manifest.mjs)\n`);
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
      process.stdout.write(`[shell-manifest] wrote ${rel}\n`);
    }
  }
  process.stdout.write(`[shell-manifest] ${files.length} files, BUILD ${build}${stale ? '' : ', up to date'}\n`);
  if (checkOnly && stale) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
