#!/usr/bin/env node
// G1 转写核对：核对 docs/engineering/v10/B4-单测转写清单.md 里每个「转写」行是否真的有对应的 XCTest。
// 匹配规则（与 B4 转写约定一致，见 ios/ShiziCore/Tests/ShiziCoreTests 各文件头注释）：
//   Swift 测试里保留原用例名，并在注释里写原文件路径。现有三种写法都能对上：
//     // test/core/cards.test.mjs: <原名>        （单行冒号）
//     // test/ui/query.test.mjs — <原名>         （单行破折号）
//     // test/ui/prefs.test.mjs⏎ // <原名>       （路径一行 + 名字一行）
//   test/store/store.test.mjs 与 ink-schema 的 JS 用例按后端跑两遍（名字带 [localStorage] / [native] 前缀），
//   Swift 一条测试两种后端各验一次，注释用裸名 → 先按全名找，找不到再剥掉前缀重试。
// 用法：
//   node scripts/core-diff/transcription-audit.mjs            缺行时退出码 1（CI 用）
//   node scripts/core-diff/transcription-audit.mjs --report   只打印报告，不失败
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOC = path.join(ROOT, 'docs/engineering/v10/B4-单测转写清单.md');
const TESTS = path.join(ROOT, 'ios/ShiziCore/Tests/ShiziCoreTests');

// —— 解析清单的「逐条」表：### 文件 下的 | # | 用例 | 归类 | 卡 | 行 ——
function parseDoc() {
  const rows = [];
  const lines = fs.readFileSync(DOC, 'utf8').split('\n');
  let file = null;
  for (const line of lines) {
    const h = line.match(/^### (\S+)$/);
    if (h) { file = h[1]; continue; }
    if (!file || !line.startsWith('|')) continue;
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    if (cells.length < 5 || !/^\d+$/.test(cells[1])) continue;
    let name = cells[2].replace(/\\([|])/g, '$1').replace(/^　+/, '');
    const skip = name.endsWith('（skip）');
    if (skip) name = name.slice(0, -'（skip）'.length).trim();
    if (!cells[3].startsWith('转写')) continue;
    rows.push({ file, name, skip });
  }
  return rows;
}

// —— 收集 Swift 测试里的「原路径 + 原名」注释 ——
const norm = (s) => s.replace(/\s+/g, ' ').replace(/[.。]\s*$/, '').trim();
const PATH_RE = /^\s*\/\/\s*(test\/[A-Za-z0-9/_.-]+\.test\.mjs)\s*(?::|—|－|─)\s*(.+?)\s*$/;
const PATH_ONLY_RE = /^\s*\/\/\s*(test\/[A-Za-z0-9/_.-]+\.test\.mjs)\s*$/;

function collectComments() {
  const found = new Map(); // key: `${file}\u0000${norm(name)}` → 最先出现的位置
  const add = (file, name, where) => {
    const key = `${file}\u0000${norm(name)}`;
    if (!found.has(key)) found.set(key, where);
  };
  for (const f of fs.readdirSync(TESTS).filter((x) => x.endsWith('.swift'))) {
    const lines = fs.readFileSync(path.join(TESTS, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(PATH_RE);
      if (m) { add(m[1], m[2], `${f}:${i + 1}`); return; }
      if (!PATH_ONLY_RE.test(line)) return;
      const next = (lines[i + 1] || '').trim();
      if (next.startsWith('//')) {
        const name = next.replace(/^\/\/\s*/, '');
        // 两行式：第二行不能再是路径，否则是普通头注释
        if (!PATH_ONLY_RE.test(next) && !PATH_RE.test(next)) add(path_onlyFile(line), name, `${f}:${i + 1}`);
      }
    });
  }
  return found;
}
function path_onlyFile(line) { return line.trim().replace(/^\/\/\s*/, ''); }

const rows = parseDoc();
const comments = collectComments();
const missing = [];
const foundWhere = [];
for (const r of rows) {
  const bare = r.name.replace(/^\[[a-zA-Z]+\] /, ''); // store / ink-schema 的 [localStorage] / [native] 前缀
  const hit = comments.get(`${r.file}\u0000${norm(r.name)}`) ?? comments.get(`${r.file}\u0000${norm(bare)}`);
  if (hit) foundWhere.push(`${r.file} · ${r.name} → ${hit}`);
  else missing.push(r);
}

const byFile = new Map();
for (const r of missing) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }

const report = [];
report.push(`G1 转写核对：转写 ${rows.length} 行，找到 ${rows.length - missing.length}，缺失 ${missing.length}`);
report.push(`清单：${path.relative(ROOT, DOC)}`);
report.push(`测试目录：${path.relative(ROOT, TESTS)}`);
if (missing.length) {
  report.push('');
  report.push('缺失的转写行（文件 · 原用例名）：');
  for (const [f, list] of byFile) for (const r of list) report.push(`  ${f} · ${r.name}`);
}
process.stdout.write(report.join('\n') + '\n');
if (missing.length && !process.argv.includes('--report')) process.exitCode = 1;
