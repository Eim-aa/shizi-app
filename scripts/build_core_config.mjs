#!/usr/bin/env node
// 差分 JS 参考引擎的数据入口（原 ShiziCore 配置生成器；D84 后不写、不核对任何文件，没有 --check）。
//
// - Bundled/ 里 deck.json 以外的 JSON 是手改的唯一真相源（见 ios/ShiziCore/Sources/ShiziCore/Bundled/README.md）。
// - deck.json 由 scripts/build_8105_chars.py 写（overrides 原样取自 scripts/content/context-overrides.json）。
//
// 只剩两条导出，供 scripts/core-diff/ 与 scripts/core-golden/ 的 JS 参考引擎 import，随 JS 一并删除：
//   sources()      JS 引擎 config.get 的各名字（读 src/）
//   deckSources()  题库 {seed, overrides, groups}（读 Bundled/deck.json）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECK_JSON = path.join(ROOT, 'ios/ShiziCore/Sources/ShiziCore/Bundled/deck.json');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const dataExports = (mod, skip = []) => {
  const out = {};
  for (const [k, v] of Object.entries(mod)) if (typeof v !== 'function' && !skip.includes(k)) out[k] = v;
  return out;
};

/** 题库原始数据 {seed, overrides, groups}（Bundled/deck.json）。 */
export function deckSources() {
  return JSON.parse(fs.readFileSync(DECK_JSON, 'utf8'));
}

/** JS 引擎 config.get 的各名字的值（{名字: 值}，不含 deck）。 */
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
