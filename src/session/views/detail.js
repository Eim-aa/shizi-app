// 字详情的视图模型（B3.4：从 ui/screens/detail/records.js 挪来；无 DOM、无 Preact）。
// 网页页面从这里 import 同一批函数；用户可见的句子只给「文案键 + 参数」（cellCopy），网页用 tRef 渲染。

import { lineStarts } from '../../core/line-starts.js';
import * as defaultPolicy from '../../config/policy.js';
import { canCorrectHere } from '../ops/detail.js';
import { inkKey, ref, tRef } from '../../config/copy/index.js';
import { monthDayParts } from '../../core/dates.js';
import { compareRecordIds, isJudged, isPaperRecord, sortById } from '../../core/records.js';
import { flattenRecords } from '../../core/query.js';
import { promptModel } from '../../core/cards.js';
import { decodeInk, inkParams, resampleForReplay } from '../../core/ink-math.js';
import { inkHasStrokes } from '../../core/ink-pick.js';
import { cardForKey, hasContextWord, withWordOff } from '../../data/deck.js';
import { promptCopy, recalledInk } from '../write-ops.js';
import { sheetStrokes } from '../write-api.js';
import { memoryZoneOf } from './library.js';

export function baseKey(char) {
  return `base:${char}`;
}

/** 某字的全部记录（任何 kind，按 id 升序）；base: 与 custom:（旧数据）都算这个字。 */
export function recordsOfChar(state, char) {
  return sortById(flattenRecords(state && state.records).filter(r => r && r.char === char));
}

/** 记录格下两行（文案引用：键 + 参数，网页用 tRef 渲染）「10月4日 / 写对」（H1 / V2-08：不再有「10·4」式）；读屏名与放大标题「10月4日 · 写对」。date 缺（坏日期）时只有 caption。 */
export function cellCopy(record) {
  const caption = ref(record.judgment === 'wrong' ? 'X-RESULT.cellWrong' : 'X-RESULT.cellCorrect');
  let parts = null;
  try {
    parts = monthDayParts(record.localDay);
  } catch (error) {
    parts = null;
  }
  const date = parts ? ref('R-H02.dateFormat', parts) : '';
  return {
    date,
    caption,
    title: parts ? ref('X-DETAIL.cellTitle', { date, caption }) : caption,
  };
}

/**
 * 「该复习了」的两种原因 / 不在（K15 / K16 / D23；r7-C1 D61 Q5）：'wrong' = 最近一次写错，'forget' = 最近一次写对但已到期，null = 不在。
 * 与字库首页三档同一函数（memoryZoneOf：写错过 ∪ 到期 = 该复习了），详情页这一行点进去的就是「该复习了」清单。records 为全部记录（平铺）。
 */
