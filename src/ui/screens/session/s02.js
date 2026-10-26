// S02 开新组确认框（R-H05 / T08 / N50；决定-D05 / D22；03 P38；01 §3.3）。
//
// 开新的「这次选的字」而上一组（B）还没写完时弹出（入口：首页自己选字、清单练这些字、查字练这个字、单字详情练这个字——
// 都经 src/ui/screens/session/index.js startPicked）。
//   正文：「上一组还有「鲜」「境」没写。」——列出旧 B 还没写的字（含当前字，core/sessions.s02Prompt）。
//   三键（原型可点原型模板 L95–L96：主按钮一行，次按钮一行，「取消」文字键）：
//     接着写那组        → 关框，打开旧 B 的写字页（不写入）；
//     结束那组，开新的  → 一次 commit（core/session-start.endOldAndStartPicked）：旧 B 置 endedEarly 移入 lastEnded.B + 建新 B；
//                         P38 过渡不进旧组结果页，关框后也不弹提示（D58 / I3 P0-10；旧组判断过的字已经记下）；
//                         **保存失败留在确认框**（R-G04 三段式：说明句 + 再试一次 / 先不保存），旧组、新组都不动；
//     取消              → 关框，不写入。
// 不预选任何按钮（焦点落在对话框本身，useDialogFocus）；按钮一律 <button>，禁用 disabled + aria-disabled。
//
// data-testid：s02-dialog（data-state=ask|failed）、s02-body、s02-continue、s02-end-start、s02-cancel、
//              s02-retry、s02-fail-cancel。

import { html, useRef } from '../../../../vendor/ui.js';
import { nav, registerScreen } from '../../router.js';
import { Button } from '../../components/Button.js';
import { useDialogFocus } from '../../components/Sheet.js';
import { Announce, FailBlock } from '../../components/FailBlock.js';
import '../../components/Confirm.js'; // .sz-overlay / .sz-confirm 样式
import { injectStyles, T } from '../../components/styles.js';
import { format, t } from '../../../config/copy/index.js';
import { nativeScreenOn } from '../../native-stage.js';
import { setS02Actions, setQueryLayout } from '../../../session/api/query.js';
import { s02BodyLineStarts } from '../../components/query/layout.js';

export const S02_OVERLAY = 's02';
/**
 * 原生 S02 的屏名（与 Swift 的 ShiziScreen_s02 一一对应）。
 * 常量名里不带数字：契约测试扫 registerScreen 的正则只认字母与下划线（原生类的名字可以带数字）。
 */
export const CONFIRM_SCREEN = 's02';

injectStyles('session-s02', `
.sz-s02__actions{margin-top:4px;display:flex;flex-direction:column;gap:12px}
.sz-s02__cancel{align-self:stretch;justify-content:center;color:${T.ink2}}
`);

/** 「鲜」「境」→ 正文里的 {chars}。 */
export function quoteChars(chars) {
  return (chars || []).map(c => `「${c}」`).join('');
}

/** S02 正文（R-H05.body）。 */
export function s02Body(chars) {
  return format(t('R-H05.body'), { chars: quoteChars(chars) });
}

let seq = 0;

/**
 * 确认框组件（作为 overlay 用）。
 * @param {object} props
 * @param {string[]} props.chars        旧 B 没写的字
 * @param {boolean} [props.failed]      「结束那组，开新的」保存失败（留在确认框）
 * @param {() => void} props.onContinue
 * @param {() => void} props.onEndStart  「结束那组，开新的」与失败后的「再试一次」
 * @param {() => void} [props.close]
 * @param {boolean} [props.active]
 */
