// s02 的语义键（状态：s02、s02-fail）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
// B3.6：原生 S02 确认框（ShiziScreen_s02）的 accessibilityIdentifier 一一对应下面每一行。
export const KEYS = [
  { key: 's02-dialog', native: ['id:native-s02-dialog'] },
  { key: 's02-body', native: ['id:native-s02-body'] },
  { key: 's02-continue', native: ['id:native-s02-continue'] },
  { key: 's02-end-start', native: ['id:native-s02-end-start'] },
  { key: 's02-cancel', native: ['id:native-s02-cancel'] },
  { key: 's02-fail', native: ['id:native-s02-fail'] },
  { key: 's02-fail-cancel', native: ['id:native-s02-fail-cancel'] },
  { key: 's02-retry', native: ['id:native-s02-retry'] },
];
