// 占用估算与预算回收（01-架构设计 §9；§4「写前超预算先回收、撞配额先回收再重试一次」）。
//
// 估算口径：localStorage 按 UTF-16 计，每个条目 ≈ (键长 + 值长) × 2 字节。
// 回收只动两个域：
//   ink      按月分键（shizi.v2.ink.<YYYY-MM>），预算按全部月键合计；跨月键统一排序淘汰。
//            估算按实际 JSON 串长，与编码无关：新写入为 v3 打包编码（每点 4 字节 base64，14 笔 × 24 点 ≈ 3.7KB/条，
//            300 条 ≈ 1.07MiB，test/core/ink-math.test.mjs P78 容量测量），旧 v2 数据按其原长计。
//            保留规则（决定-D27，阶段 1 P1-E3）：每字只留「第一次判断」与「最近一次判断」的墨迹（同一条则一份），其余回收。
//            「判断」= kind==='judged'（写对 / 写错）；看过答案、跳过不是判断（看过答案只带看后自写的墨，见下面 Q1）。回收有两个时机：
//              ① 写入新判断时（write/compare.js judgeInDraft → pruneInkOfCards，同一次 store.commit）：上一次的「最近一次」
//                 若不是第一次，就成了中间那次，墨迹随这次提交删除；
//              ② 预算回收时（下面的 recover）：撞配额 / 超预算按层级淘汰，先回收既非首次也非最近的——
//                 孤儿墨迹 → 其他月份的其余 → 本月其余 → 每月每字首/末条（P02）；「每字第一次」与「每字最近一次」永不回收
//                 （D27 覆盖 01 §9 原「每字第一条可淘汰」）。同一层内先淘汰最旧（id 序号小）。
//            第一次判断在开启前就没有墨迹（历史数据）时如实为无，不拿别次墨迹顶替（I03）。
//            看后自写（Q1，QA simB D1；03 P176）：看过答案后「自己写一遍」的本人墨存在那条 answer-seen 记录上（D31「看后写的」）。
//            它不是判断、不占 D27 的「第一次 / 最近一次」。所在的组还开着（sessions.A / B / lastEnded：结果页与「这次的图片」可用）
//            时永不回收；之后保留到下次同字有判断——pruneInkOfCards 只留每字最新的那份、且要新于这个字最近一次判断——或超过
//            policy.afterSeenInkKeepDays 天；预算回收里排在判断墨迹的其余层之后（过期 4 → 未过期 5），见 inkTier。
//   records  最旧月份折叠为 {folded, month, byDay, chars, kept}（schema.validateRecordsMonth）；
//            当月（及时钟回拨后的未来月份）不折叠；kept 保留该月中仍是「某字最近一次 judged」或「某字第一次 judged」（D27）的记录。
//            被折掉的记录，其墨迹一并删除。
// 回收函数只改传入的 draft（store 的写时拷贝草稿），不碰存储、不碰已发布状态。
//
// 预算数值取自 src/config/policy.js（P05/P28/P57 过渡默认值）；store/测试可用 budgets 覆盖注入（resolveBudgets）。

import { CORRUPT_PREFIX, inkIdOf, inkKey, inkMonthOf, isPlainObject, recordsKey, serialOf, specForKey } from '../core/schema.js';
import * as policy from '../config/policy.js';
import { localDay } from '../core/dates.js';

const MiB = 1024 * 1024;

