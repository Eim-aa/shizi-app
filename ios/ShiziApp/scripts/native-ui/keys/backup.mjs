// backup 的语义键（B3.3 从网页参考生成，状态：backup-fail、backup-none、backup-recent、backup-reject、backup-stale）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'backup-screen', native: ['id:native-backup-screen'], web: ['id:backup-screen'] },
  { key: 'backup-body', native: ['id:native-backup-body'], web: ['id:backup-body'] },
  { key: 'backup-status', native: ['id:native-backup-status'], web: ['id:backup-status'] },
  { key: 'backup-last-label', native: ['id:native-backup-last-label'], web: ['id:backup-last-label'] },
  { key: 'backup-last-date', native: ['id:native-backup-last-date'], web: ['id:backup-last-date'] },
  { key: 'backup-intro', native: ['id:native-backup-intro'], web: ['id:backup-intro'] },
  { key: 'backup-list', native: ['id:native-backup-list'], web: ['id:backup-list'] },
  { key: 'backup-restore', native: ['id:native-backup-restore'], web: ['id:backup-restore'] },
  { key: 'backup-clear', native: ['id:native-backup-clear'], web: ['id:backup-clear'] },
  { key: 'backup-export', native: ['id:native-backup-export'], web: ['id:backup-export'] },
  { key: 'backup-clear-sheet', native: ['id:native-backup-clear-sheet'], web: ['id:backup-clear-sheet'] },
  { key: 'backup-clear-body', native: ['id:native-backup-clear-body'], web: ['id:backup-clear-body'] },
  { key: 'backup-clear-stay', native: ['id:native-backup-clear-stay'], web: ['id:backup-clear-stay'] },
  { key: 'backup-clear-retry', native: ['id:native-backup-clear-retry'], web: ['id:backup-clear-retry'] },
  { key: 'backup-status-note', native: ['id:native-backup-status-note'], web: ['id:backup-status-note'] },
  { key: 'backup-note', native: ['id:native-backup-note'], web: ['id:backup-note'] },
];
