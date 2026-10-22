// QA-H1 原生界面检查的固定条件（参考图与对比都按这里）。改这里要重新生成参考图：
//   ios/ShiziApp/scripts/verify-native-ui.sh --update-reference
export const BUNDLE_ID = 'com.eimaa.shizi';
/** 固定模拟器：iPhone 17 / iOS 26.5（脚本每次新建、用完删除，名字带 QA-H1 前缀）。 */
export const DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17';
export const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
/** 逐屏对比覆盖的写字页状态（与 App 内 QAState.parityStates 同名同序）。 */
export const STATES = ['first-recall', 'recall', 'recall-ink', 'hint-1', 'hint-2', 'hint-full', 'trace', 'retrace', 'judge', 'line', 'change-sheet', 'skip-undo', 'end-dialog', 'last', 'last-judge',
  // B2.7 原生结果页
  'result', 'result-daily', 'result-first', 'result-early', 'result-undo', 'result-sheet',
  // B2.9a 原生重写错字页
  'redo', 'redo-ink', 'redo-check', 'redo-last'];
export const STATE_NAMES = {
  'first-recall': '首练第 1 字（一次性说明）', recall: '回忆（没写）', 'recall-ink': '回忆（写了两笔）', 'hint-1': '提示 1 段', 'hint-2': '提示 2 段', 'hint-full': '提示到整字',
  trace: '看答案 · 描一遍', retrace: '凭记忆写', judge: '判断页', line: '格下结果行（修改 ›）', 'change-sheet': '改判弹层',
  'skip-undo': '跳过撤销条', 'end-dialog': '结束确认框', last: '最后一字（回忆）', 'last-judge': '最后一字（判断）',
  result: '结果页 · 这次选的字', 'result-daily': '结果页 · 今天的练习（有写错行）', 'result-first': '结果页 · 首练（标题 + 提醒邀请）',
  'result-early': '结果页 · 中途结束', 'result-undo': '结果页 · 带跳过撤销条', 'result-sheet': '结果页 · 对照与改判弹层',
  redo: '重写错字 · 第 1 个字（没写）', 'redo-ink': '重写错字 · 写了两笔', 'redo-check': '重写错字 · 对照（下一个）', 'redo-last': '重写错字 · 最后一个字的对照（完成）',
};
export const APPEARANCES = ['light', 'dark'];
export const SIZES = ['L', 'XXXL'];
/** B2.9b：大字号（AX1–AX5 版式）的主要状态 × AX3 / AX5（参考图同样取网页版；AX-01「不溢出」只在这两档跑）。 */
export const AX_STATES = ['recall', 'recall-ink', 'hint-2', 'trace', 'retrace', 'judge', 'line', 'change-sheet', 'skip-undo', 'end-dialog',
  'result', 'result-daily', 'result-first', 'result-sheet', 'redo', 'redo-check'];
export const AX_SIZES = ['AX3', 'AX5'];
export const SIZE_SIM = { xS: 'extra-small', L: 'large', XL: 'extra-large', XXXL: 'extra-extra-extra-large', AX3: 'accessibility-extra-large', AX5: 'accessibility-extra-extra-extra-large' };
