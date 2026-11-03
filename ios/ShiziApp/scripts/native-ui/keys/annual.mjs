// annual 的语义键（状态：annual-empty、annual-past-year、annual-report）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'annual-screen', native: ['id:native-annual-screen'] },
  { key: 'annual-body', native: ['id:native-annual-body'] },
  { key: 'annual-empty', native: ['id:native-annual-empty'] },
  { key: 'annual-empty-glyph', native: ['id:native-annual-empty-glyph'] },
  { key: 'annual-empty-title', native: ['id:native-annual-empty-title'] },
  { key: 'annual-empty-body', native: ['id:native-annual-empty-body'] },
  { key: 'annual-adjust', native: ['id:native-annual-adjust'] },
  { key: 'annual-year', native: ['id:native-annual-year'] },
  { key: 'annual-head', native: ['id:native-annual-head'] },
  { key: 'annual-first', native: ['id:native-annual-first'] },
  { key: 'annual-first-cell', native: ['id:native-annual-first-cell'] },
  { key: 'annual-first-canvas', native: ['id:native-annual-first-canvas'] },
  { key: 'annual-first-label', native: ['id:native-annual-first-label'] },
  { key: 'annual-first-date', native: ['id:native-annual-first-date'] },
  { key: 'annual-month', native: ['id:native-annual-month'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'annual-twice-first', native: ['id:native-annual-twice-first'] },
  { key: 'annual-twice-last', native: ['id:native-annual-twice-last'] },
  { key: 'annual-twice-date', native: ['id:native-annual-twice-date'] }, // 两个：按文档顺序配对
  { key: 'annual-save-live', native: ['id:native-annual-save-live'] },
  { key: 'annual-save', native: ['id:native-annual-save'] },
  { key: 'annual-prev', native: ['id:native-annual-prev'] },
  { key: 'annual-next', native: ['id:native-annual-next'] },
];
