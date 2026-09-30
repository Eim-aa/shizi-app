// 题库运行时访问（01-架构设计 §2 data/ 层：deck 加载）。M2-2 把 M1-8 prompt.js 直接读 SEED / CONTEXT_OVERRIDES 全局的
// 临时做法收回到这里；写字页题面、选字（今天的练习的新字来源）、S02 列字都从这里取卡。
//
// 数据来源：index.html 里的 defer 经典脚本 deck-data.js（全局词法名 SEED）与 data/context-overrides.js
// （CONTEXT_OVERRIDES），文档顺序在 app.js 之前执行（01 §8.5）。它们不是 window 属性，只能用 typeof 读。
// 接口按异步设计（#125 分片以后 loadDeck() 真正去取数据）：现在 loadDeck() 读全局后立即 resolve；
// 同步访问器（cardForKey / allCards / libraryOf …）在首次调用时按同一来源懒建索引，deck 未就绪返回空 / null 且不缓存。
//
// 测试：setDeckSource({seed, overrides}) 注入数据（node:test 无全局）；setCardResolver(fn) 覆盖单卡查找（e2e 合成卡）。

import { buildCards, cardKey as keyOfCard, LIBRARIES, libraryById } from '../core/cards.js';
import * as policy from '../config/policy.js';

/**
 * 没有选过字库时的练习范围：policy.defaultLibrary（P73 过渡默认 core3500，沿旧版 B-scheduling §7；换库属 M3-5）。
 * policy 里写了未知 id 时退回第一个字库。
 */
export const DEFAULT_LIBRARY_ID = libraryById(policy.defaultLibrary) ? policy.defaultLibrary : LIBRARIES[0].id;

let deck = null; // {cards, index: Map<cardKey, card>, keys: string[]}
let injected = null; // {seed, overrides}
let resolver = null;

function readDeckGlobals() {
  let seed;
  let overrides;
  try {
    // eslint-disable-next-line no-undef
    seed = typeof SEED !== 'undefined' ? SEED : undefined;
  } catch (error) {
    seed = undefined;
  }
  try {
    // eslint-disable-next-line no-undef
    overrides = typeof CONTEXT_OVERRIDES !== 'undefined' ? CONTEXT_OVERRIDES : undefined;
  } catch (error) {
    overrides = undefined;
  }
  return { seed, overrides };
}

/** 由 cards[] 建 cardKey → card 索引（同键取第一张，与旧 CARDS 查找一致）。 */
export function indexCards(cards) {
  const map = new Map();
  for (const card of cards || []) {
    const key = keyOfCard(card);
    if (!map.has(key)) map.set(key, card);
  }
  return map;
}

function build() {
  if (deck) return deck;
  const { seed, overrides } = injected || readDeckGlobals();
  if (!Array.isArray(seed)) return null; // deck 未加载：不缓存，下次再试
  const cards = buildCards({ seed, overrides: overrides && typeof overrides === 'object' ? overrides : {} });
  const index = indexCards(cards);
  deck = { cards, index, keys: [...index.keys()] };
  return deck;
}

/**
 * 加载题库（异步接口；#125 分片前只读全局）。resolve 为 {cards, index, keys}；deck 不可用时 reject。
 */
export function loadDeck() {
  const d = build();
  return d ? Promise.resolve(d) : Promise.reject(new Error('deck is not available (SEED missing)'));
}

/** 已加载的题库（懒建）；未就绪返回 null。 */
export function getDeck() {
  return build();
}

/** 测试 / 演示：注入 SEED 与语境覆盖（null 复原为读全局）；清掉已建索引。 */
export function setDeckSource(source) {
  injected = source && Array.isArray(source.seed) ? { seed: source.seed, overrides: source.overrides || {} } : null;
  deck = null;
}

/** 全部题库卡（SEED 字频序）；未就绪返回空数组。 */
export function allCards() {
  const d = build();
  return d ? d.cards : [];
}

/**
 * cardKey → 卡片（base:<字> 查题库；custom:<字> 本轮不在写字页出现，返回 null）。
 * setCardResolver 注入的 resolver(key) 返回卡片即采用，返回 undefined 则回落到题库。
 */
export function cardForKey(key) {
  if (typeof key !== 'string' || !key) return null;
  if (resolver) {
    const hit = resolver(key);
    if (hit !== undefined) return hit;
  }
  if (!key.startsWith('base:')) return null;
  const d = build();
  return (d && d.index.get(key)) || null;
}

/** 测试 / 演示用：替换卡片查找（null 复原）。 */
export function setCardResolver(fn) {
  resolver = typeof fn === 'function' ? fn : null;
}

/** 可练 = 题库里的 base: 卡（01 §3.1 practicable）。 */
export function isPracticable(key) {
  return typeof key === 'string' && key.startsWith('base:') && !!cardForKey(key);
}

/** settings.library 若是已知字库则用它，否则默认库。 */
export function currentLibraryId(settings) {
  const id = settings && typeof settings.library === 'string' ? settings.library : null;
  return id && libraryById(id) ? id : DEFAULT_LIBRARY_ID;
}

/**
 * 某个字库：{id, label, officialTotal, cards, keys}（cards / keys 为题库里属于该库的卡，SEED 字频序）；未知 id 返回 null。
 * 按库缓存（题库不变时）。
 */
const libraryCache = new Map();
export function libraryOf(id) {
  const lib = libraryById(id);
  if (!lib) return null;
  const d = build();
  if (!d) return { id: lib.id, label: lib.label, officialTotal: lib.officialTotal, cards: [], keys: [] };
  const hit = libraryCache.get(id);
  if (hit && hit.deck === d) return hit.value;
  const cards = d.cards.filter(card => lib.test(card));
  const value = Object.freeze({ id: lib.id, label: lib.label, officialTotal: lib.officialTotal, cards, keys: cards.map(keyOfCard) });
  libraryCache.set(id, { deck: d, value });
  return value;
}

/** 某张卡属于哪些字库（id 列表）。 */
export function libraryIdsOfKey(key) {
  const card = cardForKey(key);
  return card ? LIBRARIES.filter(lib => lib.test(card)).map(lib => lib.id) : [];
}

/** 选字用的题库适配器（core/session-start 的 deck 参数）：新字来源 = 当前练习范围（SEED 字频序），可练谓词。 */
export const deckAdapter = Object.freeze({
  newCandidates: libraryId => {
    const lib = libraryOf(libraryId) || libraryOf(DEFAULT_LIBRARY_ID);
    return lib ? lib.keys : [];
  },
  practicable: isPracticable,
  currentLibraryId,
});
