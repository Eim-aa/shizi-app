// 坏值提示（启动隔离了坏值时顶部一次）：把存储层 repair 的结果换成「隔离了 shizi.v2.settings」，store.reload() 触发 CorruptNotice（它订阅 store）。
// 还原进 window.__qaCleanups。a: {key}
const { getStore } = await import('/src/store/store.js');
const store = getStore();
const storage = store.storage;
const orig = storage.repair;
storage.repair = (...args) => ({ ...orig.apply(storage, args), quarantined: [{ key: a.key || 'shizi.v2.settings' }] });
(window.__qaCleanups = window.__qaCleanups || []).push(() => {
  storage.repair = orig;
  const close = document.querySelector('[data-testid="corrupt-notice-close"]'); // 提示是组件自己的状态，点掉它，免得留到后面的状态里
  if (close) close.click();
  // B3.F 引擎模式没有网页的那一条（engine.js 直接发给原生）：收起原生浮条
  try { if (!close) window.webkit.messageHandlers.shiziNative.postMessage({ type: 'native', op: 'corrupt', show: false }); } catch (e) {}
});
store.reload();
await ctx.sleep(300);
