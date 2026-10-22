// block 的语义键（B3.3 从网页参考生成，状态：block-blocked、block-migration、block-unavailable）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'block-screen', native: [], web: ['id:block-screen'] },
  { key: 'block-title', native: [], web: ['id:block-title'] },
  { key: 'block-body', native: [], web: ['id:block-body'] },
  { key: 'block-retry', native: [], web: ['id:block-retry'] },
  { key: 'block-export', native: [], web: ['id:block-export'] },
  { key: 'block-migration', native: [], web: ['id:block-migration'] },
];
