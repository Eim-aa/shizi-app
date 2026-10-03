// 单字详情 · 模型与记录块（02 M3-6；04 R-D01–R-D04、R-D07、R-D09；决定-D23；03 P10b / P12 / P19；
// 原型 ShiziScreen-第十稿交接版 L32–L61、L389–L413；reference/J-proto-screen.md §2.3.3–§2.3.5）。
//
//   detailModel(state, char, {today, policy, lookup, hasInk})   纯函数：字卡、记录、写错过 / 快忘了、下次练习、做图片状态、
//                                                             自选、换掉的词语、旧照片——全部由 store 状态实时算（R-D01「修改判断后实时变」）。
//   RecordsBlock                                               「记录了 N 次 / 首次记录 {date}」+ 历次格子（按记录先后，没有空的
//                                                             「下一次」格，R-D03 / L12）；点格子放大（ZoomSheet，R-D03）；
//                                                             没有笔迹的记录：标准字 +「没有笔迹」，放大「这一次没有留下笔迹」（R-D07 / 10.12）。
//   SourceRow + useEtymology                                   字源行（data/etymology.json：{char, gloss, source}）；没有字源的字整块不显示（R-D09）。
//
// 口径（01 §3.2）：记录 = kind==='judged'；看过答案 / 跳过不算、不进格子。旧版本照片（photos[字]）不算有记录（P10b，
// policy.legacyPhotoCountsAsRecord=false），只在旧记录页看（photos.js）。
// 「写错过」= 最近一次 judged 为 wrong；「快忘了」= core/records forgetList（最近一次写对且 FSRS 到期，policy.forgetCap 内），
// 与清单页（M3-2）同一口径，两者互斥（K16）。
// 「下次练习」（P12 features.nextReviewLine）：只在有 judged 记录且 sched 有 due 时显示，日期取 sched.due。
// 「做成图片」（R-D04）：没有记录 → noRecord；最近一次 judged 没有笔迹 → noInk；否则 ok（入口本身由 M4-5 注册后才显示）。
//
// data-testid：detail-records（data-count）、detail-records-count、detail-records-first、detail-records-empty、detail-cells、
//   detail-cell（data-record / data-judgment / data-ink=true|false）、detail-cell-ink、detail-cell-glyph、detail-cell-noink、
//   detail-cell-caption、detail-zoom（放大弹层）、detail-zoom-ink、detail-zoom-noink、detail-zoom-close、detail-source、
//   detail-source-text、detail-source-from。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { Sheet } from '../../components/Sheet.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { monthDayParts } from '../../../core/dates.js';
import { compareRecordIds, forgetList, isJudged, sortById } from '../../../core/records.js';
import { flattenRecords } from '../../../core/query.js';
import { promptModel } from '../../../core/cards.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';
import { cardForKey, hasContextWord, withWordOff } from '../../../data/deck.js';
import { InkMini, recalledInk } from '../write/compare.js';
import { promptCopy } from '../write/prompt.js';

export const ZOOM_OVERLAY = 'detail-zoom';
export const ETYMOLOGY_URL = 'data/etymology.json';

