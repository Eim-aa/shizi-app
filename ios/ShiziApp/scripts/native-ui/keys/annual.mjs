// annual 的语义键（B3.3 从网页参考生成，状态：annual-empty、annual-past-year、annual-report）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'annual-screen', native: ['id:native-annual-screen'], web: ['id:annual-screen'] },
  { key: 'annual-body', native: ['id:native-annual-body'], web: ['id:annual-body'] },
  { key: 'annual-empty', native: ['id:native-annual-empty'], web: ['id:annual-empty'] },
  { key: 'annual-empty-glyph', native: ['id:native-annual-empty-glyph'], web: ['id:annual-empty-glyph'] },
  { key: 'annual-empty-title', native: ['id:native-annual-empty-title'], web: ['id:annual-empty-title'] },
  { key: 'annual-empty-body', native: ['id:native-annual-empty-body'], web: ['id:annual-empty-body'] },
  { key: 'annual-adjust', native: ['id:native-annual-adjust'], web: ['id:annual-adjust'] },
  { key: 'annual-year', native: ['id:native-annual-year'], web: ['id:annual-year'] },
  { key: 'annual-head', native: ['id:native-annual-head'], web: ['id:annual-head'] },
  { key: 'annual-first', native: ['id:native-annual-first'], web: ['id:annual-first'] },
  { key: 'annual-first-cell', native: ['id:native-annual-first-cell'], web: ['id:annual-first-cell'] },
  { key: 'annual-first-canvas', native: ['id:native-annual-first-canvas'], web: ['id:annual-first-canvas'] },
  { key: 'annual-first-label', native: ['id:native-annual-first-label'], web: ['id:annual-first-label'] },
  { key: 'annual-first-date', native: ['id:native-annual-first-date'], web: ['id:annual-first-date'] },
  { key: 'annual-month', native: ['id:native-annual-month'], web: ['id:annual-month'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'annual-save-live', native: ['id:native-annual-save-live'], web: ['id:annual-save-live'] },
  { key: 'annual-save', native: ['id:native-annual-save'], web: ['id:annual-save'] },
  { key: 'annual-prev', native: ['id:native-annual-prev'], web: ['id:annual-prev'] },
  { key: 'annual-next', native: ['id:native-annual-next'], web: ['id:annual-next'] },
];
