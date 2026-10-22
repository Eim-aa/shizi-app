// records 的语义键（B3.3 从网页参考生成，状态：records-day、records-empty、records-month）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'records-screen', native: [], web: ['id:records-screen'] },
  { key: 'records-body', native: [], web: ['id:records-body'] },
  { key: 'records-month', native: [], web: ['id:records-month'] },
  { key: 'records-year', native: [], web: ['id:records-year'] },
  { key: 'records-prev', native: [], web: ['id:records-prev'] },
  { key: 'records-next', native: [], web: ['id:records-next'] },
  { key: 'records-title', native: [], web: ['id:records-title'] },
  { key: 'records-legend', native: [], web: ['id:records-legend'] },
  { key: 'records-calendar', native: [], web: ['id:records-calendar'] },
  { key: 'records-weekday', native: [], web: ['id:records-weekday'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'records-day', native: [], web: ['id:records-day'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'records-daylist', native: [], web: ['id:records-daylist'] },
  { key: 'records-daylist-title', native: [], web: ['id:records-daylist-title'] },
  { key: 'records-daylist-grid', native: [], web: ['id:records-daylist-grid'] },
  { key: 'records-daylist-cell', native: [], web: ['id:records-daylist-cell'] },
  { key: 'records-sheet', native: [], web: ['id:records-sheet'] },
  { key: 'records-sheet-title', native: [], web: ['id:records-sheet-title'] },
  { key: 'records-sheet-open', native: [], web: ['id:records-sheet-open'] },
  { key: 'records-sheet-save', native: [], web: ['id:records-sheet-save'] },
  { key: 'records-sheet-grid', native: [], web: ['id:records-sheet-grid'] },
  { key: 'records-sheet-cell', native: [], web: ['id:records-sheet-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
];
