// undo-bar 的语义键（B3.3 从网页参考生成，状态：backup-clear-undo、backup-restore-undo）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
//
// 网页的撤销条有两层：外层 data-testid="backup-undo"（只占位）、内层 data-testid="undo-bar"（浮条本体）。
// 内层的 data-testid 在语义键表里先命中 keys/detail.mjs 的 detail-undo-bar（同一个 data-testid），
// 所以原生这一层用同一个键名配对（web 侧不重复登记）。
export const KEYS = [
  { key: 'backup-undo', native: ['id:native-backup-undo'], web: ['id:backup-undo'] },
  { key: 'detail-undo-bar', native: ['id:native-backup-undo-bar'], web: [] },
  { key: 'undo-button', native: ['id:native-backup-undo-button'], web: ['id:undo-button'] },
];
