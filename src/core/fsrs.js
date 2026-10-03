// FSRS 封装（ts-fsrs 5.2.0 / FSRS-6，vendor/fsrs6.min.js 的 UMD 全局 `FSRS`）。
// 01-架构设计 §5：request_retention 0.90、maximum_interval 365、enable_fuzz true；写错 → Again；写对 → Good，但有两处记 Easy（D41）：
//   ① 新字第一次判断就写对（无提示）→ policy.ratingFirstCorrect（P127，Easy）；② 热身字写对（无提示）→ Easy（policy.warmup.easyOnCorrect，P126）。
// 带提示写对一律读 policy.ratingWithHint（P34，Good）——提示说明不是「一下子就写出来」，所以首次写对带提示时不升 Easy。
// 看过答案、跳过不评级、不改 due。
// Again 后直接采用 FSRS 返回的 due（至少次日），不再悬置。
//
// 确定性：ts-fsrs 的 fuzz 种子由 review 时间与卡状态决定，同一 records 序列重放得到同一 due。
// 所有时间以 ms 数字或 ISO 字符串传给库（不传 Date 对象，跨 realm 注入时 `instanceof Date` 会失败）。
//
// 库的获取：默认读 `globalThis.FSRS`；测试可用 setFSRSLibrary(lib) 注入，或在各函数 opts.lib 传入。

import * as defaultPolicy from '../config/policy.js';
import { CHAR_ORDER } from '../config/char-order.js';
import { addDays, localDay, diffDays, isValidDay } from './dates.js';
import { charOfCardKey } from './records.js';

export const FSRS_CONFIG = Object.freeze({
  schedulerVersion: 'ts-fsrs 5.2.0 / FSRS-6.0',
  parameterVersion: 'fsrs6-fuzz-365-v2',
  requestRetention: 0.9,
  maximumInterval: 365,
  enableFuzz: true,
});

const RATINGS = Object.freeze(['Again', 'Hard', 'Good']);
const FIRST_RATINGS = Object.freeze(['Good', 'Easy']);

let warmupSet = null;
function isWarmupKey(cardKey) {
  if (!warmupSet) warmupSet = new Set(CHAR_ORDER.warmup);
  const ch = charOfCardKey(cardKey);
  return !!ch && warmupSet.has(ch);
}

let injectedLibrary = null;
const engineCache = new WeakMap();

/** 注入 FSRS 库（测试用）；传 null 恢复读 globalThis.FSRS。 */
export function setFSRSLibrary(lib) {
  injectedLibrary = lib || null;
}

/** 当前可用的 FSRS 库；没有则抛错（调度不能静默跳过）。 */
export function getFSRSLibrary(lib) {
  const found = lib || injectedLibrary || (typeof globalThis !== 'undefined' ? globalThis.FSRS : null);
  if (!found || typeof found.fsrs !== 'function') {
    throw new Error('FSRS library unavailable: load vendor/fsrs6.min.js or call setFSRSLibrary()');
  }
  return found;
}

function engineFor(lib) {
  let engine = engineCache.get(lib);
  if (!engine) {
    engine = lib.fsrs(
      lib.generatorParameters({
        request_retention: FSRS_CONFIG.requestRetention,
        maximum_interval: FSRS_CONFIG.maximumInterval,
        enable_fuzz: FSRS_CONFIG.enableFuzz,
        enable_short_term: true,
        learning_steps: [],
        relearning_steps: [],
      }),
    );
    engineCache.set(lib, engine);
  }
  return engine;
}

function toMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  if (value && typeof value.getTime === 'function') {
    // 跨 realm 的 Date。
    const ms = value.getTime();
    if (Number.isFinite(ms)) return ms;
  }
  throw new TypeError('invalid time value: ' + String(value));
}

function isoOrNull(value) {
  if (value === null || value === undefined) return null;
  return new Date(toMs(value)).toISOString();
}

