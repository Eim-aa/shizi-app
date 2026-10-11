// 轻提示：showToast(text) 显示一条，新的替换旧的，默认 3.2s 后消失（原型 note()：3200ms）。
// 跨页面保留（换页后仍在显示；写字页返回首页不再出「已保存」条，R4-F1 / P262）。
// <ToastHost/> 由 ui/root.js 挂一次；role=status + aria-live=polite（01-架构设计 §7）。
// 位置（H1 / I2-04）：默认距底 110px；当前页的主按钮（.sz-btn--primary，或元素上声明 data-toast-anchor）压住这个位置时整条抬到它上沿之上 12，不再盖住主操作（toastBottom）。
// 规格取设计系统 v1 的 Toast（P1-E1b，tokens.json components.toast）：左右页边 20、距底 110px（在 tab 条上方）、最小高 48、12px 圆角（--r-ctl）、
// --toast-bg 底 / --toast-fg 字、15px/22px、没有圆点；底边一条 2px 计时线（currentColor 35%，在显示时长内收尽；减少动态效果时不动画）。
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../vendor/ui.js';
import { injectStyles, T } from './styles.js';

export const TOAST_MS = 3200;
/** Toast 与当前页主操作上沿的间距（I2-04：反馈不能遮挡主操作）。 */
export const TOAST_ANCHOR_GAP = 12;
/** 默认位置：距底 110 + 安全区（在 Tab 条上方），与样式一致。 */
export const TOAST_BOTTOM_DEFAULT = 110;

/**
 * Toast 放置规则（I2-04，纯函数）：默认距底 defaultBottom；默认位置的竖向范围与当前页某个主操作（锚点 {top, bottom}，自上而下坐标）相交时，
 * 整条抬到该主操作上沿之上 TOAST_ANCHOR_GAP；抬起后若又压到别的主操作就继续往上让。主操作在别处不动。返回 bottom（px，距视口下沿）。
 */
export function toastBottom({ appHeight, defaultBottom, toastHeight, anchors = [] } = {}) {
  if (!(appHeight > 0) || !(toastHeight > 0) || !Number.isFinite(defaultBottom)) return defaultBottom;
  const list = (anchors || []).filter(a => a && Number.isFinite(a.top) && Number.isFinite(a.bottom));
  let bottom = defaultBottom;
  for (let i = 0; i <= list.length; i += 1) {
    const edge = appHeight - bottom; // Toast 下沿
    const top = edge - toastHeight;
    const hit = list.filter(a => a.top < edge && a.bottom > top);
    if (!hit.length) break;
    const next = appHeight - (Math.min(...hit.map(a => a.top)) - TOAST_ANCHOR_GAP);
    if (next <= bottom) break;
    bottom = next;
  }
  return bottom;
}

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
.sz-toast-host{position:absolute;left:${T.gutter};right:${T.gutter};bottom:calc(110px + env(safe-area-inset-bottom, 0px));z-index:40; /* 默认位置；放在主操作上方时由 ToastHost 抬高（toastBottom） */
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
  const hostRef = useRef(null);
  useEffect(() => {
    listeners.add(setToast);
    setToast(current);
    return () => listeners.delete(setToast);
  }, []);
  // 反馈不能遮挡主操作（I2-04）：显示前量当前顶层页面里的主按钮（.sz-btn--primary / 声明了 data-toast-anchor 的元素），默认位置压住它就整条抬到它上沿之上 12
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.style.bottom = '';
    if (!toast) return;
    const layer = document.querySelector('.sz-layer[data-top="true"]');
    const app = host.offsetParent || document.documentElement;
    if (!layer || !app) return;
    const appRect = app.getBoundingClientRect();
    const box = host.getBoundingClientRect();
    const defaultBottom = appRect.bottom - box.bottom;
    const anchors = [...layer.querySelectorAll('.sz-btn--primary, [data-toast-anchor]')]
      .filter(el => typeof el.checkVisibility !== 'function' || el.checkVisibility())
      .map(el => el.getBoundingClientRect())
      .filter(r => r.width > 0 && r.height > 0)
      .map(r => ({ top: r.top - appRect.top, bottom: r.bottom - appRect.top }));
    const bottom = toastBottom({ appHeight: appRect.height, defaultBottom, toastHeight: box.height, anchors });
    if (bottom > defaultBottom + 0.5) host.style.bottom = `${Math.round(bottom)}px`;
  }, [toast && toast.id]);
  return html`<div ref=${hostRef} class="sz-toast-host" role="status" aria-live="polite" aria-atomic="true" data-testid="toast-host">
    ${toast ? html`<div class="sz-toast" key=${toast.id} data-testid="toast">
      <span class="sz-toast__text">${toast.text}</span>
      <span class="sz-toast__timer" aria-hidden="true" data-testid="toast-timer" style=${{ animationDuration: `${toast.duration || TOAST_MS}ms` }}></span>
    </div>` : null}
  </div>`;
}
