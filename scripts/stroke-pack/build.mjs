#!/usr/bin/env node
// B4.10：把 data/<字>.json（每字一笔顺文件）打包成单个只读 pack + 索引。
//
// 用法：
//   node scripts/stroke-pack/build.mjs [--out path] [--check]
//     --out path   输出路径（相对 CWD），缺省 <仓库根>/build/strokes.pack
//     --check      打包到临时文件，重新读回并逐字校验字节等价，通过后删临时文件（不写正式输出）
//
// 哪些文件算「笔顺文件」：与应用一致——文件名去掉 .json 后恰好是一个 Unicode 码点
// （src/data/strokes.js 的 strokesURL + isSingleChar：data/<单字>.json；原生 NativeGlyph.swift 同一命名）。
// 据此排除 data/ 里的 etymology.json、LICENSE.md 等非每字文件。
//
// 格式（版本 1，详见 docs/engineering/v10/B4.10-笔顺打包.md）：
//   头部 16 字节：magic "SZPK"（4）｜version u16le（2）｜entrySize u16le（2）｜count u32le（4）｜dataOffset u32le（4）
//   索引 count 条、每条 entrySize=20 字节、按 key 的 UTF-8 字节升序：
//     key 8 字节（字符的 UTF-8，右侧 0 填充——合法 UTF-8 不含 0x00，填充不改字节序与相等性）
//     offset u64le（数据区绝对偏移）｜length u32le
//   数据区：各文件的原始字节原样拼接（不重编码，等价性因此逐字节成立）。

import { readdirSync, readFileSync, statSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const DEFAULT_OUT = path.join(ROOT, 'build', 'strokes.pack');

const MAGIC = Buffer.from('SZPK', 'utf8');
const VERSION = 1;
const KEY_BYTES = 8; // 单个码点的 UTF-8 最长 4 字节，8 足够
const HEADER_BYTES = 16;
const ENTRY_BYTES = KEY_BYTES + 8 + 4;

// ---- 参数 ----
const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const hasFlag = flag => argv.includes(flag);
if (hasFlag('--help') || hasFlag('-h')) {
  console.log('usage: node scripts/stroke-pack/build.mjs [--out path] [--check]');
  process.exit(0);
}
const outPath = path.resolve(argValue('--out') || DEFAULT_OUT);

// ---- 选文件 ----
export function isStrokeFileName(name) {
  if (!name.endsWith('.json')) return false;
  return Array.from(name.slice(0, -'.json'.length)).length === 1;
}

function strokeFiles() {
  const names = readdirSync(DATA_DIR).filter(isStrokeFileName).sort();
  const files = [];
  for (const name of names) {
    const char = name.slice(0, -'.json'.length);
    const file = path.join(DATA_DIR, name);
    files.push({ char, file, bytes: readFileSync(file) });
  }
  return files;
}

// ---- 打包 ----
function buildPackBytes(files) {
  // 索引按 key 的 UTF-8 字节序排（与 Swift 读取器的二分一致；UTF-8 字节序 = 码点序，无前缀冲突）。
  const sorted = [...files].sort((a, b) =>
    Buffer.compare(Buffer.from(a.char, 'utf8'), Buffer.from(b.char, 'utf8')));
  const count = sorted.length;
  const dataOffset = HEADER_BYTES + count * ENTRY_BYTES;
  const blobBytes = sorted.reduce((n, f) => n + f.bytes.length, 0);
  const buf = Buffer.alloc(dataOffset + blobBytes);
  MAGIC.copy(buf, 0);
  buf.writeUInt16LE(VERSION, 4);
  buf.writeUInt16LE(ENTRY_BYTES, 6);
  buf.writeUInt32LE(count, 8);
  buf.writeUInt32LE(dataOffset, 12);
  let cursor = dataOffset;
  sorted.forEach((f, i) => {
    const at = HEADER_BYTES + i * ENTRY_BYTES;
    const key = Buffer.from(f.char, 'utf8');
    if (key.length > KEY_BYTES) throw new Error(`key too long: ${f.char}`);
    key.copy(buf, at);
    buf.writeBigUInt64LE(BigInt(cursor), at + KEY_BYTES);
    buf.writeUInt32LE(f.bytes.length, at + KEY_BYTES + 8);
    f.bytes.copy(buf, cursor);
    f.offset = cursor;
    cursor += f.bytes.length;
  });
  return { buf, sorted, dataOffset };
}

// ---- 读回（与 Swift 读取器同一套二分，独立于写路径） ----
function lookup(pack, char) {
  const key = Buffer.from(char, 'utf8');
  if (key.length > KEY_BYTES || Array.from(char).length !== 1) return null;
  const padded = Buffer.alloc(KEY_BYTES);
  key.copy(padded);
  const { buf } = pack;
  const count = buf.readUInt32LE(8);
  let lo = 0, hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const at = HEADER_BYTES + mid * ENTRY_BYTES;
    const cmp = buf.subarray(at, at + KEY_BYTES).compare(padded);
    if (cmp === 0) {
      const offset = Number(buf.readBigUInt64LE(at + KEY_BYTES));
      const length = buf.readUInt32LE(at + KEY_BYTES + 8);
      return buf.subarray(offset, offset + length);
    }
    if (cmp < 0) lo = mid + 1; else hi = mid;
  }
  return null;
}

function verify(pack, files) {
  let bad = 0;
  for (const f of files) {
    const got = lookup(pack, f.char);
    if (!got || !got.equals(f.bytes)) {
      console.error(`round-trip mismatch: ${f.char}`);
      bad += 1;
    }
  }
  return bad === 0;
}

// ---- 主流程 ----
const files = strokeFiles();
const { buf, sorted } = buildPackBytes(files);

if (hasFlag('--check')) {
  const tmp = outPath + '.check-tmp';
  try {
    mkdirSync(path.dirname(tmp), { recursive: true });
    writeFileSync(tmp, buf);
    const repacked = { buf: readFileSync(tmp) };
    const ok = verify(repacked, files);
    if (!ok) {
      console.error(`--check FAILED: ${files.length} files, round-trip mismatch above`);
      process.exit(1);
    }
    const inputBytes = files.reduce((n, f) => n + f.bytes.length, 0);
    console.log(`--check OK: ${files.length} files round-trip byte-for-byte; ` +
      `index+header ${HEADER_BYTES + sorted.length * ENTRY_BYTES} B, blob ${inputBytes} B, pack ${buf.length} B`);
  } finally {
    rmSync(tmp, { force: true });
  }
} else {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  const inputBytes = files.reduce((n, f) => n + f.bytes.length, 0);
  console.log(`wrote ${outPath}`);
  console.log(`files: ${files.length}`);
  console.log(`input bytes (logical): ${inputBytes}`);
  console.log(`pack bytes (logical): ${buf.length} = header ${HEADER_BYTES} + index ${files.length}×${ENTRY_BYTES} + blob ${inputBytes}`);
  const stat = statSync(outPath);
  console.log(`pack bytes (on disk): ${stat.blocks * 512}`);
  console.log('next: node scripts/stroke-pack/build.mjs --check 验证逐字节等价');
}
