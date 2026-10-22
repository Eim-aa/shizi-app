// QA-H1 语义键（B3.3 起按屏分文件，elements.mjs 的 loadKeys 按文件名顺序合并）。每条：key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop:/id:）；
// web = 网页 data-testid（id:，id:xxx#N 取同 id 的第 N 个）。页面卡只加自己的 keys/<屏>.mjs。

// 结果页（网页 result/*）
export const KEYS = [
  // B2.7 原生结果页（网页 result/index.js、work.js、first.js）
  { key: 'share', native: ['prop:shareButton'], web: ['id:result-share'] },
  { key: 'work', native: ['prop:workView'], web: ['id:work'] },
  // 作品第一格（墨迹像素比较的取样格，parity.config.json ink）
  { key: 'work-cell-0', native: ['id:native-result-cell#0'], web: ['id:work-cell#0'] },
  { key: 'seal', native: ['id:native-result-seal'], web: ['id:work-seal'] },
  { key: 'exrow-open', native: ['id:native-result-row-open'], web: ['id:result-exrow-open'] },
  { key: 'preview', native: ['id:native-result-preview'], web: ['id:result-preview'] },
  { key: 'result-title', native: ['id:native-result-title'], web: ['id:result-title'] },
  { key: 'result-sub', native: ['id:native-result-sub'], web: ['id:result-sub'] },
  { key: 'invite-body', native: ['id:native-result-invite-body'], web: ['id:result-invite-body'] },
  { key: 'invite-title', native: ['id:native-result-invite-title'], web: ['id:result-invite-title'] },
];
