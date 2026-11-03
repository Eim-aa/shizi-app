// library 的语义键（状态：library-done、library-empty、library-half、library-records、library-today-fail、library-leave-undo；B3.5b 填原生一栏）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'screen-library', native: ['id:native-library-screen'] },
  { key: 'library-home', native: ['id:native-library-home'] },
  { key: 'library-search', native: ['id:native-library-search'] },
  { key: 'library-query-slot', native: ['id:native-library-query-slot'] },
  { key: 'library-query-open', native: ['id:native-library-query-open'] },
  { key: 'library-range', native: ['id:native-library-range'] },
  { key: 'library-today', native: ['id:native-library-today'] },
  { key: 'library-written', native: ['id:native-library-written'] },
  { key: 'library-written-count', native: ['id:native-library-written-count'] },
  { key: 'library-all-open', native: ['id:native-library-all-open'] },
  { key: 'library-zone', native: ['id:native-library-zone-0', 'id:native-library-zone-1', 'id:native-library-zone-2'] }, // 同一屏里出现多次（三档三行）：按文档顺序配对
  { key: 'library-skipped-block', native: ['id:native-library-skipped-block'] },
  { key: 'library-skipped', native: ['id:native-library-skipped'] },
  { key: 'library-skipped-name', native: ['id:native-library-skipped-name'] },
  { key: 'library-skipped-count', native: ['id:native-library-skipped-count'] },
  { key: 'library-zone-name', native: ['id:native-library-zone-name'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-zone-count', native: ['id:native-library-zone-count'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'library-today-fail', native: ['id:native-library-today-fail'] },
  { key: 'library-today-fail-note', native: ['id:native-library-today-fail-note'] },
  { key: 'library-today-fail-cancel', native: ['id:native-library-today-fail-cancel'] },
  { key: 'library-today-fail-retry', native: ['id:native-library-today-fail-retry'] },
];
