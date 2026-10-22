// library-switch 的语义键（B3.3 从网页参考生成，状态：switch、switch-fail）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'libswitch-screen', native: [], web: ['id:libswitch-screen'] },
  { key: 'libswitch-live', native: [], web: ['id:libswitch-live'] },
  { key: 'libswitch-list', native: [], web: ['id:libswitch-list'] },
  { key: 'libswitch-row', native: [], web: ['id:libswitch-row'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'libswitch-source', native: [], web: ['id:libswitch-source'] },
  { key: 'libswitch-fail', native: [], web: ['id:libswitch-fail'] },
  { key: 'libswitch-fail-note', native: [], web: ['id:libswitch-fail-note'] },
  { key: 'libswitch-stay', native: [], web: ['id:libswitch-stay'] },
  { key: 'libswitch-retry', native: [], web: ['id:libswitch-retry'] },
];
