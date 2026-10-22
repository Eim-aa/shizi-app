// 改某个数据域（settings / backupMeta / custom / wordOff / photos / legacy …），由 seed 提交。a: {domain, value}；对象会和同一域里先前 patch 的合并。
const p = ctx.patch || (ctx.patch = {});
const cur = p[a.domain];
p[a.domain] = cur && typeof cur === 'object' && !Array.isArray(cur) && a.value && typeof a.value === 'object' && !Array.isArray(a.value) ? { ...cur, ...a.value } : a.value;
