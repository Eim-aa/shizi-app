// 写错过 / 快忘了清单的纯模型（02 M3-2；04 R-E01–R-E04；决定-D23；K15 / K16；边改 S06 / Z02；03 P04 / P31）。
//
// 口径（R-E01 / D23）：只看每个字最近一次有效记录（judged，按 id 序号）；由记录实时算（core/records.wrongList / forgetList），
// 两单不重叠（最近一次为 wrong → 写错过；为 correct 且 sched 到期 → 快忘了，policy.forgetRule / forgetCap，P04）。
// 勾选（R-E02 / S06；已决定 D36 / P113）：默认只选「最该练」的前 policy.listDefaultSelect（5）个——写错过 = 最近写错的，
// 快忘了 = 到期最久的（两单本来就按这个序排），不足 5 个按实际数；其余的收在「其余 N 个字」下，展开后可逐个选。
// 勾选状态 sel：null = 默认；数组 = 用户自己选定的字（点圆圈 / 全选 / 全不选后）。写完回来恢复默认由页面在
// 「从本页开的组结束」时把 sel 清成 null（04 §5.1-13：未写完返回保留勾选，写完回到清单回到默认）。
// 行（R-E03）：标准字 + 词语（目标字加粗）+ 小字（写错过「{日期}写错 · 一共写错 {N} 次」/ 快忘了「最近一次 {日期} · 记录了 {N} 次」）
// + 右边那一次的笔迹小图（写错过小图下「写错那次」，快忘了不写）。
//
// 纯函数：不访问 store / DOM；题库查找与可练谓词由调用方注入（页面传 data/deck.js，单测传假卡）。

import * as defaultPolicy from '../../../config/policy.js';
import { t, tInk } from '../../../config/copy/index.js';
import { monthDayParts } from '../../../core/dates.js';
import { forgetList, judgedCountOfCard, wrongCountOfCard, wrongList } from '../../../core/records.js';
import { memoryZones, skippedZone } from './model.js';

// wrong / forget：全部字页「写错过 / 快忘了」筛选的去处（M3-4）；due / shaky / known：字库首页三档记忆状态的区详情页（r7-L1，D60）。
export const LIST_KINDS = Object.freeze(['wrong', 'forget', 'due', 'shaky', 'known', 'skipped']);
/** 字库首页三档（D60）。 */
export const ZONE_KINDS = Object.freeze(['due', 'shaky', 'known']);

/** 清单种类 → 会话来源 view（R-R06 离开按钮、S05 来源说明；旧键 againList 兼容为 wrongList）。 */
export const VIEW_OF_KIND = Object.freeze({ wrong: 'wrongList', forget: 'forgetList', due: 'dueList', shaky: 'shakyList', known: 'knownList', skipped: 'skippedList' });

/** params.kind 规整：'forget' / 'forgetList' → forget；其余（含旧键 againList / wrongList）→ wrong。 */
/**
 * 清单行第二行「{日期}写错 · 一共写错 {n} 次」拆成不拆开的片段（H1 / V2-08，03 P224）：行内间隔号随前一段（「A ·」「B」），换行时换在间隔号之后，
 * 间隔号不会落在行首。
 */
export function listRowMetaParts(meta) {
  const parts = String(meta == null ? '' : meta).split(' · ');
  return parts.map((part, i) => (i < parts.length - 1 ? `${part} ·` : part));
}

export function normalizeKind(kind) {
  if (kind === 'forget' || kind === 'forgetList') return 'forget';
  if (kind === 'due' || kind === 'dueList') return 'due';
  if (kind === 'shaky' || kind === 'shakyList') return 'shaky';
  if (kind === 'known' || kind === 'knownList') return 'known';
  if (kind === 'skipped' || kind === 'skippedList') return 'skipped';
  return 'wrong';
}

/** 字库首页的区详情页种类：三档 + 已跳过（D62）。 */
export const ZONE_PAGE_KINDS = Object.freeze([...ZONE_KINDS, 'skipped']);