/**
 * 库的卡对象 → 可存储的普通对象（CompactCard）。字段名沿 v1 `memory[key].fsrsCard`，便于迁移（§12）。
 * `due`、`last_review` 为 ISO 字符串。
 */
export function serializeCard(card) {
  if (!card || typeof card !== 'object') throw new TypeError('serializeCard expects a card object');
  return {
    due: isoOrNull(card.due),
    stability: Number(card.stability) || 0,
    difficulty: Number(card.difficulty) || 0,
    elapsed_days: Number(card.elapsed_days) || 0,
    scheduled_days: Number(card.scheduled_days) || 0,
    learning_steps: Number(card.learning_steps) || 0,
    reps: Number(card.reps) || 0,
    lapses: Number(card.lapses) || 0,
    state: Number(card.state) || 0,
    last_review: isoOrNull(card.last_review),
  };
}

/** CompactCard 校验（schema/迁移可复用）。 */
export function isCompactCard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.due !== 'string' || !Number.isFinite(Date.parse(value.due))) return false;
  if (value.last_review !== null && (typeof value.last_review !== 'string' || !Number.isFinite(Date.parse(value.last_review)))) {
    return false;
  }
  return ['stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'learning_steps', 'reps', 'lapses', 'state'].every(
    (k) => typeof value[k] === 'number' && Number.isFinite(value[k]),
  );
}

function toLibraryCard(compact) {
  // TypeConvert.card 接受 ISO 字符串；last_review 为 null 时给 undefined（与库的新卡一致）。
  const out = { ...compact };
  if (out.last_review === null) delete out.last_review;
  return out;
}

/** 新卡（在 at 时刻创建）。 */
export function emptyCard(at, opts = {}) {
  const lib = getFSRSLibrary(opts.lib);
  return serializeCard(lib.createEmptyCard(toMs(at)));
}

/**
 * 一次判断的评级。judgment: 'correct' | 'wrong'；help.hints > 0 且写对时用 policy.ratingWithHint（P34）。
 * 无提示写对时（D41）：ctx.warmup（热身字，P126 easyOnCorrect）或 ctx.first（新字第一次判断，P127 ratingFirstCorrect）→ Easy，否则 Good。
 * @param {{first?:boolean, warmup?:boolean}} [ctx]
 */
export function ratingFor(judgment, help, policy = defaultPolicy, ctx = null) {
  if (judgment === 'wrong') return 'Again';
  if (judgment !== 'correct') throw new RangeError('judgment must be correct or wrong');
  const hints = help && Number(help.hints) > 0 ? Number(help.hints) : 0;
  if (hints === 0) {
    if (ctx && ctx.warmup && policy.warmup && policy.warmup.easyOnCorrect) return 'Easy';
    if (ctx && ctx.first) {
      const first = policy.ratingFirstCorrect === undefined ? 'Good' : policy.ratingFirstCorrect;
      if (!FIRST_RATINGS.includes(first)) throw new RangeError('unsupported policy.ratingFirstCorrect: ' + String(first));
      return first;
    }
    return 'Good';
  }
  const rating = policy.ratingWithHint;
  if (!RATINGS.includes(rating)) throw new RangeError('unsupported policy.ratingWithHint: ' + String(rating));
  return rating;
}

/** 这张卡是不是「第一次判断」：没有卡，或卡还没有被评过级（reps 0、新卡状态）。 */
function isFirstReview(before) {
  return !before || (Number(before.reps) || 0) === 0;
}

/**
 * 对一张卡做一次 review。
 * @param {object|null} before CompactCard；null = 新卡（在 at 时刻创建）
 * @param {{judgment:'correct'|'wrong', at:number, help?:object, cardKey?:string}} review
 *   cardKey 给了才能判断是不是热身字（热身字清单是数据，src/config/char-order.js）；opts.warmup 可显式覆盖（测试 / 注入）。
 * @returns {{card: object, due: string, rating: string}} due = max(明天, FSRS due 的本地日)
 */
