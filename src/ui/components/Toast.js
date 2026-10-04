// 轻提示：showToast(text) 显示一条，新的替换旧的，默认 3.2s 后消失（原型 note()：3200ms）。
// 跨页面保留（例如写字页返回首页后显示「已保存，下次接着写」，走查-W18）。
// <ToastHost/> 由 ui/root.js 挂一次；role=status + aria-live=polite（01-架构设计 §7）。
// 规格取设计系统 v1 的 Toast（P1-E1b，tokens.json components.toast）：左右页边 20、距底 110px（在 tab 条上方）、最小高 48、12px 圆角（--r-ctl）、
// --toast-bg 底 / --toast-fg 字、15px/22px、没有圆点；底边一条 2px 计时线（currentColor 35%，在显示时长内收尽；减少动态效果时不动画）。
import { html, useEffect, useState } from '../../../vendor/ui.js';
import { injectStyles, T } from './styles.js';

export const TOAST_MS = 3200;

let current = null; // {id, text, duration}
let timer = null;
let toastSeq = 0;
const listeners = new Set();

function publish() {
  for (const fn of [...listeners]) fn(current);
}

export function showToast(text, { duration = TOAST_MS } = {}) {
  toastSeq += 1;
  current = { id: toastSeq, text: String(text), duration };
  if (timer) clearTimeout(timer);
  const id = toastSeq;
  timer = setTimeout(() => {
    if (current && current.id === id) {
      current = null;
      publish();
    }
  }, duration);
  publish();
  return id;
}

export function hideToast() {
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  publish();
}

injectStyles('toast', `
.sz-toast-host{position:absolute;left:${T.gutter};right:${T.gutter};bottom:calc(110px + env(safe-area-inset-bottom, 0px));z-index:40;
  pointer-events:none;display:flex;justify-content:center}
@keyframes sz-toast-timer{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.sz-toast{position:relative;overflow:hidden;box-sizing:border-box;width:100%;min-height:48px;display:flex;align-items:center;
  padding:${T.s3} ${T.s4};border-radius:${T.rCtl};background:${T.toastBg};color:${T.toastFg};animation:sz-fade-in .2s ease-out both}
.sz-toast__text{flex:1;font-size:${T.fs15};line-height:${T.lh15};color:inherit}
.sz-toast__timer{position:absolute;left:0;right:0;bottom:0;height:2px;background:currentColor;opacity:.35;transform-origin:left center;
  animation:sz-toast-timer linear both}
@media (prefers-reduced-motion: reduce){.sz-toast{animation:none}.sz-toast__timer{animation:none}}
`);

// 常驻的 live region：容器一直在，文字变化时读屏才会播报。
export function ToastHost() {
  const [toast, setToast] = useState(current);
  useEffect(() => {
    listeners.add(setToast);
    setToast(current);
    return () => listeners.delete(setToast);
  }, []);
  return html`<div class="sz-toast-host" role="status" aria-live="polite" aria-atomic="true" data-testid="toast-host">
    ${toast ? html`<div class="sz-toast" key=${toast.id} data-testid="toast">
      <span class="sz-toast__text">${toast.text}</span>
      <span class="sz-toast__timer" aria-hidden="true" data-testid="toast-timer" style=${{ animationDuration: `${toast.duration || TOAST_MS}ms` }}></span>
    </div>` : null}
  </div>`;
}