export const BUDGET_DEFAULTS = Object.freeze({
  /** P57 假定的 localStorage 配额：policy.assumedQuotaBytes（过渡 5MiB；真机实际配额未测，A-storage 未解问题 1）。 */
  quotaBytes: policy.assumedQuotaBytes,
  /** P57 占用预警阈值：policy.storageWarnRatio（> 80% 配额在备份页与首页状态句预警，01 §4）。 */
  warnRatio: policy.storageWarnRatio,
  /** 目标合计（01 §9；不是 P 项）。 */
  totalTargetBytes: 3.2 * MiB,
  /** P28 records 保留与折叠：policy.recordsBudgetBytes（过渡 1.5MiB）。 */
  recordsBudgetBytes: policy.recordsBudgetBytes,
  /** P28：超 400 天的月份折叠（与预算先到者）：policy.recordsFoldAfterDays。 */
  recordsFoldAfterDays: policy.recordsFoldAfterDays,
  /** P05 墨迹预算（全部 ink 月键合计）：policy.inkBudgetBytes（过渡 1.5MiB）。 */
  inkBudgetBytes: policy.inkBudgetBytes,
});

export function resolveBudgets(overrides) {
  const out = {};
  for (const key of Object.keys(BUDGET_DEFAULTS)) {
    const value = overrides && typeof overrides[key] === 'number' && Number.isFinite(overrides[key]) ? overrides[key] : BUDGET_DEFAULTS[key];
    out[key] = value;
  }
  return out;
}

/** 单个 localStorage 条目的估算字节数（UTF-16）。raw 为 null 表示不存在，只计 0。 */
export function entryBytes(key, raw) {
  if (raw === null || raw === undefined) return 0;
  return (String(key).length + String(raw).length) * 2;
}

/** 键归到哪个统计桶：v2 域名 / 'txn' / 'corrupt' / 'legacy-v1'（其余 shizi.*）/ 'foreign'。 */
export function bucketOfKey(key) {
  const spec = specForKey(key);
  if (spec) return spec.domain || spec.id;
  if (key.indexOf(CORRUPT_PREFIX) === 0) return 'corrupt';
  if (key.indexOf('shizi.') === 0) return 'legacy-v1';
  return 'foreign';
}

/**
 * pairs：可迭代的 [key, raw]（通常是 storage.readAll('') 的结果，含同源全部键——它们共用一份配额）。
 * 返回 {total, byBucket, ratio, level:'ok'|'warn'|'full'}。
 */
export function estimateUsage(pairs, budgets = BUDGET_DEFAULTS) {
  const b = resolveBudgets(budgets);
  const byBucket = {};
  let total = 0;
  for (const [key, raw] of pairs) {
    const bytes = entryBytes(key, raw);
    total += bytes;
    const bucket = bucketOfKey(key);
    byBucket[bucket] = (byBucket[bucket] || 0) + bytes;
  }
  const ratio = b.quotaBytes > 0 ? total / b.quotaBytes : 1;
  const level = ratio >= 1 ? 'full' : ratio > b.warnRatio ? 'warn' : 'ok';
  return { total, byBucket, ratio, level };
}

// ---------------------------------------------------------------- 日期（与全 App 同一个归日函数 core/dates.js localDay，D66 ⑦）

export function localDayOf(ms) {
  return localDay(ms);
}

/** 该月最后一天距 today（YYYY-MM-DD）的整天数；月份在未来时为负。 */
function daysSinceMonthEnd(month, today) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const monthEnd = new Date(y, m, 0, 12); // m 是 1 基：new Date(y, m, 0) = 该月最后一天
  const t = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)), 12);
  return Math.round((t.getTime() - monthEnd.getTime()) / 86400000);
}

// ---------------------------------------------------------------- 记录索引

function monthRecords(value) {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value) && value.folded === true && Array.isArray(value.kept)) return value.kept;
  return [];
}

function isFolded(value) {
  return isPlainObject(value) && value.folded === true;
}

const DAY_MS = 86400000;

/** 还开着的组的 id（槽里的 A / B 与 lastEnded 的 A / B：结果页与「这次的图片」还能用，Q1）。 */
export function openSessionIds(sessions) {
  const out = new Set();
  if (!isPlainObject(sessions)) return out;
  const add = s => {
    if (isPlainObject(s) && typeof s.id === 'string') out.add(s.id);
  };
  add(sessions.A);
  add(sessions.B);
  if (isPlainObject(sessions.lastEnded)) {
    add(sessions.lastEnded.A);
    add(sessions.lastEnded.B);
  }
  return out;
}

