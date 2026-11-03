// backup 的语义键（状态：backup-fail、backup-none、backup-recent、backup-reject、backup-stale）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'backup-screen', native: ['id:native-backup-screen'] },
  { key: 'backup-body', native: ['id:native-backup-body'] },
  { key: 'backup-status', native: ['id:native-backup-status'] },
  { key: 'backup-last-label', native: ['id:native-backup-last-label'] },
  { key: 'backup-last-date', native: ['id:native-backup-last-date'] },
  { key: 'backup-intro', native: ['id:native-backup-intro'] },
  { key: 'backup-list', native: ['id:native-backup-list'] },
  { key: 'backup-restore', native: ['id:native-backup-restore'] },
  { key: 'backup-clear', native: ['id:native-backup-clear'] },
  { key: 'backup-export', native: ['id:native-backup-export'] },
  { key: 'backup-clear-sheet', native: ['id:native-backup-clear-sheet'] },
  { key: 'backup-clear-body', native: ['id:native-backup-clear-body'] },
  { key: 'backup-clear-stay', native: ['id:native-backup-clear-stay'] },
  { key: 'backup-clear-retry', native: ['id:native-backup-clear-retry'] },
  { key: 'backup-status-note', native: ['id:native-backup-status-note'] },
  { key: 'backup-note', native: ['id:native-backup-note'] },
  // 网页撤销条（UndoBar 组件）的内层浮条本体与「撤销」按钮：data-testid 是组件级的（详情页也用），
  // 详情页那张表（keys/detail.mjs）先登记过这两个 testid。语义键全局唯一，不能重复登记，
  // 所以这里用备份页自己的键名认领：keys/backup.mjs 按文件名排在 detail.mjs 之前，先命中。
  { key: 'backup-undo-bar', native: ['id:native-backup-undo-bar'] },
  { key: 'backup-undo-button', native: ['id:native-backup-undo-button'] },
];
