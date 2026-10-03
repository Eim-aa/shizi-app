// A10（G22）：src/ui 里所有 font-size 字面量 ≥ 11px（calc(Npx * k) 的 N、clamp / min 里的 px 一并算）。
// 小于 11px 的只有登记过理由的装饰字，登记项过期（文件里已没有）也报错，防止清单烂掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIN_PX = 11;

/** 例外：文件 + 该声明的片段 → 理由。只许装饰字（aria-hidden，同一信息另有读屏名称）或随格宽收缩的角标。 */
const EXCEPTIONS = Object.freeze([
  { file: 'src/ui/screens/home/index.js', snippet: 'font-size:10px', why: '题记落款印章里的单字「字」，装饰（aria-hidden），印章整体 22px 见方' },
  { file: 'src/ui/screens/mine/records.js', snippet: 'font-size:clamp(9px, 16cqw, 12px)', why: '字帖格角标「9·1」，随格宽收缩（cqw）；aria-hidden，同一日期在格子的 aria-label 里（X-MINE.cellLabel）' },
  { file: 'src/ui/screens/mine/annual.js', snippet: 'font-size:clamp(9px, 13cqw, 12px)', why: '年度报告字帖格角标，同上' },
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** 文本里每一处 font-size（CSS 声明或 JS 的 fontSize: '…'）及其值里的 px 字面量。 */
function fontSizeDecls(text) {
  const decls = [];
  const re = /(?:font-size\s*:|fontSize\s*:\s*['"`])\s*([^;}`'"]*)/g;
  let m;
  while ((m = re.exec(text))) {
    // 算作字号的 px：不含 calc 里「- 2px」「+ 2px」这类加减项
    const px = [...m[1].matchAll(/(?<![-+]\s)(?<![\d.])(\d+(?:\.\d+)?)px/g)].map(x => Number(x[1]));
    decls.push({ snippet: m[0].replace(/\s+/g, ' ').trim(), px });
  }
  return decls;
}

test('A10: every font-size px literal under src/ui is >= 11px unless registered with a reason', () => {
  const offenders = [];
  const used = new Set();
  let checked = 0;
  for (const file of walk(path.join(ROOT, 'src/ui'))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const d of fontSizeDecls(fs.readFileSync(file, 'utf8'))) {
      checked += 1;
      if (!d.px.some(v => v < MIN_PX)) continue;
      const hit = EXCEPTIONS.find(e => e.file === rel && d.snippet.startsWith(e.snippet));
      if (hit) used.add(hit);
      else offenders.push(`${rel}: ${d.snippet} (${d.px.join(', ')}px)`);
    }
  }
  assert.ok(checked > 150, `scanned ${checked} font-size declarations`);
  assert.deepEqual(offenders, [], `font-size < ${MIN_PX}px: use calc(11px * \${T.k}) or larger, or register it with a reason in test/ui/font-floor.test.mjs`);
  for (const e of EXCEPTIONS) {
    assert.ok(e.why && e.why.length > 8, `exception ${e.file} needs a reason`);
    assert.ok(used.has(e), `stale exception (no longer in the source): ${e.file} ${e.snippet}`);
  }
});

test('A10: the scanner understands calc / clamp / JS forms', () => {
  assert.deepEqual(fontSizeDecls('a{font-size:calc(10px * var(--k));}')[0].px, [10]);
  assert.deepEqual(fontSizeDecls('a{font-size:clamp(9px, 16cqw, 12px)}')[0].px, [9, 12]);
  assert.deepEqual(fontSizeDecls("el('p', { fontSize: '11px' })")[0].px, [11]);
  assert.deepEqual(fontSizeDecls('a{font-size:34cqw}')[0].px, []);
  assert.deepEqual(fontSizeDecls('a{font-size:min(24px, calc((100cqw - 2px) / var(--n, 2) * .6))}')[0].px, [24], 'subtraction terms are not font sizes');
});
