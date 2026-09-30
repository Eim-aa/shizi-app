#!/usr/bin/env node
// 壳清单生成器（M0-1 最小版；最终形态见 01-架构设计 §8.3，M5 起还会写 sw-manifest.js 与 index.html meta）。
//
// 写出两个生成物（内容不变时不重写，重复运行 git diff 为空）：
//   scripts/shell-manifest.txt  随包/离线壳的全部文件，逐行一个相对仓库根的路径，按 UTF-8 字节序排序。
//                               data/ 下 7000+ 个笔顺 JSON 也逐个列出（不用目录行）：iOS 同步脚本用
//                               `rsync -a --files-from=` 精确复制，verify-bundle-assets.sh 能逐行核对，
//                               M5 生成 SW SHELL 时可直接按前缀筛选。
//   src/build-info.js           export const BUILD = '<yyyymmdd>-<壳内容指纹 12 hex>'。
//                               指纹 = 清单内全部文件（除 EXCLUDE_FROM_HASH）的「路径 + 内容 SHA-256」再取 SHA-256；
//                               指纹不变就保留原文件（连同日期）不动，指纹变了才用当天本地日期重写。
//
// 用法：
//   node scripts/build_shell_manifest.mjs          生成/更新
//   node scripts/build_shell_manifest.mjs --check  只检查：生成物与工作区不一致则退出码 1

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = 'scripts/shell-manifest.txt';
export const BUILD_INFO_PATH = 'src/build-info.js';

// 固定根列表：文件或目录（目录递归）。icon-*.png 单独按模式匹配。
export const SHELL_ROOTS = [
  'index.html',
  'deck-data.js',
  'core-strokes.js',
  'manifest.webmanifest',
  'sw.js',
  'data/',
  'src/',
  'vendor/',
  'fonts/',
  'assets/',
  'licenses/',
];
const ROOT_FILE_PATTERNS = [/^icon-[^/]+\.png$/];

// 不参与 BUILD 指纹的清单文件：自身（避免自指）；M5 的 sw-manifest.js 同理（它会内嵌 BUILD）。
export const EXCLUDE_FROM_HASH = new Set([BUILD_INFO_PATH, 'sw-manifest.js']);

function byUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
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

export function shellFingerprint(files, root = ROOT) {
  const outer = createHash('sha256');
  for (const rel of files) {
    if (EXCLUDE_FROM_HASH.has(rel)) continue;
    const inner = createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
    outer.update(`${rel}\0${inner}\n`);
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
    + '// BUILD = <首次出现该壳内容的本地日期>-<壳内容指纹（shell-manifest.txt 所列文件，除 build-info.js 自身）>。\n'
    + `export const BUILD = '${day}-${fingerprint}';\n`;
}

function readIfExists(abs) {
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

export function plan(root = ROOT, now = new Date()) {
  const files = collectShellFiles(root);
  // build-info.js 必须在清单里（即使首次运行时还不存在）。
  if (!files.includes(BUILD_INFO_PATH)) {
    files.push(BUILD_INFO_PATH);
    files.sort(byUtf8);
  }
  const fingerprint = shellFingerprint(files.filter(rel => existsSync(join(root, rel))), root);
  const currentInfo = readIfExists(join(root, BUILD_INFO_PATH));
  const parsed = parseBuild(currentInfo);
  const day = parsed && parsed.fingerprint === fingerprint ? parsed.day : localDayStamp(now);
  return {
    files,
    fingerprint,
    outputs: [
      { rel: MANIFEST_PATH, text: manifestText(files) },
      { rel: BUILD_INFO_PATH, text: buildInfoText(day, fingerprint) },
    ],
  };
}

function main(argv) {
  const checkOnly = argv.includes('--check');
  const { files, fingerprint, outputs } = plan();
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
  process.stdout.write(`[shell-manifest] ${files.length} files, fingerprint ${fingerprint}${stale ? '' : ', up to date'}\n`);
  if (checkOnly && stale) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
