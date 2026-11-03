// month 的语义键（状态：month-ax5、month-ink、month-under）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'month-screen', native: ['id:native-month-screen'] },
  { key: 'month-adjust', native: ['id:native-month-adjust'] },
  { key: 'month-body', native: ['id:native-month-body'] },
  { key: 'month-title', native: ['id:native-month-title'] },
  { key: 'month-sub', native: ['id:native-month-sub'] },
  { key: 'month-paper', native: ['id:native-month-paper'] },
  { key: 'month-cell', native: ['id:native-month-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'month-seal', native: ['id:native-month-seal'] },
  { key: 'month-sign', native: ['id:native-month-sign'] },
  { key: 'month-kuan', native: ['id:native-month-kuan'] },
  { key: 'month-save-live', native: ['id:native-month-save-live'] },
  { key: 'month-share-btn', native: ['id:native-month-share-btn'] },
  { key: 'month-save', native: ['id:native-month-save'] },
  // 说明句：网页的 testid 是 month-note（「我的」页那块字帖的说明句同名，语义键已在 keys/mine.mjs 占过），这里另起一个键名避免重复。
  { key: 'month-page-note', native: ['id:native-month-note'] },
];
