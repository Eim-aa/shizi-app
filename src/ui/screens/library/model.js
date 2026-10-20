// 字库首页（墨墙）数据模型（纯函数，无 DOM；02 M3-1；R-L01–R-L04、R-L07–R-L10；test/ui/library.test.mjs 直接调用）。
//
//   libraryHomeModel(state, today, {policy, compact}) → {
//     today, libraryId,
//     recorded,                       // 顶部大数字：有 judged 记录的字数（R-L10：从记录算；P10b 旧照片不算）
//     hollow: [char],                 // 自选了还没写（custom.added 顺序；没有任何 judged 记录的字）
//     firstDay,                       // 「从 X 开始记录」的 X：第一条有效记录的日期（P63 过渡：日期；折叠月份的 byDay 也算）
//     facts: [{kind:'customUnwritten', n} | {kind:'since', day}],   // 两条事实（原型字库墨墙屏 L357 factA/factB）
//     wrong:  {chars, items:[{char, record}]},                      // 写错过卡片（K15；最近写错的排前）
//     forget: {chars, items:[{char, record, tone}], total},          // 快忘了卡片（K16 / P04 policy.forgetRule / forgetCap）
//     wall: {cols, rows, cells:[{char, kind:'hollow'|'wrong'|'ink', tone（hollow 为 null，其余 0–3）, record}], members, more},
//     empty,                          // 没有任何有效记录 → 空态（R-L05 两句 + 「你写下的字会留在这里」）
//   }
//
// 口径（原型 字库墨墙屏-第十稿交接版.dc.html L324–L363，reference/K-proto-home-lib.md §2 / 附录 B）：
// - 「记录」只看 judged（01 §3.2、决定-D18/D23）；「最近一次」按 id 序号（01 §3.1），墙上按最近一次新 → 旧。
// - 墙：自选了还没写（空心）排最前 → 其余按最近一次判断新 → 旧；最多 8 行（cols × 8 格，R-L02）；写错过（最近一次 judged 为
//   wrong）画标准字 + 朱点，不画那一次写错的笔迹（K28 / R-L08）；写错不再改字色与大小（设计系统 v1 设计说明 16），所有 judged 格按最近一次记录
//   距今天数分四档（P56 policy.inkToneDays，≤7 / ≤30 / ≤90 / 更久），四档取令牌 wall1–wall4 的独立色值。
// - 列数（设计系统 v1，P1-E1b：tokens.json components.wall）：标准 8 列、Pro Max 9 列，一格不窄于 44pt（列数 = min(上限, ⌊(屏宽 − 40) ÷ 44⌋)：393 / 402 → 8、440 → 9、375 → 7、320 → 6）；系统大字号最多 6 列；与墙成员多少无关。
//   旧版按成员数 5 / 8 列、紧凑 4 / 6 列（原型 L339）作废。
// - 墙底「还有 N 个字 ›」：N = 墙成员 − 已画格数（P27 policy.wallMoreScope='wall-members'，含自选未写）；
//   'records' 口径时只数有记录的字。没截断时 N = 0，不显示（R-L02 / 走查-L09：大数字才是进完整页的常设入口）。
// - 空态：没有 judged 记录（原型 noRec = nRec===0；只有自选未写时也是空态，原型 hasWall = nRec>0）。

import * as defaultPolicy from '../../../config/policy.js';
import { diffDays, isValidDay } from '../../../core/dates.js';
import { compareRecordIds, forgetList, isJudged, practicedByChar } from '../../../core/records.js';
import { overdueDays } from '../../../core/fsrs.js';
import { homeModel } from '../home/today.js';
import { aStartInfo, planDaily } from '../../../core/session-start.js';
import { selectFirst } from '../../../core/sessions.js';

