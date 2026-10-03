#!/usr/bin/env node
// 生成 src/config/char-order.js：新字顺序数据（D28 易忘度排序、热身字、D39 姓氏与地名 / D40 大写数字的剔除、D40 特别组数据）。
//
// 用法（仓库根目录）：
//   node scripts/build_char_order.mjs           生成（有变化才写）
//   node scripts/build_char_order.mjs --check   只检查：生成物与工作区不一致则退出码 1（接在 pnpm run verify:data 里）
//
// 输入（都是只读数据，换表只需改它们再重跑本脚本，代码不用动）：
//   docs/engineering/v10/phase1/易忘度字表-初稿.json       排序 order、二级附录 level2Appendix、热身字 warmup.order（初稿，顾问未审）
//   docs/engineering/v10/phase1/tools/curation.mjs          HANDWRITING['签名姓氏'] / ['写地址'] 人工清单 → D39「姓氏与地名」主题的字
//   docs/engineering/v10/phase1/tools/capital-numerals.mjs  D40 大写数字：两组特别组、佰仟、题面语境词
//
// 剔除规则（D39 / D40）：姓氏字、省份简称与常见地名（curation 的两张清单）、大写数字 12 个字，都从默认新字排序（order 与二级附录）里剔除，
// 并且不进「清单之后按字频序」的尾部（src/core/new-order.js 同样排除 reserved）；它们之后由独立主题「姓氏与地名」/ D40 特别组承接。
// 被剔除的字逐个列在输出的 removed 里。

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const OUT_PATH = 'src/config/char-order.js';
const JSON_PATH = 'docs/engineering/v10/phase1/易忘度字表-初稿.json';
const CURATION_PATH = 'docs/engineering/v10/phase1/tools/curation.mjs';
const CAPITAL_PATH = 'docs/engineering/v10/phase1/tools/capital-numerals.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const chars = (s) => Array.from(s);
const q = (s) => JSON.stringify(s);
const list = (xs) => '[' + xs.map(q).join(', ') + ']';

