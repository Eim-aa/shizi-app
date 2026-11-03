// library-list 的语义键（B3.8 原生化后填；状态：list-due、list-empty、list-folded、list-known、list-none-selected、list-shaky、list-skipped）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'list-screen', native: ['id:native-library-list-screen'] },
  { key: 'list-toggle-all', native: ['id:native-library-list-toggle-all'] },
  { key: 'list-body', native: ['id:native-library-list-body'] },
  { key: 'list-head', native: ['id:native-library-list-head'] },
  { key: 'list-top', native: ['id:native-library-list-top'] },
  { key: 'list-rows', native: ['id:native-library-list-rows'] },
  { key: 'list-row', native: ['id:native-library-list-row'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'list-row-select', native: ['id:native-library-list-row-select'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'list-row-open', native: ['id:native-library-list-row-open'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'list-note', native: ['id:native-library-list-note'] },
  { key: 'list-hint', native: ['id:native-library-list-hint'] },
  { key: 'list-go', native: ['id:native-library-list-go'] },
  { key: 'list-empty', native: ['id:native-library-list-empty'] },
  { key: 'list-empty-glyph', native: ['id:native-library-list-empty-glyph'] },
  { key: 'list-empty-title', native: ['id:native-library-list-empty-title'] },
  { key: 'list-empty-body', native: ['id:native-library-list-empty-body'] },
  { key: 'list-rest-toggle', native: ['id:native-library-list-rest'] },
  { key: 'list-start-fail', native: ['id:native-library-list-fail'] },
  { key: 'list-start-fail-note', native: ['id:native-library-list-fail-note'] },
  { key: 'list-start-cancel', native: ['id:native-library-list-fail-cancel'] },
  { key: 'list-start-fail-retry', native: ['id:native-library-list-fail-retry'] },
];
