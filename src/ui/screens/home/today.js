// 首页数据模型（纯函数，无 DOM；02 M2-1；01 §2 首页状态两个正交维度 records × resume；test/ui/home.test.mjs 直接调用）。
//
//   homeModel(state, nowMs, {policy}) → {
//     today, period, dateParts:{month, day}, epigraph,
//     records: 'first' | 'empty' | 'record',     // 维度一：从记录派生（原型首页壳 L218 hState；K06 / R-H09 修正）
//     resume:  'none' | 'A' | 'B' | 'A+B',       // 维度二：从会话派生（S01 / R-H04；D05 B 优先续写）
//     primary, other,                             // S01 两行：{slot, kind, remaining}；primary = B 优先，other 只在 A、B 都没写完时 = A
//     count, inkRow,                              // 今天记录了 N 个字（D12：今天 judged 按字去重）；墨迹行最近 8 条 judged（按 id，同字留最近一次）
//     showRecord, showFirstTip,
//   }
//
// 口径：
// - records：今天有 judged → 'record'；否则曾有 judged（或清空过 / 导入过旧练习日，session-start.aStartInfo 的 firstVisit=false）
//   → 'empty'；真的第一次来 → 'first'。清空所有记录后首页不再说「第一次来」（R-H09 / 走查-K06 / P46），用「没有记录」的说法 =
//   'empty'（原型 empty 态计数行为空字串，H:236）。
// - resume：按「现在」看各槽有没有没写完、且不会因跨天作废的组（resumableSession 已含 P37 / P61 过期口径），不写入；
//   写入（expireStale）由首页在挂载 / 回前台时做。
// - P16（policy.homeShowRecordWhileResume）：有没写完的组时是否仍显示「今天记录了 N 个字」+ 墨迹行；过渡 true = 显示。
// - 「第一次来，先写 5 个字试试。」（R-H03）只在 records==='first' 且没有没写完的组时显示（原型 noResume 才显示计数行位置的
//   文字，H:83；有组时 S01 行已写明「第一次练习 · 还有 N 个字没写」）。

import * as defaultPolicy from '../../../config/policy.js';
import { epigraphFor } from '../../../config/epigraphs.js';
import { localDay, monthDayParts, periodOf } from '../../../core/dates.js';
import { hasAnyJudged, todayCount, todayInkRow } from '../../../core/records.js';
import { remainingCount } from '../../../core/sessions.js';
import { aStartInfo, recordsOf, resumableSession } from '../../../core/session-start.js';

/** 墨迹行最多几项（决定-D12：N ≤ 8 显示 N 项，N > 8 显示最近判断的 8 项，数字仍为 N）。 */
export const INK_ROW_MAX = 8;
/**
 * 紧凑版（360×640 / 更大字体）墨迹行与计数合成一行、只放最近几个字（原型首页壳 L233 审美返修 A09）。数字仍为 N。
 * 过渡值在 policy.inkRowCompactMax（P75，过渡 4；D12 只写了 N ≤ 8，待产品确认）。
 */
export const INK_ROW_COMPACT_MAX = defaultPolicy.inkRowCompactMax;

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

/**
 * 首页全部派生数据。
 * @param {object|null} state  store 状态（未启动时 null → 按空状态算）
 * @param {number} nowMs       应用时钟（platform/env.js now()，测试钩子 setClock 可平移）
 */
export function homeModel(state, nowMs, { policy = defaultPolicy, inkRowMax = INK_ROW_MAX } = {}) {
  const today = localDay(nowMs);
  const records = recordsOf(state);
  const count = todayCount(records, today);
  const recordsState = recordsStateOf(state, today, { policy });
  const { resume, primary, other } = resumeOf(state, nowMs, { policy });
  const resumeOn = resume !== 'none';
  const showRecord = recordsState === 'record' && (!resumeOn || policy.homeShowRecordWhileResume !== false);
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
    inkRow: showRecord ? todayInkRow(records, today, inkRowMax) : [],
    showRecord,
    showFirstTip: recordsState === 'first' && !resumeOn,
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

export function epigraphColumnHeight(epigraph) {
  const n = epigraph && epigraph.lines && epigraph.lines[0] ? [...epigraph.lines[0]].length - 1 : 4;
  return EPIGRAPH_COLUMN[n] || EPIGRAPH_COLUMN[4];
}
