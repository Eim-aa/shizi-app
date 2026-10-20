// FSRS 封装（ts-fsrs 5.2.0 / FSRS-6，vendor/fsrs6.min.js 的 UMD 全局 `FSRS`）。
// 01-架构设计 §5：request_retention 0.90、maximum_interval 365、enable_fuzz true；写错 → Again；写对 → Good，但有两处记 Easy（D41）：
//   ① 新字第一次判断就写对（无提示）→ policy.ratingFirstCorrect（P127，Easy）；② 热身字写对（无提示）→ Easy（policy.warmup.easyOnCorrect，P126）。
// 带提示写对读 policy.ratingWithHint（P34，D65 #4）：按提示次数分档、新字第一次与复习分开——提示越多评级越低（复习：1–2 次 Hard、3 次起 Again；
// 新字第一次：1 次 Good、2 次 Hard、3 次起 Again）。整字都给出 = 看过答案，不生成判断（write/answer.js），不走这里。
// 跳过不评级、不改 due。
// 看过答案（D66 ①，policy.answerSeenRating P321，覆盖 D65 #5 的「看答案不改调度」）：
//   - 复习字（已有调度项、评过级）看了答案 = 当天记一次「没写出来」（Again，不生成判断记录）：applyAnswerSeen，调度项记 seenAgainDay。
//     一个字一天只记一次：当天已经判断过（或已经因为看答案记过 Again）的字再看答案不再记。
//   - 同一天、看过答案之后又写了判断（提示给完整字后接着写、或当天自选组又写到它）：这次判断不再进 FSRS（不会记第二次 Again，
//     写对也不加分——答案已经看过了），只更新 lastJudgedAt；判断记录照常存。
//   - 新字（还没有调度项）看了答案：不建调度项（「调度项存在 ⇒ 有判断记录」不变），之后第一次判断不再给 Easy——
//     按复习口径评级（无提示写对 Good；带提示 policy.ratingWithHint.review），因为那次已经不是「第一次凭记忆写出来」。
//   本会话更正（replay）要能重放这两种情形：applyJudgment 返回的 fsrsBefore 上带标记（seenAgainDay = 当天已记过看答案的 Again；
//   seenBefore = 新字判断前看过答案），只给 replay 读，不进调度项。
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
  const out = { ...stripMarks(compact) };
  if (out.last_review === null) delete out.last_review;
  return out;
}

/** 新卡（在 at 时刻创建）。 */
export function emptyCard(at, opts = {}) {
  const lib = getFSRSLibrary(opts.lib);
  return serializeCard(lib.createEmptyCard(toMs(at)));
}

/**
 * 一次判断的评级。judgment: 'correct' | 'wrong'；help.hints > 0 且写对时按 policy.ratingWithHint（P34，D65 #4：按次数、首次 / 复习分档）。
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
  const rating = hintedRating(policy.ratingWithHint, hints, !!(ctx && ctx.first));
  if (!RATINGS.includes(rating)) throw new RangeError('unsupported policy.ratingWithHint: ' + String(rating));
  return rating;
}

/**
 * 带提示写对的评级（P34，D65 #4）。policy.ratingWithHint 可以是
 *   一个评级（旧口径：不分次数、不分首次 / 复习），或
 *   {first:[…], review:[…]}：按「点了几次提示」取第 n 个（超出取最后一个）——first = 新字第一次判断，review = 复习。
 */
function hintedRating(cfg, hints, first) {
  if (typeof cfg === 'string') return cfg;
  const list = cfg && Array.isArray(first ? cfg.first : cfg.review) ? (first ? cfg.first : cfg.review) : null;
  if (!list || !list.length) return String(cfg);
  return list[Math.min(hints, list.length) - 1];
}

/** 这张卡是不是「第一次判断」：没有卡，或卡还没有被评过级（reps 0、新卡状态）；判断前看过答案的新字（seenBefore，D66 ①）不算。 */
function isFirstReview(before) {
  if (before && before.seenBefore === true) return false;
  return !before || (Number(before.reps) || 0) === 0;
}

/** fsrsBefore 上给 replay 用的标记（D66 ①）；进库、进调度项之前去掉。 */
const REPLAY_MARKS = Object.freeze(['seenAgainDay', 'seenBefore']);
function stripMarks(card) {
  if (!card || !REPLAY_MARKS.some((k) => k in card)) return card;
  const out = { ...card };
  for (const k of REPLAY_MARKS) delete out[k];
  return out;
}

/**
 * 对一张卡做一次 review。
 * @param {object|null} before CompactCard；null = 新卡（在 at 时刻创建）
 * @param {{judgment:'correct'|'wrong', at:number, help?:object, cardKey?:string}} review
 *   cardKey 给了才能判断是不是热身字（热身字清单是数据，src/config/char-order.js）；opts.warmup 可显式覆盖（测试 / 注入）。
 * @returns {{card: object, due: string, rating: string, clockBackMs?: number}} due = max(明天, FSRS due 的本地日)；clockBackMs = 判断时刻早于上次复习、被夹到上次复习的毫秒数（D65 #3）
 */
