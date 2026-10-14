// 「我的」页的「每组字数」行（D65 ②，P314）：5｜10｜20｜30，缺省 20（core/group-size.js）。
// 与外观行同一种选择方式（choice.js）：标准字号行内分段，四个选项一次点到、点一下即生效（写 settings.groupSize，经 store.commit）；
// AX 档改成「每组字数 …… 20 个 ›」，点开底部选择弹层。改了从下一组起生效：已经开着的组（写到一半的）不变，首页主按钮 / 字库「今日练习」的数随 store 立即更新。
//
// data-testid（choice.js 同一套，前缀 mine-group-size）：mine-group-size（行；AX 档 data-value / data-mode=pick）、mine-group-size-seg、mine-group-size-option（data-value）、
//   mine-group-size-value（AX 档行的值）、mine-group-size-fail；弹层：mine-group-size-sheet、mine-group-size-sheet-option、mine-group-size-sheet-fail。

import { html } from '../../../../vendor/ui.js';
import { t } from '../../../config/copy/index.js';
import * as defaultPolicy from '../../../config/policy.js';
import { commitGroupSize } from './prefs.js';
import { ChoiceRow, openChoiceSheet } from './choice.js';

export const GROUP_SIZE_OVERLAY = 'mine-group-size';

const valueText = n => t('X-SETTINGS.groupSizeValue', { n });

function cfg() {
  return {
    testid: 'mine-group-size', title: t('X-SETTINGS.groupSize'), options: defaultPolicy.groupSizeOptions,
    label: n => String(n), ariaLabel: valueText, sheetLabel: valueText, valueText, numeric: true,
    commit: commitGroupSize, overlay: GROUP_SIZE_OVERLAY, failField: 'groupSize',
  };
}

export function openGroupSizeSheet(current) {
  return openChoiceSheet(cfg(), current);
}

export function GroupSizeRow({ current }) {
  return html`<${ChoiceRow} cfg=${cfg()} current=${current} />`;
}
