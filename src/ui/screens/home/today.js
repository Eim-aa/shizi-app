// 首页数据模型（纯函数，无 DOM；02 M2-1；01 §2 首页状态两个正交维度 records × resume；test/ui/home.test.mjs、h2-home-e.test.mjs 直接调用）。
//
//   homeModel(state, nowMs, {policy}) → {
//     today, period, dateParts:{month, day}, epigraph,
//     records: 'first' | 'empty' | 'record',     // 维度一：从记录派生（原型首页壳 L218 hState；K06 / R-H09 修正）
//     resume:  'none' | 'A' | 'B' | 'A+B',       // 维度二：从会话派生（S01 / R-H04；D05 B 优先续写）
//     primary, other,                             // S01 两行：{slot, kind, remaining}；primary = B 优先，other 只在 A、B 都没写完时 = A
//     showRecord, showFirstTip,
//     capital,                                    // D40：下一次练习是大写数字特别组时 = 'capital1' | 'capital2'（首页给一句提示，P129），否则 null
//     view, gapDays,                              // 首页呈现哪一态，见 homeViewOf
//     libraryCount, showPick,
//   }
//
// H2（D55，产品负责人选定首页方向 E「极静」）：首页只有日期、墨「拾」、竖排题记和按钮，不放写过的字 / 字帖行 / 数字 / 进度 / 说明；
// 六态只在主按钮的字（homeCtaKey）与两处各多一句（homeNoteOf：离开一周后、特别组那天）上不同。所以这里不再有字帖位的数据
// （今天的字 / 最近写的字 / 进行中的格子 / 「拾」交接 / 今天写了 N 个字）——它们随 C3-H 的字帖行一起删除。
//
// 口径：
// - records：今天有 judged → 'record'；否则曾有 judged（或清空过 / 导入过旧练习日，session-start.aStartInfo 的 firstVisit=false）
//   → 'empty'；真的第一次来 → 'first'。清空所有记录后首页不再说「第一次来」（R-H09 / 走查-K06 / P46），用「没有记录」的说法 =
//   'empty'（原型 empty 态计数行为空字串，H:236）。
// - resume：按「现在」看各槽有没有没写完、且不会因跨天作废的组（resumableSession 已含 P37 / P61 过期口径），不写入；
//   写入（expireStale）由首页在挂载 / 回前台时做。
// - 有没写完的组时主按钮是「继续写字」；A、B 两组都没写完时 A 那一行留作文字按钮「今天的练习 · 接着写」（other，P196）。
// - 「先写三个大家常忘的字。」（R-H03，D38 首练 3 字）只在 records==='first' 且没有没写完的组时显示（showFirstTip）。

import * as defaultPolicy from '../../../config/policy.js';
import { epigraphFor } from '../../../config/epigraphs.js';
import { diffDays, localDay, monthDayParts, periodOf } from '../../../core/dates.js';
import { hasAnyJudged, isJudged, latestJudgedByCard, todayCount } from '../../../core/records.js';
import { remainingCount } from '../../../core/sessions.js';
import { aStartInfo, planSpecial, recordsOf, resumableSession } from '../../../core/session-start.js';

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
 * 首页呈现哪一态（03 P155；D55 起六态只在主按钮字与两句话上不同）。优先级自上而下：
 *   progress  有没写完的组（含首练写到一半）——主按钮「继续写字」；
 *   first     真的第一次来、没有任何组——首次打开（框中「拾」+ 题跋，没有日期）；
 *   special   下一次练习是大写数字特别组（D40）；
 *   today     今天写过；
 *   back      最近一次判断在 ≥7 天前（D41）；
 *   fresh     其余：今天还没写。
 * 首页的「拾」、题记、主按钮的位置在各态里不动。
 */
export function homeViewOf({ records, resume, capital, gapDays }) {
  if (resume !== 'none') return 'progress';
  if (records === 'first') return 'first';
  if (capital) return 'special';
  if (records === 'record') return 'today';
  if (gapDays !== null && gapDays >= BACK_AFTER_DAYS) return 'back';
  return 'fresh';
}

/** 字库里有几个字（有过判断记录的字，按字去重）——回来态「你写过的 N 个字都还在」的 N。 */
export function libraryCountOf(records) {
  return latestJudgedByCard(records || []).size;
}

/**
 * 首页全部派生数据。
 * @param {object|null} state  store 状态（未启动时 null → 按空状态算）
 * @param {number} nowMs       应用时钟（platform/env.js now()，测试钩子 setClock 可平移）
 * @param {{deck?: object}} [o] deck = 选字用的题库适配器（data/deck.js deckAdapter）；缺省不算大写数字特别组（capital 恒为 null）
 */
export function homeModel(state, nowMs, { policy = defaultPolicy, deck = null } = {}) {
  const today = localDay(nowMs);
  const records = recordsOf(state);
  const recordsState = recordsStateOf(state, today, { policy });
  const { resume, primary, other } = resumeOf(state, nowMs, { policy });
  const resumeOn = resume !== 'none';
  const showRecord = recordsState === 'record' && !resumeOn;
  const special = deck && !resumeOn && recordsState !== 'first' ? planSpecial(state, { today, deck, policy }) : null;
  const capital = special ? special.kind : null;
  const lastDay = lastJudgedDayOf(records);
  const gapDays = lastDay === null ? null : diffDays(lastDay, today);
  const view = homeViewOf({ records: recordsState, resume, capital, gapDays });
  return {
    today,
    period: periodOf(nowMs),
    dateParts: monthDayParts(today),
    epigraph: epigraphFor(today),
    records: recordsState,
    resume,
    primary,
    other,
    showRecord,
    showFirstTip: recordsState === 'first' && !resumeOn,
    capital,
    view,
    gapDays,
    libraryCount: libraryCountOf(records),
    // 自己选字：首次打开隐藏，首练完成后出现（D46 ②；首练写到一半也算没完成）；特别组那天它仍在，旁边多一个「这次先写平常的字」（D55 / E ⑥，D46 ④）
    showPick: recordsState !== 'first' && !(primary && primary.kind === 'first'),
  };
}

/**
 * 主按钮的文案键（六态里只有它随状态变）：有没写完的组 →「继续写字」；首次打开 / 今天还没写 / 离开一周 / 特别组 →「开始写字」；今天写过 →「再写一组」。
 */
export function homeCtaKey(model) {
  if (model.resume !== 'none') return 'X-HOME.continue';
  if (model.view === 'first' || model.records !== 'record') return 'X-HOME.start';
  return 'X-RESULT.again';
}

/**
 * 首页「拾」与题记下面的那一句（只有两态各有一句）：离开一周后「你写过的 N 个字都还在。」（N = 字库里写过的字数）；
 * 大写数字特别组那天沿用特别组说明。其余态没有。返回 {key, vars} 或 null。
 */
export function homeNoteOf(model) {
  if (model.view === 'back') return { key: 'X-HOME.backNote', vars: { n: model.libraryCount } };
  if (model.view === 'special') return { key: 'X-HOME.capitalBody', vars: {} };
  return null;
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
