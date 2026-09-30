// 占用估算与预算回收（01-架构设计 §9；§4「写前超预算先回收、撞配额先回收再重试一次」）。
//
// 估算口径：localStorage 按 UTF-16 计，每个条目 ≈ (键长 + 值长) × 2 字节。
// 回收只动两个域：
//   ink      按优先级从低到高淘汰：孤儿墨迹 → 其他月份的其余 → 本月其余 → 每月每字首/末条（P02）
//            → 每字第一条 judged（年报）；「每字最近一次 judged」永不淘汰。同一层内先淘汰最旧（id 序号小）。
//   records  最旧月份折叠为 {folded, month, byDay, chars, kept}（schema.validateRecordsMonth）；
//            当月（及时钟回拨后的未来月份）不折叠；kept 保留该月中仍是「某字最近一次 judged」的记录。被折掉的记录，其墨迹一并删除。
// 回收函数只改传入的 draft（store 的写时拷贝草稿），不碰存储、不碰已发布状态。
//
// 预算数值是过渡默认值，与 policy.js（M0-6）同名键一致；store 可用 policy 覆盖（resolveBudgets）。

import { CORRUPT_PREFIX, KEYS, isPlainObject, recordsKey, serialOf, specForKey } from '../core/schema.js';

const MiB = 1024 * 1024;

