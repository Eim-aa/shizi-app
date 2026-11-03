// about 的语义键（状态：about、about-build）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'about-screen', native: ['id:native-about-screen'] },
  { key: 'about-head', native: ['id:native-about-head'] },
  { key: 'about-logo', native: ['id:native-about-logo'] },
  { key: 'about-name', native: ['id:native-about-name'] },
  { key: 'about-build', native: ['id:native-about-build'] },
  { key: 'about-motto', native: ['id:native-about-motto'] },
  { key: 'about-seal', native: ['id:native-about-seal'] },
  { key: 'about-rows', native: ['id:native-about-rows'] },
  { key: 'about-row-privacy', native: ['id:native-about-row-privacy'] },
  { key: 'about-row-credits', native: ['id:native-about-row-credits'] },
  { key: 'about-row-letter', native: ['id:native-about-row-letter'] },
  { key: 'about-build-full', native: ['id:native-about-build-full'] },
];
