// library 的语义键（B3.3 从网页参考生成，状态：library-done、library-empty、library-half、library-records、library-today-fail）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'screen-library', native: [], web: ['id:screen-library'] },
  { key: 'library-home', native: [], web: ['id:library-home'] },
  { key: 'library-search', native: [], web: ['id:library-search'] },
  { key: 'library-query-slot', native: [], web: ['id:library-query-slot'] },
  { key: 'library-query-open', native: [], web: ['id:library-query-open'] },
  { key: 'library-range', native: [], web: ['id:library-range'] },
  { key: 'library-today', native: [], web: ['id:library-today'] },
  { key: 'library-written', native: [], web: ['id:library-written'] },
  { key: 'library-written-count', native: [], web: ['id:library-written-count'] },
  { key: 'library-all-open', native: [], web: ['id:library-all-open'] },
  { key: 'library-zone', native: [], web: ['id:library-zone'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-skipped-block', native: [], web: ['id:library-skipped-block'] },
  { key: 'library-skipped', native: [], web: ['id:library-skipped'] },
  { key: 'library-skipped-name', native: [], web: ['id:library-skipped-name'] },
  { key: 'library-skipped-count', native: [], web: ['id:library-skipped-count'] },
  { key: 'library-zone-name', native: [], web: ['id:library-zone-name'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-zone-count', native: [], web: ['id:library-zone-count'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-today-fail', native: [], web: ['id:library-today-fail'] },
  { key: 'library-today-fail-note', native: [], web: ['id:library-today-fail-note'] },
  { key: 'library-today-fail-cancel', native: [], web: ['id:library-today-fail-cancel'] },
  { key: 'library-today-fail-retry', native: [], web: ['id:library-today-fail-retry'] },
];