/**
 * 从 records 域建立优先级索引（导出给单测核对层级口径）。
 * opts（Q1，看后自写的墨迹）：sessions = 草稿的 sessions（还开着的组里的看后自写永不回收）；now / keepDays（缺省
 * policy.afterSeenInkKeepDays，P176）判断看后自写是否过期。afterSeen：answer-seen 记录 id → 层级（Infinity / 4 / 5）。
 */
export function indexRecords(records, { sessions = null, now = null, keepDays = policy.afterSeenInkKeepDays } = {}) {
  const byId = new Map();
  const seen = []; // answer-seen 记录（Q1）
  const latestByCard = new Map(); // cardKey → record（judged，序号最大）
  const firstByCard = new Map(); // cardKey → record（judged，序号最小）
  const latestScreen = new Map(); // cardKey → record（屏幕上写的 judged，序号最大；P1-E8）
  const firstScreen = new Map(); // cardKey → record（屏幕上写的 judged，序号最小；P1-E8）
  const edges = new Set(); // 每月每字首/末条 judged（屏幕上写的）的 id
  const perMonthCard = new Map(); // `${month}|${cardKey}` → {first, last}
  const keepExtreme = (map, rec, s, latest) => {
    const cur = map.get(rec.cardKey);
    if (!cur || (latest ? serialOf(cur.id) < s : serialOf(cur.id) > s)) map.set(rec.cardKey, rec);
  };
  for (const month of Object.keys(records || {})) {
    for (const rec of monthRecords(records[month])) {
      byId.set(rec.id, { rec, month });
      if (rec.inkId) byId.set(rec.inkId, { rec, month });
      if (rec.kind === 'answer-seen') seen.push(rec);
      if (rec.kind !== 'judged') continue;
      const s = serialOf(rec.id);
      keepExtreme(latestByCard, rec, s, true);
      keepExtreme(firstByCard, rec, s, false);
      // 阶段 1 P1-E8（D46 ⑬，03 P166）：纸上记录没有墨迹，不占「第一次 / 最近一次」的留墨位——
      // 另记屏幕上写的第一次 / 最近一次一起留，纸上那次之前留墨的最近一次不会被当成中间那次回收（「你的笔迹」按 D27 / D42 取留有墨迹的那次）。
      if (rec.source === 'paper') continue;
      keepExtreme(latestScreen, rec, s, true);
      keepExtreme(firstScreen, rec, s, false);
      const mk = `${month}|${rec.cardKey}`;
      const pair = perMonthCard.get(mk);
      if (!pair) perMonthCard.set(mk, { first: rec, last: rec });
      else {
        if (serialOf(pair.first.id) > s) pair.first = rec;
        if (serialOf(pair.last.id) < s) pair.last = rec;
      }
    }
  }
  for (const pair of perMonthCard.values()) {
    edges.add(pair.first.id);
    edges.add(pair.last.id);
  }
  const latestIds = new Set();
  for (const rec of latestByCard.values()) latestIds.add(rec.id);
  for (const rec of latestScreen.values()) latestIds.add(rec.id);
  const firstIds = new Set();
  for (const rec of firstByCard.values()) firstIds.add(rec.id);
  for (const rec of firstScreen.values()) firstIds.add(rec.id);
  // Q1：看后自写。还开着的组 → ∞；有更晚的判断、或不是这个字最新的那次看过答案、或超过 keepDays 天 → 4（过期）；其余 → 5。
  const open = openSessionIds(sessions);
  const latestSeen = new Map(); // cardKey → 最新一条 answer-seen 的序号
  for (const rec of seen) {
    const s = serialOf(rec.id);
    if (!(latestSeen.get(rec.cardKey) >= s)) latestSeen.set(rec.cardKey, s);
  }
  const afterSeen = new Map();
  const protectedIds = new Set();
  const nowMs = typeof now === 'number' && Number.isFinite(now) ? now : null;
  for (const rec of seen) {
    if (open.has(rec.sessionId)) {
      afterSeen.set(rec.id, Infinity);
      protectedIds.add(rec.id);
      continue;
    }
    const s = serialOf(rec.id);
    const judged = latestByCard.get(rec.cardKey);
    const aged = nowMs !== null && typeof rec.at === 'number' && Number.isFinite(keepDays) && nowMs - rec.at > keepDays * DAY_MS;
    const expired = (judged && serialOf(judged.id) > s) || latestSeen.get(rec.cardKey) > s || aged;
    afterSeen.set(rec.id, expired ? 4 : 5);
  }
  return { byId, latestIds, firstIds, edges, afterSeen, protectedIds };
}

