#!/usr/bin/env node
// 生成 ShiziCore 的配置与数据资源（B4.1；计划 B3B4-原生化架构与计划.md §4.1 / §6.2）：把 JS 一侧的规则数据导出成 JSON，Swift 只读它们，
// 不手抄任何数值与汉字（原生源码不写汉字字面量）。
//
//   node scripts/build_core_config.mjs           生成（有变化才写）
//   node scripts/build_core_config.mjs --check   只核对：生成物与 src/ 不同步则列出并退出 1
//                                                （test/core/core-config.test.mjs 在 verify:unit 里守，pnpm run verify:core-config / verify:core-diff 也跑）
//
// 输出目录 ios/ShiziCore/Sources/ShiziCore/Bundled/（SwiftPM 资源，Bundle.module 读取）：
//   policy.json        src/config/policy.js 的全部导出（{导出名: 值}）
//   policy-meta.json   policy 的 P 编号登记：{registered, covered, exports: {导出名: {p, keys: {键: [P…]}}}}（Swift 版 policy 覆盖检查读它）
//   motion.json        src/config/motion.js 的全部数据导出（duration / role / moment / easing / bezier / spring / scale / distance / gesture / timing / haptic / cssVars / roleKeys）
//   char-order.json    CHAR_ORDER
//   epigraphs.json     EPIGRAPHS
//   credits.json       CREDITS / LICENSE_TEXTS / SOURCE
//   deck-meta.json     DECK_KEY / DECK_FINGERPRINT
//   signature.json     落款汉字数字用到的字（src/core/dates.js CN_NUMERALS：digits / zero / units / two）
//   copy.json          src/config/copy 合并后的 COPY（键 → 字串 | 字串数组）
//   card-rules.json    卡片规则数据（B4.3）：{promptCopy: 题面字串（PROMPT_COPY）, libraries: 四库规则表（LIBRARY_RULES）, defaults: buildCards 缺省值（CARD_DEFAULTS）}
//   unicode-scripts.json  JS 正则 \p{Script=Han} / \p{Script=Latin} 的码点区间 {han: [[lo, hi]…], latin: […]}（node 的 Unicode 版本；Swift 标准库没有 Script 属性）
//   deck.json          题库：{seed, overrides, groups}（D84：由 scripts/build_8105_chars.py 写，本脚本只读，见 deckSources()）
//
// 生成物提交进仓库（和 deck-data.js / char-order.js 一样）；Xcode 工程接入（B4.5）时在构建阶段跑本脚本，`--check` 守不同步。
// 差分的 JS 参考引擎（scripts/core-diff/lib/js-ops-b41.mjs 的 config.get / deck.*）读同一个 sources() / deckSources()，所以 Swift 读到的 JSON 与 JS 直接 import 的值逐字段对得上。
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

/** 必须能无损过 JSON（没有 undefined / NaN / Infinity / 函数）。 */
function assertJsonSafe(value, where) {
  const walk = (x, p) => {
    if (x === undefined || typeof x === 'function') throw new Error(`${where}: ${p} is not JSON data`);
    if (typeof x === 'number' && !Number.isFinite(x)) throw new Error(`${where}: ${p} is not finite`);
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, `${p}.${k}`);
  };
  walk(value, where);
  if (JSON.stringify(JSON.parse(JSON.stringify(value))) !== JSON.stringify(value)) throw new Error(`${where}: JSON round trip changed the value`);
}

const pretty = (v) => JSON.stringify(v, null, 2) + '\n';

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

/**
 * 题库原始数据 {seed, overrides, groups}。D84 起 deck.json 本身是题库的真相源：由 scripts/build_8105_chars.py 写
 * （seed / groups 来自字表管线，overrides 原样取自 scripts/content/context-overrides.json），本脚本只读它。
 */
export function deckSources() {
  return JSON.parse(deckText());
}

// deck.json 原样列进生成物，让 --check 的「多余文件」检查认得它（内容不由本脚本决定）。
function deckText() {
  return fs.readFileSync(path.join(OUT_DIR, 'deck.json'), 'utf8');
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

/** 全部生成物：{文件名: 文本}。 */
export async function generate() {
  const out = {};
  for (const [name, value] of Object.entries({ ...(await sources()), ...(await cardSources()) })) {
    assertJsonSafe(value, name);
    out[name + '.json'] = pretty(value);
  }
  out['deck.json'] = deckText();
  return out;
}

async function main() {
  const check = process.argv.includes('--check');
  const files = await generate();
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
  const known = new Set(Object.keys(files));
  for (const f of fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : []) {
    if (!known.has(f)) {
      stale += check ? 1 : 0;
      process.stdout.write(`多余：${f}\n`);
    }
  }
  if (check) process.stdout.write(stale ? `core-config：${stale} 个不同步\n` : `core-config：${Object.keys(files).length} 个文件与 src/ 同步\n`);
  if (stale) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
