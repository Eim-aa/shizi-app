// 居中确认框（遮罩栈里的一层）：标题 + 正文 + 左右两键（左「取消类」、右「确认类」）。
// 规格取设计系统 v1（P1-E1b）：左右页边 20、垂直居中、24px 圆角（--r-box）、--elev 底、padding 24 20 20、gap 12；
// 转场 T-confirm（D58）：进场 200ms 由 0.96 放大淡入（ease.out），退场 180ms 淡出（ease.in，ui/components/exit.js，P1-07）；减少动态效果 150ms 淡化。
// 标题宋体 22/30；正文 15/22 ink2；两键 1fr 1fr、gap 12。
// 失败三段式（R-G04）由调用方用 nav.updateOverlay(id, {body, cancelLabel, confirmLabel}) 换文案实现，
// 确认框自身不关闭；成功后调用方 close()。不预选任何按钮（焦点落在对话框本身）。
// 读屏名字：有标题取标题（正文作描述）；没有标题（如看答案确认 R-W07）取正文（M6-1 走查：alertdialog 必须有名字）。
import { html, useRef } from '../../../vendor/ui.js';
import { Button } from './Button.js';
import { useDialogFocus } from './Sheet.js';
import { useOverlayBack } from '../back-action.js';
import { injectStyles, SCROLL_Y, T } from './styles.js';
import { M } from '../../config/motion.js';

injectStyles('confirm', `
.sz-confirm{position:absolute;left:${T.gutter};right:${T.gutter};top:50%;transform:translateY(-50%);box-sizing:border-box;
  max-height:calc(100% - 48px);${SCROLL_Y};border-radius:${T.rBox};background:${T.elev};box-shadow:${T.elevShadow};
  padding:${T.s6} ${T.s5} ${T.s5};display:flex;flex-direction:column;gap:${T.s3};color:${T.ink1};
  animation:sz-confirm-in ${T.dM} ${T.eOut} backwards}
.sz-confirm:focus{outline:none}
.sz-confirm[data-drag="snap"]{transition:transform ${T.dM} ${T.eOut}} /* 左缘右滑跟手后回弹（P1-06，ui/overlay-gesture.js） */
.sz-confirm__title{margin:0;font-family:${T.song};font-size:${T.fs22};line-height:${T.lh22};font-weight:500}
.sz-confirm__body{margin:0;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};white-space:pre-line}
.sz-confirm__actions{margin-top:${T.s1};display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:${T.s3}}
.sz-confirm__actions--one{grid-template-columns:minmax(0,1fr)}
@keyframes sz-confirm-in{from{opacity:0;transform:translateY(-50%) scale(${M.scale.confirmFrom})}to{opacity:1;transform:translateY(-50%)}}
@keyframes sz-confirm-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.sz-confirm{animation:sz-confirm-fade ${T.dReduce} ${T.eLinear} backwards}}
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
 * @param {object} [props.attrs]  落在对话框根节点上的额外属性（data-*）
 * @param {{cancel?:string, confirm?:string, title?:string, body?:string}} [props.testids]  按钮 / 标题 / 正文的 data-testid（缺省 confirm-cancel / confirm-ok，标题和正文不带）
 * @param {any} [props.children]  正文之后、按钮之前的补充内容（例：替换备份时「会丢失哪几天的记录」）
 */
export function Confirm({ title, body, cancelLabel, confirmLabel, onCancel, onConfirm, busy = false, close, active = true, testid, attrs = null, testids = null, children = null }) {
  const panelRef = useRef(null);
  const idsRef = useRef(null);
  if (!idsRef.current) {
    seq += 1;
    idsRef.current = { title: `sz-confirm-title-${seq}`, body: `sz-confirm-body-${seq}` };
  }
  useDialogFocus(panelRef, active);
  const cancel = () => (onCancel ? onCancel() : close && close());
  useOverlayBack(cancel); // Esc / 两指 Z 形 / 左缘右滑关这个确认框时走同一个「取消类」（P2-17）
  const ids = idsRef.current;
  const tids = testids || {};
  return html`<div class="sz-overlay" data-overlay="confirm">
    <div class="sz-scrim" aria-hidden="true" onClick=${cancel}></div>
    <div class="sz-confirm" role="alertdialog" aria-modal="true" tabindex="-1" ref=${panelRef} data-testid=${testid} ...${attrs || {}}
      aria-labelledby=${title ? ids.title : body ? ids.body : undefined} aria-describedby=${title && body ? ids.body : undefined}>
      ${title ? html`<h2 class="sz-confirm__title" id=${ids.title} data-testid=${tids.title}>${title}</h2>` : null}
      ${body ? html`<p class="sz-confirm__body" id=${ids.body} data-testid=${tids.body}>${body}</p>` : null}
      ${children}
      <div class=${cancelLabel ? 'sz-confirm__actions' : 'sz-confirm__actions sz-confirm__actions--one'}>
        ${cancelLabel ? html`<${Button} variant="secondary" data-testid=${tids.cancel || 'confirm-cancel'} disabled=${busy} onClick=${cancel}>${cancelLabel}</${Button}>` : null}
        <${Button} variant="primary" data-testid=${tids.confirm || 'confirm-ok'} disabled=${busy} onClick=${() => onConfirm && onConfirm()}>${confirmLabel}</${Button}>
      </div>
    </div>
  </div>`;
}
