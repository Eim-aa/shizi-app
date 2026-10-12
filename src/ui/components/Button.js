// 按钮：所有可点控件都是 <button>（01-架构设计 §7、R-G09）。
// 防连点（01 §6.6、走查-W08）：新页面或新状态后 0.4s 内、以及同一按钮两次按下间隔 < 0.4s 时不响应；
// 一律按事件 timeStamp 比较（与 performance.now() 同一时钟）。
// rapid：本来就要连点的按钮（书写格的撤销 / 清空：连撤几笔）不做「同一按钮 0.4s」节流，只保留「新状态后 0.4s」（M1 验收 G2）。
// 禁用：disabled + aria-disabled（R-G08）。
// 文字按钮（variant="text"，H1 / D51 ⑥）全 App 只有一种规格：黑体 15（--fs15）、--ink2、无下划线、按下变 --ink1；可点性靠位置与动词文案，不靠下划线。
//   「›」规则（设计系统一条）：标签是「去处的名字」（回到首页、练习记录、还有 N 个字、看写错过的字、更换字库）→ 行尾带「›」；
//   标签是动作（撤销、取消、提示、看答案、跳过、自己选字、练这些字、保存图片、接着写、完成）→ 不带。「›」写在文案里（copy/*），样式不画箭头。
//   页边对齐（H1 / T2-01）：文字按钮的点击区比字多 --bx（默认 4）的内边距，同量的负外边距把字形外缘对到所在盒的边——
//   放在 20pt 页边线上的文字按钮，字形外缘就落在 20 / 屏宽 − 20 上；短标签不靠 min-width 撑 44（会把字挤离边线），点击区由 ::after 补到 ≥ 44。
//   改了左右内边距的覆盖要同步改 --bx。
// 按压反馈（P0-A4 / G16；D43 起取设计系统 v1 的动效令牌）：pointerdown 起 data-pressed、pointerup / pointercancel / pointerleave 收；
// 样式见下方 .sz-btn[data-pressed]。不用 :active——iOS WebKit 上 :active 需要 touchstart 监听才生效；data-pressed 直接写 DOM 属性
// （不走 state，不触发重画）。原生 <button> 格子（结果 / 详情 / 记录页的字帖格）也用同一套 pressFeedbackHandlers。
// 按下 scale .97（--press-scale）、120ms（--t-press）；松手 220ms（--t-release）回弹；主按钮按下换 --btn-down、次按钮按下换 --field，
// 其余加深约 6%；减少动态效果时按下缩放保留，松手与其余过渡改 150ms 线性（motion.duration.reduce，全 App 唯一的减少动态效果时长，D58 ②）。参数登记 P109（已决定 D43）。
// 中文按词折行（R3-K1，A3-02，P242）：字符串文字经 Words 分词，每个词一个 nowrap 的 span——标准档按钮 nowrap 一行到底不变，AX 档按钮（white-space:normal）
// 只在词与词之间折，不词内折（A2-11）、也不像 keep-all 那样整句不折（A3-02）。
import { html, useRef } from '../../../vendor/ui.js';
import { injectStyles, T } from './styles.js';
import { Words } from './Words.js';
import { M } from '../../config/motion.js';

export const PRESS_GUARD_MS = M.timing.pressGuard;
/** 按压反馈（P109，已决定 D43）：按下 120ms 缩到 .97；松手 220ms 回弹。取 motion.role.pressIn / pressOut（与 tokens.css 的 --t-press / --t-release 同值，单测核对）。 */
export const PRESS_IN_MS = M.role.pressIn;
export const PRESS_OUT_MS = M.role.pressOut;
export const PRESS_SCALE = M.scale.press;
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
  transition:transform ${T.tRelease} ${T.easeOut},background-color ${T.tRelease} ${T.easeOut},filter ${T.tRelease} ${T.easeOut},color ${T.tRelease} ${T.easeOut}} /* 每一项都带曲线令牌：省掉就是浏览器默认 ease（IC-14 运行时抓到过） */
.sz-btn[data-pressed]{transform:scale(${T.pressScale});filter:brightness(${PRESS_DARKEN});transition-duration:${T.tPress}}
.sz-btn[disabled][data-pressed]{transform:none;filter:none}
.sz-btn:focus-visible{outline:2px solid ${T.ink1};outline-offset:2px}
.sz-btn--primary,.sz-btn--secondary{width:100%;min-height:${T.btnH};border-radius:${T.rCtl};padding:0 24px;
  font-size:${T.fs17};line-height:${T.lh17s};font-weight:500}
.sz-btn--primary{background:${T.btnBg};color:${T.btnFg}}
.sz-btn--secondary{background:transparent;color:${T.ink1};box-shadow:inset 0 0 0 1px ${T.ink4}}
.sz-btn--text{--bx:4px;position:relative;min-width:0;min-height:${T.hit};padding:0 var(--bx);margin-inline:calc(-1 * var(--bx));display:inline-flex;
  align-items:center;gap:6px;font-family:${T.hei};font-size:${T.fs15};line-height:${T.lh15};font-weight:400;color:${T.ink2};text-decoration:none}
.sz-btn--text::after{content:"";position:absolute;left:50%;top:50%;width:max(100%,${T.hit});height:max(100%,${T.hit});transform:translate(-50%,-50%)} /* 短标签（跳过）的点击区仍 ≥ 44，不靠 min-width（那会把字挤离边线） */
.sz-btn--icon{width:${T.hit};height:${T.hit};display:grid;place-items:center;color:${T.ink1};padding:0}
.sz-btn--plain{padding:0}
.sz-btn[disabled]{cursor:default}
.sz-btn--primary[data-pressed]{background:${T.btnDown};filter:none}
.sz-btn--secondary[data-pressed]{background:${T.field};filter:none}
.sz-btn--text[data-pressed]{color:${T.ink1};transform:none;filter:none}
.sz-btn--primary[disabled],.sz-btn--secondary[disabled]{background:${T.field};color:${T.ink4};box-shadow:none}
.sz-btn--text[disabled]{color:${T.ink4}}
@media (prefers-reduced-motion: reduce){
  .sz-btn{transition-duration:${T.dReduce};transition-timing-function:${T.eLinear}}
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
  >${typeof children === 'string' ? html`<${Words} text=${children} />` : children}</button>`;
}
