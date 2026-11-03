// session-none 的语义键（状态：none-exhausted、none-pick）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'session-none', native: ['id:native-session-none-screen'] },
  { key: 'session-none-body-wrap', native: ['id:native-session-none-body-wrap'] },
  { key: 'session-none-cell', native: ['id:native-session-none-cell'] },
  { key: 'session-none-title', native: ['id:native-session-none-title'] },
  { key: 'session-none-body', native: ['id:native-session-none-body'] },
  { key: 'session-none-nochars', native: ['id:native-session-none-nochars'] },
  { key: 'session-none-wrong', native: ['id:native-session-none-wrong'] },
  { key: 'session-none-libswitch', native: ['id:native-session-none-libswitch'] },
  { key: 'session-none-pick', native: ['id:native-session-none-pick'] },
];