injectStyles('detail-records', `
.sz-drec{display:flex;flex-direction:column;gap:12px}
.sz-drec__head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;column-gap:12px;row-gap:4px}
.sz-drec__count{font-family:${T.serif};font-size:calc(20px * ${T.k});font-weight:500;letter-spacing:.04em;color:${T.i2};white-space:nowrap}
.sz-drec__first{font-size:calc(15px * ${T.k});color:${T.i2};text-align:right}
.sz-drec__grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));box-sizing:border-box;border-top:1px solid var(--g, rgba(166,83,63,.28));
  border-left:1px solid var(--g, rgba(166,83,63,.28));background:${T.c}}
.sz-dcell{display:flex;flex-direction:column;box-sizing:border-box;min-width:0;padding:0;border-right:1px solid var(--g, rgba(166,83,63,.28));
  border-bottom:1px solid var(--g, rgba(166,83,63,.28));background:transparent;color:inherit;font:inherit;text-align:center;cursor:pointer}
.sz-dcell:focus-visible{outline:2px solid ${T.ar};outline-offset:-2px}
.sz-dcell__sq{position:relative;aspect-ratio:1/1;display:grid;place-items:center;color:${T.i4}}
.sz-dcell__sq .sz-compare__card{position:absolute;inset:0;width:100%;border:0;border-radius:0;background:transparent}
.sz-dcell__glyph{font-family:${T.sans};font-size:calc(30px * ${T.k});line-height:1;color:${T.i3}}
.sz-dcell__noink{position:absolute;left:0;right:0;bottom:4px;font-size:calc(11px * ${T.k});color:${T.i3}}
/* M6-2：大字时格子放不下「字 + 没有笔迹」叠放（320 宽 + 大字里说明压在字上），改成上下排、整组居中（P1-E6：大字 = 系统字号 --k ≥ 1.3，P131） */
:root[data-text-large] .sz-dcell__sq{align-content:center;gap:2px}
:root[data-text-large] .sz-dcell__noink{position:static}
.sz-dcell__cap{min-height:32px;box-sizing:border-box;padding:0 4px;display:flex;align-items:center;justify-content:center;gap:4px;
  border-top:1px solid var(--g, rgba(166,83,63,.28));font-size:calc(11px * ${T.k});line-height:calc(13px * ${T.k});letter-spacing:.02em;
  color:${T.i2};font-variant-numeric:tabular-nums;text-align:center}
.sz-dcell__cap[data-wrong="true"]{color:${T.ar}}
.sz-dzoom{display:flex;flex-direction:column;gap:14px}
.sz-dzoom__sq{width:100%;max-width:300px;align-self:center}
.sz-dzoom__close{align-self:stretch}
.sz-dsrc{display:grid;grid-template-columns:44px minmax(0,1fr);gap:8px;align-items:baseline}
.sz-dsrc__label{font-size:calc(13px * ${T.k});letter-spacing:.14em;color:${T.i3}}
.sz-dsrc__body{display:flex;flex-direction:column;gap:4px}
.sz-dsrc__text{font-family:var(--kai, serif);font-size:calc(19px * ${T.k});line-height:1.6;letter-spacing:.08em;color:${T.i1}}
.sz-dsrc__from{font-size:calc(13px * ${T.k});color:${T.i3}}
`);

// ---------------------------------------------------------------- 纯模型

export function baseKey(char) {
  return `base:${char}`;
}

/** 某字的全部记录（任何 kind，按 id 升序）；base: 与 custom:（旧数据）都算这个字。 */
export function recordsOfChar(state, char) {
  return sortById(flattenRecords(state && state.records).filter(r => r && r.char === char));
}

/** localDay → 「{month} 月 {day} 日」（R-H02.dateFormat）。 */
export function dayText(day) {
  try {
    return t('R-H02.dateFormat', monthDayParts(day));
  } catch (error) {
    return '';
  }
}

/** 格下标签「9·8 写对」与读屏名 / 放大标题「9 月 8 日 · 写对」。 */
export function cellCopy(record) {
  const caption = t(record.judgment === 'wrong' ? 'X-RESULT.cellWrong' : 'X-RESULT.cellCorrect');
  let parts = null;
  try {
    parts = monthDayParts(record.localDay);
  } catch (error) {
    parts = null;
  }
  return {
    caption: parts ? t('X-DETAIL.cellCaption', { month: parts.month, day: parts.day, caption }) : caption,
    title: parts ? t('X-DETAIL.cellTitle', { date: dayText(record.localDay), caption }) : caption,
  };
}

/** 写错过 / 快忘了 / 都不在（K15 / K16 / D23）。records 为全部记录（平铺）。 */
export function listOf({ records, sched, today, cardKey, policy = defaultPolicy }) {
  let latest = null;
  for (const r of records) {
    if (!isJudged(r) || r.cardKey !== cardKey) continue;
    if (!latest || compareRecordIds(latest.id, r.id) < 0) latest = r;
  }
  if (!latest) return null;
  if (latest.judgment === 'wrong') return 'wrong';
  let forget = null;
  try {
    forget = forgetList({ records, sched, today, policy });
  } catch (error) {
    forget = null;
  }
  return forget && forget.items.some(item => item.cardKey === cardKey) ? 'forget' : null;
}

/**
 * 字卡显示：词语（语境词，目标字位红框）或释义（没有语境词 / 换掉了词语：提示行同写字页题面口径，
 * core/cards promptModel 的 contentHint）。
 */
export function wordView(card) {
  if (!card) return { hasWord: false, tiles: [], gloss: '' };
  if (hasContextWord(card)) {
    return { hasWord: true, tiles: card.chars.map((ch, i) => ({ ch, blank: i === card.ci })), gloss: '' };
  }
  const gloss = promptModel(card, promptCopy()).contentHint || '';
  return { hasWord: false, tiles: [], gloss };
}

/**
 * 单字详情模型（纯函数）。
 * @param {object} state  store 状态
 * @param {string} char
 * @param {{today:string, policy?:object, lookup?:(key:string)=>object|null, hasInk?:(record)=>boolean}} o
 */
