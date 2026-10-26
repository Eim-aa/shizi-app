// query 的语义键（B3.3 从网页参考生成，状态：query-add-fail、query-card、query-empty、query-ime、query-keyboard、query-pick-0、query-pick-1、query-pick-n）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
// B3.6：原生查字弹层（ShiziScreen_query）的 accessibilityIdentifier 一一对应下面每一行。
export const KEYS = [
  { key: 'query-sheet', native: ['id:native-query-sheet'], web: ['id:query-sheet'] },
  { key: 'query-body', native: ['id:native-query-body'], web: ['id:query-body'] },
  { key: 'query-input', native: ['id:native-query-input'], web: ['id:query-input'] },
  { key: 'query-scroll', native: ['id:native-query-scroll'], web: ['id:query-scroll'] },
  { key: 'query-card', native: ['id:native-query-card'], web: ['id:query-card'] },
  { key: 'query-card-mine-empty', native: ['id:native-query-card-mine-empty'], web: ['id:query-card-mine-empty'] },
  { key: 'query-card-ref', native: ['id:native-query-card-ref'], web: ['id:query-card-ref'] },
  { key: 'query-card-meta', native: ['id:native-query-card-meta'], web: ['id:query-card-meta'] },
  { key: 'query-card-word', native: ['id:native-query-card-word'], web: ['id:query-card-word'] },
  { key: 'query-card-stat', native: ['id:native-query-card-stat'], web: ['id:query-card-stat'] },
  { key: 'query-card-foot', native: ['id:native-query-card-foot'], web: ['id:query-card-foot'] },
  { key: 'query-card-add-fail', native: ['id:native-query-card-add-fail'], web: ['id:query-card-add-fail'] },
  { key: 'query-card-add-fail-note', native: ['id:native-query-card-add-fail-note'], web: ['id:query-card-add-fail-note'] },
  { key: 'query-card-add-fail-cancel', native: ['id:native-query-card-add-fail-cancel'], web: ['id:query-card-add-fail-cancel'] },
  { key: 'query-card-add-fail-retry', native: ['id:native-query-card-add-fail-retry'], web: ['id:query-card-add-fail-retry'] },
  { key: 'query-card-mine', native: ['id:native-query-card-mine'], web: ['id:query-card-mine'] },
  { key: 'query-card-add', native: ['id:native-query-card-add'], web: ['id:query-card-add'] },
  { key: 'query-card-detail', native: ['id:native-query-card-detail'], web: ['id:query-card-detail'] },
  { key: 'query-card-practice', native: ['id:native-query-card-practice'], web: ['id:query-card-practice'] },
  { key: 'query-hint', native: ['id:native-query-hint'], web: ['id:query-hint'] },
  { key: 'query-rows', native: ['id:native-query-rows'], web: ['id:query-rows'] },
  { key: 'query-row', native: ['id:native-query-row'], web: ['id:query-row'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'query-row-open', native: ['id:native-query-row-open'], web: ['id:query-row-open'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'query-row-select', native: ['id:native-query-row-select'], web: ['id:query-row-select'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'query-bar', native: ['id:native-query-bar'], web: ['id:query-bar'] },
  { key: 'query-go', native: ['id:native-query-go'], web: ['id:query-go'] },
  // 弹层标题行与「完成」（网页 Sheet.js：sheet-head / sheet-done）：sheet-done 的语义键已在 keys/library-all-menu.mjs 里（网页侧共用），
  // 原生这一侧按文字「完成」配对，不重复登记键。
];
