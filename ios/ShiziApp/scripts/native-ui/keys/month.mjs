// month 的语义键（B3.3 从网页参考生成，状态：month-ax5、month-ink、month-under）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'month-screen', native: [], web: ['id:month-screen'] },
  { key: 'month-adjust', native: [], web: ['id:month-adjust'] },
  { key: 'month-body', native: [], web: ['id:month-body'] },
  { key: 'month-title', native: [], web: ['id:month-title'] },
  { key: 'month-sub', native: [], web: ['id:month-sub'] },
  { key: 'month-paper', native: [], web: ['id:month-paper'] },
  { key: 'month-cell', native: [], web: ['id:month-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'month-seal', native: [], web: ['id:month-seal'] },
  { key: 'month-sign', native: [], web: ['id:month-sign'] },
  { key: 'month-kuan', native: [], web: ['id:month-kuan'] },
  { key: 'month-save-live', native: [], web: ['id:month-save-live'] },
  { key: 'month-share-btn', native: [], web: ['id:month-share-btn'] },
  { key: 'month-save', native: [], web: ['id:month-save'] },
];
