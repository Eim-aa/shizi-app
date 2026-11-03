// library-all-menu 的语义键（B3.8 原生化后填；状态：all-menu）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 原生这边是呈现出来的底部弹层（网页那边是遮罩栈里的一层）。
export const KEYS = [
  { key: 'all-menu', native: ['id:native-library-all-menu'] },
  { key: 'sheet-head', native: ['id:native-library-all-sheet-head'] }, // 网页 Sheet.js 共用（R16：只在原生有对应元素的屏算键）
  { key: 'sheet-done', native: ['id:native-library-all-sheet-done'] },
  { key: 'all-sorts', native: ['id:native-library-all-sorts'] },
  { key: 'all-sort', native: ['id:native-library-all-sort'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-chips', native: ['id:native-library-all-chips'] },
  { key: 'all-chip', native: ['id:native-library-all-chip'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-legend', native: ['id:native-library-all-legend'] },
  { key: 'library-legend-tone', native: ['id:native-library-all-legend-tone'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-legend-wrong', native: ['id:native-library-all-legend-wrong'] },
  { key: 'library-legend-hollow', native: ['id:native-library-all-legend-hollow'] },
  { key: 'all-note', native: ['id:native-library-all-note'] },
];
