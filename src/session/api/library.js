// App API · 字库首页（B3.5b；view.library、library.startToday、library.openQuery、library.undoLeave / undoLeaveCancel）。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。视图 op 返回页面渲染用的同一个模型函数的结果（src/session/views/library.js libraryPageView，
// 文案是引用 + 数据）；写入 op 是网页页面同一批函数的薄包装（D07：失败回 {ok:false, error:{kind}}，原生就地三段式）；
// 契约测试 test/ui/native-library.test.mjs（网页路径 == API 路径）。
// 本文件只由 B3.5b 改；index.js 的导入清单是固定的，页面卡不改任何共享文件。
//
// 会话层不导入 UI：网页字库页（src/ui/screens/library/index.js）模块加载时经 setLibraryActions 登记它的动作
// （今日练习 = 首页 startToday、查字弹层 = openLibraryQuery、离开撤销 = write/skip.js 的 undoLeave / clearLeaveUndo），
// 原生页经 App API 调这些**同一个函数对象**（与首页 setHomeActions 同一套做法）。

import { libraryPageView } from '../views/library.js';
import { localDay } from '../../core/dates.js';
import { now as envNow } from '../../platform/env.js';
import { deckAdapter } from '../../data/deck.js';

let actions = null;

/** 网页字库页登记它的动作（startToday / openQuery / undoLeave / undoLeaveCancel / ui）；传 null 取消。 */
export function setLibraryActions(a) {
  actions = a && typeof a === 'object' ? a : null;
}

export function libraryActions() {
  return actions;
}

function act(name, args) {
  const fn = actions && actions[name];
  if (typeof fn !== 'function') return { ok: false, error: { kind: 'unavailable' } };
  const r = fn(args || {});
  if (r && r.ok === false) return { ok: false, error: r.error && typeof r.error === 'object' ? { kind: String(r.error.kind || 'generic') } : { kind: 'generic' } };
  const out = { ok: true };
  if (r && typeof r.opened === 'string') out.opened = r.opened;
  return out;
}

function uiState() {
  try {
    return actions && typeof actions.ui === 'function' ? actions.ui() : null;
  } catch (error) {
    return null;
  }
}

export const OPS = Object.freeze({
  'view.library': (args, ctx) => {
    const store = ctx.getStore();
    const nowMs = envNow();
    return {
      ok: true,
      view: libraryPageView(store.getState(), nowMs, {
        today: localDay(nowMs),
        deck: deckAdapter,
        getInk: record => { try { return store.getInk(record); } catch (error) { return null; } },
        ui: uiState(),
      }),
    };
  },
  // 今日练习：网页字库页的 startToday（= 首页 startToday / resumeOther：先续今天的练习（A 槽），没有就开下一组；不碰自己选的那一组）。
  // D62：从字库进写字页是普通推入（T-push），不是纸展开——网页那一侧不记纸来源，原生不报矩形。
  'library.startToday': args => act('startToday', args),
  // 搜索框 → 查字弹层（原生壳内 openQuery 推入原生查字屏，盖在原生字库页上，B3.6）。
  'library.openQuery': args => act('openQuery', args),
  // 离开撤销条（写字页跳过后离开，撤销机会跟到字库；网页 write/skip.js 同一份状态）。
  'library.undoLeave': () => act('undoLeave'),
  'library.undoLeaveCancel': () => act('undoLeaveCancel'),
});
