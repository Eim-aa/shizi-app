// 「我的」页的「几选一」设置行（D63 ③ 外观、D65 #2 每组字数共用同一种选择方式，规则一处定）：
//   标准字号：行内分段（选项一次点到，点一下即生效，F5：无确认、无提示条）；
//   AX 大字号（:root[data-ax]）分段放不下：同一行改成「名称 …… 当前值 ›」，点开底部选择弹层（同一组选项，点一项即选定并关）。
// 写入失败（D07 / R-G04）：行下（或弹层里）就地三段式「没保存上，刚才的选择没记下。先不保存 / 再试一次」，选中停在原值；再试一次 = 同一目标值再 commit 一次。
//
// 交互规范里没有「分段控件」的条款（规范 §5–§8 只有按钮 / 开关 / 弹层）：本控件按 radiogroup 实现——整段一个 radiogroup，每项是 ≥ 44 的 radio 按钮，
// 按压反馈用按钮同一套（data-pressed），选中滑块不做动画（减少动态效果下终态相同）。外观行最早这样做（已在 R7-M1 报告中登记待补规范），每组字数沿用。
//
// cfg = { testid, title, options:[value], label:(value)=>string（分段与弹层里每项的字）, valueText?:(value)=>string（AX 行右侧的值，缺省 = label），
//         commit:(store, value)=>result, overlay:string（弹层名）, failField:string（三段式 data-field 前缀） }
// data-testid（以 cfg.testid 为前缀，外观 = mine-appearance，与 R7-M1 起的 e2e 一致）：
//   {testid}（行；data-value / data-mode = seg | pick）、{testid}-seg（radiogroup）、{testid}-option（radio；data-value；aria-checked）、
//   {testid}-value（AX 档行的值）、{testid}-fail（+ -cancel / -retry）；弹层：{testid}-sheet、{testid}-sheet-option、{testid}-sheet-fail。

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

injectStyles('mine-choice', `
.sz-seg{flex:none;display:flex;padding:2px;border-radius:${T.rCtl};background:${T.field};min-width:0}
.sz-seg__opt.sz-btn{flex:none;min-height:44px;padding:0 ${T.s3};border-radius:calc(${T.rCtl} - 3px);display:flex;align-items:center;justify-content:center;
  font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};white-space:nowrap}
.sz-seg__opt[aria-checked="true"]{background:${T.sheet};color:${T.ink1};font-weight:500;box-shadow:0 0 0 ${T.hair} ${T.line}}
.sz-seg--num .sz-seg__opt.sz-btn{min-width:44px;padding:0 ${T.s2};font-variant-numeric:tabular-nums}
.sz-rrow--seg{padding:${T.s1} 0}
.sz-mine__afail{padding:${T.s3} 0 0}
.sz-mine__opts{display:flex;flex-direction:column;border-top:${T.hair} solid ${T.line}}
.sz-mine__opt{box-sizing:border-box;width:100%;min-height:52px;padding:${T.s2} 0;display:flex;align-items:center;justify-content:space-between;
  gap:${T.s3};border-bottom:${T.hair} solid ${T.line};font-size:${T.fs17};text-align:left;color:${T.ink1}}
.sz-mine__check{flex:none;width:22px;height:22px;color:${T.ink1};visibility:hidden}
.sz-mine__opt[aria-checked="true"] .sz-mine__check{visibility:visible}
.sz-mine__opt[aria-checked="true"]{font-weight:500}
`);

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const CHECK_ICON = () => Icons.checkLarge({ cls: 'sz-mine__check' });

function attempt(cfg, value) {
  try {
    return cfg.commit(getStore(), value);
  } catch (error) {
    return { ok: false, error: { kind: 'unknown', reason: error && error.message ? error.message : String(error) } };
  }
}

function failBlock(cfg, testid, value, onCancel, onRetry) {
  return html`<div class="sz-mine__afail">${FailBlock({
    testid, text: t('X-SETTINGS.saveFailed'), cancelLabel: t('X-SETTINGS.cancel'), retryLabel: t('X-SETTINGS.retry'),
    attrs: { 'data-field': `${cfg.failField}:${value}` }, onCancel, onRetry,
  })}</div>`;
}

