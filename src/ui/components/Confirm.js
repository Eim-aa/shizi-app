// 居中确认框（遮罩栈里的一层）：标题 + 正文 + 左右两键（左「取消类」、右「确认类」）。
// 规格取原型「居中确认通用」：左右 24px、垂直居中、24px 圆角、--elev 底、padding 24 20 20、gap 14；
// 标题宋体 20/1.45；正文 15/1.75 --i2；两键 1fr 1fr、gap 12。
// 失败三段式（R-G04）由调用方用 nav.updateOverlay(id, {body, cancelLabel, confirmLabel}) 换文案实现，
// 确认框自身不关闭；成功后调用方 close()。不预选任何按钮（焦点落在对话框本身）。
// 读屏名字：有标题取标题（正文作描述）；没有标题（如看答案确认 R-W07）取正文（M6-1 走查：alertdialog 必须有名字）。
import { html, useRef } from '../../../vendor/ui.js';
import { Button } from './Button.js';
import { useDialogFocus } from './Sheet.js';
import { injectStyles, T } from './styles.js';

injectStyles('confirm', `
.sz-confirm{position:absolute;left:24px;right:24px;top:50%;transform:translateY(-50%);box-sizing:border-box;
  max-height:calc(100% - 48px);overflow:auto;border-radius:${T.rBox};background:${T.elev};box-shadow:${T.elevShadow};
  padding:24px 20px 20px;display:flex;flex-direction:column;gap:14px;color:${T.ink1};
  animation:sz-confirm-in .2s cubic-bezier(.2,.7,.2,1) both}
.sz-confirm:focus{outline:none}
.sz-confirm__title{margin:0;font-family:${T.song};font-size:${T.fs22};line-height:${T.lh22};font-weight:500}
.sz-confirm__body{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};white-space:pre-line}
.sz-confirm__actions{margin-top:4px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.sz-confirm__actions--one{grid-template-columns:minmax(0,1fr)}
@keyframes sz-confirm-in{from{opacity:0;transform:translateY(-50%) scale(.96)}to{opacity:1;transform:translateY(-50%)}}
@media (prefers-reduced-motion: reduce){.sz-confirm{animation:none}}
`);

let seq = 0;

/**
 * 作为 overlay 组件使用：nav.openOverlay(Confirm, {title, body, cancelLabel, confirmLabel, onConfirm})。
 * root 会注入 close / active。
 * @param {object} props
 * @param {string} [props.title]
 * @param {string} [props.body]  换行用 \n
 * @param {string} [props.cancelLabel]  省略则只有一个按钮
 * @param {string} props.confirmLabel
 * @param {() => void} [props.onCancel]  默认 close()
 * @param {() => void} props.onConfirm
 * @param {boolean} [props.busy]  保存中：两键 disabled
 * @param {() => void} [props.close]
 * @param {boolean} [props.active]
 * @param {string} [props.testid]
 */
export function Confirm({ title, body, cancelLabel, confirmLabel, onCancel, onConfirm, busy = false, close, active = true, testid }) {
  const panelRef = useRef(null);
  const idsRef = useRef(null);
  if (!idsRef.current) {
    seq += 1;
    idsRef.current = { title: `sz-confirm-title-${seq}`, body: `sz-confirm-body-${seq}` };
  }
  useDialogFocus(panelRef, active);
  const cancel = () => (onCancel ? onCancel() : close && close());
  const ids = idsRef.current;
  return html`<div class="sz-overlay" data-overlay="confirm">
    <div class="sz-scrim" aria-hidden="true" onClick=${cancel}></div>
    <div class="sz-confirm" role="alertdialog" aria-modal="true" tabindex="-1" ref=${panelRef} data-testid=${testid}
      aria-labelledby=${title ? ids.title : body ? ids.body : undefined} aria-describedby=${title && body ? ids.body : undefined}>
      ${title ? html`<h2 class="sz-confirm__title" id=${ids.title}>${title}</h2>` : null}
      ${body ? html`<p class="sz-confirm__body" id=${ids.body}>${body}</p>` : null}
      <div class=${cancelLabel ? 'sz-confirm__actions' : 'sz-confirm__actions sz-confirm__actions--one'}>
        ${cancelLabel ? html`<${Button} variant="secondary" data-testid="confirm-cancel" disabled=${busy} onClick=${cancel}>${cancelLabel}</${Button}>` : null}
        <${Button} variant="primary" data-testid="confirm-ok" disabled=${busy} onClick=${() => onConfirm && onConfirm()}>${confirmLabel}</${Button}>
      </div>
    </div>
  </div>`;
}
