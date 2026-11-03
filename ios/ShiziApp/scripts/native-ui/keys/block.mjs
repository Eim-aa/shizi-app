// block 的语义键（状态：block-blocked、block-migration、block-unavailable）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'block-screen', native: ['id:native-block-page'] },
  { key: 'block-title', native: ['id:native-block-title'] },
  { key: 'block-body', native: ['id:native-block-body'] },
  { key: 'block-retry', native: ['id:native-block-retry'] },
  { key: 'block-export', native: ['id:native-block-export'] },
  { key: 'block-migration', native: ['id:native-block-migration'] },
  { key: 'block-still', native: ['id:native-block-still'] },
];
