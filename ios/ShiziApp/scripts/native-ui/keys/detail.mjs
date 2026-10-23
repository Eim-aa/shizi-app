// detail 的语义键（B3.3 从网页参考生成，状态：detail-custom、detail-many、detail-none、detail-off、detail-once、detail-photo-row、detail-wrong）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'detail-screen', native: ['id:native-detail-screen'], web: ['id:detail-screen'] },
  { key: 'detail-live', native: [], web: ['id:detail-live'] },
  { key: 'detail-card', native: ['id:native-detail-card'], web: ['id:detail-card'] },
  { key: 'detail-ref', native: ['id:native-detail-ref'], web: ['id:detail-ref'] },
  { key: 'detail-pinyin', native: ['id:native-detail-pinyin'], web: ['id:detail-pinyin'] },
  { key: 'detail-strokes', native: ['id:native-detail-strokes'], web: ['id:detail-strokes'] },
  { key: 'detail-word-label', native: ['id:native-detail-word-label'], web: ['id:detail-word-label'] },
  { key: 'detail-word', native: ['id:native-detail-word'], web: ['id:detail-word'] },
  { key: 'detail-word-tile', native: ['id:native-detail-word-tile'], web: ['id:detail-word-tile'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'detail-records', native: ['id:native-detail-records'], web: ['id:detail-records'] },
  { key: 'detail-records-count', native: ['id:native-detail-records-count'], web: ['id:detail-records-count'] },
  { key: 'detail-records-empty', native: ['id:native-detail-records-empty'], web: ['id:detail-records-empty'] },
  { key: 'detail-source', native: ['id:native-detail-source'], web: ['id:detail-source'] },
  { key: 'detail-source-text', native: ['id:native-detail-source-text'], web: ['id:detail-source-text'] },
  { key: 'detail-source-from', native: ['id:native-detail-source-from'], web: ['id:detail-source-from'] },
  { key: 'detail-rows', native: ['id:native-detail-rows'], web: ['id:detail-rows'] },
  { key: 'detail-image', native: ['id:native-detail-image'], web: ['id:detail-image'] },
  { key: 'detail-swap', native: ['id:native-detail-swap'], web: ['id:detail-swap'] },
  { key: 'detail-remove', native: ['id:native-detail-remove'], web: ['id:detail-remove'] },
  { key: 'detail-practice', native: ['id:native-detail-practice'], web: ['id:detail-practice'] },
  { key: 'detail-hero', native: ['id:native-detail-hero'], web: ['id:detail-hero'] },
  { key: 'detail-hero-cell', native: ['id:native-detail-hero-cell'], web: ['id:detail-hero-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'detail-cells', native: ['id:native-detail-cells'], web: ['id:detail-cells'] },
  { key: 'detail-cell', native: ['id:native-detail-cell'], web: ['id:detail-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'detail-next', native: ['id:native-detail-next'], web: ['id:detail-next'] },
  { key: 'detail-add', native: ['id:native-detail-add'], web: ['id:detail-add'] },
  { key: 'detail-gloss', native: ['id:native-detail-gloss'], web: ['id:detail-gloss'] },
  { key: 'detail-word-banner', native: ['id:native-detail-word-banner'], web: ['id:detail-word-banner'] },
  { key: 'detail-undo-bar', native: ['id:native-detail-undo-bar'], web: ['id:undo-bar'] },
  { key: 'undo-button', native: ['id:native-detail-undo-button'], web: ['id:undo-button'] },
  { key: 'detail-legacy', native: ['id:native-detail-legacy'], web: ['id:detail-legacy'] },
];
