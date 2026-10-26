// 查字弹层 / S02 的视图模型（B3.6；计划 §3.4：视图 op = 网页渲染用的**同一个**模型函数；原生只认 copy 键 + 参数）。
//
// 网页与原生共用这一份纯函数：
//   网页 src/ui/components/query/QuerySheet.js（弹层）、CharCard.js（字卡）从这里取模型；
//   原生经 App API view.query（src/session/api/query.js）拿同一份模型，copy 键用 ShiziCopy 渲染（文案一字不差）。
//
// 模型里的文案只给「copy 键 + 参数」（§3.4），不拼句子；原生源码里不写汉字字面量。

import * as defaultPolicy from '../../config/policy.js';
import { libraryById } from '../../core/cards.js';
import { allCards, cardForKey, currentLibraryId } from '../../data/deck.js';
import { monthDayParts } from '../../core/dates.js';
import { decodeInk, resampleForReplay } from '../../core/ink-math.js';
import {
  charSummary, filterInput, filterNotes, flattenRecords, isPracticable, parsePinyinInput, pickBar, pinyinMatches, pyKey,
  queryView, rowStatus, selectedChars, withCustomAdded, writtenChars,
} from '../../core/query.js';

// ---------------------------------------------------------------- 谓词与拼音索引（原在 ui/components/query/QuerySheet.js；搬到这里供网页与 API 共用）

/** 题库与当前练习范围的查字谓词（「不能练」判定：不在当前库且不在题库，core/query isPracticable）。 */
export function deckPredicates(settings, lookup = cardForKey) {
  const lib = libraryById(currentLibraryId(settings));
  const card = c => lookup(`base:${c}`);
  return {
    inDeck: c => !!card(c),
    inLibrary: c => {
      const k = card(c);
      return !!(k && lib && lib.test(k));
    },
    card,
    pinyinEntries: () => pinyinEntriesOf(allCards(), lookup),
  };
}

/** 拼音索引：题库卡数组（同一份）只建一次。字频序 = 题库顺序；每个字取它自己的 base 卡的拼音。 */
const pinyinMemo = new WeakMap();
function pinyinEntriesOf(cards, lookup) {
  if (!Array.isArray(cards) || !cards.length) return [];
  const memo = pinyinMemo.get(cards);
  if (memo && memo.lookup === lookup) return memo.list;
  const seen = new Set();
  const list = [];
  for (const c of cards) {
    const ch = c && c.target;
    if (!ch || seen.has(ch)) continue;
    const card = lookup(`base:${ch}`);
    if (!card) continue;
    seen.add(ch);
    const key = pyKey(card.py);
    if (key) list.push({ char: ch, key });
  }
  pinyinMemo.set(cards, { lookup, list });
  return list;
}

/** 模型：给定输入与状态，算出视图、提示、逐字摘要、pick 底栏。纯函数（网页与 API 同一份）。 */
export function sheetModel({ mode, text, cur, selected, state, predicates, policy = defaultPolicy }) {
  const records = flattenRecords(state && state.records);
  let filtered = filterInput(text, { max: policy.queryInputMax });
  // 只有拼音字母（可带声调，v 当 ü）：列出读音匹配的字（本人写过的在前，再按常用度）；与输入汉字同一套行 / 卡片 / 勾选。
  const py = filtered.hanCount === 0 && typeof predicates.pinyinEntries === 'function' ? parsePinyinInput(text) : null;
  let pinyin = null;
  if (py) {
    const chars = pinyinMatches(py.query, predicates.pinyinEntries(), { written: writtenChars(records) });
    pinyin = { raw: py.raw, count: chars.length };
    filtered = { chars, removed: 0, duplicates: [], hanCount: 0, overLimit: 0, total: filtered.total };
  }
  const practicable = c => isPracticable(c, predicates);
  const v = queryView({ chars: filtered.chars, cur, practicable });
  const ctx = { records, sched: state ? state.sched : null, custom: state ? state.custom : null };
  const summaries = filtered.chars.map(c => charSummary(c, { ...ctx, practicable: practicable(c) }));
  const chosen = mode === 'pick' ? selectedChars(filtered.chars, selected, practicable) : [];
  return {
    filtered,
    view: v.view,
    cur: v.cur,
    notes: pinyin ? (pinyin.count ? [] : [{ key: 'X-QUERY.pinyinNone', vars: { char: pinyin.raw } }]) : filterNotes(filtered, v.view),
    pinyin: !!pinyin,
    summaries,
    summary: v.cur ? summaries.find(s => s.char === v.cur) : null,
    multi: filtered.chars.length > 1,
    chosen,
    bar: mode === 'pick' && (v.view === 'hint' || v.view === 'rows') ? pickBar(chosen.length) : null,
  };
}

/** 加入自选的字：一次 commit（决定-D21）。已在自选里时不写。返回 store.commit 的结果。 */
export function commitAdd(store, char) {
  return store.commit('query:add', (draft, ctx) => {
    const next = withCustomAdded(draft.custom, char, ctx.now);
    if (next) draft.custom = next;
  });
}

// ---------------------------------------------------------------- 文案引用（copy 键 + 参数）

