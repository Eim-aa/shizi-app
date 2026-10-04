// 首页数据模型（纯函数，无 DOM；02 M2-1；01 §2 首页状态两个正交维度 records × resume；test/ui/home.test.mjs 直接调用）。
//
//   homeModel(state, nowMs, {policy}) → {
//     today, period, dateParts:{month, day}, epigraph,
//     records: 'first' | 'empty' | 'record',     // 维度一：从记录派生（原型首页壳 L218 hState；K06 / R-H09 修正）
//     resume:  'none' | 'A' | 'B' | 'A+B',       // 维度二：从会话派生（S01 / R-H04；D05 B 优先续写）
//     primary, other,                             // S01 两行：{slot, kind, remaining}；primary = B 优先，other 只在 A、B 都没写完时 = A
//     count, inkRow,                              // 今天记录了 N 个字（D12：今天 judged 按字去重）；墨迹行最近 8 条 judged（按 id，同字留最近一次）
//     showRecord, showFirstTip,
//     capital,                                    // D40：下一次练习是大写数字特别组时 = 'capital1' | 'capital2'（首页给一句提示，P129），否则 null
//     view, hero, progress, gapDays,              // 阶段 1 P1-E5（设计稿「首练与首页」§一 / §四，03 P155）：首页呈现哪一态，见 homeViewOf
//   }
//
// 口径：
// - records：今天有 judged → 'record'；否则曾有 judged（或清空过 / 导入过旧练习日，session-start.aStartInfo 的 firstVisit=false）
//   → 'empty'；真的第一次来 → 'first'。清空所有记录后首页不再说「第一次来」（R-H09 / 走查-K06 / P46），用「没有记录」的说法 =
//   'empty'（原型 empty 态计数行为空字串，H:236）。
// - resume：按「现在」看各槽有没有没写完、且不会因跨天作废的组（resumableSession 已含 P37 / P61 过期口径），不写入；
//   写入（expireStale）由首页在挂载 / 回前台时做。
// - 有没写完的组时首页显示这一组的格子（progress），不再同时显示「今天写了 N 个字」+ 今天的字（P16 已随设计稿改定，见 03 P16）。
// - 「第一次来，先写 3 个字试试。」（R-H03，D38 首练 3 字）只在 records==='first' 且没有没写完的组时显示（原型 noResume 才显示计数行位置的
//   文字，H:83；有组时 S01 行已写明「第一次练习 · 还有 N 个字没写」）。

import * as defaultPolicy from '../../../config/policy.js';
import { epigraphFor } from '../../../config/epigraphs.js';
import { diffDays, localDay, monthDayParts, periodOf } from '../../../core/dates.js';
import { charOfCardKey, hasAnyJudged, isJudged, latestJudgedByCard, sortById, todayCount, todayInkRow } from '../../../core/records.js';
import { remainingCount } from '../../../core/sessions.js';
import { aStartInfo, planSpecial, recordsOf, resumableSession } from '../../../core/session-start.js';

/** 今天写的字最多几项（决定-D12：N ≤ 8 显示 N 项，N > 8 显示最近判断的 8 项，数字仍为 N；设计稿 §三：8 个字以内一行或两行四列）。 */
export const INK_ROW_MAX = 8;
/** 「昨天写的字」一行最多几个字（设计稿 §三「昨天写的字」行：最多 5 字，P156）。 */
export const LAST_ROW_MAX = 5;
/** 离开多少天算「回来」（D41：离开 ≥7 天回来的第一组照常 1 新；首页换成「你写过的 N 个字都还在」，P155）。 */
export const BACK_AFTER_DAYS = 7;

/**
 * S01 行的数据。remaining = 还没开始写的字数；当前字已经看过答案、正在描或自己写（current.answerSeen）时不再算进去，
 * 另给 position = 正在写的是第几个字（已决定 D36 / P77：「正在写第 k 个字 · 还有 m 个」，不再数两次）。
 */
