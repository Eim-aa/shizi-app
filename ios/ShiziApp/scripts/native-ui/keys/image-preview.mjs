// image-preview 的语义键（B3.3 从网页参考生成，状态：preview-1x1、preview-3x4、preview-add、preview-annual-book、preview-annual-long、preview-fail、preview-paged、preview-saved、preview-saving）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'result-screen', native: [], web: ['id:result-screen'] },
  { key: 'result-body', native: [], web: ['id:result-body'] },
  { key: 'work-grid', native: [], web: ['id:work-grid'] },
  { key: 'work-sheet', native: [], web: ['id:work-sheet'] },
  { key: 'work-sign', native: [], web: ['id:work-sign'] },
  { key: 'work-kuan', native: [], web: ['id:work-kuan'] },
  { key: 'result-excluded', native: [], web: ['id:result-excluded'] },
  { key: 'result-exrow', native: [], web: ['id:result-exrow'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'result-exrow-change', native: [], web: ['id:result-exrow-change'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'result-add', native: [], web: ['id:result-add'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'result-live', native: [], web: ['id:result-live'] },
  { key: 'result-redo', native: [], web: ['id:result-redo'] },
  { key: 'image-sheet', native: [], web: ['id:image-sheet'] },
  { key: 'image-done', native: [], web: ['id:image-done'] },
  { key: 'image-preview', native: [], web: ['id:image-preview'] },
  { key: 'image-stage', native: [], web: ['id:image-stage'] },
  { key: 'image-board', native: [], web: ['id:image-board'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-canvas', native: [], web: ['id:image-canvas'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-ratio', native: [], web: ['id:image-ratio'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-chips', native: [], web: ['id:image-chips'] },
  { key: 'image-chip', native: [], web: ['id:image-chip'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-share', native: [], web: ['id:image-share'] },
  { key: 'image-save', native: [], web: ['id:image-save'] },
  { key: 'image-pager', native: [], web: ['id:image-pager'] },
  { key: 'image-dot', native: [], web: ['id:image-dot'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'image-note', native: [], web: ['id:image-note'] },
  { key: 'image-long', native: [], web: ['id:image-long'] },
  { key: 'image-fail', native: [], web: ['id:image-fail'] },
  { key: 'image-fail-note', native: [], web: ['id:image-fail-note'] },
  { key: 'image-fail-cancel', native: [], web: ['id:image-fail-cancel'] },
  { key: 'image-retry', native: [], web: ['id:image-retry'] },
];