/** 区详情页？（三档 + 已跳过） */
export function isZoneKind(kind) {
  return ZONE_PAGE_KINDS.includes(normalizeKind(kind));
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
  if (isZoneKind(kind)) {
    const zoneKind = normalizeKind(kind);
    const zone = zoneKind === 'skipped' ? skippedZone(state) : memoryZones(state, today, {}).zones[zoneKind];
    return zone.items.map(({ cardKey, char, record }) => ({
      cardKey,
      char,
      record,
      count: judgedCountOfCard(records, cardKey), // 已跳过：0（没有判断记录）
      day: record.localDay,
    }));
  }
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

/** sel 规整：不是数组 → null（默认）；数组去重、只留字符串。 */
export function normalizeSel(sel) {
  if (!Array.isArray(sel)) return null;
  return [...new Set(sel.filter(c => typeof c === 'string' && c))];
}

export function sameSel(a, b) {
  const x = normalizeSel(a);
  const y = normalizeSel(b);
  if (x === null || y === null) return x === y;
  if (x.length !== y.length) return false;
  const set = new Set(x);
  return y.every(c => set.has(c));
}

/** 点圆圈：选上 ↔ 取消。cur = 当前已选的字（调用方先把默认展开成数组）。 */
export function toggleSel(cur, char) {
  const list = normalizeSel(cur) || [];
  return list.includes(char) ? list.filter(c => c !== char) : [...list, char];
}

/** 全选（S06）：把能选的字全部选上。 */
export function selectAllSel(model) {
  return model.rows.filter(r => r.selectable).map(r => r.char);
}

/** 全不选（S06）。 */
export function selectNoneSel() {
  return [];
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
 * @param {{kind:string, sel?:string[]|null, today:string, policy?:object,
 *          cardFor?:(cardKey:string)=>({word?:string}|null), practicable?:(cardKey:string)=>boolean}} o
 */
export function listModel(state, { kind: rawKind, sel = null, today, policy = defaultPolicy, cardFor = () => null, practicable = () => true }) {
  const kind = normalizeKind(rawKind);
  const isWrong = kind === 'wrong';
  const zone = isZoneKind(kind);
  const chosen = normalizeSel(sel);
  const chosenSet = new Set(chosen || []);
  const limit = Number.isInteger(policy.listDefaultSelect) && policy.listDefaultSelect > 0 ? policy.listDefaultSelect : Infinity;
  const entries = listEntries(state, { kind, today, policy });
  // 「最该练」= 清单顺序里前 limit 个能练的字；它们之前夹着的不能练的行也算在这一组里。
  let seen = 0;
  let topEnd = 0;
  entries.forEach((e, i) => {
    if (seen < limit && practicable(e.cardKey)) {
      seen += 1;
      topEnd = i + 1;
    }
  });
  const rows = entries.map((e, i) => {
    const card = cardFor(e.cardKey);
    const selectable = !!practicable(e.cardKey);
    const inTop = i < topEnd;
    const selected = selectable && (chosen ? chosenSet.has(e.char) : inTop);
    const date = dateText(e.day);
    // 区详情页「该复习了」里最近一次写错的字按写错的说法（带「写错那次」小图说明），其余按「最近一次 · 记录了 N 次」
    const rowWrong = isWrong || (zone && e.record.judgment === 'wrong');
    const skipped = kind === 'skipped';
    const meta = skipped ? t('X-LIBFOUR.skippedMeta', { date }) : rowWrong ? t('R-E03.wrongMeta', { date, n: e.count }) : t('R-E03.forgetMeta', { date, n: e.count });
    return {
      char: e.char,
      cardKey: e.cardKey,
      recordId: e.record.id,
      record: e.record,
      day: e.day,
      count: e.count,
      word: wordParts(card && card.word, e.char),
      meta,
      metaParts: listRowMetaParts(meta),
      thumbCaption: rowWrong ? t('R-E03.wrongThumb') : '',
      noThumb: skipped, // 已跳过的字没有笔迹，不画「没有笔迹」小图
      selectable,
      selected,
      group: inTop ? 'top' : 'rest',
    };
  });
  const topRows = rows.filter(r => r.group === 'top');
  const topSelectable = topRows.filter(r => r.selectable).length;
  const restCount = rows.length - topRows.length;
  const selectedKeys = rows.filter(r => r.selected).map(r => r.cardKey);
  const n = selectedKeys.length;
  const selectableCount = rows.filter(r => r.selectable).length;
  return {
    kind,
    view: VIEW_OF_KIND[kind],
    title: zone ? t(`X-LIBFOUR.zone.${kind}`) : isWrong ? t('R-E04.titleWrong') : t('R-E04.titleForget'),
    empty: rows.length === 0,
    emptyGlyph: zone ? t(`X-LIBFOUR.emptyGlyph.${kind}`) : isWrong ? t('X-LIST.emptyGlyphWrong') : t('X-LIST.emptyGlyphForget'),
    emptyTitle: zone ? t('X-LIBFOUR.zoneEmptyTitle') : isWrong ? t('R-E04.wrongEmpty') : t('X-LIST.forgetEmptyTitle'),
    emptyBody: zone ? t(`X-LIBFOUR.zoneEmptyBody.${kind}`) : isWrong ? t('X-LIST.wrongEmptyBody') : t('R-E04.forgetEmpty'),
    // 「先练这 N 个」= 最该练的那一组（不足 5 个按实际数）；一个都练不了时退回总数。与当前勾选无关，勾选看底栏。
    head: topSelectable > 0 ? t('X-LIST.firstHead', { n: topSelectable }) : t('X-LIST.countHead', { n: rows.length }),
    topCount: topRows.length,
    restCount,
    restLabel: restCount > 0 ? t('X-LIST.restShow', { n: restCount }) : '',
    restHideLabel: restCount > 0 ? t('X-LIST.restHide', { n: restCount }) : '',
    customSel: chosen !== null,
    top: zone ? t(`X-LIBFOUR.zoneTop.${kind}`) : isWrong ? t('R-E04.wrongTop') : t('R-E04.forgetTop'),
    note: isWrong ? tInk('R-E03.wrongNote', undefined, policy) : tInk('R-E03.forgetNote', undefined, policy),
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