function lineOf(session, slot) {
  if (!session) return null;
  const total = remainingCount(session);
  const line = { slot, kind: session.kind, remaining: total };
  if (total > 0 && session.current && session.current.answerSeen === true) {
    line.remaining = total - 1;
    line.position = session.cursor + 1;
  }
  return line;
}

/** 维度二：resume。 */
export function resumeOf(state, nowMs, { policy = defaultPolicy } = {}) {
  const a = resumableSession(state, 'A', { now: nowMs, policy });
  const b = resumableSession(state, 'B', { now: nowMs, policy });
  const resume = a && b ? 'A+B' : b ? 'B' : a ? 'A' : 'none';
  // 原型 APP @379350：cs = B 没写完 ? B : A 没写完 ? A : null；otherSlot() 只在两组都没写完时 = 'A'。
  const primary = b ? lineOf(b, 'B') : a ? lineOf(a, 'A') : null;
  const other = a && b ? lineOf(a, 'A') : null;
  return { resume, primary, other };
}

/** 维度一：records。 */
export function recordsStateOf(state, today, { policy = defaultPolicy } = {}) {
  const records = recordsOf(state);
  if (todayCount(records, today) > 0) return 'record';
  if (hasAnyJudged(records)) return 'empty';
  return aStartInfo(state, { policy }).firstVisit ? 'first' : 'empty';
}

/** 最近一次有判断记录的那天（含今天）；从没有 → null。 */
export function lastJudgedDayOf(records) {
  let last = null;
  for (const r of records || []) if (isJudged(r) && (last === null || r.localDay > last)) last = r.localDay;
  return last;
}

/**
 * 首页呈现哪一态（设计稿「首练与首页」§一 / §四；03 P155）。优先级自上而下：
 *   progress  有没写完的组（含首练写到一半）——格子；
 *   first     真的第一次来、没有任何组——首次打开（书家「拾」+ 题跋，没有日期和标题）；
 *   special   下一次练习是大写数字特别组（D40）；
 *   today     今天写过；
 *   back      最近一次判断在 ≥7 天前（D41）；
 *   fresh     其余：今天还没写。
 * 首页的位置、标题、题记、主按钮在各态里不动，只有字帖位与下一行不同。
 */
export function homeViewOf({ records, resume, capital, gapDays }) {
  if (resume !== 'none') return 'progress';
  if (records === 'first') return 'first';
  if (capital) return 'special';
  if (records === 'record') return 'today';
  if (gapDays !== null && gapDays >= BACK_AFTER_DAYS) return 'back';
  return 'fresh';
}

/**
 * 字帖位放什么：'shi'（书家「拾」）/ 'today'（今天写的字）/ 'progress'（这一组的格子）。
 * 特别组那天已经写过字时字帖位照常放今天的字（设计稿 §四 ④）。
 */
export function heroOf(view, records) {
  if (view === 'progress') return 'progress';
  if (view === 'today') return 'today';
  if (view === 'special') return records === 'record' ? 'today' : 'shi';
  return 'shi';
}

/** 进行中的组最多画几格（设计稿：1–3 / 4 / 5 / 6–8 字五档格宽；更长的组只画包含当前字的 8 格）。 */
export const PROGRESS_MAX = 8;

/**
 * 进行中的组的格子（不泄题）：
 *   done    已判断（有记录，墨迹由页面按记录取）；
 *   passed  跳过 / 看过答案（没有本人墨，画空格，不画字）；
 *   next    下一个要写的格（墨框，不露字）；
 *   empty   还没写的格（十字线，不露字）。
 * 超过 PROGRESS_MAX 个字时取包含当前字的 8 格窗口（当前字尽量靠第 4 格）。
 * @returns {{cells:Array<{index:number, state:string, char?:string, record?:object}>, total:number, start:number}}
 */
