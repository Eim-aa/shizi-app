// home 的语义键（状态：home-back、home-exhausted、home-first、home-fresh、home-progress、home-special、home-start-fail、home-today）。
// key = 语义键；native = 原生成员名 / accessibilityIdentifier（prop: / id:）。
// 同名元素多个（行、格）时 id:xxx#N 取第 N 个（从 0 起）；不写 #N 则按文档顺序配对。
export const KEYS = [
  { key: 'screen-home', native: ['id:native-home-screen'] },
  { key: 'home-date', native: ['id:native-home-date'] },
  { key: 'home-title', native: ['id:native-home-title'] },
  { key: 'home-main', native: ['id:native-home-main'] },
  { key: 'home-group', native: ['id:native-home-group'] },
  { key: 'home-brand-shi', native: ['id:native-home-brand-shi'] },
  { key: 'brand-shi-mark', native: ['id:native-brand-shi-mark'] },
  { key: 'home-epigraph', native: ['id:native-home-epigraph'] },
  { key: 'home-back-note', native: ['id:native-home-back-note'] },
  { key: 'home-foot', native: ['id:native-home-foot'] },
  { key: 'home-pick', native: ['id:native-home-pick'] },
  { key: 'home-start', native: ['id:native-home-start'] },
  { key: 'tab-home', native: ['id:native-tab-home'] }, // B3.5d：原生 Tab 栏（UITabBarItem；外观差 = TAB-01）
  { key: 'tab-library', native: ['id:native-tab-library'] }, // B3.5d：原生 Tab 栏（UITabBarItem；外观差 = TAB-01）
  { key: 'tab-mine', native: ['id:native-tab-mine'] }, // B3.5d：原生 Tab 栏（UITabBarItem；外观差 = TAB-01）
  { key: 'home-first', native: ['id:native-home-first'] },
  { key: 'home-motto', native: ['id:native-home-motto'] },
  { key: 'home-seal', native: ['id:native-home-seal'] },
  { key: 'home-first-tip', native: ['id:native-home-first-tip'] },
  { key: 'home-capital-body', native: ['id:native-home-capital-body'] },
  { key: 'home-capital-defer', native: ['id:native-home-capital-defer'] },
  { key: 'home-start-fail', native: ['id:native-home-start-fail'] },
  { key: 'home-start-fail-cancel', native: ['id:native-home-start-fail-cancel'] },
  { key: 'other-line', native: ['id:native-other-line'] },
  { key: 'home-start-fail-retry', native: ['id:native-home-start-fail-retry'] },
];
