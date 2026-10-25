// session-none 的语义键（B3.3 从网页参考生成，状态：none-exhausted、none-pick）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'session-none', native: ['id:native-session-none-screen'], web: ['id:session-none'] },
  { key: 'session-none-body-wrap', native: ['id:native-session-none-body-wrap'], web: ['id:session-none-body-wrap'] },
  { key: 'session-none-cell', native: ['id:native-session-none-cell'], web: ['id:session-none-cell'] },
  { key: 'session-none-title', native: ['id:native-session-none-title'], web: ['id:session-none-title'] },
  { key: 'session-none-body', native: ['id:native-session-none-body'], web: ['id:session-none-body'] },
  { key: 'session-none-nochars', native: ['id:native-session-none-nochars'], web: ['id:session-none-nochars'] },
  { key: 'session-none-wrong', native: ['id:native-session-none-wrong'], web: ['id:session-none-wrong'] },
  { key: 'session-none-libswitch', native: ['id:native-session-none-libswitch'], web: ['id:session-none-libswitch'] },
  { key: 'session-none-pick', native: ['id:native-session-none-pick'], web: ['id:session-none-pick'] },
];