export function progressCells(session, records, { max = PROGRESS_MAX } = {}) {
  if (!session) return { cells: [], total: 0, start: 0 };
  const queue = session.queue || [];
  const byId = new Map();
  for (const r of records || []) if (r && r.id) byId.set(r.id, r);
  const all = queue.map((cardKey, index) => {
    if (index < session.cursor) {
      const item = (session.items || [])[index] || null;
      const record = item && item.recordId ? byId.get(item.recordId) || null : null;
      if (record && isJudged(record)) return { index, state: 'done', char: record.char || charOfCardKey(cardKey), record };
      return { index, state: 'passed' };
    }
    return { index, state: index === session.cursor ? 'next' : 'empty' };
  });
  const start = all.length <= max ? 0 : Math.max(0, Math.min(session.cursor - 3, all.length - max));
  return { cells: all.slice(start, start + max), total: all.length, start };
}

/**
 * 「昨天写的字」一行（设计稿 §三，P156）：最近一个（不含今天）有记录的日子里，同字留最近一次、只放有本人墨迹的字
 * （没有墨迹的字不放进这一行，也不放衬底），取最后 limit 个、按写的先后排。那一天一个有墨的字都没有 → 往前找下一个有记录的日子。
 * @param {Array} records
 * @param {string} today
 * @param {{hasInk:(record)=>boolean, limit?:number}} o
 * @returns {{day:string, yesterday:boolean, items:Array<{char:string, record:object}>}|null}
 */
export function lastWrittenRow(records, today, { hasInk, limit = LAST_ROW_MAX } = {}) {
  const byDay = new Map();
  for (const r of sortById((records || []).filter(isJudged))) {
    if (!(r.localDay < today)) continue;
    if (!byDay.has(r.localDay)) byDay.set(r.localDay, new Map());
    const m = byDay.get(r.localDay);
    m.delete(r.cardKey);
    m.set(r.cardKey, r);
  }
  const days = [...byDay.keys()].sort().reverse();
  for (const day of days) {
    const items = [...byDay.get(day).values()].filter(r => (typeof hasInk === 'function' ? hasInk(r) : true))
      .map(r => ({ char: r.char || charOfCardKey(r.cardKey), record: r }));
    if (!items.length) continue;
    return { day, yesterday: diffDays(day, today) === 1, items: items.slice(Math.max(0, items.length - limit)) };
  }
  return null;
}

/** 字库里有几个字（有过判断记录的字，按字去重）——首页「字库里有 N 个字了」。 */
export function libraryCountOf(records) {
  return latestJudgedByCard(records || []).size;
}

/**
 * 首页全部派生数据。
 * @param {object|null} state  store 状态（未启动时 null → 按空状态算）
 * @param {number} nowMs       应用时钟（platform/env.js now()，测试钩子 setClock 可平移）
 * @param {{deck?: object}} [o] deck = 选字用的题库适配器（data/deck.js deckAdapter）；缺省不算大写数字特别组（capital 恒为 null）
 */
export function homeModel(state, nowMs, { policy = defaultPolicy, inkRowMax = INK_ROW_MAX, deck = null } = {}) {
  const today = localDay(nowMs);
  const records = recordsOf(state);
  const count = todayCount(records, today);
  const recordsState = recordsStateOf(state, today, { policy });
  const { resume, primary, other } = resumeOf(state, nowMs, { policy });
  const resumeOn = resume !== 'none';
  const showRecord = recordsState === 'record' && !resumeOn;
  const special = deck && !resumeOn && recordsState !== 'first' ? planSpecial(state, { today, deck, policy }) : null;
  const capital = special ? special.kind : null;
  const lastDay = lastJudgedDayOf(records);
  const gapDays = lastDay === null ? null : diffDays(lastDay, today);
  const view = homeViewOf({ records: recordsState, resume, capital, gapDays });
  const hero = heroOf(view, recordsState);
  const primarySession = primary ? resumableSession(state, primary.slot, { now: nowMs, policy }) : null;
  return {
    today,
    period: periodOf(nowMs),
    dateParts: monthDayParts(today),
    epigraph: epigraphFor(today),
    records: recordsState,
    resume,
    primary,
    other,
    count,
    inkRow: hero === 'today' ? todayInkRow(records, today, inkRowMax) : [],
    showRecord,
    showFirstTip: recordsState === 'first' && !resumeOn,
    capital,
    view,
    hero,
    gapDays,
    progress: view === 'progress' ? progressCells(primarySession, records) : null,
    libraryCount: libraryCountOf(records),
    // 自己选字：首次打开隐藏，首练完成后出现（D46 ②；首练写到一半也算没完成）；特别组那天由「这次先写平常的字」占这个位置（D46 ④）
    showPick: recordsState !== 'first' && !(primary && primary.kind === 'first') && view !== 'special',
  };
}

