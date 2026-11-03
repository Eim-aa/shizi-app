// mine-group-size 的语义键（状态：mine-choice-fail、mine-choice-sheet）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'mine-group-size-sheet', native: ['id:native-mine-group-size-sheet'] },
  { key: 'mine-group-size-sheet-option', native: ['id:native-mine-group-size-sheet-option'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-group-size-sheet-fail', native: ['id:native-mine-group-size-sheet-fail'] },
  { key: 'mine-group-size-sheet-fail-note', native: ['id:native-mine-group-size-sheet-fail-note'] },
  { key: 'mine-group-size-sheet-fail-cancel', native: ['id:native-mine-group-size-sheet-fail-cancel'] },
  { key: 'mine-group-size-sheet-fail-retry', native: ['id:native-mine-group-size-sheet-fail-retry'] },
];