/** 墙最多几行（R-L02 / 原型 L363 cols*8）。 */
export const WALL_MAX_ROWS = 8;
/** 样字个数（D49 减法稿：每块一排最该练的 5 个样字，D36；原型 L358 的前 4 个作废）。 */
export const CARD_MINI_MAX = 5;
/**
 * 列数（设计系统 v1，tokens.json components.wall：8 列，Pro Max 9 列）：最多 9 列、系统大字号最多 6 列，并且一格不窄于 minCell（44pt 触控）——
 * 列数 = min(上限, ⌊(屏宽 − 2 × 页边) ÷ 44⌋)。393 / 402 宽 → 8，440 宽 → 9，375 宽 → 7，320 宽 → 6；屏宽未知时按标准 8（大字 6）。
 */
export const WALL_COLS = Object.freeze({ standard: 8, max: 9, large: 6, minCell: 44, gutter: 20 });

/** store 状态 → {records（平铺）, foldedDays（折叠月份的练习日）}。 */
export function recordsOfState(state) {
  const records = [];
  const foldedDays = [];
  const months = (state && state.records) || {};
  for (const month of Object.keys(months).sort()) {
    const value = months[month];
    if (Array.isArray(value)) {
      for (const r of value) records.push(r);
    } else if (value && typeof value === 'object') {
      if (Array.isArray(value.kept)) for (const r of value.kept) records.push(r);
      if (value.byDay && typeof value.byDay === 'object') {
        for (const [day, chars] of Object.entries(value.byDay)) if (Array.isArray(chars) && chars.length) foldedDays.push(day);
      }
    }
  }
  return { records, foldedDays };
}

/** 每个字最近一次 judged 记录（按 id 序号；一字一卡，按 char 聚合）。 */
export function latestJudgedByChar(records) {
  const latest = new Map();
  for (const r of records || []) {
    if (!isJudged(r) || typeof r.char !== 'string') continue;
    const prev = latest.get(r.char);
    if (!prev || compareRecordIds(prev.id, r.id) < 0) latest.set(r.char, r);
  }
  return latest;
}

/**
 * 墨色档位（P56）：最近一次记录距今天 ≤ days[0] → 0，≤ days[1] → 1，≤ days[2] → 2，更久 → 3。
 * 日期不合法（不该出现）按最淡一档。
 */
export function toneOf(day, today, days = defaultPolicy.inkToneDays) {
  if (!isValidDay(day) || !isValidDay(today)) return 3;
  const ago = diffDays(day, today);
  const d = Array.isArray(days) && days.length >= 3 ? days : [7, 30, 90];
  if (ago <= d[0]) return 0;
  if (ago <= d[1]) return 1;
  if (ago <= d[2]) return 2;
  return 3;
}

/** 墙列数（设计系统 v1）：large = 系统大字号；width = 屏宽（css px，缺省按标准 8 列）。members 不再影响列数。 */
export function wallColumns(members, large = false, width = null) {
  const cap = large ? WALL_COLS.large : WALL_COLS.max;
  if (!Number.isFinite(width) || width <= 0) return large ? WALL_COLS.large : WALL_COLS.standard;
  const byWidth = Math.floor((width - 2 * WALL_COLS.gutter) / WALL_COLS.minCell);
  return Math.max(4, Math.min(cap, byWidth));
}

/** 自选的字（custom.added 顺序，去重、只留单个字）。 */
export function customCharsOf(custom) {
  const added = custom && Array.isArray(custom.added) ? custom.added : [];
  const out = [];
  for (const e of added) {
    const c = e && typeof e.char === 'string' ? e.char : null;
    if (c && Array.from(c).length === 1 && !out.includes(c)) out.push(c);
  }
  return out;
}

/** 第一条有效记录的日期（P63）：judged 记录与折叠月份练习日里最早的一天；没有返回 null。 */
export function firstRecordDay(records, foldedDays = []) {
  let first = null;
  for (const r of records || []) {
    if (!isJudged(r) || !isValidDay(r.localDay)) continue;
    if (!first || r.localDay < first) first = r.localDay;
  }
  for (const day of foldedDays || []) if (isValidDay(day) && (!first || day < first)) first = day;
  return first;
}