export function listOf({ records, sched, today, cardKey }) {
  let latest = null;
  for (const r of records) {
    if (!isJudged(r) || r.cardKey !== cardKey) continue;
    if (!latest || compareRecordIds(latest.id, r.id) < 0) latest = r;
  }
  if (!latest) return null;
  if (latest.judgment === 'wrong') return 'wrong';
  const entry = sched && typeof sched === 'object' ? sched[cardKey] : undefined;
  return memoryZoneOf(latest, entry, today) === 'due' ? 'forget' : null;
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

// ---------------------------------------------------------------- 原生字详情的视图（B3.7：App API view.detail / view.detail-photo）

export const DETAIL_SCREEN = 'detail';
export const DETAIL_PHOTO_SCREEN = 'detail-photo';
export const LIST_SCREEN_NAME = 'library-list';

/** localDay → 「{month}月{day}日」的文案引用（坏日期给 ''，网页 dayText 同一规则）。 */
export function dayRef(day) {
  try {
    return ref('R-H02.dateFormat', monthDayParts(day));
  } catch (error) {
    return '';
  }
}

/** 一条记录的墨：strokes 是桥上的紧凑原始笔画（没有墨时 []）。网页格子取同一条记录的 inkOf（hasInkPoints）判有没有。 */
function inkWire(store, record) {
  const has = hasInkPoints(inkOf(store, record));
  return { has, strokes: has ? sheetStrokes(store, record) : [] };
}

/**
 * 原生字详情的视图（网页字详情页渲染用的同一个 detailModel / detailHero / cellCopy，只多一层「文案引用 + 笔画」的壳）。
 * 页面里的临时状态（撤销条、失败三段式、放大弹层）是原生页自己的，不在这里。
 * @param {object} store
 * @param {string} char
 * @param {{today: string, etymology?: {gloss: string, source: string}|null, imageAction?: boolean, listAction?: boolean}} o
 *   imageAction：「做成图片」有没有去处（M4-5 注册后才显示这一行，R-D04）；etymology：这个字的字源（没有 = 整块不显示，R-D09）。
 */
export function detailView(store, char, { today, etymology = null, imageAction = false } = {}) {
  const state = store.getState();
  const model = detailModel(state, char, { today, hasInk: record => hasInkPoints(inkOf(store, record)) });
  const hero = detailHero(model);
  const cellTitle = record => cellCopy(record).title;
  const labelRef = kind => ref(kind === 'first' ? 'X-DETAIL.heroFirst' : 'X-DETAIL.heroLatest');
  const heroCells = hero.cells.map(c => {
    const ink = inkWire(store, c.record);
    const title = cellTitle(c.record);
    return {
      kind: c.kind,
      title,
      changeable: canCorrectHere(c.record),
      recordId: c.record.id,
      judgment: c.record.judgment,
      wrong: c.record.judgment === 'wrong',
      hasInk: ink.has,
      strokes: ink.strokes,
      caption: ref('X-DETAIL.heroCaption', { label: labelRef(c.kind), date: dayRef(c.record.localDay) }),
      aria: ref('X-DETAIL.heroCellLabel', { label: labelRef(c.kind), text: ink.has ? title : ref('X-DETAIL.cellNoInkLabel', { text: title }) }),
    };
  });
  // 历次格：头图那两次不在这里重画（V3-04）
  const heroIds = new Set(hero.cells.map(c => c.record.id));
  const source = Array.isArray(model.cells) ? model.cells : model.judged;
  const inkFirst = model.inkFirst !== undefined ? model.inkFirst : model.first;
  const inkLatest = model.inkLatest !== undefined ? model.inkLatest : model.latest;
  const cells = source.filter(record => !heroIds.has(record.id)).map(record => {
    const ink = inkWire(store, record);
    const c = cellCopy(record);
    return {
      recordId: record.id,
      title: c.title,
      changeable: canCorrectHere(record),
      judgment: record.judgment,
      wrong: record.judgment === 'wrong',
      hasInk: ink.has,
      strokes: ink.strokes,
      first: inkFirst === record,
      latest: inkLatest === record,
      date: c.date,
      caption: c.caption,
      aria: ink.has ? c.title : ref('X-DETAIL.cellNoInkLabel', { text: c.title }),
    };
  });
  const paperRows = (Array.isArray(model.paperRows) ? model.paperRows : []).map(record => {
    const date = dayRef(record.localDay);
    const caption = ref(record.judgment === 'wrong' ? 'X-RESULT.cellWrong' : 'X-RESULT.cellCorrect');
    return { recordId: record.id, judgment: record.judgment, date, caption, tag: ref('X-DETAIL.paperTag'), label: ref('X-DETAIL.paperRowLabel', { date, caption }) };
  });
  const word = model.word;
  const rows = [];
  if (model.list) rows.push({ key: 'list', kind: model.list, title: ref('X-LIBFOUR.zone.due'), sub: ref(model.list === 'wrong' ? 'R-D01.wrongLine' : 'R-D01.forgetLine'), to: { screen: LIST_SCREEN_NAME, params: { kind: 'due' } } });
  if (model.due) {
    const title = ref('R-D02.nextReview', { date: dayRef(model.due) });
    rows.push({ key: 'next', title, starts: lineStarts('detail-next', tRef(title)) });
  }
  if (imageAction) {
    rows.push(model.image === 'ok'
      ? { key: 'image', state: 'ok', title: ref('R-D04.makeImage') }
      : { key: 'image', state: model.image, title: ref('R-D04.makeImage'), note: ref(model.image === 'noInk' ? inkKey('R-D04.noInkNote') : 'R-D04.noRecordNote') });
  }
  if (model.photo) rows.push({ key: 'legacy', title: ref('X-DETAIL.legacyEntry'), to: { screen: DETAIL_PHOTO_SCREEN, params: { char } } });
  if (model.canSwapWord) rows.push({ key: 'swap', title: ref('R-D05.swapWord') });
  if (model.custom) rows.push({ key: 'remove', title: ref('R-D06.rowTitle'), sub: ref('R-D06.rowSub') });
  if (!model.custom && model.practicable) rows.push({ key: 'add', title: ref('R-Q05.btnAdd') });
  return {
    char,
    cardKey: model.cardKey,
    ink: { ...inkParams(defaultPolicy) }, // 原生画墨（WebInk）的参数表：与写字页 / 结果页回包的 ink 同一张（policy.ink + INK_SPEC）
    title: ref('X-DETAIL.pageTitle', { char }),
    practicable: model.practicable,
    practice: ref('R-D08.btnPractice'),
    pinyin: model.pinyin,
    strokes: model.strokes ? { n: model.strokes, label: ref('X-DETAIL.strokes', { n: model.strokes }) } : null,
    word: model.card
      ? { hasWord: word.hasWord, label: ref(word.hasWord ? 'X-DETAIL.wordLabel' : 'X-DETAIL.glossLabel'), text: word.hasWord ? model.card.word : '', tiles: word.tiles, gloss: word.gloss }
      : null,
    originalWord: model.originalWord,
    wordOff: model.wordOff,
    hero: { kind: hero.kind, cells: heroCells },
    refLabel: ref('R-W09.labelReference'),
    records: model.count
      ? { count: model.count, countLabel: ref('R-D03.count', { n: model.count }), cells, paperRows }
      : { count: 0, countLabel: ref('R-D03.none'), empty: ref('X-DETAIL.emptyNote'), cells: [], paperRows: [] },
    source: etymology ? { label: ref('X-DETAIL.sourceLabel'), gloss: etymology.gloss, from: etymology.source || '' } : null,
    rows,
    custom: model.custom,
    list: model.list,
  };
}

/** photos[char]（只读）；没有（或不是图片 data URL）返回 null。 */
export function photoOf(state, char) {
  const photos = state && state.photos && typeof state.photos === 'object' ? state.photos : null;
  if (!photos || !Object.prototype.hasOwnProperty.call(photos, char)) return null;
  const p = photos[char];
  return p && typeof p.dataURL === 'string' && p.dataURL.indexOf('data:image/') === 0 ? p : null;
}

/** 旧记录页的视图（只读；照片是 data URL，没了 = null，只留标题与说明）。 */
export function photoView(state, char) {
  const p = photoOf(state, char);
  return {
    char,
    title: ref('R-D10.title', { char }),
    alt: ref('X-DETAIL.photoAlt'),
    caption: ref('X-DETAIL.legacyEntry'),
    body: ref('R-D10.body'),
    photo: p ? p.dataURL : null,
  };
}