export function detailModel(state, char, { today, policy = defaultPolicy, lookup = cardForKey, hasInk = () => false } = {}) {
  const cardKey = baseKey(char);
  const baseCard = lookup(cardKey) || null;
  const wordOff = state && state.wordOff && typeof state.wordOff === 'object' ? state.wordOff : null;
  const off = !!(wordOff && Object.prototype.hasOwnProperty.call(wordOff, cardKey));
  const card = withWordOff(baseCard, wordOff);
  const all = flattenRecords(state && state.records);
  const mine = recordsOfChar(state, char);
  const judged = mine.filter(isJudged);
  const latest = judged.length ? judged[judged.length - 1] : null;
  const sched = state && state.sched ? state.sched : null;
  const entry = sched ? sched[cardKey] : null;
  const features = policy.features || {};
  const due = judged.length && features.nextReviewLine && entry && typeof entry.due === 'string' ? entry.due : null;
  const added = state && state.custom && Array.isArray(state.custom.added) ? state.custom.added : [];
  const customIndex = added.findIndex(e => e && e.char === char);
  const photos = state && state.photos && typeof state.photos === 'object' ? state.photos : null;
  const photo = photos && Object.prototype.hasOwnProperty.call(photos, char) ? photos[char] : null;
  let image = 'ok';
  if (!latest) image = 'noRecord';
  else if (!hasInk(latest)) image = 'noInk';
  const word = wordView(card);
  return {
    char,
    cardKey,
    card,
    baseCard,
    practicable: !!baseCard,
    pinyin: card ? card.py || '' : '',
    strokes: card && card.strokes > 0 ? card.strokes : 0,
    word,
    // 「换掉这个词语」只对有语境词、还没换掉的字（原型 dWfOn = 有词语）
    canSwapWord: !off && !!baseCard && hasContextWord(baseCard),
    wordOff: off,
    originalWord: baseCard ? baseCard.word : '',
    judged,
    count: judged.length,
    first: judged[0] || null,
    latest,
    list: listOf({ records: all, sched, today, cardKey, policy }),
    due,
    image,
    custom: customIndex >= 0,
    customIndex,
    customEntry: customIndex >= 0 ? added[customIndex] : null,
    photo,
    // P10b：旧照片默认不算有记录；policy 改成 true 时的样子没有设计，这里只在报告里登记
    photoCountsAsRecord: policy.legacyPhotoCountsAsRecord === true,
  };
}

// ---------------------------------------------------------------- 笔迹

/** 某条 judged 记录的本人笔迹：存下的墨迹（perRecordInk）→ 本页面会话里刚判断时记下的笔画 → 没有（10.12）。 */
export function inkOf(store, record) {
  if (!record) return { points: null, strokes: null };
  if (store) {
    let ink = null;
    try {
      ink = store.getInk(record);
    } catch (error) {
      ink = null;
    }
    if (ink) {
      const decoded = decodeInk(ink);
      if (decoded && decoded.length) return { points: resampleForReplay(decoded), strokes: null };
    }
  }
  const raw = recalledInk(record.id);
  return raw && raw.length ? { points: null, strokes: raw } : { points: null, strokes: null };
}

export function hasInkPoints(ink) {
  return !!(ink && ((ink.points && ink.points.length) || (ink.strokes && ink.strokes.length)));
}

// ---------------------------------------------------------------- 字源（R-D09）

let etymology = null; // Map<char, {gloss, source}>
let etymologyPromise = null;
const etymologyListeners = new Set();

/** 读 data/etymology.json（一次；失败不缓存，下次打开再试）。 */
export function loadEtymology(fetchFn = typeof fetch === 'function' ? fetch : null) {
  if (etymology) return Promise.resolve(etymology);
  if (etymologyPromise) return etymologyPromise;
  if (!fetchFn) return Promise.resolve(null);
  etymologyPromise = Promise.resolve()
    .then(() => fetchFn(ETYMOLOGY_URL))
    .then(res => (res && res.ok ? res.json() : null))
    .then(rows => {
      if (!Array.isArray(rows)) throw new Error('etymology data unavailable');
      const map = new Map();
      for (const row of rows) {
        if (row && typeof row.char === 'string' && typeof row.gloss === 'string' && row.gloss) {
          map.set(row.char, { gloss: row.gloss, source: typeof row.source === 'string' ? row.source : '' });
        }
      }
      etymology = map;
      for (const fn of [...etymologyListeners]) fn(map);
      return map;
    })
    .catch(() => {
      etymologyPromise = null;
      return null;
    });
  return etymologyPromise;
}

/** 测试用：注入 / 清掉字源表。 */
export function setEtymology(rows) {
  etymologyPromise = null;
  etymology = Array.isArray(rows) ? new Map(rows.map(r => [r.char, { gloss: r.gloss, source: r.source || '' }])) : null;
}

