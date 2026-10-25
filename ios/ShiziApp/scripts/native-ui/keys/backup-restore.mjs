// backup-restore 的语义键（B3.3 从网页参考生成，状态：backup-restore-confirm）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'backup-restore-confirm', native: ['id:native-backup-restore-confirm'], web: ['id:backup-restore-confirm'] },
  { key: 'backup-restore-confirm-title', native: ['id:native-backup-restore-title'], web: ['id:backup-restore-confirm-title'] },
  { key: 'backup-restore-confirm-body', native: ['id:native-backup-restore-body'], web: ['id:backup-restore-confirm-body'] },
  { key: 'backup-restore-confirm-loss', native: ['id:native-backup-restore-loss'], web: ['id:backup-restore-confirm-loss'] },
  { key: 'backup-restore-cancel', native: ['id:native-backup-restore-cancel'], web: ['id:backup-restore-cancel'] },
  { key: 'backup-restore-ok', native: ['id:native-backup-restore-ok'], web: ['id:backup-restore-ok'] },
];