/**
 * 字库首页全部派生数据。
 * @param {object|null} state  store 状态（未启动时 null → 按空状态算）
 * @param {string} today       本地日 YYYY-MM-DD（应用时钟）
 * @param {{policy?:object, compact?:boolean}} [opts]
 */
export function libraryHomeModel(state, today, { policy = defaultPolicy, compact = false, width = null } = {}) {
  const { records, foldedDays } = recordsOfState(state);
  const latest = practicedByChar(records); // D66 ⑤：已练汉字 = 有判断 ∪ 看过答案
  const recorded = latest.size;
  const hollow = customCharsOf(state && state.custom).filter(c => !latest.has(c));
  const firstDay = recorded ? firstRecordDay(records, foldedDays) : null;

  const facts = [];
  if (recorded) {
    if (hollow.length) facts.push({ kind: 'customUnwritten', n: hollow.length });
    if (firstDay) facts.push({ kind: 'since', day: firstDay });
  }

  // 最近一次 judged，新 → 旧（按 id）。
  const byNew = [...latest.values()].sort((a, b) => compareRecordIds(b.id, a.id));
  const wrongItems = byNew.filter(r => r.judgment === 'wrong')
    .map(record => ({ char: record.char, record, tone: toneOf(record.localDay, today, policy.inkToneDays) }));
  const wrongSet = new Set(wrongItems.map(w => w.char));

  const fl = forgetList({ records, sched: state && state.sched, today, policy });
  const forgetItems = fl.items
    .map(({ record }) => ({ char: record.char, record, tone: toneOf(record.localDay, today, policy.inkToneDays) }))
    .filter(item => !wrongSet.has(item.char)); // K16 互斥（forgetList 已只取写对的；防御）

  const members = hollow.length + recorded;
  const cols = wallColumns(members, compact, width);
  const cap = cols * WALL_MAX_ROWS;
  const ordered = hollow.map(char => ({ char, kind: 'hollow', tone: null, record: null }))
    .concat(byNew.map(record => ({
      char: record.char,
      kind: wrongSet.has(record.char) ? 'wrong' : 'ink',
      tone: toneOf(record.localDay, today, policy.inkToneDays),
      record,
    })));
  const cells = recorded ? ordered.slice(0, cap) : [];
  let more = 0;
  if (recorded) {
    if (policy.wallMoreScope === 'records') more = Math.max(0, recorded - cells.filter(c => c.kind !== 'hollow').length);
    else more = Math.max(0, members - cells.length);
  }

  return {
    today,
    libraryId: state && state.settings && typeof state.settings.library === 'string' ? state.settings.library : null,
    recorded,
    hollow,
    firstDay,
    facts,
    wrong: { chars: wrongItems.map(w => w.char), items: wrongItems },
    forget: { chars: forgetItems.map(f => f.char), items: forgetItems, total: fl.total },
    wall: { cols, rows: Math.ceil(cells.length / cols), cells, members, more },
    empty: recorded === 0,
  };
}

/**
 * 样字（D49 减法稿 / 实现交接 §14.1：每块一排最该练的 5 个，30pt 标准字形，颜色 wall1，不画朱点——写错过与快忘了同一个样子）。
 * items 已经按「最该练」排好（写错过 = 最近写错的，快忘了 = 到期最久的，D36）；kind 只留作调用方对照，不再影响画法。
 */
export function cardMini(items, kind) { // eslint-disable-line no-unused-vars
  return (items || []).slice(0, CARD_MINI_MAX).map(item => ({
    char: item.char,
    kind: 'sample',
    tone: 0,
    record: null,
  }));
}

// ---------------------------------------------------------------- r7-L1（D60）：字库首页的「今天要写」与三档记忆状态

