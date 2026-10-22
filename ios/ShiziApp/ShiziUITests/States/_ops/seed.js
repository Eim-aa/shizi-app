// 提交造好的数据（seedRecords 的草稿 + patch 的各域）：在当前数据上叠，经测试钩子 seed（整体替换、走形状校验），再通知首页等页面刷新。
const base = ctx.T.getState();
const next = { ...base, ...(ctx.draft || {}) };
for (const [k, v] of Object.entries(ctx.patch || {})) {
  next[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && !(ctx.draft && k in ctx.draft) ? { ...base[k], ...v } : v;
}
const r = ctx.T.seed(next);
if (!r || !r.ok) return { ok: false, error: 'seed ' + JSON.stringify(r) };
ctx.draft = null;
ctx.patch = null;
document.dispatchEvent(new Event('visibilitychange'));
await ctx.sleep(a.wait === undefined ? 150 : a.wait);
