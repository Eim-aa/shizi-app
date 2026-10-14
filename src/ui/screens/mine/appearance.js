// 「我的」页的外观行（D63 ③）：行内三段「跟随系统｜日间｜夜间」，点一下即切换（写 settings.appearance，<html> 的 data-theme 由 platform/appearance.js 订阅 store 后应用）；
// AX 大字号（:root[data-ax]）三段放不下：同一行改成「外观 …… 跟随系统 ›」，点开底部三选弹层（同一组选项，点一项即选定并关）。
// 选择方式与失败处理见 choice.js（「我的」页几选一设置行的共用实现；D65 #2 每组字数同一种）。
//
// data-testid：mine-appearance（行；data-value / data-mode = seg | pick）、mine-appearance-seg（radiogroup）、mine-appearance-option（radio；data-value；aria-checked）、
//   mine-appearance-value（AX 档行的值）、mine-appearance-fail（+ -cancel / -retry）；弹层：mine-appearance-sheet、mine-appearance-sheet-option、mine-appearance-sheet-fail。

import { html } from '../../../../vendor/ui.js';
import { t } from '../../../config/copy/index.js';
import { APPEARANCE_ORDER, commitAppearance } from './prefs.js';
import { ChoiceRow, ChoiceSeg, ChoiceSheetView, openChoiceSheet } from './choice.js';

export const APPEARANCE_OVERLAY = 'mine-appearance';

const label = value => t(`R-S03.appearance.${value}`);

/** 外观的选择配置（每次现取：title 走文案表）。 */
function cfg() {
  return {
    testid: 'mine-appearance', title: t('R-S03.appearance'), options: APPEARANCE_ORDER, label,
    commit: commitAppearance, overlay: APPEARANCE_OVERLAY, failField: 'appearance',
  };
}

/** 三段（行内）。 */
export function AppearanceSeg({ current, onPick }) {
  return ChoiceSeg({ cfg: cfg(), current, onPick });
}

/** AX 档弹层（纯视图）。 */
export function AppearanceSheetView(props) {
  return ChoiceSheetView({ cfg: cfg(), ...props });
}

/** 点当前项 → 关；点别的 → commit，成功关，失败就地换成三段式（再试一次 = 同一选择）。 */
export function openAppearanceSheet(current) {
  return openChoiceSheet(cfg(), current);
}

/** 「我的」页的外观行：标准字号三段一行；AX 档「外观 …… 当前值 ›」点开弹层。 */
export function AppearanceRow({ current }) {
  return html`<${ChoiceRow} cfg=${cfg()} current=${current} />`;
}
