// 查字 / 自己选字组件的纯逻辑（M2-0；决定-D21；04 R-Q01–R-Q06、R-H06；03 P42 / P43 / P45）。
//
// 纯 ES 模块：不碰 DOM、存储、网络与文案表，node:test 直接跑。文案由 UI 按这里给出的 copy 键取
// （src/config/copy/query.js），数字 / 字作为占位符值一并给出。
//
//   filterInput(text, {max})          输入过滤：只保留汉字（\p{Script=Han}）、按出现顺序去重、上限（P45 / O05，
//                                     policy.queryInputMax；null = 不设上限、不截断）；统计去掉的非汉字码点数与重复的字。
//   filterNotes(filtered, view)       输入过滤提示（R-Q03 三种）：只能输入汉字 / 已去掉 N 个字母或符号 / 重复的「X」只算一次。
//   flattenRecords(recordsDomain)     store 的 records 域（按月数组或折叠月 kept）→ 平铺数组。
//   isPracticable(char, {inDeck, inLibrary})   「不能练」判定：不在当前库且不在题库 → false。
//   charSummary(char, {...})          逐字记录情况摘要（记录次数、最近一次 judged、是否自选、sched 到期日、能不能练）。
//   rowStatus(summary)                行尾记录情况（R-Q04 / P43）→ {key, vars}。
//   cardStat(summary)                 卡片记录行（R-Q05.cardStat / R-Q04.rowNone）→ {key, vars}。
//   queryView({chars, cur, practicable})   视图：hint（未输入）/ rows（多字）/ card（一个字，能练）/ bad（一个字，不能练）。
//   selectedChars(chars, selected, practicable)   pick 多选：只保留仍在输入里、能练的已选字（按输入顺序）。
//   pickBar(count)                    pick 底栏（R-Q06）：0 个「先选一个字」真禁用；1 个「练这个字」；N 个「练这 N 个字」。
//   isCustom(custom, char) / withCustomAdded(custom, char, at)   custom 域（01 §3.5 `{added:[{char, at}]}`）；
//                                     加入只在用户点「加入」时由 UI 经 store.commit 调用（决定-D21），本模块不写任何东西。

import * as defaultPolicy from '../config/policy.js';
import { isJudged, judgedCountOfCard, latestJudged } from './records.js';

/** 汉字判定（与原型 字库墨墙屏 L249 `HAN` 同一条件）。 */
export const HAN_RE = /\p{Script=Han}/u;

export function isHan(ch) {
  return typeof ch === 'string' && Array.from(ch).length === 1 && HAN_RE.test(ch);
}

/**
 * 输入过滤（R-Q03；P45 上限）。
 * @param {string} text  输入框原文（保留原样，不截断，P45）
 * @param {{max?: number|null}} [o]  max 缺省读 policy.queryInputMax；null / 非正整数 = 不设上限
 * @returns {{chars:string[], removed:number, duplicates:string[], hanCount:number, overLimit:number, total:number}}
 *   chars：去重后的汉字（按第一次出现的顺序，超上限的截在这里）；removed：去掉的非汉字码点数（字母、数字、符号、空格）；
 *   duplicates：出现不止一次的字（按第一次重复出现的顺序）；hanCount：汉字码点总数（含重复）；
 *   overLimit：超出上限没列出的不同汉字个数；total：原文码点数。
 */
export function filterInput(text, { max = defaultPolicy.queryInputMax } = {}) {
  const all = Array.from(typeof text === 'string' ? text : '');
  const seen = new Set();
  const dupSet = new Set();
  const unique = [];
  const duplicates = [];
  let hanCount = 0;
  for (const ch of all) {
    if (!HAN_RE.test(ch)) continue;
    hanCount += 1;
    if (seen.has(ch)) {
      if (!dupSet.has(ch)) {
        dupSet.add(ch);
        duplicates.push(ch);
      }
      continue;
    }
    seen.add(ch);
    unique.push(ch);
  }
  const cap = Number.isInteger(max) && max > 0 ? max : null;
  const chars = cap === null ? unique : unique.slice(0, cap);
  return {
    chars,
    removed: all.length - hanCount,
    duplicates,
    hanCount,
    overLimit: unique.length - chars.length,
    total: all.length,
  };
}

/**
 * 输入过滤提示（R-Q03）。规则沿原型（字库墨墙屏 L427–L428）：
 *   有非汉字且一个汉字都没有 →「只能输入汉字。」；有非汉字也有汉字 →「只能输入汉字，已去掉 N 个字母或符号。」；
 *   有重复且在逐字行视图 →「重复的「X」只算一次。」（多个重复字时「重复的「X」「Y」只算一次。」，X-QUERY.duplicateMany）。
 * @returns {Array<{key:string, vars?:object}>}
 */
export function filterNotes(filtered, view) {
  const notes = [];
  if (!filtered) return notes;
  if (filtered.removed > 0 && filtered.chars.length === 0) notes.push({ key: 'R-Q03.onlyHanzi' });
  else if (filtered.removed > 0) notes.push({ key: 'R-Q03.removed', vars: { n: filtered.removed } });
  if (filtered.duplicates.length && view === 'rows') {
    const listed = filtered.duplicates.filter(ch => filtered.chars.includes(ch));
    if (listed.length === 1) notes.push({ key: 'R-Q03.duplicate', vars: { char: listed[0] } });
    else if (listed.length > 1) notes.push({ key: 'X-QUERY.duplicateMany', vars: { chars: listed.map(c => `「${c}」`).join('') } });
  }
  return notes;
}

