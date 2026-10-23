// detail-photo 的语义键（B3.3 从网页参考生成，状态：photo、photo-missing）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'photo-screen', native: ['id:native-detail-photo-screen'], web: ['id:photo-screen'] },
  { key: 'photo-image', native: ['id:native-detail-photo-image'], web: ['id:photo-image'] },
  { key: 'photo-caption', native: ['id:native-detail-photo-caption'], web: ['id:photo-caption'] },
  { key: 'photo-body', native: ['id:native-detail-photo-body'], web: ['id:photo-body'] },
  { key: 'photo-missing', native: ['id:native-detail-photo-missing'], web: ['id:photo-missing'] },
];
