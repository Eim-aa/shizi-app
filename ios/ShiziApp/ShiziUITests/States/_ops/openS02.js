// 原生 S02 的起点（B3.6）：只在原生 S02 开着时（native-stage.js nativeScreenOn('s02')）走界面层的 startPicked（旧 B 没写完 → S02）。
// 网页取证不经这里：网页参考照旧由夹具的 js 步骤做同一句 startPicked（步骤里的 js 只在网页跑）。a: {keys: ['火']}（缺省 = ['火']）
// B4.9c：写入者是 SwiftEngine（壳注入 __shiziQASwiftWriter）——请 Swift 走同一个入口（startPicked，S02 的回调登记在 Swift 那边），不在页面里开。
const { nativeScreenOn } = await import('/src/ui/native-stage.js');
if (window.__shiziQASwiftWriter) {
  window.webkit.messageHandlers.shiziNative.postMessage({ type: 'native', op: 'qa-ui', action: 'startPicked', args: { keys: a.keys || ['火'], source: { view: 'home' } } });
  await ctx.sleep(300);
} else if (nativeScreenOn('s02')) {
  const { startPicked } = await import('/src/ui/screens/session/index.js');
  startPicked(a.keys || ['火'], { source: { view: 'home' } });
}
