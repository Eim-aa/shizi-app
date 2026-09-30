// 按钮：所有可点控件都是 <button>（01-架构设计 §7、R-G09）。
// 防连点（01 §6.6、走查-W08）：新页面或新状态后 0.4s 内、以及同一按钮两次按下间隔 < 0.4s 时不响应；
// 一律按事件 timeStamp 比较（与 performance.now() 同一时钟）。
// 禁用：disabled + aria-disabled（R-G08）。
import { html, useRef } from '../../../vendor/ui.js';
import { injectStyles, T } from './styles.js';

export const PRESS_GUARD_MS = 400;

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

// 纯函数版本，单测可直接用：返回 accept(ts) → 是否响应这次按下。
export function createPressGuard(ms = PRESS_GUARD_MS, getStateChange = () => lastStateChange) {
  let last = -Infinity;
  return function accept(ts) {
    if (ts < getStateChange() + ms) return false;
    if (ts < last + ms) return false;
    last = ts;
    return true;
  };
}

injectStyles('button', `
.sz-btn{box-sizing:border-box;margin:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;
  -webkit-tap-highlight-color:transparent;touch-action:manipulation;-webkit-appearance:none;appearance:none}
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
`);

/**
 * @param {object} props
 * @param {'primary'|'secondary'|'text'|'icon'|'plain'} [props.variant]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.guard]  false 时不做防连点（例如书写格工具条以外的纯展示切换）
 */
export function Button(props) {
  const {
    variant = 'primary',
    disabled = false,
    guard = true,
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
    if (guard && !guardRef.current(eventTime(event))) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (onClick) onClick(event);
  };
  const classes = ['sz-btn', `sz-btn--${variant}`, cls, className].filter(Boolean).join(' ');
  return html`<button
    ...${rest}
    type=${type}
    class=${classes}
    disabled=${disabled}
    aria-disabled=${disabled ? 'true' : undefined}
    onClick=${handle}
  >${children}</button>`;
}
