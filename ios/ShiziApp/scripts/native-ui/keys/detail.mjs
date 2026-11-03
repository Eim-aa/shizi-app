// detail 的语义键（状态：detail-custom、detail-many、detail-none、detail-off、detail-once、detail-photo-row、detail-wrong）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'detail-screen', native: ['id:native-detail-screen'] },
  { key: 'detail-card', native: ['id:native-detail-card'] },
  { key: 'detail-ref', native: ['id:native-detail-ref'] },
  { key: 'detail-pinyin', native: ['id:native-detail-pinyin'] },
  { key: 'detail-strokes', native: ['id:native-detail-strokes'] },
  { key: 'detail-word-label', native: ['id:native-detail-word-label'] },
  { key: 'detail-word', native: ['id:native-detail-word'] },
  { key: 'detail-word-tile', native: ['id:native-detail-word-tile'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'detail-records', native: ['id:native-detail-records'] },
  { key: 'detail-records-count', native: ['id:native-detail-records-count'] },
  { key: 'detail-records-empty', native: ['id:native-detail-records-empty'] },
  { key: 'detail-source', native: ['id:native-detail-source'] },
  { key: 'detail-source-text', native: ['id:native-detail-source-text'] },
  { key: 'detail-source-from', native: ['id:native-detail-source-from'] },
  { key: 'detail-rows', native: ['id:native-detail-rows'] },
  { key: 'detail-image', native: ['id:native-detail-image'] },
  { key: 'detail-swap', native: ['id:native-detail-swap'] },
  { key: 'detail-remove', native: ['id:native-detail-remove'] },
  { key: 'detail-practice', native: ['id:native-detail-practice'] },
  { key: 'detail-hero', native: ['id:native-detail-hero'] },
  { key: 'detail-hero-cell', native: ['id:native-detail-hero-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'detail-cells', native: ['id:native-detail-cells'] },
  { key: 'detail-cell', native: ['id:native-detail-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'detail-next', native: ['id:native-detail-next'] },
  { key: 'detail-add', native: ['id:native-detail-add'] },
  { key: 'detail-gloss', native: ['id:native-detail-gloss'] },
  { key: 'detail-word-banner', native: ['id:native-detail-word-banner'] },
  { key: 'detail-undo-bar', native: ['id:native-detail-undo-bar'] },
  { key: 'undo-button', native: ['id:native-detail-undo-button'] },
  { key: 'detail-legacy', native: ['id:native-detail-legacy'] },
];
