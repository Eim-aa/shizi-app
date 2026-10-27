// 立刻做一次 store 在「下一次提交」时才会做的预算回收（旧月份折叠 / 墨迹淘汰）：seed 是整体替换、不做回收，
// 折叠要等之后某次提交才发生——原生页先按未折叠的数据画、折叠后才刷新，取证会取到中间状态。夹具在打开页面之前先把它做完，网页与原生第一眼看到的都是折叠后的数据。
// 先 seed 提交造好的数据（没提交的话这里补一次），再在一次提交里调 budget.js 的 recover（与 store.persist 同一个函数、同样的 now 与预算）。
if (ctx.draft || ctx.patch) {
  const base = ctx.T.getState();
  const next = { ...base, ...(ctx.draft || {}) };
  for (const [k, v] of Object.entries(ctx.patch || {})) next[k] = v;
  const r0 = ctx.T.seed(next);
  if (!r0 || !r0.ok) return { ok: false, error: 'seed ' + JSON.stringify(r0) };
  ctx.draft = null;
  ctx.patch = null;
}
const { getStore } = await import('/src/store/store.js');
const { recover } = await import('/src/store/budget.js');
const { now } = await import('/src/platform/env.js');
const store = getStore();
let actions = [];
const r = store.commit('qa-fold-now', draft => {
  actions = recover(draft, { now: now(), budgets: store.budgets }).actions;
});
if (!r || !r.ok) return { ok: false, error: 'fold ' + JSON.stringify(r) };
await ctx.sleep(a.wait === undefined ? 300 : a.wait);
