// library-all-menu 的语义键（B3.8 原生化后填；状态：all-menu）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生 accessibilityIdentifier（id:）。
// 原生这边是呈现出来的底部弹层（网页那边是遮罩栈里的一层）。
export const KEYS = [
  { key: 'all-menu', native: ['id:native-library-all-menu'], web: ['id:all-menu'] },
  { key: 'sheet-head', native: ['id:native-library-all-sheet-head'], web: ['id:sheet-head'], shared: true }, // 网页 Sheet.js 共用（R16：只在原生有对应元素的屏算键）
  { key: 'sheet-done', native: ['id:native-library-all-sheet-done'], web: ['id:sheet-done'], shared: true },
  { key: 'all-sorts', native: ['id:native-library-all-sorts'], web: ['id:all-sorts'] },
  { key: 'all-sort', native: ['id:native-library-all-sort'], web: ['id:all-sort'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-chips', native: ['id:native-library-all-chips'], web: ['id:all-chips'] },
  { key: 'all-chip', native: ['id:native-library-all-chip'], web: ['id:all-chip'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-legend', native: ['id:native-library-all-legend'], web: ['id:library-legend'] },
  { key: 'library-legend-tone', native: ['id:native-library-all-legend-tone'], web: ['id:library-legend-tone'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-legend-wrong', native: ['id:native-library-all-legend-wrong'], web: ['id:library-legend-wrong'] },
  { key: 'library-legend-hollow', native: ['id:native-library-all-legend-hollow'], web: ['id:library-legend-hollow'] },
  { key: 'all-note', native: ['id:native-library-all-note'], web: ['id:all-note'] },
];
