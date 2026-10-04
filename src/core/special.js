// D40「写写大写数字」特别组（policy.capitalNumerals，P128）。纯函数；数据（两组字、佰仟、语境词）在 src/config/char-order.js。
//
// 何时出现：累计写满 afterGroups 组后（首练算一组），且积压天数 p < belowDays 的下一次「今天的练习」，日常组换成特别组：
//   第 1 组 壹贰叁肆伍，第 2 组 陆柒捌玖拾（两组之间 p 不变，所以紧接着「再写一组」就是第 2 组；p 变大则推迟到 p 回落）。
// 只出现一次，以记录为准：某一组里「标记字」（该组的字去掉首练队列里的字——拾在首练里写过，不能当标记）只要有任何一条记录
// （判断 / 看过答案 / 跳过都算「出现过」），这一组就不再出现；之后这些字按普通 FSRS 回来。
// 佰、仟不放进这两组：两组都出现过之后，它们排在普通新字队列的最前（afterKeys），由日常配比（每组 1–3 个新字）带出来。
// 特别组的字、顺序、语境词都不手写在这里，来自 CHAR_ORDER.capital。

import { CHAR_ORDER } from '../config/char-order.js';
import { capitalAfterKeys, capitalGroupKeys } from './new-order.js';
import { charOfCardKey } from './records.js';

function charsWithAnyRecord(records) {
  const out = new Set();
  for (const r of records || []) {
    const ch = r && r.cardKey ? charOfCardKey(r.cardKey) : null;
    if (ch) out.add(ch);
  }
  return out;
}

/**
 * 「这次先写平常的字」（D46 ④）：用户在首页点了它，特别组顺延到下一个合适的日子。
 * 顺延只管点的那一天（deferredDay === today）；第二天起条件照常判断（累计组数、积压 p、两组是否出现过），满足就再出现，
 * 不另算「合适」——D41 的积压阀本来就是「合适的日子」的定义。存储在 settings.capitalDeferredDay（schema.js），写入经 store.commit
 * （session-start.js deferSpecial）。
 */
export function isDeferred(deferredDay, today) {
  return typeof deferredDay === 'string' && typeof today === 'string' && deferredDay === today;
}

/** 每一组是否已经出现过（标记字有任何记录）。 */
export function capitalProgress(records, policy, data = CHAR_ORDER) {
  const appeared = charsWithAnyRecord(records);
  const first = new Set(Array.from(policy.firstQueue || []));
  return capitalGroupKeys(data).map((keys) => {
    const marks = keys.map(charOfCardKey).filter((ch) => !first.has(ch));
    return { keys, done: marks.some((ch) => appeared.has(ch)) };
  });
}

/**
 * 下一次日常组是不是大写数字特别组。
 * @param {object} a
 * @param {Array} a.records
 * @param {{groupsTotal:number}} a.stats        practiceStats 的结果
 * @param {number} a.pressure                   积压天数 p
 * @param {(key:string)=>boolean} a.practicable
 * @param {Set<string>} a.excluded              今天不再出的字
 * @param {object} a.policy
 * @param {string|null} [a.today]               今天（YYYY-MM-DD）；与 deferredDay 一起用于「这次先写平常的字」
 * @param {string|null} [a.deferredDay]         用户点了「这次先写平常的字」的那一天（settings.capitalDeferredDay）；那天不出特别组
 * @returns {{kind:'capital1'|'capital2', keys:string[]}|null}
 */
export function capitalSpecial({ records, stats, pressure, practicable, excluded, policy, data = CHAR_ORDER, today = null, deferredDay = null }) {
  const cfg = policy.capitalNumerals;
  if (!cfg || cfg.enabled === false) return null;
  if (isDeferred(deferredDay, today)) return null;
  if (stats.groupsTotal < cfg.afterGroups || pressure >= cfg.belowDays) return null;
  const progress = capitalProgress(records, policy, data);
  for (let i = 0; i < progress.length; i += 1) {
    if (progress[i].done) continue;
    const keys = progress[i].keys.filter((key) => practicable(key) && !excluded.has(key));
    if (keys.length) return { kind: 'capital' + (i + 1), keys };
  }
  return null;
}

/** 两组特别组都出现过之后，佰仟排到普通新字队列最前；还没出现过时返回空。 */
export function capitalAfterKeysFor(records, policy, data = CHAR_ORDER) {
  const cfg = policy.capitalNumerals;
  if (!cfg || cfg.enabled === false) return [];
  const progress = capitalProgress(records, policy, data);
  return progress.length && progress.every((g) => g.done) ? capitalAfterKeys(data) : [];
}
