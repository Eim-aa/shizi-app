// home 的语义键（B3.3 从网页参考生成，状态：home-back、home-exhausted、home-first、home-fresh、home-progress、home-special、home-start-fail、home-today）。
// key = 语义键（取网页 data-testid）；web = 网页 data-testid（id:）；native = 原生成员名 / accessibilityIdentifier（prop: / id:）——页面卡原生化时填，空 = 还没有原生页。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'screen-home', native: ['id:native-home-screen'], web: ['id:screen-home'] },
  { key: 'home-date', native: ['id:native-home-date'], web: ['id:home-date'] },
  { key: 'home-title', native: ['id:native-home-title'], web: ['id:home-title'] },
  { key: 'home-main', native: ['id:native-home-main'], web: ['id:home-main'] },
  { key: 'home-group', native: ['id:native-home-group'], web: ['id:home-group'] },
  { key: 'home-brand-shi', native: ['id:native-home-brand-shi'], web: ['id:home-brand-shi'] },
  { key: 'brand-shi-mark', native: ['id:native-brand-shi-mark'], web: ['id:brand-shi-mark'] },
  { key: 'home-epigraph', native: ['id:native-home-epigraph'], web: ['id:home-epigraph'] },
  { key: 'home-back-note', native: ['id:native-home-back-note'], web: ['id:home-back-note'] },
  { key: 'home-foot', native: ['id:native-home-foot'], web: ['id:home-foot'] },
  { key: 'home-start-live', native: [], web: ['id:home-start-live'] },
  { key: 'home-pick', native: ['id:native-home-pick'], web: ['id:home-pick'] },
  { key: 'home-start', native: ['id:native-home-start'], web: ['id:home-start'] },
  { key: 'demo-push', native: [], web: ['id:demo-push'] },
  { key: 'write-test-entry', native: [], web: ['id:write-test-entry'] },
  { key: 'tab-home', native: ['id:native-tab-home'], web: ['id:tab-home'] }, // B3.5d：原生 Tab 栏（UITabBarItem；外观差 = TAB-01）
  { key: 'tab-library', native: ['id:native-tab-library'], web: ['id:tab-library'] }, // B3.5d：原生 Tab 栏（UITabBarItem；外观差 = TAB-01）
  { key: 'tab-mine', native: ['id:native-tab-mine'], web: ['id:tab-mine'] }, // B3.5d：原生 Tab 栏（UITabBarItem；外观差 = TAB-01）
  { key: 'home-first', native: ['id:native-home-first'], web: ['id:home-first'] },
  { key: 'home-motto', native: ['id:native-home-motto'], web: ['id:home-motto'] },
  { key: 'home-seal', native: ['id:native-home-seal'], web: ['id:home-seal'] },
  { key: 'home-first-tip', native: ['id:native-home-first-tip'], web: ['id:home-first-tip'] },
  { key: 'home-capital-body', native: ['id:native-home-capital-body'], web: ['id:home-capital-body'] },
  { key: 'home-capital-defer', native: ['id:native-home-capital-defer'], web: ['id:home-capital-defer'] },
  { key: 'home-start-fail', native: ['id:native-home-start-fail'], web: ['id:home-start-fail'] },
  { key: 'home-start-fail-cancel', native: ['id:native-home-start-fail-cancel'], web: ['id:home-start-fail-cancel'] },
  { key: 'other-line', native: ['id:native-other-line'], web: ['id:other-line'] },
  { key: 'home-start-fail-retry', native: ['id:native-home-start-fail-retry'], web: ['id:home-start-fail-retry'] },
];
