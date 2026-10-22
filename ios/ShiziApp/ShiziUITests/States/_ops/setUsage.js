// 笔迹 / 记录存储占用预警（D66 ⑭「我的 › 备份」行与备份页）：真的把存储写到 80% 要几十 MB，夹具把存储层的占用估算换成预警值（界面只读 store.status.usage）。
// 要在 seed 之后、进页面之前调；之后的提交仍会重新估算，但估算函数已被换掉，值不变。a: {level: 'warn'|'full', ratio}
const { getStore } = await import('/src/store/store.js');
const store = getStore();
const ratio = a.ratio || 0.86;
const orig = store.storage.estimateUsage;
(window.__qaCleanups = window.__qaCleanups || []).push(() => { store.storage.estimateUsage = orig; });
store.storage.estimateUsage = () => ({ level: a.level || 'warn', ratio, total: Math.round(ratio * 64 * 1024 * 1024), byBucket: {} });
store.refreshUsage();
