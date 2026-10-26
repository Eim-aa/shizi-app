// 打开查字弹层（网页版弹层 / 原生弹层，同一句）。a: {mode: 'lookup'|'pick', text, selected, composing}
//
// 网页版：输入框由夹具的 js 步骤设置（与网页参考同一条路径，这里不传初值）。
// 原生版：原生弹层没有网页的输入框，输入原文、组字态（输入法组字中）与预选字由这里一起给（弹层的初始状态）。
// 动作回调与网页版同一批（字库入口的「练这个字 / 查看记录」、首页入口的「练这些字」）。
// 原生与否用页面自己的闸（native-stage.js 的 nativeScreenOn：开关开着 + 原生有这一屏的类），
// 与 openQuery 内部走的是同一道闸——网页那一侧行为一字不变。
const { nativeScreenOn } = await import('/src/ui/native-stage.js');
const native = nativeScreenOn('query');
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
openQuery({
  mode,
  onPick,
  onPractice,
  onDetail,
  text: native ? (a.text || '') : '',
  selected: native ? (a.selected || []) : [],
  composing: native ? !!a.composing : false,
});
