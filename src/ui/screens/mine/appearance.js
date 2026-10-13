// 「我的」页的外观行（D63 ③）：行内三段「跟随系统｜日间｜夜间」，点一下即切换（写 settings.appearance，<html> 的 data-theme 由 platform/appearance.js 订阅 store 后应用）；
// AX 大字号（:root[data-ax]）三段放不下：同一行改成「外观 …… 跟随系统 ›」，点开底部三选弹层（同一组选项，点一项即选定并关）。
// 写入失败（D07 / R-G04）：行下就地三段式「没保存上，刚才的选择没记下。先不保存 / 再试一次」，选中停在原值；再试一次 = 同一目标值再 commit 一次。
//
// 交互规范里没有「分段控件」的条款（规范 §5–§8 只有按钮 / 开关 / 弹层）：本控件按 radiogroup 实现——整段一个 radiogroup，三项各是 ≥ 44 的 radio 按钮，
// 点按即生效（无确认、无提示条，F5），按压反馈用按钮同一套（data-pressed），选中滑块不做动画（减少动态效果下终态相同）。已在报告中登记待补规范。
//
// data-testid：mine-appearance（行；data-value / data-mode = seg | pick）、mine-appearance-seg（radiogroup）、mine-appearance-option（radio；data-value；aria-checked）、
//   mine-appearance-value（AX 档行的值）、mine-appearance-fail（+ -cancel / -retry）；弹层：mine-appearance-sheet、mine-appearance-sheet-option、mine-appearance-sheet-fail。

