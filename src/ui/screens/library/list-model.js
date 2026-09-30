// 写错过 / 快忘了清单的纯模型（02 M3-2；04 R-E01–R-E04；决定-D23；K15 / K16；边改 S06 / Z02；03 P04 / P31）。
//
// 口径（R-E01 / D23）：只看每个字最近一次有效记录（judged，按 id 序号）；由记录实时算（core/records.wrongList / forgetList），
// 两单不重叠（最近一次为 wrong → 写错过；为 correct 且 sched 到期 → 快忘了，policy.forgetRule / forgetCap，P04）。
// 勾选（R-E02 / S06）：默认全选，用「取消了哪些字」off 表示（新出现的字默认选上）；写完回来重新全选由页面在
// 「从本页开的组结束」时把 off 清空（04 §5.1-13：未写完返回保留勾选，写完回到清单重新全选）。
// 行（R-E03）：标准字 + 词语（目标字加粗）+ 小字（写错过「{日期}写错 · 一共写错 {N} 次」/ 快忘了「最近一次 {日期} · 记录了 {N} 次」）
// + 右边那一次的笔迹小图（写错过小图下「写错那次」，快忘了不写）。
//
// 纯函数：不访问 store / DOM；题库查找与可练谓词由调用方注入（页面传 data/deck.js，单测传假卡）。

import * as defaultPolicy from '../../../config/policy.js';
import { t } from '../../../config/copy/index.js';
import { monthDayParts } from '../../../core/dates.js';
import { forgetList, judgedCountOfCard, wrongCountOfCard, wrongList } from '../../../core/records.js';

export const LIST_KINDS = Object.freeze(['wrong', 'forget']);

/** 清单种类 → 会话来源 view（R-R06 离开按钮、S05 来源说明；旧键 againList 兼容为 wrongList）。 */
export const VIEW_OF_KIND = Object.freeze({ wrong: 'wrongList', forget: 'forgetList' });

/** params.kind 规整：'forget' / 'forgetList' → forget；其余（含旧键 againList / wrongList）→ wrong。 */
export function normalizeKind(kind) {
  return kind === 'forget' || kind === 'forgetList' ? 'forget' : 'wrong';
}

/** 状态里的全部记录（含折叠月份的 kept）。 */
export function recordsOfState(state) {
  const out = [];
  const months = state && state.records && typeof state.records === 'object' ? state.records : {};
  for (const month of Object.keys(months)) {
    const value = months[month];
    const list = Array.isArray(value) ? value : value && Array.isArray(value.kept) ? value.kept : [];
    for (const r of list) out.push(r);
  }
  return out;
}

/** 界面日期「{month} 月 {day} 日」（R-H02.dateFormat，与结果页同一格式）。 */
export function dateText(day) {
  if (!day) return '';
  try {
    return t('R-H02.dateFormat', monthDayParts(day));
  } catch (error) {
    return '';
  }
}

/** 词语拆成 {pre, tg, post}：目标字（第一次出现）加粗；词语里没有这个字时整段放 pre。 */
export function wordParts(word, char) {
  const w = typeof word === 'string' ? word : '';
  if (!w || w === char) return { pre: '', tg: '', post: '', has: false };
  const cps = Array.from(w);
  const i = cps.indexOf(char);
  if (i < 0) return { pre: w, tg: '', post: '', has: true };
  return { pre: cps.slice(0, i).join(''), tg: char, post: cps.slice(i + 1).join(''), has: true };
}

/**
 * 某种清单的条目（按记录实时算）。
 * @returns {Array<{cardKey, char, record, count, day}>}  写错过：最近写错的排前；快忘了：core/records.forgetList 的顺序与上限
 */
export function listEntries(state, { kind, today, policy = defaultPolicy }) {
  const records = recordsOfState(state);
  if (normalizeKind(kind) === 'wrong') {
    return wrongList(records).map(record => ({
      cardKey: record.cardKey,
      char: record.char,
      record,
      count: wrongCountOfCard(records, record.cardKey),
      day: record.localDay,
    }));
  }
  const sched = state && state.sched && typeof state.sched === 'object' ? state.sched : {};
  return forgetList({ records, sched, today, policy }).items.map(({ cardKey, record }) => ({
    cardKey,
    char: record.char,
    record,
    count: judgedCountOfCard(records, cardKey),
    day: record.localDay,
  }));
}

/** off 表规整：去重、只留字符串。 */
export function normalizeOff(off) {
  if (!Array.isArray(off)) return [];
  return [...new Set(off.filter(c => typeof c === 'string' && c))];
}

