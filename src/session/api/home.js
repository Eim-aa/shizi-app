// App API · 首页（B3.5a；计划 B3B4-原生化架构与计划.md §1.2 首页行、§3.4）。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。
//
//   view.home {}                 → {ok, view}：views/home.js homeView（= 网页首页渲染用的同一个 homeModel + 同一组派生，给文案引用）
//   home.expire {}               跨天过期（P37，core/session-start.expireStale；网页首页挂载 / 回前台时做的同一件事）
//   home.start {source?}         主按钮「开始写字 / 继续写字 / 再写一组」（网页 startMain）；source = 原生主按钮此刻的真实矩形（D62 T-paper 来源）
//   home.resumeOther {source?}   A、B 都没写完时的「今天的字 · 接着写」行（网页 resumeOther）
//   home.deferSpecial {}         「写平常字」：特别组顺延后开一组平常的（网页 deferCapital）
//   home.switchLibrary {}        「换练习范围」→ 推入换库页（网页 openLibrarySwitch）
//   home.pick {}                 「自己选字」→ 查字弹层 pick（网页 openPick；弹层仍是网页的，B3.6 原生化）
//   home.source {rect, label}    原生主按钮此刻的位置与字（写字页 T-paper 缩回时的落点，paper-transition liveSource 读）
//   home.undoLeave {}            离开撤销条的「撤销」/「再试一次」（网页 LeaveUndoHost 同一个 undoLeave → commitUndoSkip，成功后回到那个字）
//   home.undoLeaveCancel {}      撤销没保存上时的「先不保存」（网页 onCancelFail 同一件事：结束这次撤销机会）
//
// 写入 op 是网页首页同一批函数的薄包装：它们（开组 + 导航）在界面层（ui/screens/home/index.js、session/index.js），会话层不导入 UI——
// 网页首页模块加载时经 setHomeActions 把**同一个函数对象**登记进来（网页路径 == API 路径，test/ui/native-home.test.mjs）。
// D07：失败回 {ok:false, error:{kind}}，原生就地三段式。

import { homeView } from '../views/home.js';
import { deckAdapter } from '../../data/deck.js';
import * as core from '../../core/session-start.js';
import { now as envNow } from '../../platform/env.js';

let actions = null;

/** 网页首页模块登记它的动作（start / resumeOther / deferSpecial / switchLibrary / pick / source / undoLeave / ui）；传 null 取消。 */
export function setHomeActions(a) {
  actions = a && typeof a === 'object' ? a : null;
}

export function homeActions() {
  return actions;
}

/** 动作回包 → 可序列化的 {ok, opened?, error?}（开组回包里的整组会话对象不过桥）。 */
export function replyOf(r) {
  if (r && r.ok === false) return { ok: false, error: r.error && typeof r.error === 'object' ? { kind: String(r.error.kind || 'generic') } : { kind: 'generic' } };
  const out = { ok: true };
  if (r && typeof r.opened === 'string') out.opened = r.opened;
  return out;
}

function act(name, args) {
  const fn = actions && actions[name];
  if (typeof fn !== 'function') return { ok: false, error: { kind: 'unavailable' } };
  return replyOf(fn(args || {}));
}

function uiState() {
  try {
    return actions && typeof actions.ui === 'function' ? actions.ui() : null;
  } catch (error) {
    return null;
  }
}

export const OPS = Object.freeze({
  'view.home': (args, ctx) => ({ ok: true, view: homeView(ctx.getStore().getState(), envNow(), { deck: deckAdapter, ui: uiState() }) }),
  'home.expire': (args, ctx) => replyOf(core.expireStale(ctx.getStore(), { now: envNow })),
  'home.start': args => act('start', args),
  'home.resumeOther': args => act('resumeOther', args),
  'home.deferSpecial': args => act('deferSpecial', args),
  'home.switchLibrary': args => act('switchLibrary', args),
  'home.pick': args => act('pick', args),
  'home.source': args => act('source', args),
  'home.undoLeave': args => act('undoLeave', args),
  'home.undoLeaveCancel': args => act('undoLeaveCancel', args),
});
