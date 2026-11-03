// mine 的语义键（状态：mine-backup-stale、mine-empty、mine-full-warn、mine-records）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'screen-mine', native: ['id:native-screen-mine'] },
  { key: 'mine-home', native: ['id:native-mine-home'] },
  { key: 'mine-overview', native: ['id:native-mine-overview'] },
  { key: 'mine-stat-streak', native: ['id:native-mine-stat-streak'] },
  { key: 'mine-stat-num', native: ['id:native-mine-stat-num'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-stat-label', native: ['id:native-mine-stat-label'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-stat-total', native: ['id:native-mine-stat-total'] },
  { key: 'mine-stat-chars', native: ['id:native-mine-stat-chars'] },
  { key: 'mine-sheet', native: ['id:native-mine-sheet'] },
  { key: 'mine-sheet-head', native: ['id:native-mine-sheet-head'] },
  { key: 'mine-sheet-grid', native: ['id:native-mine-sheet-grid'] },
  { key: 'month-stage', native: ['id:native-month-stage'] },
  { key: 'month-sheet', native: ['id:native-month-sheet'] },
  { key: 'month-lines', native: ['id:native-month-lines'] },
  { key: 'month-frame', native: ['id:native-month-frame'] },
  { key: 'mine-sheet-cell', native: ['id:native-mine-sheet-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'month-note', native: ['id:native-month-note'] },
  { key: 'mine-remind', native: ['id:native-mine-remind'] },
  { key: 'mine-library', native: ['id:native-mine-library'] },
  { key: 'mine-appearance', native: ['id:native-mine-appearance'] },
  { key: 'mine-appearance-seg', native: ['id:native-mine-appearance-seg'] },
  { key: 'mine-appearance-option', native: ['id:native-mine-appearance-option'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-sheet-done', native: ['id:native-sheet-done'] }, // 选择弹层（外观 / 每组字数）标题行右端的「完成」
  { key: 'mine-group-size', native: ['id:native-mine-group-size'] },
  { key: 'mine-group-size-seg', native: ['id:native-mine-group-size-seg'] },
  { key: 'mine-group-size-option', native: ['id:native-mine-group-size-option'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-menu-backup', native: ['id:native-mine-menu-backup'] },
  { key: 'mine-menu-annual', native: ['id:native-mine-menu-annual'] },
  { key: 'mine-menu-about', native: ['id:native-mine-menu-about'] },
  { key: 'mine-empty', native: ['id:native-mine-empty'] },
  { key: 'mine-empty-title', native: ['id:native-mine-empty-title'] },
  { key: 'mine-empty-body', native: ['id:native-mine-empty-body'] },
  { key: 'mine-version', native: ['id:native-mine-version'] },
  { key: 'version-text', native: ['id:native-version-text'] },
];
