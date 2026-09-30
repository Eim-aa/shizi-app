// 轻提示：showToast(text) 显示一条，新的替换旧的，默认 3.2s 后消失（原型 note()：3200ms）。
// 跨页面保留（例如写字页返回首页后显示「已保存，下次接着写」，走查-W18）。
// <ToastHost/> 由 ui/root.js 挂一次；role=status + aria-live=polite（01-架构设计 §7）。
// 规格取原型 note 浮层：左右 24px、距底 110px（在 tab 条上方）、14px 圆角、--off 底、6px 圆点、15px/1.7 --i2。
import { html, useEffect, useState } from '../../../vendor/ui.js';
import { injectStyles, T } from './styles.js';

export const TOAST_MS = 3200;

let current = null; // {id, text}
let timer = null;
let toastSeq = 0;
const listeners = new Set();

function publish() {
  for (const fn of [...listeners]) fn(current);
}

export function showToast(text, { duration = TOAST_MS } = {}) {
  toastSeq += 1;
  current = { id: toastSeq, text: String(text) };
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
.sz-toast-host{position:absolute;left:24px;right:24px;bottom:calc(110px + env(safe-area-inset-bottom, 0px));z-index:40;
  pointer-events:none;display:flex;justify-content:center}
.sz-toast{box-sizing:border-box;width:100%;display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:14px;
  background:${T.off};box-shadow:0 6px 18px rgba(48,38,26,.10);animation:sz-fade-in .2s ease-out both}
.sz-toast__dot{width:6px;height:6px;margin-top:calc(8px * ${T.k});flex:none;border-radius:50%;background:${T.i2}}
.sz-toast__text{flex:1;font-size:calc(15px * ${T.k});line-height:1.7;color:${T.i2}}
@media (prefers-reduced-motion: reduce){.sz-toast{animation:none}}
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
      <span class="sz-toast__dot" aria-hidden="true"></span><span class="sz-toast__text">${toast.text}</span>
    </div>` : null}
  </div>`;
}
