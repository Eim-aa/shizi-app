#!/usr/bin/env node
// App 包资源清单生成器（`pnpm run build:manifest`）。
//
// 写出 scripts/app-bundle-manifest.txt（内容不变时不重写，重复运行 git diff 为空）：iOS 包里 Web/ 的文件，逐行一个相对仓库根的路径，
// 按 UTF-8 字节序排序。范围 = APP_BUNDLE_ROOTS（原生仍在读的 data/ 笔顺与字源、fonts/、licenses/）。
// Xcode Run Script「Sync Web Assets」（ios/ShiziApp/scripts/sync-web-assets.sh）按它 `rsync --files-from=`，
// ios/ShiziApp/scripts/verify-bundle-assets.sh 按它核对包内文件。
//
// D84（卡 B）：不再生成网页壳的 scripts/shell-manifest.txt、sw-manifest.js、src/build-info.js、core-strokes.js 与 index.html 的
// ?v= / meta / modulepreload（这些文件冻结在仓库里，删网页时一起删）。关于页的版本行由 sync-web-assets.sh 在构建时从
// MARKETING_VERSION 与 git HEAD 生成，不再经过 src/build-info.js。
//
// 用法：
//   node scripts/build_shell_manifest.mjs          生成 / 更新
//   node scripts/build_shell_manifest.mjs --check  只检查：清单与工作区不一致则退出码 1

import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const APP_MANIFEST_PATH = 'scripts/app-bundle-manifest.txt';

// B4.9：iOS 包里 Web/ 只留原生仍在读的（笔顺 / 字源 data/、字体 fonts/）与许可文本（§4.5 第 3 条）。
export const APP_BUNDLE_ROOTS = ['data/', 'fonts/', 'licenses/'];

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
    walk(root, rel ? `${rel}/${name}` : name, out);
  }
}

/** APP_BUNDLE_ROOTS 下的全部文件（相对仓库根，UTF-8 字节序）。 */
export function collectAppBundleFiles(root = ROOT) {
  const files = [];
  for (const entry of APP_BUNDLE_ROOTS) walk(root, entry.replace(/\/$/, ''), files);
  return [...new Set(files)].sort(byUtf8);
}

export function manifestText(files) {
  return files.length ? `${files.join('\n')}\n` : '';
}

export function plan(root = ROOT) {
  const files = collectAppBundleFiles(root);
  return { files, outputs: [{ rel: APP_MANIFEST_PATH, text: manifestText(files) }] };
}

function main(argv) {
  const checkOnly = argv.includes('--check');
  const { files, outputs } = plan();
  let stale = 0;
  for (const { rel, text } of outputs) {
    const abs = join(ROOT, rel);
    const same = existsSync(abs) && readFileSync(abs, 'utf8') === text;
    if (same) continue;
    stale += 1;
    if (checkOnly) {
      process.stderr.write(`[app-bundle-manifest] stale: ${rel} (run: pnpm run build:manifest)\n`);
    } else {
      writeFileSync(abs, text);
      process.stdout.write(`[app-bundle-manifest] wrote ${rel}\n`);
    }
  }
  process.stdout.write(`[app-bundle-manifest] ${files.length} files${stale ? '' : ', up to date'}\n`);
  if (checkOnly && stale) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
