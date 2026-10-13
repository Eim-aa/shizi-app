// 「有记录的字」完整页的纯模型（02 M3-4；04 R-A01–R-A04；03 P04 / P20 / P27 / P56；决定-D23；K15 / K16 / K19；
// 原型 字库墨墙屏-第十稿交接版.dc.html L85–L114（结构）、L367–L402（数据与文案）；reference/K-proto-home-lib.md
// 「有记录的字完整页」与附录 A）。纯函数：不访问 store / DOM；拼音与可练谓词由调用方注入（页面传 data/deck.js，单测传假表）。
//
//   allModel(state, {today, policy, compact, sort, filter, fold, find, pyOf, practicable}) → {
//     recorded, members, cols, empty,
//     sort, filter,                      // 生效的排序 / 筛选（查字命中时两者都不生效）
//     sorts: [{key, label, active}],     // R-A01 三种
//     showSort,                          // R-A04：选了筛选后排序收起；查字命中时也收起（原型 ctlOn = !found）
//     chips: [{key, label, n, active, disabled}],   // R-A02 五种（该复习了 / 还不太熟 / 记住了 / 自选未写 / 自选字，r7-C1 D61 Q5）；R-A04：0 个的筛选变灰（当前选中的仍可点来取消）
//     showChips, showLegend,
//     note,                              // 排序 / 筛选说明句（R-A01 / R-A02；原型 allNote）
//     find: {text, mode:'none'|'char'|'pinyin', query, found, chars, where, miss},   // R-A03 / R-A04
//     groups: [{key, head, name, count, tone, fold:'open'|null, month, cells:[cell]}],
//     closed: [{month, name, count}],    // 按月排时收起的月份（点开）
//     go: null | {kind:'list', listKind:'due'|'shaky'|'known'} | {kind:'start', keys:[cardKey]},  // 「练这些字 →」
//     total,                             // 所有分组的格数（页面分批画，01 §10 一次 ≤ 72 格）
//   }
//   cell = {char, kind:'hollow'|'wrong'|'ink', tone, record, py, hit}
//
// 口径：
// - 「有记录」只看 judged，同字取最近一次（按 id 序号；与字库首页 model.js 同一函数，数字两页一致）；折叠月份只算 kept
//   （与字库首页一致）。
// - 筛选三档 = 字库首页的 memoryZones（该复习了 = 最近一次写错 ∪ 到期；还不太熟；记住了），同一口径同一顺序；格子上的红点（kind
//   'wrong'）仍只表示「最近一次写错」这个事实；自选了还没写 = 自选的字里没有 judged 记录的（custom.added 顺序）；
//   自选的字 N = 全部自选的字（K19，原型 L376 D.added.length，含已写的）。
// - 排序（R-A01）：最近写的 = 按最近一次记录的月份分组（新 → 旧），默认展开最近两个月（fold 覆盖），其余收在下面；
//   拼音 = 按拼音首字母分组（去声调；没有拼音的在「其他」），每格标拼音（R-A04）；多久没写 = 四档（P56），最久的排前，
//   档内越久越前。三种排序都把「自选了还没写」一组放最前（原型 holG）。
// - 月份跨年：不是今年的月份写「{year} 年 {month} 月」（一年量级的记录会有两个同名月份；原型月份不带年，工程补，P55 待文案）。
// - 查字定位（R-A03）：输入里有汉字取第一个汉字；有记录 → 只显示它最近一次记录所在的月份，这一格描一圈，输入框右侧
//   「在 {month} 月」；没有记录 →「「X」还没有记录。」，页面照常。没有汉字、只有拼音字母（可带声调，v 当 ü）→ 拼音查
//   （R-A04）：先找读音（去声调）完全相同的字，没有再按前缀找；命中的字按月显示并描圈，只在一个月里时右侧写「在 {month} 月」；
//   一个也没有 →「「{输入}」还没有记录。」。
// - 「练这些字 →」（R-A02）：自选了还没写（有能练的字时）→ 开这次选的字（来源 allWritten，由页面调 session startPicked）；
//   三档 → 推入对应的区清单页（kind due / shaky / known，在那里勾选再练）；自选的字不显示（原型 L401）。

import * as defaultPolicy from '../../../config/policy.js';
import { t, tInk } from '../../../config/copy/index.js';
import { isValidDay, monthOf } from '../../../core/dates.js';
import { compareRecordIds } from '../../../core/records.js';
import { pyKey } from '../../../core/query.js';
import { customCharsOf, latestJudgedByChar, memoryZones, recordsOfState, toneOf, wallColumns } from './model.js';

