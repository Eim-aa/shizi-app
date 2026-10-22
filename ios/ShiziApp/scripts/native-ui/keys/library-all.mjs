// library-all 的语义键（B3.3 从网页参考生成，状态：all-filter、all-find、all-month、all-pinyin）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'all-screen', native: [], web: ['id:all-screen'] },
  { key: 'all-menu-open', native: [], web: ['id:all-menu-open'] },
  { key: 'all-body', native: [], web: ['id:all-body'] },
  { key: 'all-find', native: [], web: ['id:all-find'] },
  { key: 'all-group', native: [], web: ['id:all-group'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-cells', native: [], web: ['id:all-cells'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-cell', native: [], web: ['id:all-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-list', native: [], web: ['id:all-list'] },
  { key: 'all-go', native: [], web: ['id:all-go'] },
  { key: 'all-find-where', native: [], web: ['id:all-find-where'] },
  { key: 'all-group-head', native: [], web: ['id:all-group-head'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-group-name', native: [], web: ['id:all-group-name'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-group-count', native: [], web: ['id:all-group-count'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-closed', native: [], web: ['id:all-closed'] },
  { key: 'all-month', native: [], web: ['id:all-month'] },
];