export function reviewCard(before, review, opts = {}) {
  const lib = getFSRSLibrary(opts.lib);
  const policy = opts.policy || defaultPolicy;
  const at = toMs(review.at);
  const warmup = opts.warmup !== undefined ? !!opts.warmup : !!review.cardKey && isWarmupKey(review.cardKey);
  const rating = ratingFor(review.judgment, review.help, policy, { first: isFirstReview(before), warmup });
  const start = before ? toLibraryCard(before) : lib.createEmptyCard(at);
  // D65 / 问题清单 #3：判断时刻早于上次复习（系统时间被往回调、校时、在时间较早的设备上恢复备份……）时，
  // 按「刚复习过」处理——review 时刻夹到 last_review（负间隔按 0），不把负的 elapsed_days 交给库
  // （否则稳定度被算成 0.001，回拨更多时库直接抛 Invalid time value，判断存不进去）。clockBackMs = 夹掉了多少毫秒（诊断用）。
  const last = before && before.last_review ? Date.parse(before.last_review) : NaN;
  const clockBackMs = Number.isFinite(last) && at < last ? last - at : 0;
  const reviewAt = clockBackMs ? last : at;
  const result = engineFor(lib).next(start, reviewAt, lib.Rating[rating]);
  const card = serializeCard(result.card);
  const today = localDay(at); // 「至少次日」仍按判断当时的本地日（记录的 localDay）
  const tomorrow = addDays(today, 1);
  const fsrsDay = localDay(toMs(card.due));
  const due = fsrsDay > tomorrow ? fsrsDay : tomorrow;
  return clockBackMs ? { card, due, rating, clockBackMs } : { card, due, rating };
}

/** 卡上次评级（判断或看答案的 Again）是不是在 day 这一天。 */
function reviewedOn(card, day, policy) {
  if (!card || !card.last_review) return false;
  const ms = Date.parse(card.last_review);
  return Number.isFinite(ms) && localDay(ms, policy) === day;
}

/**
 * 看过答案要不要记一次 Again（D66 ①，P321）：policy.answerSeenRating === 'Again'、卡已评过级（复习字）、没停、
 * 这一天还没评过级（没判断过、也没因为看答案记过 Again）。
 */
export function answerSeenAgainApplies(entry, record, policy = defaultPolicy) {
  if (!policy || policy.answerSeenRating !== 'Again') return false;
  if (!record || record.kind !== 'answer-seen' || !entry || !entry.fsrs || entry.stoppedAt !== undefined) return false;
  if ((Number(entry.fsrs.reps) || 0) === 0) return false;
  if (entry.seenAgainDay === record.localDay) return false;
  return !reviewedOn(entry.fsrs, record.localDay, policy);
}

/** 调度项的字段顺序固定（更正往返要逐字节相同）：fsrs, due, lastJudgedAt, seenAgainDay?, stoppedAt?。 */
function entryOf(fsrs, due, lastJudgedAt, seenAgainDay, stoppedAt) {
  const out = { fsrs, due, lastJudgedAt };
  if (seenAgainDay) out.seenAgainDay = seenAgainDay;
  if (stoppedAt !== undefined) out.stoppedAt = stoppedAt;
  return out;
}

/**
 * 看过答案后的调度项（D66 ①）：复习字当天第一次「没写出来」记一次 Again（不生成判断，lastJudgedAt 不变），记 seenAgainDay；
 * 其余情形（新字、当天已评过级、开关关）原样返回。
 * @returns {{entry: object|undefined, applied: boolean}}
 */
export function applyAnswerSeen(entry, record, opts = {}) {
  const policy = opts.policy || defaultPolicy;
  if (!answerSeenAgainApplies(entry, record, policy)) return { entry, applied: false };
  const { card, due } = reviewCard(entry.fsrs, { judgment: 'wrong', at: record.at, cardKey: record.cardKey }, opts);
  return { entry: entryOf(card, due, entry.lastJudgedAt, record.localDay, entry.stoppedAt), applied: true };
}

/** records 里 cardKey 在 beforeId 之前有没有「看过答案」记录（新字判断前看过答案，D66 ①）。 */
function seenBeforeIn(records, cardKey, beforeId) {
  if (!Array.isArray(records)) return false;
  const serial = (id) => {
    const m = /^r(\d+)$/.exec(String(id));
    return m ? Number(m[1]) : NaN;
  };
  const limit = serial(beforeId);
  return records.some((r) => r && r.kind === 'answer-seen' && r.cardKey === cardKey && (!Number.isFinite(limit) || serial(r.id) < limit));
}

/**
 * 判断落定后的调度项。返回新的 sched 项与判断前的卡（存到 Session.items[i].fsrsBefore 供本会话更正重放）。
 * D66 ①：当天已因看答案记过 Again 的字，这次判断不再进 FSRS（只更新 lastJudgedAt）；新字判断前看过答案（opts.records 里有它的
 * answer-seen 记录）按复习口径评级。这两种情形 fsrsBefore 带标记（seenAgainDay / seenBefore），replay 照同样的规则重放。
 * @param {object|undefined} entry 现有 sched[cardKey]
 * @param {{judgment, at, help}} record 刚写入的 judged 记录
 * @param {{policy?:object, records?:Array, lib?:object}} [opts] records = 全部记录（找「判断前看过答案」；缺省不找）
 */