export function reviewCard(before, review, opts = {}) {
  const lib = getFSRSLibrary(opts.lib);
  const policy = opts.policy || defaultPolicy;
  const at = toMs(review.at);
  const warmup = opts.warmup !== undefined ? !!opts.warmup : !!review.cardKey && isWarmupKey(review.cardKey);
  const rating = ratingFor(review.judgment, review.help, policy, { first: isFirstReview(before), warmup });
  const start = before ? toLibraryCard(before) : lib.createEmptyCard(at);
  const result = engineFor(lib).next(start, at, lib.Rating[rating]);
  const card = serializeCard(result.card);
  const today = localDay(at);
  const tomorrow = addDays(today, 1);
  const fsrsDay = localDay(toMs(card.due));
  const due = fsrsDay > tomorrow ? fsrsDay : tomorrow;
  return { card, due, rating };
}

/**
 * 判断落定后的调度项。返回新的 sched 项与判断前的卡（存到 Session.items[i].fsrsBefore 供本会话更正重放）。
 * @param {object|undefined} entry 现有 sched[cardKey]
 * @param {{judgment, at, help}} record 刚写入的 judged 记录
 */
export function applyJudgment(entry, record, opts = {}) {
  if (!record || record.kind !== 'judged') throw new RangeError('applyJudgment expects a judged record');
  // 新字的「判断前的卡」= 在判断时刻创建的空卡（与 reviewCard(null) 等价，重放结果相同）；
  // 始终存对象，schema 的 items[].fsrsBefore 只收对象。
  const fsrsBefore = entry && entry.fsrs ? entry.fsrs : emptyCard(record.at, opts);
  const { card, due } = reviewCard(fsrsBefore, record, opts);
  const next = { fsrs: card, due, lastJudgedAt: toMs(record.at) };
  if (entry && entry.stoppedAt !== undefined) next.stoppedAt = entry.stoppedAt;
  return { entry: next, fsrsBefore };
}

/**
 * 从 fsrsBefore 依次重放若干 judged 记录（按 id 顺序、以各自 at 为 review 时间）。
 * 用于决定-D19 更正：只改 judgment，重放本会话此字的记录，得到确定的新 sched 项。
 * @param {object|null} fsrsBefore 判断前的卡（Session.items[i].fsrsBefore）；null 等同新卡
 * @returns {object|null} 新 sched 项；没有可重放的 judged 记录时返回 null（调用方保留原 sched 项）
 */
export function replay(fsrsBefore, records, opts = {}) {
  let card = fsrsBefore || null;
  let due = null;
  let lastJudgedAt = null;
  for (const record of records || []) {
    if (!record || record.kind !== 'judged') continue;
    const step = reviewCard(card, record, opts);
    card = step.card;
    due = step.due;
    lastJudgedAt = toMs(record.at);
  }
  if (due === null) return null;
  const out = { fsrs: card, due, lastJudgedAt };
  if (opts.stoppedAt !== undefined) out.stoppedAt = opts.stoppedAt;
  return out;
}

/** sched 项相对 today 的逾期天数（未到期为负；无 due 为 null）。 */
export function overdueDays(entry, today) {
  if (!entry || !isValidDay(entry.due)) return null;
  return diffDays(entry.due, today);
}

/** sched 项是否到期（due ≤ today，且没有 stoppedAt）。 */
export function isDue(entry, today) {
  if (!entry || entry.stoppedAt !== undefined) return false;
  const od = overdueDays(entry, today);
  return od !== null && od >= 0;
}

/** 可提取率（0–1），给排序/快忘了的备选口径用。 */
export function retrievability(entry, now, opts = {}) {
  if (!entry || !entry.fsrs) return null;
  const lib = getFSRSLibrary(opts.lib);
  return engineFor(lib).get_retrievability(toLibraryCard(entry.fsrs), toMs(now), false);
}
