#!/usr/bin/env node
// ShiziCore 的 deck.json 生成器（B4.1 起；D84 之后只剩这一条路径）。
//
//   node scripts/build_core_config.mjs           生成 deck.json（有变化才写）
//   node scripts/build_core_config.mjs --check   只核对 deck.json 与 deck-data.js / data/context-overrides.js 同步
//
// D84：ios/ShiziCore/Sources/ShiziCore/Bundled/ 里 deck.json 以外的 JSON 已是手改的唯一真相源（见 Bundled/README.md），本脚本不再写、不再核对它们。
// char-order.json 与 credits.json 由 build_char_order.mjs / build_credits.mjs 直接写入 Bundled（不读 src/）。
// deck.json 的真相源去向由清扫卡 B 决定，届时本脚本整个删除。
//
// sources() / cardSources() / deckSources() 仍导出：差分的 JS 参考引擎（scripts/core-diff/lib/js-ops-b41.mjs 等）读它们，随 JS 一并删除；
// 它们不再是任何构建 / 门禁的写入来源。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = path.join(ROOT, 'ios/ShiziCore/Sources/ShiziCore/Bundled');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const dataExports = (mod, skip = []) => {
  const out = {};
  for (const [k, v] of Object.entries(mod)) if (typeof v !== 'function' && !skip.includes(k)) out[k] = v;
  return out;
};

/** 各生成物的 JS 值（{文件名（不含 .json）: 值}，不含 deck）。 */
export async function sources() {
  const policy = await imp('src/config/policy.js');
  const motion = await imp('src/config/motion.js');
  const { CHAR_ORDER } = await imp('src/config/char-order.js');
  const { EPIGRAPHS } = await imp('src/config/epigraphs.js');
  const credits = await imp('src/config/credits.js');
  const deckMeta = await imp('src/config/deck-meta.js');
  const { CN_NUMERALS } = await imp('src/core/dates.js');
  const { COPY } = await imp('src/config/copy/index.js');
  const { brandGlyphPath } = await imp('src/session/views/home.js');
  const { sealGlyphPath } = await imp('src/core/images/shi-paths.js');
  const { FSRS_CONFIG } = await imp('src/core/fsrs.js');
  const verifyCopy = await imp('scripts/verify_copy.mjs');

  const source = JSON.parse(fs.readFileSync(verifyCopy.PATHS.source, 'utf8'));
  const policyCheck = await verifyCopy.checkPolicy(source);
  if (policyCheck.errors.length) throw new Error('policy check failed: ' + policyCheck.errors.join('; '));

  return {
    policy: dataExports(policy),
    'policy-meta': { registered: [...policyCheck.registered].sort(), covered: [...policyCheck.covered].sort(), exports: policyCheck.pMap },
    motion: dataExports(motion, ['M', 'css']),
    'char-order': CHAR_ORDER,
    epigraphs: EPIGRAPHS,
    credits: dataExports(credits),
    'deck-meta': dataExports(deckMeta),
    signature: CN_NUMERALS,
    copy: COPY,
    'view-seal': sealGlyphPath(),
    'view-brand': brandGlyphPath(),
    'fsrs-config': { ...FSRS_CONFIG },
    'deck-libraries': await deckLibraries(),
  };
}

/**
 * 选字用的题库索引（B4.2）：全部卡键（SEED 序，去重）、四个字库的成员（data/deck.js libraryOf，SEED 字频序）与缺省字库。
 * 卡片构建（core/cards.js）在 B4.3；Swift 的选字只要「哪些键属于哪个库、哪些键可练」，这里由 JS 现算后导出，不在 Swift 里重写字库判定。
 */
async function deckLibraries() {
  const deck = await imp('src/data/deck.js');
  const { LIBRARIES } = await imp('src/core/cards.js');
  deck.setDeckSource(deckSources());
  try {
    const keys = [...deck.getDeck().index.keys()];
    return {
      defaultLibraryId: deck.DEFAULT_LIBRARY_ID,
      keys,
      libraries: LIBRARIES.map((lib) => ({ id: lib.id, label: lib.label, officialTotal: lib.officialTotal, keys: deck.libraryOf(lib.id).keys })),
    };
  } finally {
    deck.setDeckSource(null);
  }
}

/** 题库原始数据 {seed, overrides, groups}（deck-data.js 与 data/context-overrides.js 在 vm 里求值）。 */
export function deckSources() {
  const deck = vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'deck-data.js'), 'utf8') + '\n;({ seed: SEED, groups: GROUPS })');
  const overrides = vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data/context-overrides.js'), 'utf8') + '\n;CONTEXT_OVERRIDES');
  return { seed: deck.seed, overrides, groups: deck.groups };
}

function deckText() {
  const { seed, overrides, groups } = deckSources();
  // 一行一张卡，便于审阅 diff；其余各占一行。
  return '{"seed":[\n' + seed.map((r) => JSON.stringify(r)).join(',\n') + '\n],\n"overrides":' + JSON.stringify(overrides) + ',\n"groups":' + JSON.stringify(groups) + '}\n';
}

/** 正则断言为真的码点区间（闭区间）。 */
function codePointRanges(re) {
  const out = [];
  let start = -1;
  for (let c = 0; c <= 0x10ffff; c += 1) {
    const ok = re.test(String.fromCodePoint(c));
    if (ok && start < 0) start = c;
    if (!ok && start >= 0) {
      out.push([start, c - 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, 0x10ffff]);
  return out;
}

/** B4.3 的两份规则数据（不进 sources()：它们不是 JS 引擎的 config.get 名）。 */
export async function cardSources() {
  const cards = await imp('src/core/cards.js');
  return {
    'card-rules': { promptCopy: cards.PROMPT_COPY, libraries: cards.LIBRARY_RULES, defaults: cards.CARD_DEFAULTS },
    'unicode-scripts': { han: codePointRanges(/\p{Script=Han}/u), latin: codePointRanges(/\p{Script=Latin}/u) },
  };
}

/** 全部生成物：{文件名: 文本}（D84：只有 deck.json）。 */
export async function generate() {
  return { 'deck.json': deckText() };
}

async function main() {
  const check = process.argv.includes('--check');
  const files = await generate();
  let stale = 0;
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(OUT_DIR, name);
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const rel = path.relative(ROOT, file);
    if (check) {
      if (cur !== text) {
        stale += 1;
        process.stdout.write(`过期：${rel}（node scripts/build_core_config.mjs）\n`);
      }
    } else if (cur !== text) {
      fs.writeFileSync(file, text);
      process.stdout.write(`已写：${rel}\n`);
    }
  }
  if (check) process.stdout.write(stale ? `core-config：deck.json 不同步\n` : `core-config：deck.json 与 deck-data.js 同步\n`);
  if (stale) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
