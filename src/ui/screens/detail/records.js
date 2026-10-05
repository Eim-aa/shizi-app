// 单字详情 · 模型与记录块（02 M3-6；04 R-D01–R-D04、R-D07、R-D09；决定-D23；03 P10b / P12 / P19；
// 原型 ShiziScreen-第十稿交接版 L32–L61、L389–L413；reference/J-proto-screen.md §2.3.3–§2.3.5）。
//
//   detailModel(state, char, {today, policy, lookup, hasInk})   纯函数：字卡、记录、写错过 / 快忘了、下次练习、做图片状态、
//                                                             自选、换掉的词语、旧照片——全部由 store 状态实时算（R-D01「修改判断后实时变」）。
//   detailHero / HeroPair                                      头图（H1 / V2-03、N2-10，03 P223）：「第一次 | 最近一次」两格本人墨（取屏幕上写的第一条与最后一条判断，
//                                                             D27 只有这两次留墨；只写过一次只有一格；没写过 / 只在纸上写过才用参考字形当头图，由页面画）。
//   RecordsBlock                                               「记录了 N 次 / 首次记录 {date}」+ 历次格子（按记录先后，没有空的
//                                                             「下一次」格，R-D03 / L12）；点格子放大（ZoomSheet，R-D03）；
//                                                             没有笔迹的记录：画衬底字（V16，格里不写「没有笔迹」，读屏名称里说），放大「这一次没有留下笔迹」（R-D07 / 10.12）；
//                                                             格子容器不铺整条笺面，只画有内容的格（最后一行不满时后面是纸，T2-13）。
//                                                             D27（P1-E3）：只有第一次与最近一次留墨，中间被回收的历次照实是「没有笔迹」；
//                                                             model.first / model.latest 即对照用的两条（设计稿出对照入口前只保证数据可取）。
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
//   detail-cell（data-record / data-judgment / data-ink=true|false / data-first / data-latest：D27 留墨的第一次与最近一次，
//   供以后「第一次 vs 最近一次」对照入口取数，阶段 1 P1-E3）、detail-cell-ink、detail-cell-glyph、detail-cell-noink、
//   detail-cell-caption、detail-zoom（放大弹层）、detail-zoom-ink、detail-zoom-noink、detail-zoom-close、detail-source、
//   detail-source-text、detail-source-from。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { nav } from '../../router.js';
import { Button, pressFeedbackHandlers } from '../../components/Button.js';
import { Sheet } from '../../components/Sheet.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { monthDayParts } from '../../../core/dates.js';
import { compareRecordIds, forgetList, isJudged, isPaperRecord, sortById } from '../../../core/records.js';
import { flattenRecords } from '../../../core/query.js';
import { promptModel } from '../../../core/cards.js';
import { decodeInk, resampleForReplay } from '../../../core/ink-math.js';
import { inkHasStrokes } from '../../../core/ink-pick.js';
import { cardForKey, hasContextWord, withWordOff } from '../../../data/deck.js';
import { InkMini, recalledInk } from '../write/compare.js';
import { PracticeGlyph } from '../../components/PracticeGlyph.js';
import { promptCopy } from '../write/prompt.js';

export const ZOOM_OVERLAY = 'detail-zoom';
export const ETYMOLOGY_URL = 'data/etymology.json';

