// undo-bar 的语义键（B3.3 从网页参考生成，状态：backup-clear-undo、backup-restore-undo）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
//
// 网页的撤销条有两层：外层 data-testid="backup-undo"（只占位）、内层 data-testid="undo-bar"（浮条本体，网页共享组件）。
// 内层两个（undo-bar / undo-button）在 keys/backup.mjs 里用备份页自己的键名认领（语义键全局唯一，不能重复登记）。
export const KEYS = [
  { key: 'backup-undo', native: ['id:native-backup-undo'], web: ['id:backup-undo'] },
];
