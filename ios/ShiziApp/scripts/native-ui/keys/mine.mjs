// mine 的语义键（B3.3 从网页参考生成，状态：mine-backup-stale、mine-empty、mine-full-warn、mine-records）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'screen-mine', native: [], web: ['id:screen-mine'] },
  { key: 'mine-home', native: [], web: ['id:mine-home'] },
  { key: 'mine-overview', native: [], web: ['id:mine-overview'] },
  { key: 'mine-stat-streak', native: [], web: ['id:mine-stat-streak'] },
  { key: 'mine-stat-num', native: [], web: ['id:mine-stat-num'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-stat-label', native: [], web: ['id:mine-stat-label'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-stat-total', native: [], web: ['id:mine-stat-total'] },
  { key: 'mine-stat-chars', native: [], web: ['id:mine-stat-chars'] },
  { key: 'mine-sheet', native: [], web: ['id:mine-sheet'] },
  { key: 'mine-sheet-head', native: [], web: ['id:mine-sheet-head'] },
  { key: 'mine-sheet-grid', native: [], web: ['id:mine-sheet-grid'] },
  { key: 'month-stage', native: [], web: ['id:month-stage'] },
  { key: 'month-sheet', native: [], web: ['id:month-sheet'] },
  { key: 'month-lines', native: [], web: ['id:month-lines'] },
  { key: 'month-frame', native: [], web: ['id:month-frame'] },
  { key: 'mine-sheet-cell', native: [], web: ['id:mine-sheet-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'month-note', native: [], web: ['id:month-note'] },
  { key: 'mine-remind', native: [], web: ['id:mine-remind'] },
  { key: 'mine-library', native: [], web: ['id:mine-library'] },
  { key: 'mine-appearance', native: [], web: ['id:mine-appearance'] },
  { key: 'mine-appearance-seg', native: [], web: ['id:mine-appearance-seg'] },
  { key: 'mine-appearance-option', native: [], web: ['id:mine-appearance-option'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-group-size', native: [], web: ['id:mine-group-size'] },
  { key: 'mine-group-size-seg', native: [], web: ['id:mine-group-size-seg'] },
  { key: 'mine-group-size-option', native: [], web: ['id:mine-group-size-option'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-menu-backup', native: [], web: ['id:mine-menu-backup'] },
  { key: 'mine-menu-annual', native: [], web: ['id:mine-menu-annual'] },
  { key: 'mine-menu-about', native: [], web: ['id:mine-menu-about'] },
  { key: 'mine-empty', native: [], web: ['id:mine-empty'] },
  { key: 'mine-empty-title', native: [], web: ['id:mine-empty-title'] },
  { key: 'mine-empty-body', native: [], web: ['id:mine-empty-body'] },
  { key: 'mine-version', native: [], web: ['id:mine-version'] },
  { key: 'version-text', native: [], web: ['id:version-text'] },
];
