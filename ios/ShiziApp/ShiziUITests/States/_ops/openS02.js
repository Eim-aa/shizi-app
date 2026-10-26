// 原生 S02 的起点（B3.6）：只在原生 S02 开着时（native-stage.js nativeScreenOn('s02')）走界面层的 startPicked（旧 B 没写完 → S02）。
// 网页取证不经这里：网页参考照旧由夹具的 js 步骤做同一句 startPicked（步骤里的 js 只在网页跑）。a: {keys: ['火']}（缺省 = ['火']）
const { nativeScreenOn } = await import('/src/ui/native-stage.js');
if (nativeScreenOn('s02')) {
  const { startPicked } = await import('/src/ui/screens/session/index.js');
  startPicked(a.keys || ['火'], { source: { view: 'home' } });
}
