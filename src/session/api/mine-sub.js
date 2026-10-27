// App API · 我的子页（B3.9）：练习记录 / 月字帖 / 年报。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。视图 op 返回页面渲染用的同一个模型函数的结果（src/session/views/mine-sub.js），
// 写入 op 是现有提交函数的薄包装（D07：失败回 {ok:false, error:{kind}}）；契约测试 test/ui/native-mine-sub.test.mjs（网页路径 == API 路径）。
// 本文件只由 B3.9 改；index.js 的导入清单是固定的，页面卡不改任何共享文件。
//
//   view.records {month?, day?}  → {ok, view}：练习记录页（src/session/views/mine-sub.js recordsView）
//   view.month   {month}         → {ok, view}：月字帖页（monthView）
//   view.annual  {year?}         → {ok, view}：年报页（annualView）
//   图片按钮：原生直接开原生图片预览（B3.11，NativeImagePreviewController + image.* op，scope = {kind:'month'|'day'|'annual', …}），本文件不再有图片 op
//
// 墨迹：格子里那份本人墨由 store 取（views/detail.js inkOf → core/ink-build.js builtInk 的点列），原生按同一份点列画。

import { annualView, monthView, recordsView } from '../views/mine-sub.js';
import { inkOf, recordHasInk } from '../views/detail.js';
import { annualDefaultYear } from '../views/annual.js';
import { localDay, monthOf } from '../../core/dates.js';
import { now as envNow } from '../../platform/env.js';

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
});