export const SORTS = Object.freeze(['recent', 'py', 'age']);
/** 筛选（r7-C1 / D61 Q5）：字库首页三档（该复习了 / 还不太熟 / 记住了）+ 自选未写 + 自选字；旧的 wrong / forget 并入 due（写错过 ∪ 快忘了 = 该复习了）。 */
export const FILTERS = Object.freeze(['due', 'shaky', 'known', 'unw', 'custom']);
const LEGACY_FILTERS = Object.freeze({ wrong: 'due', forget: 'due' });
const ZONE_FILTERS = Object.freeze(['due', 'shaky', 'known']);
/** 按月排时默认展开最近几个月（R-A01）。 */
export const DEFAULT_OPEN_MONTHS = 2;
/** 一次最多画多少格（01 §10「有记录的字完整页按月折叠，一次 ≤ 72 格」；原型 budget=72）。页面按这个数分批画。 */
export const RENDER_BATCH = 72;

const SORT_KEYS = Object.freeze({ recent: 'R-A01.sortRecent', py: 'R-A01.sortPinyin', age: 'R-A01.sortAge' });
/** 筛选项「{名} {N}」（R-A02 只给了「自选的字 {n}」一种带数的写法，另三种按原型 L376 拼成同一格式，X-ALL.chip*）。 */
const CHIP_KEYS = Object.freeze({
  due: 'X-ALL.chipDue', shaky: 'X-ALL.chipShaky', known: 'X-ALL.chipKnown', unw: 'X-ALL.chipUnwritten', custom: 'R-A02.filterCustom',
});
const TONE_NAME_KEYS = Object.freeze(['X-LIBHOME.tone0', 'X-LIBHOME.tone1', 'X-LIBHOME.tone2', 'R-L03.toneOldest']);
const HAN = /\p{Script=Han}/u;

export function normalizeSort(sort) {
  return SORTS.includes(sort) ? sort : 'recent';
}

export function normalizeFilter(filter) {
  if (Object.prototype.hasOwnProperty.call(LEGACY_FILTERS, filter)) return LEGACY_FILTERS[filter];
  return FILTERS.includes(filter) ? filter : '';
}

