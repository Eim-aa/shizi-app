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
import { charOfCardKey, hasAnyJudged, isJudged, latestJudgedByCard, todayCount } from '../../../core/records.js';
import { hasInkOfState } from '../../../core/ink-pick.js';
import { workMembers } from '../../../core/work-members.js';
import { remainingCount } from '../../../core/sessions.js';
import { aStartInfo, planSpecial, recordsOf, resumableSession } from '../../../core/session-start.js';

/** 今天写的字最多几项（决定-D12：N ≤ 8 显示 N 项，N > 8 显示最近判断的 8 项，数字仍为 N；设计稿 §三：8 个字以内一行或两行四列）。 */
export const INK_ROW_MAX = 8;
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

/** 字库里有几个字（有过判断记录的字，按字去重）——首页字帖位块的读屏标签「字库里有 N 个字了」（D49-7：不再画在首页上）；也是回来态「你写过的 N 个字都还在」的 N。 */
export function libraryCountOf(records) {
  return latestJudgedByCard(records || []).size;
}

/**
 * 首页今天的字帖行（决定-D12 的取法 + 作品成员规则 D51 ⑤，core/work-members.js）：今天的作品成员（写对 ∪ 看后自写；写错的不进，计数仍照实），
 * 同字只留最近一次（D42：从晚到早第一条留有墨迹的），按最近一次出现的先后；N ≤ limit 时 N 项，N > limit 时取最近 limit 项。
 * @returns {object[]} 记录
 */
export function todayWorkRow(state, records, today, limit = INK_ROW_MAX, { hasInk = null } = {}) {
  const has = typeof hasInk === 'function' ? hasInk : hasInkOfState(state);
  const members = workMembers((records || []).filter(r => r && r.localDay === today), { prefer: 'last', order: 'last', hasInk: has });
  return members.slice(Math.max(0, members.length - limit)).map(m => m.record);
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
  const inkRow = view === 'progress' ? [] : todayWorkRow(state, records, today, inkRowMax);
  // 今天只写错了（作品成员为空）时字帖位没有字可放：退回书家「拾」，不画空字帖
  const hero = heroOf(view, recordsState) === 'today' && !inkRow.length ? 'shi' : heroOf(view, recordsState);
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
    inkRow: hero === 'today' ? inkRow : [],
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
 * S01 行的可见文字（P196，D49 ⑦）：只有「… · 接着写」，不显示剩余字数（计数只进读屏名称，见 resumeLineAria）。
 */
export function resumeLineText(line, translate) {
  if (!line) return '';
  return translate(resumeKeyOf(line.kind));
}

/**
 * S01 行的读屏名称：含可见文字「… · 接着写」，再加剩余字数——普通 = 「… · 接着写，还有 {n} 个字没写」；当前字看过答案仍在写 =
 * 「… · 接着写，正在写第 {k} 个字，还有 {n} 个」，它是最后一个字时「…，正在写第 {k} 个字，这是最后一个」。
 */
export function resumeLineAria(line, translate) {
  if (!line) return '';
  const base = resumeKeyOf(line.kind);
  if (line.position === undefined) return translate(`${base}Aria`, { n: line.remaining });
  return translate(line.remaining > 0 ? `${base}Now` : `${base}NowLast`, { k: line.position, n: line.remaining });
}
