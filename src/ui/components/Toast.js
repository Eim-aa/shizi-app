// 轻提示：showToast(text, {kind}) 显示一条，新的替换旧的，默认 timing.toast（3.2s）后消失（原型 note()：3200ms）。
// 用途只有两种（交互与动效规范 F3，D55 ② / D58）：kind 'failure'（失败，且失败发生的地方已不在屏上）与 'undo'（可撤销）。
// 成功、说明、引导一律不许用提示条：kind 缺省或不是这两种时 showToast 直接抛 TypeError（单测 test/ui/toast-kinds.test.mjs 静态扫描所有调用点）。
// 过渡用的 'legacy'（审计清单里还没删的旧调用）已在三张交互卡合并后（R5M）随待修清单清空一并删除。进出 T-fade（150ms 淡化；退场见 ui/components/exit.js，P1-07）。
// 跨页面保留（换页后仍在显示；写字页返回首页不再出「已保存」条，R4-F1 / P262）。
// <ToastHost/> 由 ui/root.js 挂一次；role=status + aria-live=polite（01-架构设计 §7）。
// 位置（H1 / I2-04）：默认距底 110px；当前页的主按钮（.sz-btn--primary，或元素上声明 data-toast-anchor）压住这个位置时整条抬到它上沿之上 12，不再盖住主操作（toastBottom）。
// 规格取设计系统 v1 的 Toast（P1-E1b，tokens.json components.toast）：左右页边 20、距底 110px（在 tab 条上方）、最小高 48、15px/22px、没有圆点；
// 外观是 L4 浮条（D71 ③）：浮起的浅面 --toast-bg（= elev）+ 1px --toast-line 细边 + --toast-shadow 轻阴影、24 圆角（--r-box，单行即胶囊），字 --toast-fg（ink1）；
// 底边一条 2px 计时线（ink3、40% 不透明，在显示时长内收尽；减少动态效果时不动画）。实心深色只给主按钮。
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../vendor/ui.js';
import { injectStyles, T } from './styles.js';
import { playExit } from './exit.js';
import { M } from '../../config/motion.js';

export const TOAST_MS = M.timing.toast;
/** 提示条只许这两种用途（F3）。 */
export const TOAST_KINDS = Object.freeze(['failure', 'undo']);
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

/** kind 校验（F3）：返回规范化的 kind；不合规抛 TypeError。 */
export function checkToastKind(kind) {
  if (TOAST_KINDS.includes(kind)) return kind;
  throw new TypeError(`showToast: kind must be ${TOAST_KINDS.map(k => `'${k}'`).join(' | ')} (F3: no toast for success or explanations), got ${JSON.stringify(kind)}`);
}

export function showToast(text, { kind, duration } = {}) {
  const k = checkToastKind(kind);
  const ms = Number.isFinite(duration) ? duration : k === 'undo' ? M.timing.toastWithAction : TOAST_MS;
  toastSeq += 1;
  current = { id: toastSeq, text: String(text), duration: ms, kind: k };
  if (timer) clearTimeout(timer);
  const id = toastSeq;
  timer = setTimeout(() => {
    if (current && current.id === id) {
      current = null;
      publish();
    }
  }, ms);
  publish();
  return id;
}

export function hideToast() {
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  publish();
}

// ---- 读屏播报区（S1 / F3 读屏补偿 / A2；审计 P1-27 / P1-39）：常驻、视觉隐藏的 aria-live=polite 区域，ToastHost 一并挂着。
// 屏上看得见、但读屏感知不到的状态变化（三段式失败的说明句、就地出现的提示）经 announce(text) 读一次，不抢焦点、不出可见提示条。
// 容器一直在、只换文字，iOS VoiceOver 才播得出来；同一句连着出现两次时交替追加零宽空格，让读屏再读一遍。
let spoken = '';
let spokenSeq = 0;
const speakers = new Set();

/** 经常驻播报区读一句（空串清空）。返回实际写进去的文字。 */
export function announce(text) {
  const s = String(text || '');
  spokenSeq += 1;
  spoken = s && spoken === s ? `${s}\u200b` : s;
  for (const fn of [...speakers]) fn(spoken);
  return spoken;
}

/** 测试：最近一次播报。 */
export function lastAnnounced() {
  return spoken.replace(/\u200b$/, '');
}

injectStyles('toast', `
.sz-toast-wrap{display:contents}
.sz-toast-host{position:absolute;left:${T.gutter};right:${T.gutter};bottom:calc(110px + env(safe-area-inset-bottom, 0px));z-index:40; /* 默认位置；放在主操作上方时由 ToastHost 抬高（toastBottom） */
  pointer-events:none;display:flex;justify-content:center}
@keyframes sz-toast-timer{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.sz-toast{position:relative;overflow:hidden;box-sizing:border-box;width:100%;min-height:48px;display:flex;align-items:center;
  padding:${T.s3} ${T.s4};border-radius:${T.rBox};background:${T.toastBg};color:${T.toastFg};border:1px solid ${T.toastLine};box-shadow:${T.toastShadow};animation:sz-fade-in ${T.dFade} ${T.eLinear} backwards}
.sz-toast.sz-exit{position:absolute;left:0;right:0;bottom:0} /* 退场的余影叠在原位，不与新的一条并排 */
.sz-toast__text{flex:1;font-size:${T.fs15};line-height:${T.lh15};color:inherit}
.sz-toast__timer{position:absolute;left:0;right:0;bottom:0;height:2px;background:${T.ink3};opacity:.4;transform-origin:left center;
  animation:sz-toast-timer ${T.eLinear} both}
@media (prefers-reduced-motion: reduce){.sz-toast{animation:sz-fade-in ${T.dReduce} ${T.eLinear} backwards}.sz-toast__timer{animation:none}}
`);

function ToastItem({ toast }) {
  const ref = useRef(null);
  // 退场（T-fade，P1-07）：被替换或到时收起时，卸载前复制一份原位淡出
  useLayoutEffect(() => () => playExit(ref.current, 'fade'), []);
  return html`<div class="sz-toast" ref=${ref} data-testid="toast" data-kind=${toast.kind}>
      <span class="sz-toast__text">${toast.text}</span>
      <span class="sz-toast__timer" aria-hidden="true" data-testid="toast-timer" style=${{ animationDuration: `${toast.duration || TOAST_MS}ms` }}></span>
    </div>`;
}

// 常驻的 live region：容器一直在，文字变化时读屏才会播报。
export function ToastHost() {
  const [toast, setToast] = useState(current);
  const [said, setSaid] = useState('');
  const hostRef = useRef(null);
  useEffect(() => {
    listeners.add(setToast);
    setToast(current);
    speakers.add(setSaid);
    return () => {
      listeners.delete(setToast);
      speakers.delete(setSaid);
    };
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
  return html`<div class="sz-toast-wrap">
    <div ref=${hostRef} class="sz-toast-host" role="status" aria-live="polite" aria-atomic="true" data-testid="toast-host">
      ${toast ? html`<${ToastItem} key=${toast.id} toast=${toast} />` : null}
    </div>
    <span class="sr-only" aria-live="polite" aria-atomic="true" data-testid="sr-announce">${said}</span>
  </div>`;
}
