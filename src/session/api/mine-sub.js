// App API · 我的子页（B3.9）：练习记录 / 月字帖 / 年报。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。视图 op 返回页面渲染用的同一个模型函数的结果（src/session/views/mine-sub.js），
// 写入 op 是现有提交函数的薄包装（D07：失败回 {ok:false, error:{kind}}）；契约测试 test/ui/native-mine-sub.test.mjs（网页路径 == API 路径）。
// 本文件只由 B3.9 改；index.js 的导入清单是固定的，页面卡不改任何共享文件。
//
//   view.records {month?, day?}  → {ok, view}：练习记录页（src/session/views/mine-sub.js recordsView）
//   view.month   {month}         → {ok, view}：月字帖页（monthView）
//   view.annual  {year?}         → {ok, view}：年报页（annualView）
//   mine.image   {kind, month?, year?, day?}  打开网页的图片预览弹层（B3.11 做原生预览；这里先经 nav 让网页画，宿主层留底让开）
//
// 墨迹：格子里那份本人墨由 store 取（views/detail.js inkOf → core/ink-build.js builtInk 的点列），原生按同一份点列画。

import { annualView, monthView, recordsView } from '../views/mine-sub.js';
import { inkOf, recordHasInk } from '../views/detail.js';
import { annualDefaultYear } from '../views/annual.js';
import { localDay, monthOf } from '../../core/dates.js';
import { now as envNow } from '../../platform/env.js';

let actions = {};

/**
 * 网页界面层登记它的动作（打开网页版的图片预览弹层）：{ month, annual, day }。
 * 会话层不导入 UI：网页「我的」子页模块加载时经 setMineSubActions 登记（与 api/home.js setHomeActions 同一做法）。
 * 传 null 取消某一项；只传一项时另一项保持不变。
 */
export function setMineSubActions(a) {
  const next = Object.assign({}, actions);
  for (const key of ['month', 'annual', 'day']) {
    if (Object.prototype.hasOwnProperty.call(a || {}, key)) next[key] = typeof a[key] === 'function' ? a[key] : null;
  }
  actions = next;
}

export function mineSubActions() {
  return actions;
}

function storeOf(ctx) {
  try {
    return ctx.getStore();
  } catch (error) {
    return null;
  }
}

/** 今天（应用时钟）。 */
function todayOf() {
  return localDay(envNow());
}

/** 取墨：这条记录有没有本人墨 + 它��点列（网页格子画的那一份）。 */
function inkTools(ctx) {
  const store = storeOf(ctx);
  return {
    hasInk: record => recordHasInk(store, record),
    inkOf: record => inkOf(store, record),
  };
}

function monthArg(args) {
  const m = args && typeof args.month === 'string' ? args.month : '';
  return /^\d{4}-\d{2}$/.test(m) ? m : monthOf(todayOf());
}

export const OPS = Object.freeze({
  'view.records': (args, ctx) => {
    const a = args || {};
    const t = todayOf();
    const month = typeof a.month === 'string' && a.month ? a.month : undefined;
    const day = typeof a.day === 'string' && a.day ? a.day : undefined;
    return { ok: true, view: recordsView(ctx.getStore().getState(), t, { month, day, ...inkTools(ctx) }) };
  },
  'view.month': (args, ctx) => {
    const month = monthArg(args);
    return { ok: true, view: monthView(ctx.getStore().getState(), month, inkTools(ctx)) };
  },
  'view.annual': (args, ctx) => {
    const a = args || {};
    const state = ctx.getStore().getState();
    const t = todayOf();
    const year = Number.isInteger(a.year) ? a.year : annualDefaultYear(state, t);
    return { ok: true, view: annualView(state, t, { year, ...inkTools(ctx) }) };
  },
  // 打开网页版的图片预览弹层（原生图片预览归 B3.11；这里只经 nav 让网页画，宿主层留底让开）。
  'mine.image': async (args, ctx) => {
    const kind = args && typeof args.kind === 'string' ? args.kind : '';
    const fn = actions[kind];
    if (typeof fn !== 'function') return { ok: false, error: { kind: 'unavailable' } };
    try {
      const r = await fn(args || {});
      return r && r.ok === false ? { ok: false, error: { kind: String(r.error && r.error.kind || 'generic') } } : { ok: true };
    } catch (error) {
      return { ok: false, error: { kind: 'exception' } };
    }
  },
});
