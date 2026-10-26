// library-list 的语义键（B3.8 原生化后填；状态：list-due、list-empty、list-folded、list-known、list-none-selected、list-shaky、list-skipped）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生 accessibilityIdentifier（id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'list-screen', native: ['id:native-library-list-screen'], web: ['id:list-screen'] },
  { key: 'list-toggle-all', native: ['id:native-library-list-toggle-all'], web: ['id:list-toggle-all'] },
  { key: 'list-body', native: ['id:native-library-list-body'], web: ['id:list-body'] },
  { key: 'list-head', native: ['id:native-library-list-head'], web: ['id:list-head'] },
  { key: 'list-top', native: ['id:native-library-list-top'], web: ['id:list-top'] },
  { key: 'list-rows', native: ['id:native-library-list-rows'], web: ['id:list-rows'] },
  { key: 'list-row', native: ['id:native-library-list-row'], web: ['id:list-row'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'list-row-select', native: ['id:native-library-list-row-select'], web: ['id:list-row-select'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'list-row-open', native: ['id:native-library-list-row-open'], web: ['id:list-row-open'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'list-note', native: ['id:native-library-list-note'], web: ['id:list-note'] },
  { key: 'list-hint', native: ['id:native-library-list-hint'], web: ['id:list-hint'] },
  { key: 'list-go-live', native: [], web: ['id:list-go-live'] }, // 网页的常驻播报区（1 × 1，只给读屏）；原生这边不单独建
  { key: 'list-go', native: ['id:native-library-list-go'], web: ['id:list-go'] },
  { key: 'list-empty', native: ['id:native-library-list-empty'], web: ['id:list-empty'] },
  { key: 'list-empty-glyph', native: ['id:native-library-list-empty-glyph'], web: ['id:list-empty-glyph'] },
  { key: 'list-empty-title', native: ['id:native-library-list-empty-title'], web: ['id:list-empty-title'] },
  { key: 'list-empty-body', native: ['id:native-library-list-empty-body'], web: ['id:list-empty-body'] },
  { key: 'list-rest-toggle', native: ['id:native-library-list-rest'], web: ['id:list-rest-toggle'] },
  { key: 'list-start-fail', native: ['id:native-library-list-fail'], web: ['id:list-start-failure'] },
  { key: 'list-start-fail-note', native: ['id:native-library-list-fail-note'], web: ['id:list-start-fail'] },
  { key: 'list-start-cancel', native: ['id:native-library-list-fail-cancel'], web: ['id:list-start-cancel'] },
  { key: 'list-start-fail-retry', native: ['id:native-library-list-fail-retry'], web: ['id:list-go'] },
];
