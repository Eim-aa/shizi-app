// image-preview 的语义键（状态：preview-1x1、preview-3x4、preview-add、preview-annual-book、preview-annual-long、preview-fail、preview-paged、preview-saved、preview-saving）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'image-sheet', native: ['id:native-image-sheet'] },
  { key: 'image-title', native: ['id:native-image-title'] }, // 弹层标题：底页（月字帖页）标题与它同名，靠 testid 配对
  { key: 'image-done', native: ['id:native-image-done'] },
  { key: 'image-preview', native: ['id:native-image-preview'] },
  { key: 'image-stage', native: ['id:native-image-stage'] },
  { key: 'image-board', native: ['id:native-image-board'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-canvas', native: ['id:native-image-canvas'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-ratio', native: ['id:native-image-ratio'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-chips', native: ['id:native-image-chips'] },
  { key: 'image-chip', native: ['id:native-image-chip'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-share', native: ['id:native-image-share'] },
  { key: 'image-save', native: ['id:native-image-save'] },
  { key: 'image-pager', native: ['id:native-image-pager'] },
  { key: 'image-dot', native: ['id:native-image-dot'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-note', native: ['id:native-image-note'] },
  { key: 'image-long', native: ['id:native-image-long'] },
  { key: 'image-fail', native: ['id:native-image-fail'] },
  { key: 'image-fail-note', native: ['id:native-image-fail-note'] },
  { key: 'image-fail-cancel', native: ['id:native-image-fail-cancel'] },
  { key: 'image-retry', native: ['id:native-image-retry'] },
];
