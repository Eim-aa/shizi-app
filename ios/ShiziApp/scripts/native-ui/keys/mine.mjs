// mine 的语义键（B3.3 从网页参考生成，状态：mine-backup-stale、mine-empty、mine-full-warn、mine-records）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'screen-mine', native: ['id:native-screen-mine'], web: ['id:screen-mine'] },
  { key: 'mine-home', native: ['id:native-mine-home'], web: ['id:mine-home'] },
  { key: 'mine-overview', native: ['id:native-mine-overview'], web: ['id:mine-overview'] },
  { key: 'mine-stat-streak', native: ['id:native-mine-stat-streak'], web: ['id:mine-stat-streak'] },
  { key: 'mine-stat-num', native: ['id:native-mine-stat-num'], web: ['id:mine-stat-num'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-stat-label', native: ['id:native-mine-stat-label'], web: ['id:mine-stat-label'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-stat-total', native: ['id:native-mine-stat-total'], web: ['id:mine-stat-total'] },
  { key: 'mine-stat-chars', native: ['id:native-mine-stat-chars'], web: ['id:mine-stat-chars'] },
  { key: 'mine-sheet', native: ['id:native-mine-sheet'], web: ['id:mine-sheet'] },
  { key: 'mine-sheet-head', native: ['id:native-mine-sheet-head'], web: ['id:mine-sheet-head'] },
  { key: 'mine-sheet-grid', native: ['id:native-mine-sheet-grid'], web: ['id:mine-sheet-grid'] },
  { key: 'month-stage', native: ['id:native-month-stage'], web: ['id:month-stage'] },
  { key: 'month-sheet', native: ['id:native-month-sheet'], web: ['id:month-sheet'] },
  { key: 'month-lines', native: ['id:native-month-lines'], web: ['id:month-lines'] },
  { key: 'month-frame', native: ['id:native-month-frame'], web: ['id:month-frame'] },
  { key: 'mine-sheet-cell', native: ['id:native-mine-sheet-cell'], web: ['id:mine-sheet-cell'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'month-note', native: ['id:native-month-note'], web: ['id:month-note'] },
  { key: 'mine-remind', native: ['id:native-mine-remind'], web: ['id:mine-remind'] },
  { key: 'mine-library', native: ['id:native-mine-library'], web: ['id:mine-library'] },
  { key: 'mine-appearance', native: ['id:native-mine-appearance'], web: ['id:mine-appearance'] },
  { key: 'mine-appearance-seg', native: ['id:native-mine-appearance-seg'], web: ['id:mine-appearance-seg'] },
  { key: 'mine-appearance-option', native: ['id:native-mine-appearance-option'], web: ['id:mine-appearance-option'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'sheet-done', native: ['id:native-sheet-done'], web: ['id:sheet-done'] }, // 选择弹层（外观 / 每组字数）标题行右端的「完成」
  { key: 'mine-group-size', native: ['id:native-mine-group-size'], web: ['id:mine-group-size'] },
  { key: 'mine-group-size-seg', native: ['id:native-mine-group-size-seg'], web: ['id:mine-group-size-seg'] },
  { key: 'mine-group-size-option', native: ['id:native-mine-group-size-option'], web: ['id:mine-group-size-option'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'mine-menu-backup', native: ['id:native-mine-menu-backup'], web: ['id:mine-menu-backup'] },
  { key: 'mine-menu-annual', native: ['id:native-mine-menu-annual'], web: ['id:mine-menu-annual'] },
  { key: 'mine-menu-about', native: ['id:native-mine-menu-about'], web: ['id:mine-menu-about'] },
  { key: 'mine-empty', native: ['id:native-mine-empty'], web: ['id:mine-empty'] },
  { key: 'mine-empty-title', native: ['id:native-mine-empty-title'], web: ['id:mine-empty-title'] },
  { key: 'mine-empty-body', native: ['id:native-mine-empty-body'], web: ['id:mine-empty-body'] },
  { key: 'mine-version', native: ['id:native-mine-version'], web: ['id:mine-version'] },
  { key: 'version-text', native: ['id:native-version-text'], web: ['id:version-text'] },
];
