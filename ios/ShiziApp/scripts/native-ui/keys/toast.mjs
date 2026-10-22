// toast 的语义键（B3.3 从网页参考生成，状态：toast-share-failed）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'toast', native: [], web: ['id:toast'] },
  { key: 'toast-timer', native: [], web: ['id:toast-timer'] },
];