export function S02Dialog({ chars, failed = false, onContinue, onEndStart, close, active = true }) {
  const panelRef = useRef(null);
  const idRef = useRef(null);
  if (!idRef.current) {
    seq += 1;
    idRef.current = `sz-s02-body-${seq}`;
  }
  useDialogFocus(panelRef, active);
  const cancel = () => close && close();
  const body = failed ? t('X-SESSION.s02SaveFailed') : s02Body(chars);
  // 失败：就地三段式（S1，components/FailBlock.js dialog）：说明是上面的正文（换文字时经常驻播报区读一次：Announce），[先不保存 | 再试一次] 横排、顺序与全 App 相同（审计 P1-25）
  const actions = failed
    ? html`${FailBlock({ layout: 'dialog', text: '', testid: 's02-fail', cancelTestid: 's02-fail-cancel', retryTestid: 's02-retry', cancelLabel: t('X-SESSION.s02Cancel'), retryLabel: t('X-SESSION.s02Retry'), onCancel: cancel, onRetry: onEndStart })}`
    : html`<div class="sz-s02__actions">
        <${Button} variant="primary" data-testid="s02-continue" onClick=${onContinue}>${t('R-H05.continueOld')}</${Button}>
        <${Button} variant="secondary" data-testid="s02-end-start" onClick=${onEndStart}>${t('R-H05.endOldStartNew')}</${Button}>
        <${Button} variant="text" class="sz-s02__cancel" data-testid="s02-cancel" onClick=${cancel}>${t('R-H05.cancel')}</${Button}>
      </div>`;
  return html`<div class="sz-overlay" data-overlay="confirm">
    <div class="sz-scrim" aria-hidden="true" onClick=${cancel}></div>
    <div class="sz-confirm" role="alertdialog" aria-modal="true" tabindex="-1" ref=${panelRef} data-testid="s02-dialog"
      data-state=${failed ? 'failed' : 'ask'} aria-labelledby=${idRef.current}>
      <p class="sz-confirm__body" id=${idRef.current} data-testid="s02-body">${body}</p>
      ${failed ? Announce({ text: body }) : null}
      ${actions}
    </div>
  </div>`;
}

/**
 * 打开 S02。
 * @param {object} o
 * @param {string[]} o.chars                     旧 B 没写的字（s02Prompt.unwrittenChars）
 * @param {() => void} o.onContinue              「接着写那组」：关框之后调用（打开旧 B）
 * @param {() => ({ok:boolean})} o.onEndStart    「结束那组，开新的」的一次 commit；{ok:false} 时留在确认框
 * @param {(result) => void} [o.onStarted]       commit 成功、关框之后调用（打开新 B）
 * @returns overlay id
 */
export function openS02({ chars, onContinue, onEndStart, onStarted }) {
  if (nativeScreenOn(CONFIRM_SCREEN)) {
    // 原生确认框（B3.6）：推入一屏原生宿主；三个键经 App API（s02.decide）回到网页这一侧的同一批回调。
    setS02Actions({ onContinue, onEndStart, onStarted });
    // 正文的折行点（网页量的；原生按这些位置换行）。
    setQueryLayout({ s02Body: s02BodyLineStarts });
    nav.push(CONFIRM_SCREEN, { chars: [...(chars || [])] });
    return CONFIRM_SCREEN;
  }
  let id = null;
  let done = false;
  const endStart = () => {
    if (done) return;
    const result = onEndStart();
    if (result && result.ok) {
      done = true;
      nav.closeOverlay(id);
      if (onStarted) onStarted(result);
      return;
    }
    nav.updateOverlay(id, { failed: true });
  };
  const cont = () => {
    if (done) return;
    done = true;
    nav.closeOverlay(id);
    if (onContinue) onContinue();
  };
  id = nav.openOverlay(S02Dialog, { chars: [...(chars || [])], failed: false, onContinue: cont, onEndStart: endStart },
    { name: S02_OVERLAY });
  return id;
}

// 原生确认框那一屏的网页兜底（原生开关关着时万一被推入）：画网页版确认框。
function S02Fallback(p) {
  const params = (p && p.params) || {};
  return html`<${S02Dialog} chars=${params.chars || []} failed=${false} active=${false} />`;
}

registerScreen(CONFIRM_SCREEN, S02Fallback, { native: true });
