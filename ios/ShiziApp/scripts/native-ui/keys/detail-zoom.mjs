// detail-zoom 的语义键（状态：detail-zoom-fail、detail-zoom-ink、detail-zoom-noink）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'detail-zoom', native: ['id:native-detail-zoom'] },
  { key: 'detail-zoom-close', native: ['id:native-detail-zoom-close'] },
  { key: 'detail-zoom-ink', native: ['id:native-detail-zoom-ink'] },
  { key: 'detail-zoom-note', native: ['id:native-detail-zoom-note'] },
  { key: 'detail-zoom-fail', native: ['id:native-detail-zoom-fail'] },
  { key: 'detail-zoom-fail-cancel', native: ['id:native-detail-zoom-fail-cancel'] },
  { key: 'detail-zoom-fail-retry', native: ['id:native-detail-zoom-fail-retry'] },
  { key: 'detail-zoom-flip', native: ['id:native-detail-zoom-flip'] },
  { key: 'detail-zoom-noink', native: ['id:native-detail-zoom-noink'] },
];
