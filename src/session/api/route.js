// App API · 导航真相源翻转（B3.F；计划 B3B4-原生化架构与计划.md §3.3 段 2 第 2–4 条）。
// 段 2 起原生持有页面栈；这组 op 是原生 ⇄ 引擎之间关于栈的全部往来。判定逻辑仍只有 JS 一份（守卫 / 过期 / 深链 / 坏值 / 阻断优先在
// ui/route-memory.js planColdStart，深链去处在 platform/reminder.js），会话层不导入 UI：实现由引擎模式（ui/engine.js）经 ctx.route 注入。
//
//   route.save {stack, flush?}        原生的栈（[{id, n, p}]，底 → 顶）变了：引擎镜像以它为准，写路由提示键（storage.writeRoute，单一写入者）；flush = 进后台刷新离开时刻
//   route.plan {deepLink?}            冷启动：planColdStart 判定 → {stack:[{id, n, p}], bodies:[{type, body}], reason, restored}；原生按 stack 无转场重建，bodies 是各页的宿主消息
//   deeplink.reminder {cardKey}       提醒深链：与原来 shiziOpenReminderTarget 同一个处理；去哪（要不要先回首页、要不要弹 S02）由它发的 nav 决定
//   stage.enter {kind, entry?, …}     原生发起的导航（原生页推入 / 返回 / 切 tab / 页内参数）记账：引擎镜像跟上，回包带宿主消息（视图回包）
//   stage.resync {stack}              页面重载（WebContent 被回收）后：镜像按原生还在屏上的栈对齐，不发宿主消息

function call(name) {
  return (args, ctx) => {
    const r = ctx.route;
    const fn = r && typeof r[name] === 'function' ? r[name] : null;
    if (!fn) return { ok: false, error: { kind: 'unavailable' } };
    return fn(args || {});
  };
}

export const OPS = Object.freeze({
  'route.save': call('save'),
  'route.plan': call('plan'),
  'deeplink.reminder': call('deepLink'),
  'stage.enter': call('enter'),
  'stage.resync': call('resync'),
});
