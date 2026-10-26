// App API · 字库子页（B3.8；计划 B3B4-原生化架构与计划.md §3.4「视图 op / 写入 op」）。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。
//
//   view.library-list {kind, sel}   → {ok, view}：views/library-list.js listModel（网页清单页渲染用的同一个模型函数）
//   view.library-all {sort, filter, fold, find, width, large} → {ok, view}：views/library-all.js allModel
//   view.library-switch {}          → {ok, view}：views/library-switch.js libraryRows
//   library.list.start {keys, view} 开一组（清单页「练这些字」；网页 list.js 同一个函数）
//   library.all.start {go}          开一组 / 进区清单（网页 all.js 同一个函数）
//   library.switch {id}             换库（网页 switch.js 同一个函数；失败回 {ok:false, error:{kind}}）
//
// 视图 op 的返回值 = 网页页面渲染用的**同一个模型函数**的结果（同一个函数对象，契约测试 test/ui/native-library-sub.test.mjs 逐项核对）；
// 写入 op 是网页那几个函数的薄包装（D07：失败回 {ok:false, error:{kind}}，原生就地三段式）。
//
// 会话层不导入 UI：网页那三个页面模块加载时经 setLibrarySubActions 把**同一个函数对象**登记进来（同 api/home.js 的 setHomeActions）。
// 本文件只由 B3.8 改；index.js 的导入清单是固定的，页面卡不改任何共享文件。

import { listModel } from '../views/library-list.js';
import { allModel } from '../views/library-all.js';
import { libraryRows } from '../views/library-switch.js';
import { cardForKey, isPracticable } from '../../data/deck.js';
import { getInk } from '../../store/store.js';
import { localDay } from '../../core/dates.js';
import { decodeInk, resampleForReplay } from '../../core/ink-math.js';
import { now as envNow } from '../../platform/env.js';
import { getTextSize } from '../../platform/text-size.js';
import * as defaultPolicy from '../../config/policy.js';

// ---------------------------------------------------------------- 动作登记（网页页面模块调用）

let actions = null;

/** 网页的字库子页模块登记它们的动作（开组 / 换库）；后登记的覆盖同名项（每个页面只登记自己那一组）。 */
export function setLibrarySubActions(next) {
  if (!next || typeof next !== 'object') return;
  actions = { ...(actions || {}), ...next };
}

export function librarySubActions() {
  return actions;
}

/**
 * 网页侧登记的量测（B3.8）：原生排版要用几处「网页量出来的值」（组头的高、pretty 段落的折行点、页头尾端文字按钮的宽）。
 * 量测在页面里做（有 DOM），本文件只把结果放进回包信封的 metrics 字段（视图模型本身不动）。
 * 形状：{list?: (view) => object, all?: (view) => object}。
 */
let measurer = null;

export function setLibrarySubMeasure(next) {
  if (!next || typeof next !== 'object') return;
  measurer = { ...(measurer || {}), ...next };
}

/** 量测结果（没有登记量测 / 页面外 → null）。 */
function measureOf(kind, view) {
  if (!measurer) return null;
  const fn = measurer[kind];
  if (typeof fn !== 'function') return null;
  try {
    return fn(view) || null;
  } catch (error) {
    return null;
  }
}

/** 动作回包 → 可序列化的 {ok, error?}（开组回包里的整组会话对象不过桥）。 */
export function replyOf(r) {
  if (r && r.ok === false) {
    return { ok: false, error: r.error && typeof r.error === 'object' ? { kind: String(r.error.kind || 'generic') } : { kind: 'generic' } };
  }
  return { ok: true };
}

function act(name, args) {
  const fn = actions && actions[name];
  if (typeof fn !== 'function') return { ok: false, error: { kind: 'unavailable' } };
  return replyOf(fn(args || {}));
}

// ---------------------------------------------------------------- 视图

/** 今天的本地日（网页页面同一句：localDay(envNow())）。 */
function today() {
  return localDay(envNow());
}

/** 题库卡（网页页面传 data/deck.js 的 cardForKey；同一个函数）。 */
function cardFor(cardKey) {
  try {
    return cardForKey(cardKey);
  } catch (error) {
    return null;
  }
}