/** 记住了：稳定度 ≥ 这么多天（D60：三周以上才回来一次）。 */
export const KNOWN_STABILITY_DAYS = 21;
/** 区样字个数（D60：每行最多三个）。 */
export const ZONE_SAMPLE_MAX = 3;
/** 三档，自上而下（D60）。 */
export const MEMORY_ZONES = Object.freeze(['due', 'shaky', 'known']);
/**
 * 三档样字的本人墨档位（wall.js 的档位 0–3 对应 --wall1…--wall4）：该复习了 wall4（最淡）、还不太熟 wall2、记住了 wall1（最浓）。
 */
export const ZONE_TONE = Object.freeze({ due: 3, shaky: 1, known: 0 });

/**
 * 一个字落在哪一档（纯函数）：最近一次写错、今天到期、或只看过答案还没判断过（D66 ⑤）→ due；
 * 未到期且稳定度 < 21 天（没有调度项按 0 算）→ shaky；其余 known。
 */
export function memoryZoneOf(record, entry, today, knownDays = KNOWN_STABILITY_DAYS) {
  if (record && record.judgment === 'wrong') return 'due';
  if (record && record.kind === 'answer-seen') return 'due';
  if (entry && entry.stoppedAt === undefined) {
    const od = overdueDays(entry, today);
    if (od !== null && od >= 0) return 'due';
  }
  const stability = entry && entry.fsrs ? Number(entry.fsrs.stability) || 0 : 0;
  return stability >= knownDays ? 'known' : 'shaky';
}

/**
 * 三档记忆状态（D60）：只看每个字最近一次 judged 记录与它的 sched 项；从没判断过、只看过答案的字（D66 ⑤）也算进来，归「待复习」
 * （core/records.js practicedByChar，record 是那条「看过答案」记录）。
 * 三档互斥、合计 = recorded（已练汉字：有判断记录 ∪ 看过答案的字，首页 / 我的 / 全部页同一个数）。
 * 每档内部顺序 = 最该练在前：due 里最近写错的在前、再是只看过答案的（最近的在前）、其余按逾期天数降序；shaky / known 按到期日升序（快到期的在前）。
 * @returns {{recorded:number, zones:{due,shaky,known}}} 每档 {kind, n, items:[{char, cardKey, record, tone}]}（tone = ZONE_TONE[kind]）
 */
export function memoryZones(state, today, { knownDays = KNOWN_STABILITY_DAYS } = {}) {
  const { records } = recordsOfState(state);
  const latest = practicedByChar(records);
  const sched = (state && state.sched) || {};
  const buckets = { due: [], shaky: [], known: [] };
  for (const record of latest.values()) {
    const entry = sched[record.cardKey];
    const kind = memoryZoneOf(record, entry, today, knownDays);
    const dueDay = entry && isValidDay(entry.due) ? entry.due : '9999-12-31';
    // 待复习里的先后：最近写错（0）→ 只看过答案（1）→ 到期（2）
    const rank = record.judgment === 'wrong' ? 0 : record.kind === 'answer-seen' ? 1 : 2;
    buckets[kind].push({ char: record.char, cardKey: record.cardKey, record, dueDay, rank });
  }
  const byDue = (a, b) => (a.dueDay < b.dueDay ? -1 : a.dueDay > b.dueDay ? 1 : compareRecordIds(a.record.id, b.record.id));
  buckets.due.sort((a, b) => (a.rank === b.rank ? (a.rank < 2 ? compareRecordIds(b.record.id, a.record.id) : byDue(a, b)) : a.rank - b.rank));
  buckets.shaky.sort(byDue);
  buckets.known.sort(byDue);
  const zones = {};
  for (const kind of MEMORY_ZONES) {
    const items = buckets[kind].map(({ char, cardKey, record }) => ({ char, cardKey, record, tone: ZONE_TONE[kind] }));
    zones[kind] = { kind, n: items.length, items };
  }
  return { recorded: latest.size, zones };
}

