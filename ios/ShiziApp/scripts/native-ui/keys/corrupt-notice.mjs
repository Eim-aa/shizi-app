// corrupt-notice 的语义键（状态：corrupt-notice）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'corrupt-notice', native: ['id:native-corrupt-notice'] },
  { key: 'corrupt-notice-close', native: ['id:native-corrupt-notice-close'] },
];
