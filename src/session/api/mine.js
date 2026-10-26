// App API · 我的（tab 根，B3.5c）：
//   view.mine {width?, ax?}            → {ok, view}：网页「我的」页渲染用的同一组函数（views/mine-page.js mineView）的结果；width = 原生页宽（pt），ax = AX 档位 0–5（字帖格宽 / 列数按它算）
//   mine.appearance {value}            → commitAppearance（'auto' | 'light' | 'dark'）；失败 {ok:false, error:{kind}}（D07：原生就地三段式）
//   mine.groupSize {value}             → commitGroupSize（5 | 10 | 20 | 30）
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }；契约测试 test/ui/native-mine.test.mjs（网页路径 == API 路径）。
// 本文件只由 B3.5c 改；index.js 的导入清单是固定的，页面卡不改任何共享文件。

import { localDay } from '../../core/dates.js';
import { now as envNow } from '../../platform/env.js';
import { storagePressureOf } from '../../store/budget.js';
import { commitAppearance, commitGroupSize } from '../prefs-ops.js';
import { sheetStrokes } from '../write-api.js';
import { mineView } from '../views/mine-page.js';

function buildOf(ctx) {
  const b = typeof ctx.build === 'function' ? ctx.build() : ctx.build;
  return b && typeof b === 'object' ? b : { version: '', build: '' };
}

function pressureOf(store) {
  try {
    return storagePressureOf(store.status.usage);
  } catch (error) {
    return null;
  }
}

/** 提交函数的结果 → API 回包（D07：失败回 {ok:false, error:{kind}}；非法值 = invalid）。 */
function attempt(store, commit, value) {
  let result;
  try {
    result = commit(store, value);
  } catch (error) {
    return { ok: false, error: { kind: error instanceof RangeError ? 'invalid' : 'unknown' } };
  }
  if (result && result.ok) return { ok: true, skipped: result.skipped === true };
  const e = result && result.error ? result.error : {};
  return { ok: false, error: { kind: typeof e.kind === 'string' ? e.kind : 'generic' } };
}

export const OPS = Object.freeze({
  'view.mine': (args, ctx) => {
    const store = ctx.getStore();
    const width = Number.isFinite(args.width) && args.width > 0 ? args.width : 402;
    const ax = Number.isInteger(args.ax) && args.ax > 0 ? Math.min(5, args.ax) : 0;
    const today = typeof args.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.today) ? args.today : localDay(envNow());
    const view = mineView(store.getState(), today, {
      store, width, ax, build: buildOf(ctx), storagePressure: pressureOf(store), strokesOf: record => sheetStrokes(store, record),
    });
    // env：这份视图按什么页宽 / AX 档算的（原生页核对：不一致就带真实值重拉一次）
    return { ok: true, view: { ...view, env: { width, ax } } };
  },
  'mine.appearance': (args, ctx) => attempt(ctx.getStore(), commitAppearance, args.value),
  'mine.groupSize': (args, ctx) => attempt(ctx.getStore(), commitGroupSize, args.value),
});