injectStyles('detail-records', `
.sz-drec{display:flex;flex-direction:column;gap:12px}
.sz-drec__head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;column-gap:12px;row-gap:4px}
.sz-drec__count{font-family:${T.song};font-size:${T.fs22};font-weight:500;color:${T.ink2};white-space:nowrap}
.sz-drec__first{font-size:${T.fs15};color:${T.ink2};text-align:right}
.sz-drec__grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));box-sizing:border-box;padding:0 ${T.frameW} ${T.frameW} 0} /* 不铺笺面：每格自带笺面与框，相邻格框线叠 1px（负外边距），最后一行不满时后面是纸（T2-13） */
.sz-dcell{display:flex;flex-direction:column;box-sizing:border-box;min-width:0;margin:0 calc(-1 * ${T.frameW}) calc(-1 * ${T.frameW}) 0;padding:0;border:0;
  box-shadow:inset 0 0 0 ${T.frameW} ${T.frame};${TEX};color:inherit;font:inherit;text-align:center;cursor:pointer}
.sz-dcell:focus-visible{outline:2px solid ${T.ink1};outline-offset:-2px}
.sz-dcell[data-pressed]{background:${T.field}}
.sz-dcell__sq{position:relative;aspect-ratio:1/1;display:grid;place-items:center;color:${T.under}}
.sz-dcell__sq .sz-compare__card{position:absolute;inset:0;width:100%;border:0;border-radius:0;background:transparent}
.sz-dcell__glyph{width:44%;height:auto;aspect-ratio:1/1;color:${T.under}} /* 没有笔迹的格：衬底字是轮廓（P1-E2），字面约占格 35% */
.sz-dhero{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.sz-dhero__btn{display:flex;flex-direction:column;gap:${T.s2};min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:center;cursor:pointer}
.sz-dhero__btn[data-pressed]{opacity:.8}
.sz-dhero__sq{position:relative;aspect-ratio:1/1;box-sizing:border-box;display:grid;place-items:center;border:${T.frameW} solid ${T.frame};${TEX};color:${T.under}}
.sz-dhero__sq .sz-compare__card{position:absolute;inset:0;width:100%;border:0;background:transparent}
.sz-dhero__glyph{width:76%;height:auto;aspect-ratio:1/1;color:${T.under}} /* 这一次没有存下墨：画衬底字（轮廓），不写「没有笔迹」（V16） */
.sz-dhero__cap{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3};font-variant-numeric:tabular-nums}
.sz-dcell__meta{box-sizing:border-box;min-height:44px;padding:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;
  border-top:${T.frameW} solid ${T.frame};font-size:${T.fs11};line-height:${T.lh11};color:${T.ink2};font-variant-numeric:tabular-nums;text-align:center}
.sz-dcell__date{white-space:nowrap}
.sz-dcell__cap{display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap}
:root[data-ax] .sz-drec__grid{grid-template-columns:repeat(2,minmax(0,1fr))} /* AX 档：4 列的格宽放不下「10月2日」，改两列，日期与「写对」可折行（A2-03） */
:root[data-ax] .sz-dcell__date,:root[data-ax] .sz-dcell__cap{white-space:normal;word-break:keep-all}
:root[data-ax] .sz-dcell__meta{min-height:44px;height:auto}
:root[data-ax] .sz-dhero{grid-template-columns:minmax(0,1fr)}
:root[data-ax] .sz-dhero__cap{word-break:keep-all}
:root[data-ax] .sz-drec__first{text-align:left;word-break:keep-all}
.sz-drec__paper{margin:0;padding:0;list-style:none;border-top:${T.hair} solid ${T.line}}
.sz-drec__prow{display:flex;align-items:center;gap:${T.s3};min-height:52px;border-bottom:${T.hair} solid ${T.line};
  font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-drec__pdate{flex:none;min-width:64px;color:${T.ink1};font-variant-numeric:tabular-nums}
.sz-drec__ptag{margin-left:0.35em;color:${T.ink3}}
.sz-dzoom{display:flex;flex-direction:column;gap:${T.s4}}
.sz-dzoom__sq{width:100%;max-width:300px;align-self:center}
.sz-dsrc{display:grid;grid-template-columns:44px minmax(0,1fr);gap:8px;align-items:baseline}
.sz-dsrc__label{font-size:${T.fs13};color:${T.ink3}}
.sz-dsrc__body{display:flex;flex-direction:column;gap:4px}
.sz-dsrc__text{font-family:${T.kai};font-size:${T.fs17};line-height:${T.lh17};color:${T.ink1}}
.sz-dsrc__from{font-size:${T.fs13};color:${T.ink3}}
`);

// ---------------------------------------------------------------- 纯模型

export function baseKey(char) {
  return `base:${char}`;
}

/** 某字的全部记录（任何 kind，按 id 升序）；base: 与 custom:（旧数据）都算这个字。 */
export function recordsOfChar(state, char) {
  return sortById(flattenRecords(state && state.records).filter(r => r && r.char === char));
}

/** localDay → 「{month}月{day}日」（R-H02.dateFormat，界面日期统一写法，P224）。 */
export function dayText(day) {
  try {
    return t('R-H02.dateFormat', monthDayParts(day));
  } catch (error) {
    return '';
  }
}

