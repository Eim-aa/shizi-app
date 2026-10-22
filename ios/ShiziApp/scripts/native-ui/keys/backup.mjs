// backup 的语义键（B3.3 从网页参考生成，状态：backup-fail、backup-none、backup-recent、backup-reject、backup-stale）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'backup-screen', native: [], web: ['id:backup-screen'] },
  { key: 'backup-body', native: [], web: ['id:backup-body'] },
  { key: 'backup-status', native: [], web: ['id:backup-status'] },
  { key: 'backup-last-label', native: [], web: ['id:backup-last-label'] },
  { key: 'backup-last-date', native: [], web: ['id:backup-last-date'] },
  { key: 'backup-intro', native: [], web: ['id:backup-intro'] },
  { key: 'backup-list', native: [], web: ['id:backup-list'] },
  { key: 'backup-restore', native: [], web: ['id:backup-restore'] },
  { key: 'backup-clear', native: [], web: ['id:backup-clear'] },
  { key: 'backup-export', native: [], web: ['id:backup-export'] },
  { key: 'backup-clear-sheet', native: [], web: ['id:backup-clear-sheet'] },
  { key: 'backup-clear-body', native: [], web: ['id:backup-clear-body'] },
  { key: 'backup-clear-stay', native: [], web: ['id:backup-clear-stay'] },
  { key: 'backup-clear-retry', native: [], web: ['id:backup-clear-retry'] },
  { key: 'backup-status-note', native: [], web: ['id:backup-status-note'] },
  { key: 'backup-note', native: [], web: ['id:backup-note'] },
];
