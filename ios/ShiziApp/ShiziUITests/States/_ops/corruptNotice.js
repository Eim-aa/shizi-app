// 坏值提示（启动隔离了坏值时顶部一次）：把存储层 repair 的结果换成「隔离了 shizi.v2.settings」，store.reload() 触发 CorruptNotice（它订阅 store）。
// 还原进 window.__qaCleanups。a: {key}
// B4.9c：替身经测试钩子 overrideStorage({quarantined}) 换——页面的 store 与原生（SwiftEngine 是写入者时替身挂到 Swift 的存储上、浮条由它发）同一件事。
ctx.T.overrideStorage({ quarantined: [a.key || 'shizi.v2.settings'] });
(window.__qaCleanups = window.__qaCleanups || []).push(() => {
  ctx.T.overrideStorage({});
  const close = document.querySelector('[data-testid="corrupt-notice-close"]'); // 提示是组件自己的状态，点掉它，免得留到后面的状态里
  if (close) close.click();
  // B3.F 引擎模式没有网页的那一条（engine.js 直接发给原生）：收起原生浮条；swift 模式里由 Swift 收（engine.js 那条不认）
  try {
    if (!close) {
      if (window.__shiziQASwiftWriter) window.webkit.messageHandlers.shiziNative.postMessage({ type: 'native', op: 'qa-ui', action: 'corruptHide' });
      else window.webkit.messageHandlers.shiziNative.postMessage({ type: 'native', op: 'corrupt', show: false });
    }
  } catch (e) {}
});
await ctx.sleep(300);