/** store 的 records 域 → 平铺记录数组（按月数组，或折叠月的 kept）。 */
export function flattenRecords(recordsDomain) {
  const out = [];
  const months = recordsDomain && typeof recordsDomain === 'object' ? recordsDomain : {};
  for (const month of Object.keys(months)) {
    const value = months[month];
    const list = Array.isArray(value) ? value : value && Array.isArray(value.kept) ? value.kept : [];
    for (const r of list) out.push(r);
  }
  return out;
}

export function baseKey(char) {
  return `base:${char}`;
}

/**
 * 「不能练」判定（任务卡 M2-0）：不在当前库且不在题库 → 不能练。
 * inDeck(char)：题库（7218 张基础卡）有没有这个字；inLibrary(char)：当前练习范围（settings.library）有没有。
 * 两个谓词都缺省为「没有」。
 */
export function isPracticable(char, { inDeck = null, inLibrary = null } = {}) {
  if (!isHan(char)) return false;
  const lib = typeof inLibrary === 'function' ? !!inLibrary(char) : false;
  const deck = typeof inDeck === 'function' ? !!inDeck(char) : false;
  return lib || deck;
}

export function customChars(custom) {
  const added = custom && Array.isArray(custom.added) ? custom.added : [];
  return added.map(e => e && e.char).filter(Boolean);
}

export function isCustom(custom, char) {
  return customChars(custom).includes(char);
}

/**
 * custom 域加一个字（决定-D21：只在用户点「加入」时调用）。已在里面返回 null（不产生写入）。
 * 不改动入参；返回新的 custom 对象（01 §3.5 形状 `{added:[{char, at}]}`，其余键原样保留）。
 */
export function withCustomAdded(custom, char, at) {
  if (!isHan(char)) throw new TypeError('withCustomAdded: char must be a single Han character');
  if (!Number.isFinite(at)) throw new TypeError('withCustomAdded: at must be a number');
  const base = custom && typeof custom === 'object' && !Array.isArray(custom) ? custom : {};
  const added = Array.isArray(base.added) ? base.added : [];
  if (added.some(e => e && e.char === char)) return null;
  return { ...base, added: added.concat([{ char, at }]) };
}

/**
 * 逐字记录情况摘要（记录 = judged，01 §3.2；「记录了 N 次」= 该字 judged 条数）。
 * @param {string} char
 * @param {{records?:object[], sched?:object|null, custom?:object|null, practicable?:boolean}} o
 * @returns {{char, cardKey, practicable, custom, count, latest, latestDay, due}}
 */
export function charSummary(char, { records = [], sched = null, custom = null, practicable = false } = {}) {
  const cardKey = baseKey(char);
  const count = judgedCountOfCard(records, cardKey);
  const latest = count ? latestJudged(records, cardKey) : null;
  const entry = sched && typeof sched === 'object' ? sched[cardKey] : null;
  return {
    char,
    cardKey,
    practicable: !!practicable,
    custom: isCustom(custom, char),
    count,
    latest: latest && isJudged(latest) ? latest : null,
    latestDay: latest ? latest.localDay || null : null,
    due: entry && typeof entry.due === 'string' ? entry.due : null,
  };
}

/**
 * 行尾记录情况（R-Q04；「自选的字 · …」完整字样按 P43 过渡默认）。
 * 不能练优先（原型 L435：不能练的字只写「暂时不能练」）。
 */
export function rowStatus(summary) {
  if (!summary.practicable) return { key: 'R-Q04.rowUnavailable' };
  if (summary.custom) {
    return summary.count ? { key: 'R-Q04.rowCustomCount', vars: { n: summary.count } } : { key: 'R-Q04.rowCustomNone' };
  }
  return summary.count ? { key: 'R-Q04.rowCount', vars: { n: summary.count } } : { key: 'R-Q04.rowNone' };
}

/** 卡片记录行：有记录「记录了 N 次 · 最近一次 {date}」，否则「还没有记录」（原型 L442–L443）。date 由 UI 按 localDay 格式化。 */
export function cardStat(summary) {
  if (summary.count && summary.latestDay) return { key: 'R-Q05.cardStat', vars: { n: summary.count, day: summary.latestDay } };
  return { key: 'R-Q04.rowNone' };
}

/**
 * 视图（原型 L417）：cur = 显式选中的字（仍在输入里）或输入只有一个字时的那个字；
 * 有 cur → 能练 card / 不能练 bad；多个字 → rows；没有字 → hint。
 */
export function queryView({ chars = [], cur = '', practicable = () => false } = {}) {
  const current = cur && chars.includes(cur) ? cur : chars.length === 1 ? chars[0] : '';
  if (current) return { view: practicable(current) ? 'card' : 'bad', cur: current };
  return { view: chars.length ? 'rows' : 'hint', cur: '' };
}

/** pick 多选：已选字里仍在输入中、且能练的（按输入顺序）。 */
export function selectedChars(chars, selected, practicable = () => true) {
  const set = selected instanceof Set ? selected : new Set(selected || []);
  return (chars || []).filter(c => set.has(c) && practicable(c));
}

/** pick 底栏（R-Q06）：0 个真禁用（disabled + aria-disabled 由 Button 给）。 */
export function pickBar(count) {
  if (!count) return { key: 'R-Q06.btnNone', vars: undefined, disabled: true };
  if (count === 1) return { key: 'R-Q05.btnPractice', vars: undefined, disabled: false };
  return { key: 'R-Q06.btnPracticeN', vars: { n: count }, disabled: false };
}

/** 模式（P42：只保留 lookup / pick）。 */
export function normalizeMode(mode, policy = defaultPolicy) {
  const modes = policy.queryModes || ['lookup', 'pick'];
  if (!modes.includes(mode)) throw new RangeError(`query mode must be one of ${modes.join(' / ')} (P42), got ${String(mode)}`);
  return mode;
}