/** S01 行的文案键（R-H04）：这次选的字 / 第一次练习 / 今天的练习。 */
export function resumeKeyOf(kind) {
  if (kind === 'picked') return 'R-H04.resumePicked';
  if (kind === 'first') return 'R-H04.resumeFirst';
  return 'R-H04.resumeDaily';
}

/**
 * S01 行的文案与占位符：普通 = 「… · 还有 {n} 个字没写」；当前字看过答案仍在写 =「… · 正在写第 {k} 个字 · 还有 {n} 个」，
 * 它是最后一个字时「… · 正在写第 {k} 个字 · 这是最后一个」。
 */
export function resumeLineText(line, translate) {
  if (!line) return '';
  const base = resumeKeyOf(line.kind);
  if (line.position === undefined) return translate(base, { n: line.remaining });
  return translate(line.remaining > 0 ? `${base}Now` : `${base}NowLast`, { k: line.position, n: line.remaining });
}

/** 题记每列的高度（原型首页壳 QH：上句去掉句末标点后 4 / 5 / 7 字 → 96 / 114 / 150）。 */
export const EPIGRAPH_COLUMN = Object.freeze({ 4: 96, 5: 114, 7: 150 });

/**
 * 题记（右上竖排：下句 + 上句两列，出处一列 + 印）占的高度（px，自首页顶起；设计稿 §三「首页」）：出处一列从 44（+ 长句的半个差）起，
 * 每字 13 + 字距 .12em ≈ 14.56，下面 8 + 印 16。首页字帖位比较宽（今天写的字 / 进行中的格子，3 格以上）时，字帖位的顶不能高过它，
 * 否则格子的上沿会压到出处的末字——首页据此给字帖位区域留一段上边距（紧凑版题记合成一列、贴右边，同样要让）。
 */
export function epigraphReserve(epigraph, { compact = false } = {}) {
  if (!epigraph) return 0;
  if (compact) {
    // 紧凑版题记合成一列（13pt，每字 13 + 字距 .12em ≈ 14.56，下面 8 + 印 16），贴右边、不放出处
    const n = [...epigraph.lines.join('')].length;
    return Math.ceil(4 + n * 14.56 + 8 + 16);
  }
  const colH = epigraphColumnHeight(epigraph);
  const srcLen = [...String(epigraph.source || '')].length;
  const quoteBottom = colH;
  const srcBottom = 44 + (colH - 96) / 2 + srcLen * 14.56 + 8 + 16;
  return Math.ceil(4 + Math.max(quoteBottom, srcBottom));
}

/**
 * 字帖位（宽 tieWidth，在屏宽 width 里居中）的右缘会不会伸到题记下面：标准版题记（两列 + 出处）的左缘约在 width − 100，
 * 紧凑版（一列）约在 width − 36。会的话首页给字帖位区域留 epigraphReserve 的上边距。
 */
export function tieIntrudesEpigraph({ width, tieWidth, compact = false }) {
  const epiLeft = compact ? width - 36 : width - 100;
  return (width + tieWidth) / 2 > epiLeft - 4;
}

export function epigraphColumnHeight(epigraph) {
  const n = epigraph && epigraph.lines && epigraph.lines[0] ? [...epigraph.lines[0]].length - 1 : 4;
  return EPIGRAPH_COLUMN[n] || EPIGRAPH_COLUMN[4];
}
