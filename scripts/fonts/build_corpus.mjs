#!/usr/bin/env node
// 第十稿字体子集语料（02 M5-2；01 §8.4；03 P22）。
//
// 子集 = #180 冻结的 F8 语料（corpus/f8/，逐字不改）∪ 第十稿界面实际要用这两款字体显示的文字：
//   ShiziKai（题面词语、参考字形回退、字源、大字）
//     文案 src/config/copy/ 全部值 + 题记 src/config/epigraphs.js + 四库名 + 题面固定字串 PROMPT_COPY
//     + 题库卡片（deck-data.js SEED 套 data/context-overrides.js 后的 word / py / hint / promptHint）
//     + 字源 data/etymology.json（gloss / source）
//   ShiziSerifSC 400 / 500（首页标题、题记、页标题、大数字、详情拼音）
//     文案 src/config/copy/ 的值（去掉只用黑体显示的 HEI_ONLY_COPY）+ 题记 + 四库名 + 题库拼音 py
// 文本先 NFC 归一化，去掉空白与控制字符，按码点收集。
//
// 输出（与 #180 同格式：一行 `U+XXXX,U+YYYY,…`，按码点升序）：
//   scripts/fonts/corpus/kai-unicodes.txt
//   scripts/fonts/corpus/serif-unicodes.txt
// 内容不变时不重写。scripts/fonts/scripts/reproduce.py 用这两份语料重建 fonts/ 下的 WOFF2。
//
// 用法：
//   node scripts/fonts/build_corpus.mjs           生成 / 更新
//   node scripts/fonts/build_corpus.mjs --check   只检查：语料与当前文案 / 题库不一致则退出码 1（先改语料再重建字体）

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

export const FONTS_TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(FONTS_TOOL_DIR, '..', '..');

const rel = p => join(ROOT, p);
const read = p => readFileSync(rel(p), 'utf8');

/** `U+0020,U+4E00,…` → Set<number> */
export function parseUnicodes(text) {
  const out = new Set();
  for (const part of String(text).trim().split(',')) {
    if (!part) continue;
    const m = /^U\+([0-9A-F]{4,6})$/i.exec(part.trim());
    if (!m) throw new Error(`bad unicode entry: ${part}`);
    out.add(parseInt(m[1], 16));
  }
  return out;
}

