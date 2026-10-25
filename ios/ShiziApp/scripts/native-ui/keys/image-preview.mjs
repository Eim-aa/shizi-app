// image-preview 的语义键（B3.3 从网页参考生成，状态：preview-1x1、preview-3x4、preview-add、preview-annual-book、preview-annual-long、preview-fail、preview-paged、preview-saved、preview-saving）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'image-sheet', native: ['id:native-image-sheet'], web: ['id:image-sheet'] },
  { key: 'image-title', native: ['id:native-image-title'], web: ['id:image-title'] }, // 弹层标题：底页（月字帖页）标题与它同名，靠 testid 配对
  { key: 'image-done', native: ['id:native-image-done'], web: ['id:image-done'] },
  { key: 'image-preview', native: ['id:native-image-preview'], web: ['id:image-preview'] },
  { key: 'image-stage', native: ['id:native-image-stage'], web: ['id:image-stage'] },
  { key: 'image-board', native: ['id:native-image-board'], web: ['id:image-board'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-canvas', native: ['id:native-image-canvas'], web: ['id:image-canvas'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-ratio', native: ['id:native-image-ratio'], web: ['id:image-ratio'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-chips', native: ['id:native-image-chips'], web: ['id:image-chips'] },
  { key: 'image-chip', native: ['id:native-image-chip'], web: ['id:image-chip'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-share', native: ['id:native-image-share'], web: ['id:image-share'] },
  { key: 'image-save', native: ['id:native-image-save'], web: ['id:image-save'] },
  { key: 'image-pager', native: ['id:native-image-pager'], web: ['id:image-pager'] },
  { key: 'image-dot', native: ['id:native-image-dot'], web: ['id:image-dot'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-note', native: ['id:native-image-note'], web: ['id:image-note'] },
  { key: 'image-long', native: ['id:native-image-long'], web: ['id:image-long'] },
  { key: 'image-fail', native: ['id:native-image-fail'], web: ['id:image-fail'] },
  { key: 'image-fail-note', native: ['id:native-image-fail-note'], web: ['id:image-fail-note'] },
  { key: 'image-fail-cancel', native: ['id:native-image-fail-cancel'], web: ['id:image-fail-cancel'] },
  { key: 'image-retry', native: ['id:native-image-retry'], web: ['id:image-retry'] },
];
