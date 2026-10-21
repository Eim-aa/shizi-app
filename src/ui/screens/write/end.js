// 结束这组（M2-3；决定-D22；01 §3.3 / §6.7；04 R-W15 / R-W16；边改 S04；原型 ShiziWriteScreen L152–L156、L216、L352、L628–L629）。
//
// 「结束这组」在这次选的字（picked，B 槽）和今天的练习（daily，A 槽）里有；首次练习（first，只有三个字，每字都能跳过）不放（D66 ⑥）。
// 位置在写字页「跳过」那一行的右边（紧凑版在「看答案 · 跳过 · 结束这组」一行的右端）。
// 除判断页（compare，没有底栏）之外的各阶段都显示：回忆、看答案、描一遍、自己写一遍（看答案流程的底栏里「下一个」那一行右端，
// answer.js endButton）；底栏被保存失败两键占住时不显示（原型「写完、保存失败、修改判断弹层开着时不显示」；M2 验收 H4）。
// 流程：
//   1. 点「结束这组」→ 居中确认（S04：主按钮「接着写」、「结束这组」普通按钮）：
//      「还有 {n} 个字没写，结束后就不写了。判断过的 {m} 个字已经记下。」——n = 没写的字（含当前字），m = 本组已判断的字（按记录算）。
//      不预选任何按钮（焦点落在对话框本身）；点遮罩 = 接着写。
//   2. 「结束这组」= 一次 store.commit（'write:end'）：会话移入 lastEnded[slot]，没写完时置 endedEarly（core/sessions.endSlot）。
//      当前字格子里的笔画不算记录（D22 口径：没写的字不算记录也不算跳过）。
//      成功 → 关确认框；有判断 → 写字页就地换成结果页（nav.replace，01 §3.3）；零判断 → 回来源（nav.back）+ 轻提示
//      「这组结束了，没有记下字。」。
//      失败 → **留在确认框**（R-G04 三段式）：正文换「没保存上，你写的字还在。」、按钮换 [先不保存 / 再试一次]；会话不动，
//      重试成功后才结束（D22 / 2.6）。
//
// 规则：只经 store.commit 写存储；会话用 core/sessions。文案只取 copy/（R-W15 / R-W16）。
//
// data-testid：write-end（写字页上的「结束这组」）、write-end-dialog（确认框面板，data-state=ask|failed）、write-end-body、
//   write-end-continue（接着写）、write-end-confirm（结束这组）、write-end-retry（再试一次）、write-end-fail-cancel（先不保存）。

