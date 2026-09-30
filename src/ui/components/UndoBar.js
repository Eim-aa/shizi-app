// 撤销底栏（R-G05、决定-D24）：两行说明 + 「撤销」按钮；撤销成功后换成「已撤销」2.4s。
// 寿命「离开这一页前可以撤销」由所在页面负责：底栏画在页面里，离开页面即卸载。
// 撤销失败（10.15）由调用方换 line1/line2（如「没能撤销，…」「可以再点一次撤销」），按钮保留。
// 规格取原型模板 undo 条：左右 16px、距底 --ubb（默认 34px）、16px 圆角、深底 #3B2F28 / 字 #F4F0E7、15px/22px。
import { html, useEffect, useState } from '../../../vendor/ui.js';
import { Button } from './Button.js';
import { injectStyles } from './styles.js';
import { t } from '../../config/copy/index.js';

export const UNDONE_MS = 2400;

// 按钮与撤销后状态的文案（copy/common.js X-COMMON）；两行说明由调用方从各屏文案表传入。
export const UNDO_COPY = Object.freeze({
  undo: t('X-COMMON.undo'),
  undone: t('X-COMMON.undone'),
});

injectStyles('undobar', `
.sz-undobar{position:absolute;left:16px;right:16px;bottom:var(--ubb, max(34px, env(safe-area-inset-bottom, 0px)));z-index:15;
  box-sizing:border-box;min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:14px 16px;border-radius:16px;background:#3B2F28;color:#F4F0E7;box-shadow:var(--ubs, 0 8px 24px rgba(48,38,26,.18));
  font-size:15px;line-height:22px}
.sz-undobar__text{display:flex;flex-direction:column;min-width:0}
.sz-undobar .sz-btn--text{color:#F4F0E7;font-weight:500;font-size:15px;flex:none}
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
  useEffect(() => {
    setExpired(false);
    if (!done) return undefined;
    const t = setTimeout(() => {
      setExpired(true);
      if (onDoneEnd) onDoneEnd();
    }, UNDONE_MS);
    return () => clearTimeout(t);
  }, [done]);
  if (done) {
    if (expired) return null;
    return html`<div class="sz-undobar" role="status" aria-live="polite" data-testid="undo-bar">${UNDO_COPY.undone}</div>`;
  }
  return html`<div class="sz-undobar" data-testid="undo-bar">
    <span class="sz-undobar__text" role="status" aria-live="polite">
      <span>${line1}</span>${line2 ? html`<span>${line2}</span>` : null}
    </span>
    <${Button} variant="text" data-testid="undo-button" disabled=${busy} onClick=${onUndo}>${UNDO_COPY.undo}</${Button}>
  </div>`;
}
