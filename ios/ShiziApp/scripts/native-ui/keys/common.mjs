// QA-H1 语义键（B3.3 起按屏分文件，elements.mjs 的 loadKeys 按文件名顺序合并）。每条：key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop:/id:）。
// id:xxx#N 取同 id 的第 N 个。页面卡只加自己的 keys/<屏>.mjs。

// 各页共用（页头返回）
export const KEYS = [
  { key: 'back', native: ['prop:backButton'] },
];