/** 记录格下两行「10月4日 / 写对」（H1 / V2-08：不再有「10·4」式）；读屏名与放大标题「10月4日 · 写对」。date 缺（坏日期）时只有 caption。 */
export function cellCopy(record) {
  const caption = t(record.judgment === 'wrong' ? 'X-RESULT.cellWrong' : 'X-RESULT.cellCorrect');
  let parts = null;
  try {
    parts = monthDayParts(record.localDay);
  } catch (error) {
    parts = null;
  }
  return {
    date: parts ? dayText(record.localDay) : '',
    caption,
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
  // P1-E8（D46 ⑬，03 P169）：纸上记录照常计数、照常决定写错过 / 快忘了，但不占笔迹格（「你的笔迹」按 D27 / D42 取留有墨迹的那次）；
  // 记录列表里另起一行「{日期}　写对 · 纸上」。做成图片取屏幕上写的最近一次。
  const screen = judged.filter(r => !isPaperRecord(r));
  const paper = judged.filter(isPaperRecord);
  const inkLatest = screen.length ? screen[screen.length - 1] : null;
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
  else if (!inkLatest || !hasInk(inkLatest)) image = 'noInk';
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
    // 笔迹格（屏幕上写的判断）与纸上记录行（P1-E8）；inkFirst / inkLatest = 留墨的第一次 / 最近一次（D27 对照用，纸上那次不占位）
    cells: screen,
    paperRows: paper,
    inkFirst: screen[0] || null,
    inkLatest,
    imageRecord: inkLatest,
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

/**
 * 头图（V2-03、N2-10，03 P223）：屏幕上写过 → 「第一次 | 最近一次」两格本人墨（只写过一次只有一格，标「第一次」）；
 * 一次都没写过、或只在纸上写过 → 'ref'（页面用参考字形当头图）。
 * @returns {{kind:'ink'|'ref', cells: Array<{kind:'first'|'latest', record:object}>}}
 */
export function detailHero(model) {
  const screen = Array.isArray(model && model.cells) ? model.cells : [];
  if (!screen.length) return { kind: 'ref', cells: [] };
  const first = screen[0];
  const latest = screen[screen.length - 1];
  const cells = first.id === latest.id
    ? [{ kind: 'first', record: first }]
    : [{ kind: 'first', record: first }, { kind: 'latest', record: latest }];
  return { kind: 'ink', cells };
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

/**
 * 这条记录有没有本人笔迹（只查在不在、不解码）：存下的墨迹（按月表一次查找）→ 本页面会话里记下的笔画。
 * D42 时间段视图（月字帖 / 图片 / 年报首字）挑「留有墨迹的那一次」时逐条问它，挑出来的那条再由格子 / 渲染各自解码一次。
 */
export function recordHasInk(store, record) {
  if (!record) return false;
  if (store) {
    try {
      if (inkHasStrokes(store.getInk(record))) return true;
    } catch (error) {
      // 读不到按没有
    }
  }
  const raw = recalledInk(record.id);
  return !!(raw && raw.length);
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

// 原生 <button> 格子的按压反馈：与 Button 同一套 data-pressed 机制（P1-E1a）；样式见 .sz-dcell[data-pressed]。
const CELL_PRESS = pressFeedbackHandlers(() => false);

function Cell({ record, ink, onOpen, first = false, latest = false }) {
  const has = hasInkPoints(ink);
  const { date, caption, title } = cellCopy(record);
  const sq = has
    ? html`<${InkMini} points=${ink.points} strokes=${ink.strokes} testid="detail-cell-ink" label=${record.char} />`
    : html`<${PracticeGlyph} class="sz-dcell__glyph" hidden=${true} char=${record.char} testid="detail-cell-glyph" />`;
  return html`<button type="button" class="sz-dcell" ...${CELL_PRESS} data-testid="detail-cell" data-record=${record.id}
    data-judgment=${record.judgment} data-ink=${has ? 'true' : 'false'} data-first=${first ? 'true' : null} data-latest=${latest ? 'true' : null}
    aria-label=${has ? title : t('X-DETAIL.cellNoInkLabel', { text: title })} onClick=${() => onOpen(record)}>
    <span class="sz-dcell__sq">${sq}</span>
    <span class="sz-dcell__meta">
      <span class="sz-dcell__date" data-testid="detail-cell-date">${date}</span>
      <span class="sz-dcell__cap" data-testid="detail-cell-caption" data-wrong=${record.judgment === 'wrong' ? 'true' : 'false'}>${caption}</span>
    </span>
  </button>`;
}

/** 放大弹层（overlay 组件；root 注入 close / active）。 */
export function ZoomSheet({ record, points = null, strokes = null, close, active = true }) {
  const { title } = cellCopy(record);
  return html`<${Sheet} title=${title} onClose=${close} active=${active} testid="detail-zoom" doneTestid="detail-zoom-close">
    <div class="sz-dzoom">
      <div class="sz-dzoom__sq">
        <${InkMini} points=${points} strokes=${strokes} testid="detail-zoom-ink" label=${title}
          emptyText=${t('R-D07.noInkLarge')} emptyTestid="detail-zoom-noink" />
      </div>
    </div>
  </${Sheet}>`;
}

export function openZoom(record, ink) {
  return nav.openOverlay(ZoomSheet, { record, points: ink ? ink.points : null, strokes: ink ? ink.strokes : null },
    { name: ZOOM_OVERLAY });
}

/**
 * 头图两格（本人墨）：每格 = 方格（有墨画墨，没墨画衬底字）+ 一行「第一次 · 8 月 4 日」；点一格放大（同记录格）。
 * @param {{hero: {cells: Array<{kind, record}>}, store: object|null}} props
 */
export function HeroPair({ hero, store }) {
  return html`<div class="sz-dhero" data-testid="detail-hero" data-n=${hero.cells.length}>
    ${hero.cells.map(c => {
      const ink = inkOf(store, c.record);
      const has = hasInkPoints(ink);
      const label = t(c.kind === 'first' ? 'X-DETAIL.heroFirst' : 'X-DETAIL.heroLatest');
      const date = dayText(c.record.localDay);
      const { title } = cellCopy(c.record);
      return html`<button key=${c.record.id} type="button" class="sz-dhero__btn" ...${CELL_PRESS} data-testid="detail-hero-cell" data-kind=${c.kind}
        data-record=${c.record.id} data-ink=${has ? 'true' : 'false'} aria-label=${t('X-DETAIL.heroCellLabel', { label, text: title })}
        onClick=${() => openZoom(c.record, ink)}>
        <span class="sz-dhero__sq">${has
          ? html`<${InkMini} points=${ink.points} strokes=${ink.strokes} testid="detail-hero-ink" label=${c.record.char} />`
          : html`<${PracticeGlyph} class="sz-dhero__glyph" hidden=${true} char=${c.record.char} testid="detail-hero-glyph" />`}</span>
        <span class="sz-dhero__cap" data-testid="detail-hero-caption" aria-hidden="true">${t('X-DETAIL.heroCaption', { label, date })}</span>
      </button>`;
    })}
  </div>`;
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
  const source = Array.isArray(model.cells) ? model.cells : model.judged;
  const cells = source.map(record => ({ record, ink: inkOf(store, record) }));
  const inkFirst = model.inkFirst !== undefined ? model.inkFirst : model.first;
  const inkLatest = model.inkLatest !== undefined ? model.inkLatest : model.latest;
  const paperRows = Array.isArray(model.paperRows) ? model.paperRows : [];
  return html`<div class="sz-drec" data-testid="detail-records" data-count=${model.count}>
    <div class="sz-drec__head">
      <span class="sz-drec__count" data-testid="detail-records-count">${t('R-D03.count', { n: model.count })}</span>
      ${model.first && model.first.localDay
        ? html`<span class="sz-drec__first" data-testid="detail-records-first">${t('X-DETAIL.firstRecord', { date: dayText(model.first.localDay) })}</span>`
        : null}
    </div>
    ${cells.length ? html`<div class="sz-drec__grid" data-testid="detail-cells">
      ${cells.map(c => html`<${Cell} key=${c.record.id} record=${c.record} ink=${c.ink} onOpen=${() => openZoom(c.record, c.ink)}
        first=${inkFirst === c.record} latest=${inkLatest === c.record} />`)}
    </div>` : null}
    ${paperRows.length ? html`<${PaperRows} records=${paperRows} />` : null}
  </div>`;
}

/** 纸上记录行的文案：「10 月 4 日」「写对」与读屏名「10 月 4 日，写对，纸上」（实现交接 §10.2；P1-E8，P169）。 */
export function paperRowCopy(record) {
  const date = dayText(record.localDay);
  const caption = t(record.judgment === 'wrong' ? 'X-RESULT.cellWrong' : 'X-RESULT.cellCorrect');
  return { date, caption, tag: t('X-DETAIL.paperTag'), label: t('X-DETAIL.paperRowLabel', { date, caption }) };
}

/**
 * 纸上记录（P1-E8，D46 ⑬）：不占笔迹格、不画空格，记录列表里一行「{日期}　写对 · 纸上」（「· 纸上」墨三），按记录先后。
 * 读屏一行读成「10 月 4 日，写对，纸上」。
 */
export function PaperRows({ records }) {
  return html`<ul class="sz-drec__paper" data-testid="detail-paper-rows">
    ${records.map(record => {
      const c = paperRowCopy(record);
      return html`<li key=${record.id} class="sz-drec__prow" data-testid="detail-paper-row" data-record=${record.id}
        data-judgment=${record.judgment}>
        <span class="sr-only" data-testid="detail-paper-label">${c.label}</span>
        <span class="sz-drec__pdate" aria-hidden="true">${c.date}</span>
        <span class="sz-drec__pcap" aria-hidden="true">${c.caption}<span class="sz-drec__ptag" data-testid="detail-paper-tag">${c.tag}</span></span>
      </li>`;
    })}
  </ul>`;
}
