// library-list 的语义键（B3.3 从网页参考生成，状态：list-due、list-empty、list-folded、list-known、list-none-selected、list-shaky、list-skipped）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'list-screen', native: [], web: ['id:list-screen'] },
  { key: 'list-toggle-all', native: [], web: ['id:list-toggle-all'] },
  { key: 'list-body', native: [], web: ['id:list-body'] },
  { key: 'list-head', native: [], web: ['id:list-head'] },
  { key: 'list-top', native: [], web: ['id:list-top'] },
  { key: 'list-rows', native: [], web: ['id:list-rows'] },
  { key: 'list-row', native: [], web: ['id:list-row'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'list-row-select', native: [], web: ['id:list-row-select'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'list-row-open', native: [], web: ['id:list-row-open'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'list-note', native: [], web: ['id:list-note'] },
  { key: 'list-hint', native: [], web: ['id:list-hint'] },
  { key: 'list-go-live', native: [], web: ['id:list-go-live'] },
  { key: 'list-go', native: [], web: ['id:list-go'] },
  { key: 'list-empty', native: [], web: ['id:list-empty'] },
  { key: 'list-empty-glyph', native: [], web: ['id:list-empty-glyph'] },
  { key: 'list-empty-title', native: [], web: ['id:list-empty-title'] },
  { key: 'list-empty-body', native: [], web: ['id:list-empty-body'] },
];
