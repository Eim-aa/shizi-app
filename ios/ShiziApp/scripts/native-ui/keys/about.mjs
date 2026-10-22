// about 的语义键（B3.3 从网页参考生成，状态：about、about-build）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'about-screen', native: [], web: ['id:about-screen'] },
  { key: 'about-head', native: [], web: ['id:about-head'] },
  { key: 'about-logo', native: [], web: ['id:about-logo'] },
  { key: 'about-name', native: [], web: ['id:about-name'] },
  { key: 'about-build', native: [], web: ['id:about-build'] },
  { key: 'about-motto', native: [], web: ['id:about-motto'] },
  { key: 'about-seal', native: [], web: ['id:about-seal'] },
  { key: 'seal-shi-mark', native: [], web: ['id:seal-shi-mark'] },
  { key: 'about-rows', native: [], web: ['id:about-rows'] },
  { key: 'about-row-privacy', native: [], web: ['id:about-row-privacy'] },
  { key: 'about-row-credits', native: [], web: ['id:about-row-credits'] },
  { key: 'about-row-letter', native: [], web: ['id:about-row-letter'] },
  { key: 'about-build-full', native: [], web: ['id:about-build-full'] },
];