import { html, useState } from '../../../../vendor/ui.js';
import { nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { Icons } from '../../components/icons.js';
import { Sheet } from '../../components/Sheet.js';
import { FailBlock } from '../../components/FailBlock.js';
import { Row, RowShell } from '../../components/Rows.js';
import { useAxLevel } from '../../components/ax.js';
import { injectStyles, T } from '../../components/styles.js';
import { getStore } from '../../../store/store.js';
import { t } from '../../../config/copy/index.js';
import { APPEARANCE_ORDER, commitAppearance } from './prefs.js';

export const APPEARANCE_OVERLAY = 'mine-appearance';

injectStyles('mine-appearance', `
.sz-seg{flex:none;display:flex;padding:2px;border-radius:${T.rCtl};background:${T.field};min-width:0}
.sz-seg__opt.sz-btn{flex:none;min-height:44px;padding:0 ${T.s3};border-radius:calc(${T.rCtl} - 2px);display:flex;align-items:center;justify-content:center;
  font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};white-space:nowrap}
.sz-seg__opt[aria-checked="true"]{background:${T.sheet};color:${T.ink1};font-weight:500;box-shadow:0 0 0 ${T.hair} ${T.line}}
.sz-rrow--seg{padding:${T.s1} 0}
.sz-mine__afail{padding:${T.s3} 0 0}
.sz-mine__opts{display:flex;flex-direction:column;border-top:${T.hair} solid ${T.line}}
.sz-mine__opt{box-sizing:border-box;width:100%;min-height:52px;padding:${T.s2} 0;display:flex;align-items:center;justify-content:space-between;
  gap:${T.s3};border-bottom:${T.hair} solid ${T.line};font-size:${T.fs17};text-align:left;color:${T.ink1}}
.sz-mine__check{flex:none;width:22px;height:22px;color:${T.ink1};visibility:hidden}
.sz-mine__opt[aria-checked="true"] .sz-mine__check{visibility:visible}
.sz-mine__opt[aria-checked="true"]{font-weight:500}
`);

const label = value => t(`R-S03.appearance.${value}`);
// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const CHECK_ICON = () => Icons.checkLarge({ cls: 'sz-mine__check' });

function attempt(value) {
  try {
    return commitAppearance(getStore(), value);
  } catch (error) {
    return { ok: false, error: { kind: 'unknown', reason: error && error.message ? error.message : String(error) } };
  }
}

/** 三段（行内）。 */
export function AppearanceSeg({ current, onPick }) {
  return html`<div class="sz-seg" role="radiogroup" aria-label=${t('R-S03.appearance')} data-testid="mine-appearance-seg" data-value=${current}>
    ${APPEARANCE_ORDER.map(value => html`<${Button} key=${value} variant="plain" class="sz-seg__opt" role="radio" rapid
      aria-checked=${value === current ? 'true' : 'false'} data-testid="mine-appearance-option" data-value=${value}
      onClick=${() => onPick(value)}>${label(value)}</${Button}>`)}
  </div>`;
}

/** AX 档弹层（纯视图）。 */
export function AppearanceSheetView({ current, failed = false, pending = null, onPick, onCancel, onRetry, close, active = true }) {
  return html`<${Sheet} title=${t('R-S03.appearance')} onClose=${close} active=${active} testid="mine-appearance-sheet">
    <div class="sz-mine__opts" role="radiogroup" aria-label=${t('R-S03.appearance')} data-state=${failed ? 'failed' : 'pick'}>
      ${APPEARANCE_ORDER.map(value => html`<${Button} key=${value} variant="plain" class="sz-mine__opt" role="radio"
        aria-checked=${value === current ? 'true' : 'false'} data-testid="mine-appearance-sheet-option" data-value=${value}
        onClick=${() => onPick(value)}><span>${label(value)}</span>${CHECK_ICON()}</${Button}>`)}
    </div>
    ${failed ? html`<div class="sz-mine__afail">${FailBlock({
      testid: 'mine-appearance-sheet-fail', text: t('X-SETTINGS.saveFailed'), cancelLabel: t('X-SETTINGS.cancel'), retryLabel: t('X-SETTINGS.retry'),
      attrs: { 'data-field': `appearance:${pending}` }, onCancel, onRetry,
    })}</div>` : null}
  </${Sheet}>`;
}

function AppearanceSheet({ current, failed = false, pending = null, onPick, onRetry, close, active = true }) {
  return AppearanceSheetView({ current, failed, pending, onPick, onCancel: close, onRetry, close, active });
}

/** 点当前项 → 关；点别的 → commit，成功关，失败就地换成三段式（再试一次 = 同一选择）。 */
export function openAppearanceSheet(current) {
  let overlayId = null;
  let done = false;
  let pending = null;
  const run = value => {
    if (done) return;
    const result = attempt(value);
    if (result && result.ok) {
      done = true;
      nav.closeOverlay(overlayId);
      return;
    }
    nav.updateOverlay(overlayId, { failed: true, pending: value, current });
  };
  const pick = value => {
    if (done) return;
    pending = value;
    if (value === current) {
      done = true;
      nav.closeOverlay(overlayId);
      return;
    }
    run(value);
  };
  overlayId = nav.openOverlay(AppearanceSheet, { current, failed: false, pending: null, onPick: pick, onRetry: () => { if (pending) run(pending); } }, { name: APPEARANCE_OVERLAY });
  return overlayId;
}

/** 「我的」页的外观行：标准字号三段一行；AX 档「外观 …… 当前值 ›」点开弹层。 */
export function AppearanceRow({ current }) {
  const ax = useAxLevel();
  const [fail, setFail] = useState(null); // {value}
  const pick = value => {
    if (value === current) return;
    const result = attempt(value);
    setFail(result && result.ok ? null : { value });
  };
  const failNode = fail
    ? html`<div class="sz-mine__afail">${FailBlock({
      testid: 'mine-appearance-fail', text: t('X-SETTINGS.saveFailed'), cancelLabel: t('X-SETTINGS.cancel'), retryLabel: t('X-SETTINGS.retry'),
      attrs: { 'data-field': `appearance:${fail.value}` }, onCancel: () => setFail(null), onRetry: () => pick(fail.value),
    })}</div>`
    : null;
  if (ax > 0) {
    return html`<${Row} testid="mine-appearance" name=${t('R-S03.appearance')} value=${label(current)} valueTestid="mine-appearance-value"
      onClick=${() => openAppearanceSheet(current)} extra=${{ 'data-value': current, 'data-mode': 'pick', 'aria-haspopup': 'dialog' }} />`;
  }
  return html`<${RowShell} testid="mine-appearance" cls="sz-rrow--seg" name=${t('R-S03.appearance')}>
    <${AppearanceSeg} current=${current} onPick=${pick} />
  </${RowShell}>${failNode}`;
}
