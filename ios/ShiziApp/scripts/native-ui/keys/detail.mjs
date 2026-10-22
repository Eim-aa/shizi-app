// detail 的语义键（B3.3 从网页参考生成，状态：detail-custom、detail-many、detail-none、detail-off、detail-once、detail-photo-row、detail-wrong）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'detail-screen', native: [], web: ['id:detail-screen'] },
  { key: 'detail-live', native: [], web: ['id:detail-live'] },
  { key: 'detail-card', native: [], web: ['id:detail-card'] },
  { key: 'detail-ref', native: [], web: ['id:detail-ref'] },
  { key: 'detail-pinyin', native: [], web: ['id:detail-pinyin'] },
  { key: 'detail-strokes', native: [], web: ['id:detail-strokes'] },
  { key: 'detail-word-label', native: [], web: ['id:detail-word-label'] },
  { key: 'detail-word', native: [], web: ['id:detail-word'] },
  { key: 'detail-word-tile', native: [], web: ['id:detail-word-tile'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'detail-records', native: [], web: ['id:detail-records'] },
  { key: 'detail-records-count', native: [], web: ['id:detail-records-count'] },
  { key: 'detail-records-empty', native: [], web: ['id:detail-records-empty'] },
  { key: 'detail-source', native: [], web: ['id:detail-source'] },
  { key: 'detail-source-text', native: [], web: ['id:detail-source-text'] },
  { key: 'detail-source-from', native: [], web: ['id:detail-source-from'] },
  { key: 'detail-rows', native: [], web: ['id:detail-rows'] },
  { key: 'detail-image', native: [], web: ['id:detail-image'] },
  { key: 'detail-swap', native: [], web: ['id:detail-swap'] },
  { key: 'detail-remove', native: [], web: ['id:detail-remove'] },
  { key: 'detail-practice', native: [], web: ['id:detail-practice'] },
  { key: 'detail-hero', native: [], web: ['id:detail-hero'] },
  { key: 'detail-hero-cell', native: [], web: ['id:detail-hero-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'detail-cells', native: [], web: ['id:detail-cells'] },
  { key: 'detail-cell', native: [], web: ['id:detail-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'detail-next', native: [], web: ['id:detail-next'] },
  { key: 'detail-add', native: [], web: ['id:detail-add'] },
  { key: 'detail-gloss', native: [], web: ['id:detail-gloss'] },
  { key: 'detail-word-banner', native: [], web: ['id:detail-word-banner'] },
  { key: 'detail-undo-bar', native: [], web: ['id:undo-bar'] },
  { key: 'undo-button', native: [], web: ['id:undo-button'] },
  { key: 'detail-legacy', native: [], web: ['id:detail-legacy'] },
];
