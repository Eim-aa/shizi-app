// remind 的语义键（B3.3 从网页参考生成，状态：remind-denied、remind-fail、remind-off、remind-on）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'remind-screen', native: [], web: ['id:remind-screen'] },
  { key: 'remind-body', native: [], web: ['id:remind-body'] },
  { key: 'remind-switch', native: [], web: ['id:remind-switch'] },
  { key: 'remind-time', native: [], web: ['id:remind-time'] },
  { key: 'remind-fail', native: [], web: ['id:remind-fail'] },
  { key: 'remind-fail-note', native: [], web: ['id:remind-fail-note'] },
  { key: 'remind-fail-cancel', native: [], web: ['id:remind-fail-cancel'] },
  { key: 'remind-fail-retry', native: [], web: ['id:remind-fail-retry'] },
];