/** 「{拼音} · N 画」；缺笔画数只写拼音。 */
export function cardMetaRef(pinyin, strokeCount) {
  if (pinyin && strokeCount > 0) return { key: 'X-QUERY.cardMeta', vars: { pinyin, n: strokeCount } };
  if (pinyin) return { key: 'X-QUERY.cardMeta', vars: { pinyin, n: 0 } };
  return null;
}

/** 卡片记录行：「记录了 N 次 · 最近一次 M 月 D 日」/「还没有记录」。 */
export function cardStatRef(summary) {
  const s = summary && summary.count && summary.latestDay
    ? { key: 'R-Q05.cardStat', vars: { n: summary.count, day: summary.latestDay } }
    : { key: 'R-Q04.rowNone', vars: {} };
  return s;
}

/** 日期（localDay）→ copy 引用（R-H02.dateFormat）。 */
export function dateRef(day) {
  if (!day) return null;
  const p = monthDayParts(day);
  return { key: 'R-H02.dateFormat', vars: { month: p.month, day: p.day } };
}

// ---------------------------------------------------------------- 原生用的模型（可序列化）

/**
 * 查字弹层的视图模型（原生与网页共用同一份纯逻辑；文案只给 copy 键 + 参数）。
 * @param {object} o
 * @param {'lookup'|'pick'} o.mode
 * @param {string} o.text      输入框原文
 * @param {string} o.cur       正在看卡片的那个字
 * @param {string[]} o.selected pick 模式已选的字
 * @param {object} o.state     store 的状态
 * @param {object} o.predicates deckPredicates 的结果
 * @param {function} [o.getInk] store.getInk（「你的书写」的笔迹）
 */
export function querySheetModel({ mode, text, cur, selected, state, predicates, getInk = null, policy = defaultPolicy }) {
  const m = sheetModel({ mode, text, cur, selected, state, predicates, policy });
  const rows = [];
  if (m.view === 'rows') {
    for (const s of m.summaries) {
      const c = predicates.card(s.char);
      const st = rowStatus(s);
      rows.push({
        char: s.char,
        pinyin: c ? c.py : '',
        word: c ? c.word : '',
        status: { key: st.key, vars: st.vars || {} },
        selectable: mode === 'pick' && !!s.practicable,
        selected: m.chosen.includes(s.char),
        practicable: !!s.practicable,
        custom: !!s.custom,
        count: s.count,
      });
    }
  }
  let card = null;
  let bad = null;
  if ((m.view === 'card' || m.view === 'bad') && m.summary) {
    const c = predicates.card(m.cur);
    const common = {
      char: m.cur,
      pinyin: c ? c.py : '',
      word: c ? c.word : '',
      strokes: c ? c.strokes : 0,
      custom: !!m.summary.custom,
      count: m.summary.count,
    };
    if (m.view === 'card') {
      card = {
        ...common,
        meta: cardMetaRef(common.pinyin, common.strokes),
        stat: cardStatRef(m.summary),
        ink: inkPointsOf(m.summary, getInk),
      };
    } else {
      bad = {
        ...common,
        title: { key: 'R-Q05.unavailableTitle', vars: { char: m.cur } },
        reason: { key: 'R-Q05.unavailableReason', vars: {} },
        source: { key: 'R-Q05.unavailableSource', vars: {} },
      };
    }
  }
  return {
    mode,
    title: { key: mode === 'pick' ? 'R-Q01.titlePick' : 'R-Q01.titleLookup', vars: {} },
    placeholder: { key: 'R-Q01.placeholder', vars: {} },
    view: m.view,
    cur: m.cur,
    multi: m.multi,
    notes: m.notes.map(n => ({ key: n.key, vars: n.vars || {} })),
    hint: m.view === 'hint' ? { key: 'R-Q02.pickNote', vars: {} }
      : m.view === 'rows' ? { key: 'R-Q02.lookupNote', vars: {} } : null,
    rows,
    card,
    bad,
    back: m.multi && (m.view === 'card' || m.view === 'bad')
      ? { key: 'R-Q05.backToList', vars: { n: m.filtered.chars.length } } : null,
    bar: m.bar ? { key: m.bar.key, vars: m.bar.vars || {}, disabled: !!m.bar.disabled } : null,
    chosen: m.chosen,
  };
}

/**
 * 「你的书写」取哪一条的笔迹（P19 policy.queryCardInk = 'latest'）：管线点列（绝对宽），没有返回 null。
 * 与网页 components/query/CharCard.js 的 cardInkPoints 同一份逻辑（同一函数搬到这里）。
 * 形状 = 笔画数组：每一笔是一串 [x, y]（网页的 InkMini 收的也是笔画数组）。
 */
export function inkPointsOf(summary, getInk, policy = defaultPolicy) {
  if (!summary || !summary.latest || typeof getInk !== 'function') return null;
  if (policy.queryCardInk !== 'latest') return null;
  let ink = null;
  try {
    ink = getInk(summary.latest);
  } catch (error) {
    ink = null;
  }
  const decoded = ink ? decodeInk(ink) : null;
  if (!decoded || !decoded.length) return null;
  const points = resampleForReplay(decoded);
  return points.map(stroke => (stroke || []).map(p => [p.x, p.y]));
}
