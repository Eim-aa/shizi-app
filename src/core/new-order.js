// 新字顺序（D28 易忘度排序 / D39 姓氏与地名 / D40 大写数字；03 P74 已决定 D28 / D41）。纯函数，数据来自 src/config/char-order.js
// （scripts/build_char_order.mjs 从易忘度字表初稿生成；换表只重跑脚本，这里不动）。
//
// - 默认新字顺序：易忘度清单（order，再接二级附录 level2）里属于当前字库的字，按清单顺序在前；清单外的字排在清单之后，按调用方给的原字频序。
// - 日常少用的姓氏字、省份简称与地名（D39 / D45，独立主题「姓氏与地名」；字频序 rank > 阈值才算少用，P145）与大写数字（D40，特别组）
//   不进默认排序：清单里已剔除，这里也不让它们出现在清单之后的字频尾部（reserved）。D50 ⑤ 只作姓氏的 7 字同样在 reserved.surnames；
//   D50 ⑥ 字义沉重的字在 reserved.heavy，同样不进默认排序（查字 / 自选仍可练）。常用的（熊、颜、藏、桂、厦……）按清单原位正常出现。
// - 热身字：warmup 清单里属于当前字库的字，按清单顺序。

import { CHAR_ORDER } from '../config/char-order.js';
import { charOfCardKey } from './records.js';

const cache = new WeakMap();

function indexOf(data) {
  let hit = cache.get(data);
  if (!hit) {
    const rank = new Map();
    for (const ch of [...data.order, ...data.level2]) if (!rank.has(ch)) rank.set(ch, rank.size);
    hit = {
      rank,
      reserved: new Set([...data.reserved.surnames, ...data.reserved.places, ...data.reserved.capitalNumerals, ...(data.reserved.heavy || [])]),
      warmup: new Set(data.warmup),
      warmupRank: new Map(data.warmup.map((ch, i) => [ch, i])),
      capital: new Set(data.reserved.capitalNumerals),
    };
    cache.set(data, hit);
  }
  return hit;
}

/** 不进默认排序的字（姓氏 / 地名 / 大写数字 / 字义沉重，D39 / D40 / D45 / D50）。 */
export function isReservedChar(ch, data = CHAR_ORDER) {
  return indexOf(data).reserved.has(ch);
}

/** 热身字（高频、好写）。 */
export function isWarmupChar(ch, data = CHAR_ORDER) {
  return indexOf(data).warmup.has(ch);
}

export function isWarmupKey(cardKey, data = CHAR_ORDER) {
  const ch = charOfCardKey(cardKey);
  return !!ch && isWarmupChar(ch, data);
}

/** 大写数字字。 */
export function isCapitalChar(ch, data = CHAR_ORDER) {
  return indexOf(data).capital.has(ch);
}

/**
 * 某字库的新字顺序：keys 是该字库的 cardKey（原字频序）。清单内的字按清单顺序在前，清单外的按原顺序在后；reserved 剔除。
 * 不改动入参；返回新数组。
 */
export function orderNewKeys(keys, data = CHAR_ORDER) {
  const { rank, reserved } = indexOf(data);
  const listed = [];
  const rest = [];
  for (const key of keys || []) {
    const ch = charOfCardKey(key);
    if (!ch || reserved.has(ch)) continue;
    if (rank.has(ch)) listed.push({ key, r: rank.get(ch) });
    else rest.push(key);
  }
  listed.sort((a, b) => a.r - b.r);
  return [...listed.map((x) => x.key), ...rest];
}

/** 某字库里的热身字（按热身清单顺序）。 */
export function warmupKeys(keys, data = CHAR_ORDER) {
  const { warmupRank } = indexOf(data);
  const found = [];
  for (const key of keys || []) {
    const ch = charOfCardKey(key);
    if (ch && warmupRank.has(ch)) found.push({ key, r: warmupRank.get(ch) });
  }
  found.sort((a, b) => a.r - b.r);
  return found.map((x) => x.key);
}

/** 特别组（D40）的 cardKey 分组。 */
export function capitalGroupKeys(data = CHAR_ORDER) {
  return data.capital.groups.map((g) => g.map((ch) => 'base:' + ch));
}

/** 特别组之后进入普通新字队列最前的字（佰仟）。 */
export function capitalAfterKeys(data = CHAR_ORDER) {
  return data.capital.after.map((ch) => 'base:' + ch);
}

/** 一个队列是不是「整组都是大写数字字」（写字页据此用借条 / 报销单语境，见 src/data/deck.js capitalCard）。 */
export function isCapitalQueue(queue, data = CHAR_ORDER) {
  if (!Array.isArray(queue) || !queue.length) return false;
  const { capital } = indexOf(data);
  return queue.every((key) => {
    const ch = charOfCardKey(key);
    return !!ch && capital.has(ch);
  });
}
