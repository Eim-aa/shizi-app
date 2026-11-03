// remind 的语义键（状态：remind-denied、remind-fail、remind-off、remind-on）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'remind-screen', native: ['id:native-remind-screen'] },
  { key: 'remind-body', native: ['id:native-remind-body'] },
  { key: 'remind-switch', native: ['id:native-remind-switch'] },
  { key: 'remind-time', native: ['id:native-remind-time'] },
  { key: 'remind-denied', native: ['id:native-remind-note'] },
  { key: 'remind-open-system', native: ['id:native-remind-open-system'] },
  { key: 'remind-fail', native: ['id:native-remind-fail'] },
  { key: 'remind-fail-note', native: ['id:native-remind-fail-note'] },
  { key: 'remind-fail-cancel', native: ['id:native-remind-fail-cancel'] },
  { key: 'remind-fail-retry', native: ['id:native-remind-fail-retry'] },
];