/** 能不能练（网页页面传 data/deck.js 的 isPracticable；同一个函数）。 */
function practicable(cardKey) {
  try {
    return isPracticable(cardKey);
  } catch (error) {
    return false;
  }
}

/** 拼音（网页 all.js 的 pyOfChar：题库卡片的 py；题库外的字没有）。 */
function pyOf(char) {
  const card = cardFor(`base:${char}`);
  return card && typeof card.py === 'string' ? card.py : '';
}

/** 清单页视图：网页 list.js 的 listModel（同一个函数对象、同一组注入）。 */
export function listView(state, { kind, sel = null } = {}) {
  return listModel(state, { kind, sel, today: today(), policy: defaultPolicy, cardFor, practicable });
}

/**
 * 全部字页视图：网页 all.js 的 allModel（compact = 系统大字号，width = 屏宽；两者决定墙的列数）。
 * large 缺省时取当前系统字号（网页 useWallLayout 读的 :root[data-text-large]；platform/text-size.js 按 --k ≥ policy.compactTextScale 给，
 * 与网页同一口径）；调用方（原生页）也可以显式给。
 */
export function allView(state, { sort, filter, fold, find = '', width = null, large = undefined } = {}) {
  const compact = large === undefined ? getTextSize().large : large === true;
  return allModel(state, {
    today: today(), policy: defaultPolicy, compact, width: width == null ? null : Number(width),
    sort, filter, fold, find, pyOf, practicable,
  });
}

/** 换库页视图：网页 switch.js 的 libraryRows（同一个函数对象）。 */
export function switchView(state) {
  return libraryRows(state);
}

/**
 * 清单行的本人笔迹（网页 list.js 的 inkOf：存下的墨迹 → 解码 → 重采样），按记录 id 给。
 * 原生画小图用（345 单位空间）；没有墨迹的行不在表里（网页画「没有笔迹」）。
 */
export function inkOfRows(state, rows) {
  return inkOfRecords(state, (rows || []).map(row => ({ recordId: row.recordId, record: row.record })));
}

/**
 * 记录 → 本人笔迹（网页 list.js 的 inkOf / wall.js 的 InkMini 同一份数据）。
 * entries: [{recordId, record}]；回包按 recordId 给点列（345 单位空间）。
 */
export function inkOfRecords(state, entries) {
  const out = {};
  for (const entry of entries || []) {
    if (!entry || !entry.record) continue;
    let raw = null;
    try {
      raw = getInk(state, entry.record);
    } catch (error) {
      raw = null;
    }
    if (!raw) continue;
    let decoded = null;
    try {
      decoded = decodeInk(raw);
    } catch (error) {
      decoded = null;
    }
    if (!decoded) continue;
    const strokes = resampleForReplay(decoded).map(pts => pts.map(p => ({ x: p.x, y: p.y, w: p.w })));
    if (strokes.length) out[entry.recordId] = strokes;
  }
  return out;
}

// ---------------------------------------------------------------- op 表

export const OPS = Object.freeze({
  'view.library-list': (args, ctx) => {
    const state = ctx.getStore().getState();
    const view = listView(state, { kind: args.kind, sel: args.sel ?? null });
    return { ok: true, view, ink: inkOfRows(state, view.rows), metrics: measureOf('list', view) };
  },
  'view.library-all': (args, ctx) => {
    const state = ctx.getStore().getState();
    const view = allView(ctx.getStore().getState(), {
      sort: args.sort, filter: args.filter, fold: args.fold, find: typeof args.find === 'string' ? args.find : '',
      width: args.width ?? null, large: args.large === undefined ? undefined : args.large === true,
    });
    // 墙格里「最近一次笔迹」的小图（网页 wall.js 的 InkMini；按记录 id 给，原生画在格子里）
    const entries = [];
    for (const g of view.groups || []) for (const c of g.cells || []) {
      if (c && c.record && c.record.id) entries.push({ recordId: c.record.id, record: c.record });
    }
    return { ok: true, view, ink: inkOfRecords(state, entries), metrics: measureOf('all', view) };
  },
  'view.library-switch': (args, ctx) => ({ ok: true, view: switchView(ctx.getStore().getState()) }),
  'library.list.start': args => act('startList', args),
  'library.all.start': args => act('startAll', args),
  'library.switch': args => act('switch', args),
});
