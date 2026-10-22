// query 的语义键（B3.3 从网页参考生成，状态：query-add-fail、query-card、query-empty、query-ime、query-keyboard、query-pick-0、query-pick-1、query-pick-n）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'query-sheet', native: [], web: ['id:query-sheet'] },
  { key: 'query-body', native: [], web: ['id:query-body'] },
  { key: 'query-input', native: [], web: ['id:query-input'] },
  { key: 'query-scroll', native: [], web: ['id:query-scroll'] },
  { key: 'query-card', native: [], web: ['id:query-card'] },
  { key: 'query-card-mine-empty', native: [], web: ['id:query-card-mine-empty'] },
  { key: 'query-card-ref', native: [], web: ['id:query-card-ref'] },
  { key: 'query-card-meta', native: [], web: ['id:query-card-meta'] },
  { key: 'query-card-word', native: [], web: ['id:query-card-word'] },
  { key: 'query-card-stat', native: [], web: ['id:query-card-stat'] },
  { key: 'query-card-foot', native: [], web: ['id:query-card-foot'] },
  { key: 'query-card-add-fail', native: [], web: ['id:query-card-add-fail'] },
  { key: 'query-card-add-fail-note', native: [], web: ['id:query-card-add-fail-note'] },
  { key: 'query-card-add-fail-cancel', native: [], web: ['id:query-card-add-fail-cancel'] },
  { key: 'query-card-add-fail-retry', native: [], web: ['id:query-card-add-fail-retry'] },
  { key: 'query-card-mine', native: [], web: ['id:query-card-mine'] },
  { key: 'query-card-add', native: [], web: ['id:query-card-add'] },
  { key: 'query-card-detail', native: [], web: ['id:query-card-detail'] },
  { key: 'query-card-practice', native: [], web: ['id:query-card-practice'] },
  { key: 'query-hint', native: [], web: ['id:query-hint'] },
  { key: 'query-rows', native: [], web: ['id:query-rows'] },
  { key: 'query-row', native: [], web: ['id:query-row'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'query-row-open', native: [], web: ['id:query-row-open'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'query-row-select', native: [], web: ['id:query-row-select'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'query-bar', native: [], web: ['id:query-bar'] },
  { key: 'query-go', native: [], web: ['id:query-go'] },
];
