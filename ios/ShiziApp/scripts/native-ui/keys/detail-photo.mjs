// detail-photo 的语义键（状态：photo、photo-missing）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'photo-screen', native: ['id:native-detail-photo-screen'] },
  { key: 'photo-image', native: ['id:native-detail-photo-image'] },
  { key: 'photo-caption', native: ['id:native-detail-photo-caption'] },
  { key: 'photo-body', native: ['id:native-detail-photo-body'] },
  { key: 'photo-missing', native: ['id:native-detail-photo-missing'] },
];