/** D27 留存的记录 id：每字第一次 judged ∪ 每字最近一次 judged（∪ Q1：还开着的组里的看过答案记录，折叠时一并留下）。 */
export function retainedIds(index) {
  return new Set([...index.firstIds, ...index.latestIds, ...(index.protectedIds || [])]);
}

/**
 * D27 写入新判断时的回收：cardKeys 这些字里，既不是第一次也不是最近一次判断的记录，其墨迹从 draft.ink 删除
 * （copy-on-write：只替换有删除的月表）。只看这些字——新判断让上一次的「最近一次」变成中间那次。
 * Q1 看后自写（answer-seen 记录上的墨）：还开着的组里的不删；其余每字只留最新的那一份、且要新于这个字最近一次判断
 * （「保留到下次同字有判断」）——新判断写入时它就回收，新的看后自写写入时更早的那份回收。
 * 同一份墨迹（inkId 相同）被留存的记录引用时不删。返回被回收的 [{id, month, recordId}]。
 * 只改传入的草稿，不碰存储；在 store.commit 的 mutate 里调用（write/compare.js judgeInDraft、write/answer.js storeSelfInkInDraft）。
 */
export function pruneInkOfCards(draft, cardKeys) {
  if (!draft || !isPlainObject(draft.ink) || !draft.records) return [];
  const want = new Set(cardKeys || []);
  if (!want.size) return [];
  const mine = [];
  for (const month of Object.keys(draft.records)) {
    for (const rec of monthRecords(draft.records[month])) if (rec && want.has(rec.cardKey)) mine.push(rec);
  }
  const index = indexRecords({ all: mine }, { sessions: draft.sessions });
  const keep = retainedIds(index);
  const slot = rec => {
    const month = inkMonthOf(rec);
    const id = inkIdOf(rec);
    return month && id ? { month, id } : null;
  };
  const stored = rec => {
    const s = slot(rec);
    const table = s ? draft.ink[s.month] : null;
    return !!s && isPlainObject(table) && Object.prototype.hasOwnProperty.call(table, s.id);
  };
  // Q1：每字最新一份留有墨迹的看后自写，新于这个字最近一次判断时留下
  const latestJudged = new Map();
  for (const rec of mine) {
    if (rec.kind !== 'judged') continue;
    const cur = latestJudged.get(rec.cardKey);
    if (!cur || serialOf(cur.id) < serialOf(rec.id)) latestJudged.set(rec.cardKey, rec);
  }
  const latestSeen = new Map();
  for (const rec of mine) {
    if (rec.kind !== 'answer-seen' || !stored(rec)) continue;
    const cur = latestSeen.get(rec.cardKey);
    if (!cur || serialOf(cur.id) < serialOf(rec.id)) latestSeen.set(rec.cardKey, rec);
  }
  for (const [cardKey, rec] of latestSeen) {
    const judged = latestJudged.get(cardKey);
    if (!judged || serialOf(judged.id) < serialOf(rec.id)) keep.add(rec.id);
  }
  const kept = new Set();
  for (const rec of mine) {
    if (!keep.has(rec.id)) continue;
    const s = slot(rec);
    if (s) kept.add(`${s.month}|${s.id}`);
  }
  const drops = new Map(); // month → Map(inkId → recordId)
  for (const rec of mine) {
    if (keep.has(rec.id)) continue;
    const s = slot(rec);
    if (!s || kept.has(`${s.month}|${s.id}`)) continue;
    const table = draft.ink[s.month];
    if (!isPlainObject(table) || !Object.prototype.hasOwnProperty.call(table, s.id)) continue;
    if (!drops.has(s.month)) drops.set(s.month, new Map());
    drops.get(s.month).set(s.id, rec.id);
  }
  if (!drops.size) return [];
  const out = [];
  draft.ink = Object.assign({}, draft.ink);
  for (const [month, ids] of drops) {
    const next = Object.assign({}, draft.ink[month]);
    for (const [id, recordId] of ids) {
      delete next[id];
      out.push({ id, month, recordId });
    }
    draft.ink[month] = next;
  }
  return out;
}

