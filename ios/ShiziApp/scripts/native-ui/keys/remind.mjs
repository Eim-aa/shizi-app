// remind 的语义键（B3.3 从网页参考生成，状态：remind-denied、remind-fail、remind-off、remind-on）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'remind-screen', native: ['id:native-remind-screen'], web: ['id:remind-screen'] },
  { key: 'remind-body', native: ['id:native-remind-body'], web: ['id:remind-body'] },
  { key: 'remind-switch', native: ['id:native-remind-switch'], web: ['id:remind-switch'] },
  { key: 'remind-time', native: ['id:native-remind-time'], web: ['id:remind-time'] },
  { key: 'remind-denied', native: ['id:native-remind-note'], web: ['id:remind-denied'] },
  { key: 'remind-open-system', native: ['id:native-remind-open-system'], web: ['id:remind-open-system'] },
  { key: 'remind-fail', native: ['id:native-remind-fail'], web: ['id:remind-fail'] },
  { key: 'remind-fail-note', native: ['id:native-remind-fail-note'], web: ['id:remind-fail-note'] },
  { key: 'remind-fail-cancel', native: ['id:native-remind-fail-cancel'], web: ['id:remind-fail-cancel'] },
  { key: 'remind-fail-retry', native: ['id:native-remind-fail-retry'], web: ['id:remind-fail-retry'] },
];
