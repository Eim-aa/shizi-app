// QA-H1 原生界面检查的固定条件（参考图与对比都按这里）。改这里要重新生成参考图：
//   ios/ShiziApp/scripts/verify-native-ui.sh --update-reference
export const BUNDLE_ID = 'com.eimaa.shizi';
/** 固定模拟器：iPhone 17 / iOS 26.5（脚本每次新建、用完删除，名字带 QA-H1 前缀）。 */
export const DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17';
export const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
/** 逐屏对比覆盖的写字页状态（与 App 内 QAState.parityStates 同名同序）。 */
export const STATES = ['first-recall', 'recall', 'recall-ink', 'hint-1', 'hint-2', 'hint-full', 'trace', 'retrace', 'judge', 'line', 'change-sheet', 'skip-undo', 'end-dialog', 'last', 'last-judge'];
export const STATE_NAMES = {
  'first-recall': '首练第 1 字（一次性说明）', recall: '回忆（没写）', 'recall-ink': '回忆（写了两笔）', 'hint-1': '提示 1 段', 'hint-2': '提示 2 段', 'hint-full': '提示到整字',
  trace: '看答案 · 描一遍', retrace: '凭记忆写', judge: '判断页', line: '格下结果行（修改 ›）', 'change-sheet': '改判弹层',
  'skip-undo': '跳过撤销条', 'end-dialog': '结束确认框', last: '最后一字（回忆）', 'last-judge': '最后一字（判断）',
};
export const APPEARANCES = ['light', 'dark'];
export const SIZES = ['L', 'XXXL'];
export const SIZE_SIM = { xS: 'extra-small', L: 'large', XL: 'extra-large', XXXL: 'extra-extra-extra-large', AX3: 'accessibility-extra-large', AX5: 'accessibility-extra-extra-extra-large' };
