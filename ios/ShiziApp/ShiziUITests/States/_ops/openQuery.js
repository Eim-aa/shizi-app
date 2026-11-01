// 原生查字弹层的起点（B3.6）：只在原生弹层开着时（native-stage.js nativeScreenOn('query')：开关开着 + 原生有这一屏的类）打开它。
// a: {mode: 'lookup'|'pick', text, selected, composing}
//
// 网页取证不经这里：网页参考照旧由夹具的步骤做（点「查字框 / 自己选字」→ js 步骤设输入框 → 点勾选），这个 op 在网页那一侧什么都不做。
// 原生取证：步骤里的 js 只在网页跑、原生没有网页的输入框，所以输入原文、组字态（输入法组字中）与预选字由这里一起给（弹层的初始状态）。
// 动作回调与网页入口同一批（字库入口的「练这个字 / 查看记录」= openLibraryQuery，首页入口的「练这些字」= openPick）。
// B4.9c：写入者是 SwiftEngine（壳注入 __shiziQASwiftWriter）——请 Swift 走同一个入口（查字回调登记在 Swift 那边），不在页面里开。
const { nativeScreenOn } = await import('/src/ui/native-stage.js');
if (window.__shiziQASwiftWriter) {
  window.webkit.messageHandlers.shiziNative.postMessage({ type: 'native', op: 'qa-ui', action: 'openQuery', args: { mode: a.mode || 'lookup', text: a.text || '', selected: a.selected || [], composing: !!a.composing } });
  await ctx.sleep(300);
} else if (nativeScreenOn('query')) {
  const mode = a.mode || 'lookup';
  const { openQuery } = await import('/src/ui/components/query/index.js');
  let onPick;
  let onPractice;
  let onDetail;
  if (mode === 'pick') {
    const home = await import('/src/ui/screens/home/index.js');
    onPick = home.pickAndStart;
  } else {
    const lib = await import('/src/ui/screens/library/query-entry.js');
    onPractice = lib.practiceFromLookup;
    onDetail = lib.detailFromLookup;
  }
  openQuery({ mode, onPick, onPractice, onDetail, text: a.text || '', selected: a.selected || [], composing: !!a.composing });
}
