#!/usr/bin/env node
// 把 preact / preact/hooks / htm 的官方 dist 文件固定进 vendor/（无打包器、无 CDN）。
//
// 来源：npm registry 官方 tarball（版本与 SHA-512 integrity 固定在下方常量里，不符即中止）。
// 改写（仅两处，均为机械替换，重复运行幂等）：
//   1. vendor/preact-hooks.module.js 里的裸说明符 from"preact" → from"./preact.module.js"
//      （浏览器原生 ES 模块不认识裸说明符，也不引入 import map）；
//   2. 去掉末尾 `//# sourceMappingURL=…` 注释（.map 不随包分发，避免调试器请求 404）。
// 同时把上游 LICENSE 原文写到 licenses/。
//
// 用法：
//   node scripts/vendor_preact.mjs                 从 registry 下载 tarball、校验、写出 vendor/
//   node scripts/vendor_preact.mjs --tarballs DIR  用 DIR 下已下载的 tarball（同样校验 integrity）
//   node scripts/vendor_preact.mjs --check         不联网：核对 vendor/ 文件 SHA-256 与下方登记值、无裸 from"preact"
//
// 升级版本时：改 PACKAGES 的 version/integrity，运行一次，把输出的 SHA-256 更新到
// VENDORED_SHA256 与 THIRD_PARTY_NOTICES.md。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const LICENSES = join(ROOT, 'licenses');

const PACKAGES = [
  {
    name: 'preact',
    version: '10.29.8',
    tarball: 'https://registry.npmjs.org/preact/-/preact-10.29.8.tgz',
    integrity: 'sha512-ej2aVZ+vZ8WO7tvlQWRM9N63A0KzF9q4mWJfDUHgYaIofWY9hu74QdnQrjoPMmZi2/nZ5gN0bJCQF49xQqx09Q==',
    files: [
      { from: 'package/dist/preact.module.js', to: 'vendor/preact.module.js' },
      { from: 'package/hooks/dist/hooks.module.js', to: 'vendor/preact-hooks.module.js', rewritePreact: true },
      { from: 'package/LICENSE', to: 'licenses/preact-LICENSE.txt', raw: true },
    ],
  },
  {
    name: 'htm',
    version: '3.1.1',
    tarball: 'https://registry.npmjs.org/htm/-/htm-3.1.1.tgz',
    integrity: 'sha512-983Vyg8NwUE7JkZ6NmOqpCZ+sh1bKv2iYTlUkzlWmA5JD2acKoxd4KVxbMmxX/85mtfdnDmTFoNKcg5DGAvxNQ==',
    files: [
      { from: 'package/dist/htm.module.js', to: 'vendor/htm.module.js' },
      { from: 'package/LICENSE', to: 'licenses/htm-LICENSE.txt', raw: true },
    ],
  },
];

// 写出后（含上述改写）的 SHA-256；与 THIRD_PARTY_NOTICES.md 登记一致。
export const VENDORED_SHA256 = {
  'vendor/preact.module.js': '25a5df7e9f628a587743c4641a368737a3b218f28ef738ba0376a2d5bdfc948c',
  'vendor/preact-hooks.module.js': '9e7eff58e0ae604583461eba1344da69a6894eab575eb591c635cc0d3f9ec57d',
  'vendor/htm.module.js': 'ab33dd3f38059b9be4d5f5350128eefb2356639c4e0bbe9d9e8b3ba75847e9e4',
  // 经典脚本（UMD 全局），原样移入 vendor/，不由本脚本写出，只在 --check 时核对。
  'vendor/hanzi-writer.min.js': '17b11a1e025b780cb518d49b30faacc770dfa7fbc387aa3876e3e5c1bd31e642',
  'vendor/fsrs6.min.js': '368942939646b0c58b6db89e3f92b036d2101e85a5194f07d7df6fdd5ed157f4',
};

