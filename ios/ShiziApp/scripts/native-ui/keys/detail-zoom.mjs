// detail-zoom 的语义键（B3.3 从网页参考生成，状态：detail-zoom-fail、detail-zoom-ink、detail-zoom-noink）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'detail-zoom', native: ['id:native-detail-zoom'], web: ['id:detail-zoom'] },
  { key: 'detail-zoom-close', native: ['id:native-detail-zoom-close'], web: ['id:detail-zoom-close'] },
  { key: 'detail-zoom-ink', native: ['id:native-detail-zoom-ink'], web: ['id:detail-zoom-ink'] },
  { key: 'detail-zoom-note', native: ['id:native-detail-zoom-note'], web: ['id:detail-zoom-note'] },
  { key: 'detail-zoom-fail', native: ['id:native-detail-zoom-fail'], web: ['id:detail-zoom-fail'] },
  { key: 'detail-zoom-fail-cancel', native: ['id:native-detail-zoom-fail-cancel'], web: ['id:detail-zoom-fail-cancel'] },
  { key: 'detail-zoom-fail-retry', native: ['id:native-detail-zoom-fail-retry'], web: ['id:detail-zoom-fail-retry'] },
  { key: 'detail-zoom-flip', native: ['id:native-detail-zoom-flip'], web: ['id:detail-zoom-flip'] },
  { key: 'detail-zoom-noink', native: ['id:native-detail-zoom-noink'], web: ['id:detail-zoom-noink'] },
];