import { html, useRef } from '../../../../vendor/ui.js';
import { nav } from '../../router.js';
import { Button } from '../../components/Button.js';
import { useDialogFocus } from '../../components/Sheet.js';
import '../../components/Confirm.js'; // .sz-overlay / .sz-confirm 样式
import { haptic } from '../../../platform/haptics.js';
import { FailBlock } from '../../components/FailBlock.js';
import { HIT_EXT, injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';
import './answer.js';

// B2.1：提交函数与纯模型挪到无 DOM 的 src/session/（src/session/write-ops.js）；这里导入并原名转出，原导入路径照旧可用。
import { END_LABEL, judgedCountOf, endConfirmCounts, canEndGroup, endInDraft, commitEndGroup } from '../../../session/write-ops.js';
export { END_LABEL, judgedCountOf, endConfirmCounts, canEndGroup, endInDraft, commitEndGroup };
export const END_OVERLAY = 'write-end-dialog';
/** 结果页的屏名（result/index.js 自注册；这里只用名字导航，避免循环依赖）。 */
const RESULT_SCREEN = 'result';

injectStyles('write-end', `
.sz-end__btn{position:relative;min-height:44px;padding:0 8px;color:${T.ink2}}
.sz-end__btn::after{${HIT_EXT}} /* 盒子 44 高（D66 ⑥：今天的练习也有它，页面矩阵按盒子量 ≥ 44；页头本身最小 44 高，不撑高），热区 44（Q2-13） */
`);

// ---------------------------------------------------------------- 确认框

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

/**
 * S04 确认框的内容（纯视图，无 hook；单测直接调用）：正文 + 两键。
 * 主按钮「接着写」、「结束这组」普通按钮（S04）；失败态 [先不保存 / 再试一次]。
 */
export function EndDialogContent({ n = 0, m = 0, failed = false, onEnd, onCancel }) {
  const body = failed ? t('R-W16.saveFailed') : (m > 0 ? t('R-W15.confirmBody', { n, m }) : t('R-W15.confirmBodyNone', { n }));
  // 失败：弹层内容就地换成三段式（S1，components/FailBlock.js dialog：[先不保存 | 再试一次]；说明句就是上面的正文，常驻的 aria-live 段落换文字即播报）
  const actions = failed
    ? html`${FailBlock({ layout: 'dialog', text: '', testid: 'write-end-fail', cancelTestid: 'write-end-fail-cancel', retryTestid: 'write-end-retry', onCancel: onCancel, onRetry: () => onEnd && onEnd() })}`
    : html`<div class="sz-confirm__actions">
        <${Button} variant="secondary" data-testid="write-end-confirm" onClick=${() => onEnd && onEnd()}>${t('R-W15.end')}</${Button}>
        <${Button} variant="primary" data-testid="write-end-continue" onClick=${onCancel}>${t('R-W15.continue')}</${Button}>
      </div>`;
  return html`<p class="sz-confirm__body" id="sz-end-body" data-testid="write-end-body" aria-live="polite">${body}</p>
    ${actions}`;
}

/** S04 确认框（overlay 组件；root 注入 close / active）。不预选任何按钮（焦点落在对话框本身）；点遮罩 = 接着写。 */
export function EndDialog({ n = 0, m = 0, failed = false, onEnd, close, active = true }) {
  const panelRef = useRef(null);
  useDialogFocus(panelRef, active);
  const cancel = () => close && close();
  return html`<div class="sz-overlay" data-overlay="confirm">
    <div class="sz-scrim" aria-hidden="true" onClick=${cancel}></div>
    <div class="sz-confirm" role="alertdialog" aria-modal="true" tabindex="-1" ref=${panelRef} data-testid="write-end-dialog"
      data-state=${failed ? 'failed' : 'ask'} aria-describedby="sz-end-body">
      <${EndDialogContent} n=${n} m=${m} failed=${failed} onEnd=${onEnd} onCancel=${cancel} />
    </div>
  </div>`;
}

/**
 * 打开「结束这组」确认框。成功后关框：有判断 → nav.replace 结果页；零判断 → nav.back 回来源 + 轻提示。
 * @returns overlay id
 */
export function openEndConfirm({ slot, sessionId }) {
  const store = storeOrNull();
  const { n, m } = store ? endConfirmCounts(store.getState(), slot) : { n: 0, m: 0 };
  let id = null;
  let done = false;
  const onEnd = () => {
    if (done) return;
    const st = storeOrNull();
    const result = st ? commitEndGroup(st, { slot, sessionId }) : { ok: false, error: { kind: 'unavailable' } };
    if (result.ok) {
      done = true;
      nav.closeOverlay(id);
      if (result.judgedCount > 0) {
        haptic('light'); // F1：结束这组确认、换成结果页（零判断回来源不发，那里已不是写字流程，P1-35）
        nav.replace(RESULT_SCREEN, { slot, sessionId });
      } else {
        nav.back(); // 回到来源本身就是反馈，不弹提示（D58 / I3 P0-11）
      }
      return;
    }
    if (result.error && result.error.kind === 'stale') {
      done = true;
      nav.closeOverlay(id);
      return;
    }
    nav.updateOverlay(id, { failed: true });
  };
  id = nav.openOverlay(EndDialog, { n, m, failed: false, onEnd }, { name: END_OVERLAY });
  return id;
}

// ---------------------------------------------------------------- 写字页接线

/**
 * 写字页的「结束这组」接线。
 * @param {object} o
 * @param {'A'|'B'} o.slot
 * @param {object|null} o.session
 * @param {string} o.phase        有效阶段（compare 判断页不显示；其余阶段都显示，H4）
 * @param {boolean} [o.blocked]   底栏被保存失败两键占住（跳过失败；看答案流程的保存失败由 answer.js 自己隐藏）
 * @param {() => void} [o.onOpen] 打开确认框前（写字页用来结束跳过的撤销机会）
 * @returns {{shown:boolean, button:any, open:(()=>void)|null}}  open：打开确认框
 */
export function useEndGroup({ slot, session, phase, blocked = false, onOpen }) {
  const shown = canEndGroup(session) && phase !== 'compare' && !blocked;
  if (!shown) return { shown: false, button: null, open: null };
  const sessionId = session.id;
  const open = () => {
    if (typeof onOpen === 'function') onOpen();
    openEndConfirm({ slot, sessionId });
  };
  const button = html`<${Button} variant="text" class="sz-end__btn" data-testid="write-end" onClick=${open}>${t('R-W15.end')}</${Button}>`;
  return { shown: true, button, open };
}
