// 按钮：所有可点控件都是 <button>（01-架构设计 §7、R-G09）。
// 防连点（01 §6.6、走查-W08）：新页面或新状态后 0.4s 内、以及同一按钮两次按下间隔 < 0.4s 时不响应；
// 一律按事件 timeStamp 比较（与 performance.now() 同一时钟）。
// rapid：本来就要连点的按钮（书写格的撤销 / 清空：连撤几笔）不做「同一按钮 0.4s」节流，只保留「新状态后 0.4s」（M1 验收 G2）。
// 禁用：disabled + aria-disabled（R-G08）。
// 按压反馈（P0-A4 / G16）：pointerdown 起 data-pressed、pointerup / pointercancel / pointerleave 收；样式见下方 .sz-btn[data-pressed]。
// 不用 :active——iOS WebKit 上 :active 需要 touchstart 监听才生效；data-pressed 直接写 DOM 属性（不走 state，不触发重画）。
// 按下 scale .97 + 亮度 −6%、80ms；松手 160ms 回弹；减少动态效果时只变色不缩放。参数登记 P109。
import { html, useRef } from '../../../vendor/ui.js';
import { injectStyles, T } from './styles.js';

export const PRESS_GUARD_MS = 400;
/** 按压反馈（P109）：按下 80ms 缩到 .97 并加深约 6%；松手 160ms 回弹。 */
export const PRESS_IN_MS = 80;
export const PRESS_OUT_MS = 160;
export const PRESS_SCALE = 0.97;
export const PRESS_DARKEN = 0.94; // brightness：背景 / 字加深约 6%

let lastStateChange = -Infinity;

function clockNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

// 路由/遮罩/页面状态变化时调用（ui/root.js 在每次导航后调用）。
export function markStateChange(ts = clockNow()) {
  lastStateChange = ts;
}

export function resetStateChange() {
  lastStateChange = -Infinity;
}

// 旧 WebKit 的 event.timeStamp 可能是 epoch 毫秒；与 performance.now() 相差太大时退回当前时钟。
export function eventTime(event) {
  const ts = event && typeof event.timeStamp === 'number' ? event.timeStamp : NaN;
  const now = clockNow();
  if (!Number.isFinite(ts) || ts <= 0 || Math.abs(ts - now) > 1e6) return now;
  return ts;
}

// 纯函数版本，单测可直接用：返回 accept(ts, {rapid}) → 是否响应这次按下。
// rapid=true 时只看「新状态后 ms」，不看同一按钮上一次按下。
export function createPressGuard(ms = PRESS_GUARD_MS, getStateChange = () => lastStateChange) {
  let last = -Infinity;
  return function accept(ts, { rapid = false } = {}) {
    if (ts < getStateChange() + ms) return false;
    if (!rapid && ts < last + ms) return false;
    last = ts;
    return true;
  };
}

/**
 * 按压反馈的四个指针处理函数（属性名全小写：Preact 对元素上没有的 on* 属性不会转小写，小写写法两种情况都对）。
 * isDisabled 每次现取（disabled 可能在按住期间变化）；禁用的按钮不起 data-pressed。
 */
export function pressFeedbackHandlers(isDisabled) {
  const release = event => {
    const el = event && event.currentTarget;
    if (el && typeof el.removeAttribute === 'function') el.removeAttribute('data-pressed');
  };
  return {
    onpointerdown(event) {
      const el = event && event.currentTarget;
      if (isDisabled() || !el || typeof el.setAttribute !== 'function') return;
      el.setAttribute('data-pressed', 'true');
    },
    onpointerup: release,
    onpointercancel: release,
    onpointerleave: release,
  };
}

injectStyles('button', `
.sz-btn{box-sizing:border-box;margin:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;
  -webkit-tap-highlight-color:transparent;touch-action:manipulation;-webkit-appearance:none;appearance:none;
  transition:transform ${PRESS_OUT_MS}ms cubic-bezier(.2,.7,.2,1),filter ${PRESS_OUT_MS}ms ease-out}
.sz-btn[data-pressed]{transform:scale(${PRESS_SCALE});filter:brightness(${PRESS_DARKEN});transition-duration:${PRESS_IN_MS}ms}
.sz-btn[disabled][data-pressed]{transform:none;filter:none}
.sz-btn:focus-visible{outline:2px solid ${T.ar};outline-offset:2px}
.sz-btn--primary,.sz-btn--secondary{width:100%;min-height:52px;border-radius:16px;padding:0 16px;
  font-size:calc(17px * ${T.k});letter-spacing:.08em}
.sz-btn--primary{background:${T.a};color:#FFF9F1}
.sz-btn--secondary{border:.5px solid ${T.i5};background:${T.c};color:${T.i1};letter-spacing:.06em}
.sz-btn--text{min-height:44px;padding:0 4px;display:inline-flex;align-items:center;gap:6px;
  font-size:calc(15px * ${T.k});letter-spacing:.04em;color:${T.i2}}
.sz-btn--icon{width:44px;height:44px;display:grid;place-items:center;color:${T.i1};padding:0}
.sz-btn--plain{padding:0}
.sz-btn[disabled]{cursor:default}
.sz-btn--primary[disabled]{background:${T.i5};color:${T.i3}}
.sz-btn--secondary[disabled],.sz-btn--text[disabled]{color:${T.i4}}
@media (prefers-reduced-motion: reduce){
  .sz-btn{transition:filter ${PRESS_IN_MS}ms linear}
  .sz-btn[data-pressed]{transform:none}
}
`);

/**
 * @param {object} props
 * @param {'primary'|'secondary'|'text'|'icon'|'plain'} [props.variant]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.guard]  false 时不做防连点（例如书写格工具条以外的纯展示切换）
 * @param {boolean} [props.rapid]  true 时不做「同一按钮 0.4s」节流，只保留「新页面 / 新状态后 0.4s」（撤销 / 清空连点）
 */
export function Button(props) {
  const {
    variant = 'primary',
    disabled = false,
    guard = true,
    rapid = false,
    onClick,
    children,
    class: cls,
    className,
    type = 'button',
    ...rest
  } = props;
  const guardRef = useRef(null);
  if (!guardRef.current) guardRef.current = createPressGuard();
  const handle = event => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (guard && !guardRef.current(eventTime(event), { rapid })) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (onClick) onClick(event);
  };
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const pressRef = useRef(null);
  if (!pressRef.current) pressRef.current = pressFeedbackHandlers(() => disabledRef.current);
  const classes = ['sz-btn', `sz-btn--${variant}`, cls, className].filter(Boolean).join(' ');
  return html`<button
    ...${rest}
    ...${pressRef.current}
    type=${type}
    class=${classes}
    disabled=${disabled}
    aria-disabled=${disabled ? 'true' : undefined}
    onClick=${handle}
  >${children}</button>`;
}
