// 阻断页（R-B09）：让根组件画阻断页。a: {kind: 'unavailable' | 'blocked' | 'migration'}
//   unavailable  存储探测不过（store.status.available=false）：把存储层的探测换成失败，store.reload()
//   blocked      写失败且回滚也失败（storage.blocked）：把 storage.blocked 换成有值，store.reload()（内存里的记录还在，可导出）
//   migration    v1 → v2 迁移失败：block/index.js reportMigrationFailure
// 还原函数进 window.__qaCleanups（下一个顶层夹具清空前执行），不影响后面的状态。
const { getStore } = await import('/src/store/store.js');
const store = getStore();
const storage = store.storage;
const cleanups = (window.__qaCleanups = window.__qaCleanups || []);
if (a.kind === 'unavailable') {
  const orig = storage.probe;
  storage.probe = () => ({ ok: false, kind: 'security' });
  cleanups.push(() => { storage.probe = orig; store.reload(); });
  store.reload();
} else if (a.kind === 'blocked') {
  const desc = Object.getOwnPropertyDescriptor(storage, 'blocked');
  Object.defineProperty(storage, 'blocked', { configurable: true, get: () => ({ reason: 'rollback-failed', keys: [] }) });
  cleanups.push(() => { if (desc) Object.defineProperty(storage, 'blocked', desc); store.reload(); });
  store.reload();
} else if (a.kind === 'migration') {
  const m = await import('/src/ui/screens/block/index.js');
  cleanups.push(() => m.clearMigrationFailure());
  m.reportMigrationFailure({ reason: 'qa-injected' });
} else return { ok: false, error: 'blockMode: unknown kind ' + a.kind };
await ctx.sleep(300);
