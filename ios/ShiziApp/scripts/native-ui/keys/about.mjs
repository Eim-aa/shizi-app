// about 的语义键（B3.3 从网页参考生成，状态：about、about-build）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'about-screen', native: ['id:native-about-screen'], web: ['id:about-screen'] },
  { key: 'about-head', native: ['id:native-about-head'], web: ['id:about-head'] },
  { key: 'about-logo', native: ['id:native-about-logo'], web: ['id:about-logo'] },
  { key: 'about-name', native: ['id:native-about-name'], web: ['id:about-name'] },
  { key: 'about-build', native: ['id:native-about-build'], web: ['id:about-build'] },
  { key: 'about-motto', native: ['id:native-about-motto'], web: ['id:about-motto'] },
  { key: 'about-seal', native: ['id:native-about-seal'], web: ['id:about-seal'] },
  { key: 'about-rows', native: ['id:native-about-rows'], web: ['id:about-rows'] },
  { key: 'about-row-privacy', native: ['id:native-about-row-privacy'], web: ['id:about-row-privacy'] },
  { key: 'about-row-credits', native: ['id:native-about-row-credits'], web: ['id:about-row-credits'] },
  { key: 'about-row-letter', native: ['id:native-about-row-letter'], web: ['id:about-row-letter'] },
  { key: 'about-build-full', native: ['id:native-about-build-full'], web: ['id:about-build-full'] },
];
