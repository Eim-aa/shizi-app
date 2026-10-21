// 结果页会话层（B2.1）：结果页模型（作品成员、格子、落款数据）、结束 / 离开、改判、从结果页撤销跳过、作品放进 / 拿出、落印、
// 复现句与「N 天后再见」——从 src/ui/screens/result/*.js 原样挪到这里（行为不变，原导入路径仍转出）。边界同 write-ops.js。

export * from './ops/result.js';
export * from './ops/work.js';
export * from './ops/first-result.js';