/** 分段（行内）。 */
export function ChoiceSeg({ cfg, current, onPick }) {
  return html`<div class=${cfg.numeric ? 'sz-seg sz-seg--num' : 'sz-seg'} role="radiogroup" aria-label=${cfg.title} data-testid=${`${cfg.testid}-seg`} data-value=${current}>
    ${cfg.options.map(value => html`<${Button} key=${String(value)} variant="plain" class="sz-seg__opt" role="radio" rapid
      aria-checked=${value === current ? 'true' : 'false'} aria-label=${cfg.ariaLabel ? cfg.ariaLabel(value) : undefined}
      data-testid=${`${cfg.testid}-option`} data-value=${value}
      onClick=${() => onPick(value)}>${cfg.label(value)}</${Button}>`)}
  </div>`;
}

/** AX 档弹层（纯视图）。 */
export function ChoiceSheetView({ cfg, current, failed = false, pending = null, onPick, onCancel, onRetry, close, active = true }) {
  const sheetLabel = cfg.sheetLabel || cfg.label;
  return html`<${Sheet} title=${cfg.title} onClose=${close} active=${active} testid=${`${cfg.testid}-sheet`}>
    <div class="sz-mine__opts" role="radiogroup" aria-label=${cfg.title} data-state=${failed ? 'failed' : 'pick'}>
      ${cfg.options.map(value => html`<${Button} key=${String(value)} variant="plain" class="sz-mine__opt" role="radio"
        aria-checked=${value === current ? 'true' : 'false'} data-testid=${`${cfg.testid}-sheet-option`} data-value=${value}
        onClick=${() => onPick(value)}><span>${sheetLabel(value)}</span>${CHECK_ICON()}</${Button}>`)}
    </div>
    ${failed ? failBlock(cfg, `${cfg.testid}-sheet-fail`, pending, onCancel, onRetry) : null}
  </${Sheet}>`;
}

function ChoiceSheet({ cfg, current, failed = false, pending = null, onPick, onRetry, close, active = true }) {
  return ChoiceSheetView({ cfg, current, failed, pending, onPick, onCancel: close, onRetry, close, active });
}

/** 点当前项 → 关；点别的 → commit，成功关，失败就地换成三段式（再试一次 = 同一选择）。 */
export function openChoiceSheet(cfg, current) {
  let overlayId = null;
  let done = false;
  let pending = null;
  const run = value => {
    if (done) return;
    const result = attempt(cfg, value);
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
  overlayId = nav.openOverlay(ChoiceSheet, { cfg, current, failed: false, pending: null, onPick: pick, onRetry: () => { if (pending !== null) run(pending); } }, { name: cfg.overlay });
  return overlayId;
}

/** 一行：标准字号分段；AX 档「名称 …… 当前值 ›」点开弹层。 */
export function ChoiceRow({ cfg, current }) {
  const ax = useAxLevel();
  const [fail, setFail] = useState(null); // {value}
  const pick = value => {
    if (value === current) return;
    const result = attempt(cfg, value);
    setFail(result && result.ok ? null : { value });
  };
  const failNode = fail ? failBlock(cfg, `${cfg.testid}-fail`, fail.value, () => setFail(null), () => pick(fail.value)) : null;
  if (ax > 0) {
    const valueText = cfg.valueText || cfg.label;
    return html`<${Row} testid=${cfg.testid} name=${cfg.title} value=${valueText(current)} valueTestid=${`${cfg.testid}-value`}
      onClick=${() => openChoiceSheet(cfg, current)} extra=${{ 'data-value': current, 'data-mode': 'pick', 'aria-haspopup': 'dialog' }} />`;
  }
  return html`<${RowShell} testid=${cfg.testid} cls="sz-rrow--seg" name=${cfg.title}>
    <${ChoiceSeg} cfg=${cfg} current=${current} onPick=${pick} />
  </${RowShell}>${failNode}`;
}