function inkEntryBytes(id, entry) {
  // 在 {"id":{…},…} 里的份额：引号 + 冒号 + 逗号 ≈ 4 个字符。
  return (id.length + JSON.stringify(entry).length + 4) * 2;
}

export function recordsBytes(records) {
  let total = 0;
  for (const month of Object.keys(records || {})) total += entryBytes(recordsKey(month), JSON.stringify(records[month]));
  return total;
}

/** ink 域（{month: {id: Ink}}）全部月键的估算字节合计；空月表不落盘，不计。 */
export function inkBytes(ink) {
  if (!isPlainObject(ink)) return 0;
  let total = 0;
  for (const month of Object.keys(ink)) {
    const table = ink[month];
    if (!isPlainObject(table) || Object.keys(table).length === 0) continue;
    total += entryBytes(inkKey(month), JSON.stringify(table));
  }
  return total;
}

/** 单个月表的估算字节（空表 = 键会被删除 = 0）。 */
function inkMonthBytes(month, table) {
  return isPlainObject(table) && Object.keys(table).length ? entryBytes(inkKey(month), JSON.stringify(table)) : 0;
}

/**
 * 墨迹淘汰层级（数字越小越先淘汰）；Infinity = 永不淘汰。
 *   0 孤儿（找不到对应记录）  1 其他月份的其余  2 本月其余  3 每月每字首/末条
 *   4 看后自写·过期（有更晚的判断 / 不是这个字最新的那次 / 超过 afterSeenInkKeepDays 天，Q1）  5 看后自写·未过期
 *   ∞ 每字第一次 judged、每字最近一次 judged（决定-D27：绝不回收；原 01 §9 的「4 每字第一条」不再可淘汰）；
 *     还开着的组里的看后自写（结果页与「这次的图片」可用期内，Q1）
 */
export function inkTier(id, index, currentMonth) {
  const hit = index.byId.get(id);
  if (!hit) return 0;
  const recId = hit.rec.id;
  if (index.afterSeen && index.afterSeen.has(recId)) return index.afterSeen.get(recId);
  if (index.latestIds.has(recId) || index.firstIds.has(recId)) return Infinity;
  if (index.edges.has(recId)) return 3;
  return hit.month === currentMonth ? 2 : 1;
}

/**
 * 需要回收吗？state 为 store 草稿（或已发布状态）。sizes 可选：{records, ink} 字节数。
 * 返回 {records, aged, ink, total, any}。total 只做报告（没有其他可回收的域）。
 */
