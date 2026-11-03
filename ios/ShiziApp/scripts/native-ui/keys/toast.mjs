// toast 的语义键（状态：toast-share-failed）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'toast', native: ['id:native-toast'] },
  { key: 'toast-timer', native: ['id:native-toast-timer'] },
];