export const BUDGET_DEFAULTS = Object.freeze({
  /** 假定的 localStorage 配额（01 §9「对 5MiB 留 35% 余量」）。真机实际配额未测（A-storage 未解问题 1）。 */
  quotaBytes: 5 * MiB,
  /** 占用预警阈值：> 80% 配额在备份页与首页状态句预警（01 §4）。 */
  warnRatio: 0.8,
  /** 目标合计（01 §9）。 */
  totalTargetBytes: 3.2 * MiB,
  /** P28 records 保留与折叠：policy.recordsBudgetBytes（过渡 1.5MiB）。 */
  recordsBudgetBytes: 1.5 * MiB,
  /** P28：超 400 天的月份折叠（与预算先到者）。 */
  recordsFoldAfterDays: 400,
  /** P05 墨迹预算：policy.inkBudgetBytes（过渡 1.5MiB）。 */
  inkBudgetBytes: 1.5 * MiB,
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

// ---------------------------------------------------------------- 日期（本地日；不依赖 core/dates.js）

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

export function localDayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

/** 从 records 域建立优先级索引（导出给单测核对层级口径）。 */
export function indexRecords(records) {
  const byId = new Map();
  const latestByCard = new Map(); // cardKey → record（judged，序号最大）
  const firstByCard = new Map(); // cardKey → record（judged，序号最小）
  const edges = new Set(); // 每月每字首/末条 judged 的 id
  const perMonthCard = new Map(); // `${month}|${cardKey}` → {first, last}
  for (const month of Object.keys(records || {})) {
    for (const rec of monthRecords(records[month])) {
      byId.set(rec.id, { rec, month });
      if (rec.inkId) byId.set(rec.inkId, { rec, month });
      if (rec.kind !== 'judged') continue;
      const s = serialOf(rec.id);
      const latest = latestByCard.get(rec.cardKey);
      if (!latest || serialOf(latest.id) < s) latestByCard.set(rec.cardKey, rec);
      const first = firstByCard.get(rec.cardKey);
      if (!first || serialOf(first.id) > s) firstByCard.set(rec.cardKey, rec);
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
  const firstIds = new Set();
  for (const rec of firstByCard.values()) firstIds.add(rec.id);
  return { byId, latestIds, firstIds, edges };
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

export function inkBytes(ink) {
  return ink ? entryBytes(KEYS.ink, JSON.stringify(ink)) : 0;
}

/**
 * 墨迹淘汰层级（数字越小越先淘汰）；Infinity = 永不淘汰。
 *   0 孤儿（找不到对应记录）  1 其他月份的其余  2 本月其余  3 每月每字首/末条  4 每字第一条  ∞ 每字最近一次
 */
export function inkTier(id, index, currentMonth) {
  const hit = index.byId.get(id);
  if (!hit) return 0;
  const recId = hit.rec.id;
  if (index.latestIds.has(recId)) return Infinity;
  if (index.firstIds.has(recId)) return 4;
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

function foldMonth(month, list, latestIds) {
  const byDay = {};
  const chars = [];
  const seen = new Set();
  for (const rec of list) {
    if (rec.kind !== 'judged') continue;
    const day = byDay[rec.localDay] || (byDay[rec.localDay] = []);
    if (day.indexOf(rec.char) < 0) day.push(rec.char);
    if (!seen.has(rec.char)) {
      seen.add(rec.char);
      chars.push(rec.char);
    }
  }
  const kept = list.filter(rec => latestIds.has(rec.id));
  return { folded: true, month, byDay, chars, kept };
}

/**
 * 按 §9 优先级回收，直接修改 draft.records / draft.ink（替换为新对象，不就地改已冻结的值）。
 * opts.force=true：撞配额后调用，按 needBytes 至少腾出这么多（仍不动「每字最近一次」与当月记录）。
 * opts.limit = {ink: bool, months: [YYYY-MM]}：只允许动这些键。撞配额时 store 只让回收本次已经要写的键——
 *   多动一个键就要在 txn 里多存一份它的原值，峰值占用反而更高。
 * 返回 {actions:[{type:'evictInk', id, tier}|{type:'fold', month, kept, dropped}|{type:'dropFoldedInk'}], freedBytes}。
 */
export function recover(draft, { now, budgets, force = false, needBytes = 0, limit = null } = {}) {
  const b = resolveBudgets(budgets);
  const nowMs = typeof now === 'number' ? now : Date.now();
  const today = localDayOf(nowMs);
  const currentMonth = today.slice(0, 7);
  const actions = [];
  let freed = 0;
  const wantMore = () => force && freed < needBytes;

  let records = draft.records || {};
  const index = indexRecords(records);

  // ---- 1. 墨迹
  const inkAllowed = !limit || limit.ink === true;
  const monthAllowed = month => !limit || (Array.isArray(limit.months) && limit.months.indexOf(month) >= 0);

  if (inkAllowed && draft.ink && isPlainObject(draft.ink)) {
    let bytes = inkBytes(draft.ink);
    if (bytes > b.inkBudgetBytes || wantMore()) {
      const candidates = Object.keys(draft.ink)
        .map(id => ({ id, tier: inkTier(id, index, currentMonth), serial: serialOf(id), size: inkEntryBytes(id, draft.ink[id]) }))
        .filter(c => c.tier !== Infinity)
        .sort((x, y) => x.tier - y.tier || x.serial - y.serial || (x.id < y.id ? -1 : 1));
      const evicted = new Set();
      for (const c of candidates) {
        if (!(bytes > b.inkBudgetBytes || wantMore())) break;
        evicted.add(c.id);
        bytes -= c.size;
        freed += c.size;
        actions.push({ type: 'evictInk', id: c.id, tier: c.tier });
      }
      if (evicted.size) {
        const next = {};
        for (const id of Object.keys(draft.ink)) if (!evicted.has(id)) next[id] = draft.ink[id];
        draft.ink = next;
      }
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
    const value = foldMonth(month, list, index.latestIds);
    const after = entryBytes(recordsKey(month), JSON.stringify(value));
    if (!folded) {
      records = Object.assign({}, records);
      folded = true;
    }
    records[month] = value;
    rBytes += after - before;
    freed += Math.max(0, before - after);
    actions.push({ type: 'fold', month, kept: value.kept.length, dropped: list.length - value.kept.length });
    // 被折掉的记录的墨迹一并删除（记录已不存在，墨迹成孤儿）。
    if (inkAllowed && draft.ink && isPlainObject(draft.ink)) {
      const keptIds = new Set(value.kept.map(rec => rec.id));
      const gone = new Set();
      for (const rec of list) {
        if (keptIds.has(rec.id)) continue;
        gone.add(rec.id);
        if (rec.inkId) gone.add(rec.inkId);
      }
      let removed = 0;
      const next = {};
      for (const id of Object.keys(draft.ink)) {
        if (gone.has(id)) removed += inkEntryBytes(id, draft.ink[id]);
        else next[id] = draft.ink[id];
      }
      if (removed) {
        draft.ink = next;
        freed += removed;
        actions.push({ type: 'dropFoldedInk', month, bytes: removed });
      }
    }
  }
  if (folded) draft.records = records;
  return { actions, freedBytes: freed };
}