/** Set<number> → `U+0020,U+4E00,…`（升序，4 位起补零，大写） */
export function formatUnicodes(set) {
  return [...set].sort((a, b) => a - b).map(cp => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`).join(',') + '\n';
}

/** 文本 → 需要字形的码点（NFC；去掉空白、换行、控制字符）。 */
export function codepointsOf(text) {
  const out = new Set();
  for (const ch of String(text).normalize('NFC')) {
    if (/[\s\p{Cc}]/u.test(ch)) continue;
    out.add(ch.codePointAt(0));
  }
  return out;
}

/** 与页面相同：经典脚本在同一全局作用域求值，取 SEED 与 CONTEXT_OVERRIDES。 */
export function loadDeckGlobals(root = ROOT) {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const run = (code, filename) => new vm.Script(code, { filename }).runInContext(context, { timeout: 5000 });
  run(readFileSync(join(root, 'deck-data.js'), 'utf8'), 'deck-data.js');
  run(readFileSync(join(root, 'data/context-overrides.js'), 'utf8'), 'data/context-overrides.js');
  return {
    seed: JSON.parse(run('JSON.stringify(SEED)', 'seed')),
    overrides: JSON.parse(run('JSON.stringify(CONTEXT_OVERRIDES)', 'overrides')),
  };
}

const importRepo = p => import(pathToFileURL(rel(p)).href);

/**
 * 只在黑体（系统字体，不在 ShiziSerifSC 子集里）显示的文案键：这些值里有宋体子集里没有的字（找 昨 锁），宋体语料不收，
 * 否则每多一个这样的字都要重建字体（需要下载上游）。键必须真的只用黑体显示（设计系统 v1：一切操作与说明、统计数字用黑体）；
 * 阶段 1 P1-E5 新增，登记理由写在 copy-source.json 对应槽的 note 里。ShiziKai 子集不受影响（照旧收全部文案）。
 */
export const HEI_ONLY_COPY = Object.freeze([
  'X-FIRST.reviewFirst', // 「…再来」：首练结果页复现预告（三档口语说法，E9c 起结果页不用、留给 T3 比较），黑体 15
  'X-FIRST.reviewNext',
  'X-FIRST.reviewSame',
  'X-FIRST.daysLater', // 「N 天后再见」：结果页复现句的每字复现天数（D48，P185 / P192），黑体 15
  'X-FIRST.daysLaterTomorrow',
  'X-FIRST.laterGroup', // 复现句分句「「求」明天再见」：黑体 15
  'X-FIRST.laterSame',
  'X-INVITE.body', // 「锁屏上只出现词语和拼音……」：提醒邀请的说明，黑体 13
  'X-INVITE.bodyPlain',
  'X-ALL.menuLabel', // 「排序 · 筛选」：有记录的字页页头尾端的文字按钮与弹层标题（H1 / P223），都用黑体，「筛」不在宋体子集里
  'X-FIRST.shiWritten', // 首练结果页复现句前的「拾」那句：与复现句同一段，黑体 15（C3-H / P245）
  'X-FIRST.shiHome',
  'X-WORK.annualSaveNote', // 「存成册页：卷首、每个月、卷尾……」：年报保存弹层的说明，黑体 15，「卷」不在宋体子集里（阶段 1 P1-E7）
]);

/**
 * 第十稿各类文字（按来源分组，单测与生成共用）。copySerif = copy 去掉 HEI_ONLY_COPY（宋体子集要覆盖的文案）。
 * @returns {Promise<{copy:string, copySerif:string, epigraphs:string, libraries:string, promptCopy:string,
 *   deckWords:string, deckPinyin:string, deckHints:string, etymology:string}>}
 */
export async function appTexts() {
  const { COPY } = await importRepo('src/config/copy/index.js');
  const { EPIGRAPHS } = await importRepo('src/config/epigraphs.js');
  const { LIBRARIES, PROMPT_COPY, buildCards } = await importRepo('src/core/cards.js');
  const { seed, overrides } = loadDeckGlobals();
  const cards = buildCards({ seed, overrides });
  const ety = JSON.parse(read('data/etymology.json'));
  return {
    copy: Object.values(COPY).join('\n'),
    copySerif: Object.entries(COPY).filter(([key]) => !HEI_ONLY_COPY.includes(key)).map(([, value]) => value).join('\n'),
    epigraphs: EPIGRAPHS.map(e => [...e.lines, e.source].join('\n')).join('\n'),
    libraries: LIBRARIES.map(l => l.label).join('\n'),
    promptCopy: Object.values(PROMPT_COPY).join('\n'),
    deckWords: cards.map(c => c.word).join('\n'),
    deckPinyin: cards.map(c => c.py).join('\n'),
    deckHints: cards.map(c => [c.hint || '', c.promptHint || ''].join('\n')).join('\n'),
    etymology: (Array.isArray(ety) ? ety : Object.values(ety)).map(e => [e.gloss || '', e.source || ''].join('\n')).join('\n'),
  };
}

/** 各 face 要覆盖的文字来源（单测按同一张表逐项断言缺字为 0）。 */
export const FACE_SOURCES = Object.freeze({
  'ShiziKai:400': Object.freeze(['copy', 'epigraphs', 'libraries', 'promptCopy', 'deckWords', 'deckPinyin', 'deckHints', 'etymology']),
  'ShiziSerifSC:400': Object.freeze(['copySerif', 'epigraphs', 'libraries', 'deckPinyin']),
  'ShiziSerifSC:500': Object.freeze(['copySerif', 'epigraphs', 'libraries', 'deckPinyin']),
});

const CORPUS = Object.freeze({
  kai: { f8: 'scripts/fonts/corpus/f8/kai-unicodes.txt', out: 'scripts/fonts/corpus/kai-unicodes.txt', face: 'ShiziKai:400' },
  serif: { f8: 'scripts/fonts/corpus/f8/serif-unicodes.txt', out: 'scripts/fonts/corpus/serif-unicodes.txt', face: 'ShiziSerifSC:400' },
});

export async function plan() {
  const texts = await appTexts();
  const outputs = [];
  for (const [name, spec] of Object.entries(CORPUS)) {
    const f8 = parseUnicodes(read(spec.f8));
    const set = new Set(f8);
    const added = [];
    for (const key of FACE_SOURCES[spec.face]) {
      for (const cp of codepointsOf(texts[key])) {
        if (!set.has(cp)) {
          set.add(cp);
          added.push(cp);
        }
      }
    }
    outputs.push({ name, rel: spec.out, text: formatUnicodes(set), f8: f8.size, total: set.size, added: added.sort((a, b) => a - b) });
  }
  return outputs;
}

async function main(argv) {
  const check = argv.includes('--check');
  let stale = 0;
  for (const o of await plan()) {
    const abs = rel(o.rel);
    const same = existsSync(abs) && readFileSync(abs, 'utf8') === o.text;
    const addedText = o.added.map(cp => String.fromCodePoint(cp)).join('');
    console.log(`[font-corpus] ${o.name}: F8 ${o.f8} + v10 ${o.added.length} = ${o.total}${o.added.length ? ` (${addedText})` : ''}`);
    if (same) continue;
    stale += 1;
    if (check) console.error(`[font-corpus] stale: ${o.rel} (run: node scripts/fonts/build_corpus.mjs, then rebuild fonts)`);
    else {
      writeFileSync(abs, o.text);
      console.log(`[font-corpus] wrote ${o.rel}`);
    }
  }
  return check && stale ? 1 : 0;
}

function isMain() {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch (error) {
    return false;
  }
}

if (isMain()) {
  process.exitCode = await main(process.argv.slice(2));
}