/** 已跳过样字的本人墨档位：最淡一档（wall4），和「待复习」同一档——都是还没好好写的字。 */
export const SKIPPED_TONE = 3;

/**
 * 「已跳过」一档（D62）：写字页点过「跳过」（一条 kind='skipped' 记录，写字页 skip.js 经 store.commit 追加；撤销会删掉它）、
 * 并且这个字至今没有任何 judged 记录、也没看过答案（D66 ⑤：看过答案的在「待复习」）的字。已经写过（有 judged 记录）的字回到三档里，不再出现在这里；不计入 recorded（已练汉字数）。
 * 每个字取最近一次跳过的那条记录，最近跳过的排前（按 id 序号）。
 * 注意：最旧月份折叠（store/budget.js fold）只保留 judged 记录，所以折叠月份里的跳过记录不再计入。
 * @returns {{kind:'skipped', n:number, items:[{char, cardKey, record, tone}]}}
 */
export function skippedZone(state) {
  const { records } = recordsOfState(state);
  const judged = practicedByChar(records); // 看过答案的字已在「待复习」（D66 ⑤），不再算已跳过
  const latest = new Map();
  for (const r of records) {
    if (!r || r.kind !== 'skipped' || typeof r.char !== 'string' || judged.has(r.char)) continue;
    const prev = latest.get(r.char);
    if (!prev || compareRecordIds(prev.id, r.id) < 0) latest.set(r.char, r);
  }
  const items = [...latest.values()].sort((a, b) => compareRecordIds(b.id, a.id))
    .map(record => ({ char: record.char, cardKey: record.cardKey, record, tone: SKIPPED_TONE }));
  return { kind: 'skipped', n: items.length, items };
}

/** 区行的样字（最多三个，本人墨：kind 'ink' 取最近一次笔迹，没有笔迹时画标准字形；墨色档位按区）。 */
export function zoneSamples(zone) {
  return (zone.items || []).slice(0, ZONE_SAMPLE_MAX).map(item => ({ char: item.char, kind: 'ink', tone: item.tone, record: item.record }));
}

/**
 * 「今天要写」一行（D60）：与首页主按钮同一个状态、同一组字。状态取自 homeModel（首页自己的模型）：
 *   half  有没写完的组（含 B 优先）：「还剩 N 个」，N = homeModel.primary.remaining（与首页续写同一个数）；
 *   done  没有没写完的组、今天写过（首页主按钮「再写一组」）；
 *   fresh 其余（首页主按钮「开始写字」）：N = 首页点了会开的那一组（首次来 = 首练固定的字；否则 core/session-start planDaily 的队列）。
 * 复习 = 队列里已经在调度表里的字，新字 = 其余。队列为空（没有要写的字）时 n = 0。
 * @param {{deck:object, policy?:object}} o  deck = 选字用的题库适配器（data/deck.js deckAdapter）
 * @returns {{phase:'fresh'|'half'|'done', n:number, review:number, fresh:number, remaining:number|null}}
 */
export function todayPlanModel(state, nowMs, { deck, policy = defaultPolicy } = {}) {
  const home = homeModel(state, nowMs, { policy, deck });
  if (home.resume !== 'none') {
    const remaining = home.primary ? home.primary.remaining : 0;
    return { phase: 'half', n: remaining, review: 0, fresh: 0, remaining };
  }
  if (home.records === 'record') return { phase: 'done', n: 0, review: 0, fresh: 0, remaining: null };
  const sched = (state && state.sched) || {};
  const queue = aStartInfo(state, { policy }).kind === 'first'
    ? selectFirst(policy)
    : planDaily(state, { today: home.today, deck, policy }).queue;
  const review = queue.filter(key => !!sched[key]).length;
  return { phase: 'fresh', n: queue.length, review, fresh: queue.length - review, remaining: null };
}
