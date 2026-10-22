// detail-zoom 的语义键（B3.3 从网页参考生成，状态：detail-zoom-fail、detail-zoom-ink、detail-zoom-noink）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'detail-zoom', native: [], web: ['id:detail-zoom'] },
  { key: 'detail-zoom-close', native: [], web: ['id:detail-zoom-close'] },
  { key: 'detail-zoom-ink', native: [], web: ['id:detail-zoom-ink'] },
  { key: 'detail-zoom-note', native: [], web: ['id:detail-zoom-note'] },
  { key: 'detail-zoom-fail', native: [], web: ['id:detail-zoom-fail'] },
  { key: 'detail-zoom-fail-cancel', native: [], web: ['id:detail-zoom-fail-cancel'] },
  { key: 'detail-zoom-fail-retry', native: [], web: ['id:detail-zoom-fail-retry'] },
  { key: 'detail-zoom-flip', native: [], web: ['id:detail-zoom-flip'] },
  { key: 'detail-zoom-noink', native: [], web: ['id:detail-zoom-noink'] },
];