export function applyJudgment(entry, record, opts = {}) {
  if (!record || record.kind !== 'judged') throw new RangeError('applyJudgment expects a judged record');
  const at = toMs(record.at);
  if (entry && entry.fsrs && entry.seenAgainDay && entry.seenAgainDay === record.localDay) {
    // 今天已经因为看答案记过一次 Again：这次判断是看过答案以后写的，不再评级（不记两次 Again，写对也不加分）
    return {
      entry: entryOf(entry.fsrs, entry.due, at, entry.seenAgainDay, entry.stoppedAt),
      fsrsBefore: { ...entry.fsrs, seenAgainDay: entry.seenAgainDay },
    };
  }
  // 新字的「判断前的卡」= 在判断时刻创建的空卡（与 reviewCard(null) 等价，重放结果相同）；
  // 始终存对象，schema 的 items[].fsrsBefore 只收对象。
  let fsrsBefore = entry && entry.fsrs ? entry.fsrs : emptyCard(record.at, opts);
  if (!(entry && entry.fsrs) && seenBeforeIn(opts.records, record.cardKey, record.id)) fsrsBefore = { ...fsrsBefore, seenBefore: true };
  const { card, due, clockBackMs } = reviewCard(fsrsBefore, record, opts);
  if (clockBackMs) {
    // D65 #3：只记诊断，不让提交失败（与 app.js 等处同一做法：console.warn '[shizi] …'）。
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[shizi] fsrs: judged before last review (clock moved back ' + Math.round(clockBackMs / 60000) + ' min); clamped to last review', record.cardKey || '');
    }
  }
  return { entry: entryOf(card, due, at, null, entry ? entry.stoppedAt : undefined), fsrsBefore };
}

/**
 * 从 fsrsBefore 依次重放若干记录（按 id 顺序、以各自 at 为 review 时间），与 applyJudgment / applyAnswerSeen 同一套规则：
 *   judged       → 评级（当天已因看答案记过 Again 的不再评级，D66 ①）；
 *   answer-seen  → 复习字当天第一次记 Again（D66 ①）；其余记录忽略。
 * 用于决定-D19 更正：只改 judgment，重放本会话此字的记录，得到确定的新 sched 项；也用于从头重放一个字的全部记录（core/mix.js）。
 * @param {object|null} fsrsBefore 判断前的卡（Session.items[i].fsrsBefore，可带 seenAgainDay / seenBefore 标记）；null 等同新卡
 * @returns {object|null} 新 sched 项；没有可重放的 judged 记录时返回 null（调用方保留原 sched 项）
 */
export function replay(fsrsBefore, records, opts = {}) {
  const policy = opts.policy || defaultPolicy;
  let card = fsrsBefore ? stripMarks(fsrsBefore) : null;
  let seenAgainDay = fsrsBefore && typeof fsrsBefore.seenAgainDay === 'string' ? fsrsBefore.seenAgainDay : null;
  let seenBefore = !!(fsrsBefore && fsrsBefore.seenBefore === true);
  let due = null;
  let lastJudgedAt = null;
  let judgedAny = false;
  for (const record of records || []) {
    if (!record) continue;
    if (record.kind === 'answer-seen') {
      if (!card || (Number(card.reps) || 0) === 0) {
        seenBefore = true; // 新字：不建卡，之后第一次判断按复习口径
        continue;
      }
      const probe = { fsrs: card, seenAgainDay };
      if (!answerSeenAgainApplies(probe, record, policy)) continue;
      const step = reviewCard(card, { judgment: 'wrong', at: record.at, cardKey: record.cardKey }, opts);
      card = step.card;
      due = step.due;
      seenAgainDay = record.localDay;
      continue;
    }
    if (record.kind !== 'judged') continue;
    judgedAny = true;
    lastJudgedAt = toMs(record.at);
    if (card && seenAgainDay && seenAgainDay === record.localDay) {
      // 当天已因看答案记过 Again：这次判断不再评级
      if (due === null) {
        const fsrsDay = localDay(toMs(card.due), policy);
        const next = addDays(record.localDay, 1);
        due = fsrsDay > next ? fsrsDay : next;
      }
      continue;
    }
    const before = !card && seenBefore ? { ...emptyCard(record.at, opts), seenBefore: true } : card && seenBefore && (Number(card.reps) || 0) === 0 ? { ...card, seenBefore: true } : card;
    const step = reviewCard(before, record, opts);
    card = step.card;
    due = step.due;
    seenAgainDay = null;
    seenBefore = false;
  }
  if (!judgedAny || due === null) return null;
  return entryOf(card, due, lastJudgedAt, seenAgainDay, opts.stoppedAt);
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
