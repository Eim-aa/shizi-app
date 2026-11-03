// library-switch 的语义键（B3.8 原生化后填；状态：switch、switch-fail）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 四行各带自己的编号（原生那边 accessibilityIdentifier 逐行不同，便于流程测试点非当前库那一行）。
export const KEYS = [
  { key: 'libswitch-screen', native: ['id:native-library-switch-screen'] },
  { key: 'libswitch-list', native: ['id:native-library-switch-list'] },
  { key: 'libswitch-row', native: ['id:native-library-switch-row-0#0', 'id:native-library-switch-row-1#0', 'id:native-library-switch-row-2#0', 'id:native-library-switch-row-3#0'] }, // 四行按文档顺序配对（原生那边 accessibilityIdentifier 逐行不同，便于流程测试点非当前库那一行）
  { key: 'libswitch-source', native: ['id:native-library-switch-source'] },
  { key: 'libswitch-fail', native: ['id:native-library-switch-fail'] },
  { key: 'libswitch-fail-note', native: ['id:native-library-switch-fail-note'] },
  { key: 'libswitch-stay', native: ['id:native-library-switch-fail-cancel'] },
  { key: 'libswitch-retry', native: ['id:native-library-switch-fail-retry'] },
];