export function sameOff(a, b) {
  const x = normalizeOff(a);
  const y = normalizeOff(b);
  if (x.length !== y.length) return false;
  const set = new Set(x);
  return y.every(c => set.has(c));
}

/** 点圆圈：选上 ↔ 取消。 */
export function toggleOff(off, char) {
  const cur = normalizeOff(off);
  return cur.includes(char) ? cur.filter(c => c !== char) : [...cur, char];
}

/** 全选（S06）。 */
export function selectAllOff() {
  return [];
}

/** 全不选（S06）：把能选的字全部放进 off。 */
export function selectNoneOff(model) {
  return model.rows.filter(r => r.selectable).map(r => r.char);
}

/** 底部按钮文案（R-E02：≥2「练这些字」、1「练这个字」、0「先选一个字」真禁用）。 */
export function buttonLabel(n) {
  if (n > 1) return t('R-E02.btnMany');
  if (n === 1) return t('R-E02.btnOne');
  return t('R-E02.btnNone');
}

/** 底部说明（R-E02 / Y05：0 个时只「写完会回到这里。」）。 */
export function hintText(n) {
  return n > 0 ? t('R-E02.selected', { n }) : t('R-E02.selectedZero');
}

/**
 * 清单页模型。
 * @param {object} state  store 状态
 * @param {{kind:string, off?:string[], today:string, policy?:object,
 *          cardFor?:(cardKey:string)=>({word?:string}|null), practicable?:(cardKey:string)=>boolean}} o
 */
export function listModel(state, { kind: rawKind, off = [], today, policy = defaultPolicy, cardFor = () => null, practicable = () => true }) {
  const kind = normalizeKind(rawKind);
  const isWrong = kind === 'wrong';
  const offSet = new Set(normalizeOff(off));
  const entries = listEntries(state, { kind, today, policy });
  const rows = entries.map(e => {
    const card = cardFor(e.cardKey);
    const selectable = !!practicable(e.cardKey);
    const selected = selectable && !offSet.has(e.char);
    const date = dateText(e.day);
    const meta = isWrong ? t('R-E03.wrongMeta', { date, n: e.count }) : t('R-E03.forgetMeta', { date, n: e.count });
    return {
      char: e.char,
      cardKey: e.cardKey,
      recordId: e.record.id,
      record: e.record,
      day: e.day,
      count: e.count,
      word: wordParts(card && card.word, e.char),
      meta,
      metaParts: meta.split(' · '),
      thumbCaption: isWrong ? t('R-E03.wrongThumb') : '',
      selectable,
      selected,
    };
  });
  const selectedKeys = rows.filter(r => r.selected).map(r => r.cardKey);
  const n = selectedKeys.length;
  const selectableCount = rows.filter(r => r.selectable).length;
  return {
    kind,
    view: VIEW_OF_KIND[kind],
    title: isWrong ? t('R-E04.titleWrong') : t('R-E04.titleForget'),
    empty: rows.length === 0,
    emptyGlyph: isWrong ? t('X-LIST.emptyGlyphWrong') : t('X-LIST.emptyGlyphForget'),
    emptyTitle: isWrong ? t('R-E04.wrongEmpty') : t('X-LIST.forgetEmptyTitle'),
    emptyBody: isWrong ? t('X-LIST.wrongEmptyBody') : t('R-E04.forgetEmpty'),
    head: t('X-LIST.countHead', { n: rows.length }),
    top: isWrong ? t('R-E04.wrongTop') : t('R-E04.forgetTop'),
    note: isWrong ? t('R-E03.wrongNote') : t('R-E03.forgetNote'),
    rows,
    selectedKeys,
    selectedCount: n,
    selectableCount,
    allSelected: selectableCount > 0 && n === selectableCount,
    toggleAllLabel: selectableCount > 0 && n === selectableCount ? t('X-LIST.selectNone') : t('X-LIST.selectAll'),
    hint: hintText(n),
    button: { label: buttonLabel(n), disabled: n === 0 },
  };
}

/**
 * 「从本页开的组」是否还在进行：B 槽有没写完的组，且来源是本清单（01 §3.3 source.view）。
 * 由真变假 = 那组结束了（写完 / 结束这组 / S02 结束那组）→ 页面把勾选恢复为全选（R-E02「写完回来重新全选」）。
 */
export function groupFromHereActive(state, view) {
  const b = state && state.sessions ? state.sessions.B : null;
  if (!b || !Array.isArray(b.queue) || !(b.cursor < b.queue.length)) return false;
  const v = b.source && b.source.view === 'againList' ? 'wrongList' : b.source && b.source.view;
  return v === view;
}