export function needsRecovery(state, { now, budgets, totalBytes, sizes } = {}) {
  const b = resolveBudgets(budgets);
  const records = (state && state.records) || {};
  const today = localDayOf(typeof now === 'number' ? now : Date.now());
  const currentMonth = today.slice(0, 7);
  // sizes = {records, ink}：store 已有序列化结果时直接给出，免得再序列化一遍。
  const rBytes = sizes ? sizes.records : recordsBytes(records);
  let aged = false;
  for (const month of Object.keys(records)) {
    if (month >= currentMonth || isFolded(records[month])) continue;
    if (daysSinceMonthEnd(month, today) > b.recordsFoldAfterDays) aged = true;
  }
  const out = {
    records: rBytes > b.recordsBudgetBytes,
    aged,
    ink: (sizes ? sizes.ink : inkBytes(state && state.ink)) > b.inkBudgetBytes,
    total: typeof totalBytes === 'number' ? totalBytes > b.totalTargetBytes : false,
  };
  out.any = out.records || out.aged || out.ink;
  return out;
}

function foldMonth(month, list, keepIds) {
  const byDay = {};
  const chars = [];
  const seen = new Set();
  // 「那天只在纸上写过」的字（D47）：折叠后年报 / 月字数不计它们（日历仍按 byDay 算写过的日子）。
  const screenDay = new Set();
  for (const rec of list) if (rec.kind === 'judged' && rec.source !== 'paper') screenDay.add(rec.localDay + '\u0000' + rec.char);
  const paperOnly = {};
  for (const rec of list) {
    if (rec.kind !== 'judged') continue;
    const day = byDay[rec.localDay] || (byDay[rec.localDay] = []);
    if (day.indexOf(rec.char) < 0) day.push(rec.char);
    if (rec.source === 'paper' && !screenDay.has(rec.localDay + '\u0000' + rec.char)) {
      const po = paperOnly[rec.localDay] || (paperOnly[rec.localDay] = []);
      if (po.indexOf(rec.char) < 0) po.push(rec.char);
    }
    if (!seen.has(rec.char)) {
      seen.add(rec.char);
      chars.push(rec.char);
    }
  }
  const kept = list.filter(rec => keepIds.has(rec.id));
  const out = { folded: true, month, byDay, chars, kept };
  if (Object.keys(paperOnly).length) out.paperOnly = paperOnly;
  return out;
}

/**
 * 按 §9 优先级回收，直接修改 draft.records / draft.ink（替换为新对象，不就地改已冻结的值）。
 * opts.force=true：撞配额后调用，按 needBytes 至少腾出这么多（仍不动「每字第一次 / 最近一次」的墨迹与当月记录，D27）。
 * opts.limit = {inkMonths: [YYYY-MM], months: [YYYY-MM]}：只允许动这些 ink 月键 / records 月键。
 *   撞配额时 store 只让回收本次已经要写的键——多动一个键就要在 txn 里多存一份它的原值，峰值占用反而更高。
 *   （兼容旧写法 limit.ink === true：允许动全部 ink 月键。）
 * 返回 {actions:[{type:'evictInk', id, tier}|{type:'fold', month, kept, dropped}|{type:'dropFoldedInk'}], freedBytes}。
 */