/** 生成模块文本。root 可注入（测试用）。 */
export async function generate(root = ROOT) {
  const jsonText = readFileSync(join(root, JSON_PATH), 'utf8');
  const data = JSON.parse(jsonText);
  const curation = await import(pathToFileURL(join(root, CURATION_PATH)).href);
  const capital = await import(pathToFileURL(join(root, CAPITAL_PATH)).href);

  const surnames = chars(curation.HANDWRITING['签名姓氏'].chars);
  const places = chars(curation.HANDWRITING['写地址'].chars);
  const numerals = [...capital.ALL];
  const reserved = new Set([...surnames, ...places, ...numerals]);

  const removed = { surnames: [], places: [], capitalNumerals: [] };
  const kind = (ch) => (numerals.includes(ch) ? 'capitalNumerals' : surnames.includes(ch) ? 'surnames' : 'places');
  const keep = (rows, label) => {
    const out = [];
    for (const ch of rows) {
      if (reserved.has(ch)) removed[kind(ch)].push(ch + '（' + label + '）');
      else if (!out.includes(ch)) out.push(ch);
    }
    return out;
  };
  const order = keep(data.order, '主表');
  const level2 = keep((data.level2Appendix || []).map((e) => e.char), '二级附录');
  const warmup = data.warmup.order.filter((ch) => !reserved.has(ch));

  const missingCtx = numerals.filter((ch) => !capital.CONTEXTS[ch]);
  if (missingCtx.length) throw new Error('capital-numerals.mjs: no context for ' + missingCtx.join(''));
  for (const [ch, c] of Object.entries(capital.CONTEXTS)) {
    const cs = chars(c.word);
    if (cs[c.ci] !== ch) throw new Error('capital-numerals.mjs: ' + ch + ' is not at ci of ' + c.word);
    if (cs.filter((x) => x === ch).length !== 1) throw new Error('capital-numerals.mjs: ' + ch + ' repeats in ' + c.word);
    if (c.promptHint.includes(ch)) throw new Error('capital-numerals.mjs: hint of ' + ch + ' leaks the answer');
  }

  const lines = [];
  lines.push('// 新字顺序数据（D28 易忘度排序 / 热身字 / D39 姓氏与地名 / D40 大写数字）。');
  lines.push('// 由 scripts/build_char_order.mjs 生成，勿手改；换表：改输入后重跑，`--check` 在 pnpm run verify:data 里。');
  lines.push('// 排序是策划初稿（语文 / 书法顾问未审，T3 / T7 未验证）；数据与代码分离，读取方是 src/core/new-order.js。');
  lines.push('');
  lines.push('export const CHAR_ORDER = Object.freeze({');
  lines.push('  meta: Object.freeze({');
  lines.push('    status: ' + q('draft：新字顺序初稿，待语文 / 书法顾问审读；大写数字语境词待审读') + ',');
  lines.push('    // 输入文件的内容指纹（路径见 scripts/build_char_order.mjs 顶部注释）；输入一变 --check 就报「过期」，提醒重跑。');
  lines.push('    inputs: Object.freeze({');
  lines.push('      orderTable: ' + q(sha(jsonText)) + ',');
  lines.push('      curation: ' + q(sha(readFileSync(join(root, CURATION_PATH), 'utf8'))) + ',');
  lines.push('      capitalNumerals: ' + q(sha(readFileSync(join(root, CAPITAL_PATH), 'utf8'))) + ',');
  lines.push('    }),');
  lines.push('  }),');
  lines.push('  // 默认新字顺序（易忘度；已剔除 reserved）。清单外的字排在它之后，按字频序。');
  lines.push('  order: Object.freeze(' + list(order) + '),');
  lines.push('  // 二级字附录（只在用户字库含二级字时才会命中；同样已剔除 reserved）。紧接在 order 之后。');
  lines.push('  level2: Object.freeze(' + list(level2) + '),');
  lines.push('  // 热身字（高频、成年人肯定写得出，D28）：按主题行轮流排序。');
  lines.push('  warmup: Object.freeze(' + list(warmup) + '),');
  lines.push('  // 不进默认新字排序的字（含尾部字频序）：D39 姓氏、省份简称与常见地名 → 独立主题「姓氏与地名」；D40 大写数字 → 特别组。');
  lines.push('  reserved: Object.freeze({');
  lines.push('    surnames: Object.freeze(' + list(surnames) + '),');
  lines.push('    places: Object.freeze(' + list(places) + '),');
  lines.push('    capitalNumerals: Object.freeze(' + list(numerals) + '),');
  lines.push('  }),');
  lines.push('  // 从默认排序里剔除的字（逐个列出，供审读）。');
  lines.push('  removed: Object.freeze({');
  for (const k of Object.keys(removed)) lines.push('    ' + k + ': Object.freeze(' + list(removed[k]) + '),');
  lines.push('  }),');
  lines.push('  // D40 大写数字特别组：groups 各一组（按顺序），after 在两组之后进入普通新字队列最前，contexts = 特别组题面语境。');
  lines.push('  capital: Object.freeze({');
  lines.push('    groups: Object.freeze([' + capital.GROUPS.map((g) => 'Object.freeze(' + list(g) + ')').join(', ') + ']),');
  lines.push('    after: Object.freeze(' + list(capital.AFTER_GROUPS) + '),');
  lines.push('    contexts: Object.freeze({');
  for (const ch of numerals) {
    const c = capital.CONTEXTS[ch];
    lines.push('      ' + q(ch) + ': Object.freeze({ word: ' + q(c.word) + ', ci: ' + c.ci + ', py: ' + q(c.py) + ', promptHint: ' + q(c.promptHint) + ' }),');
  }
  lines.push('    }),');
  lines.push('  }),');
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

async function main(argv) {
  const check = argv.includes('--check');
  const out = join(ROOT, OUT_PATH);
  const next = await generate(ROOT);
  const prev = existsSync(out) ? readFileSync(out, 'utf8') : null;
  if (prev === next) {
    console.log(`${OUT_PATH} up to date`);
    return 0;
  }
  if (check) {
    console.error(`${OUT_PATH} is stale: run node scripts/build_char_order.mjs`);
    return 1;
  }
  writeFileSync(out, next);
  console.log(`wrote ${OUT_PATH}`);
  return 0;
}

function isMain() {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch (error) {
    return false;
  }
}

if (isMain()) process.exitCode = await main(process.argv.slice(2));