const BARE_PREACT = /from\s*(["'])preact\1/g;
const SOURCE_MAP = /\n?\/\/# sourceMappingURL=[^\n]*\n?$/;

export function rewriteModule(source, { rewritePreact = false } = {}) {
  let out = source.replace(SOURCE_MAP, '\n');
  if (rewritePreact) out = out.replace(BARE_PREACT, 'from"./preact.module.js"');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

export function hasBarePreactImport(source) {
  return /from\s*["']preact["']/.test(source);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function checkIntegrity(buf, integrity, label) {
  const [algo, expected] = integrity.split('-');
  const actual = createHash(algo).update(buf).digest('base64');
  if (actual !== expected) throw new Error(`${label}: integrity mismatch (want ${integrity}, got ${algo}-${actual})`);
}

// 最小 tar 读取：只取普通文件（typeflag '0' 或 '\0'），支持 ustar prefix。
function untar(buf) {
  const entries = new Map();
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every(b => b === 0)) break;
    const str = (s, e) => header.subarray(s, e).toString('utf8').replace(/\0.*$/s, '');
    const name = str(0, 100);
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(345, 500);
    const full = prefix ? `${prefix}/${name}` : name;
    const start = off + 512;
    if (type === '0') entries.set(full, Buffer.from(buf.subarray(start, start + size)));
    off = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function loadTarball(pkg, tarballDir) {
  let buf;
  const fileName = pkg.tarball.split('/').pop();
  if (tarballDir) {
    buf = readFileSync(join(tarballDir, fileName));
  } else {
    const res = await fetch(pkg.tarball);
    if (!res.ok) throw new Error(`${pkg.tarball}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  checkIntegrity(buf, pkg.integrity, fileName);
  return { entries: untar(gunzipSync(buf)), tarballSha256: sha256(buf) };
}

function writeIfChanged(rel, content) {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  if (existsSync(abs) && readFileSync(abs).equals(content)) return false;
  writeFileSync(abs, content);
  return true;
}

function check() {
  const problems = [];
  for (const [rel, want] of Object.entries(VENDORED_SHA256)) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) { problems.push(`${rel}: missing`); continue; }
    const buf = readFileSync(abs);
    const got = sha256(buf);
    if (got !== want) problems.push(`${rel}: sha256 ${got} != ${want}`);
    if (hasBarePreactImport(buf.toString('utf8'))) problems.push(`${rel}: bare from"preact" import`);
  }
  if (problems.length) {
    for (const p of problems) process.stderr.write(`[vendor] ${p}\n`);
    process.exit(1);
  }
  process.stdout.write(`[vendor] ok: ${Object.keys(VENDORED_SHA256).length} files match pinned SHA-256\n`);
}

async function main(argv) {
  if (argv.includes('--check')) return check();
  const dirIdx = argv.indexOf('--tarballs');
  const tarballDir = dirIdx >= 0 ? resolve(argv[dirIdx + 1]) : null;
  mkdirSync(VENDOR, { recursive: true });
  mkdirSync(LICENSES, { recursive: true });
  let mismatched = 0;
  for (const pkg of PACKAGES) {
    const { entries, tarballSha256 } = await loadTarball(pkg, tarballDir);
    process.stdout.write(`[vendor] ${pkg.name}@${pkg.version} ${pkg.tarball}\n`);
    process.stdout.write(`[vendor]   tarball sha256 ${tarballSha256}\n`);
    for (const file of pkg.files) {
      const src = entries.get(file.from);
      if (!src) throw new Error(`${pkg.name}: ${file.from} not in tarball`);
      const out = file.raw ? src : Buffer.from(rewriteModule(src.toString('utf8'), file), 'utf8');
      if (!file.raw && hasBarePreactImport(out.toString('utf8'))) throw new Error(`${file.to}: bare preact import left after rewrite`);
      const changed = writeIfChanged(file.to, out);
      const digest = sha256(out);
      const pinned = VENDORED_SHA256[file.to];
      const status = pinned === undefined ? '' : pinned === digest ? ' (pinned ok)' : ' (PINNED SHA DIFFERS — update VENDORED_SHA256 and THIRD_PARTY_NOTICES.md)';
      if (pinned !== undefined && pinned !== digest) mismatched += 1;
      process.stdout.write(`[vendor]   ${file.to} sha256 ${digest}${changed ? ' written' : ' unchanged'}${status}\n`);
    }
  }
  if (mismatched) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`[vendor] ${error.stack || error}\n`);
    process.exit(1);
  });
}