export function recover(draft, { now, budgets, force = false, needBytes = 0, limit = null, afterSeenKeepDays = policy.afterSeenInkKeepDays } = {}) {
  const b = resolveBudgets(budgets);
  const nowMs = typeof now === 'number' ? now : Date.now();
  const today = localDayOf(nowMs);
  const currentMonth = today.slice(0, 7);
  const actions = [];
  let freed = 0;
  const wantMore = () => force && freed < needBytes;

  let records = draft.records || {};
  const index = indexRecords(records, { sessions: draft.sessions, now: nowMs, keepDays: afterSeenKeepDays });

  // ---- 1. 墨迹（跨全部月键按层级排序；只改有淘汰的月表）
  const inkMonthAllowed = month => !limit || limit.ink === true || (Array.isArray(limit.inkMonths) && limit.inkMonths.indexOf(month) >= 0);
  const monthAllowed = month => !limit || (Array.isArray(limit.months) && limit.months.indexOf(month) >= 0);
  const hasInk = isPlainObject(draft.ink);
  let inkPatched = false;

  /** 从 draft.ink[month] 删掉 ids（copy-on-write）；返回实际省下的字节（按整键重算）。 */
  const dropInk = (month, ids) => {
    const table = draft.ink[month];
    const before = inkMonthBytes(month, table);
    const next = {};
    for (const id of Object.keys(table)) if (!ids.has(id)) next[id] = table[id];
    if (!inkPatched) {
      draft.ink = Object.assign({}, draft.ink);
      inkPatched = true;
    }
    draft.ink[month] = next;
    return before - inkMonthBytes(month, next);
  };

  if (hasInk) {
    let bytes = inkBytes(draft.ink);
    if (bytes > b.inkBudgetBytes || wantMore()) {
      const candidates = [];
      for (const month of Object.keys(draft.ink)) {
        const table = draft.ink[month];
        if (!inkMonthAllowed(month) || !isPlainObject(table)) continue;
        for (const id of Object.keys(table)) {
          candidates.push({ month, id, tier: inkTier(id, index, currentMonth), serial: serialOf(id), size: inkEntryBytes(id, table[id]) });
        }
      }
      candidates.sort((x, y) => x.tier - y.tier || x.serial - y.serial || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) || (x.month < y.month ? -1 : 1));
      const evicted = new Map(); // month → Set(id)
      for (const c of candidates) {
        if (c.tier === Infinity) break; // 排序后 Infinity 全在末尾
        if (!(bytes > b.inkBudgetBytes || wantMore())) break;
        if (!evicted.has(c.month)) evicted.set(c.month, new Set());
        evicted.get(c.month).add(c.id);
        bytes -= c.size;
        freed += c.size;
        actions.push({ type: 'evictInk', id: c.id, month: c.month, tier: c.tier });
      }
      for (const [month, ids] of evicted) dropInk(month, ids);
    }
  }

  // ---- 2. 记录折叠（最旧月份起；当月不折）
  let rBytes = recordsBytes(records);
  const months = Object.keys(records).sort();
  let folded = false;
  for (const month of months) {
    if (month >= currentMonth || isFolded(records[month]) || !monthAllowed(month)) continue; // 当月与未来月份不折
    const aged = daysSinceMonthEnd(month, today) > b.recordsFoldAfterDays;
    if (!(aged || rBytes > b.recordsBudgetBytes || wantMore())) break;
    const list = records[month];
    const before = entryBytes(recordsKey(month), JSON.stringify(list));
    const value = foldMonth(month, list, retainedIds(index));
    const after = entryBytes(recordsKey(month), JSON.stringify(value));
    if (!folded) {
      records = Object.assign({}, records);
      folded = true;
    }
    records[month] = value;
    rBytes += after - before;
    freed += Math.max(0, before - after);
    actions.push({ type: 'fold', month, kept: value.kept.length, dropped: list.length - value.kept.length });
    // 被折掉的记录的墨迹一并删除（记录已不存在，墨迹成孤儿）。墨迹通常就在同月的 ink 月键里，
    // 但按 id 在全部允许的月键里找（防御月份口径不一致的旧数据）。
    if (hasInk) {
      const keptIds = new Set(value.kept.map(rec => rec.id));
      const gone = new Set();
      for (const rec of list) {
        if (keptIds.has(rec.id)) continue;
        gone.add(rec.id);
        if (rec.inkId) gone.add(rec.inkId);
      }
      let removed = 0;
      for (const inkMonth of Object.keys(draft.ink)) {
        const table = draft.ink[inkMonth];
        if (!inkMonthAllowed(inkMonth) || !isPlainObject(table)) continue;
        const hit = new Set(Object.keys(table).filter(id => gone.has(id)));
        if (hit.size) removed += dropInk(inkMonth, hit);
      }
      if (removed) {
        freed += removed;
        actions.push({ type: 'dropFoldedInk', month, bytes: removed });
      }
    }
  }
  if (folded) draft.records = records;
  return { actions, freedBytes: freed };
}
