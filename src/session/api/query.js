// App API · 查字弹层与 S02（query.add、s02.decide …）：B3.2 预先建好的空文件，B3.6 填内容。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。视图 op 返回页面渲染用的同一个模型函数的结果（src/session/views/），
// 写入 op 是现有提交函数的薄包装（D07：失败回 {ok:false, error:{kind}}）；契约测试 test/ui/native-<页>.test.mjs（网页路径 == API 路径）。
// 本文件只由 B3.6 改；index.js 的导入清单是固定的，页面卡不改任何共享文件。

export const OPS = Object.freeze({});
