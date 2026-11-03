// backup-restore 的语义键（状态：backup-restore-confirm）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'backup-restore-confirm', native: ['id:native-backup-restore-confirm'] },
  { key: 'backup-restore-confirm-title', native: ['id:native-backup-restore-title'] },
  { key: 'backup-restore-confirm-body', native: ['id:native-backup-restore-body'] },
  { key: 'backup-restore-confirm-loss', native: ['id:native-backup-restore-loss'] },
  { key: 'backup-restore-cancel', native: ['id:native-backup-restore-cancel'] },
  { key: 'backup-restore-ok', native: ['id:native-backup-restore-ok'] },
];
