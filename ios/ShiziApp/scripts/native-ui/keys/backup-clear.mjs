// backup-clear 的语义键（状态：backup-clear-sheet）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'backup-clear-cancel', native: ['id:native-backup-clear-cancel'] },
  { key: 'backup-clear-ok', native: ['id:native-backup-clear-ok'] },
];