export function etymologyOf(char) {
  return etymology ? etymology.get(char) || null : null;
}

export function useEtymology(char) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (etymology) return undefined;
    const fn = () => bump(n => n + 1);
    etymologyListeners.add(fn);
    loadEtymology();
    return () => etymologyListeners.delete(fn);
  }, []);
  return etymologyOf(char);
}

export function SourceRow({ char }) {
  const row = useEtymology(char);
  if (!row) return null; // R-D09：没有字源的字整块不显示
  return html`<div class="sz-dsrc" data-testid="detail-source">
    <span class="sz-dsrc__label">${t('X-DETAIL.sourceLabel')}</span>
    <span class="sz-dsrc__body">
      <span class="sz-dsrc__text" lang="zh-CN" data-testid="detail-source-text">${row.gloss}</span>
      ${row.source ? html`<span class="sz-dsrc__from" data-testid="detail-source-from">${row.source}</span>` : null}
    </span>
  </div>`;
}

// ---------------------------------------------------------------- 记录块

function Cell({ record, ink, onOpen }) {
  const has = hasInkPoints(ink);
  const { caption, title } = cellCopy(record);
  const sq = has
    ? html`<${InkMini} points=${ink.points} strokes=${ink.strokes} testid="detail-cell-ink" label=${record.char} />`
    : html`<span class="sz-dcell__glyph" aria-hidden="true" data-testid="detail-cell-glyph">${record.char}</span>
      <span class="sz-dcell__noink" data-testid="detail-cell-noink">${t('R-D07.noInkLabel')}</span>`;
  return html`<button type="button" class="sz-dcell" data-testid="detail-cell" data-record=${record.id}
    data-judgment=${record.judgment} data-ink=${has ? 'true' : 'false'} aria-label=${title} onClick=${() => onOpen(record)}>
    <span class="sz-dcell__sq">${sq}</span>
    <span class="sz-dcell__cap" data-testid="detail-cell-caption" data-wrong=${record.judgment === 'wrong' ? 'true' : 'false'}>${caption}</span>
  </button>`;
}

/** 放大弹层（overlay 组件；root 注入 close / active）。 */
export function ZoomSheet({ record, points = null, strokes = null, close, active = true }) {
  const { title } = cellCopy(record);
  return html`<${Sheet} title=${title} onClose=${close} active=${active} testid="detail-zoom">
    <div class="sz-dzoom">
      <div class="sz-dzoom__sq">
        <${InkMini} points=${points} strokes=${strokes} testid="detail-zoom-ink" label=${title}
          emptyText=${t('R-D07.noInkLarge')} emptyTestid="detail-zoom-noink" />
      </div>
      <${Button} variant="secondary" class="sz-dzoom__close" data-testid="detail-zoom-close"
        onClick=${() => close && close()}>${t('X-COMMON.close')}</${Button}>
    </div>
  </${Sheet}>`;
}

export function openZoom(record, ink) {
  return nav.openOverlay(ZoomSheet, { record, points: ink ? ink.points : null, strokes: ink ? ink.strokes : null },
    { name: ZOOM_OVERLAY });
}

/**
 * 记录块：有记录「记录了 N 次」+「首次记录 {date}」+ 历次格子；没有记录「还没有记录」（不折行）+ 说明，不画空格子（R-D03）。
 * @param {{model: object, store: object|null}} props
 */
export function RecordsBlock({ model, store }) {
  if (!model.count) {
    return html`<div class="sz-drec" data-testid="detail-records" data-count="0">
      <div class="sz-drec__head">
        <span class="sz-drec__count" data-testid="detail-records-count">${t('R-D03.none')}</span>
        <span class="sz-drec__first" data-testid="detail-records-empty">${t('X-DETAIL.emptyNote')}</span>
      </div>
    </div>`;
  }
  const cells = model.judged.map(record => ({ record, ink: inkOf(store, record) }));
  return html`<div class="sz-drec" data-testid="detail-records" data-count=${model.count}>
    <div class="sz-drec__head">
      <span class="sz-drec__count" data-testid="detail-records-count">${t('R-D03.count', { n: model.count })}</span>
      ${model.first && model.first.localDay
        ? html`<span class="sz-drec__first" data-testid="detail-records-first">${t('X-DETAIL.firstRecord', { date: dayText(model.first.localDay) })}</span>`
        : null}
    </div>
    <div class="sz-drec__grid" data-testid="detail-cells">
      ${cells.map(c => html`<${Cell} key=${c.record.id} record=${c.record} ink=${c.ink} onOpen=${() => openZoom(c.record, c.ink)} />`)}
    </div>
  </div>`;
}
