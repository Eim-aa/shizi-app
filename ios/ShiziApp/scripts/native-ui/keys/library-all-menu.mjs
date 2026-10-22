// library-all-menu 的语义键（B3.3 从网页参考生成，状态：all-menu）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'all-menu', native: [], web: ['id:all-menu'] },
  { key: 'sheet-head', native: [], web: ['id:sheet-head'] },
  { key: 'sheet-done', native: [], web: ['id:sheet-done'] },
  { key: 'all-sorts', native: [], web: ['id:all-sorts'] },
  { key: 'all-sort', native: [], web: ['id:all-sort'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-chips', native: [], web: ['id:all-chips'] },
  { key: 'all-chip', native: [], web: ['id:all-chip'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-legend', native: [], web: ['id:library-legend'] },
  { key: 'library-legend-tone', native: [], web: ['id:library-legend-tone'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-legend-wrong', native: [], web: ['id:library-legend-wrong'] },
  { key: 'library-legend-hollow', native: [], web: ['id:library-legend-hollow'] },
  { key: 'all-note', native: [], web: ['id:all-note'] },
];
