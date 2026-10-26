// library-switch 的语义键（B3.8 原生化后填；状态：switch、switch-fail）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生 accessibilityIdentifier（id:）。
// 四行各带自己的编号（原生那边 accessibilityIdentifier 逐行不同，便于流程测试点非当前库那一行）。
export const KEYS = [
  { key: 'libswitch-screen', native: ['id:native-library-switch-screen'], web: ['id:libswitch-screen'] },
  { key: 'libswitch-live', native: [], web: ['id:libswitch-live'] }, // 网页的常驻播报区（1 × 1，只给读屏）；原生这边不单独建
  { key: 'libswitch-list', native: ['id:native-library-switch-list'], web: ['id:libswitch-list'] },
  { key: 'libswitch-row', native: ['id:native-library-switch-row-0#0', 'id:native-library-switch-row-1#0', 'id:native-library-switch-row-2#0', 'id:native-library-switch-row-3#0'], web: ['id:libswitch-row#0', 'id:libswitch-row#1', 'id:libswitch-row#2', 'id:libswitch-row#3'] }, // 四行按文档顺序配对（原生那边 accessibilityIdentifier 逐行不同，便于流程测试点非当前库那一行）
  { key: 'libswitch-source', native: ['id:native-library-switch-source'], web: ['id:libswitch-source'] },
  { key: 'libswitch-fail', native: ['id:native-library-switch-fail'], web: ['id:libswitch-fail'] },
  { key: 'libswitch-fail-note', native: ['id:native-library-switch-fail-note'], web: ['id:libswitch-fail-note'] },
  { key: 'libswitch-stay', native: ['id:native-library-switch-fail-cancel'], web: ['id:libswitch-stay'] },
  { key: 'libswitch-retry', native: ['id:native-library-switch-fail-retry'], web: ['id:libswitch-retry'] },
];
