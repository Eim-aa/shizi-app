// App API · 流程页余项（重写错字、没有要写的字）：B3.2 预先建好的空文件，B3.12 填内容。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。视图 op 返回页面渲染用的同一个模型函数的结果（src/session/views/），
// 写入 op 是现有提交函数的薄包装（D07：失败回 {ok:false, error:{kind}}）；契约测试 test/ui/native-<页>.test.mjs（网页路径 == API 路径）。
//
//   view.session-none {exhausted?} → {ok, view}：views/session.js noneView（= 网页「没有要写的字」页渲染用的同一份模型）
//   session.pick {}                  「自己选字」→ 查字弹层 pick（网页 setNoneActions 登记的同一个函数对象）
//   session.libSwitch {}             「更换字库」→ 换库页（网页 setNoneActions 登记的同一个函数对象）
//   session.wrongList {}             「看写错过的字 ›」→ 写错过的清单（网页 setNoneActions 登记的同一个函数对象）
//
// 入口的登记在网页侧（ui/screens/session/none.js 等模块加载时调 setNoneActions）：会话层不导入 UI，
// 网页模块把**同一个函数对象**登记进来（网页路径 == API 路径）。没登记的入口不显示（不放点了没反应的按钮）。

import { noneView } from '../views/session.js';

let actions = { pick: null, wrongList: null, libSwitch: null };

/** 网页模块登记它的动作（pick / wrongList / libSwitch）；传 null 取消。 */
export function setNoneActions(next) {
  if (!next || typeof next !== 'object') return;
  if ('pick' in next) actions.pick = typeof next.pick === 'function' ? next.pick : null;
  if ('wrongList' in next) actions.wrongList = typeof next.wrongList === 'function' ? next.wrongList : null;
  if ('libSwitch' in next) actions.libSwitch = typeof next.libSwitch === 'function' ? next.libSwitch : null;
}

/** 现在登记着的动作（网页页面与视图 op 用同一份）。 */
export function noneActions() {
  return actions;
}

function act(name) {
  const fn = actions[name];
  if (typeof fn !== 'function') return { ok: false, error: { kind: 'unavailable' } };
  const r = fn();
  if (r && typeof r === 'object' && r.ok === false) return { ok: false, error: { kind: String(r.error && r.error.kind ? r.error.kind : 'generic') } };
  return { ok: true };
}

export const OPS = Object.freeze({
  'view.session-none': (args, ctx) => ({
    ok: true,
    view: noneView({
      exhausted: !!(args && args.exhausted),
      pick: !!actions.pick,
      wrongList: !!actions.wrongList,
      libSwitch: !!actions.libSwitch,
    }),
  }),
  'session.pick': () => act('pick'),
  'session.libSwitch': () => act('libSwitch'),
  'session.wrongList': () => act('wrongList'),
});
