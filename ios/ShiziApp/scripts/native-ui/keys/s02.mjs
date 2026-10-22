// s02 的语义键（B3.3 从网页参考生成，状态：s02、s02-fail）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 's02-dialog', native: [], web: ['id:s02-dialog'] },
  { key: 's02-body', native: [], web: ['id:s02-body'] },
  { key: 's02-continue', native: [], web: ['id:s02-continue'] },
  { key: 's02-end-start', native: [], web: ['id:s02-end-start'] },
  { key: 's02-cancel', native: [], web: ['id:s02-cancel'] },
  { key: 's02-fail', native: [], web: ['id:s02-fail'] },
  { key: 's02-fail-cancel', native: [], web: ['id:s02-fail-cancel'] },
  { key: 's02-retry', native: [], web: ['id:s02-retry'] },
];
