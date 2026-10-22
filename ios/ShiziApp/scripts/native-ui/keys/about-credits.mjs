// about-credits 的语义键（B3.3 从网页参考生成，状态：credits、credits-license）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'about-credits-screen', native: [], web: ['id:about-credits-screen'] },
  { key: 'about-credits-intro', native: [], web: ['id:about-credits-intro'] },
  { key: 'about-credits-group', native: [], web: ['id:about-credits-group'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'about-credit', native: [], web: ['id:about-credit'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'about-credit-name', native: [], web: ['id:about-credit-name'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'about-credit-license', native: [], web: ['id:about-credit-license'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'about-credit-url', native: [], web: ['id:about-credit-url'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'about-credit-toggle', native: [], web: ['id:about-credit-toggle'] }, // 同一屏里出现多次（行 / 格）：按文档顺序配对
  { key: 'about-credit-text', native: [], web: ['id:about-credit-text'] },
];
