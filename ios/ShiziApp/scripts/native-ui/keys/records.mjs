// records 的语义键（B3.3 从网页参考生成，状态：records-day、records-empty、records-month）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'records-screen', native: ['id:native-records-screen'], web: ['id:records-screen'] },
  { key: 'records-body', native: ['id:native-records-body'], web: ['id:records-body'] },
  { key: 'records-month', native: ['id:native-records-month'], web: ['id:records-month'] },
  { key: 'records-year', native: ['id:native-records-year'], web: ['id:records-year'] },
  { key: 'records-prev', native: ['id:native-records-prev'], web: ['id:records-prev'] },
  { key: 'records-next', native: ['id:native-records-next'], web: ['id:records-next'] },
  { key: 'records-title', native: ['id:native-records-title'], web: ['id:records-title'] },
  { key: 'records-legend', native: ['id:native-records-legend'], web: ['id:records-legend'] },
  { key: 'records-calendar', native: ['id:native-records-calendar'], web: ['id:records-calendar'] },
  { key: 'records-weekday', native: ['id:native-records-weekday'], web: ['id:records-weekday'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'records-day', native: ['id:native-records-day'], web: ['id:records-day'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'records-daylist', native: ['id:native-records-daylist'], web: ['id:records-daylist'] },
  { key: 'records-daylist-title', native: ['id:native-records-daylist-title'], web: ['id:records-daylist-title'] },
  { key: 'records-daylist-grid', native: ['id:native-records-daylist-grid'], web: ['id:records-daylist-grid'] },
  { key: 'records-daylist-cell', native: ['id:native-records-daylist-cell'], web: ['id:records-daylist-cell'] },
  { key: 'records-sheet', native: ['id:native-records-sheet'], web: ['id:records-sheet'] },
  { key: 'records-sheet-title', native: ['id:native-records-sheet-title'], web: ['id:records-sheet-title'] },
  { key: 'records-sheet-open', native: ['id:native-records-sheet-open'], web: ['id:records-sheet-open'] },
  { key: 'records-sheet-save', native: ['id:native-records-sheet-save'], web: ['id:records-sheet-save'] },
  { key: 'records-sheet-grid', native: ['id:native-records-sheet-grid'], web: ['id:records-sheet-grid'] },
  { key: 'records-sheet-cell', native: ['id:native-records-sheet-cell'], web: ['id:records-sheet-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  // 纸里的落款行、印与说明句：网页这一块与月字帖页共用 MonthBody（testid 就是 month-sign / month-seal / month-note），
  // 语义键已在 keys/month.mjs（month-sign / month-seal）与 keys/mine.mjs（month-note）占过，原生这边用同一套 id
  // （native-month-sign / native-month-seal / native-month-note），不再另起键名。
];
