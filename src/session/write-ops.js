// 写字会话层（B2.1；docs/engineering/v10/B2-原生写字架构.md §3.2「B2.1 先做的一步」、§11）：
// 写字页的全部提交函数与它们用到的纯模型——现场（抬笔写回、恢复幂等）、判断、提示、看答案 / 描一遍 / 自己写、跳过 / 撤销、
// 结束这组、结果行与改判、首练提示、题面——从 src/ui/screens/write/*.js 原样挪到这里（行为不变，原导入路径仍转出同一批函数）。
//
// 边界：src/session 不 import 任何 UI / Preact / DOM 模块（门禁 test/session/boundary.test.mjs）；只依赖 src/core、src/store、
// src/config、src/data。网页写字页与写字会话 API（write-api.js → window.shiziNativeWrite）都从这里调用同一批函数，store.commit 仍是唯一写入口。
// B3 末这一层与 src/store、src/core 一起搬进 JavaScriptCore（D69），B4 按同一组 op 改写 Swift。

export * from './ops/answer.js';
export * from './ops/judge.js';
export * from './ops/strokes.js';
export * from './ops/hint.js';
export * from './ops/skip.js';
export * from './ops/end.js';
export * from './ops/line.js';
export * from './ops/first-tip.js';
export * from './ops/prompt.js';
