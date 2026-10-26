// 打开 S02 确认框（网页版 / 原生，同一句）：走界面层的 startPicked（旧 B 没写完 → S02）。
// a: {keys: ['火']}（缺省 = ['火']）
const { startPicked } = await import('/src/ui/screens/session/index.js');
startPicked(a.keys || ['火'], { source: { view: 'home' } });