/** fold 参数规整：{'YYYY-MM': boolean}。 */
export function normalizeFold(fold) {
  const out = {};
  if (fold && typeof fold === 'object' && !Array.isArray(fold)) {
    for (const [k, v] of Object.entries(fold)) if (/^\d{4}-\d{2}$/.test(k) && typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export { pyKey };

/** 拼音分组的组名：首字母大写；没有拼音 → null（「其他」）。 */
export function pyInitial(py) {
  const k = pyKey(py);
  return k ? k[0].toUpperCase() : null;
}

/**
 * 查字输入解析（R-A03 / R-A04）：有汉字 → {mode:'char', char}；只有拼音字母（可带声调、空格）→ {mode:'pinyin', query}；
 * 其余（空、数字、符号）→ {mode:'none'}。
 */
export function parseFind(text) {
  const s = typeof text === 'string' ? text : '';
  const han = Array.from(s).find(ch => HAN.test(ch));
  if (han) return { mode: 'char', char: han, query: han };
  const trimmed = s.trim();
  if (trimmed && /^[\p{Script=Latin}\p{M}\s']+$/u.test(trimmed)) {
    const q = pyKey(trimmed);
    if (q) return { mode: 'pinyin', query: q, raw: trimmed };
  }
  return { mode: 'none', query: '' };
}

/** 月份名：今年的月份「{month} 月」，别的年份「{year} 年 {month} 月」。 */
export function monthName(month, today) {
  const [y, m] = month.split('-').map(Number);
  const thisYear = isValidDay(today) ? Number(today.slice(0, 4)) : y;
  return y === thisYear ? t('X-ALL.groupMonth', { month: m }) : t('X-ALL.groupMonthYear', { year: y, month: m });
}

/** 「在 {month} 月」（跨年同上）。 */
export function foundWhere(month, today) {
  const [y, m] = month.split('-').map(Number);
  const thisYear = isValidDay(today) ? Number(today.slice(0, 4)) : y;
  return y === thisYear ? t('R-A03.foundIn', { month: m }) : t('X-ALL.foundInYear', { year: y, month: m });
}

function countText(n) {
  return t('X-ALL.groupCount', { n });
}

function monthOfRecord(record) {
  return isValidDay(record && record.localDay) ? monthOf(record.localDay) : '0000-00';
}

/** 页面参数 fold 的下一个值：点月份行（收起的）展开，点展开的月份标题收起（R-A01）。 */
export function toggleFold(fold, month, currentlyOpen) {
  return { ...normalizeFold(fold), [month]: !currentlyOpen };
}

/**
 * 全部派生数据。
 * @param {object|null} state
 * @param {{today:string, policy?:object, compact?:boolean, sort?:string, filter?:string, fold?:object, find?:string,
 *          pyOf?:(char:string)=>string, practicable?:(cardKey:string)=>boolean}} opts
 */
export function allModel(state, {
  today, policy = defaultPolicy, compact = false, width = null, sort: sortIn, filter: filterIn, fold: foldIn, find: findIn = '',
  pyOf = () => '', practicable = () => true,
} = {}) {
  const { records } = recordsOfState(state);
  const latest = latestJudgedByChar(records);
  const byNew = [...latest.values()].sort((a, b) => compareRecordIds(b.id, a.id));
  const custom = customCharsOf(state && state.custom);
  const hollow = custom.filter(c => !latest.has(c));
  const recorded = latest.size;
  const members = recorded + hollow.length;
  const cols = wallColumns(members, compact, width);

  const wrongSet = new Set(byNew.filter(r => r.judgment === 'wrong').map(r => r.char));
  const { zones } = memoryZones(state, today, {});

  const sort = normalizeSort(sortIn);
  const fold = normalizeFold(foldIn);
  const counts = { due: zones.due.n, shaky: zones.shaky.n, known: zones.known.n, unw: hollow.length, custom: custom.length };
  const requested = normalizeFilter(filterIn);
  const pyCache = new Map();
  const py = c => {
    if (!pyCache.has(c)) pyCache.set(c, String(pyOf(c) || ''));
    return pyCache.get(c);
  };

  const find = parseFind(findIn);
  let hits = [];
  if (find.mode === 'char') {
    if (latest.has(find.char)) hits = [find.char];
  } else if (find.mode === 'pinyin') {
    const exact = byNew.filter(r => pyKey(py(r.char)) === find.query).map(r => r.char);
    hits = exact.length ? exact : byNew.filter(r => pyKey(py(r.char)).startsWith(find.query)).map(r => r.char);
  }
  const found = hits.length > 0;
  const hitSet = new Set(hits);
  const filter = found ? '' : requested;

  const ink = (record, { withPy = false } = {}) => ({
    char: record.char,
    kind: wrongSet.has(record.char) ? 'wrong' : 'ink',
    tone: toneOf(record.localDay, today, policy.inkToneDays),
    record,
    py: withPy ? py(record.char) : null,
    hit: hitSet.has(record.char),
  });
  const hol = (char, { withPy = false } = {}) => ({ char, kind: 'hollow', tone: null, record: null, py: withPy ? py(char) : null, hit: false });
  const hollowGroup = withPy => ({
    key: 'hollow', head: true, name: t('R-A02.filterCustomUnwritten'), count: countText(hollow.length), tone: null, fold: null,
    month: null, cells: hollow.map(c => hol(c, { withPy })),
  });

  let groups = [];
  let closed = [];
  let note = '';
  let where = '';

  if (found) {
    // 查字命中：只显示命中的字所在的月份（R-A03「找到只显示那个月并描一圈」）；拼音查命中几个月就显示几个月。
    const months = new Map();
    for (const r of byNew) {
      const m = monthOfRecord(r);
      if (!months.has(m)) months.set(m, []);
      months.get(m).push(r);
    }
    const hitMonths = [...new Set(hits.map(c => monthOfRecord(latest.get(c))))].sort().reverse();
    groups = hitMonths.map(m => ({
      key: `m:${m}`, head: true, name: monthName(m, today), count: countText(months.get(m).length), tone: null, fold: null,
      month: m, cells: months.get(m).map(r => ink(r)),
    }));
    if (hitMonths.length === 1) where = foundWhere(hitMonths[0], today);
  } else if (filter) {
    if (filter === 'custom') {
      const done = byNew.filter(r => custom.includes(r.char));
      groups = [
        hollowGroup(false),
        { key: 'custom-done', head: true, name: t('X-ALL.groupRecorded'), count: countText(done.length), tone: null, fold: null,
          month: null, cells: done.map(r => ink(r)) },
      ];
      note = t('R-A02.customNote');
    } else {
      const cells = ZONE_FILTERS.includes(filter) ? zones[filter].items.map(item => ink(item.record)) : hollow.map(c => hol(c));
      groups = [{ key: `f:${filter}`, head: false, name: '', count: '', tone: null, fold: null, month: null, cells }];
      note = ZONE_FILTERS.includes(filter) ? t(`X-LIBFOUR.zoneTop.${filter}`) : t('R-A02.customUnwrittenNote');
    }
  } else if (sort === 'age') {
    groups = [hollowGroup(false)].concat([3, 2, 1, 0].map(tone => {
      const list = byNew.filter(r => toneOf(r.localDay, today, policy.inkToneDays) === tone).reverse();
      return { key: `t:${tone}`, head: true, name: t(TONE_NAME_KEYS[tone]), count: countText(list.length), tone, fold: null,
        month: null, cells: list.map(r => ink(r)) };
    }));
    note = t('X-ALL.ageNote');
  } else if (sort === 'py') {
    const buckets = new Map();
    const sorted = byNew.slice().sort((a, b) => {
      const ka = pyKey(py(a.char));
      const kb = pyKey(py(b.char));
      return ka < kb ? -1 : ka > kb ? 1 : a.char < b.char ? -1 : a.char > b.char ? 1 : 0;
    });
    for (const r of sorted) {
      const k = pyInitial(py(r.char)) || '#';
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(r);
    }
    const keys = [...buckets.keys()].filter(k => k !== '#').sort();
    if (buckets.has('#')) keys.push('#');
    groups = [hollowGroup(true)].concat(keys.map(k => ({
      key: `p:${k}`, head: true, name: k === '#' ? t('X-ALL.groupOther') : k, count: countText(buckets.get(k).length), tone: null,
      fold: null, month: null, cells: buckets.get(k).map(r => ink(r, { withPy: true })),
    })));
    note = t('R-A01.sortPinyinNote');
  } else {
    const months = new Map();
    for (const r of byNew) {
      const m = monthOfRecord(r);
      if (!months.has(m)) months.set(m, []);
      months.get(m).push(r);
    }
    const ms = [...months.keys()].sort().reverse();
    const def = ms.slice(0, DEFAULT_OPEN_MONTHS);
    const isOpen = m => (Object.prototype.hasOwnProperty.call(fold, m) ? fold[m] : def.includes(m));
    groups = [hollowGroup(false)].concat(ms.filter(isOpen).map(m => ({
      key: `m:${m}`, head: true, name: monthName(m, today), count: countText(months.get(m).length), tone: null, fold: 'open',
      month: m, cells: months.get(m).map(r => ink(r)),
    })));
    closed = ms.filter(m => !isOpen(m)).map(m => ({ month: m, name: monthName(m, today), count: months.get(m).length }));
    note = tInk('R-A01.sortRecentNote', undefined, policy);
  }
  groups = groups.filter(g => g.cells.length || !g.head);

  let go = null;
  if (!found && filter === 'unw') {
    const keys = hollow.map(c => `base:${c}`).filter(k => practicable(k));
    if (keys.length) go = { kind: 'start', keys };
  } else if (!found && ZONE_FILTERS.includes(filter) && counts[filter] > 0) {
    go = { kind: 'list', listKind: filter };
  }

  let miss = '';
  if (!found && find.mode === 'char') miss = t('R-A03.notFound', { char: find.char });
  else if (!found && find.mode === 'pinyin') miss = t('R-A03.notFound', { char: find.raw });

  const chips = FILTERS.map(key => {
    const n = counts[key];
    const active = key === filter;
    const label = t(CHIP_KEYS[key], { n });
    return { key, label, n, active, disabled: n === 0 && !active };
  });

  return {
    today,
    recorded,
    members,
    cols,
    empty: recorded === 0, // 与字库首页同一口径（只有自选未写也算没有记录，首页不给入口）
    sort,
    filter,
    sorts: SORTS.map(key => ({ key, label: t(SORT_KEYS[key]), active: key === sort })),
    showSort: !found && !filter,
    chips,
    showChips: !found,
    showLegend: !found,
    note: found ? '' : note,
    find: { text: typeof findIn === 'string' ? findIn : '', mode: find.mode, query: find.query, found, chars: hits, where, miss },
    groups,
    closed,
    go,
    total: groups.reduce((n, g) => n + g.cells.length, 0),
    counts,
  };
}

/** 分批画：前 limit 格（按分组顺序），分组里一格都还没轮到的不画。 */
export function takeCells(groups, limit) {
  let budget = Math.max(0, limit);
  const out = [];
  for (const g of groups) {
    if (budget <= 0 && g.head) break;
    const cells = g.cells.slice(0, budget);
    budget -= cells.length;
    if (cells.length || !g.head) out.push({ ...g, cells, partial: cells.length < g.cells.length });
  }
  return out;
}
