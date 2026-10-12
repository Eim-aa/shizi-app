// 撤销底栏（R-G05、决定-D24）：两行说明 + 「撤销」按钮；撤销成功后换成「已撤销」2.4s。
// 寿命「离开这一页前可以撤销」由所在页面负责：底栏画在页面里，离开页面即卸载。
// 撤销失败（10.15）由调用方换 line1/line2（如「没能撤销，…」「可以再点一次撤销」），按钮保留。
// 规格取设计系统 v1 的 Toast / 撤销条（P1-E1b）：左右页边 20、距底 --ubb（默认 max(32, 安全区)）、最小高 48（两行说明时随内容）、12px 圆角（--r-ctl）、
// --toast-bg 底 / --toast-fg 字（无阴影）、15px/22px、内边距 左 16 右 8（「撤销」是 44 高的文字按钮）。
// 进出 T-fade（150ms 淡化，D58）：出现淡入；页面把它拿掉、或「已撤销」到时收起时，原位淡出（ui/components/exit.js，P1-07）。
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../vendor/ui.js';
import { Button } from './Button.js';
import { injectStyles, T } from './styles.js';
import { playExit } from './exit.js';
import { M } from '../../config/motion.js';
import { t } from '../../config/copy/index.js';

export const UNDONE_MS = M.timing.undone;

// 按钮与撤销后状态的文案（copy/common.js X-COMMON）；两行说明由调用方从各屏文案表传入。
export const UNDO_COPY = Object.freeze({
  undo: t('X-COMMON.undo'),
  undone: t('X-COMMON.undone'),
});

injectStyles('undobar', `
.sz-undobar{position:absolute;left:${T.gutter};right:${T.gutter};bottom:var(--ubb, max(${T.s8}, env(safe-area-inset-bottom, 0px)));z-index:15;
  box-sizing:border-box;min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:${T.s3};
  padding:${T.s2} ${T.s2} ${T.s2} ${T.s4};border-radius:${T.rCtl};background:${T.toastBg};color:${T.toastFg};
  font-size:${T.fs15};line-height:${T.lh15};animation:sz-fade-in ${T.dFade} ${T.eLinear} backwards}
@media (prefers-reduced-motion: reduce){.sz-undobar{animation-duration:${T.dReduce}}}
.sz-undobar__text{display:flex;flex-direction:column;min-width:0}
.sz-undobar .sz-btn--text{color:${T.toastFg};font-weight:500;font-size:${T.fs15};flex:none;margin-inline:0}
.sz-undobar .sz-btn--text[disabled]{opacity:.55}
`);

/**
 * @param {object} props
 * @param {string} props.line1
 * @param {string} [props.line2]
 * @param {() => void} props.onUndo
 * @param {boolean} [props.done]  true 时显示「已撤销」，UNDONE_MS 后自行隐藏并调用 onDoneEnd
 * @param {() => void} [props.onDoneEnd]
 * @param {boolean} [props.busy]
 */
export function UndoBar({ line1, line2, onUndo, done = false, onDoneEnd, busy = false }) {
  const [expired, setExpired] = useState(false);
  const ref = useRef(null);
  // 退场：卸载（页面拿掉它）前原位淡出
  useLayoutEffect(() => () => playExit(ref.current, 'fade'), []);
  useEffect(() => {
    setExpired(false);
    if (!done) return undefined;
    const t = setTimeout(() => {
      playExit(ref.current, 'fade'); // 「已撤销」到时自己收起：摘掉之前原位淡出
      setExpired(true);
      if (onDoneEnd) onDoneEnd();
    }, UNDONE_MS);
    return () => clearTimeout(t);
  }, [done]);
  if (done) {
    if (expired) return null;
    return html`<div class="sz-undobar" ref=${ref} role="status" aria-live="polite" data-testid="undo-bar">${UNDO_COPY.undone}</div>`;
  }
  return html`<div class="sz-undobar" ref=${ref} data-testid="undo-bar">
    <span class="sz-undobar__text" role="status" aria-live="polite">
      <span>${line1}</span>${line2 ? html`<span>${line2}</span>` : null}
    </span>
    <${Button} variant="text" data-testid="undo-button" disabled=${busy} onClick=${onUndo}>${UNDO_COPY.undo}</${Button}>
  </div>`;
}
