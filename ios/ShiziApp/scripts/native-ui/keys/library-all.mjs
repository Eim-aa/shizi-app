// library-all 的语义键（B3.8 原生化后填；状态：all-filter、all-find、all-month、all-pinyin）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生 accessibilityIdentifier（id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'all-screen', native: ['id:native-library-all-screen'], web: ['id:all-screen'] },
  { key: 'all-menu-open', native: ['id:native-library-all-menu-open'], web: ['id:all-menu-open'] },
  { key: 'all-body', native: ['id:native-library-all-body'], web: ['id:all-body'] },
  { key: 'all-find', native: ['id:native-library-all-find'], web: ['id:all-find'] },
  { key: 'all-group', native: ['id:native-library-all-group'], web: ['id:all-group'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-cells', native: ['id:native-library-all-cells'], web: ['id:all-cells'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-cell', native: ['id:native-library-all-cell'], web: ['id:all-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-list', native: ['id:native-library-all-list'], web: ['id:all-list'] },
  { key: 'all-go', native: ['id:native-library-all-go'], web: ['id:all-go'] },
  { key: 'all-find-where', native: ['id:native-library-all-find-where'], web: ['id:all-find-where'] },
  { key: 'all-group-head', native: ['id:native-library-all-group-head'], web: ['id:all-group-head'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-group-name', native: ['id:native-library-all-group-name'], web: ['id:all-group-name'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-group-count', native: ['id:native-library-all-group-count'], web: ['id:all-group-count'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'all-closed', native: ['id:native-library-all-closed'], web: ['id:all-closed'] },
  { key: 'all-month', native: ['id:native-library-all-month'], web: ['id:all-month'] },
  { key: 'all-start-fail', native: ['id:native-library-all-fail'], web: ['id:all-start-failure'] },
  { key: 'all-start-fail-note', native: ['id:native-library-all-fail-note'], web: ['id:all-start-fail'] },
  { key: 'all-start-cancel', native: ['id:native-library-all-fail-cancel'], web: ['id:all-start-cancel'] },
  { key: 'all-start-fail-retry', native: ['id:native-library-all-fail-retry'], web: ['id:all-go'] },
];
